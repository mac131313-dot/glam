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
import type { PaymentMethod } from '../sms.ts';
import { audit } from './audit.ts';
import { notify } from './notify.ts';
import { issuePass } from './passes.ts';
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
export async function purchaseProduct(
  deps: Deps,
  scope: StudioScope,
  studio: Studio,
  input: { userId: string; productId: string; method: PaymentMethod; couponCode?: string | null; channel: 'app' | 'desk'; actorId: string; autoRenew?: boolean },
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

  const charge = price > 0 ? await deps.payments.charge({ amountGrosze: price, method: input.method, description: product.name, studioId: studio.id }) : { status: 'paid' as const, ref: 'free' };
  if (charge.status !== 'paid') throw new HttpError(402, 'payment_failed', 'Płatność się nie powiodła. Spróbuj ponownie.');

  const firstPurchase = !hasPurchased(scope, input.userId);
  const v = passValidity(rules, new Date());
  const passId = scope.tx(() => {
    // Karnet dostaje kopię reguł z bieżącej wersji produktu (C5).
    const passId = issuePass(scope, {
      userId: input.userId,
      versionId: product.version_id,
      name: product.name,
      rules,
      balances: initialBalances(rules),
      validFrom: v.validFrom,
      validUntil: v.validUntil,
      source: input.channel === 'desk' ? 'desk' : 'purchase',
      autoRenew: rules.billing === 'once' ? false : (input.autoRenew ?? !!rules.autoRenew),
    });
    recordPayment(scope, { userId: input.userId, kind: 'pass', ref: passId, amount: price, discount, method: input.method, providerRef: charge.ref, description: product.name, couponId: coupon.coupon?.id });
    if (input.channel === 'desk') audit(scope, { actorId: input.actorId, action: 'pass.sold_at_desk', entity: 'pass', entityId: passId, subjectUserId: input.userId, details: { product: product.name, method: input.method } });
    if (firstPurchase) referralPurchase(scope, studio, input.userId);
    return passId;
  });
  const renews = rules.billing === 'once' ? false : (input.autoRenew ?? !!rules.autoRenew);
  return { passId, renews, price: formatPLN(price), discount: formatPLN(discount), message: renews ? `${product.name} jest już na Twoim koncie. Odnowi się automatycznie – możesz to wyłączyć w Profilu.` : `${product.name} jest już na Twoim koncie.` };
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
