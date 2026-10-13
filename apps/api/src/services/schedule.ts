// System sam uzupełnia grafik wg szablonów (sekcja 1, #4) i obsługuje wyjątki (#7).
import { addDays, bookedSessionFate, localParts, zonedToUtc, planSessions, takenKey, validateSlot, type ScheduleException, type ScheduleTemplate, type SlotInput } from '@glam/core';
import { badRequest, notFound } from '../errors.ts';
import { id } from '../db.ts';
import type { StudioScope } from '../scope.ts';
import { notify } from './notify.ts';
import { refundEntry } from './passes.ts';
import type { Studio } from './studio.ts';

export const FILL_DAYS = 28;

export function fillSchedule(scope: StudioScope, studio: Studio, now = new Date(), days = FILL_DAYS) {
  const templates = scope
    .all<{
      id: string;
      class_type_id: string;
      zone_id: string;
      trainer_id: string;
      weekday: number;
      start_time: string;
      duration_min: number;
      capacity: number;
      valid_from: string;
      valid_to: string | null;
    }>(
      `SELECT t.*, ct.zone_id FROM schedule_templates t JOIN class_types ct ON ct.id = t.class_type_id
       WHERE t.studio_id = $studio`,
    )
    .map(
      (t): ScheduleTemplate => ({
        id: t.id,
        classTypeId: t.class_type_id,
        zoneId: t.zone_id,
        trainerId: t.trainer_id,
        weekday: t.weekday,
        startTime: t.start_time,
        durationMin: t.duration_min,
        capacity: t.capacity,
        validFrom: t.valid_from,
        validTo: t.valid_to,
      }),
    );
  const exceptions = scope.all<{ date: string; zone_id: string | null; reason: string }>(
    'SELECT date, zone_id, reason FROM schedule_exceptions WHERE studio_id = $studio',
  );
  const fromDate = localParts(now, studio.timezone).date;
  const existing = scope.all<{ template_id: string; starts_at: string }>(
    "SELECT template_id, starts_at FROM class_sessions WHERE studio_id = $studio AND template_id IS NOT NULL AND status = 'scheduled' AND starts_at >= $from",
    { from: zonedToUtcIso(fromDate, studio) },
  );
  const taken = new Set(existing.map((e) => takenKey(e.template_id, localParts(new Date(e.starts_at), studio.timezone).date)));
  const planned = planSessions(
    templates,
    exceptions.map((e): ScheduleException => ({ date: e.date, zoneId: e.zone_id, reason: e.reason })),
    fromDate,
    days,
    studio.timezone,
    taken,
  );
  let created = 0;
  scope.tx(() => {
    for (const p of planned) {
      const r = scope.run(
        `INSERT OR IGNORE INTO class_sessions (id, studio_id, template_id, class_type_id, trainer_id, starts_at, ends_at, capacity)
         VALUES ($id, $studio, $tpl, $ct, $tr, $start, $end, $cap)`,
        { id: id(), tpl: p.templateId, ct: p.classTypeId, tr: p.trainerId, start: p.startsAt, end: p.endsAt, cap: p.capacity },
      );
      created += Number(r.changes);
    }
  });
  return { created };
}

/** Blokada sali / święto / urlop: odwołuje sesje, zwraca wejścia i powiadamia klientki. */
export function addException(
  scope: StudioScope,
  studio: Studio,
  input: { date: string; zoneId: string | null; reason: string },
  now = new Date(),
) {
  return scope.tx(() => {
    scope.run('INSERT INTO schedule_exceptions (id, studio_id, date, zone_id, reason) VALUES ($id, $studio, $date, $zone, $reason)', {
      id: id(),
      date: input.date,
      zone: input.zoneId,
      reason: input.reason,
    });
    const sessions = scope
      .all<{ id: string; starts_at: string; zone_id: string; class_name: string }>(
        `SELECT s.id, s.starts_at, ct.zone_id, ct.name AS class_name FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
         WHERE s.studio_id = $studio AND s.status = 'scheduled' AND s.starts_at > $now`,
        { now: now.toISOString() },
      )
      .filter((s) => localParts(new Date(s.starts_at), studio.timezone).date === input.date && (input.zoneId === null || s.zone_id === input.zoneId));

    for (const s of sessions) cancelSession(scope, studio, s, input.reason, now);
    return { cancelledSessions: sessions.length };
  });
}

const zonedToUtcIso = (date: string, studio: Studio) => zonedToUtc(date, '00:00', studio.timezone).toISOString();

type SessionRef = { id: string; starts_at: string; class_name: string };

/** Odwołuje sesję: zwrot wejść, anulowanie zapisów i listy oczekujących, powiadomienie klientek. */
function cancelSession(scope: StudioScope, studio: Studio, s: SessionRef, reason: string, now: Date) {
  scope.run("UPDATE class_sessions SET status = 'cancelled' WHERE studio_id = $studio AND id = $id", { id: s.id });
  const bookings = scope.all<{ id: string; user_id: string; pass_id: string | null; pool_id: string | null; status: string }>(
    "SELECT * FROM bookings WHERE studio_id = $studio AND session_id = $sid AND status IN ('booked', 'waitlist')",
    { sid: s.id },
  );
  const time = localParts(new Date(s.starts_at), studio.timezone).time;
  for (const b of bookings) {
    if (b.status === 'booked') refundEntry(scope, b.pass_id, b.pool_id);
    scope.run("UPDATE bookings SET status = 'cancelled', updated_at = $ts WHERE studio_id = $studio AND id = $id", { id: b.id, ts: now.toISOString() });
    notify(scope, {
      userId: b.user_id,
      category: 'transactional',
      tz: studio.timezone,
      now,
      body: `Zajęcia ${s.class_name} o ${time} odwołane (${reason}). Wejście wróciło na karnet – wybierz inny termin.`,
    });
  }
}

type TemplateRow = { id: string; class_type_id: string; trainer_id: string; weekday: number; start_time: string; duration_min: number; capacity: number };
export type SlotPatch = Partial<{ trainerId: string; weekday: number; startTime: string; durationMin: number; capacity: number }>;
export type SlotOutcome = { created: number; kept: number; cancelled: number };

function assertStaff(scope: StudioScope, trainerId: string) {
  const ok = scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role IN ('trainer', 'owner')", { u: trainerId });
  if (!ok) throw notFound('Nie znaleziono trenerki w tym studiu.');
}

/** Nowe zajęcia w grafiku: jeden szablon na każdy wybrany dzień, od razu z sesjami na 4 tygodnie. */
export function createSlots(scope: StudioScope, studio: Studio, input: SlotInput & { classTypeId: string; trainerId: string }, now = new Date()) {
  const errors = validateSlot(input);
  if (errors.length) throw badRequest(errors[0], { errors });
  if (!scope.get('SELECT 1 FROM class_types WHERE studio_id = $studio AND id = $id', { id: input.classTypeId })) throw notFound('Nie znaleziono typu zajęć.');
  assertStaff(scope, input.trainerId);
  const today = localParts(now, studio.timezone).date;
  return scope.tx(() => {
    for (const weekday of new Set(input.weekdays)) {
      scope.run(
        `INSERT INTO schedule_templates (id, studio_id, class_type_id, trainer_id, weekday, start_time, duration_min, capacity, valid_from)
         VALUES ($id, $studio, $ct, $tr, $wd, $time, $dur, $cap, $from)`,
        { id: id(), ct: input.classTypeId, tr: input.trainerId, wd: weekday, time: input.startTime, dur: input.durationMin, cap: input.capacity, from: today },
      );
    }
    return fillSchedule(scope, studio, now);
  });
}

function loadTemplate(scope: StudioScope, templateId: string) {
  const t = scope.get<TemplateRow>('SELECT * FROM schedule_templates WHERE studio_id = $studio AND id = $id AND valid_to IS NULL', {
    id: templateId,
  });
  if (!t) throw notFound('Nie znaleziono zajęć w grafiku.');
  return t;
}

/** Przyszłe, niewyodrębnione sesje szablonu z liczbą osób zapisanych (z listą oczekujących) i wszystkich rezerwacji. */
function futureSessions(scope: StudioScope, templateId: string, now: Date) {
  return scope.all<SessionRef & { active: number; any_booking: number }>(
    `SELECT s.id, s.starts_at, ct.name AS class_name,
            (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'waitlist')) AS active,
            (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id) AS any_booking
     FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id
     WHERE s.studio_id = $studio AND s.template_id = $tpl AND s.status = 'scheduled' AND s.starts_at > $now`,
    { tpl: templateId, now: now.toISOString() },
  );
}

/**
 * Sesja do przestawienia: bez rezerwacji – znika (fillSchedule wstawi ją w nowym terminie),
 * z samymi anulowanymi rezerwacjami – zostaje jako odwołana, z klientkami – decyduje bookedSessionFate.
 */
function retireSession(scope: StudioScope, studio: Studio, s: SessionRef & { active: number; any_booking: number }, edit: 'retime' | 'remove', reason: string, now: Date) {
  if (!s.any_booking) {
    scope.run('DELETE FROM class_sessions WHERE studio_id = $studio AND id = $id', { id: s.id });
    return 'moved' as const;
  }
  if (!s.active) {
    scope.run("UPDATE class_sessions SET status = 'cancelled' WHERE studio_id = $studio AND id = $id", { id: s.id });
    return 'moved' as const;
  }
  const hoursUntil = (Date.parse(s.starts_at) - now.getTime()) / 3_600_000;
  if (bookedSessionFate({ edit, booked: s.active, hoursUntil }) === 'cancel') {
    cancelSession(scope, studio, s, reason, now);
    return 'cancelled' as const;
  }
  return 'kept' as const;
}

/** Zmiana slotu obowiązuje od teraz. Trenerka, miejsca i czas trwania przechodzą też na sesje z zapisami. */
export function updateSlot(scope: StudioScope, studio: Studio, templateId: string, patch: SlotPatch, now = new Date()): SlotOutcome {
  const cur = loadTemplate(scope, templateId);
  const next = {
    trainerId: patch.trainerId ?? cur.trainer_id,
    weekday: patch.weekday ?? cur.weekday,
    startTime: patch.startTime ?? cur.start_time,
    durationMin: patch.durationMin ?? cur.duration_min,
    capacity: patch.capacity ?? cur.capacity,
  };
  const errors = validateSlot({ ...next, weekdays: [next.weekday] });
  if (errors.length) throw badRequest(errors[0], { errors });
  if (next.trainerId !== cur.trainer_id) assertStaff(scope, next.trainerId);
  const retime = next.weekday !== cur.weekday || next.startTime !== cur.start_time;

  return scope.tx(() => {
    scope.run(
      `UPDATE schedule_templates SET trainer_id = $tr, weekday = $wd, start_time = $time, duration_min = $dur, capacity = $cap
       WHERE studio_id = $studio AND id = $id`,
      { id: templateId, tr: next.trainerId, wd: next.weekday, time: next.startTime, dur: next.durationMin, cap: next.capacity },
    );
    let kept = 0;
    let cancelled = 0;
    for (const s of futureSessions(scope, templateId, now)) {
      const fate = retime ? retireSession(scope, studio, s, 'retime', 'zmiana w grafiku', now) : 'kept';
      if (fate === 'cancelled') cancelled++;
      if (fate !== 'kept') continue;
      if (retime) kept++;
      // Miejsc nie mniej niż już zapisanych – nikogo nie wyrzucamy z zajęć.
      scope.run(
        `UPDATE class_sessions SET trainer_id = $tr, ends_at = $end,
                capacity = MAX($cap, (SELECT COUNT(*) FROM bookings b WHERE b.session_id = class_sessions.id AND b.status = 'booked'))
         WHERE studio_id = $studio AND id = $id`,
        { id: s.id, tr: next.trainerId, cap: next.capacity, end: new Date(Date.parse(s.starts_at) + next.durationMin * 60_000).toISOString() },
      );
    }
    return { created: fillSchedule(scope, studio, now).created, kept, cancelled };
  });
}

/** Zdjęcie zajęć z grafiku od dziś. Historia (odbyte sesje) zostaje przy szablonie. */
export function removeSlot(scope: StudioScope, studio: Studio, templateId: string, now = new Date()): SlotOutcome {
  loadTemplate(scope, templateId);
  const yesterday = addDays(localParts(now, studio.timezone).date, -1);
  return scope.tx(() => {
    let kept = 0;
    let cancelled = 0;
    for (const s of futureSessions(scope, templateId, now)) {
      const fate = retireSession(scope, studio, s, 'remove', 'zajęcia zdjęte z grafiku', now);
      if (fate === 'kept') kept++;
      if (fate === 'cancelled') cancelled++;
    }
    if (scope.get('SELECT 1 FROM class_sessions WHERE studio_id = $studio AND template_id = $id', { id: templateId })) {
      scope.run('UPDATE schedule_templates SET valid_to = $to WHERE studio_id = $studio AND id = $id', { id: templateId, to: yesterday });
    } else {
      scope.run('DELETE FROM schedule_templates WHERE studio_id = $studio AND id = $id', { id: templateId });
    }
    return { created: 0, kept, cancelled };
  });
}
