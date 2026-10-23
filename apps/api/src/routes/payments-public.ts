// Publiczne trasy płatności i kalendarza (bez konsoli platformy): prywatny adres .ics telefonu (4.1), link do płatności
// z recepcji (4.11), webhooki bramek studia i Stripe oraz powrót z Checkout.
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { formatPLN, toIcs } from '@glam/core';
import { ctx, requireStudio, type Deps } from '../context.ts';
import { unseal } from '../crypto.ts';
import { HttpError, forbidden, notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { checkoutStatus, completeCheckout, purchaseProduct, type CheckoutRow } from '../services/payments.ts';
import { syncGatewayRefund } from '../services/refunds.ts';
import { stripeGateway, verifyStripeSignature } from '../services/stripe.ts';
import { loadStudio } from '../services/studio.ts';

export function paymentsPublicRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  // ——— Kalendarz telefonu (4.1): prywatny adres .ics ze wszystkimi zajęciami i wydarzeniami ———

  app.get<{ Params: { token: string } }>('/api/calendar/:token', async (req, reply) => {
    const token = req.params.token.replace(/\.ics$/, '');
    const user = db.prepare('SELECT id, name FROM users WHERE calendar_token = ?').get(token) as { id: string; name: string | null } | undefined;
    if (!user) throw notFound();
    const rows = db
      .prepare(
        `SELECT b.id, b.status, s.starts_at, s.ends_at, COALESCE(s.title, ct.name) AS class_name, u.name AS trainer, st.name AS studio, st.address
         FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id JOIN users u ON u.id = s.trainer_id JOIN studios st ON st.id = b.studio_id
         WHERE b.user_id = ? AND b.guest_name IS NULL AND b.status IN ('booked', 'waitlist', 'attended', 'cancelled') AND s.starts_at > ?`,
      )
      .all(user.id, new Date(Date.now() - 30 * 86_400_000).toISOString()) as { id: string; status: string; starts_at: string; ends_at: string; class_name: string; trainer: string; studio: string; address: string | null }[];
    const events = db
      .prepare("SELECT e.id, e.starts_at, e.ends_at, e.kind, e.status, st.name AS studio, st.address FROM private_events e JOIN studios st ON st.id = e.studio_id WHERE e.client_id = ? AND e.status IN ('confirmed', 'paid', 'cancelled')")
      .all(user.id) as { id: string; starts_at: string; ends_at: string; kind: string; status: string; studio: string; address: string | null }[];
    const ics = toIcs('GLAM – moje zajęcia', [
      ...rows.map((r) => ({ uid: r.id, start: r.starts_at, end: r.ends_at, title: `${r.class_name}${r.status === 'waitlist' ? ' (lista oczekujących)' : ''}`, location: [r.studio, r.address].filter(Boolean).join(', '), description: `Prowadzi ${r.trainer}`, cancelled: r.status === 'cancelled' })),
      ...events.map((e) => ({ uid: e.id, start: e.starts_at, end: e.ends_at, title: 'Wydarzenie w studiu', location: [e.studio, e.address].filter(Boolean).join(', '), cancelled: e.status === 'cancelled' })),
    ]);
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('cache-control', 'private, max-age=900').send(ics);
  });

  // ——— Link do płatności z recepcji (4.11): klientka płaci w bramce studia, karnet trafia na konto ———

  app.get<{ Params: { token: string } }>('/api/pay/:token', async (req) => {
    const l = db
      .prepare("SELECT l.*, p.name AS product, v.price_grosze, s.name AS studio FROM payment_links l JOIN products p ON p.id = l.product_id JOIN product_versions v ON v.id = p.current_version_id JOIN studios s ON s.id = l.studio_id WHERE l.token = ?")
      .get(req.params.token) as { status: string; expires_at: string; product: string; price_grosze: number; studio: string } | undefined;
    if (!l) throw notFound('Link nie istnieje.');
    return { studio: l.studio, product: l.product, price: formatPLN(l.price_grosze), status: Date.parse(l.expires_at) < Date.now() && l.status === 'open' ? 'expired' : l.status };
  });

  app.post<{ Params: { token: string }; Body: { method: 'blik' | 'apple_pay' | 'google_pay' | 'p24' | 'card' } }>('/api/pay/:token', async (req) => {
    const l = db.prepare("SELECT * FROM payment_links WHERE token = ? AND status = 'open'").get(req.params.token) as { id: string; studio_id: string; user_id: string; product_id: string; created_by: string; expires_at: string } | undefined;
    if (!l || Date.parse(l.expires_at) < Date.now()) throw new HttpError(410, 'expired', 'Ten link wygasł. Poproś recepcję o nowy.');
    const studio = loadStudio(db, l.studio_id);
    const scope = new StudioScope(db, studio.id);
    // Link oznacza się jako opłacony razem z wydaniem karnetu – od razu albo po webhooku Stripe.
    return purchaseProduct(deps, scope, studio, { userId: l.user_id, productId: l.product_id, method: req.body?.method, channel: 'desk', actorId: l.created_by, linkId: l.id });
  });

  // Webhook bramki studia (decyzja 23) – podpis sprawdzany kluczem CRC studia (schemat Przelewy24: SHA-384).
  app.post<{ Params: { studioId: string }; Body: { sessionId: string; orderId: number; amount: number; currency: string; sign: string } }>('/api/payments/webhook/:studioId', async (req) => {
    const row = db.prepare('SELECT gateway_enc FROM studios WHERE id = ?').get(req.params.studioId) as { gateway_enc: string | null } | undefined;
    const gw = unseal<{ crc: string }>(row?.gateway_enc);
    if (!gw) throw notFound();
    const b = req.body;
    const expected = createHash('sha384').update(JSON.stringify({ sessionId: b.sessionId, orderId: b.orderId, amount: b.amount, currency: b.currency, crc: gw.crc })).digest('hex');
    if (expected !== b.sign) throw forbidden();
    db.prepare("UPDATE payments SET status = 'paid', provider_ref = ? WHERE studio_id = ? AND id = ?").run(String(b.orderId), req.params.studioId, b.sessionId);
    return { ok: true };
  });

  // Webhook Stripe (services/stripe.ts). Podpis liczony z surowego body, więc ta trasa ma własny parser JSON.
  app.register(async (sub) => {
    sub.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));
    sub.post<{ Params: { studioId: string }; Body: string }>('/api/payments/stripe/:studioId', async (req) => {
      const gw = stripeGateway(db, req.params.studioId);
      if (!gw?.webhookSecret) throw notFound();
      if (!verifyStripeSignature(req.body, req.headers['stripe-signature'] as string | undefined, gw.webhookSecret)) throw forbidden();
      const event = JSON.parse(req.body) as { type: string; data: { object: { id: string; payment_status?: string; payment_intent?: string | null; amount_refunded?: number } } };
      const s = event.data.object;
      if (event.type === 'charge.refunded') {
        if (s.payment_intent) syncGatewayRefund(new StudioScope(db, req.params.studioId), loadStudio(db, req.params.studioId), s.payment_intent, s.amount_refunded ?? 0);
        return { received: true };
      }
      const outcome =
        event.type === 'checkout.session.async_payment_succeeded' || (event.type === 'checkout.session.completed' && s.payment_status === 'paid')
          ? 'paid'
          : event.type === 'checkout.session.async_payment_failed'
            ? 'failed'
            : event.type === 'checkout.session.expired'
              ? 'expired'
              : null;
      // completed z payment_status 'unpaid' = BLIK/P24 jeszcze w drodze – czekamy na async_payment_*.
      if (outcome) await completeCheckout(deps, new StudioScope(db, req.params.studioId), loadStudio(db, req.params.studioId), s.id, outcome, s.payment_intent ?? null);
      return { received: true };
    });
  });

  // Powrót z Checkout: aplikacja pyta, czy webhook już dotarł (zwykle w ciągu sekund).
  app.get<{ Params: { id: string } }>('/api/checkout/:id', { preHandler: requireStudio(db) }, async (req) => {
    const { scope, user } = ctx(req);
    const row = scope.get<CheckoutRow>('SELECT kind, status, payload_json, result_message FROM checkout_sessions WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id });
    if (!row) throw notFound('Nie znaleziono płatności.');
    return checkoutStatus(row);
  });
}
