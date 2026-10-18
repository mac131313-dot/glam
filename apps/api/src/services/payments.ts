// Sprzedaż karnetów (4.2): kody rabatowe, zniżka dla powracających, pakiet startowy, płatność w bramce studia,
// karnet z kopią reguł, bonus za polecenie (decyzja 8), faktury na życzenie, odnowienia (C9).
import {
  applyCoupon,
  formatPLN,
  initialBalances,
  invoiceNumber,
  localParts,
  passValidity,
  referralBonusDue,
  vatSplit,
  type Coupon,
  type ProductRules,
} from '@glam/core';
import type { Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { PAYMENT_METHODS, type PaymentMethod } from '../sms.ts';
import { audit } from './audit.ts';
import { notify } from './notify.ts';
import { issuePass } from './passes.ts';
import { createCheckout, createCustomer, paymentIntentMethod, stripeGateway, type StripeGateway } from './stripe.ts';
import type { Studio } from './studio.ts';

type ProductRow = { id: string; name: string; version_id: string; price_grosze: number; rules_json: string; channels_json: string };

export function loadProduct(scope: StudioScope, productId: string): ProductRow {
  const p = scope.get<ProductRow>(
    `SELECT p.id, p.name, p.channels_json, v.id AS version_id, v.price_grosze, v.rules_json FROM products p JOIN product_versions v ON v.id = p.current_version_id
     WHERE p.studio_id = $studio AND p.id = $id AND p.published = 1`,
    { id: productId },
  );
  if (!p) throw notFound('Ten produkt nie jest już dostępny.');
  return p;
}

/** Klientka wraca po przerwie: ostatnia wizyta ponad 30 dni temu (albo zakup bez wizyt dawno temu). */
export function isReturning(scope: StudioScope, userId: string, now = new Date()): boolean {
  const last = scope.get<{ t: string | null }>(
    "SELECT MAX(s.starts_at) AS t FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = $u AND b.status = 'attended'",
    { u: userId },
  )?.t;
  return !!last && now.getTime() - Date.parse(last) > 30 * 86_400_000;
}

export function hasPurchased(scope: StudioScope, userId: string) {
  return !!scope.get("SELECT 1 FROM passes WHERE studio_id = $studio AND user_id = $user AND source IN ('purchase', 'desk', 'renewal')", { user: userId });
}

export type CouponRow = {
  id: string;
  code: string;
  label: string;
  kind: 'percent' | 'amount';
  value: number;
  applies_to: Coupon['appliesTo'];
  product_ids_json: string | null;
  max_uses: number | null;
  per_user: number;
  only_user_id: string | null;
  returning_only: number;
  first_purchase_only: number;
  valid_from: string | null;
  valid_to: string | null;
  active: number;
};

export function couponFor(scope: StudioScope, code: string): CouponRow | undefined {
  return scope.get<CouponRow>('SELECT * FROM coupons WHERE studio_id = $studio AND code = $code', { code: code.trim().toUpperCase() });
}

/** Wynik zastosowania kodu (lub błąd z czytelnym powodem). */
export function priceWithCoupon(
  scope: StudioScope,
  studio: Studio,
  input: { code?: string | null; userId: string; kind: Exclude<Coupon['appliesTo'], 'all'>; productId?: string; amountGrosze: number },
) {
  if (!input.code?.trim()) return { coupon: null, discount: 0, final: input.amountGrosze };
  const c = couponFor(scope, input.code);
  if (!c) throw badRequest('Nie znamy takiego kodu.');
  const used = scope.get<{ total: number; mine: number }>(
    'SELECT COUNT(*) AS total, SUM(CASE WHEN user_id = $u THEN 1 ELSE 0 END) AS mine FROM coupon_redemptions WHERE studio_id = $studio AND coupon_id = $c',
    { u: input.userId, c: c.id },
  )!;
  const res = applyCoupon(
    {
      code: c.code,
      kind: c.kind,
      value: c.value,
      appliesTo: c.applies_to,
      productIds: c.product_ids_json ? JSON.parse(c.product_ids_json) : null,
      maxUses: c.max_uses,
      perUser: c.per_user,
      onlyUserId: c.only_user_id,
      returningOnly: !!c.returning_only,
      firstPurchaseOnly: !!c.first_purchase_only,
      validFrom: c.valid_from,
      validTo: c.valid_to,
      active: !!c.active,
    },
    {
      kind: input.kind,
      productId: input.productId,
      amountGrosze: input.amountGrosze,
      userId: input.userId,
      usedTotal: used.total,
      usedByUser: used.mine ?? 0,
      isReturning: isReturning(scope, input.userId),
      hasPurchased: hasPurchased(scope, input.userId),
      today: localParts(new Date(), studio.timezone).date,
    },
  );
  if (!res.ok) throw badRequest(res.reason);
  return { coupon: c, discount: res.discountGrosze, final: res.finalGrosze };
}

export function recordPayment(
  scope: StudioScope,
  input: { userId: string | null; kind: 'pass' | 'guest_pass' | 'course' | 'event' | 'shop' | 'renewal'; ref: string | null; amount: number; discount?: number; method: string; providerRef?: string | null; description: string; couponId?: string | null },
) {
  const paymentId = id();
  scope.run(
    `INSERT INTO payments (id, studio_id, user_id, kind, reference_id, amount_grosze, discount_grosze, method, status, provider_ref, description, created_at)
     VALUES ($id, $studio, $user, $kind, $ref, $amount, $disc, $method, 'paid', $pref, $desc, $now)`,
    { id: paymentId, user: input.userId, kind: input.kind, ref: input.ref, amount: input.amount, disc: input.discount ?? 0, method: input.method, pref: input.providerRef ?? null, desc: input.description, now: nowIso() },
  );
  if (input.couponId && input.userId) {
    scope.run('INSERT INTO coupon_redemptions (id, studio_id, coupon_id, user_id, payment_id, discount_grosze, created_at) VALUES ($id, $studio, $c, $u, $p, $d, $now)', {
      id: id(),
      c: input.couponId,
      u: input.userId,
      p: paymentId,
      d: input.discount ?? 0,
      now: nowIso(),
    });
  }
  return paymentId;
}

/** Zakup karnetu: aplikacja (bramka studia), kasa (gotówka / terminal) albo link do płatności. */
type PassQuote = {
  productId: string;
  versionId: string;
  name: string;
  rules: ProductRules;
  price: number;
  discount: number;
  couponId: string | null;
  method: PaymentMethod;
  channel: 'app' | 'desk';
  actorId: string;
  autoRenew?: boolean;
  /** Link płatności z recepcji (/api/pay/:token) – oznaczany jako opłacony dopiero po zapłacie. */
  linkId?: string;
};

export async function purchaseProduct(
  deps: Deps,
  scope: StudioScope,
  studio: Studio,
  input: { userId: string; productId: string; method: PaymentMethod; couponCode?: string | null; channel: 'app' | 'desk'; actorId: string; autoRenew?: boolean; linkId?: string },
) {
  const product = loadProduct(scope, input.productId);
  const channels = JSON.parse(product.channels_json) as string[];
  if (!channels.includes(input.channel)) throw conflict('channel', input.channel === 'app' ? 'Ten produkt kupisz w recepcji studia.' : 'Ten produkt jest dostępny tylko w aplikacji.');
  const rules = JSON.parse(product.rules_json) as ProductRules;
  if (rules.introOnly && hasPurchased(scope, input.userId)) throw conflict('intro_only', 'Pakiet startowy jest dostępny tylko przy pierwszym zakupie.');

  let price = product.price_grosze;
  let discount = 0;
  if (rules.returningDiscountPct && isReturning(scope, input.userId)) {
    discount = Math.round((price * rules.returningDiscountPct) / 100);
    price -= discount;
  }
  const coupon = priceWithCoupon(scope, studio, { code: input.couponCode, userId: input.userId, kind: 'pass', productId: product.id, amountGrosze: price });
  price = coupon.final;
  discount += coupon.discount;

  const quote: PassQuote = {
    productId: product.id,
    versionId: product.version_id,
    name: product.name,
    rules,
    price,
    discount,
    couponId: coupon.coupon?.id ?? null,
    method: input.method,
    channel: input.channel,
    actorId: input.actorId,
    autoRenew: input.autoRenew,
    linkId: input.linkId,
  };

  // Studio z bramką Stripe: płatność online kończy się na stronie Checkout, karnet wydaje webhook.
  const gw = checkoutGateway(scope, studio.id, input.method, price);
  if (gw) return startPassCheckout(deps, scope, studio, gw, input.userId, quote);

  const charge = price > 0 ? await deps.payments.charge({ amountGrosze: price, method: input.method, description: product.name, studioId: studio.id }) : { status: 'paid' as const, ref: 'free' };
  if (charge.status !== 'paid') throw new HttpError(402, 'payment_failed', 'Płatność się nie powiodła. Spróbuj ponownie.');
  return fulfillPass(scope, studio, input.userId, quote, charge.ref);
}

export const ONLINE_METHODS = new Set<PaymentMethod>([...PAYMENT_METHODS, 'link']);

/** Bramka Stripe, jeśli ta płatność ma przejść przez Checkout (online, niezerowa kwota, studio ze Stripe). */
export function checkoutGateway(scope: StudioScope, studioId: string, method: PaymentMethod | undefined, amountGrosze: number) {
  return amountGrosze > 0 && method && ONLINE_METHODS.has(method) ? stripeGateway(scope.db, studioId) : null;
}

const passRenews = (q: PassQuote) => (q.rules.billing === 'once' ? false : (q.autoRenew ?? !!q.rules.autoRenew));

/** Karnet na koncie + płatność w historii. Wspólne dla płatności od razu i potwierdzenia z webhooka. */
function fulfillPass(scope: StudioScope, studio: Studio, userId: string, q: PassQuote, providerRef: string) {
  const firstPurchase = !hasPurchased(scope, userId);
  const v = passValidity(q.rules, new Date());
  const renews = passRenews(q);
  const passId = scope.tx(() => {
    // Karnet dostaje kopię reguł z bieżącej wersji produktu (C5).
    const passId = issuePass(scope, {
      userId,
      versionId: q.versionId,
      name: q.name,
      rules: q.rules,
      balances: initialBalances(q.rules),
      validFrom: v.validFrom,
      validUntil: v.validUntil,
      source: q.channel === 'desk' ? 'desk' : 'purchase',
      autoRenew: renews,
    });
    recordPayment(scope, { userId, kind: 'pass', ref: passId, amount: q.price, discount: q.discount, method: q.method, providerRef, description: q.name, couponId: q.couponId });
    if (q.channel === 'desk') audit(scope, { actorId: q.actorId, action: 'pass.sold_at_desk', entity: 'pass', entityId: passId, subjectUserId: userId, details: { product: q.name, method: q.method } });
    if (q.linkId) scope.run("UPDATE payment_links SET status = 'paid' WHERE studio_id = $studio AND id = $id", { id: q.linkId });
    if (firstPurchase) referralPurchase(scope, studio, userId);
    return passId;
  });
  return { passId, renews, price: formatPLN(q.price), discount: formatPLN(q.discount), message: renews ? `${q.name} jest już na Twoim koncie. Odnowi się automatycznie – możesz to wyłączyć w Profilu.` : `${q.name} jest już na Twoim koncie.` };
}

// ——— Stripe Checkout: wspólny mechanizm dla wszystkich zakupów online ———

export type CheckoutKind = 'pass' | 'shop' | 'course' | 'course_web' | 'event' | 'guest_pass';

/** Wynik wydania: ref trafia do checkout_sessions.result_ref, message do powiadomienia i ekranu powrotu. */
export type Fulfilled = { ref: string; message: string; action?: string; after?: () => Promise<void> };

/**
 * Jak wydać dany rodzaj zakupu po zapłacie. `payload` to wycena zapisana przy starcie Checkout –
 * po zapłacie nie liczymy ceny od nowa. `release` oddaje to, co zostało zablokowane (np. sztuki w sklepie).
 */
export type CheckoutFulfiller<P = any> = {
  fulfill(deps: Deps, scope: StudioScope, studio: Studio, userId: string | null, payload: P, providerRef: string): Fulfilled;
  release?(scope: StudioScope, payload: P): void;
};

const FULFILLERS = new Map<CheckoutKind, CheckoutFulfiller>();

/** Każdy moduł sprzedaży rejestruje swój rodzaj przy imporcie (sklep, kursy, wydarzenia…). */
export function registerCheckoutKind<P>(kind: CheckoutKind, f: CheckoutFulfiller<P>) {
  FULFILLERS.set(kind, f);
}

registerCheckoutKind<PassQuote>('pass', {
  fulfill(deps, scope, studio, userId, q, providerRef) {
    const res = fulfillPass(scope, studio, userId!, q, providerRef);
    return { ref: res.passId, message: res.message, action: 'profile/passes', after: res.renews ? () => rememberCard(deps, scope, studio.id, userId!, providerRef) : undefined };
  },
});

/** Subskrypcja: Stripe zapisał kartę przy Checkout – zapamiętujemy ją do odnowień off_session. */
async function rememberCard(deps: Deps, scope: StudioScope, studioId: string, userId: string, paymentIntentId: string) {
  const gw = stripeGateway(scope.db, studioId);
  if (!gw || !paymentIntentId.startsWith('pi_')) return;
  const pm = await paymentIntentMethod(deps.http ?? fetch, gw, paymentIntentId).catch(() => null);
  if (pm) scope.run('UPDATE stripe_customers SET payment_method_id = $pm, updated_at = $now WHERE studio_id = $studio AND user_id = $u', { pm, u: userId, now: nowIso() });
}

/** Klientka Stripe dla subskrypcji: jedna na studio, bo każde studio ma własne konto Stripe. */
async function stripeCustomer(deps: Deps, scope: StudioScope, gw: StripeGateway, userId: string, email: string | null | undefined) {
  const known = scope.get<{ customer_id: string }>('SELECT customer_id FROM stripe_customers WHERE studio_id = $studio AND user_id = $u', { u: userId });
  if (known) return known.customer_id;
  const name = (scope.db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string | null } | undefined)?.name;
  const customer = await createCustomer(deps.http ?? fetch, gw, { email, name, metadata: { studio: scope.studioId, user: userId } });
  scope.run('INSERT INTO stripe_customers (studio_id, user_id, customer_id, payment_method_id, updated_at) VALUES ($studio, $u, $c, NULL, $now)', { u: userId, c: customer.id, now: nowIso() });
  return customer.id;
}

/**
 * Start płatności na stronie Stripe Checkout. Zakup czeka w checkout_sessions, aż webhook potwierdzi zapłatę.
 * `back` to ścieżka powrotu (domyślnie /app – ClientApp czyta ?checkout= i pokazuje wynik).
 */
export async function startCheckout(
  deps: Deps,
  scope: StudioScope,
  studio: Studio,
  gw: StripeGateway,
  input: { kind: CheckoutKind; userId: string | null; name: string; amountGrosze: number; method: PaymentMethod; payload: object; back?: string; email?: string | null; saveCard?: boolean },
) {
  const base = deps.publicUrl ?? 'http://localhost:5173';
  const email = input.email !== undefined ? input.email : input.userId ? (scope.db.prepare('SELECT email FROM users WHERE id = ?').get(input.userId) as { email: string | null } | undefined)?.email : null;
  const back = `${base}${input.back ?? '/app'}`;
  const customer = input.saveCard && input.userId ? await stripeCustomer(deps, scope, gw, input.userId, email) : undefined;
  const session = await createCheckout(deps.http ?? fetch, gw, {
    amountGrosze: input.amountGrosze,
    name: input.name,
    method: input.method,
    email,
    customer,
    successUrl: `${back}?checkout={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${back}?checkout=cancelled`,
    metadata: { studio: studio.id, user: input.userId ?? '', kind: input.kind },
  });
  scope.run(
    'INSERT INTO checkout_sessions (id, studio_id, user_id, kind, payload_json, amount_grosze, status, created_at) VALUES ($id, $studio, $u, $k, $p, $a, \'open\', $now)',
    { id: session.id, u: input.userId, k: input.kind, p: JSON.stringify({ ...input.payload, name: input.name }), a: input.amountGrosze, now: nowIso() },
  );
  return { checkoutUrl: session.url, checkoutId: session.id, message: 'Przechodzisz do płatności…' };
}

async function startPassCheckout(deps: Deps, scope: StudioScope, studio: Studio, gw: StripeGateway, userId: string, q: PassQuote) {
  // Subskrypcja: Checkout zapisuje kartę (setup_future_usage), żeby job mógł odnowić okres bez klientki.
  return startCheckout(deps, scope, studio, gw, { kind: 'pass', userId, name: q.name, amountGrosze: q.price, method: q.method, payload: q, saveCard: passRenews(q) });
}

/**
 * Webhook Stripe: sesja opłacona → wydanie towaru. Idempotentnie – Stripe ponawia zdarzenia,
 * a status 'open' → 'paid' zmienia się tylko raz, w tej samej transakcji co wydanie.
 * Nieudana albo wygasła sesja oddaje to, co było zablokowane (np. sztuki w sklepie).
 */
export async function completeCheckout(deps: Deps, scope: StudioScope, studio: Studio, sessionId: string, outcome: 'paid' | 'failed' | 'expired', providerRef: string | null) {
  const res = scope.tx(() => {
    const row = scope.get<{ user_id: string | null; kind: CheckoutKind; payload_json: string; status: string }>('SELECT user_id, kind, payload_json, status FROM checkout_sessions WHERE studio_id = $studio AND id = $id', { id: sessionId });
    if (!row || row.status !== 'open') return null;
    const f = FULFILLERS.get(row.kind);
    if (!f) throw new Error(`Brak obsługi Checkout dla rodzaju ${row.kind}`);
    const payload = JSON.parse(row.payload_json);
    if (outcome !== 'paid') {
      f.release?.(scope, payload);
      scope.run('UPDATE checkout_sessions SET status = $s WHERE studio_id = $studio AND id = $id', { s: outcome, id: sessionId });
      return null;
    }
    const done = f.fulfill(deps, scope, studio, row.user_id, payload, providerRef ?? sessionId);
    scope.run("UPDATE checkout_sessions SET status = 'paid', provider_ref = $r, result_ref = $p, result_message = $m WHERE studio_id = $studio AND id = $id", { r: providerRef, p: done.ref, m: done.message, id: sessionId });
    if (row.user_id) notify(scope, { userId: row.user_id, category: 'transactional', tz: studio.timezone, now: new Date(), body: done.message, action: done.action });
    return done;
  });
  // SMS-y i wywołania do Stripe po zatwierdzeniu transakcji – ich błąd nie cofa już wydanego towaru.
  await res?.after?.().catch((err) => console.warn('Checkout: krok po wydaniu nie powiódł się', err));
  return res;
}

export type CheckoutRow = { kind: string; status: string; payload_json: string; result_message: string | null };

/** Stan sesji Checkout dla ekranu powrotu (aplikacja albo strona kursu na www). */
export function checkoutStatus(row: CheckoutRow) {
  const name = (JSON.parse(row.payload_json) as { name: string }).name;
  const message =
    row.status === 'paid' ? (row.result_message ?? `${name} – opłacone.`) : row.status === 'open' ? 'Czekamy na potwierdzenie płatności…' : 'Płatność się nie udała. Możesz spróbować jeszcze raz.';
  return { kind: row.kind, status: row.status, message };
}

/** Pierwszy karnet znajomej z polecenia → bonus dla zapraszającej (max X miesięcznie). */
export function referralPurchase(scope: StudioScope, studio: Studio, inviteeId: string, now = new Date()) {
  const ref = scope.get<{ id: string; inviter_id: string; bonus_granted: number }>(
    "SELECT id, inviter_id, bonus_granted FROM referrals WHERE studio_id = $studio AND invitee_id = $u AND status != 'purchased'",
    { u: inviteeId },
  );
  if (!ref) return;
  const rules = studio.settings.referral;
  const monthStart = `${localParts(now, studio.timezone).date.slice(0, 7)}-01`;
  const bonuses = scope.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM passes WHERE studio_id = $studio AND user_id = $u AND source = 'referral' AND created_at >= $from",
    { u: ref.inviter_id, from: monthStart },
  )!.n;
  scope.run("UPDATE referrals SET status = 'purchased', updated_at = $now WHERE studio_id = $studio AND id = $id", { id: ref.id, now: now.toISOString() });
  const name = (scope.db.prepare('SELECT name FROM users WHERE id = ?').get(inviteeId) as { name: string | null }).name ?? 'Twoja znajoma';
  if (!referralBonusDue(rules, { bonusesThisMonth: bonuses, alreadyGranted: !!ref.bonus_granted })) return;
  const bonusRules: ProductRules = { validityDays: rules.bonusValidityDays, pools: [{ id: 'bonus', label: 'Bonus za polecenie', entries: rules.inviterBonusEntries, classTypeIds: 'all' }] };
  const v = passValidity(bonusRules, now);
  issuePass(scope, { userId: ref.inviter_id, versionId: null, name: 'Bonus za polecenie', rules: bonusRules, balances: initialBalances(bonusRules), validFrom: v.validFrom, validUntil: v.validUntil, source: 'referral' });
  scope.run('UPDATE referrals SET bonus_granted = 1 WHERE studio_id = $studio AND id = $id', { id: ref.id });
  notify(scope, { userId: ref.inviter_id, category: 'community', tz: studio.timezone, now, body: `${name} kupiła karnet – wejście w prezencie czeka na Twoim koncie 💛`, action: 'profile/passes' });
}

/** Faktura na życzenie klientki (4.2) albo zbiorczo z panelu. Kwoty brutto → netto + VAT ze stawki studia. */
export function issueInvoice(scope: StudioScope, studio: Studio, paymentId: string, buyer: { name: string; nip?: string | null; address?: string | null; email?: string | null }, now = new Date()) {
  return scope.tx(() => {
    const p = scope.get<{ id: string; user_id: string | null; amount_grosze: number; description: string | null; kind: string; invoice_id: string | null; created_at: string }>(
      'SELECT * FROM payments WHERE studio_id = $studio AND id = $id',
      { id: paymentId },
    );
    if (!p) throw notFound('Nie znaleziono płatności.');
    if (p.invoice_id) return scope.get<Record<string, unknown>>('SELECT * FROM invoices WHERE studio_id = $studio AND id = $id', { id: p.invoice_id })!;
    // Merch: aplikacja nie wystawia dokumentów sprzedaży (4.8.1) – rozliczenie po stronie studia.
    if (p.kind === 'shop') throw conflict('no_invoice', 'Za produkty ze sklepu studio wystawia dokumenty samodzielnie.');
    const local = localParts(now, studio.timezone).date;
    const seq = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM invoices WHERE studio_id = $studio AND substr(number, -12, 7) = $ym", { ym: local.slice(0, 7).replace('-', '/') })!.n + 1;
    const inv = studio.settings.invoice;
    const split = vatSplit(p.amount_grosze, inv.vatRate);
    const invoiceId = id();
    const number = invoiceNumber(inv.prefix, local, seq);
    scope.run(
      `INSERT INTO invoices (id, studio_id, user_id, number, issued_at, seller_json, buyer_json, items_json, net_grosze, vat_grosze, gross_grosze, payment_id)
       VALUES ($id, $studio, $u, $num, $at, $seller, $buyer, $items, $net, $vat, $gross, $pay)`,
      {
        id: invoiceId,
        u: p.user_id,
        num: number,
        at: now.toISOString(),
        seller: JSON.stringify({ name: inv.sellerName || studio.name, address: inv.sellerAddress || studio.address, nip: studio.nip }),
        buyer: JSON.stringify(buyer),
        items: JSON.stringify([{ name: p.description ?? 'Usługa', qty: 1, vatRate: inv.vatRate, net: split.net, vat: split.vat, gross: split.gross }]),
        net: split.net,
        vat: split.vat,
        gross: split.gross,
        pay: p.id,
      },
    );
    scope.run('UPDATE payments SET invoice_id = $i WHERE studio_id = $studio AND id = $id', { i: invoiceId, id: p.id });
    return scope.get<Record<string, unknown>>('SELECT * FROM invoices WHERE studio_id = $studio AND id = $id', { id: invoiceId })!;
  });
}
