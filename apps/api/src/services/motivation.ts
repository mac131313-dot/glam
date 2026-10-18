// Motywacja po stronie serwera (4.5, 4.7, 4.8.2, 8.1.3): punkty i poziomy, odznaki, nagroda po 10. zajęciach,
// gratulacje przy kamieniach milowych, statusy poleceń, NPS po każdym 10. treningu.
import { badgeByCode, earnedBadges, levelFor, localParts, MILESTONES, rewardCounter, TRIGGERS, weeklyStreak } from '@glam/core';
import { id } from '../db.ts';
import type { StudioScope } from '../scope.ts';
import { notify } from './notify.ts';
import type { Studio } from './studio.ts';

export function attendedCount(scope: StudioScope, userId: string): number {
  return scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM bookings WHERE studio_id = $studio AND user_id = $u AND status = 'attended' AND guest_name IS NULL", { u: userId })!.n;
}

export function pointsOf(scope: StudioScope, userId: string): number {
  return scope.get<{ p: number }>('SELECT COALESCE(SUM(points), 0) AS p FROM loyalty_ledger WHERE studio_id = $studio AND user_id = $u', { u: userId })!.p;
}

/** Punkty za aktywność – raz na (powód, odniesienie). Zwraca true, gdy przyznano. */
export function awardPoints(scope: StudioScope, studio: Studio, userId: string, reason: string, ref: string, points: number, now = new Date()): boolean {
  if (!studio.settings.loyalty.enabled || !studio.has('loyalty') || points === 0) return false;
  const before = pointsOf(scope, userId);
  const r = scope.run(
    'INSERT OR IGNORE INTO loyalty_ledger (id, studio_id, user_id, points, reason, ref, created_at) VALUES ($id, $studio, $u, $p, $reason, $ref, $now)',
    { id: id(), u: userId, p: points, reason, ref, now: now.toISOString() },
  );
  if (!r.changes) return false;
  const levels = studio.settings.loyalty.levels;
  const a = levelFor(before, levels).current;
  const b = levelFor(before + points, levels).current;
  if (b.id !== a.id && b.minPoints > a.minPoints) {
    notify(scope, { userId, category: 'loyalty', tz: studio.timezone, now, body: TRIGGERS.level_up.text({ level: b.name }), action: 'profile/loyalty', dedupeKey: `level:${b.id}` });
  }
  return true;
}

export function grantBadge(scope: StudioScope, userId: string, code: string, now = new Date()): boolean {
  const r = scope.run('INSERT OR IGNORE INTO user_badges (studio_id, user_id, code, earned_at) VALUES ($studio, $u, $c, $now)', { u: userId, c: code, now: now.toISOString() });
  return !!r.changes;
}

export function badgeStats(scope: StudioScope, studio: Studio, userId: string, now = new Date()) {
  const visits = scope
    .all<{ starts_at: string }>(
      `SELECT s.starts_at FROM bookings b JOIN class_sessions s ON s.id = b.session_id
       WHERE b.studio_id = $studio AND b.user_id = $u AND b.status = 'attended' AND b.guest_name IS NULL ORDER BY s.starts_at DESC`,
      { u: userId },
    )
    .map((r) => localParts(new Date(r.starts_at), studio.timezone).date);
  const joined = scope.get<{ joined_at: string }>("SELECT joined_at FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'client'", { u: userId });
  const mindful = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM mindful_logs WHERE studio_id = $studio AND user_id = $u AND kind IN ('meditation', 'breath')", { u: userId })!.n;
  const journal = (scope.db.prepare('SELECT COUNT(*) AS n FROM journal_entries WHERE user_id = ?').get(userId) as { n: number }).n;
  const calm = (scope.db.prepare("SELECT COUNT(*) AS n FROM course_mini_progress WHERE user_id = ? AND program = 'calm7'").get(userId) as { n: number }).n;
  const friends = scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM referrals WHERE studio_id = $studio AND inviter_id = $u AND status IN ('first_class', 'purchased')", { u: userId })!.n;
  const today = localParts(now, studio.timezone).date;
  return {
    attended: visits.length,
    streakWeeks: weeklyStreak(visits, today),
    daysSinceJoin: joined ? (now.getTime() - Date.parse(joined.joined_at)) / 86_400_000 : 0,
    mindfulSessions: mindful,
    journalEntries: journal,
    calmCourseDone: calm >= 7,
    friendsBrought: friends,
    visits,
  };
}

/** Przelicza odznaki należne ze statystyk; nowe odznaki zwraca. */
export function refreshBadges(scope: StudioScope, studio: Studio, userId: string, now = new Date()): string[] {
  const s = badgeStats(scope, studio, userId, now);
  const fresh = earnedBadges(s).filter((code) => grantBadge(scope, userId, code, now));
  return fresh;
}

/**
 * Zrealizowany trening (check-in albo automatyczne zaliczenie po zajęciach):
 * punkty, odznaki, nagroda po 10. zajęciach, gratulacje, status polecenia, NPS co 10. trening.
 */
export function onAttended(scope: StudioScope, studio: Studio, userId: string, bookingId: string, now = new Date()) {
  awardPoints(scope, studio, userId, 'training', bookingId, studio.settings.loyalty.points.training, now);
  const count = attendedCount(scope, userId);
  const reward = studio.settings.tenClassReward;
  if (reward.enabled && count > 0 && count % reward.every === 0) {
    const milestone = count;
    const created = scope.run(
      `INSERT INTO locker_items (id, studio_id, user_id, source, title, options_json, status, milestone, created_at, updated_at)
       SELECT $id, $studio, $u, 'ten_classes', $title, $opts, 'choose', $m, $now, $now
       WHERE NOT EXISTS (SELECT 1 FROM locker_items WHERE studio_id = $studio AND user_id = $u AND source = 'ten_classes' AND milestone = $m)`,
      {
        id: id(),
        u: userId,
        title: `Nagroda za ${milestone} treningów: ${reward.defaultItem}`,
        opts: JSON.stringify({ delivery: reward.delivery }),
        m: milestone,
        now: now.toISOString(),
      },
    );
    if (created.changes) {
      notify(scope, { userId, category: 'loyalty', tz: studio.timezone, now, body: TRIGGERS.ten_classes.text({}), action: 'profile/locker', dedupeKey: `ten:${milestone}` });
    }
  }
  if (count === 10) notify(scope, { userId, category: 'occasional', occasion: 'milestone', tz: studio.timezone, now, body: MILESTONES.tenClasses, dedupeKey: 'milestone:10' });
  if (studio.settings.nps.everyNthTraining > 0 && count > 0 && count % studio.settings.nps.everyNthTraining === 0) {
    scope.run("INSERT OR IGNORE INTO nps_responses (id, studio_id, user_id, trigger, created_at) VALUES ($id, $studio, $u, $t, $now)", {
      id: id(),
      u: userId,
      t: `training:${count}`,
      now: now.toISOString(),
    });
  }
  // Polecenie: znajoma ma pierwszy trening → status i podziękowanie dla zapraszającej.
  if (count === 1) {
    const ref = scope.get<{ id: string; inviter_id: string }>(
      "SELECT id, inviter_id FROM referrals WHERE studio_id = $studio AND invitee_id = $u AND status IN ('sent', 'accepted')",
      { u: userId },
    );
    if (ref) {
      scope.run("UPDATE referrals SET status = 'first_class', updated_at = $now WHERE studio_id = $studio AND id = $id", { id: ref.id, now: now.toISOString() });
      const name = (scope.db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string | null }).name ?? 'Twoja znajoma';
      notify(scope, { userId: ref.inviter_id, category: 'occasional', occasion: 'milestone', tz: studio.timezone, now, body: MILESTONES.friendFirstClass(name), dedupeKey: `friend-first:${userId}` });
      awardPoints(scope, studio, ref.inviter_id, 'referral', userId, studio.settings.loyalty.points.referral, now);
      refreshBadges(scope, studio, ref.inviter_id, now);
    }
  }
  refreshBadges(scope, studio, userId, now);
}

export function badgeList(scope: StudioScope, userId: string) {
  return scope
    .all<{ code: string; earned_at: string }>('SELECT code, earned_at FROM user_badges WHERE studio_id = $studio AND user_id = $u ORDER BY earned_at DESC', { u: userId })
    .map((b) => ({ ...b, ...(badgeByCode(b.code) ?? { name: b.code, description: '', icon: 'star' }) }));
}

export function rewardProgress(scope: StudioScope, studio: Studio, userId: string) {
  const r = studio.settings.tenClassReward;
  return r.enabled ? { ...rewardCounter(attendedCount(scope, userId), r.every), item: r.defaultItem } : null;
}

