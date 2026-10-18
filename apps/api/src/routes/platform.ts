// Platforma (1.2): administrator platformy zarządza studiami, planami i feature flagami, ale NIE ma domyślnego
// dostępu do danych klientek – widzi liczby; wejście w dane studia wymaga powodu i trafia do logu (T7, T8).
// Help desk z SLA, monitoring per studio, strona statusu, samoobsługowa rejestracja studia z okresem próbnym (T6).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { FEATURE_LABEL, formatPLN, PLANS, planById, PRESETS, TRIAL_DAYS, toIcs, validEmail, validNip, type Feature } from '@glam/core';
import { checkOtp, createSession, normalizePhone } from '../auth.ts';
import { ctx, requireStudio, requireUser, type Deps } from '../context.ts';
import { unseal } from '../crypto.ts';
import { id, nowIso, tx } from '../db.ts';
import { HttpError, badRequest, forbidden, notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { checkoutStatus, completeCheckout, purchaseProduct, type CheckoutRow } from '../services/payments.ts';
import { fillSchedule } from '../services/schedule.ts';
import { syncGatewayRefund } from '../services/refunds.ts';
import { stripeGateway, verifyStripeSignature } from '../services/stripe.ts';
import { applyPreset } from '../services/presets.ts';
import { loadStudio } from '../services/studio.ts';
import { guestCode } from './client.ts';

const admins = () => (process.env.GLAM_PLATFORM_ADMINS ?? '+48500000009').split(',').map((s) => s.trim());

/** SLA odpowiedzi help desku wg priorytetu (1.2.11). */
export const SLA_HOURS: Record<string, number> = { urgent: 2, high: 8, normal: 24, low: 72 };

export function platformRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const adminOnly = {
    preHandler: async (req: FastifyRequest) => {
      await requireUser(db)(req);
      if (!admins().includes(req.user!.phone)) throw forbidden();
    },
  };

  app.get('/api/platform/studios', adminOnly, async () =>
    (
      db
        .prepare(
          `SELECT s.id, s.name, s.city, s.status, s.plan_id, s.trial_ends_at, s.created_at, s.catalog_visible,
                  (SELECT COUNT(*) FROM memberships m WHERE m.studio_id = s.id AND m.role = 'client') AS clients,
                  (SELECT COUNT(*) FROM class_sessions c WHERE c.studio_id = s.id) AS sessions,
                  (SELECT COALESCE(SUM(units), 0) FROM usage_log u WHERE u.studio_id = s.id AND u.kind = 'sms' AND u.created_at >= date('now', 'start of month')) AS sms,
                  (SELECT COALESCE(SUM(cost_grosze), 0) FROM usage_log u WHERE u.studio_id = s.id AND u.created_at >= date('now', 'start of month')) AS costs,
                  (SELECT COALESCE(SUM(size), 0) FROM media x WHERE x.studio_id = s.id) AS storage,
                  (SELECT COALESCE(SUM(requests), 0) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS requests7d,
                  (SELECT COALESCE(SUM(errors), 0) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS errors7d,
                  (SELECT COALESCE(SUM(total_ms), 0) * 1.0 / MAX(1, SUM(requests)) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS avg_ms
           FROM studios s ORDER BY s.name`,
        )
        .all() as { id: string; plan_id: string | null; costs: number; storage: number }[]
    ).map((s) => ({
      ...s,
      plan: planById(s.plan_id).name,
      costs: formatPLN(s.costs),
      storageMb: Math.round(s.storage / 100_000) / 10,
      flags: Object.fromEntries((db.prepare('SELECT flag, enabled FROM studio_features WHERE studio_id = ?').all(s.id) as { flag: string; enabled: number }[]).map((f) => [f.flag, !!f.enabled])),
    })),
  );

  app.get('/api/platform/plans', async () => ({ plans: PLANS.map((p) => ({ ...p, price: formatPLN(p.priceGrosze), featureLabels: p.features.map((f) => FEATURE_LABEL[f]) })), features: FEATURE_LABEL, trialDays: TRIAL_DAYS }));

  app.put<{ Params: { id: string }; Body: { planId?: string; status?: 'trial' | 'active' | 'suspended'; trialEndsAt?: string | null } }>('/api/platform/studios/:id', adminOnly, async (req) => {
    const b = req.body ?? {};
    if (b.planId && !PLANS.some((p) => p.id === b.planId)) throw badRequest('Nieznany plan.');
    if (b.status && !['trial', 'active', 'suspended'].includes(b.status)) throw badRequest('Nieznany status.');
    const r = db.prepare('UPDATE studios SET plan_id = COALESCE(?, plan_id), status = COALESCE(?, status), trial_ends_at = COALESCE(?, trial_ends_at) WHERE id = ?').run(b.planId ?? null, b.status ?? null, b.trialEndsAt ?? null, req.params.id);
    if (!r.changes) throw notFound();
    return { ok: true };
  });

  // Feature flagi per studio (T11): funkcje w becie tylko dla wybranych studiów. null = jak w planie.
  app.put<{ Params: { id: string }; Body: { flag: Feature; enabled: boolean | null } }>('/api/platform/studios/:id/flags', adminOnly, async (req) => {
    if (!(req.body?.flag in FEATURE_LABEL)) throw badRequest('Nieznana funkcja.');
    if (req.body.enabled === null) db.prepare('DELETE FROM studio_features WHERE studio_id = ? AND flag = ?').run(req.params.id, req.body.flag);
    else db.prepare('INSERT OR REPLACE INTO studio_features (studio_id, flag, enabled) VALUES (?, ?, ?)').run(req.params.id, req.body.flag, Number(req.body.enabled));
    return { ok: true };
  });

  app.post<{ Body: { studioId: string; reason: string } }>('/api/platform/access', adminOnly, async (req) => {
    const { studioId, reason } = req.body ?? ({} as { studioId: string; reason: string });
    if (!reason || reason.trim().length < 10) throw badRequest('Podaj uzasadnienie dostępu (zgłoszenie studia, min. 10 znaków).');
    if (!db.prepare('SELECT 1 FROM studios WHERE id = ?').get(studioId)) throw notFound();
    db.prepare('INSERT INTO platform_access_log (id, admin_user_id, studio_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(id(), req.user!.id, studioId, reason.trim(), nowIso());
    return { ok: true, logged: true };
  });

  app.get('/api/platform/access-log', adminOnly, async () =>
    db.prepare('SELECT l.created_at, l.reason, s.name AS studio, u.phone AS admin FROM platform_access_log l JOIN studios s ON s.id = l.studio_id JOIN users u ON u.id = l.admin_user_id ORDER BY l.created_at DESC LIMIT 100').all(),
  );

  // ——— Help desk platformy dla właścicielek (1.2.11) z SLA ———

  app.get('/api/platform/tickets', adminOnly, async () =>
    db
      .prepare(
        `SELECT t.*, s.name AS studio, u.name AS author, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages,
                CASE WHEN t.status = 'open' AND t.sla_due_at < ? THEN 1 ELSE 0 END AS overdue
         FROM support_tickets t JOIN studios s ON s.id = t.studio_id JOIN users u ON u.id = t.author_id ORDER BY t.status = 'closed', t.sla_due_at`,
      )
      .all(nowIso()),
  );

  app.get<{ Params: { id: string } }>('/api/platform/tickets/:id', adminOnly, async (req) => ({
    ticket: db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id),
    messages: db.prepare('SELECT m.body, m.from_platform, m.created_at, u.name FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at').all(req.params.id),
  }));

  app.post<{ Params: { id: string }; Body: { body: string; close?: boolean } }>('/api/platform/tickets/:id', adminOnly, async (req) => {
    const t = db.prepare('SELECT studio_id, author_id FROM support_tickets WHERE id = ?').get(req.params.id) as { studio_id: string; author_id: string } | undefined;
    if (!t) throw notFound();
    tx(db, () => {
      if (req.body?.body?.trim()) db.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, from_platform, body, created_at) VALUES (?, ?, ?, 1, ?, ?)').run(id(), req.params.id, req.user!.id, req.body.body.trim(), nowIso());
      db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(req.body?.close ? 'closed' : 'answered', nowIso(), req.params.id);
    });
    return { ok: true };
  });

  // Strona statusu usług (1.2.11).
  app.post<{ Body: { component: string; status: 'degraded' | 'outage' | 'maintenance'; note: string } }>('/api/platform/incidents', adminOnly, async (req) => {
    if (!['degraded', 'outage', 'maintenance'].includes(req.body?.status) || !req.body.note?.trim()) throw badRequest('Podaj komponent, status i opis.');
    db.prepare('INSERT INTO status_incidents (id, component, status, note, started_at) VALUES (?, ?, ?, ?, ?)').run(id(), req.body.component, req.body.status, req.body.note.trim(), nowIso());
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/platform/incidents/:id/resolve', adminOnly, async (req) => {
    db.prepare('UPDATE status_incidents SET resolved_at = ? WHERE id = ?').run(nowIso(), req.params.id);
    return { ok: true };
  });

  app.get('/api/status', async () => {
    const components = ['Aplikacja', 'Rezerwacje', 'Płatności', 'Powiadomienia', 'SMS'];
    const open = db.prepare('SELECT * FROM status_incidents WHERE resolved_at IS NULL ORDER BY started_at DESC').all() as { component: string; status: string }[];
    return {
      components: components.map((c) => ({ name: c, status: open.find((i) => i.component === c)?.status ?? 'operational' })),
      incidents: db.prepare("SELECT component, status, note, started_at, resolved_at FROM status_incidents WHERE started_at >= date('now', '-30 day') ORDER BY started_at DESC").all(),
    };
  });

  // ——— Strona studia: zgłoszenia do platformy ———

  const owner = { preHandler: requireStudio(db, ['owner']) };
  app.get('/api/owner/tickets', owner, async (req) => {
    const { scope } = ctx(req);
    return scope.all<{ id: string }>('SELECT * FROM support_tickets WHERE studio_id = $studio ORDER BY updated_at DESC').map((t) => ({
      ...t,
      messages: db.prepare('SELECT m.body, m.from_platform, m.created_at, u.name FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at').all(t.id),
    }));
  });

  app.post<{ Body: { subject: string; body: string; priority?: 'low' | 'normal' | 'high' | 'urgent'; grantDataAccess?: boolean } }>('/api/owner/tickets', owner, async (req) => {
    const { scope, user } = ctx(req);
    const b = req.body;
    if (!b?.subject?.trim() || !b.body?.trim()) throw badRequest('Podaj temat i opis.');
    const priority = ['low', 'normal', 'high', 'urgent'].includes(b.priority ?? '') ? b.priority! : 'normal';
    const tid = id();
    tx(db, () => {
      scope.run("INSERT INTO support_tickets (id, studio_id, author_id, subject, priority, status, sla_due_at, data_access_granted, created_at, updated_at) VALUES ($id, $studio, $u, $s, $p, 'open', $sla, $g, $now, $now)", {
        id: tid,
        u: user.id,
        s: b.subject.trim().slice(0, 120),
        p: priority,
        sla: new Date(Date.now() + SLA_HOURS[priority] * 3_600_000).toISOString(),
        g: Number(!!b.grantDataAccess),
        now: nowIso(),
      });
      db.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, from_platform, body, created_at) VALUES (?, ?, ?, 0, ?, ?)').run(id(), tid, user.id, b.body.trim().slice(0, 5000), nowIso());
    });
    return { id: tid, slaHours: SLA_HOURS[priority] };
  });

  app.post<{ Params: { id: string }; Body: { body: string } }>('/api/owner/tickets/:id', owner, async (req) => {
    const { scope, user } = ctx(req);
    if (!scope.get('SELECT 1 FROM support_tickets WHERE studio_id = $studio AND id = $id', { id: req.params.id })) throw notFound();
    db.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, from_platform, body, created_at) VALUES (?, ?, ?, 0, ?, ?)').run(id(), req.params.id, user.id, String(req.body?.body ?? '').trim().slice(0, 5000), nowIso());
    db.prepare("UPDATE support_tickets SET status = 'open', updated_at = ? WHERE id = ?").run(nowIso(), req.params.id);
    return { ok: true };
  });

  // ——— Samoobsługowa rejestracja studia (1.2.6, T6) ———
  // Krok 1: numer telefonu właścicielki – kod SMS z /api/auth/request-code. Krok 2: dane studia + kod.

  app.post<{ Body: { studioName: string; nip?: string; city?: string; ownerName: string; phone: string; code: string; email: string; presetId?: string; planId?: string; acceptTerms: boolean } }>('/api/signup/studio', async (req) => {
    const b = req.body ?? ({} as typeof req.body);
    if (!b.acceptTerms) throw badRequest('Zaakceptuj regulamin platformy i umowę powierzenia danych (DPA).');
    if (!b.studioName?.trim() || b.studioName.trim().length < 2) throw badRequest('Podaj nazwę studia.');
    if (!b.ownerName?.trim()) throw badRequest('Podaj imię i nazwisko właścicielki.');
    if (!validEmail(b.email ?? '')) throw badRequest('Podaj poprawny e-mail – wyślemy na niego link weryfikacyjny.');
    if (b.nip && !validNip(b.nip)) throw badRequest('Sprawdź NIP (10 cyfr z sumą kontrolną).');
    const phone = normalizePhone(b.phone);
    checkOtp(db, phone, b.code);
    const plan = planById(b.planId);
    const slugBase = b.studioName.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'studio';
    const studioId = `st_${id().slice(0, 8)}`;
    const result = tx(db, () => {
      let user = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
      if (!user) {
        user = { id: id() };
        db.prepare('INSERT INTO users (id, phone, name, email, onboarded_at, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, phone, b.ownerName.trim(), b.email, nowIso(), nowIso());
      }
      let slug = slugBase;
      for (let i = 2; db.prepare('SELECT 1 FROM studios WHERE slug = ?').get(slug); i++) slug = `${slugBase}-${i}`;
      let invite = guestCode(6);
      while (db.prepare('SELECT 1 FROM studios WHERE invite_code = ?').get(invite)) invite = guestCode(6);
      db.prepare(
        `INSERT INTO studios (id, name, slug, invite_code, city, email, nip, logo, policy_json, plan_id, status, trial_ends_at, published, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial', ?, 0, ?)`,
      ).run(
        studioId,
        b.studioName.trim().slice(0, 60),
        slug,
        invite,
        b.city?.trim() || null,
        b.email,
        b.nip?.replace(/[\s-]/g, '') || null,
        b.studioName.trim().charAt(0).toUpperCase(),
        JSON.stringify({ opensDaysAhead: 14, closesMinutesBefore: 120, cancelMinutesBefore: 120, waitlist: true }),
        plan.id,
        new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
        nowIso(),
      );
      db.prepare("INSERT INTO memberships (studio_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(studioId, user.id, nowIso());
      db.prepare("INSERT INTO facilities (id, studio_id, name) VALUES (?, ?, ?)").run(id(), studioId, b.studioName.trim());
      return { userId: user.id, invite };
    });
    // Weryfikacja e-maila: link z jednorazowym tokenem.
    const token = id().replace(/-/g, '');
    db.prepare("INSERT INTO platform_settings (key, value) VALUES (?, ?)").run(`email-verify:${token}`, JSON.stringify({ userId: result.userId, email: b.email }));
    await deps.email?.send(b.email, 'Potwierdź e-mail – GLAM', `Witaj w GLAM! Potwierdź adres: ${deps.publicUrl ?? ''}/api/signup/verify-email/${token}`);
    const preset = PRESETS.find((p) => p.id === b.presetId);
    // Szablon branżowy od razu – kreator prowadzi dalej przez harmonogram, płatności i publikację.
    if (preset) applyPreset(new StudioScope(db, studioId), loadStudio(db, studioId), preset);
    return { studioId, token: createSession(db, result.userId, Date.now(), 'signup'), inviteCode: result.invite, trialDays: TRIAL_DAYS, message: `Studio założone. Masz ${TRIAL_DAYS} dni okresu próbnego.` };
  });

  app.get<{ Params: { token: string } }>('/api/signup/verify-email/:token', async (req, reply) => {
    const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(`email-verify:${req.params.token}`) as { value: string } | undefined;
    if (!row) throw notFound('Link wygasł albo był już użyty.');
    const { userId, email } = JSON.parse(row.value) as { userId: string; email: string };
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
    db.prepare('DELETE FROM platform_settings WHERE key = ?').run(`email-verify:${req.params.token}`);
    return reply.header('content-type', 'text/html; charset=utf-8').send('<!doctype html><meta charset="utf-8"><title>GLAM</title><p style="font:16px system-ui;margin:40px">E-mail potwierdzony. Możesz wrócić do panelu studia.</p>');
  });

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

  // Uzupełnienie grafiku ręcznie z platformy (np. po migracji studia).
  app.post<{ Params: { id: string } }>('/api/platform/studios/:id/fill', adminOnly, async (req) => fillSchedule(new StudioScope(db, req.params.id), loadStudio(db, req.params.id)));

}
