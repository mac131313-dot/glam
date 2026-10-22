// Abonament GLAM: subskrypcje studiów na koncie Stripe GLAM (env `GLAM_STRIPE_*`) – osobno od bramek studiów
// (`gateway_enc`, services/stripe.ts). REST przez fetch bez SDK; webhook `POST /api/platform/stripe` (routes/platform/billing.ts)
// przekłada zdarzenia na `studio_billing` i `platform_payments`, a dostęp studia liczy potem `syncAccess`.
import { BILLING_GRACE_DAYS, PLANS } from '@glam/core';
import type { Deps } from '../context.ts';
import { id, nowIso, tx } from '../db.ts';
import { badRequest, HttpError } from '../errors.ts';
import { loadBilling, mailOwners, syncAccess, type BillingRow } from './billing.ts';
import { formEncode } from './stripe.ts';

const API = 'https://api.stripe.com/v1';
const DAY_MS = 86_400_000;
/** Stripe Checkout przyjmuje `trial_end` co najmniej 48 h w przód; bliżej końca triala abonament startuje od razu. */
const MIN_TRIAL_END_MS = 2 * DAY_MS + 3_600_000;

export type PlatformStripe = NonNullable<Deps['platformStripe']>;
type PlanKey = keyof PlatformStripe['prices'];

export const billingNotConfigured = () => new HttpError(409, 'billing_not_configured', 'Płatności abonamentu wkrótce');

/** Konfiguracja z env: wszystkie pięć zmiennych albo `undefined` (płatności abonamentu wyłączone). */
export function platformStripeFromEnv(env: Record<string, string | undefined>): PlatformStripe | undefined {
  const secret = env.GLAM_STRIPE_SECRET;
  const webhookSecret = env.GLAM_STRIPE_WEBHOOK_SECRET;
  const start = env.GLAM_STRIPE_PRICE_START;
  const studio = env.GLAM_STRIPE_PRICE_STUDIO;
  const siec = env.GLAM_STRIPE_PRICE_SIEC;
  if (!secret || !webhookSecret || !start || !studio || !siec) return undefined;
  return { secret, webhookSecret, prices: { start, studio, siec } };
}

function config(deps: Deps): PlatformStripe {
  if (!deps.platformStripe) throw billingNotConfigured();
  return deps.platformStripe;
}

const isPlanKey = (planId: string): planId is PlanKey => PLANS.some((p) => p.id === planId);

/** Cena Stripe dla planu GLAM. */
export function priceForPlan(deps: Deps, planId: string): string {
  const { prices } = config(deps);
  if (!isPlanKey(planId)) throw badRequest('Nieznany plan.');
  return prices[planId];
}

/** Plan GLAM dla ceny Stripe albo null, gdy cena nie należy do żadnego planu. */
export function planForPrice(deps: Deps, priceId: string): string | null {
  const prices = deps.platformStripe?.prices;
  if (!prices) return null;
  return (Object.keys(prices) as PlanKey[]).find((k) => prices[k] === priceId) ?? null;
}

const stripeError = () => new HttpError(502, 'stripe_error', 'Płatności chwilowo nie odpowiadają – spróbuj za chwilę.');

/** Wywołanie API Stripe GLAM. Odpowiedź Stripe przy błędzie trafia tylko do logu serwera, nigdy do klienta. */
async function call<T>(deps: Deps, path: string, params: Record<string, unknown> = {}, method: 'POST' | 'GET' = 'POST'): Promise<T> {
  const { secret } = config(deps);
  const body = formEncode(params);
  let res: Response;
  let data: T & { error?: { message?: string } };
  try {
    res = await (deps.http ?? fetch)(method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: method === 'POST' ? body : undefined,
    });
    data = (await res.json().catch(() => ({}))) as typeof data;
  } catch (err) {
    console.error(`Stripe GLAM ${method} ${path}`, err);
    throw stripeError();
  }
  if (!res.ok) {
    console.error(`Stripe GLAM ${method} ${path}: ${res.status} ${data.error?.message ?? ''}`);
    throw stripeError();
  }
  return data;
}

/**
 * Dodanie karty: Checkout `mode=subscription` na koncie GLAM. Klienta Stripe zakładamy raz (dane do faktury)
 * i zapisujemy w `studio_billing`. Trwający trial przechodzi do Stripe jako `trial_end` – pierwsza opłata po trialu.
 * `returnUrl` = adres panelu; powrót wraca na Ustawienia (`#settings`), po sukcesie z `?billing=ok`.
 */
export async function subscriptionCheckout(deps: Deps, studio: { id: string; trialEndsAt: string | null }, billing: BillingRow, planId: string, returnUrl: string): Promise<{ url: string }> {
  const price = priceForPlan(deps, planId);
  let customer = billing.stripe_customer_id;
  if (!customer) {
    const created = await call<{ id: string }>(deps, '/customers', { name: billing.company_name ?? undefined, email: billing.invoice_email ?? undefined, metadata: { studio_id: studio.id } });
    deps.db.prepare('UPDATE studio_billing SET stripe_customer_id = ?, updated_at = ? WHERE studio_id = ? AND stripe_customer_id IS NULL').run(created.id, nowIso(), studio.id);
    // Dwa równoległe kliknięcia: wygrywa klient zapisany jako pierwszy.
    customer = loadBilling(deps.db, studio.id).stripe_customer_id ?? created.id;
  }
  const trialEnd = studio.trialEndsAt ? Date.parse(studio.trialEndsAt) : NaN;
  const session = await call<{ url: string }>(deps, '/checkout/sessions', {
    mode: 'subscription',
    customer,
    client_reference_id: studio.id,
    line_items: [{ price, quantity: 1 }],
    locale: 'pl',
    success_url: `${returnUrl}?billing=ok#settings`,
    cancel_url: `${returnUrl}#settings`,
    metadata: { studio_id: studio.id, plan_id: planId },
    subscription_data: { metadata: { studio_id: studio.id }, trial_end: trialEnd - Date.now() >= MIN_TRIAL_END_MS ? Math.floor(trialEnd / 1000) : undefined },
  });
  return { url: session.url };
}

/** Hostowany Billing Portal: zmiana karty i historia płatności w Stripe. */
export async function billingPortal(deps: Deps, customerId: string, returnUrl: string): Promise<{ url: string }> {
  const session = await call<{ url: string }>(deps, '/billing_portal/sessions', { customer: customerId, return_url: returnUrl, locale: 'pl' });
  return { url: session.url };
}

/** Zmiana ceny subskrypcji: `immediate` = od razu z dopłatą proporcjonalną, inaczej nowa cena od następnej faktury. */
export async function changeSubscriptionPlan(deps: Deps, subscriptionId: string, priceId: string, immediate: boolean): Promise<void> {
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`;
  const sub = await call<{ items?: { data?: { id: string }[] } }>(deps, path, {}, 'GET');
  const item = sub.items?.data?.[0]?.id;
  if (!item) {
    console.error(`Stripe GLAM: subskrypcja ${subscriptionId} bez pozycji`);
    throw stripeError();
  }
  await call(deps, path, { items: [{ id: item, price: priceId }], proration_behavior: immediate ? 'always_invoice' : 'none' });
}

/** Rezygnacja z końcem opłaconego okresu (albo jej cofnięcie). */
export async function setCancelAtPeriodEnd(deps: Deps, subscriptionId: string, cancel: boolean): Promise<void> {
  await call(deps, `/subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: cancel });
}

// ——— Webhook ———

type Ref = string | { id: string } | null | undefined;
type Meta = { studio_id?: string; plan_id?: string } | null | undefined;
type CheckoutSession = { mode?: string; client_reference_id?: string | null; customer?: Ref; subscription?: Ref; metadata?: Meta };
type Subscription = {
  id: string;
  customer?: Ref;
  status?: string;
  current_period_end?: number | null;
  cancel_at_period_end?: boolean;
  cancel_at?: number | null;
  ended_at?: number | null;
  metadata?: Meta;
  // Nowsze wersje API trzymają okres przy pozycji subskrypcji.
  items?: { data?: { current_period_end?: number | null }[] };
};
type InvoiceLine = { amount?: number; metadata?: Meta; period?: { start?: number; end?: number }; price?: { id?: string } | null; pricing?: { price_details?: { price?: string } } | null };
type Invoice = {
  id: string;
  customer?: Ref;
  subscription?: Ref;
  amount_paid?: number;
  period_start?: number;
  period_end?: number;
  status_transitions?: { paid_at?: number | null } | null;
  subscription_details?: { metadata?: Meta } | null;
  parent?: { subscription_details?: { subscription?: Ref; metadata?: Meta } | null } | null;
  lines?: { data?: InvoiceLine[] };
};
/** `created` = chwila zdarzenia w Stripe (sekundy epoki); Stripe nie gwarantuje kolejności dostarczenia. */
export type PlatformEvent = { id: string; type: string; created?: number; data: { object: unknown } };

const refId = (r: Ref) => (typeof r === 'string' ? r : (r?.id ?? null));
const epochIso = (sec: number | null | undefined) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString() : null);
const later = (a: string | null, b: string | null) => (!a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b);

/** Studio zdarzenia: z metadanych, a gdy ich brak – po zapisanej subskrypcji albo kliencie Stripe. */
function findStudio(deps: Deps, ref: { studioId?: string | null; subscription?: string | null; customer?: string | null }): string | null {
  const { db } = deps;
  if (ref.studioId && db.prepare('SELECT 1 FROM studios WHERE id = ?').get(ref.studioId)) return ref.studioId;
  for (const [col, value] of [['stripe_subscription_id', ref.subscription], ['stripe_customer_id', ref.customer]] as const) {
    if (!value) continue;
    const row = db.prepare(`SELECT studio_id FROM studio_billing WHERE ${col} = ?`).get(value) as { studio_id: string } | undefined;
    if (row) return row.studio_id;
  }
  return null;
}

const setPlan = (deps: Deps, studioId: string, planId: string) => deps.db.prepare('UPDATE studios SET plan_id = ? WHERE id = ?').run(planId, studioId);

type Outcome = { studioId: string; paymentFailed?: boolean } | null;

/**
 * Zdarzenie Stripe GLAM: najpierw wpis do `platform_stripe_events` (to samo id drugi raz = bez skutków), w tej samej
 * transakcji zmiany rozliczeń – błąd cofa też wpis, więc ponowienie Stripe przetworzy zdarzenie od nowa.
 * Potem e-mail (nieudana płatność) i `syncAccess`. Zdarzenia dla nieznanych studiów są pomijane.
 */
export async function handlePlatformEvent(deps: Deps, event: PlatformEvent): Promise<void> {
  const { db } = deps;
  const outcome = tx(db, (): Outcome => {
    const fresh = db.prepare('INSERT OR IGNORE INTO platform_stripe_events (id, type, received_at) VALUES (?, ?, ?)').run(event.id, event.type, nowIso());
    if (Number(fresh.changes) === 0) return null;
    switch (event.type) {
      case 'checkout.session.completed':
        return checkoutCompleted(deps, event.data.object as CheckoutSession);
      case 'customer.subscription.updated':
        return subscriptionUpdated(deps, event.data.object as Subscription, epochIso(event.created));
      case 'customer.subscription.deleted':
        return subscriptionDeleted(deps, event.data.object as Subscription, epochIso(event.created));
      case 'invoice.paid':
        return invoicePaid(deps, event.data.object as Invoice);
      case 'invoice.payment_failed':
        return invoiceFailed(deps, event.data.object as Invoice);
      default:
        return null;
    }
  });
  if (!outcome) return;
  if (outcome.paymentFailed) {
    const studio = db.prepare('SELECT name FROM studios WHERE id = ?').get(outcome.studioId) as { name: string };
    await mailOwners(
      deps,
      outcome.studioId,
      'Płatność za GLAM nie przeszła',
      `Nie udało się pobrać opłaty za abonament GLAM studia ${studio.name}. Sprawdź kartę w panelu: ${deps.publicUrl ?? ''}/panel (Abonament). Stripe ponowi płatność; jeśli nie przejdzie w ciągu ${BILLING_GRACE_DAYS} dni, studio zostanie zawieszone.`,
    );
  }
  await syncAccess(deps, outcome.studioId);
}

/**
 * Checkout zakończony: zapisuje klienta i subskrypcję oraz plan wybrany przy dodaniu karty.
 * Nie rusza okresu ani stanu ustawionego wcześniej przez `subscription.updated` (kolejność zdarzeń w Stripe nie jest gwarantowana).
 */
function checkoutCompleted(deps: Deps, s: CheckoutSession): Outcome {
  if (s.mode !== 'subscription') return null;
  const subscription = refId(s.subscription);
  const customer = refId(s.customer);
  const studioId = findStudio(deps, { studioId: s.client_reference_id ?? s.metadata?.studio_id, subscription, customer });
  if (!studioId || !subscription) return null;
  const b = loadBilling(deps.db, studioId);
  // Nowa subskrypcja (pierwsza albo po zakończonej) zaczyna od czystego stanu; ta sama – już opisana przez subscription.updated.
  const isNew = b.stripe_subscription_id !== subscription;
  const state = isNew || b.state === 'none' ? 'active' : b.state;
  deps.db
    .prepare('UPDATE studio_billing SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = ?, state = ?, past_due_since = ?, cancel_at_period_end = ?, pending_plan_id = ?, updated_at = ? WHERE studio_id = ?')
    .run(customer, subscription, state, isNew ? null : b.past_due_since, isNew ? 0 : b.cancel_at_period_end, isNew ? null : b.pending_plan_id, nowIso(), studioId);
  const planId = s.metadata?.plan_id;
  if (planId && isPlanKey(planId)) setPlan(deps, studioId, planId);
  return { studioId };
}

/** Zdarzenie starej subskrypcji (inna niż zapisana) nie nadpisuje bieżącej. */
const otherSubscription = (b: BillingRow, subscriptionId: string) => b.stripe_subscription_id !== null && b.stripe_subscription_id !== subscriptionId;

/** Zdarzenie subskrypcji starsze niż ostatnio zastosowane (dostarczone później) – pomijane; ta sama sekunda się liczy. */
const staleEvent = (b: BillingRow, eventAt: string | null) => !!eventAt && !!b.stripe_event_at && Date.parse(eventAt) < Date.parse(b.stripe_event_at);

function subscriptionUpdated(deps: Deps, sub: Subscription, eventAt: string | null): Outcome {
  const studioId = findStudio(deps, { studioId: sub.metadata?.studio_id, subscription: sub.id, customer: refId(sub.customer) });
  if (!studioId) return null;
  const b = loadBilling(deps.db, studioId);
  if (otherSubscription(b, sub.id) || staleEvent(b, eventAt)) return null;
  const state = sub.status === 'active' || sub.status === 'trialing' ? 'active' : sub.status === 'past_due' || sub.status === 'unpaid' ? 'past_due' : sub.status === 'canceled' ? 'canceled' : b.state;
  const pastDueSince = state === 'past_due' ? (b.past_due_since ?? nowIso()) : state === 'active' ? null : b.past_due_since;
  const periodEnd = epochIso(sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end);
  // Nowy okres (odnowienie) bywa w Stripe zgłaszany przed `invoice.paid` – czekające obniżenie planu wchodzi wtedy już tutaj.
  let pending = b.pending_plan_id;
  if (pending && b.current_period_end && periodEnd && Date.parse(periodEnd) > Date.parse(b.current_period_end)) {
    setPlan(deps, studioId, pending);
    pending = null;
  }
  const cancel = sub.cancel_at_period_end === true || typeof sub.cancel_at === 'number';
  deps.db
    .prepare(
      `UPDATE studio_billing SET stripe_subscription_id = ?, stripe_customer_id = COALESCE(stripe_customer_id, ?), state = ?, past_due_since = ?,
         current_period_end = ?, cancel_at_period_end = ?, pending_plan_id = ?, stripe_event_at = ?, updated_at = ? WHERE studio_id = ?`,
    )
    // Zakończona subskrypcja nie zostaje „bieżącą” – inaczej blokowałaby założenie nowej. Okres przesuwa się tylko do przodu.
    .run(b.stripe_subscription_id ?? (state === 'canceled' ? null : sub.id), refId(sub.customer), state, pastDueSince, later(b.current_period_end, periodEnd), cancel ? 1 : 0, pending, later(b.stripe_event_at, eventAt), nowIso(), studioId);
  return { studioId };
}

function subscriptionDeleted(deps: Deps, sub: Subscription, eventAt: string | null): Outcome {
  const studioId = findStudio(deps, { studioId: sub.metadata?.studio_id, subscription: sub.id, customer: refId(sub.customer) });
  if (!studioId) return null;
  const b = loadBilling(deps.db, studioId);
  if (otherSubscription(b, sub.id) || staleEvent(b, eventAt)) return null;
  // Bez subskrypcji właścicielka może dodać kartę od nowa (nowy Checkout).
  deps.db
    .prepare("UPDATE studio_billing SET state = 'canceled', current_period_end = COALESCE(?, current_period_end), stripe_subscription_id = NULL, cancel_at_period_end = 0, pending_plan_id = NULL, stripe_event_at = ?, updated_at = ? WHERE studio_id = ?")
    .run(epochIso(sub.ended_at), later(b.stripe_event_at, eventAt), nowIso(), studioId);
  return { studioId };
}

/** Studio i subskrypcja faktury (pola z różnych wersji API Stripe). */
function invoiceRefs(deps: Deps, inv: Invoice) {
  const subscription = refId(inv.subscription) ?? refId(inv.parent?.subscription_details?.subscription);
  const meta = inv.subscription_details?.metadata ?? inv.parent?.subscription_details?.metadata ?? inv.lines?.data?.[0]?.metadata;
  const studioId = findStudio(deps, { studioId: meta?.studio_id, subscription, customer: refId(inv.customer) });
  if (!studioId) return null;
  const b = loadBilling(deps.db, studioId);
  // Faktura bieżącej subskrypcji – albo pierwsza, która dotarła przed `checkout.session.completed`.
  const current = b.stripe_subscription_id ? !subscription || subscription === b.stripe_subscription_id : b.state !== 'canceled';
  return { studioId, subscription, b, current };
}

/**
 * Opłacona faktura: płatność > 0 zł trafia do `platform_payments` (faktura 0 zł za trial – nie), a bieżąca subskrypcja
 * wraca do `active`. Faktura za okres od końca dotychczasowego okresu włącza czekające obniżenie planu.
 */
function invoicePaid(deps: Deps, inv: Invoice): Outcome {
  const refs = invoiceRefs(deps, inv);
  if (!refs) return null;
  const { studioId, subscription, b, current } = refs;
  const { db } = deps;
  const lines = inv.lines?.data ?? [];
  // Przy dopłacie za zmianę planu pierwsza pozycja bywa ujemnym rozliczeniem starego planu – liczy się pozycja płatna.
  const line = lines.find((l) => (l.amount ?? 0) > 0) ?? lines[0];
  const periodStart = epochIso(line?.period?.start ?? inv.period_start);
  const periodEnd = epochIso(line?.period?.end ?? inv.period_end);
  const amount = inv.amount_paid ?? 0;
  if (amount > 0 && periodStart && periodEnd) {
    const price = line?.price?.id ?? line?.pricing?.price_details?.price;
    const studioPlan = (db.prepare('SELECT plan_id FROM studios WHERE id = ?').get(studioId) as { plan_id: string | null }).plan_id;
    db.prepare('INSERT OR IGNORE INTO platform_payments (id, studio_id, stripe_invoice_id, amount_grosze, plan_id, period_start, period_end, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      id(),
      studioId,
      inv.id,
      amount,
      (price && planForPrice(deps, price)) ?? studioPlan ?? PLANS[1]!.id,
      periodStart,
      periodEnd,
      epochIso(inv.status_transitions?.paid_at) ?? nowIso(),
    );
  }
  if (!current) return { studioId };
  let pending = b.pending_plan_id;
  if (pending && periodStart && b.current_period_end && Date.parse(periodStart) >= Date.parse(b.current_period_end)) {
    setPlan(deps, studioId, pending);
    pending = null;
  }
  db.prepare(
    `UPDATE studio_billing SET state = 'active', past_due_since = NULL, current_period_end = ?, pending_plan_id = ?,
       stripe_subscription_id = COALESCE(stripe_subscription_id, ?), stripe_customer_id = COALESCE(stripe_customer_id, ?), updated_at = ? WHERE studio_id = ?`,
  ).run(later(b.current_period_end, periodEnd), pending, subscription, refId(inv.customer), nowIso(), studioId);
  return { studioId };
}

/**
 * Nieudana płatność: zaległość od pierwszej porażki (karencja `BILLING_GRACE_DAYS`) i e-mail do właścicielki przy każdej próbie.
 * Porażka dostarczona po `invoice.paid` tej samej faktury (faktura już opłacona) jest pomijana.
 */
function invoiceFailed(deps: Deps, inv: Invoice): Outcome {
  if (deps.db.prepare('SELECT 1 FROM platform_payments WHERE stripe_invoice_id = ?').get(inv.id)) return null;
  const refs = invoiceRefs(deps, inv);
  if (!refs?.current) return null;
  deps.db.prepare("UPDATE studio_billing SET state = 'past_due', past_due_since = COALESCE(past_due_since, ?), updated_at = ? WHERE studio_id = ?").run(nowIso(), nowIso(), refs.studioId);
  return { studioId: refs.studioId, paymentFailed: true };
}
