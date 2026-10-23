// Abonament GLAM: webhook Stripe GLAM (`POST /api/platform/stripe`) i ekran „Abonament” właścicielki
// (`/api/owner/billing`: stan, dane do faktury, Checkout, Billing Portal, zmiana planu, rezygnacja),
// a po stronie konsoli pieniądze (płatności do zafakturowania, CSV dla księgowej) i przegląd „Dziś”.
// Bez `deps.platformStripe` akcje płatnicze odpowiadają 409 „Płatności abonamentu wkrótce”, a trial działa dalej.
import type { FastifyInstance } from 'fastify';
import { addDays, BILLING_GRACE_DAYS, FEATURE_LABEL, formatPLN, localParts, PLANS, planById, planUsage, validEmail, validNip, zonedToUtc } from '@glam/core';
import { ctx, requireStudio, type Deps } from '../../context.ts';
import { nowIso, tx } from '../../db.ts';
import { badRequest, conflict, forbidden, notFound } from '../../errors.ts';
import { shortDate, studioAttention, type Signal } from '../../services/attention.ts';
import { loadBilling } from '../../services/billing.ts';
import {
  billingNotConfigured,
  billingPortal,
  changeSubscriptionPlan,
  handlePlatformEvent,
  priceForPlan,
  setCancelAtPeriodEnd,
  subscriptionCheckout,
  type PlatformEvent,
} from '../../services/platform-stripe.ts';
import { verifyStripeSignature } from '../../services/stripe.ts';
import { studioUsage } from '../../services/usage.ts';
import { platformAudit, requirePlatform } from './guard.ts';

type PaymentRow = {
  id: string;
  studio_id: string;
  studio: string;
  company_name: string | null;
  nip: string | null;
  amount_grosze: number;
  period_start: string;
  period_end: string;
  paid_at: string;
  invoiced_at: string | null;
  invoice_number: string | null;
};

const PAYMENT_SELECT = `SELECT p.id, p.studio_id, s.name AS studio, b.company_name, b.nip, p.amount_grosze, p.period_start, p.period_end, p.paid_at, p.invoiced_at, p.invoice_number
  FROM platform_payments p JOIN studios s ON s.id = p.studio_id LEFT JOIN studio_billing b ON b.studio_id = p.studio_id`;

const DAY_MS = 86_400_000;
/** Od ilu dni do końca triala (bez karty) pokazujemy pasek w panelu. */
const TRIAL_BANNER_DAYS = 5;

const CSV_HEADER = ['Data płatności', 'Studio', 'Firma', 'NIP', 'Okres od', 'Okres do', 'Kwota brutto', 'Nr faktury'];

/** Pole CSV (separator `;`): w cudzysłowie, gdy zawiera `;`, `"` lub nowy wiersz. `text` blokuje wykonanie jako formuła w arkuszu (`=`, `+`, `-`, `@`). */
function csvCell(value: string | null, text = false): string {
  let v = value ?? '';
  if (text && /^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Data `RRRR-MM-DD` z zapytania albo null, gdy nie podano; nieistniejąca data to 400. */
function queryDay(value: unknown, name: string): string | null {
  if (value === undefined || value === '') return null;
  const v = String(value);
  const real = /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
  if (!real) throw badRequest(`Podaj datę „${name}” jako RRRR-MM-DD.`);
  return v;
}

export function billingRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const anyRole = requirePlatform(deps);
  const money = requirePlatform(deps, 'admin', 'finance');
  const owner = { preHandler: requireStudio(db, ['owner']) };
  const panelUrl = () => `${deps.publicUrl ?? ''}/panel`;
  const requireConfigured = () => {
    if (!deps.platformStripe) throw billingNotConfigured();
  };
  const knownPlan = (planId: unknown): string => {
    if (typeof planId !== 'string' || !PLANS.some((p) => p.id === planId)) throw badRequest('Nieznany plan.');
    return planId;
  };
  const requireSubscription = (studioId: string): string => {
    const sub = loadBilling(db, studioId).stripe_subscription_id;
    if (!sub) throw conflict('no_subscription', 'Najpierw dodaj kartę.');
    return sub;
  };

  // Webhook Stripe GLAM. Podpis liczony z surowego body, więc trasa ma własny parser JSON (jak webhook studiów).
  app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    sub.post<{ Body: string }>('/api/platform/stripe', async (req) => {
      const cfg = deps.platformStripe;
      if (!cfg) throw notFound();
      if (!verifyStripeSignature(req.body, req.headers['stripe-signature'] as string | undefined, cfg.webhookSecret)) throw forbidden();
      let event: PlatformEvent;
      try {
        event = JSON.parse(req.body) as PlatformEvent;
      } catch {
        throw badRequest('Nieprawidłowe zdarzenie.');
      }
      if (typeof event?.id !== 'string' || typeof event.type !== 'string' || typeof event.data?.object !== 'object' || event.data.object === null) throw badRequest('Nieprawidłowe zdarzenie.');
      await handlePlatformEvent(deps, event);
      return { received: true };
    });
  });

  // ——— Konsola: pieniądze ———
  // Faktury VAT wystawia się poza systemem; zespół finansów widzi opłacone płatności i oznacza je numerem faktury.

  app.get<{ Querystring: { status?: string } }>('/api/platform/payments', money, async (req) => {
    const status = req.query.status ?? 'uninvoiced';
    if (status !== 'uninvoiced' && status !== 'all') throw badRequest('Nieznany status płatności.');
    const rows = db.prepare(`${PAYMENT_SELECT} ${status === 'uninvoiced' ? 'WHERE p.invoiced_at IS NULL' : ''} ORDER BY p.paid_at DESC, p.rowid DESC`).all() as PaymentRow[];
    return rows.map((p) => ({
      id: p.id,
      studio: p.studio,
      studioId: p.studio_id,
      companyName: p.company_name,
      nip: p.nip,
      amount: formatPLN(p.amount_grosze),
      amountGrosze: p.amount_grosze,
      periodStart: p.period_start,
      periodEnd: p.period_end,
      paidAt: p.paid_at,
      invoicedAt: p.invoiced_at,
      invoiceNumber: p.invoice_number,
    }));
  });

  // Eksport dla księgowej: wszystkie płatności z zakresu dat (dni czasu lokalnego, włącznie); bez `from`/`to` – bez ograniczenia.
  app.get<{ Querystring: { from?: string; to?: string } }>('/api/platform/payments.csv', money, async (req, reply) => {
    const from = queryDay(req.query.from, 'od');
    const to = queryDay(req.query.to, 'do');
    const rows = db
      .prepare(`${PAYMENT_SELECT} WHERE (@from IS NULL OR p.paid_at >= @from) AND (@to IS NULL OR p.paid_at < @to) ORDER BY p.paid_at, p.rowid`)
      .all({ from: from ? zonedToUtc(from, '00:00').toISOString() : null, to: to ? zonedToUtc(addDays(to, 1), '00:00').toISOString() : null }) as PaymentRow[];
    const day = (iso: string) => localParts(new Date(iso)).date;
    const lines = [
      CSV_HEADER.map((h) => csvCell(h)),
      ...rows.map((p) => [day(p.paid_at), csvCell(p.studio, true), csvCell(p.company_name, true), csvCell(p.nip, true), day(p.period_start), day(p.period_end), (p.amount_grosze / 100).toFixed(2).replace('.', ','), csvCell(p.invoice_number, true)]),
    ];
    const range = from && to ? `-${from}-${to}` : from ? `-od-${from}` : to ? `-do-${to}` : '';
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="glam-platnosci${range}.csv"`)
      .send(`﻿${lines.map((l) => `${l.join(';')}\r\n`).join('')}`);
  });

  app.post<{ Params: { id: string }; Body: { number?: string } }>('/api/platform/payments/:id/invoice', money, async (req) => {
    const number = String(req.body?.number ?? '').trim();
    if (!number || number.length > 40) throw badRequest('Podaj numer faktury (do 40 znaków).');
    const payment = db.prepare('SELECT studio_id FROM platform_payments WHERE id = ?').get(req.params.id) as { studio_id: string } | undefined;
    if (!payment) throw notFound();
    tx(db, () => {
      const marked = db.prepare('UPDATE platform_payments SET invoiced_at = ?, invoice_number = ?, invoiced_by = ? WHERE id = ? AND invoiced_at IS NULL').run(nowIso(), number, req.user!.id, req.params.id);
      if (marked.changes === 0) throw conflict('already_invoiced', 'Ta płatność jest już oznaczona jako zafakturowana.');
      platformAudit(db, req.user!.id, 'payment.invoiced', payment.studio_id, { paymentId: req.params.id, number });
    });
    return { ok: true };
  });

  // ——— Konsola: przegląd „Dziś” ———
  // MRR to suma cen planów studiów z aktywnym abonamentem (z `PLANS`, nie z faktur); sygnały liczone raz na żądanie.
  app.get('/api/platform/overview', anyRole, async () => {
    const studios = db
      .prepare(
        `SELECT s.id, s.name, s.status, s.plan_id, s.trial_ends_at, COALESCE(b.state, 'none') AS billing_state, b.past_due_since
         FROM studios s LEFT JOIN studio_billing b ON b.studio_id = s.id ORDER BY s.name`,
      )
      .all() as { id: string; name: string; status: string; plan_id: string | null; trial_ends_at: string | null; billing_state: string; past_due_since: string | null }[];
    const attention: Record<Signal, { id: string; name: string; hint: string }[]> = { trial_ending: [], past_due: [], over_limit: [] };
    for (const s of studios) for (const a of studioAttention(db, s)) attention[a.signal].push({ id: s.id, name: s.name, hint: a.hint });
    const paying = studios.filter((s) => s.billing_state === 'active');
    const mrrGrosze = paying.reduce((sum, s) => sum + planById(s.plan_id).priceGrosze, 0);
    return {
      mrr: formatPLN(mrrGrosze),
      mrrGrosze,
      paying: paying.length,
      byPlan: PLANS.map((p) => {
        const n = paying.filter((s) => planById(s.plan_id).id === p.id).length;
        return { plan: p.name, studios: n, mrr: formatPLN(n * p.priceGrosze) };
      }),
      trialsEnding: attention.trial_ending,
      pastDue: attention.past_due,
      overLimit: attention.over_limit,
      overdueTickets: (db.prepare("SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open' AND sla_due_at < ?").get(nowIso()) as { n: number }).n,
      openIncidents: (db.prepare('SELECT COUNT(*) AS n FROM status_incidents WHERE resolved_at IS NULL').get() as { n: number }).n,
    };
  });

  app.get('/api/owner/billing', owner, async (req) => {
    const { studio, scope } = ctx(req);
    const plan = planById(studio.plan_id);
    const b = loadBilling(db, studio.id);
    const payments = db
      .prepare('SELECT period_start, period_end, amount_grosze, paid_at FROM platform_payments WHERE studio_id = ? ORDER BY paid_at DESC')
      .all(studio.id) as { period_start: string; period_end: string; amount_grosze: number; paid_at: string }[];
    return {
      configured: !!deps.platformStripe,
      plan: { id: plan.id, name: plan.name, price: formatPLN(plan.priceGrosze) },
      status: studio.status,
      trialEndsAt: studio.trial_ends_at,
      billing: {
        state: b.state,
        currentPeriodEnd: b.current_period_end,
        cancelAtPeriodEnd: !!b.cancel_at_period_end,
        pendingPlanId: b.pending_plan_id,
        pastDueSince: b.past_due_since,
        companyName: b.company_name,
        nip: b.nip,
        address: b.address,
        invoiceEmail: b.invoice_email,
        hasCard: b.stripe_subscription_id !== null,
      },
      usage: planUsage(studioUsage(scope), plan),
      payments: payments.map((p) => ({ periodStart: p.period_start, periodEnd: p.period_end, amount: formatPLN(p.amount_grosze), paidAt: p.paid_at })),
      plans: PLANS.map((p) => ({ id: p.id, name: p.name, price: formatPLN(p.priceGrosze), limits: p.limits, featureLabels: p.features.map((f) => FEATURE_LABEL[f]) })),
    };
  });

  // Pasek w panelu: jedno zdanie o najpilniejszej sprawie abonamentu albo `null`.
  // Kolejność: zawieszone studio, nieudana płatność, trial ≤ 5 dni bez karty, przekroczony limit planu.
  app.get('/api/owner/billing/banner', owner, async (req): Promise<{ text: string; tone: 'info' | 'warn' } | null> => {
    const { studio, scope } = ctx(req);
    if (studio.status === 'suspended') return { text: 'Studio jest zawieszone – klientki nie mają teraz dostępu. Zobacz Abonament.', tone: 'warn' };
    const b = loadBilling(db, studio.id);
    const now = Date.now();
    if (b.state === 'past_due') {
      const graceEnd = new Date((b.past_due_since ? Date.parse(b.past_due_since) : now) + BILLING_GRACE_DAYS * DAY_MS).toISOString();
      return { text: `Płatność za GLAM nie przeszła – zaktualizuj kartę do ${shortDate(graceEnd)}`, tone: 'warn' };
    }
    const left = studio.trial_ends_at ? Date.parse(studio.trial_ends_at) - now : 0;
    if (left > 0 && left <= TRIAL_BANNER_DAYS * DAY_MS && !b.stripe_subscription_id) {
      const days = Math.ceil(left / DAY_MS);
      return { text: `Okres próbny kończy się za ${days === 1 ? '1 dzień' : `${days} dni`} – dodaj kartę, żeby studio działało dalej`, tone: 'info' };
    }
    const over = planUsage(studioUsage(scope), planById(studio.plan_id)).filter((u) => u.state === 'over');
    if (over.length) return { text: `Studio przekroczyło limit: ${over.map((u) => u.label).join(', ')}. Zobacz plany`, tone: 'warn' };
    return null;
  });

  // Dane do faktury – działają także bez Stripe (GLAM fakturuje sam, ze strony konsoli).
  app.put<{ Body: { companyName?: string; nip?: string; address?: string; invoiceEmail?: string } }>('/api/owner/billing/details', owner, async (req) => {
    const { studio } = ctx(req);
    const b = req.body ?? {};
    const companyName = String(b.companyName ?? '').trim();
    const nip = String(b.nip ?? '').replace(/[\s-]/g, '');
    const address = String(b.address ?? '').trim();
    const invoiceEmail = String(b.invoiceEmail ?? '').trim();
    if (companyName.length < 2 || companyName.length > 200) throw badRequest('Podaj nazwę firmy.');
    if (!validNip(nip)) throw badRequest('Sprawdź NIP – 10 cyfr.');
    if (address.length > 300) throw badRequest('Adres jest za długi.');
    if (invoiceEmail && !validEmail(invoiceEmail)) throw badRequest('Sprawdź adres e-mail do faktur.');
    loadBilling(db, studio.id);
    db.prepare('UPDATE studio_billing SET company_name = ?, nip = ?, address = ?, invoice_email = ?, updated_at = ? WHERE studio_id = ?').run(companyName, nip, address || null, invoiceEmail || null, nowIso(), studio.id);
    return { ok: true };
  });

  // Dodanie karty (pierwsza subskrypcja). Zmiana planu przy aktywnej subskrypcji idzie przez /plan.
  app.post<{ Body: { planId?: string } }>('/api/owner/billing/checkout', owner, async (req) => {
    requireConfigured();
    const { studio } = ctx(req);
    const planId = knownPlan(req.body?.planId);
    const b = loadBilling(db, studio.id);
    if (b.stripe_subscription_id) throw conflict('subscription_exists', 'Abonament jest już aktywny – zmień plan');
    if (!b.company_name || !b.nip) throw badRequest('Uzupełnij dane do faktury');
    return subscriptionCheckout(deps, { id: studio.id, trialEndsAt: studio.trial_ends_at }, b, planId, panelUrl());
  });

  app.post('/api/owner/billing/portal', owner, async (req) => {
    requireConfigured();
    const customer = loadBilling(db, ctx(req).studio.id).stripe_customer_id;
    if (!customer) throw conflict('no_customer', 'Najpierw dodaj kartę.');
    return billingPortal(deps, customer, `${panelUrl()}#settings`);
  });

  // Droższy plan – od razu, z dopłatą proporcjonalną; tańszy – od następnego okresu (`pending_plan_id`).
  // Wybór obecnego planu przy czekającym obniżeniu cofa to obniżenie.
  app.post<{ Body: { planId?: string } }>('/api/owner/billing/plan', owner, async (req) => {
    requireConfigured();
    const { studio } = ctx(req);
    const target = planById(knownPlan(req.body?.planId));
    const subscription = requireSubscription(studio.id);
    const current = planById(studio.plan_id);
    const pending = loadBilling(db, studio.id).pending_plan_id;
    if (target.id === current.id && !pending) throw badRequest('To już Twój plan.');
    const immediate = target.id === current.id || target.priceGrosze > current.priceGrosze;
    await changeSubscriptionPlan(deps, subscription, priceForPlan(deps, target.id), target.id !== current.id && immediate);
    tx(db, () => {
      if (immediate) db.prepare('UPDATE studios SET plan_id = ? WHERE id = ?').run(target.id, studio.id);
      db.prepare('UPDATE studio_billing SET pending_plan_id = ?, updated_at = ? WHERE studio_id = ?').run(immediate ? null : target.id, nowIso(), studio.id);
    });
    return { effective: immediate ? 'now' : 'next_period' };
  });

  for (const [path, cancel] of [['/api/owner/billing/cancel', true], ['/api/owner/billing/resume', false]] as const) {
    app.post(path, owner, async (req) => {
      requireConfigured();
      const { studio } = ctx(req);
      await setCancelAtPeriodEnd(deps, requireSubscription(studio.id), cancel);
      db.prepare('UPDATE studio_billing SET cancel_at_period_end = ?, updated_at = ? WHERE studio_id = ?').run(cancel ? 1 : 0, nowIso(), studio.id);
      return { ok: true };
    });
  }
}
