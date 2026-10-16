// Panele trenerki, recepcji i koordynatorki (2.1, 3, 4.11): dzień, check-in (lista, QR, telefon, wejście do strefy),
// ręczne dodanie i usunięcie, zastępstwa i nieobecności, klientki z notatnikiem i planem, wiadomości do grupy,
// powitania (tekst, wideo, zaplanowane), kartki, szafka nagród, czat z klientkami, sprzedaż przy kasie.
import type { FastifyInstance } from 'fastify';
import {
  addDays,
  can,
  checkAccess,
  describePass,
  formatPLN,
  localParts,
  moderate,
  MODERATION_COPY,
  pickPass,
  segmentsOf,
  TRIGGERS,
  zonedToUtc,
  type AccessGranted,
} from '@glam/core';
import { normalizePhone } from '../auth.ts';
import { ctx, requirePerm, requireStudio, STAFF, type Deps } from '../context.ts';
import { unseal } from '../crypto.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { DESK_METHODS, type PaymentMethod } from '../sms.ts';
import { audit } from '../services/audit.ts';
import { bookSession, cancelBooking, changeTrainer, checkIn, loadSession, markNoShow } from '../services/booking.ts';
import { CHAT_BODY_LIMIT, CHAT_LAST_BODY, chatMessages, postChatMessage, type ChatInput } from '../services/chat.ts';
import { logUsage } from '../services/dispatch.ts';
import { storeMedia } from '../services/media.ts';
import { notify } from '../services/notify.ts';
import { consumeEntry, loadPasses, refundEntry } from '../services/passes.ts';
import { purchaseProduct, recordPayment } from '../services/payments.ts';
import { clientFacts } from '../services/segments.ts';
import type { Studio } from '../services/studio.ts';
import { createGuestPass, deliverGuestPass, guestCode, passesView } from './client.ts';
import { parseCheckinCode } from '../services/checkin.ts';

export const WELCOME_MAX = 400;

/** Szablony „girl vibe” (6.5, P4) – trenerka personalizuje; nic nie wysyła się automatycznie (6.6). */
export const WELCOME_TEMPLATES = [
  { id: 'warm', label: 'Ciepły', body: 'Hej {imię}! 💛 Cieszę się, że do nas dołączyłaś. Pierwsze zajęcia {kiedy} – wystarczy mata i dobry nastrój. Jeśli coś Cię stresuje, napisz, odpiszę tego samego dnia. Do zobaczenia! Twoja {trenerka} ✨' },
  { id: 'goal', label: 'Cel klientki', body: '{imię}, wiem, że chcesz: {cel}. Zaczniemy spokojnie, bez pośpiechu. Twój pierwszy krok to już dziś 🌸 Trzymam kciuki!' },
  { id: 'humor', label: 'Z humorem', body: 'Hej! Jestem {trenerka} i obiecuję, że nie będę się śmiać, jeśli za pierwszym razem coś Ci nie wyjdzie. Każda z nas kiedyś zaczynała od drżących kolan 😄' },
];

function clientName(scope: StudioScope, userId: string) {
  return (scope.db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string | null } | undefined)?.name ?? 'Klientka';
}

/** Ankieta startowa (4.6): cele, ograniczenia, kontuzje – widoczne dla trenerki, tylko za zgodą. */
export function healthFor(scope: StudioScope, userId: string) {
  const consent = scope.db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'health'").get(userId) as { granted: number } | undefined;
  if (!consent?.granted) return null;
  const row = scope.get<{ data_enc: string }>('SELECT data_enc FROM health_profiles WHERE studio_id = $studio AND user_id = $u', { u: userId });
  return row ? unseal<{ goals?: string; limitations?: string; injuries?: string; pregnancy?: boolean }>(row.data_enc) : null;
}

export function staffRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const staff = { preHandler: requireStudio(db, STAFF) };
  const perm = (...p: Parameters<typeof requirePerm>[1][]) => requirePerm(db, ...p);

  // ——— Dzień ———

  app.get<{ Querystring: { date?: string } }>('/api/staff/day', perm('day.own', 'day.all'), async (req) => {
    const { studio, scope, user, roles } = ctx(req);
    const date = req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : localParts(new Date(), studio.timezone).date;
    // Trenerka widzi swój dzień; recepcja i właścicielka – całe studio (siatka ról 2.1).
    const onlyOwn = !can(roles, 'day.all');
    const contact = can(roles, 'clients.contact');
    const sessions = scope.all<{ id: string; starts_at: string; ends_at: string; class_name: string; trainer_name: string; trainer_id: string; capacity: number; status: string; zone_name: string; kind: string; playlist_name: string | null; class_type_id: string }>(
      `SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.kind, s.trainer_id, s.class_type_id, COALESCE(s.title, ct.name) AS class_name, z.name AS zone_name, u.name AS trainer_name,
              (SELECT p.name FROM playlists p WHERE p.id = COALESCE(s.playlist_id, ct.playlist_id)) AS playlist_name
       FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN zones z ON z.id = ct.zone_id JOIN users u ON u.id = s.trainer_id
       WHERE s.studio_id = $studio AND s.starts_at >= $from AND s.starts_at < $to ${onlyOwn ? 'AND s.trainer_id = $me' : ''}
       ORDER BY s.starts_at`,
      { from: zonedToUtc(date, '00:00', studio.timezone).toISOString(), to: zonedToUtc(addDays(date, 1), '00:00', studio.timezone).toISOString(), ...(onlyOwn ? { me: user.id } : {}) },
    );
    const events = scope.all(
      `SELECT e.id, e.kind, e.activity, e.starts_at, e.ends_at, e.guests, e.status, e.client_note, u.name AS client_name, t.name AS trainer_name FROM private_events e
       JOIN users u ON u.id = e.client_id LEFT JOIN users t ON t.id = e.trainer_id
       WHERE e.studio_id = $studio AND e.status IN ('confirmed', 'paid', 'offer') AND e.starts_at >= $from AND e.starts_at < $to ${onlyOwn ? 'AND e.trainer_id = $me' : ''}`,
      { from: zonedToUtc(date, '00:00', studio.timezone).toISOString(), to: zonedToUtc(addDays(date, 1), '00:00', studio.timezone).toISOString(), ...(onlyOwn ? { me: user.id } : {}) },
    );
    return {
      date,
      events,
      sessions: sessions.map((s) => ({
        ...s,
        rating: scope.get<{ avg: number | null; n: number }>('SELECT ROUND(AVG(rating), 1) AS avg, COUNT(rating) AS n FROM bookings WHERE studio_id = $studio AND session_id = $sid', { sid: s.id }),
        participants: scope
          .all<{ booking_id: string; status: string; user_id: string; name: string; phone: string; goal: string | null; visits: number; guest_name: string | null; confirmed_at: string | null; rating: number | null }>(
            `SELECT b.id AS booking_id, b.status, b.guest_name, b.confirmed_at, b.rating, u.id AS user_id, u.name, u.phone, m.goal,
                    (SELECT COUNT(*) FROM bookings b2 WHERE b2.studio_id = $studio AND b2.user_id = u.id AND b2.status = 'attended' AND b2.guest_name IS NULL) AS visits
             FROM bookings b JOIN users u ON u.id = b.user_id
             LEFT JOIN memberships m ON m.studio_id = b.studio_id AND m.user_id = u.id AND m.role = 'client'
             WHERE b.studio_id = $studio AND b.session_id = $sid AND b.status IN ('booked', 'attended', 'waitlist', 'no_show')
             ORDER BY b.status = 'waitlist', b.created_at`,
            { sid: s.id },
          )
          .map((p) => {
            const health = p.guest_name ? null : healthFor(scope, p.user_id);
            return {
              ...p,
              phone: contact ? p.phone : undefined,
              name: p.guest_name ? `${p.guest_name} (gość: ${p.name})` : p.name,
              health: health ? { limitations: health.limitations, injuries: health.injuries, pregnancy: health.pregnancy } : null,
            };
          }),
      })),
    };
  });

  app.get<{ Querystring: { from?: string; days?: string } }>('/api/staff/schedule', perm('schedule.view'), async (req) => {
    const { studio, scope } = ctx(req);
    const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : localParts(new Date(), studio.timezone).date;
    const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 42);
    return scope.all(
      `SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.kind, s.public, s.trainer_id, COALESCE(s.title, ct.name) AS class_name, ct.color, z.name AS zone_name, u.name AS trainer_name,
              (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')) AS taken,
              (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'waitlist') AS waiting
       FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN zones z ON z.id = ct.zone_id JOIN users u ON u.id = s.trainer_id
       WHERE s.studio_id = $studio AND s.starts_at >= $from AND s.starts_at < $to ORDER BY s.starts_at`,
      { from: zonedToUtc(from, '00:00', studio.timezone).toISOString(), to: zonedToUtc(addDays(from, days), '00:00', studio.timezone).toISOString() },
    );
  });

  app.post<{ Params: { id: string } }>('/api/staff/bookings/:id/checkin', perm('participants.view'), async (req) => {
    const { scope, studio } = ctx(req);
    checkIn(scope, studio, req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/staff/bookings/:id/no-show', perm('participants.view'), async (req) => {
    markNoShow(ctx(req).scope, req.params.id);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/bookings/:id', perm('participants.manage'), async (req) => {
    const { studio, scope, user } = ctx(req);
    const b = scope.get<{ user_id: string }>('SELECT user_id FROM bookings WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    const res = cancelBooking(scope, studio, req.params.id, { userId: user.id, isStaff: true });
    if (b) audit(scope, { actorId: user.id, action: 'booking.removed_by_staff', entity: 'booking', entityId: req.params.id, subjectUserId: b.user_id });
    return res;
  });

  // Ręczne dodanie klientki (2.1: recepcja i właścicielka). Bez karnetu – „płatność na miejscu”.
  app.post<{ Params: { id: string }; Body: { userId: string; payAtDesk?: boolean; guest?: { name: string } | null } }>('/api/staff/sessions/:id/participants', perm('participants.manage'), async (req) => {
    const { studio, scope, user } = ctx(req);
    if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: req.body?.userId })) throw notFound('Nie znaleziono klientki.');
    const res = bookSession(scope, studio, req.body.userId, req.params.id, new Date(), { staff: true, payAtDesk: !!req.body.payAtDesk, guest: req.body.guest ?? null, source: 'desk' });
    audit(scope, { actorId: user.id, action: 'booking.added_by_staff', entity: 'booking', entityId: res.bookingId, subjectUserId: req.body.userId, details: { payAtDesk: !!req.body.payAtDesk } });
    notify(scope, { userId: req.body.userId, category: 'transactional', tz: studio.timezone, body: `Recepcja zapisała Cię na ${loadSession(scope, req.params.id).class_name}. Do zobaczenia!`, action: 'schedule' });
    return res;
  });

  // Check-in QR lub po telefonie (4.11): zajęcia za chwilę → obecność; inaczej wejście do strefy (siłownia, C3).
  app.post<{ Body: { code?: string; phone?: string; zoneId?: string } }>('/api/staff/checkin', perm('participants.view'), async (req) => {
    const { studio, scope, user } = ctx(req);
    const now = new Date();
    const today = localParts(now, studio.timezone).date;
    let clientId: string | null = null;
    if (req.body?.code) clientId = parseCheckinCode(studio.id, req.body.code, today);
    else if (req.body?.phone) clientId = (db.prepare('SELECT id FROM users WHERE phone = ?').get(normalizePhone(req.body.phone)) as { id: string } | undefined)?.id ?? null;
    if (!clientId || !scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: clientId })) {
      throw notFound('Nie rozpoznałyśmy kodu. Poproś o odświeżenie kodu w aplikacji albo wpisz numer telefonu.');
    }
    const name = clientName(scope, clientId);
    const booking = scope.get<{ id: string; class_name: string; starts_at: string }>(
      `SELECT b.id, COALESCE(s.title, ct.name) AS class_name, s.starts_at FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id
       WHERE b.studio_id = $studio AND b.user_id = $u AND b.status = 'booked' AND b.guest_name IS NULL AND s.starts_at BETWEEN $a AND $b ORDER BY s.starts_at LIMIT 1`,
      { u: clientId, a: new Date(now.getTime() - 30 * 60_000).toISOString(), b: new Date(now.getTime() + 90 * 60_000).toISOString() },
    );
    if (booking && !req.body?.zoneId) {
      checkIn(scope, studio, booking.id, now);
      return { name, kind: 'class', message: `${name} – obecna na ${booking.class_name} ✓` };
    }
    // Wejście do strefy z kontrolowanym / wolnym wstępem: „Czy aktywny produkt pokrywa tę strefę i godzinę?” (1.1.3).
    const zone = scope.get<{ id: string; name: string }>(
      `SELECT id, name FROM zones WHERE studio_id = $studio AND access IN ('checkin', 'open', 'mixed') ${req.body?.zoneId ? 'AND id = $z' : ''} ORDER BY access = 'checkin' DESC LIMIT 1`,
      req.body?.zoneId ? { z: req.body.zoneId } : {},
    );
    if (!zone) throw conflict('no_class', `${name} nie ma teraz zajęć, a studio nie ma strefy z wolnym wstępem.`);
    const results = loadPasses(scope, clientId, now).map((p) => checkAccess(p, { classTypeId: null, zoneId: zone.id, startsAt: now, tz: studio.timezone, usage: { day: 0, week: 0 } }));
    const choice = pickPass(results.filter((r): r is AccessGranted => r.ok));
    if (!choice) throw conflict('no_access', `${name}: żaden karnet nie obejmuje strefy ${zone.name} o tej godzinie.`);
    scope.tx(() => {
      if (choice.poolId) consumeEntry(scope, choice.pass, choice.poolId, now);
      scope.run('INSERT INTO zone_checkins (id, studio_id, user_id, zone_id, pass_id, by_user, at) VALUES ($id, $studio, $u, $z, $p, $by, $now)', { id: id(), u: clientId, z: zone.id, p: choice.pass.id, by: user.id, now: now.toISOString() });
    });
    return { name, kind: 'zone', message: `${name} – wejście: ${zone.name} ✓`, pass: describePass(choice.pass, studio.timezone) };
  });

  // ——— Zarządzanie sesjami ———

  app.post<{ Params: { id: string }; Body: { trainerId: string } }>('/api/staff/sessions/:id/trainer', perm('schedule.edit'), async (req) => {
    const { scope, studio, user } = ctx(req);
    const r = changeTrainer(scope, studio, req.params.id, req.body?.trainerId);
    audit(scope, { actorId: user.id, action: 'session.trainer_changed', entity: 'session', entityId: req.params.id, details: { trainerId: req.body.trainerId } });
    return { message: `Zmieniono prowadzącą. Powiadomione klientki: ${r.notified}.` };
  });

  app.post<{ Params: { id: string }; Body: { reason: string } }>('/api/staff/sessions/:id/cancel', perm('schedule.edit'), async (req) => {
    const { scope, studio, user } = ctx(req);
    const s = loadSession(scope, req.params.id);
    const reason = String(req.body?.reason ?? '').trim() || 'zmiana w grafiku';
    const n = scope.tx(() => {
      scope.run("UPDATE class_sessions SET status = 'cancelled' WHERE studio_id = $studio AND id = $id", { id: s.id });
      const bookings = scope.all<{ id: string; user_id: string; pass_id: string | null; pool_id: string | null; status: string; guest_name: string | null }>(
        "SELECT * FROM bookings WHERE studio_id = $studio AND session_id = $sid AND status IN ('booked', 'waitlist')",
        { sid: s.id },
      );
      const time = localParts(new Date(s.starts_at), studio.timezone).time;
      for (const b of bookings) {
        if (b.status === 'booked' && b.pool_id !== 'guest') refundEntry(scope, b.pass_id, b.pool_id);
        scope.run("UPDATE bookings SET status = 'cancelled', updated_at = $ts WHERE studio_id = $studio AND id = $id", { id: b.id, ts: nowIso() });
        if (!b.guest_name) notify(scope, { userId: b.user_id, category: 'transactional', tz: studio.timezone, action: 'schedule', body: `${TRIGGERS.class_cancelled.text({ time })} Wejście wróciło na karnet.` });
      }
      return bookings.length;
    });
    audit(scope, { actorId: user.id, action: 'session.cancelled', entity: 'session', entityId: s.id, details: { reason } });
    return { message: `Zajęcia odwołane. Powiadomione osoby: ${n}.` };
  });

  // Sesje okolicznościowe i tematyczne (4.1, M5) – poza szablonem, np. „Halloween Flow”.
  app.post<{ Body: { classTypeId: string; trainerId: string; date: string; time: string; durationMin: number; capacity: number; title?: string; kind?: 'special' | 'themed' | 'live'; themeId?: string | null; public?: boolean } }>(
    '/api/staff/sessions',
    perm('schedule.edit'),
    async (req) => {
      const { scope, studio, user } = ctx(req);
      const b = req.body ?? ({} as typeof req.body);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !/^\d{2}:\d{2}$/.test(b.time)) throw badRequest('Podaj datę i godzinę.');
      if (!scope.get('SELECT 1 FROM class_types WHERE studio_id = $studio AND id = $c', { c: b.classTypeId })) throw notFound('Nie znaleziono typu zajęć.');
      if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $t AND role = 'trainer'", { t: b.trainerId })) throw notFound('Nie znaleziono trenerki.');
      if (!(b.durationMin >= 15 && b.durationMin <= 240) || !(b.capacity >= 1 && b.capacity <= 200)) throw badRequest('Czas trwania 15–240 min, miejsca 1–200.');
      const start = zonedToUtc(b.date, b.time, studio.timezone);
      const sid = id();
      scope.run(
        `INSERT INTO class_sessions (id, studio_id, template_id, class_type_id, trainer_id, starts_at, ends_at, capacity, kind, title, theme_id, public)
         VALUES ($id, $studio, NULL, $ct, $t, $s, $e, $cap, $kind, $title, $theme, $pub)`,
        { id: sid, ct: b.classTypeId, t: b.trainerId, s: start.toISOString(), e: new Date(start.getTime() + b.durationMin * 60_000).toISOString(), cap: b.capacity, kind: b.kind ?? 'special', title: b.title?.trim() || null, theme: b.themeId ?? null, pub: Number(b.public ?? true) },
      );
      audit(scope, { actorId: user.id, action: 'session.created', entity: 'session', entityId: sid, details: { title: b.title, kind: b.kind } });
      return { id: sid };
    },
  );

  app.put<{ Params: { id: string }; Body: { playlistId: string | null } }>('/api/staff/sessions/:id/playlist', staff, async (req) => {
    const { scope, user, roles } = ctx(req);
    const s = scope.get<{ trainer_id: string }>('SELECT trainer_id FROM class_sessions WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!s) throw notFound();
    if (s.trainer_id !== user.id && !can(roles, 'schedule.edit')) throw forbidden();
    if (req.body?.playlistId && !scope.get('SELECT 1 FROM playlists WHERE studio_id = $studio AND id = $p', { p: req.body.playlistId })) throw notFound('Nie znaleziono playlisty.');
    scope.run('UPDATE class_sessions SET playlist_id = $p WHERE studio_id = $studio AND id = $id', { p: req.body?.playlistId ?? null, id: req.params.id });
    return { ok: true };
  });

  // ——— Nieobecności i zastępstwa (4.11: alert o odwołaniach z propozycją zastępstwa) ———

  app.get('/api/staff/absences', perm('schedule.view'), async (req) => {
    const { scope, user, roles } = ctx(req);
    const own = !can(roles, 'schedule.edit');
    const absences = scope.all<{ id: string; trainer_id: string; date_from: string; date_to: string; note: string | null; trainer_name: string }>(
      `SELECT a.*, u.name AS trainer_name FROM trainer_absences a JOIN users u ON u.id = a.trainer_id WHERE a.studio_id = $studio AND a.date_to >= $today ${own ? 'AND a.trainer_id = $me' : ''} ORDER BY a.date_from`,
      { today: localParts(new Date()).date, ...(own ? { me: user.id } : {}) },
    );
    return absences.map((a) => ({ ...a, sessions: affectedSessions(scope, ctx(req).studio, a) }));
  });

  app.post<{ Body: { from: string; to: string; note?: string; trainerId?: string } }>('/api/staff/absences', perm('schedule.view'), async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const trainerId = req.body?.trainerId && can(roles, 'schedule.edit') ? req.body.trainerId : user.id;
    if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $t AND role = 'trainer'", { t: trainerId })) throw forbidden();
    const b = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b?.from ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(b?.to ?? '') || b.to < b.from) throw badRequest('Podaj zakres dat.');
    const aid = id();
    scope.run('INSERT INTO trainer_absences (id, studio_id, trainer_id, date_from, date_to, note, created_at) VALUES ($id, $studio, $t, $f, $to, $n, $now)', { id: aid, t: trainerId, f: b.from, to: b.to, n: b.note ?? null, now: nowIso() });
    const affected = affectedSessions(scope, studio, { trainer_id: trainerId, date_from: b.from, date_to: b.to });
    // Alert dla właścicielki i recepcji – z propozycją zastępstwa.
    if (affected.length) {
      const managers = scope.all<{ user_id: string }>("SELECT DISTINCT user_id FROM memberships WHERE studio_id = $studio AND role IN ('owner', 'reception')");
      const who = clientName(scope, trainerId);
      for (const m of managers) notify(scope, { userId: m.user_id, category: 'transactional', tz: studio.timezone, body: `${who} zgłasza nieobecność (${b.from} – ${b.to}). Zajęcia do obsadzenia: ${affected.length}. Mamy propozycje zastępstw.`, action: 'staff/absences' });
    }
    return { id: aid, affected };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/absences/:id', perm('schedule.view'), async (req) => {
    const { scope, user, roles } = ctx(req);
    scope.run(`DELETE FROM trainer_absences WHERE studio_id = $studio AND id = $id ${can(roles, 'schedule.edit') ? '' : 'AND trainer_id = $me'}`, { id: req.params.id, ...(can(roles, 'schedule.edit') ? {} : { me: user.id }) });
    return { ok: true };
  });

  // ——— Klientki ———

  app.get<{ Querystring: { q?: string; segment?: string } }>('/api/staff/clients', staff, async (req) => {
    const { scope, user, roles } = ctx(req);
    if (!can(roles, 'clients.view') && !can(roles, 'notes.write')) throw forbidden();
    const contact = can(roles, 'clients.contact');
    const now = new Date();
    let facts = clientFacts(scope, now);
    // Trenerka widzi klientki, które były lub są zapisane na jej zajęcia, oraz przypisane do niej.
    if (!can(roles, 'clients.view')) {
      const mine = new Set(
        scope
          .all<{ user_id: string }>(
            `SELECT DISTINCT b.user_id FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND s.trainer_id = $me
             UNION SELECT user_id FROM memberships WHERE studio_id = $studio AND role = 'client' AND trainer_id = $me`,
            { me: user.id },
          )
          .map((r) => r.user_id),
      );
      facts = facts.filter((f) => mine.has(f.userId));
    }
    const q = (req.query.q ?? '').toLowerCase().trim();
    const goals = new Map(scope.all<{ user_id: string; goal: string | null }>("SELECT user_id, goal FROM memberships WHERE studio_id = $studio AND role = 'client'").map((g) => [g.user_id, g.goal]));
    return facts
      .map((f) => ({ id: f.userId, name: f.name, phone: contact ? f.phone : undefined, goal: goals.get(f.userId) ?? null, lastVisit: f.lastVisit, visits: f.visits.length, hasActivePass: f.hasActivePass, segments: segmentsOf(f, now), groups: f.groups }))
      .filter((c) => (!q || `${c.name ?? ''} ${c.phone ?? ''}`.toLowerCase().includes(q)) && (!req.query.segment || (c.segments as string[]).includes(req.query.segment)))
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '', 'pl'));
  });

  // Dodanie klientki przez recepcję (np. pierwsza wizyta bez aplikacji) albo trenerkę – numer i imię, opcjonalnie
  // cel i pierwsza notatka (minimalizacja danych). Klientkę dodaną przez trenerkę przypisujemy do niej.
  app.post<{ Body: { phone: string; name: string; goal?: string; note?: string } }>('/api/staff/clients', perm('clients.create'), async (req) => {
    const { scope, user, roles } = ctx(req);
    const phone = normalizePhone(req.body?.phone);
    const name = String(req.body?.name ?? '').trim().slice(0, 80);
    const goal = String(req.body?.goal ?? '').trim().slice(0, 200) || null;
    const note = String(req.body?.note ?? '').trim().slice(0, 2000);
    if (name.length < 2) throw badRequest('Podaj imię.');
    const byTrainer = !can(roles, 'clients.view');
    let u = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
    // Trenerka nie może „dopisać” sobie istniejącej klientki studia – to droga do cudzych danych.
    if (byTrainer && u && scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: u.id }))
      throw conflict('client_exists', 'Ta klientka jest już w studiu. Poproś recepcję o przypisanie jej do Ciebie.');
    if (!u) {
      const uid = id();
      db.prepare('INSERT INTO users (id, phone, name, created_at) VALUES (?, ?, ?, ?)').run(uid, phone, name, nowIso());
      u = { id: uid };
    }
    scope.run("INSERT OR IGNORE INTO memberships (studio_id, user_id, role, joined_at) VALUES ($studio, $u, 'client', $now)", { u: u.id, now: nowIso() });
    if (goal) scope.run("UPDATE memberships SET goal = COALESCE(goal, $g) WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { g: goal, u: u.id });
    if (byTrainer) scope.run("UPDATE memberships SET trainer_id = COALESCE(trainer_id, $me) WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { me: user.id, u: u.id });
    if (note.length >= 2 && can(roles, 'notes.write'))
      scope.run('INSERT INTO trainer_notes (id, studio_id, trainer_id, client_id, body, created_at) VALUES ($id, $studio, $me, $u, $b, $now)', { id: id(), me: user.id, u: u.id, b: note, now: nowIso() });
    audit(scope, { actorId: user.id, action: byTrainer ? 'client.added_by_trainer' : 'client.registered_at_desk', entity: 'client', entityId: u.id, subjectUserId: u.id });
    return { id: u.id };
  });

  app.get<{ Params: { id: string } }>('/api/staff/clients/:id', staff, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const m = scope.get<{ joined_at: string; goal: string | null; trainer_id: string | null }>("SELECT joined_at, goal, trainer_id FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: req.params.id });
    if (!m) throw notFound('Nie znaleziono klientki.');
    const isTrainerOfClient =
      m.trainer_id === user.id || !!scope.get('SELECT 1 FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = $u AND s.trainer_id = $me', { u: req.params.id, me: user.id });
    if (!can(roles, 'clients.view') && !(can(roles, 'notes.write') && isTrainerOfClient)) throw forbidden();
    const u = db.prepare('SELECT id, name, phone, email, avatar_mime, avatar_version FROM users WHERE id = ?').get(req.params.id) as { id: string; name: string | null; phone: string; email: string | null; avatar_mime: string | null; avatar_version: number };
    const contact = can(roles, 'clients.contact');
    const ownerNotes = can(roles, 'notes.read') && studio.settings.ownerSeesTrainerNotes;
    const now = new Date();
    const facts = clientFacts(scope, now, req.params.id)[0];
    return {
      id: u.id,
      name: u.name,
      phone: contact ? u.phone : undefined,
      email: contact ? u.email : undefined,
      avatarUrl: u.avatar_mime ? `/api/users/${u.id}/avatar?v=${u.avatar_version}` : null,
      joinedAt: m.joined_at,
      goal: m.goal,
      trainerId: m.trainer_id,
      segments: facts ? segmentsOf(facts, now) : [],
      passes: can(roles, 'clients.view') ? passesView(scope, studio, u.id) : undefined,
      bookings: scope.all(
        `SELECT b.id, b.status, b.rating, b.rating_comment, s.starts_at, COALESCE(s.title, ct.name) AS class_name, t.name AS trainer_name FROM bookings b
         JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id JOIN users t ON t.id = s.trainer_id
         WHERE b.studio_id = $studio AND b.user_id = $u AND b.guest_name IS NULL ORDER BY s.starts_at DESC LIMIT 30`,
        { u: u.id },
      ),
      // Notatnik postępów (#32): prywatny dla trenerki; właścicielka widzi opcjonalnie (ustawienie studia).
      notes: can(roles, 'notes.write') || ownerNotes
        ? scope.all(
            `SELECT n.id, n.body, n.created_at, n.trainer_id, t.name AS trainer_name FROM trainer_notes n JOIN users t ON t.id = n.trainer_id
             WHERE n.studio_id = $studio AND n.client_id = $u ${ownerNotes ? '' : 'AND n.trainer_id = $me'} ORDER BY n.created_at DESC`,
            { u: u.id, ...(ownerNotes ? {} : { me: user.id }) },
          )
        : [],
      health: can(roles, 'notes.write') || can(roles, 'notes.read') ? healthFor(scope, u.id) : null,
      measurements: can(roles, 'notes.write')
        ? scope.all<{ date: string; data_enc: string }>('SELECT date, data_enc FROM measurements WHERE studio_id = $studio AND user_id = $u AND share_with_trainer = 1 ORDER BY date', { u: u.id }).map((x) => ({ date: x.date, ...(unseal<object>(x.data_enc) ?? {}) }))
        : [],
      photos: can(roles, 'notes.write') ? scope.all("SELECT p.id, p.taken_on, '/api/media/' || p.media_id AS url FROM progress_photos p WHERE p.studio_id = $studio AND p.user_id = $u AND p.share_with_trainer = 1 ORDER BY p.taken_on", { u: u.id }) : [],
      plan: scope.get<{ title: string; items_json: string; updated_at: string; trainer_id: string }>('SELECT title, items_json, updated_at, trainer_id FROM individual_plans WHERE studio_id = $studio AND client_id = $u', { u: u.id }) ?? null,
      // Dziennik zmian (3: „Klientki – dziennik zmian”) – kto i co zmienił.
      log: can(roles, 'clients.view')
        ? scope.all('SELECT a.action, a.details_json, a.created_at, u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.studio_id = $studio AND a.subject_user_id = $u ORDER BY a.created_at DESC LIMIT 40', { u: u.id })
        : [],
      nps: can(roles, 'clients.view') ? scope.all('SELECT score, comment, trigger, answered_at FROM nps_responses WHERE studio_id = $studio AND user_id = $u AND score IS NOT NULL', { u: u.id }) : [],
      surveys: can(roles, 'clients.view') ? scope.all('SELECT reasons_json, comment, wants_proposal, status, answered_at FROM dormant_surveys WHERE studio_id = $studio AND user_id = $u ORDER BY created_at DESC', { u: u.id }) : [],
    };
  });

  app.post<{ Params: { id: string }; Body: { body: string } }>('/api/staff/clients/:id/notes', perm('notes.write'), async (req) => {
    const { scope, user } = ctx(req);
    const body = String(req.body?.body ?? '').trim();
    if (body.length < 2 || body.length > 2000) throw badRequest('Notatka: od 2 do 2000 znaków.');
    if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: req.params.id })) throw notFound();
    scope.run('INSERT INTO trainer_notes (id, studio_id, trainer_id, client_id, body, created_at) VALUES ($id, $studio, $me, $u, $b, $now)', { id: id(), me: user.id, u: req.params.id, b: body, now: nowIso() });
    return { ok: true };
  });

  app.delete<{ Params: { id: string; noteId: string } }>('/api/staff/clients/:id/notes/:noteId', perm('notes.write'), async (req) => {
    ctx(req).scope.run('DELETE FROM trainer_notes WHERE studio_id = $studio AND id = $n AND trainer_id = $me', { n: req.params.noteId, me: ctx(req).user.id });
    return { ok: true };
  });

  // Plan indywidualny (#38, v2): trenerka układa plan, klientka widzi go w aplikacji.
  app.put<{ Params: { id: string }; Body: { title: string; items: { day: string; text: string }[] } }>('/api/staff/clients/:id/plan', perm('notes.write'), async (req) => {
    const { scope, studio, user } = ctx(req);
    const items = (req.body?.items ?? []).filter((i) => i.text?.trim()).slice(0, 30).map((i) => ({ day: String(i.day ?? '').slice(0, 30), text: i.text.trim().slice(0, 300) }));
    if (!req.body?.title?.trim() || !items.length) throw badRequest('Podaj tytuł i co najmniej jeden punkt planu.');
    scope.run(
      `INSERT INTO individual_plans (id, studio_id, trainer_id, client_id, title, items_json, updated_at) VALUES ($id, $studio, $me, $u, $t, $i, $now)
       ON CONFLICT (studio_id, client_id) DO UPDATE SET trainer_id = $me, title = $t, items_json = $i, updated_at = $now`,
      { id: id(), me: user.id, u: req.params.id, t: req.body.title.trim().slice(0, 80), i: JSON.stringify(items), now: nowIso() },
    );
    notify(scope, { userId: req.params.id, category: 'courses', tz: studio.timezone, body: 'Twoja trenerka przygotowała dla Ciebie plan 💛', action: 'profile/plan' });
    return { ok: true };
  });

  // Przypisanie trenerki (6.4: zmiana trenerki – nowa dostaje zadanie powitania, klientka – informację).
  app.put<{ Params: { id: string }; Body: { trainerId: string } }>('/api/staff/clients/:id/trainer', perm('participants.manage'), async (req) => {
    const { scope, studio, user } = ctx(req);
    const t = scope.get<{ name: string }>("SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.user_id = $t AND m.role = 'trainer'", { t: req.body?.trainerId });
    if (!t) throw notFound('Nie znaleziono trenerki.');
    const prev = scope.get<{ trainer_id: string | null }>("SELECT trainer_id FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: req.params.id });
    if (!prev) throw notFound();
    scope.tx(() => {
      scope.run("UPDATE memberships SET trainer_id = $t WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { t: req.body.trainerId, u: req.params.id });
      if (prev.trainer_id && prev.trainer_id !== req.body.trainerId) {
        scope.run(
          `INSERT OR REPLACE INTO welcome_messages (id, studio_id, trainer_id, client_id, kind, body, status, created_at) VALUES ($id, $studio, $t, $u, 'trainer_change', $b, 'published', $now)`,
          { id: id(), t: req.body.trainerId, u: req.params.id, b: `Twoja trenerka od teraz: ${t.name}. Do zobaczenia na sali 💛`, now: nowIso() },
        );
        notify(scope, { userId: req.params.id, category: 'courses', tz: studio.timezone, body: `Twoja trenerka od teraz: ${t.name} 💛`, action: 'start' });
        notify(scope, { userId: req.body.trainerId, category: 'courses', tz: studio.timezone, body: `${clientName(scope, req.params.id)} jest teraz pod Twoją opieką. Napisz jej kilka słów powitania.`, action: 'staff/welcomes' });
      }
      audit(scope, { actorId: user.id, action: 'client.trainer_assigned', entity: 'client', entityId: req.params.id, subjectUserId: req.params.id, details: { trainer: t.name } });
    });
    return { ok: true };
  });

  // ——— Sprzedaż przy kasie (4.11 recepcja): karnet (gotówka / terminal / link do płatności), wejściówki ———

  app.post<{ Params: { id: string }; Body: { productId: string; method: PaymentMethod } }>('/api/staff/clients/:id/passes', perm('desk.sell'), async (req) => {
    const { scope, studio, user } = ctx(req);
    if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: req.params.id })) throw notFound();
    const method = req.body?.method;
    if (method === 'link') {
      const product = scope.get<{ id: string; name: string; price: number }>('SELECT p.id, p.name, v.price_grosze AS price FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.studio_id = $studio AND p.id = $id AND p.published = 1', { id: req.body.productId });
      if (!product) throw notFound('Nie znaleziono produktu.');
      const token = guestCode(12);
      scope.run(
        "INSERT INTO payment_links (id, studio_id, user_id, product_id, token, status, created_by, created_at, expires_at) VALUES ($id, $studio, $u, $p, $t, 'open', $by, $now, $exp)",
        { id: id(), u: req.params.id, p: product.id, t: token, by: user.id, now: nowIso(), exp: new Date(Date.now() + 3 * 86_400_000).toISOString() },
      );
      const phone = (db.prepare('SELECT phone FROM users WHERE id = ?').get(req.params.id) as { phone: string }).phone;
      const link = `${deps.publicUrl ?? ''}/zaplac/${token}`;
      await deps.sms.send(phone, `${studio.name}: link do płatności za ${product.name} (${formatPLN(product.price)}): ${link}`);
      logUsage(db, studio.id, 'sms', 1, 9);
      audit(scope, { actorId: user.id, action: 'payment_link.sent', entity: 'product', entityId: product.id, subjectUserId: req.params.id });
      return { link, message: 'Link do płatności wysłany SMS-em.' };
    }
    if (!DESK_METHODS.includes(method as (typeof DESK_METHODS)[number])) throw badRequest('Wybierz: gotówka, terminal albo link do płatności.');
    return purchaseProduct(deps, scope, studio, { userId: req.params.id, productId: req.body.productId, method, channel: 'desk', actorId: user.id });
  });

  // V2: wejściówka sprzedana przy kasie (gotówka / terminal) – bez paragonu z aplikacji (4.8.1).
  app.post<{ Body: { recipientPhone?: string; method: PaymentMethod; variantId?: string } }>('/api/staff/guest-passes', perm('desk.sell'), async (req) => {
    const { studio, scope, user } = ctx(req);
    const method = req.body?.method;
    if (!DESK_METHODS.includes(method as (typeof DESK_METHODS)[number])) throw badRequest('Wybierz formę płatności: gotówka albo terminal.');
    const variant = studio.settings.guestPass.variants.find((v) => v.id === (req.body.variantId ?? studio.settings.guestPass.variants[0]?.id));
    if (!variant) throw notFound('Nie ma takiej wejściówki.');
    const recipient = req.body.recipientPhone ? normalizePhone(req.body.recipientPhone) : null;
    const gp = scope.tx(() => {
      const gp = createGuestPass(scope, studio, { buyerId: null, recipient, message: '', channel: 'desk', variant });
      recordPayment(scope, { userId: null, kind: 'guest_pass', ref: gp.id, amount: variant.priceGrosze, method, description: `Wejściówka: ${variant.label}` });
      audit(scope, { actorId: user.id, action: 'guest_pass.sold_at_desk', entity: 'guest_pass', entityId: gp.id, details: { variant: variant.label, method } });
      return gp;
    });
    await deliverGuestPass(deps, scope, studio, gp.code, recipient, studio.name, '');
    return { code: gp.code, soldBy: user.name, variant: variant.label, price: formatPLN(variant.priceGrosze) };
  });

  app.get('/api/staff/guest-passes', perm('desk.sell'), async (req) =>
    ctx(req).scope.all(
      `SELECT g.code, g.status, g.channel, g.variant, g.recipient_phone, g.created_at, g.expires_at, b.name AS buyer, a.name AS activated_by FROM guest_passes g
       LEFT JOIN users b ON b.id = g.buyer_id LEFT JOIN users a ON a.id = g.activated_by WHERE g.studio_id = $studio ORDER BY g.created_at DESC LIMIT 100`,
    ),
  );

  // ——— Wiadomości do grupy (#31): trenerka – do swoich zajęć; recepcja i właścicielka – do wszystkich ———

  app.post<{ Body: { sessionId?: string; audience?: string; body: string } }>('/api/staff/messages', perm('messages.group.own', 'messages.group.all'), async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const body = String(req.body?.body ?? '').trim();
    const mod = moderate(body, { maxLength: 500, allowLinks: true });
    if (!mod.ok) throw badRequest(MODERATION_COPY[mod.reason]);
    let recipients: string[] = [];
    let audienceLabel = '';
    if (req.body.sessionId) {
      const s = scope.get<{ trainer_id: string }>('SELECT trainer_id FROM class_sessions WHERE studio_id = $studio AND id = $id', { id: req.body.sessionId });
      if (!s) throw notFound();
      if (s.trainer_id !== user.id && !can(roles, 'messages.group.all')) throw forbidden();
      recipients = scope.all<{ user_id: string }>("SELECT DISTINCT user_id FROM bookings WHERE studio_id = $studio AND session_id = $s AND status IN ('booked', 'waitlist') AND guest_name IS NULL", { s: req.body.sessionId }).map((r) => r.user_id);
      audienceLabel = 'session';
    } else {
      if (!can(roles, 'messages.group.all')) throw forbidden();
      const a = req.body.audience ?? 'all';
      audienceLabel = a;
      if (a.startsWith('class_type:')) {
        recipients = scope.all<{ user_id: string }>(
          "SELECT DISTINCT b.user_id FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND s.class_type_id = $ct AND b.status IN ('booked', 'attended') AND s.starts_at > $since",
          { ct: a.slice(11), since: new Date(Date.now() - 60 * 86_400_000).toISOString() },
        ).map((r) => r.user_id);
      } else if (a.startsWith('group:')) {
        recipients = scope.all<{ user_id: string }>('SELECT gm.user_id FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.studio_id = $studio AND g.id = $g', { g: a.slice(6) }).map((r) => r.user_id);
      } else recipients = scope.all<{ user_id: string }>("SELECT user_id FROM memberships WHERE studio_id = $studio AND role = 'client'").map((r) => r.user_id);
    }
    scope.tx(() => {
      for (const r of recipients) notify(scope, { userId: r, category: 'transactional', tz: studio.timezone, title: `${user.name ?? 'Studio'} pisze`, body, action: 'inbox' });
      scope.run('INSERT INTO group_messages (id, studio_id, author_id, session_id, audience, body, recipients, created_at) VALUES ($id, $studio, $me, $s, $a, $b, $n, $now)', {
        id: id(),
        me: user.id,
        s: req.body.sessionId ?? null,
        a: audienceLabel,
        b: body,
        n: recipients.length,
        now: nowIso(),
      });
    });
    return { message: `Wiadomość wysłana do ${recipients.length} osób.` };
  });

  app.get('/api/staff/messages', perm('messages.group.own', 'messages.group.all'), async (req) => {
    const { scope, user, roles } = ctx(req);
    const all = can(roles, 'messages.group.all');
    return scope.all(
      `SELECT m.id, m.body, m.audience, m.recipients, m.created_at, u.name AS author FROM group_messages m JOIN users u ON u.id = m.author_id
       WHERE m.studio_id = $studio ${all ? '' : 'AND m.author_id = $me'} ORDER BY m.created_at DESC LIMIT 50`,
      all ? {} : { me: user.id },
    );
  });

  // ——— Powitania (6, P1–P7) ———

  // Właścicielka (welcomes.approve) widzi całe studio i też może napisać powitanie – bez akceptacji samej siebie.
  const welcomer = perm('welcomes.write', 'welcomes.approve');

  app.get('/api/staff/welcome-templates', welcomer, async () => WELCOME_TEMPLATES);

  // P6: klientki trenerki (z rezerwacją u niej albo przypisane do niej) bez powitania.
  // Właścicielka: wszystkie klientki studia, do których nikt jeszcze nie napisał.
  app.get('/api/staff/welcome-todo', welcomer, async (req) => {
    const { scope, user, roles } = ctx(req);
    if (can(roles, 'welcomes.approve'))
      return scope.all(
        `SELECT u.id, u.name, m.goal, MIN(CASE WHEN s.starts_at > $now THEN s.starts_at END) AS first_class
         FROM memberships m JOIN users u ON u.id = m.user_id
         LEFT JOIN bookings b ON b.studio_id = m.studio_id AND b.user_id = u.id AND b.status IN ('booked', 'waitlist', 'attended')
         LEFT JOIN class_sessions s ON s.id = b.session_id
         WHERE m.studio_id = $studio AND m.role = 'client'
           AND NOT EXISTS (SELECT 1 FROM welcome_messages w WHERE w.studio_id = $studio AND w.client_id = u.id AND w.kind = 'trainer')
         GROUP BY u.id ORDER BY first_class IS NULL, first_class`,
        { now: nowIso() },
      );
    return scope.all(
      `SELECT u.id, u.name, m.goal, MIN(CASE WHEN s.starts_at > $now THEN s.starts_at END) AS first_class
       FROM memberships m JOIN users u ON u.id = m.user_id
       LEFT JOIN bookings b ON b.studio_id = m.studio_id AND b.user_id = u.id AND b.status IN ('booked', 'waitlist', 'attended')
       LEFT JOIN class_sessions s ON s.id = b.session_id AND s.trainer_id = $me
       WHERE m.studio_id = $studio AND m.role = 'client' AND (m.trainer_id = $me OR s.id IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM welcome_messages w WHERE w.studio_id = $studio AND w.trainer_id = $me AND w.client_id = u.id AND w.kind = 'trainer')
       GROUP BY u.id ORDER BY first_class IS NULL, first_class`,
      { me: user.id, now: nowIso() },
    );
  });

  app.get('/api/staff/welcomes/sent', welcomer, async (req) => {
    const { scope, user, roles } = ctx(req);
    const all = can(roles, 'welcomes.approve');
    return scope.all(
      `SELECT w.id, w.body, w.status, w.publish_at, w.seen_at, w.video_id, w.created_at, c.name AS client_name, t.name AS trainer_name
       FROM welcome_messages w JOIN users c ON c.id = w.client_id LEFT JOIN users t ON t.id = w.trainer_id
       WHERE w.studio_id = $studio ${all ? '' : 'AND w.trainer_id = $me'} AND w.kind = 'trainer' ORDER BY w.created_at DESC LIMIT 50`,
      all ? {} : { me: user.id },
    );
  });

  // P2/P3: powitanie pisze człowiek – zapisujemy autorkę, bez automatycznego generowania (6.6). Wideo do 30 s, pionowe.
  app.post<{ Body: { clientId: string; body: string; video?: { dataUrl: string; durationSec: number; ratio: number } | null; publishAt?: string | null } }>(
    '/api/staff/welcome',
    { ...welcomer, bodyLimit: 45 * 1024 * 1024 },
    async (req) => {
      const { studio, scope, user, roles } = ctx(req);
      const body = String(req.body?.body ?? '').trim();
      if (body.length < 20) throw badRequest('Napisz kilka zdań – min. 20 znaków.');
      if (body.length > WELCOME_MAX) throw badRequest(`Powitanie może mieć max ${WELCOME_MAX} znaków.`);
      if ((body.match(/!/g) ?? []).length > 3) throw badRequest('Styl „girl vibe”: max 3 wykrzykniki.');
      const mod = moderate(body, { maxLength: WELCOME_MAX, allowLinks: false });
      if (!mod.ok) throw badRequest(MODERATION_COPY[mod.reason]);
      const client = scope.get<{ user_id: string }>("SELECT user_id FROM memberships WHERE studio_id = $studio AND user_id = $c AND role = 'client'", { c: req.body.clientId });
      if (!client) throw notFound('Nie znaleziono klientki.');
      let videoId: string | null = null;
      if (req.body.video) {
        if (!(req.body.video.durationSec > 0 && req.body.video.durationSec <= 30.5)) throw badRequest('Wideo powitalne może mieć max 30 sekund.');
        if (!(req.body.video.ratio < 0.8)) throw badRequest('Nagraj wideo pionowo (9:16).');
        videoId = storeMedia(scope, studio, { dataUrl: req.body.video.dataUrl, kind: 'welcome', ownerId: user.id, durationSec: req.body.video.durationSec, private: true, allow: ['video'] }).id;
      }
      const publishAt = req.body.publishAt && Date.parse(req.body.publishAt) > Date.now() ? new Date(req.body.publishAt).toISOString() : null;
      const status = studio.welcome_approval && !can(roles, 'welcomes.approve') ? 'pending' : publishAt ? 'scheduled' : 'published';
      scope.run(
        `INSERT INTO welcome_messages (id, studio_id, trainer_id, client_id, kind, body, video_id, status, publish_at, created_at)
         VALUES ($id, $studio, $me, $c, 'trainer', $body, $video, $status, $pub, $now)
         ON CONFLICT (studio_id, trainer_id, client_id, kind) DO UPDATE SET body = $body, video_id = COALESCE($video, video_id), status = $status, publish_at = $pub, seen_at = NULL`,
        { id: id(), me: user.id, c: client.user_id, body, video: videoId, status, pub: publishAt, now: nowIso() },
      );
      if (status === 'published') notify(scope, { userId: client.user_id, category: 'courses', tz: studio.timezone, body: TRIGGERS.trainer_message.text({}), action: 'start' });
      return {
        status,
        message: status === 'published' ? 'Powitanie wysłane.' : status === 'scheduled' ? 'Powitanie zaplanowane.' : 'Powitanie czeka na akceptację właścicielki.',
      };
    },
  );

  // ——— Kartki od trenerki (4.12.1, G1) ———

  app.get('/api/staff/cards', perm('cards.write', 'cards.manage'), async (req) => {
    const { scope, user, roles } = ctx(req);
    const all = can(roles, 'cards.manage');
    return scope
      .all<{ id: string; client_id: string; client_name: string; trainer_name: string | null; due_on: string; delivery: string; status: string; goal: string | null }>(
        `SELECT c.id, c.client_id, u.name AS client_name, t.name AS trainer_name, c.due_on, c.delivery, c.status, m.goal FROM card_tasks c
         JOIN users u ON u.id = c.client_id LEFT JOIN users t ON t.id = c.trainer_id
         LEFT JOIN memberships m ON m.studio_id = c.studio_id AND m.user_id = c.client_id AND m.role = 'client'
         WHERE c.studio_id = $studio ${all ? '' : 'AND c.trainer_id = $me'} ORDER BY c.status = 'collected', c.due_on`,
        all ? {} : { me: user.id },
      )
      .map((c) => {
        // Adres widzi tylko osoba wysyłająca (recepcja / właścicielka) i tylko za zgodą klientki.
        const addr = all && c.delivery === 'post' ? unseal<{ line: string; city: string; zip: string }>((db.prepare('SELECT address_enc FROM users WHERE id = ?').get(c.client_id) as { address_enc: string | null }).address_enc) : null;
        return { ...c, address: addr };
      });
  });

  app.patch<{ Params: { id: string }; Body: { status: 'written' | 'sent' | 'collected'; delivery?: 'post' | 'pickup' } }>('/api/staff/cards/:id', perm('cards.write', 'cards.manage'), async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    const card = scope.get<{ client_id: string; trainer_id: string | null; status: string; delivery: string }>('SELECT * FROM card_tasks WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!card) throw notFound();
    if (!can(roles, 'cards.manage') && (card.trainer_id !== user.id || req.body?.status !== 'written')) throw forbidden();
    if (!['written', 'sent', 'collected'].includes(req.body?.status)) throw badRequest('Nieprawidłowy status.');
    scope.run('UPDATE card_tasks SET status = $s, delivery = COALESCE($d, delivery), updated_at = $now WHERE studio_id = $studio AND id = $id', { s: req.body.status, d: req.body.delivery ?? null, id: req.params.id, now: nowIso() });
    if (req.body.status === 'sent' || (req.body.status === 'written' && card.delivery === 'pickup')) {
      notify(scope, { userId: card.client_id, category: 'loyalty', tz: studio.timezone, body: TRIGGERS.card.text({}), dedupeKey: `card:${req.params.id}` });
    }
    return { ok: true };
  });

  // ——— Szafka nagród: kolejka wysyłek i odbiorów (4.12.1) ———

  app.get('/api/staff/locker', perm('cards.manage', 'shop.manage'), async (req) =>
    ctx(req)
      .scope.all<{ user_id: string; delivery: string | null }>(
        `SELECT l.id, l.user_id, l.title, l.size, l.delivery, l.status, l.created_at, u.name AS client_name FROM locker_items l JOIN users u ON u.id = l.user_id
         WHERE l.studio_id = $studio AND l.status IN ('queued', 'ready', 'shipped') ORDER BY l.created_at`,
      )
      .map((l) => ({ ...l, address: l.delivery === 'ship' ? unseal((db.prepare('SELECT address_enc FROM users WHERE id = ?').get(l.user_id) as { address_enc: string | null }).address_enc) : null })),
  );

  app.patch<{ Params: { id: string }; Body: { status: 'ready' | 'shipped' | 'collected' } }>('/api/staff/locker/:id', perm('cards.manage', 'shop.manage'), async (req) => {
    const { scope, studio, user } = ctx(req);
    const item = scope.get<{ user_id: string; title: string }>('SELECT user_id, title FROM locker_items WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!item) throw notFound();
    if (!['ready', 'shipped', 'collected'].includes(req.body?.status)) throw badRequest('Nieprawidłowy status.');
    scope.run('UPDATE locker_items SET status = $s, updated_at = $now WHERE studio_id = $studio AND id = $id', { s: req.body.status, id: req.params.id, now: nowIso() });
    if (req.body.status === 'ready') notify(scope, { userId: item.user_id, category: 'loyalty', tz: studio.timezone, body: TRIGGERS.reward_ready.text({}), action: 'profile/locker' });
    if (req.body.status === 'shipped') notify(scope, { userId: item.user_id, category: 'loyalty', tz: studio.timezone, body: 'Twoja nagroda jest w drodze 🎁', action: 'profile/locker' });
    audit(scope, { actorId: user.id, action: `locker.${req.body.status}`, entity: 'locker', entityId: req.params.id, subjectUserId: item.user_id });
    return { ok: true };
  });

  // ——— Vouchery: kwota na wybrane zajęcia, kod do okazania w recepcji ———

  app.get('/api/staff/vouchers', perm('cards.manage'), async (req) => {
    const { scope } = ctx(req);
    const vouchers = scope
      .all<{ amount_grosze: number; valid_until: string; status: string }>(
        `SELECT v.id, v.code, v.class_type_id, ct.name AS class_name, v.amount_grosze, v.recipient, v.valid_until, v.status, v.created_at, u.name AS created_by_name
         FROM vouchers v LEFT JOIN class_types ct ON ct.id = v.class_type_id LEFT JOIN users u ON u.id = v.created_by
         WHERE v.studio_id = $studio ORDER BY v.status = 'active' DESC, v.created_at DESC LIMIT 50`,
      )
      .map((v) => ({ ...v, amount: formatPLN(v.amount_grosze), expired: v.status === 'active' && v.valid_until < nowIso() }));
    const classTypes = scope.all<{ id: string; name: string; level: string | null }>('SELECT id, name, level FROM class_types WHERE studio_id = $studio ORDER BY name, level');
    return { vouchers, classTypes };
  });

  app.post<{ Body: { classTypeId?: string | null; amount: number; recipient?: string; validDays?: number } }>('/api/staff/vouchers', perm('cards.manage'), async (req) => {
    const { scope, user } = ctx(req);
    const b = req.body ?? ({} as { amount: number });
    const amount = Math.round(Number(b.amount));
    if (!(amount >= 100 && amount <= 1_000_000)) throw badRequest('Kwota vouchera: od 1 do 10 000 zł.');
    const classTypeId = b.classTypeId || null;
    if (classTypeId && !scope.get('SELECT 1 FROM class_types WHERE studio_id = $studio AND id = $c', { c: classTypeId })) throw notFound('Nie znaleziono zajęć.');
    const days = Math.min(365, Math.max(7, Math.round(Number(b.validDays ?? 90))));
    const now = new Date();
    // Kod bez mylących znaków (0/O, 1/I), unikalny w studiu.
    const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do code = `VC-${Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => ALPHABET[x % ALPHABET.length]).join('')}`;
    while (scope.get('SELECT 1 FROM vouchers WHERE studio_id = $studio AND code = $c', { c: code }));
    const vid = id();
    scope.run(
      `INSERT INTO vouchers (id, studio_id, code, class_type_id, amount_grosze, recipient, valid_until, status, created_by, created_at, updated_at)
       VALUES ($id, $studio, $code, $ct, $amt, $rec, $until, 'active', $me, $now, $now)`,
      { id: vid, code, ct: classTypeId, amt: amount, rec: String(b.recipient ?? '').trim().slice(0, 80) || null, until: new Date(now.getTime() + days * 86_400_000).toISOString(), me: user.id, now: now.toISOString() },
    );
    audit(scope, { actorId: user.id, action: 'voucher.created', entity: 'voucher', entityId: vid, details: { code, amount } });
    return { id: vid, code };
  });

  app.patch<{ Params: { id: string }; Body: { status: 'redeemed' | 'cancelled' } }>('/api/staff/vouchers/:id', perm('cards.manage'), async (req) => {
    const { scope, user } = ctx(req);
    if (!['redeemed', 'cancelled'].includes(req.body?.status)) throw badRequest('Nieprawidłowy status.');
    const v = scope.get<{ status: string }>('SELECT status FROM vouchers WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!v) throw notFound();
    if (v.status !== 'active') throw conflict('voucher_closed', 'Ten voucher jest już zamknięty.');
    scope.run('UPDATE vouchers SET status = $s, updated_at = $now WHERE studio_id = $studio AND id = $id', { s: req.body.status, id: req.params.id, now: nowIso() });
    audit(scope, { actorId: user.id, action: `voucher.${req.body.status}`, entity: 'voucher', entityId: req.params.id });
    return { ok: true };
  });

  // ——— Czat z klientkami (4.9) i kontakt po ankiecie uśpionych (4.10) ———

  app.get('/api/staff/chats', perm('chat.answer'), async (req) =>
    ctx(req).scope.all(
      `SELECT c.client_id, u.name, MAX(c.created_at) AS last_at,
              SUM(CASE WHEN c.from_staff = 0 AND c.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
              ${CHAT_LAST_BODY} AS last_body
       FROM chat_messages c JOIN users u ON u.id = c.client_id WHERE c.studio_id = $studio GROUP BY c.client_id ORDER BY last_at DESC`,
    ),
  );

  app.get<{ Params: { clientId: string } }>('/api/staff/chats/:clientId', perm('chat.answer'), async (req) => {
    const { scope } = ctx(req);
    scope.run('UPDATE chat_messages SET read_at = $now WHERE studio_id = $studio AND client_id = $c AND from_staff = 0 AND read_at IS NULL', { c: req.params.clientId, now: nowIso() });
    return chatMessages(scope, req.params.clientId);
  });

  app.post<{ Params: { clientId: string }; Body: ChatInput }>('/api/staff/chats/:clientId', { ...perm('chat.answer'), bodyLimit: CHAT_BODY_LIMIT }, async (req) => {
    const { scope, studio, user } = ctx(req);
    const body = String(req.body?.body ?? '').trim();
    if (body.length > 1000) throw badRequest('Napisz wiadomość (max 1000 znaków).');
    if (!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $c AND role = 'client'", { c: req.params.clientId })) throw notFound();
    postChatMessage(scope, studio, { clientId: req.params.clientId, authorId: user.id, fromStaff: true, body, input: req.body ?? {} });
    notify(scope, { userId: req.params.clientId, category: 'transactional', tz: studio.timezone, title: studio.name, body: body ? 'Recepcja odpisała na Twoją wiadomość 💬' : 'Recepcja przesłała Ci plik 📎', action: 'chat' });
    scope.run("UPDATE dormant_surveys SET status = 'contacted' WHERE studio_id = $studio AND user_id = $c AND status = 'answered' AND wants_proposal = 1", { c: req.params.clientId });
    return { ok: true };
  });

  app.get('/api/staff/followups', perm('clients.contact'), async (req) =>
    ctx(req).scope.all(
      `SELECT d.id, d.user_id, u.name, u.phone, d.reasons_json, d.comment, d.contact_due_at, d.answered_at FROM dormant_surveys d JOIN users u ON u.id = d.user_id
       WHERE d.studio_id = $studio AND d.wants_proposal = 1 AND d.status = 'answered' ORDER BY d.contact_due_at`,
    ),
  );

  app.post<{ Params: { id: string } }>('/api/staff/followups/:id/done', perm('clients.contact'), async (req) => {
    ctx(req).scope.run("UPDATE dormant_surveys SET status = 'contacted' WHERE studio_id = $studio AND id = $id", { id: req.params.id });
    return { ok: true };
  });

  // Skrzynka personelu: przypomnienia o powitaniach, nieobecności, alerty.
  app.get('/api/staff/inbox', staff, async (req) => {
    const { scope, user } = ctx(req);
    const items = scope.all("SELECT id, body, action, deliver_at, read_at FROM notifications WHERE studio_id = $studio AND user_id = $u AND status != 'suppressed' AND deliver_at <= $now ORDER BY deliver_at DESC LIMIT 30", { u: user.id, now: nowIso() });
    scope.run('UPDATE notifications SET read_at = $now WHERE studio_id = $studio AND user_id = $u AND read_at IS NULL', { u: user.id, now: nowIso() });
    return items;
  });

}

/** Zajęcia trenerki w okresie nieobecności + propozycje zastępstw (kwalifikacje, brak kolizji, brak urlopu). */
function affectedSessions(scope: StudioScope, studio: Studio, a: { trainer_id: string; date_from: string; date_to: string }) {
  const sessions = scope.all<{ id: string; starts_at: string; ends_at: string; class_type_id: string; class_name: string; trainer_id: string }>(
    `SELECT s.id, s.starts_at, s.ends_at, s.class_type_id, s.trainer_id, COALESCE(s.title, ct.name) AS class_name FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
     WHERE s.studio_id = $studio AND s.status = 'scheduled' AND s.trainer_id = $t AND s.starts_at >= $f AND s.starts_at < $to ORDER BY s.starts_at`,
    { t: a.trainer_id, f: zonedToUtc(a.date_from, '00:00', studio.timezone).toISOString(), to: zonedToUtc(addDays(a.date_to, 1), '00:00', studio.timezone).toISOString() },
  );
  const trainers = scope.all<{ id: string; name: string }>("SELECT u.id, u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'trainer' AND u.id != $t", { t: a.trainer_id });
  return sessions.map((s) => {
    const day = localParts(new Date(s.starts_at), studio.timezone).date;
    const suggestions = trainers.filter((t) => {
      const qualified = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM trainer_class_types WHERE studio_id = $studio AND trainer_id = $t', { t: t.id })!.n === 0 || !!scope.get('SELECT 1 FROM trainer_class_types WHERE studio_id = $studio AND trainer_id = $t AND class_type_id = $c', { t: t.id, c: s.class_type_id });
      const busy = scope.get("SELECT 1 FROM class_sessions WHERE studio_id = $studio AND trainer_id = $t AND status = 'scheduled' AND starts_at < $e AND ends_at > $s", { t: t.id, s: s.starts_at, e: s.ends_at });
      const away = scope.get('SELECT 1 FROM trainer_absences WHERE studio_id = $studio AND trainer_id = $t AND date_from <= $d AND date_to >= $d', { t: t.id, d: day });
      return qualified && !busy && !away;
    });
    return { ...s, suggestions };
  });
}

