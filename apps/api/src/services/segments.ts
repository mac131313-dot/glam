// Fakty o klientkach studia → segmenty (aktywne / uśpione / nowe / ambasadorki / ryzyko odejścia)
// i analityka (core/analytics.ts). Jedno zapytanie na studio, bez N+1.
import { segmentsOf, type ClientFacts, type Segment } from '@glam/core';
import type { StudioScope } from '../scope.ts';

export function clientFacts(scope: StudioScope, now = new Date(), onlyUserId?: string): (ClientFacts & { name: string | null; phone: string; groups: string[] })[] {
  const base = scope.all<{ user_id: string; name: string | null; phone: string; joined_at: string }>(
    `SELECT m.user_id, u.name, u.phone, m.joined_at FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.studio_id = $studio AND m.role = 'client' AND u.deleted_at IS NULL ${onlyUserId ? 'AND m.user_id = $only' : ''}`,
    onlyUserId ? { only: onlyUserId } : {},
  );
  const visits = scope.all<{ user_id: string; starts_at: string }>(
    `SELECT b.user_id, s.starts_at FROM bookings b JOIN class_sessions s ON s.id = b.session_id
     WHERE b.studio_id = $studio AND b.status = 'attended' AND b.guest_name IS NULL ORDER BY s.starts_at DESC`,
  );
  const gym = scope.all<{ user_id: string; at: string }>('SELECT user_id, at FROM zone_checkins WHERE studio_id = $studio ORDER BY at DESC');
  const refs = scope.all<{ inviter_id: string; n: number }>("SELECT inviter_id, COUNT(*) AS n FROM referrals WHERE studio_id = $studio AND status IN ('first_class', 'purchased') GROUP BY inviter_id");
  const npsRows = scope.all<{ user_id: string; score: number }>('SELECT user_id, score FROM nps_responses WHERE studio_id = $studio AND score IS NOT NULL ORDER BY answered_at');
  const passes = scope.all<{ user_id: string; valid_until: string }>("SELECT user_id, MAX(valid_until) AS valid_until FROM passes WHERE studio_id = $studio AND status = 'active' GROUP BY user_id");
  const late = scope.all<{ user_id: string; n: number }>(
    "SELECT user_id, COUNT(*) AS n FROM bookings WHERE studio_id = $studio AND status IN ('late_cancel', 'no_show') AND updated_at > $since GROUP BY user_id",
    { since: new Date(now.getTime() - 30 * 86_400_000).toISOString() },
  );
  const revenue = scope.all<{ user_id: string; total: number }>("SELECT user_id, SUM(amount_grosze) AS total FROM payments WHERE studio_id = $studio AND status = 'paid' AND user_id IS NOT NULL GROUP BY user_id");
  const groups = scope.all<{ user_id: string; name: string }>('SELECT gm.user_id, g.name FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.studio_id = $studio');

  const by = <T extends { user_id: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
    return m;
  };
  const v = by(visits);
  const g = by(gym.map((x) => ({ user_id: x.user_id, starts_at: x.at })));
  const refMap = new Map(refs.map((r) => [r.inviter_id, r.n]));
  const npsMap = new Map(npsRows.map((r) => [r.user_id, r.score]));
  const passMap = new Map(passes.map((p) => [p.user_id, p.valid_until]));
  const lateMap = new Map(late.map((r) => [r.user_id, r.n]));
  const revMap = new Map(revenue.map((r) => [r.user_id, r.total]));
  const grp = by(groups);

  return base.map((c) => {
    const all = [...(v.get(c.user_id) ?? []), ...(g.get(c.user_id) ?? [])].map((x) => x.starts_at).sort().reverse();
    const until = passMap.get(c.user_id);
    return {
      userId: c.user_id,
      name: c.name,
      phone: c.phone,
      joinedAt: c.joined_at,
      lastVisit: all[0] ?? null,
      visits: all,
      referralsConverted: refMap.get(c.user_id) ?? 0,
      lastNps: npsMap.get(c.user_id) ?? null,
      hasActivePass: !!until && Date.parse(until) > now.getTime(),
      passEndsInDays: until ? Math.round((Date.parse(until) - now.getTime()) / 86_400_000) : null,
      lateCancels30d: lateMap.get(c.user_id) ?? 0,
      revenueGrosze: revMap.get(c.user_id) ?? 0,
      groups: (grp.get(c.user_id) ?? []).map((x) => x.name),
    };
  });
}

/** Segmenty jednej klientki (motyw dla segmentu M3, kampanie). Grupy tematyczne też są segmentami. */
export function segmentsForUser(scope: StudioScope, userId: string, now = new Date()): string[] {
  const f = clientFacts(scope, now, userId)[0];
  return f ? [...segmentsOf(f, now), ...f.groups.map((g) => `group:${g}`)] : [];
}

/** Odbiorczynie kampanii / motywu: 'all' | segment | 'group:<nazwa>'. */
export function audience(scope: StudioScope, segment: string, now = new Date()): string[] {
  const facts = clientFacts(scope, now);
  if (segment === 'all') return facts.map((f) => f.userId);
  if (segment.startsWith('group:')) return facts.filter((f) => f.groups.includes(segment.slice(6))).map((f) => f.userId);
  return facts.filter((f) => (segmentsOf(f, now) as string[]).includes(segment as Segment)).map((f) => f.userId);
}
