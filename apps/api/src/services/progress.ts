// Cel tygodnia (4.4): „3 treningi + 2 medytacje”. Treningi = zapisane i zrealizowane zajęcia tygodnia,
// chwile dla siebie = sesje oddechu, medytacji i stretchu zapisane w aplikacji.
import { addDays, DEFAULT_WEEK_GOAL, localParts, weekGoalMessage, weekStart, zonedToUtc, type WeekGoal } from '@glam/core';
import type { StudioScope } from '../scope.ts';
import type { Studio } from './studio.ts';

export function weekGoalOf(scope: StudioScope, userId: string): WeekGoal {
  const g = scope.get<{ trainings: number; mindful: number }>('SELECT trainings, mindful FROM week_goals WHERE studio_id = $studio AND user_id = $u', { u: userId });
  return g ?? DEFAULT_WEEK_GOAL;
}

export function weekProgress(scope: StudioScope, studio: Studio, userId: string, now = new Date()) {
  const lp = localParts(now, studio.timezone);
  const from = zonedToUtc(weekStart(lp.date), '00:00', studio.timezone).toISOString();
  const to = zonedToUtc(addDays(weekStart(lp.date), 7), '00:00', studio.timezone).toISOString();
  const trainings = scope.get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM bookings b JOIN class_sessions s ON s.id = b.session_id
     WHERE b.studio_id = $studio AND b.user_id = $u AND b.guest_name IS NULL AND b.status IN ('booked', 'attended') AND s.starts_at >= $from AND s.starts_at < $to`,
    { u: userId, from, to },
  )!.n;
  const mindful = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM mindful_logs WHERE studio_id = $studio AND user_id = $u AND completed_at >= $from AND completed_at < $to', { u: userId, from, to })!.n;
  const visitDates = scope
    .all<{ starts_at: string }>(
      "SELECT s.starts_at FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = $u AND b.status = 'attended' AND b.guest_name IS NULL AND s.starts_at > $since",
      { u: userId, since: new Date(now.getTime() - 120 * 86_400_000).toISOString() },
    )
    .map((r) => localParts(new Date(r.starts_at), studio.timezone).date);
  const goal = weekGoalOf(scope, userId);
  const restDay = (scope.db.prepare('SELECT rest_day FROM users WHERE id = ?').get(userId) as { rest_day: string | null } | undefined)?.rest_day === lp.date;
  const done = { trainings, mindful };
  return { goal, done, visitDates, restDay, achieved: trainings >= goal.trainings && mindful >= goal.mindful, message: weekGoalMessage(goal, done, restDay) };
}
