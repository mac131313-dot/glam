// Ścieżki klientki w kontekście studia: Start, Grafik, rezerwacje (we dwie, cykliczne, potwierdzenie, ocena),
// karnety (zakup z kodem, zawieszenie, odnawianie), płatności i faktury, wejściówki i polecenia, lojalność
// i „Moja szafka”, cel tygodnia, dobrostan, NPS, ankieta uśpionych, czat z recepcją, powiadomienia.
import type { FastifyInstance } from 'fastify';
import {
  addDays,
  affirmationFor,
  breathRitual,
  dayPart,
  describePass,
  describeRules,
  formatPLN,
  greeting,
  initialBalances,
  levelFor,
  localParts,
  moderate,
  MODERATION_COPY,
  nextReceptionLabel,
  passValidity,
  planFreeze,
  quizDue,
  receptionOpen,
  REFERRAL_STATUS_COPY,
  ritualFor,
  themeVisibleFor,
  toMinutes,
  unlockedFrames,
  weekdayTint,
  zonedToUtc,
  EVENT_KINDS,
  type ProductRules,
  type SeasonalEffect,
} from '@glam/core';
import { normalizePhone } from '../auth.ts';
import { ctx, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { PAYMENT_METHODS, type PaymentMethod } from '../sms.ts';
import { bookSession, cancelBooking, confirmAttendance, rateSession } from '../services/booking.ts';
import { checkinCode } from '../services/checkin.ts';
import { logUsage } from '../services/dispatch.ts';
import { attendedCount, awardPoints, badgeList, pointsOf, rewardProgress } from '../services/motivation.ts';
import { notify } from '../services/notify.ts';
import { issuePass, loadPasses, passRows } from '../services/passes.ts';
import { issueInvoice, priceWithCoupon, purchaseProduct, recordPayment } from '../services/payments.ts';
import { weekProgress } from '../services/progress.ts';
import { segmentsForUser } from '../services/segments.ts';
import { claimClientSms } from '../services/sms-quota.ts';
import { assertAttemptsLeft, recordFailedAttempt } from '../services/attempts.ts';
import { logoInfo, type Studio } from '../services/studio.ts';
import { guestRules, prefsOf } from './account.ts';

/** Ile nietrafionych kodów rabatowych w kwadransie, zanim sprawdzanie się zatrzyma. */
export const COUPON_MISSES = 10;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function guestCode(len = 8) {
  return Array.from(crypto.getRandomValues(new Uint8Array(len)), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

type ThemeView = { id: string; name: string; tagline: string; emoji: string; palette: Record<string, string>; effect: SeasonalEffect | null; sound: string | null; icon: string | null; pack: Record<string, unknown> };

export function activeTheme(scope: StudioScope, userId?: string): ThemeView | null {
  const t = scope.get<{ id: string; name: string; tagline: string; emoji: string; palette_json: string; effect: SeasonalEffect | null; segment: string | null; sound: string | null; icon: string | null; pack_json: string | null }>(
    'SELECT id, name, tagline, emoji, palette_json, effect, segment, sound, icon, pack_json FROM themes WHERE studio_id = $studio AND is_active = 1',
  );
  if (!t) return null;
  // Motyw dla segmentu (M3): widzą go tylko klientki z tego segmentu.
  if (t.segment && userId && !themeVisibleFor(t.segment, segmentsForUser(scope, userId))) return null;
  return { id: t.id, name: t.name, tagline: t.tagline, emoji: t.emoji, palette: JSON.parse(t.palette_json), effect: t.effect, sound: t.sound, icon: t.icon, pack: t.pack_json ? JSON.parse(t.pack_json) : {} };
}

export function classTypeNames(scope: StudioScope) {
  const rows = scope.all<{ id: string; name: string }>('SELECT id, name FROM class_types WHERE studio_id = $studio');
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export function nameMaps(scope: StudioScope) {
  const zones = scope.all<{ id: string; name: string }>('SELECT id, name FROM zones WHERE studio_id = $studio');
  return { classTypes: classTypeNames(scope), zones: Object.fromEntries(zones.map((z) => [z.id, z.name])) };
}

/** Adres zdjęcia typu zajęć z wersją (cache bez końca, nowa wersja = nowy adres; NULL, gdy brak zdjęcia) i jego proporcje. */
export const PHOTO_URL = "CASE WHEN ct.photo_mime IS NOT NULL THEN '/api/class-types/' || ct.id || '/photo?v=' || ct.photo_version END AS photo_url, ct.photo_ratio";

export function scheduleRows(scope: StudioScope, userId: string, fromIso: string, toIso: string, includePrivate = false) {
  return scope.all<Record<string, unknown>>(
    `SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.trainer_id, s.kind, s.template_id, s.theme_id,
            COALESCE(s.title, ct.name) AS class_name, ct.id AS class_type_id, ct.color, ct.level, ct.description, ${PHOTO_URL},
            z.id AS zone_id, z.name AS zone_name, u.name AS trainer_name,
            (SELECT p.name FROM playlists p WHERE p.id = COALESCE(s.playlist_id, ct.playlist_id)) AS playlist_name,
            (SELECT p.url FROM playlists p WHERE p.id = COALESCE(s.playlist_id, ct.playlist_id)) AS playlist_url,
            (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')) AS taken,
            (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'waitlist') AS waiting,
            (SELECT b.id FROM bookings b WHERE b.session_id = s.id AND b.user_id = $user AND b.guest_name IS NULL AND b.status IN ('booked', 'waitlist', 'attended')) AS my_booking_id,
            (SELECT b.status FROM bookings b WHERE b.session_id = s.id AND b.user_id = $user AND b.guest_name IS NULL AND b.status IN ('booked', 'waitlist', 'attended')) AS my_status,
            (SELECT b.confirmed_at FROM bookings b WHERE b.session_id = s.id AND b.user_id = $user AND b.guest_name IS NULL AND b.status = 'booked') AS my_confirmed_at,
            (SELECT b.guest_name FROM bookings b WHERE b.session_id = s.id AND b.user_id = $user AND b.guest_name IS NOT NULL AND b.status IN ('booked', 'attended')) AS my_guest,
            (SELECT r.id FROM recurring_bookings r WHERE r.studio_id = $studio AND r.user_id = $user AND r.template_id = s.template_id AND r.active = 1) AS my_recurring_id
     FROM class_sessions s
     JOIN class_types ct ON ct.id = s.class_type_id
     JOIN zones z ON z.id = ct.zone_id
     JOIN users u ON u.id = s.trainer_id
     WHERE s.studio_id = $studio AND s.starts_at >= $from AND s.starts_at < $to ${includePrivate ? '' : 'AND s.public = 1'}
     ORDER BY s.starts_at`,
    { user: userId, from: fromIso, to: toIso },
  );
}

export function passesView(scope: StudioScope, studio: Studio, userId: string) {
  const names = classTypeNames(scope);
  const now = Date.now();
  const freezes = scope.all<{ pass_id: string; date_from: string; date_to: string; ended_at: string | null; id: string }>('SELECT id, pass_id, date_from, date_to, ended_at FROM pass_freezes WHERE studio_id = $studio AND user_id = $u', { u: userId });
  return passRows(scope, userId).map((r) => {
    const rules = JSON.parse(r.rules_json) as ProductRules;
    const p = loadPasses(scope, userId).find((x) => x.id === r.id);
    const status = p?.status ?? r.status;
    const limits = rules.freeze ?? studio.settings.freeze;
    const upcomingFreeze = freezes.find((f) => f.pass_id === r.id && !f.ended_at);
    return {
      id: r.id,
      productName: r.product_name,
      status,
      source: r.source,
      validUntil: r.valid_until,
      balances: JSON.parse(r.balances_json),
      unlimited: !!rules.unlimited,
      autoRenew: !!r.auto_renew,
      canAutoRenew: !!rules.autoRenew || !!r.auto_renew,
      summary: p ? describePass(p, studio.timezone, names) : r.product_name,
      lines: describeRules(rules, nameMaps(scope)),
      expiringSoon: status === 'active' && Date.parse(r.valid_until) - now < 7 * 86_400_000,
      freeze: { left: Math.max(0, limits.maxTimes - r.freezes_used), daysLeft: Math.max(0, limits.maxDays - r.freeze_days_used), current: upcomingFreeze ?? null },
      guestsPerMonth: rules.guestsPerMonth ?? 0,
      waitingActivation: rules.validFrom === 'activation' && !r.activated_at,
    };
  });
}

export function clientRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };

  app.get('/api/studio', member, async (req) => {
    const { studio, scope, roles, user } = ctx(req);
    const trainers = scope.all<{ id: string; name: string; bio: string | null; avatar_mime: string | null; avatar_version: number }>(
      "SELECT u.id, u.name, m.bio, u.avatar_mime, u.avatar_version FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'trainer' ORDER BY u.name",
    );
    const s = studio.settings;
    const features = ['courses', 'challenges', 'community', 'shop', 'events', 'music', 'loyalty', 'health', 'cycle', 'beta_widgets'].filter((f) => studio.has(f as never));
    return {
      id: studio.id,
      name: studio.name,
      city: studio.city,
      timezone: studio.timezone,
      tagline: studio.tagline,
      logo: studio.logo,
      accent: studio.accent,
      look: studio.look,
      ...logoInfo(studio),
      phone: studio.phone,
      email: studio.email,
      address: studio.address,
      inviteCode: studio.invite_code,
      policy: studio.policy,
      regulations: studio.regulations,
      guestPassPrice: formatPLN(s.guestPass.variants[0]?.priceGrosze ?? studio.guest_pass_price),
      guestPassVariants: s.guestPass.variants.map((v) => ({ ...v, price: formatPLN(v.priceGrosze) })),
      guestPassValidityDays: s.guestPass.validityDays,
      referral: s.referral,
      freeze: s.freeze,
      support: { hours: s.support.hours, faq: s.support.faq },
      events: { enabled: s.events.enabled && studio.has('events'), regulations: s.events.regulations, minNoticeDays: s.events.minNoticeDays, kinds: EVENT_KINDS },
      loyalty: { enabled: s.loyalty.enabled && studio.has('loyalty'), levels: s.loyalty.levels, points: s.loyalty.points },
      reward: s.tenClassReward,
      shop: s.shop,
      features,
      roles,
      theme: user.theme_opt_out ? null : activeTheme(scope, user.id),
      trainers: trainers.map((t) => ({ id: t.id, name: t.name, bio: t.bio, avatarUrl: t.avatar_mime ? `/api/users/${t.id}/avatar?v=${t.avatar_version}` : null })),
    };
  });

  // Ekran Start: powitanie, najbliższe zajęcia, stan karnetu, cel tygodnia, motyw, powitanie od trenerki i to, co czeka.
  app.get('/api/home', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    const now = new Date();
    const lp = localParts(now, studio.timezone);
    const upcoming = scope.all<Record<string, unknown>>(
      `SELECT b.id AS booking_id, b.status, b.confirmed_at, s.id AS session_id, s.starts_at, COALESCE(s.title, ct.name) AS class_name, u.name AS trainer_name, z.name AS zone_name, ${PHOTO_URL}
       FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id
       JOIN zones z ON z.id = ct.zone_id JOIN users u ON u.id = s.trainer_id
       WHERE b.studio_id = $studio AND b.user_id = $user AND b.guest_name IS NULL AND b.status IN ('booked', 'waitlist') AND s.starts_at > $now
       ORDER BY s.starts_at LIMIT 3`,
      { user: user.id, now: now.toISOString() },
    );
    const welcome = scope.get<Record<string, unknown>>(
      `SELECT w.id, w.body, w.kind, w.video_id, u.name AS trainer_name FROM welcome_messages w LEFT JOIN users u ON u.id = w.trainer_id
       WHERE w.studio_id = $studio AND w.client_id = $user AND w.status = 'published' AND w.seen_at IS NULL ORDER BY w.created_at LIMIT 1`,
      { user: user.id },
    );
    const unread = scope.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM notifications WHERE studio_id = $studio AND user_id = $user AND status != 'suppressed' AND deliver_at <= $now AND read_at IS NULL",
      { user: user.id, now: now.toISOString() },
    )!.n;
    const chatUnread = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM chat_messages WHERE studio_id = $studio AND client_id = $u AND from_staff = 1 AND read_at IS NULL', { u: user.id })!.n;
    const theme = user.theme_opt_out ? null : activeTheme(scope, user.id);
    // Kolekcjonerka (7.5): zapamiętujemy, jakie motywy klientka już widziała.
    const prefs = prefsOf(user);
    if (theme && !(prefs.themesSeen ?? []).includes(theme.id)) {
      db.prepare('UPDATE users SET prefs_json = ? WHERE id = ?').run(JSON.stringify({ ...prefs, themesSeen: [...(prefs.themesSeen ?? []), theme.id] }), user.id);
    }
    const s = studio.settings;
    const points = pointsOf(scope, user.id);
    const nps = scope.get<{ id: string; trigger: string }>('SELECT id, trigger FROM nps_responses WHERE studio_id = $studio AND user_id = $u AND score IS NULL AND answered_at IS NULL ORDER BY created_at LIMIT 1', { u: user.id });
    const survey = scope.get<{ id: string }>("SELECT id FROM dormant_surveys WHERE studio_id = $studio AND user_id = $u AND status = 'sent' ORDER BY created_at DESC LIMIT 1", { u: user.id });
    const locker = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM locker_items WHERE studio_id = $studio AND user_id = $u AND status IN ('choose', 'ready')", { u: user.id })!.n;
    const eventToday = scope.get<{ id: string; kind: string; starts_at: string }>(
      "SELECT id, kind, starts_at FROM private_events WHERE studio_id = $studio AND client_id = $u AND status IN ('confirmed', 'paid') AND starts_at >= $from AND starts_at < $to",
      { u: user.id, from: zonedToUtc(lp.date, '00:00', studio.timezone).toISOString(), to: zonedToUtc(addDays(lp.date, 1), '00:00', studio.timezone).toISOString() },
    );
    const invites = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM session_invites WHERE studio_id = $studio AND to_user = $u AND status = 'sent'", { u: user.id })!.n;
    const challenge = scope.get<{ id: string; title: string }>('SELECT id, title FROM challenges WHERE studio_id = $studio AND starts_on <= $d AND ends_on >= $d ORDER BY starts_on DESC LIMIT 1', { d: lp.date });
    const firstClass = attendedCount(scope, user.id) === 0;
    return {
      greeting: `${greeting(lp.minutes)}${user.name ? `, ${user.name}` : ''}`,
      dayPart: dayPart(now, studio.timezone),
      weekdayTint: weekdayTint(lp.weekday),
      birthday: user.birthday === lp.date.slice(5),
      eventToday: eventToday ? { ...eventToday, hero: EVENT_KINDS.find((k) => k.id === eventToday.kind)?.hero ?? 'Dziś Twoje wydarzenie w studiu' } : null,
      theme,
      upcoming,
      confirmNeeded: upcoming.find((u) => u.status === 'booked' && !u.confirmed_at && Date.parse(String(u.starts_at)) - now.getTime() <= s.confirmBeforeMinutes * 60_000) ?? null,
      passes: passesView(scope, studio, user.id).filter((p) => p.status === 'active' || p.status === 'frozen'),
      week: weekProgress(scope, studio, user.id, now),
      ritual: ritualFor(lp.date),
      welcome,
      unread,
      chatUnread,
      reward: rewardProgress(scope, studio, user.id),
      loyalty: s.loyalty.enabled && studio.has('loyalty') ? { points, ...levelFor(points, s.loyalty.levels) } : null,
      nps,
      survey,
      locker,
      invites,
      challenge,
      firstClass,
      quizDue: quizDue(prefs.quiz?.takenAt, now),
      onboarded: !!user.onboarded_at,
      restToday: user.rest_day === lp.date,
      eventsEnabled: s.events.enabled && studio.has('events'),
    };
  });

  app.get<{ Querystring: { from?: string; days?: string } }>('/api/schedule', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : localParts(new Date(), studio.timezone).date;
    const days = Math.min(Math.max(Number(req.query.days ?? 7) || 7, 1), 42);
    const rows = scheduleRows(scope, user.id, zonedToUtc(from, '00:00', studio.timezone).toISOString(), zonedToUtc(addDays(from, days), '00:00', studio.timezone).toISOString());
    return { from, days, sessions: rows };
  });

  app.post<{ Body: { sessionId: string; guest?: { name: string; phone?: string } | null } }>('/api/bookings', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    if (!req.body?.sessionId) throw badRequest('Wybierz zajęcia.');
    const guest = req.body.guest ? { name: String(req.body.guest.name ?? '').slice(0, 60), phone: req.body.guest.phone ? normalizePhone(req.body.guest.phone) : null } : null;
    return bookSession(scope, studio, user.id, req.body.sessionId, new Date(), { guest });
  });

  app.delete<{ Params: { id: string } }>('/api/bookings/:id', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    return cancelBooking(scope, studio, req.params.id, { userId: user.id, isStaff: false });
  });

  app.post<{ Params: { id: string } }>('/api/bookings/:id/confirm', member, async (req) => {
    const { scope, user } = ctx(req);
    confirmAttendance(scope, user.id, req.params.id);
    return { message: 'Dziękujemy – czekamy na Ciebie 💛' };
  });

  app.post<{ Params: { id: string }; Body: { rating: number; comment?: string } }>('/api/bookings/:id/rate', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const c = req.body?.comment?.trim() || null;
    if (c) {
      const m = moderate(c, { maxLength: 500 });
      if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    }
    rateSession(scope, user.id, req.params.id, req.body?.rating, c);
    awardPoints(scope, studio, user.id, 'review', req.params.id, studio.settings.loyalty.points.review);
    return { message: 'Dziękujemy za ocenę.' };
  });

  app.get('/api/calendar-sync', member, async (req) => {
    const { user } = ctx(req);
    return { hasToken: !!(db.prepare('SELECT calendar_token FROM users WHERE id = ?').get(user.id) as { calendar_token: string | null }).calendar_token };
  });

  // Rezerwacja cykliczna „na stałe” (4.1) – job zapisuje na kolejne terminy, gdy otwierają się zapisy.
  app.post<{ Body: { templateId: string } }>('/api/recurring', member, async (req) => {
    const { scope, user, studio } = ctx(req);
    const t = scope.get<{ id: string }>('SELECT id FROM schedule_templates WHERE studio_id = $studio AND id = $t', { t: req.body?.templateId });
    if (!t) throw notFound('Te zajęcia nie są cykliczne.');
    scope.run(
      `INSERT INTO recurring_bookings (id, studio_id, user_id, template_id, active, created_at) VALUES ($id, $studio, $u, $t, 1, $now)
       ON CONFLICT (studio_id, user_id, template_id) DO UPDATE SET active = 1`,
      { id: id(), u: user.id, t: t.id, now: nowIso() },
    );
    // Od razu zapisujemy na terminy, które już są otwarte.
    const open = scope.all<{ id: string }>(
      `SELECT s.id FROM class_sessions s WHERE s.studio_id = $studio AND s.template_id = $t AND s.status = 'scheduled' AND s.starts_at > $from AND s.starts_at <= $to
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = s.id AND b.user_id = $u AND b.guest_name IS NULL AND b.status IN ('booked', 'waitlist', 'attended'))`,
      { t: t.id, u: user.id, from: new Date(Date.now() + studio.policy.closesMinutesBefore * 60_000).toISOString(), to: new Date(Date.now() + studio.policy.opensDaysAhead * 86_400_000).toISOString() },
    );
    let booked = 0;
    for (const s of open) {
      try {
        bookSession(scope, studio, user.id, s.id, new Date(), { source: 'recurring' });
        booked++;
      } catch {
        /* brak karnetu lub miejsc – spróbujemy przy kolejnym terminie */
      }
    }
    return { message: booked ? `Stała rezerwacja ustawiona. Zapisałyśmy Cię na ${booked} najbliższe terminy.` : 'Stała rezerwacja ustawiona. Zapiszemy Cię, gdy otworzą się zapisy.' };
  });

  app.delete<{ Params: { id: string } }>('/api/recurring/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('UPDATE recurring_bookings SET active = 0 WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id });
    return { message: 'Stała rezerwacja wyłączona. Zapisane terminy zostają.' };
  });

  app.get('/api/my/recurring', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope.all(
      `SELECT r.id, t.weekday, t.start_time, ct.name AS class_name, u.name AS trainer_name FROM recurring_bookings r
       JOIN schedule_templates t ON t.id = r.template_id JOIN class_types ct ON ct.id = t.class_type_id JOIN users u ON u.id = t.trainer_id
       WHERE r.studio_id = $studio AND r.user_id = $u AND r.active = 1 ORDER BY t.weekday, t.start_time`,
      { u: user.id },
    );
  });

  // „Umów się z dziewczynami” (4.5): zaproszenie znajomej z tego studia na te same zajęcia.
  app.post<{ Params: { id: string }; Body: { phone: string } }>('/api/sessions/:id/invite', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const phone = normalizePhone(req.body?.phone);
    const s = scope.get<{ starts_at: string; class_name: string }>("SELECT s.starts_at, ct.name AS class_name FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id WHERE s.studio_id = $studio AND s.id = $id AND s.status = 'scheduled' AND s.public = 1", { id: req.params.id });
    if (!s) throw notFound('Nie znaleziono zajęć.');
    if (phone === user.phone) throw badRequest('Podaj numer koleżanki.');
    claimClientSms(scope, user.id, 'session_invite', phone);
    const friend = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
    const isMember = friend && scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: friend.id });
    const inviteId = id();
    scope.run("INSERT INTO session_invites (id, studio_id, session_id, from_user, to_user, to_phone, status, created_at) VALUES ($id, $studio, $s, $f, $t, $p, 'sent', $now)", {
      id: inviteId,
      s: req.params.id,
      f: user.id,
      t: isMember ? friend!.id : null,
      p: phone,
      now: nowIso(),
    });
    const time = localParts(new Date(s.starts_at), studio.timezone);
    if (isMember) notify(scope, { userId: friend!.id, category: 'community', tz: studio.timezone, body: `${user.name ?? 'Znajoma'} zaprasza Cię na ${s.class_name} ${time.date.slice(8)}.${time.date.slice(5, 7)} o ${time.time} 💛`, action: 'invites' });
    else {
      await deps.sms.send(phone, `${user.name ?? 'Znajoma'} zaprasza Cię na ${s.class_name} w ${studio.name} (${time.date.slice(8)}.${time.date.slice(5, 7)}, ${time.time}). Dołącz w aplikacji GLAM, kod studia: ${studio.invite_code}.`);
      logUsage(db, studio.id, 'sms', 1, 9);
    }
    // Ta sama odpowiedź w obu przypadkach – nie zdradzamy, czy numer należy do klientki studia.
    return { message: 'Zaproszenie wysłane.' };
  });

  app.get('/api/my/invites', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope.all(
      `SELECT i.id, i.status, s.id AS session_id, s.starts_at, ct.name AS class_name, f.name AS from_name FROM session_invites i
       JOIN class_sessions s ON s.id = i.session_id JOIN class_types ct ON ct.id = s.class_type_id JOIN users f ON f.id = i.from_user
       WHERE i.studio_id = $studio AND i.to_user = $u AND s.starts_at > $now ORDER BY s.starts_at`,
      { u: user.id, now: nowIso() },
    );
  });

  app.post<{ Params: { id: string }; Body: { accept: boolean } }>('/api/session-invites/:id', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const inv = scope.get<{ session_id: string; from_user: string }>("SELECT session_id, from_user FROM session_invites WHERE studio_id = $studio AND id = $id AND to_user = $u AND status = 'sent'", { id: req.params.id, u: user.id });
    if (!inv) throw notFound('Nie znaleziono zaproszenia.');
    if (!req.body?.accept) {
      scope.run("UPDATE session_invites SET status = 'declined' WHERE studio_id = $studio AND id = $id", { id: req.params.id });
      return { message: 'Może następnym razem 🌿' };
    }
    const res = bookSession(scope, studio, user.id, inv.session_id, new Date(), { source: 'invite' });
    scope.run("UPDATE session_invites SET status = 'accepted' WHERE studio_id = $studio AND id = $id", { id: req.params.id });
    notify(scope, { userId: inv.from_user, category: 'community', tz: studio.timezone, body: `${user.name ?? 'Twoja znajoma'} dołączyła do Twojego treningu!`, action: 'schedule' });
    return res;
  });

  app.get('/api/my/bookings', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope.all(
      `SELECT b.id, b.status, b.rating, b.guest_name, s.starts_at, COALESCE(s.title, ct.name) AS class_name, u.name AS trainer_name
       FROM bookings b JOIN class_sessions s ON s.id = b.session_id JOIN class_types ct ON ct.id = s.class_type_id JOIN users u ON u.id = s.trainer_id
       WHERE b.studio_id = $studio AND b.user_id = $user ORDER BY s.starts_at DESC LIMIT 80`,
      { user: user.id },
    );
  });

  // ——— Karnety ———

  app.get('/api/my/passes', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    return passesView(scope, studio, user.id);
  });

  app.post<{ Params: { id: string }; Body: { from: string; to: string; reason: 'vacation' | 'illness' | 'pregnancy' | 'loss' | 'other'; wantsSupport?: boolean } }>('/api/passes/:id/freeze', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    const b = req.body ?? ({} as typeof req.body);
    if (!['vacation', 'illness', 'pregnancy', 'loss', 'other'].includes(b.reason)) throw badRequest('Wybierz powód zawieszenia.');
    const row = scope.get<{ rules_json: string; valid_until: string; status: string; freezes_used: number; freeze_days_used: number }>('SELECT * FROM passes WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id });
    if (!row) throw notFound('Nie znaleziono karnetu.');
    const rules = JSON.parse(row.rules_json) as ProductRules;
    const plan = planFreeze(rules.freeze ?? studio.settings.freeze, { timesUsed: row.freezes_used, daysUsed: row.freeze_days_used, validUntil: row.valid_until, status: row.status }, { from: b.from, to: b.to }, localParts(new Date(), studio.timezone).date);
    if (!plan.ok) throw conflict('freeze', plan.reason);
    scope.tx(() => {
      scope.run('UPDATE passes SET valid_until = $u, freezes_used = freezes_used + 1, freeze_days_used = freeze_days_used + $d WHERE studio_id = $studio AND id = $id', { u: plan.validUntil, d: plan.days, id: req.params.id });
      scope.run(
        `INSERT INTO pass_freezes (id, studio_id, pass_id, user_id, date_from, date_to, reason, wants_support, created_at)
         VALUES ($id, $studio, $p, $u, $f, $t, $r, $s, $now)`,
        // Wsparcie w trudnych chwilach tylko na wyraźną prośbę (8.1.4) – nie wnioskujemy z powodu zawieszenia.
        { id: id(), p: req.params.id, u: user.id, f: b.from, t: b.to, r: b.reason, s: Number(!!b.wantsSupport), now: nowIso() },
      );
      if (b.from <= localParts(new Date(), studio.timezone).date) scope.run("UPDATE passes SET status = 'frozen', frozen_until = $t WHERE studio_id = $studio AND id = $id", { id: req.params.id, t: b.to });
    });
    return { message: `Karnet zawieszony na ${plan.days} dni. Ważność przesunęłyśmy o ten czas.` };
  });

  // Rezygnacja z odnawiania subskrypcji: opłacony okres zostaje do końca.
  app.post<{ Params: { id: string } }>('/api/my/passes/:id/cancel-renewal', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const p = scope.get<{ auto_renew: number; valid_until: string }>('SELECT auto_renew, valid_until FROM passes WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id });
    if (!p) throw notFound('Nie znaleziono karnetu.');
    if (!p.auto_renew) throw conflict('not_renewing', 'Ten karnet i tak się nie odnawia.');
    scope.run('UPDATE passes SET auto_renew = 0 WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    const until = localParts(new Date(p.valid_until), studio.timezone).date.split('-').reverse().join('.');
    return { message: `Odnawianie wyłączone. Opłacony czas zostaje do ${until}.` };
  });

  app.patch<{ Params: { id: string }; Body: { autoRenew: boolean } }>('/api/passes/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    if (typeof req.body?.autoRenew !== 'boolean') throw badRequest('Wybierz, czy karnet ma się odnawiać.');
    const autoRenew = req.body.autoRenew;
    const p = scope.get<{ rules_json: string }>('SELECT rules_json FROM passes WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id });
    if (!p) throw notFound('Nie znaleziono karnetu.');
    // Włączyć odnawianie można tylko w karnecie, którego produkt je przewiduje; wyłączyć – zawsze.
    if (autoRenew && !(JSON.parse(p.rules_json) as ProductRules).autoRenew) throw conflict('no_renewal', 'Ten karnet nie odnawia się automatycznie – kup kolejny, gdy się skończy.');
    scope.run('UPDATE passes SET auto_renew = $a WHERE studio_id = $studio AND id = $id AND user_id = $u', { a: Number(autoRenew), id: req.params.id, u: user.id });
    return { message: autoRenew ? 'Karnet będzie się odnawiał automatycznie.' : 'Automatyczne odnawianie wyłączone.' };
  });

  app.get('/api/products', member, async (req) => {
    const { scope } = ctx(req);
    const names = nameMaps(scope);
    return scope
      .all<{ id: string; name: string; description: string | null; price_grosze: number; rules_json: string }>(
        `SELECT p.id, p.name, p.description, v.price_grosze, v.rules_json FROM products p JOIN product_versions v ON v.id = p.current_version_id
         WHERE p.studio_id = $studio AND p.published = 1 AND p.channels_json LIKE '%"app"%' ORDER BY p.sort`,
      )
      .map((p) => {
        const rules = JSON.parse(p.rules_json) as ProductRules;
        // billing: miejsce na paywallu pakietu zajęć (rok / tydzień / jednorazowo); null = zwykły karnet.
        return { id: p.id, name: p.name, description: p.description, price: formatPLN(p.price_grosze), priceGrosze: p.price_grosze, validityDays: rules.validityDays, billing: rules.billing ?? null, autoRenew: !!rules.autoRenew, lines: describeRules(rules, names) };
      });
  });

  app.post<{ Body: { code: string; kind?: 'pass' | 'course' | 'event' | 'shop' | 'guest_pass'; productId?: string; amountGrosze: number } }>('/api/coupons/check', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    // Zgadywanie kodów: po 10 nietrafionych w kwadransie sprawdzanie stoi do końca okna.
    const key = `coupon:${studio.id}:${user.id}`;
    assertAttemptsLeft(key, COUPON_MISSES, 15 * 60_000, 'Za dużo nietrafionych kodów. Spróbuj ponownie za kwadrans.');
    try {
      const r = priceWithCoupon(scope, studio, { code: req.body?.code, userId: user.id, kind: req.body?.kind ?? 'pass', productId: req.body?.productId, amountGrosze: Number(req.body?.amountGrosze) || 0 });
      return { label: r.coupon?.label, discount: formatPLN(r.discount), final: formatPLN(r.final), finalGrosze: r.final };
    } catch (err) {
      if (err instanceof HttpError && err.status < 500) recordFailedAttempt(key);
      throw err;
    }
  });

  app.post<{ Body: { productId: string; method: PaymentMethod; couponCode?: string; autoRenew?: boolean } }>('/api/purchases', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    const method = req.body?.method;
    if (!PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) throw badRequest('Wybierz metodę płatności.');
    return purchaseProduct(deps, scope, studio, { userId: user.id, productId: req.body.productId, method, couponCode: req.body.couponCode, channel: 'app', actorId: user.id, autoRenew: req.body.autoRenew });
  });

  // ——— Płatności i faktury (4.2) ———

  app.get('/api/my/payments', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope
      .all<{ id: string; kind: string; amount_grosze: number; discount_grosze: number; method: string; created_at: string; description: string | null; invoice_id: string | null; number: string | null }>(
        `SELECT p.id, p.kind, p.amount_grosze, p.discount_grosze, p.method, p.created_at, p.description, p.invoice_id, i.number
         FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id WHERE p.studio_id = $studio AND p.user_id = $u ORDER BY p.created_at DESC`,
        { u: user.id },
      )
      .map((p) => ({ ...p, amount: formatPLN(p.amount_grosze), discount: p.discount_grosze ? formatPLN(p.discount_grosze) : null, invoiceUrl: p.invoice_id ? `/api/invoices/${p.invoice_id}` : null }));
  });

  app.post<{ Params: { id: string }; Body: { name: string; nip?: string; address?: string; email?: string } }>('/api/payments/:id/invoice', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    if (!scope.get('SELECT 1 FROM payments WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id })) throw notFound('Nie znaleziono płatności.');
    if (!req.body?.name?.trim()) throw badRequest('Podaj imię i nazwisko albo nazwę firmy.');
    const inv = issueInvoice(scope, studio, req.params.id, { name: req.body.name.trim(), nip: req.body.nip ?? null, address: req.body.address ?? null, email: req.body.email ?? user.email });
    return { invoiceUrl: `/api/invoices/${inv.id}`, number: inv.number };
  });

  // ——— Powitania i powiadomienia ———

  // Skrzynka „Od Twojej trenerki” (P7).
  app.get('/api/welcome', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope.all(
      `SELECT w.id, w.body, w.kind, w.video_id, w.created_at, w.seen_at, u.name AS trainer_name FROM welcome_messages w LEFT JOIN users u ON u.id = w.trainer_id
       WHERE w.studio_id = $studio AND w.client_id = $user AND w.status = 'published' ORDER BY w.created_at DESC`,
      { user: user.id },
    );
  });

  app.post<{ Params: { id: string } }>('/api/welcome/:id/seen', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('UPDATE welcome_messages SET seen_at = $now WHERE studio_id = $studio AND id = $id AND client_id = $user AND seen_at IS NULL', { id: req.params.id, user: user.id, now: nowIso() });
    return { ok: true };
  });

  app.get('/api/inbox', member, async (req) => {
    const { scope, user } = ctx(req);
    const now = nowIso();
    const items = scope.all(
      `SELECT id, category, title, body, action, deliver_at, read_at FROM notifications
       WHERE studio_id = $studio AND user_id = $user AND status != 'suppressed' AND channel = 'push' AND deliver_at <= $now ORDER BY deliver_at DESC LIMIT 50`,
      { user: user.id, now },
    );
    scope.run('UPDATE notifications SET read_at = $now WHERE studio_id = $studio AND user_id = $user AND read_at IS NULL AND deliver_at <= $now', { user: user.id, now });
    return items;
  });

  // Otwarcie powiadomienia – do statystyk (otwarcia push z kampanii i motywów, 7.7 i 12).
  app.post<{ Params: { id: string } }>('/api/inbox/:id/open', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('UPDATE notifications SET opened_at = COALESCE(opened_at, $now) WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id, now: nowIso() });
    return { ok: true };
  });

  // ——— Wejściówki dla znajomej (V1–V5) ———

  app.post<{ Body: { variantId?: string; recipientPhone?: string; message?: string; method: PaymentMethod; couponCode?: string } }>('/api/guest-passes', member, async (req) => {
    const { studio, scope, user } = ctx(req);
    const b = req.body ?? ({} as typeof req.body);
    if (!PAYMENT_METHODS.includes(b.method as (typeof PAYMENT_METHODS)[number])) throw badRequest('Wybierz metodę płatności.');
    const variant = studio.settings.guestPass.variants.find((v) => v.id === (b.variantId ?? studio.settings.guestPass.variants[0]?.id));
    if (!variant) throw notFound('Nie ma takiej wejściówki.');
    const recipient = b.recipientPhone ? normalizePhone(b.recipientPhone) : null;
    if (recipient === user.phone) throw badRequest('To prezent dla znajomej – podaj jej numer.');
    const message = (b.message ?? '').slice(0, 300);
    if (message) {
      const m = moderate(message, { maxLength: 300 });
      if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    }
    const price = priceWithCoupon(scope, studio, { code: b.couponCode, userId: user.id, kind: 'guest_pass', amountGrosze: variant.priceGrosze });
    const charge = price.final > 0 ? await deps.payments.charge({ amountGrosze: price.final, method: b.method, description: `Wejściówka: ${variant.label}`, studioId: studio.id }) : { status: 'paid' as const, ref: 'free' };
    if (charge.status !== 'paid') throw new HttpError(402, 'payment_failed', 'Płatność się nie powiodła.');
    const gp = scope.tx(() => {
      const gp = createGuestPass(scope, studio, { buyerId: user.id, recipient, message, channel: 'app', variant });
      recordPayment(scope, { userId: user.id, kind: 'guest_pass', ref: gp.id, amount: price.final, discount: price.discount, method: b.method, providerRef: charge.ref, description: `Wejściówka: ${variant.label}`, couponId: price.coupon?.id });
      return gp;
    });
    await deliverGuestPass(deps, scope, studio, gp.code, recipient, user.name ?? 'Znajoma', message);
    return { code: gp.code, message: 'Prezent gotowy. Przekaż kod, link albo QR znajomej.' };
  });

  app.get('/api/my/guest-passes', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope.all(
      `SELECT g.id, g.code, g.recipient_phone, g.status, g.variant, g.created_at, g.expires_at, g.transferred_from, u.name AS activated_by_name
       FROM guest_passes g LEFT JOIN users u ON u.id = g.activated_by
       WHERE g.studio_id = $studio AND g.buyer_id = $user ORDER BY g.created_at DESC`,
      { user: user.id },
    );
  });

  // V4: przepisanie niewykorzystanej wejściówki na inną osobę przed upływem terminu.
  app.post<{ Params: { id: string }; Body: { phone: string } }>('/api/guest-passes/:id/transfer', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const gp = scope.get<{ id: string; code: string; recipient_phone: string | null; status: string; expires_at: string; message: string | null }>(
      'SELECT * FROM guest_passes WHERE studio_id = $studio AND id = $id AND buyer_id = $u',
      { id: req.params.id, u: user.id },
    );
    if (!gp) throw notFound('Nie znaleziono wejściówki.');
    if (gp.status !== 'sent') throw conflict('used', 'Tę wejściówkę już ktoś aktywował.');
    if (Date.parse(gp.expires_at) < Date.now()) throw conflict('expired', 'Ta wejściówka wygasła.');
    const phone = normalizePhone(req.body?.phone);
    if (phone === user.phone) throw badRequest('Podaj numer znajomej.');
    claimClientSms(scope, user.id, 'guest_pass_transfer', phone);
    const code = guestCode();
    scope.run('UPDATE guest_passes SET recipient_phone = $p, code = $c, transferred_from = $old, activation_attempts = 0 WHERE studio_id = $studio AND id = $id', { p: phone, c: code, old: gp.recipient_phone ?? gp.code, id: gp.id });
    await deliverGuestPass(deps, scope, studio, code, phone, user.name ?? 'Znajoma', gp.message ?? '');
    return { code, message: 'Wejściówka przepisana – nowa osoba dostała SMS z kodem.' };
  });

  // ——— Polecenia (decyzja 8): link zaproszenia, pierwsze zajęcia gratis, bonus dla zapraszającej ———

  app.post<{ Body: { phone?: string; channel?: string } }>('/api/referrals', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    if (!studio.settings.referral.enabled) throw conflict('off', 'Studio nie prowadzi teraz programu poleceń.');
    const phone = req.body?.phone ? normalizePhone(req.body.phone) : null;
    if (phone === user.phone) throw badRequest('Podaj numer znajomej.');
    if (phone) {
      claimClientSms(scope, user.id, 'referral', phone);
      const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string } | undefined;
      if (existing && scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: existing.id })) {
        throw conflict('already_member', 'Ta osoba już jest w naszym studiu. Umów się z nią na wspólne zajęcia w grafiku!');
      }
    }
    const code = `P${guestCode(7)}`;
    scope.run(
      `INSERT INTO referrals (id, studio_id, inviter_id, code, invitee_phone, channel, status, created_at, updated_at)
       VALUES ($id, $studio, $u, $code, $phone, $ch, 'sent', $now, $now)`,
      { id: id(), u: user.id, code, phone, ch: req.body?.channel ?? 'link', now: nowIso() },
    );
    const text = `${user.name ?? 'Twoja znajoma'} zaprasza Cię do ${studio.name}${studio.settings.referral.friendFirstClassFree ? ' – pierwsze zajęcia gratis' : ''} 💛 Dołącz w aplikacji GLAM kodem ${code}.`;
    if (phone && req.body?.channel === 'sms') {
      await deps.sms.send(phone, text);
      logUsage(db, studio.id, 'sms', 1, 9);
    }
    return { code, text, link: `${deps.publicUrl ?? ''}/app?zaproszenie=${code}` };
  });

  app.get('/api/my/referrals', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope
      .all<{ id: string; code: string; invitee_phone: string | null; invitee_name: string | null; status: 'sent' | 'accepted' | 'first_class' | 'purchased'; channel: string; created_at: string; bonus_granted: number }>(
        'SELECT * FROM referrals WHERE studio_id = $studio AND inviter_id = $u ORDER BY created_at DESC',
        { u: user.id },
      )
      .map((r) => ({ ...r, statusText: REFERRAL_STATUS_COPY[r.status](r.invitee_name ?? 'Znajoma') }));
  });

  // ——— Cel tygodnia i dobrostan ———

  app.put<{ Body: { trainings: number; mindful: number } }>('/api/my/week-goal', member, async (req) => {
    const { scope, user } = ctx(req);
    const t = Number(req.body?.trainings);
    const m = Number(req.body?.mindful);
    if (!Number.isInteger(t) || t < 0 || t > 14 || !Number.isInteger(m) || m < 0 || m > 14) throw badRequest('Cel: od 0 do 14 w tygodniu.');
    scope.run('INSERT OR REPLACE INTO week_goals (studio_id, user_id, trainings, mindful) VALUES ($studio, $u, $t, $m)', { u: user.id, t, m });
    return { ok: true };
  });

  // Sesja oddechu / medytacji / stretchu ukończona w aplikacji – liczy się do celu tygodnia i KPI (decyzja 9).
  app.post<{ Body: { kind: 'meditation' | 'breath' | 'stretch'; ref?: string; minutes: number } }>('/api/mindful', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body;
    if (!['meditation', 'breath', 'stretch'].includes(b?.kind) || !(b.minutes > 0 && b.minutes <= 60)) throw badRequest('Nieprawidłowa sesja.');
    const first = !scope.get('SELECT 1 FROM mindful_logs WHERE studio_id = $studio AND user_id = $u', { u: user.id });
    scope.run('INSERT INTO mindful_logs (id, studio_id, user_id, kind, ref, minutes, completed_at) VALUES ($id, $studio, $u, $k, $r, $m, $now)', {
      id: id(),
      u: user.id,
      k: b.kind,
      r: b.ref ?? null,
      m: Math.round(b.minutes * 10) / 10,
      now: nowIso(),
    });
    if (first && b.kind !== 'stretch') notify(scope, { userId: user.id, category: 'occasional', occasion: 'milestone', tz: studio.timezone, body: 'Pierwsza medytacja za Tobą. Brawo za chwilę tylko dla siebie 🌙', dedupeKey: 'milestone:first_meditation' });
    return { ok: true, week: weekProgress(scope, studio, user.id) };
  });

  // Codzienny rytuał oddechu w „Dla mnie”: seria dni, bieżący tydzień i myśl na dziś.
  app.get('/api/my/breath-ritual', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const rows = scope.all<{ completed_at: string }>("SELECT completed_at FROM mindful_logs WHERE studio_id = $studio AND user_id = $u AND kind IN ('meditation', 'breath') AND completed_at >= $s", { u: user.id, s: since });
    const today = localParts(new Date(), studio.timezone).date;
    const days = rows.map((r) => localParts(new Date(r.completed_at), studio.timezone).date);
    return { ...breathRitual(days, today), affirmation: affirmationFor(today) };
  });

  // ——— Lojalność, odznaki, „Moja szafka”, ramki ———

  app.get('/api/my/loyalty', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const points = pointsOf(scope, user.id);
    const level = levelFor(points, studio.settings.loyalty.levels);
    const badges = badgeList(scope, user.id);
    const membership = scope.get<{ prefs_json: string | null }>("SELECT prefs_json FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: user.id });
    const decor = membership?.prefs_json ? JSON.parse(membership.prefs_json) : {};
    return {
      enabled: studio.settings.loyalty.enabled && studio.has('loyalty'),
      points,
      level,
      levels: studio.settings.loyalty.levels,
      ledger: scope.all('SELECT points, reason, created_at FROM loyalty_ledger WHERE studio_id = $studio AND user_id = $u ORDER BY created_at DESC LIMIT 30', { u: user.id }),
      rewards: scope.all('SELECT id, name, kind, cost_points, value FROM rewards WHERE studio_id = $studio AND active = 1 ORDER BY cost_points', {}),
      badges,
      reward: rewardProgress(scope, studio, user.id),
      frames: unlockedFrames({ badges: badges.map((b) => b.code), levelId: level.current.id, levels: studio.settings.loyalty.levels }),
      frame: decor.frame ?? 'hairline',
      gifts: scope.all("SELECT code, label, kind, value, valid_to FROM coupons WHERE studio_id = $studio AND only_user_id = $u AND active = 1 AND (valid_to IS NULL OR valid_to >= $d) AND NOT EXISTS (SELECT 1 FROM coupon_redemptions r WHERE r.coupon_id = coupons.id)", { u: user.id, d: localParts(new Date(), studio.timezone).date }),
    };
  });

  app.put<{ Body: { frame: string } }>('/api/my/frame', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const points = pointsOf(scope, user.id);
    const allowed = unlockedFrames({ badges: badgeList(scope, user.id).map((b) => b.code), levelId: levelFor(points, studio.settings.loyalty.levels).current.id, levels: studio.settings.loyalty.levels });
    if (!allowed.includes(req.body?.frame)) throw conflict('locked', 'Tę ramkę odblokujesz odznaką albo poziomem.');
    const m = scope.get<{ prefs_json: string | null }>("SELECT prefs_json FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: user.id });
    scope.run("UPDATE memberships SET prefs_json = $p WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { p: JSON.stringify({ ...(m?.prefs_json ? JSON.parse(m.prefs_json) : {}), frame: req.body.frame }), u: user.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/rewards/:id/claim', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const r = scope.get<{ id: string; name: string; kind: string; cost_points: number; value: number | null; shop_product_id: string | null }>('SELECT * FROM rewards WHERE studio_id = $studio AND id = $id AND active = 1', { id: req.params.id });
    if (!r) throw notFound('Ta nagroda nie jest już dostępna.');
    return scope.tx(() => {
      if (pointsOf(scope, user.id) < r.cost_points) throw conflict('points', 'Masz jeszcze za mało punktów na tę nagrodę.');
      scope.run('INSERT INTO loyalty_ledger (id, studio_id, user_id, points, reason, ref, created_at) VALUES ($id, $studio, $u, $p, $reason, $ref, $now)', { id: id(), u: user.id, p: -r.cost_points, reason: 'reward', ref: `${r.id}:${Date.now()}`, now: nowIso() });
      if (r.kind === 'entry') {
        const rules: ProductRules = { validityDays: 60, pools: [{ id: 'reward', label: r.name, entries: r.value ?? 1, classTypeIds: 'all' }] };
        const v = passValidity(rules, new Date());
        issuePass(scope, { userId: user.id, versionId: null, name: r.name, rules, balances: initialBalances(rules), validFrom: v.validFrom, validUntil: v.validUntil, source: 'reward' });
        return { message: `${r.name} jest na Twoim koncie.` };
      }
      if (r.kind === 'discount') {
        const code = `NAGRODA-${guestCode(6)}`;
        scope.run(
          "INSERT INTO coupons (id, studio_id, code, label, kind, value, applies_to, max_uses, per_user, only_user_id, valid_to, active, created_at) VALUES ($id, $studio, $code, $label, 'percent', $v, 'all', 1, 1, $u, $to, 1, $now)",
          { id: id(), code, label: r.name, v: r.value ?? 10, u: user.id, to: addDays(localParts(new Date(), studio.timezone).date, 60), now: nowIso() },
        );
        return { message: `Twój kod: ${code}`, code };
      }
      if (r.kind === 'early_booking') {
        const m = scope.get<{ prefs_json: string | null }>("SELECT prefs_json FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: user.id });
        const until = addDays(localParts(new Date(), studio.timezone).date, 30);
        scope.run("UPDATE memberships SET prefs_json = $p WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { p: JSON.stringify({ ...(m?.prefs_json ? JSON.parse(m.prefs_json) : {}), earlyBookingUntil: until }), u: user.id });
        return { message: 'Przez 30 dni zapisujesz się na zajęcia 2 dni wcześniej niż inne osoby.' };
      }
      scope.run(
        `INSERT INTO locker_items (id, studio_id, user_id, source, title, shop_product_id, options_json, status, created_at, updated_at)
         VALUES ($id, $studio, $u, 'points', $t, $sp, $o, 'choose', $now, $now)`,
        { id: id(), u: user.id, t: r.name, sp: r.shop_product_id, o: JSON.stringify({ delivery: studio.settings.tenClassReward.delivery }), now: nowIso() },
      );
      return { message: 'Prezent czeka w „Mojej szafce” – wybierz rozmiar i sposób odbioru.' };
    });
  });

  app.get('/api/my/locker', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope
      .all<{ options_json: string | null; shop_product_id: string | null }>('SELECT * FROM locker_items WHERE studio_id = $studio AND user_id = $u ORDER BY created_at DESC', { u: user.id })
      .map((l) => {
        const product = l.shop_product_id ? scope.get<{ variants_json: string; name: string }>('SELECT name, variants_json FROM shop_products WHERE studio_id = $studio AND id = $id', { id: l.shop_product_id }) : undefined;
        const sizes = product ? (JSON.parse(product.variants_json) as { size?: string; stock: number }[]).filter((v) => v.stock > 0 && v.size).map((v) => v.size) : ['S', 'M', 'L'];
        return { ...l, options: l.options_json ? JSON.parse(l.options_json) : {}, sizes };
      });
  });

  app.post<{ Params: { id: string }; Body: { size?: string; delivery: 'pickup' | 'ship' } }>('/api/locker/:id', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const item = scope.get<{ id: string; status: string }>("SELECT id, status FROM locker_items WHERE studio_id = $studio AND id = $id AND user_id = $u", { id: req.params.id, u: user.id });
    if (!item) throw notFound('Nie znaleziono nagrody.');
    if (item.status !== 'choose') throw conflict('chosen', 'Ta nagroda jest już w drodze.');
    if (!['pickup', 'ship'].includes(req.body?.delivery)) throw badRequest('Wybierz odbiór w recepcji albo wysyłkę.');
    if (req.body.delivery === 'ship' && !user.address_enc) throw conflict('address', 'Do wysyłki potrzebujemy adresu – dodaj go w ustawieniach (za zgodą, możesz usunąć w każdej chwili).');
    scope.run("UPDATE locker_items SET size = $s, delivery = $d, status = 'queued', updated_at = $now WHERE studio_id = $studio AND id = $id", { s: req.body.size ?? null, d: req.body.delivery, id: item.id, now: nowIso() });
    notify(scope, { userId: user.id, category: 'loyalty', tz: studio.timezone, body: req.body.delivery === 'pickup' ? 'Przygotowujemy Twoją nagrodę – damy znać, gdy będzie czekać w recepcji 🎁' : 'Przygotowujemy wysyłkę Twojej nagrody 🎁' });
    return { message: 'Zapisane. Damy znać, gdy nagroda będzie gotowa.' };
  });

  // ——— Feedback: NPS i ankieta „Co się stało?” (4.9, 4.10) ———

  app.post<{ Params: { id: string }; Body: { score: number; comment?: string } }>('/api/nps/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    const s = req.body?.score;
    if (!Number.isInteger(s) || s < 0 || s > 10) throw badRequest('Wybierz ocenę od 0 do 10.');
    scope.run('UPDATE nps_responses SET score = $s, comment = $c, answered_at = $now WHERE studio_id = $studio AND id = $id AND user_id = $u', { s, c: req.body.comment?.slice(0, 500) ?? null, id: req.params.id, u: user.id, now: nowIso() });
    return { message: 'Dziękujemy – to dla nas ważne 💛' };
  });

  app.post<{ Params: { id: string } }>('/api/nps/:id/skip', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('UPDATE nps_responses SET answered_at = $now WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id, now: nowIso() });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { reasons: string[]; comment?: string; wantsProposal?: boolean } }>('/api/surveys/dormant/:id', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const allowed = ['time', 'health', 'price', 'trainer', 'other'];
    const reasons = (req.body?.reasons ?? []).filter((r) => allowed.includes(r)).slice(0, 3);
    const wants = !!req.body?.wantsProposal;
    const r = scope.run(
      "UPDATE dormant_surveys SET reasons_json = $r, comment = $c, wants_proposal = $w, status = 'answered', answered_at = $now, contact_due_at = $due WHERE studio_id = $studio AND id = $id AND user_id = $u",
      { r: JSON.stringify(reasons), c: req.body?.comment?.slice(0, 500) ?? null, w: Number(wants), now: nowIso(), due: wants ? new Date(Date.now() + 24 * 3_600_000).toISOString() : null, id: req.params.id, u: user.id },
    );
    if (!r.changes) throw notFound();
    if (wants) {
      // „Zaproponuj mi termin” – recepcja dostaje wiadomość w czacie i odzywa się w 24 h.
      scope.run('INSERT INTO chat_messages (id, studio_id, client_id, author_id, from_staff, auto, body, created_at) VALUES ($id, $studio, $u, $u, 0, 1, $b, $now)', {
        id: id(),
        u: user.id,
        b: `Proszę o propozycję terminu (ankieta „Co się stało?”: ${reasons.join(', ') || 'bez powodu'}).`,
        now: nowIso(),
      });
    }
    return { message: wants ? 'Dziękujemy. Recepcja odezwie się w ciągu 24 godzin z propozycją terminu.' : 'Dziękujemy, że dałaś znać. Drzwi są zawsze otwarte 🌿' };
  });

  // ——— Czat z recepcją (4.9) z automatyczną odpowiedzią poza godzinami ———

  app.get('/api/chat', member, async (req) => {
    const { scope, user, studio } = ctx(req);
    scope.run('UPDATE chat_messages SET read_at = $now WHERE studio_id = $studio AND client_id = $u AND from_staff = 1 AND read_at IS NULL', { u: user.id, now: nowIso() });
    return {
      open: isOpen(studio, new Date()),
      hours: studio.settings.support.hours,
      next: nextReceptionLabel(studio.settings.support.hours, new Date(), studio.timezone),
      messages: scope.all('SELECT c.id, c.body, c.from_staff, c.auto, c.created_at, u.name AS author FROM chat_messages c LEFT JOIN users u ON u.id = c.author_id WHERE c.studio_id = $studio AND c.client_id = $u ORDER BY c.created_at', { u: user.id }),
    };
  });

  app.post<{ Body: { body: string } }>('/api/chat', member, async (req) => {
    const { scope, user, studio } = ctx(req);
    const body = String(req.body?.body ?? '').trim();
    const m = moderate(body, { maxLength: 1000, allowLinks: true });
    if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    scope.run('INSERT INTO chat_messages (id, studio_id, client_id, author_id, from_staff, body, created_at) VALUES ($id, $studio, $u, $u, 0, $b, $now)', { id: id(), u: user.id, b: body, now: nowIso() });
    if (!isOpen(studio, new Date())) {
      const last = scope.get<{ created_at: string }>('SELECT created_at FROM chat_messages WHERE studio_id = $studio AND client_id = $u AND auto = 1 AND from_staff = 1 ORDER BY created_at DESC LIMIT 1', { u: user.id });
      if (!last || Date.now() - Date.parse(last.created_at) > 6 * 3_600_000) {
        scope.run('INSERT INTO chat_messages (id, studio_id, client_id, author_id, from_staff, auto, body, created_at) VALUES ($id, $studio, $u, NULL, 1, 1, $b, $now)', {
          id: id(),
          u: user.id,
          b: studio.settings.support.autoReply,
          now: new Date(Date.now() + 1000).toISOString(),
        });
      }
    }
    return { ok: true };
  });

  // Kod QR do check-inu w recepcji / na bramce (C3) – zmienia się codziennie.
  app.get('/api/my/checkin-code', member, async (req) => {
    const { studio, user } = ctx(req);
    return { code: checkinCode(studio.id, user.id, localParts(new Date(), studio.timezone).date) };
  });

  app.get('/api/partners', member, async (req) => {
    const { scope, studio } = ctx(req);
    if (!studio.has('shop')) return [];
    return scope.all('SELECT id, name, category, description, perk, code, url FROM partners WHERE studio_id = $studio AND verified = 1 ORDER BY category, name');
  });
}

export function isOpen(studio: Studio, at: Date): boolean {
  return receptionOpen(studio.settings.support.hours, at, studio.timezone);
}

export function createGuestPass(
  scope: StudioScope,
  studio: Studio,
  input: { buyerId: string | null; recipient: string | null; message: string; channel: 'app' | 'desk'; variant: Studio['settings']['guestPass']['variants'][number] },
) {
  const gp = { id: id(), code: guestCode() };
  const rules = guestRules(studio.settings.guestPass.validityDays, input.variant.entries, input.variant.classTypeIds);
  scope.run(
    `INSERT INTO guest_passes (id, studio_id, buyer_id, code, recipient_phone, message, status, channel, variant, rules_json, price_grosze, created_at, expires_at)
     VALUES ($id, $studio, $buyer, $code, $phone, $msg, 'sent', $channel, $variant, $rules, $price, $now, $exp)`,
    {
      id: gp.id,
      buyer: input.buyerId,
      code: gp.code,
      phone: input.recipient,
      msg: input.message,
      channel: input.channel,
      variant: input.variant.id,
      rules: JSON.stringify(rules),
      price: input.variant.priceGrosze,
      now: nowIso(),
      // Ważność na aktywację: tyle, ile ustaliło studio; karnet po aktywacji ma osobną ważność.
      exp: new Date(Date.now() + studio.settings.guestPass.validityDays * 86_400_000).toISOString(),
    },
  );
  return gp;
}

export async function deliverGuestPass(deps: Deps, scope: StudioScope, studio: Studio, code: string, recipient: string | null, fromName: string, message: string) {
  if (!recipient) return;
  await deps.sms.send(recipient, `${fromName} zrobiła Ci prezent 💛 Wejściówka do ${studio.name}. Kod: ${code}. Odbierz w aplikacji GLAM.`);
  logUsage(deps.db, studio.id, 'sms', 1, 9);
  const existing = deps.db.prepare('SELECT id FROM users WHERE phone = ?').get(recipient) as { id: string } | undefined;
  const isMember = existing && scope.get('SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $user', { user: existing.id });
  if (existing && isMember) {
    notify(scope, {
      userId: existing.id,
      category: 'community',
      tz: studio.timezone,
      body: `${fromName} zrobiła Ci prezent 💛 Odbierz wejściówkę: ${code}${message ? ` – „${message}”` : ''}`,
      action: `gift/${code}`,
    });
  }
}
