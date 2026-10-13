// Rezerwacje: regulamin czasowy → dostęp z karnetu → miejsce lub lista oczekujących.
// Wszystko w jednej transakcji, żeby dwie osoby nie dostały ostatniego miejsca naraz.
// Rozszerzenia: trening we dwie / wejście z gościem (#6, C8), rezerwacja cykliczna (4.1),
// dodanie przez recepcję, potwierdzenie obecności 2 h przed, nieobecność, ocena zajęć.
import {
  bookingWindow,
  cancellationOutcome,
  checkAccess,
  describePass,
  DENIAL_COPY,
  formatPLN,
  localParts,
  pickPass,
  productCovers,
  seatDecision,
  TRIGGERS,
  waitlistOrder,
  WINDOW_COPY,
  type AccessGranted,
  type Pass,
  type ProductRules,
} from '@glam/core';
import { id } from '../db.ts';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { onAttended } from './motivation.ts';
import { notify } from './notify.ts';
import { consumeEntry, guestAllowance, loadPasses, refundEntry, useGuestAllowance, usageFor, returnGuestAllowance } from './passes.ts';
import type { Studio } from './studio.ts';

type SessionRow = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: string;
  class_type_id: string;
  class_name: string;
  zone_id: string;
  zone_name: string;
  trainer_name: string | null;
  public: number;
};

export function loadSession(scope: StudioScope, sessionId: string): SessionRow {
  const s = scope.get<SessionRow>(
    `SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.status, s.public, s.class_type_id, COALESCE(s.title, ct.name) AS class_name, ct.zone_id, z.name AS zone_name, u.name AS trainer_name
     FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN zones z ON z.id = ct.zone_id JOIN users u ON u.id = s.trainer_id
     WHERE s.studio_id = $studio AND s.id = $id`,
    { id: sessionId },
  );
  if (!s) throw notFound('Nie znaleziono tych zajęć.');
  return s;
}

const takenSeats = (scope: StudioScope, sessionId: string) =>
  scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM bookings WHERE studio_id = $studio AND session_id = $sid AND status IN ('booked', 'attended')", { sid: sessionId })!.n;

/** Najlepszy pasujący karnet klientki na te zajęcia (albo powody odmowy). */
function resolveAccess(scope: StudioScope, studio: Studio, userId: string, s: SessionRow, now: Date) {
  const startsAt = new Date(s.starts_at);
  const results = loadPasses(scope, userId, now).map((pass) =>
    checkAccess(pass, {
      classTypeId: s.class_type_id,
      zoneId: s.zone_id,
      startsAt,
      tz: studio.timezone,
      usage: usageFor(scope, pass.id, startsAt, studio.timezone),
    }),
  );
  const granted = results.filter((r): r is AccessGranted => r.ok);
  return { choice: pickPass(granted), results };
}

function noPassError(scope: StudioScope, userId: string, s: SessionRow, results: ReturnType<typeof resolveAccess>['results']) {
  // „Jeśli nie, pokazuje, który produkt by pasował, z przyciskiem zakupu” (1.1.3).
  const products = scope.all<{ id: string; name: string; price_grosze: number; rules_json: string }>(
    `SELECT p.id, p.name, v.price_grosze, v.rules_json FROM products p JOIN product_versions v ON v.id = p.current_version_id
     WHERE p.studio_id = $studio AND p.published = 1 AND p.channels_json LIKE '%"app"%' ORDER BY p.sort`,
  );
  const hadPurchase = !!scope.get("SELECT 1 FROM passes WHERE studio_id = $studio AND user_id = $user AND source = 'purchase'", { user: userId });
  const suggestions = products
    .map((p) => ({ ...p, rules: JSON.parse(p.rules_json) as ProductRules }))
    .filter((p) => productCovers(p.rules, s.class_type_id, s.zone_id) && !(p.rules.introOnly && hadPurchase))
    .slice(0, 3)
    .map((p) => ({ productId: p.id, name: p.name, price: formatPLN(p.price_grosze) }));
  const reasons = results.filter((r) => !r.ok).map((r) => `${r.pass.productName}: ${DENIAL_COPY[(r as { reason: keyof typeof DENIAL_COPY }).reason]}`);
  return new HttpError(402, 'no_pass', `Żaden z Twoich karnetów nie obejmuje zajęć ${s.class_name}.`, { suggestions, reasons });
}

export type BookOptions = {
  /** Drugie miejsce dla osoby towarzyszącej (trening we dwie / wejście z gościem). */
  guest?: { name: string; phone?: string | null } | null;
  source?: 'app' | 'desk' | 'recurring' | 'invite';
  recurringId?: string | null;
  /** Recepcja: pomija regulamin czasowy; może zapisać bez karnetu („płatność na miejscu”). */
  staff?: boolean;
  payAtDesk?: boolean;
};

export function bookSession(scope: StudioScope, studio: Studio, userId: string, sessionId: string, now = new Date(), opts: BookOptions = {}) {
  return scope.tx(() => {
    const s = loadSession(scope, sessionId);
    if (s.status === 'cancelled') throw conflict('cancelled', 'Te zajęcia zostały odwołane.');
    if (!s.public && !opts.staff) throw notFound('Nie znaleziono tych zajęć.');
    if (!opts.staff) {
      // Nagroda „wcześniejszy zapis” (4.7): zapisy otwierają się dla niej 2 dni wcześniej.
      const m = scope.get<{ prefs_json: string | null }>("SELECT prefs_json FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: userId });
      const early = m?.prefs_json ? (JSON.parse(m.prefs_json).earlyBookingUntil as string | undefined) : undefined;
      const policy = early && early >= now.toISOString().slice(0, 10) ? { ...studio.policy, opensDaysAhead: studio.policy.opensDaysAhead + 2 } : studio.policy;
      const window = bookingWindow(policy, new Date(s.starts_at), now);
      if (!window.ok) throw conflict(window.reason, WINDOW_COPY[window.reason]);
    } else if (new Date(s.starts_at).getTime() + 15 * 60_000 < now.getTime()) {
      throw conflict('started', WINDOW_COPY.started);
    }

    const existing = scope.get(
      "SELECT id FROM bookings WHERE studio_id = $studio AND session_id = $sid AND user_id = $user AND status IN ('booked', 'waitlist', 'attended') AND guest_name IS NULL",
      { sid: sessionId, user: userId },
    );
    if (existing) throw conflict('already_booked', 'Masz już miejsce na tych zajęciach.');

    const { choice, results } = resolveAccess(scope, studio, userId, s, now);
    if (!choice && !(opts.staff && opts.payAtDesk)) throw noPassError(scope, userId, s, results);

    const free = s.capacity - takenSeats(scope, sessionId);
    const seats = opts.guest ? 2 : 1;
    // Trening we dwie to dwa miejsca naraz albo żadne – nie rozdzielamy pary na listę oczekujących.
    if (opts.guest && free < 2) throw conflict('full', free === 1 ? 'Zostało tylko jedno wolne miejsce – trening we dwie się nie zmieści.' : 'Brak wolnych miejsc na tych zajęciach.');
    const seat = seatDecision(s.capacity, takenSeats(scope, sessionId), studio.policy.waitlist);
    if (seat === 'full') throw conflict('full', 'Brak wolnych miejsc na tych zajęciach.');

    // Miejsce dla gościa: najpierw limit „wejście z gościem” (C8), potem drugie wejście z tej samej puli.
    let guestFrom: 'allowance' | 'entry' | null = null;
    if (opts.guest) {
      if (!opts.guest.name?.trim()) throw badRequest('Podaj imię osoby, która idzie z Tobą.');
      if (choice && guestAllowance(choice.pass, now, studio.timezone) > 0) guestFrom = 'allowance';
      else if (choice && (choice.poolId === null || (choice.pass.balances[choice.poolId] ?? 0) >= 2)) guestFrom = 'entry';
      else if (!(opts.staff && opts.payAtDesk)) {
        throw conflict('guest_no_entry', 'Na karnecie nie ma drugiego wejścia ani wejścia z gościem. Podaruj znajomej wejściówkę – wtedy zapisze się sama.');
      }
    }

    const bookingId = id();
    const partyId = opts.guest ? id() : null;
    const ts = now.toISOString();
    const insert = (bid: string, guest: BookOptions['guest'], passId: string | null, poolId: string | null, status: string) =>
      scope.run(
        `INSERT INTO bookings (id, studio_id, session_id, user_id, pass_id, pool_id, status, party_id, guest_name, guest_phone, recurring_id, source, created_at, updated_at)
         VALUES ($id, $studio, $sid, $user, $pass, $pool, $status, $party, $gname, $gphone, $rec, $src, $ts, $ts)`,
        {
          id: bid,
          sid: sessionId,
          user: userId,
          pass: passId,
          pool: poolId,
          status,
          party: partyId,
          gname: guest?.name?.trim() ?? null,
          gphone: guest?.phone ?? null,
          rec: opts.recurringId ?? null,
          src: opts.source ?? (opts.staff ? 'desk' : 'app'),
          ts,
        },
      );

    // Na liście oczekujących nie blokujemy wejścia – zdejmujemy je dopiero przy awansie.
    insert(bookingId, null, seat === 'booked' ? (choice?.pass.id ?? null) : null, seat === 'booked' ? (choice?.poolId ?? null) : null, seat);
    if (seat === 'booked' && choice) consumeEntry(scope, choice.pass, choice.poolId, new Date(s.starts_at));
    if (opts.guest) {
      const guestId = id();
      if (guestFrom === 'allowance' && choice) {
        insert(guestId, opts.guest, choice.pass.id, 'guest', 'booked');
        useGuestAllowance(scope, choice.pass, now, studio.timezone);
      } else if (guestFrom === 'entry' && choice) {
        insert(guestId, opts.guest, choice.pass.id, choice.poolId, 'booked');
        consumeEntry(scope, choice.pass, choice.poolId, new Date(s.starts_at));
      } else insert(guestId, opts.guest, null, null, 'booked');
    }

    const time = localParts(new Date(s.starts_at), studio.timezone).time;
    return {
      bookingId,
      status: seat,
      seats,
      pass: choice ? describePass(choice.pass, studio.timezone) : null,
      message:
        seat === 'booked'
          ? opts.guest
            ? `Zapisane dwa miejsca na ${s.class_name} o ${time}. Do zobaczenia we dwie 💛`
            : `Zapisana. Do zobaczenia na zajęciach ${s.class_name}.`
          : 'Jesteś na liście oczekujących. Gdy zwolni się miejsce, zapiszemy Cię automatycznie.',
    };
  });
}

export function cancelBooking(scope: StudioScope, studio: Studio, bookingId: string, actor: { userId: string; isStaff: boolean }, now = new Date()) {
  return scope.tx(() => {
    const b = scope.get<{ id: string; session_id: string; user_id: string; pass_id: string | null; pool_id: string | null; status: string; party_id: string | null; guest_name: string | null }>(
      'SELECT * FROM bookings WHERE studio_id = $studio AND id = $id',
      { id: bookingId },
    );
    if (!b) throw notFound('Nie znaleziono rezerwacji.');
    if (b.user_id !== actor.userId && !actor.isStaff) throw forbidden();
    if (b.status !== 'booked' && b.status !== 'waitlist') throw conflict('not_active', 'Ta rezerwacja nie jest już aktywna.');

    const s = loadSession(scope, b.session_id);
    const ts = now.toISOString();
    if (b.status === 'waitlist') {
      scope.run("UPDATE bookings SET status = 'cancelled', updated_at = $ts WHERE studio_id = $studio AND id = $id", { id: b.id, ts });
      return { outcome: 'refund' as const, message: 'Wypisałyśmy Cię z listy oczekujących.' };
    }

    // Recepcja może odwołać bez utraty wejścia (np. choroba zgłoszona telefonicznie).
    const outcome = actor.isStaff ? 'refund' : cancellationOutcome(studio.policy, new Date(s.starts_at), now);
    if (outcome === 'started') throw conflict('started', 'Tych zajęć nie da się już odwołać.');
    // Odwołanie głównej rezerwacji zwalnia też miejsce gościa z tej samej pary.
    const party = b.party_id && !b.guest_name
      ? scope.all<typeof b>("SELECT * FROM bookings WHERE studio_id = $studio AND party_id = $p AND status = 'booked'", { p: b.party_id })
      : [b];
    for (const x of party) {
      if (outcome === 'refund') {
        if (x.pool_id === 'guest') returnGuestAllowance(scope, x.pass_id, now, studio.timezone);
        else refundEntry(scope, x.pass_id, x.pool_id);
      }
      scope.run('UPDATE bookings SET status = $st, updated_at = $ts WHERE studio_id = $studio AND id = $id', { id: x.id, st: outcome === 'refund' ? 'cancelled' : 'late_cancel', ts });
    }
    promoteWaitlist(scope, studio, b.session_id, now);
    return {
      outcome,
      message: outcome === 'refund' ? 'Odwołane. Wejście wróciło na Twój karnet.' : 'Odwołane po terminie, więc wejście przepada. Miejsce trafi do kolejnej osoby.',
    };
  });
}

/** Automatyczne zwolnienie miejsca dla pierwszej osoby z listy, której karnet nadal pasuje. */
export function promoteWaitlist(scope: StudioScope, studio: Studio, sessionId: string, now = new Date()) {
  const s = loadSession(scope, sessionId);
  if (s.status !== 'scheduled' || new Date(s.starts_at) <= now) return [];
  let free = s.capacity - takenSeats(scope, sessionId);
  const waiting = waitlistOrder(
    scope
      .all<{ id: string; user_id: string; created_at: string }>("SELECT id, user_id, created_at FROM bookings WHERE studio_id = $studio AND session_id = $sid AND status = 'waitlist'", { sid: sessionId })
      .map((w) => ({ ...w, createdAt: w.created_at })),
  );
  const promoted: string[] = [];
  for (const w of waiting) {
    if (free <= 0) break;
    const { choice } = resolveAccess(scope, studio, w.user_id, s, now);
    if (!choice) continue;
    scope.run("UPDATE bookings SET status = 'booked', pass_id = $pass, pool_id = $pool, updated_at = $ts WHERE studio_id = $studio AND id = $id", {
      id: w.id,
      pass: choice.pass.id,
      pool: choice.poolId,
      ts: now.toISOString(),
    });
    consumeEntry(scope, choice.pass, choice.poolId, new Date(s.starts_at));
    const time = localParts(new Date(s.starts_at), studio.timezone).time;
    notify(scope, {
      userId: w.user_id,
      category: 'transactional',
      tz: studio.timezone,
      now,
      body: `Zwolniło się miejsce na ${s.class_name} o ${time} – już jesteś zapisana 💛`,
      action: 'schedule',
    });
    promoted.push(w.user_id);
    free--;
  }
  return promoted;
}

export function checkIn(scope: StudioScope, studio: Studio, bookingId: string, now = new Date()) {
  return scope.tx(() => {
    const b = scope.get<{ user_id: string; guest_name: string | null; party_id: string | null }>(
      "SELECT user_id, guest_name, party_id FROM bookings WHERE studio_id = $studio AND id = $id AND status = 'booked'",
      { id: bookingId },
    );
    if (!b) throw notFound('Nie znaleziono aktywnej rezerwacji do potwierdzenia.');
    scope.run("UPDATE bookings SET status = 'attended', updated_at = $ts WHERE studio_id = $studio AND id = $id", { id: bookingId, ts: now.toISOString() });
    if (!b.guest_name) onAttended(scope, studio, b.user_id, bookingId, now);
  });
}

export function markNoShow(scope: StudioScope, bookingId: string, now = new Date()) {
  const r = scope.run("UPDATE bookings SET status = 'no_show', updated_at = $ts WHERE studio_id = $studio AND id = $id AND status IN ('booked', 'attended')", {
    id: bookingId,
    ts: now.toISOString(),
  });
  if (!r.changes) throw notFound('Nie znaleziono rezerwacji.');
}

/** Potwierdzenie obecności 2 h przed zajęciami (ograniczenie „duchów”, 4.1). */
export function confirmAttendance(scope: StudioScope, userId: string, bookingId: string, now = new Date()) {
  const r = scope.run("UPDATE bookings SET confirmed_at = $ts WHERE studio_id = $studio AND id = $id AND user_id = $u AND status = 'booked'", {
    id: bookingId,
    u: userId,
    ts: now.toISOString(),
  });
  if (!r.changes) throw notFound('Nie znaleziono rezerwacji.');
}

export function rateSession(scope: StudioScope, userId: string, bookingId: string, rating: number, comment: string | null) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw badRequest('Ocena od 1 do 5.');
  const r = scope.run(
    "UPDATE bookings SET rating = $r, rating_comment = $c WHERE studio_id = $studio AND id = $id AND user_id = $u AND status = 'attended' AND guest_name IS NULL",
    { id: bookingId, u: userId, r: rating, c: comment?.slice(0, 500) ?? null },
  );
  if (!r.changes) throw notFound('Ocenić można zajęcia, na których byłaś.');
}

/** Zmiana trenerki lub sali – natychmiastowy push do zapisanych (sekcja 8). */
export function changeTrainer(scope: StudioScope, studio: Studio, sessionId: string, trainerId: string, now = new Date()) {
  return scope.tx(() => {
    const s = loadSession(scope, sessionId);
    const trainer = scope.get<{ name: string }>("SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.user_id = $t AND m.role = 'trainer'", { t: trainerId });
    if (!trainer) throw notFound('Nie znaleziono trenerki.');
    scope.run('UPDATE class_sessions SET substitute_for = COALESCE(substitute_for, trainer_id), trainer_id = $t WHERE studio_id = $studio AND id = $id', { t: trainerId, id: sessionId });
    const users = scope.all<{ user_id: string }>("SELECT DISTINCT user_id FROM bookings WHERE studio_id = $studio AND session_id = $sid AND status = 'booked' AND guest_name IS NULL", { sid: sessionId });
    const lp = localParts(new Date(s.starts_at), studio.timezone);
    const today = localParts(now, studio.timezone).date === lp.date;
    for (const u of users) {
      notify(scope, {
        userId: u.user_id,
        category: 'transactional',
        tz: studio.timezone,
        now,
        action: 'schedule',
        body: today ? TRIGGERS.trainer_change.text({ trainer: trainer.name, zone: s.zone_name }) : `${s.class_name} ${lp.date.slice(8)}.${lp.date.slice(5, 7)} o ${lp.time}: prowadzi ${trainer.name}. Do zobaczenia!`,
      });
    }
    return { notified: users.length };
  });
}

export type { Pass };
