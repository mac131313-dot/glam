// Zwroty z panelu (przypadkowy zakup) i wyjątkowa podmiana karnetu. Tylko właścicielka (finance.refund).
// Anulowanie przez klientkę to co innego: wyłącza odnawianie, opłacony okres i wejścia zostają (client.ts, cancel-renewal).
// Pieniądze wracają przez bramkę studia jej kluczem – GLAM dalej w nich nie pośredniczy (decyzja 23).
import { formatPLN, initialBalances, passValidity, suggestPassRefund, type ProductRules } from '@glam/core';
import type { Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { audit } from './audit.ts';
import { cancelBooking } from './booking.ts';
import { notify } from './notify.ts';
import { issuePass, type PassRow } from './passes.ts';
import { loadProduct } from './payments.ts';
import { createRefund, stripeGateway } from './stripe.ts';
import type { Studio } from './studio.ts';

type PaymentRow = { id: string; user_id: string | null; kind: string; reference_id: string | null; amount_grosze: number; method: string; status: string; provider_ref: string | null; description: string | null };

const MANUAL_METHODS = new Set(['cash', 'terminal']);
const PASS_KINDS = new Set(['pass', 'renewal']);

function loadPayment(scope: StudioScope, paymentId: string) {
  const p = scope.get<PaymentRow>('SELECT id, user_id, kind, reference_id, amount_grosze, method, status, provider_ref, description FROM payments WHERE studio_id = $studio AND id = $id', { id: paymentId });
  if (!p) throw notFound('Nie znaleziono płatności.');
  return p;
}

/** Zwroty zlecone i wykonane. 'pending' też się liczy – inaczej dwa szybkie kliknięcia przekroczyłyby wpłatę. */
export function refundedSoFar(scope: StudioScope, paymentId: string): number {
  return scope.get<{ n: number }>("SELECT COALESCE(SUM(amount_grosze), 0) AS n FROM refunds WHERE studio_id = $studio AND payment_id = $p AND status IN ('pending', 'succeeded')", { p: paymentId })!.n;
}

function activePass(scope: StudioScope, payment: PaymentRow) {
  if (!PASS_KINDS.has(payment.kind) || !payment.reference_id) return null;
  return scope.get<PassRow>("SELECT * FROM passes WHERE studio_id = $studio AND id = $id AND status IN ('active', 'frozen', 'pending')", { id: payment.reference_id }) ?? null;
}

/** Co pokazać w formularzu zwrotu: ile można oddać, ile podpowiadamy i czy karnet się zakończy. */
export function refundQuote(scope: StudioScope, paymentId: string, now = new Date()) {
  const payment = loadPayment(scope, paymentId);
  const refunded = refundedSoFar(scope, paymentId);
  const max = payment.status === 'paid' ? Math.max(0, payment.amount_grosze - refunded) : 0;
  const pass = activePass(scope, payment);
  let suggested = max;
  if (pass) {
    const used = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM bookings WHERE studio_id = $studio AND pass_id = $p AND status IN ('attended', 'late_cancel', 'no_show')", { p: pass.id })!.n;
    const raw = suggestPassRefund(
      { remainingGrosze: max, rules: JSON.parse(pass.rules_json) as ProductRules, balances: JSON.parse(pass.balances_json), validFrom: pass.valid_from, validUntil: pass.valid_until, used },
      now,
    );
    suggested = Math.min(max, Math.max(0, Math.round(raw)));
  }
  return {
    payment,
    paidGrosze: payment.amount_grosze,
    refundedGrosze: refunded,
    maxGrosze: max,
    suggestedGrosze: suggested,
    passId: pass?.id ?? null,
    passName: pass?.product_name ?? null,
    channel: MANUAL_METHODS.has(payment.method) ? ('manual' as const) : ('gateway' as const),
  };
}

/**
 * Koniec karnetu po zwrocie albo podmianie: przyszłe rezerwacje zwolnione (miejsce dla listy oczekujących),
 * bez odnawiania. Karnet zostaje w historii jako „anulowany”, nie znika jak przy cofnięciu sprzedaży z recepcji.
 */
export function endPass(scope: StudioScope, studio: Studio, passId: string, actorId: string | null, now = new Date()) {
  scope.tx(() => {
    const pass = scope.get<{ user_id: string }>('SELECT user_id FROM passes WHERE studio_id = $studio AND id = $id', { id: passId });
    if (!pass) return;
    const future = scope.all<{ id: string }>(
      "SELECT b.id FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.pass_id = $p AND b.status IN ('booked', 'waitlist') AND s.starts_at > $now",
      { p: passId, now: now.toISOString() },
    );
    for (const b of future) cancelBooking(scope, studio, b.id, { userId: actorId ?? pass.user_id, isStaff: true }, now);
    scope.run("UPDATE passes SET status = 'cancelled', auto_renew = 0 WHERE studio_id = $studio AND id = $id", { id: passId });
  });
}

export async function refundPayment(
  deps: Deps,
  scope: StudioScope,
  studio: Studio,
  input: { paymentId: string; amountGrosze: number; reason?: string | null; actorId: string; endPass?: boolean },
) {
  const q = refundQuote(scope, input.paymentId);
  const amount = Math.round(input.amountGrosze);
  if (!Number.isFinite(amount) || amount <= 0) throw badRequest('Podaj kwotę zwrotu.');
  if (q.maxGrosze === 0) throw conflict('nothing_to_refund', 'Ta płatność została już w całości zwrócona.');
  if (amount > q.maxGrosze) throw badRequest(`Zwrócić można najwyżej ${formatPLN(q.maxGrosze)}.`);

  const refundId = id();
  scope.run(
    "INSERT INTO refunds (id, studio_id, payment_id, amount_grosze, reason, status, channel, actor_id, created_at) VALUES ($id, $studio, $p, $a, $r, 'pending', $c, $u, $now)",
    { id: refundId, p: q.payment.id, a: amount, r: input.reason?.trim() || null, c: q.channel, u: input.actorId, now: nowIso() },
  );

  let providerRef: string | null = null;
  if (q.channel === 'gateway') {
    const result = await sendToGateway(deps, scope, studio, q.payment, amount, refundId);
    if (!result.ok) {
      scope.run("UPDATE refunds SET status = 'failed' WHERE studio_id = $studio AND id = $id", { id: refundId });
      throw new HttpError(502, 'refund_failed', 'Bramka nie przyjęła zwrotu. Sprawdź płatność w panelu bramki albo spróbuj za chwilę.', { gateway: result.error });
    }
    providerRef = result.ref;
  }

  const ends = (input.endPass ?? true) && !!q.passId;
  scope.tx(() => {
    scope.run("UPDATE refunds SET status = 'succeeded', provider_ref = $r WHERE studio_id = $studio AND id = $id", { id: refundId, r: providerRef });
    if (ends) endPass(scope, studio, q.passId!, input.actorId);
    audit(scope, {
      actorId: input.actorId,
      action: 'payment.refunded',
      entity: 'payment',
      entityId: q.payment.id,
      subjectUserId: q.payment.user_id,
      details: { amount, channel: q.channel, reason: input.reason ?? null, passEnded: ends },
    });
    if (q.payment.user_id) {
      const what = ends ? `Karnet „${q.passName}” został anulowany, a ` : '';
      const how = q.channel === 'manual' ? 'odbierzesz w recepcji studia.' : 'wraca tą samą metodą, którą płaciłaś – zwykle w kilka dni roboczych.';
      notify(scope, { userId: q.payment.user_id, category: 'transactional', tz: studio.timezone, now: new Date(), body: `${what}${ends ? 'z' : 'Z'}wrot ${formatPLN(amount)} ${how}`, action: 'profile/passes' });
    }
  });

  const left = q.maxGrosze - amount;
  return {
    refundId,
    amount: formatPLN(amount),
    passEnded: ends,
    message:
      q.channel === 'manual'
        ? `Zapisane: zwrot ${formatPLN(amount)} do wydania klientce (${q.payment.method === 'cash' ? 'gotówka' : 'terminal'}).`
        : `Zwrot ${formatPLN(amount)} zlecony w bramce.${left > 0 ? ` Do zwrotu zostaje jeszcze ${formatPLN(left)}.` : ''}`,
  };
}

async function sendToGateway(deps: Deps, scope: StudioScope, studio: Studio, payment: PaymentRow, amount: number, refundId: string): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
  const gw = stripeGateway(scope.db, studio.id);
  if (gw) {
    if (!payment.provider_ref?.startsWith('pi_')) return { ok: false, error: 'Ta płatność nie przeszła przez Stripe – zwróć ją w panelu bramki, którą była opłacona.' };
    return createRefund(deps.http ?? fetch, gw, { paymentIntentId: payment.provider_ref, amountGrosze: amount, refundId, metadata: { studio: studio.id, payment: payment.id } });
  }
  // Inne bramki (P24, PayU, Tpay) i demo – przez dostawcę z deps; bez tej metody zwrot robi się w panelu bramki.
  if (!deps.payments.refund || !payment.provider_ref) return { ok: false, error: 'Ta bramka nie obsługuje zwrotów z panelu GLAM – zrób go w panelu bramki.' };
  const r = await deps.payments.refund(payment.provider_ref, amount);
  return r.status === 'refunded' ? { ok: true, ref: null } : { ok: false, error: 'refund_failed' };
}

/**
 * Webhook charge.refunded: Stripe podaje łączną kwotę zwrotów. Dopisujemy tylko różnicę – zwrot zlecony z GLAM
 * już ma swój wiersz ('pending' albo 'succeeded'), więc nie liczy się drugi raz. Pełny zwrot kończy karnet.
 */
export function syncGatewayRefund(scope: StudioScope, studio: Studio, paymentIntentId: string, amountRefundedTotal: number) {
  return scope.tx(() => {
    const payment = scope.get<PaymentRow>("SELECT id, user_id, kind, reference_id, amount_grosze, method, status, provider_ref, description FROM payments WHERE studio_id = $studio AND provider_ref = $r AND status = 'paid'", { r: paymentIntentId });
    if (!payment) return null;
    const diff = amountRefundedTotal - refundedSoFar(scope, payment.id);
    if (diff <= 0) return null;
    scope.run(
      "INSERT INTO refunds (id, studio_id, payment_id, amount_grosze, reason, status, channel, created_at) VALUES ($id, $studio, $p, $a, 'Zwrot w panelu bramki', 'succeeded', 'external', $now)",
      { id: id(), p: payment.id, a: diff, now: nowIso() },
    );
    const pass = activePass(scope, payment);
    const full = amountRefundedTotal >= payment.amount_grosze;
    if (full && pass) endPass(scope, studio, pass.id, null);
    audit(scope, { actorId: null, action: 'payment.refunded_externally', entity: 'payment', entityId: payment.id, subjectUserId: payment.user_id, details: { amount: diff, passEnded: full && !!pass } });
    return { amount: diff };
  });
}

/**
 * Wyjątkowa podmiana karnetu (np. kupiony na złe zajęcia): nowy karnet od dziś, stary anulowany,
 * płatność przypięta do nowego. Różnica na minus może wrócić zwrotem; na plus – dopłata w recepcji.
 */
export async function swapPass(deps: Deps, scope: StudioScope, studio: Studio, input: { userId: string; passId: string; productId: string; actorId: string; refundDifference: boolean }) {
  const old = scope.get<PassRow>("SELECT * FROM passes WHERE studio_id = $studio AND id = $id AND user_id = $u AND status IN ('active', 'frozen', 'pending')", { id: input.passId, u: input.userId });
  if (!old) throw notFound('Ten karnet nie jest już aktywny.');
  const product = loadProduct(scope, input.productId);
  if (product.version_id === old.product_version_id) throw badRequest('To ten sam karnet – wybierz inny.');
  const payment = scope.get<{ id: string }>("SELECT id FROM payments WHERE studio_id = $studio AND kind IN ('pass', 'renewal') AND reference_id = $p AND status = 'paid' ORDER BY created_at DESC", { p: old.id });
  const credit = payment ? refundQuote(scope, payment.id).maxGrosze : 0;
  const diff = product.price_grosze - credit;

  // Najpierw pieniądze (może się nie udać), potem zamiana – wtedy błąd bramki nie zostawia pół-podmiany.
  let refund: Awaited<ReturnType<typeof refundPayment>> | null = null;
  if (diff < 0 && input.refundDifference && payment) {
    refund = await refundPayment(deps, scope, studio, { paymentId: payment.id, amountGrosze: -diff, reason: `Różnica po podmianie na „${product.name}”`, actorId: input.actorId, endPass: false });
  }

  const rules = JSON.parse(product.rules_json) as ProductRules;
  const v = passValidity(rules, new Date());
  const newPassId = scope.tx(() => {
    endPass(scope, studio, old.id, input.actorId);
    const newPassId = issuePass(scope, {
      userId: input.userId,
      versionId: product.version_id,
      name: product.name,
      rules,
      balances: initialBalances(rules),
      validFrom: v.validFrom,
      validUntil: v.validUntil,
      source: old.source,
      autoRenew: !!old.auto_renew && rules.billing !== 'once' && !!rules.autoRenew,
    });
    if (payment) scope.run('UPDATE payments SET reference_id = $n, description = $d WHERE studio_id = $studio AND id = $id', { n: newPassId, d: `${old.product_name} → ${product.name}`, id: payment.id });
    audit(scope, { actorId: input.actorId, action: 'pass.swapped', entity: 'pass', entityId: newPassId, subjectUserId: input.userId, details: { from: old.product_name, to: product.name, difference: diff } });
    notify(scope, { userId: input.userId, category: 'transactional', tz: studio.timezone, now: new Date(), body: `Zamiast „${old.product_name}” masz teraz „${product.name}”. Ważny od dziś.`, action: 'profile/passes' });
    return newPassId;
  });

  // Reszta wpłaty pokrywa teraz nowy karnet – dlatego tu bez „do zwrotu zostaje”.
  const tail = diff > 0 ? ` Do dopłaty ${formatPLN(diff)} – sprzedaj różnicę w recepcji.` : refund ? ` Różnica ${refund.amount} wraca do klientki.` : diff < 0 ? ` Różnica ${formatPLN(-diff)} zostaje bez zwrotu.` : '';
  return { passId: newPassId, differenceGrosze: diff, message: `Karnet podmieniony na „${product.name}”.${tail}` };
}
