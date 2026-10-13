// Społeczność studia (4.5, decyzja 10: zamknięta w obrębie studia): feed (posty, ogłoszenia, relacje trenerek,
// kalendarz wydarzeń), grupy tematyczne, wyzwania z postępem i odznakami, moderacja i zgłoszenia, widoczność profilu.
import type { FastifyInstance } from 'fastify';
import { badgeAvailable, badgeByCode, COMMUNITY_RULES, localParts, moderate, MODERATION_COPY, zonedToUtc, addDays } from '@glam/core';
import { assertFeature, ctx, isStaff, requirePerm, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { audit } from '../services/audit.ts';
import { storeMedia } from '../services/media.ts';
import { awardPoints, grantBadge } from '../services/motivation.ts';
import { notify } from '../services/notify.ts';
import type { Studio } from '../services/studio.ts';
import { prefsOf } from './account.ts';

/** Widoczność autorki (4.5): publiczny (w studiu) / tylko znajomi z grup / prywatny = inicjał. */
function authorView(scope: StudioScope, viewerId: string, author: { id: string; name: string | null; prefs_json: string | null; avatar_mime: string | null; avatar_version: number; staff: number }) {
  const vis = prefsOf(author).visibility ?? 'studio';
  const sharedGroup = vis === 'public' || vis === 'studio' || author.id === viewerId || !!author.staff
    ? true
    : !!scope.get('SELECT 1 FROM group_members a JOIN group_members b ON a.group_id = b.group_id WHERE a.studio_id = $studio AND a.user_id = $x AND b.user_id = $y', { x: viewerId, y: author.id });
  const showFull = author.staff || author.id === viewerId || (vis !== 'private' && sharedGroup);
  return {
    id: author.id,
    name: showFull ? (author.name ?? 'Klientka') : `${(author.name ?? 'K').charAt(0)}.`,
    avatarUrl: showFull && author.avatar_mime ? `/api/users/${author.id}/avatar?v=${author.avatar_version}` : null,
    staff: !!author.staff,
  };
}

export function challengeProgress(scope: StudioScope, studio: Studio, ch: { id: string; metric: string; target: number; starts_on: string; ends_on: string }, userId: string): number {
  const from = zonedToUtc(ch.starts_on, '00:00', studio.timezone).toISOString();
  const to = zonedToUtc(addDays(ch.ends_on, 1), '00:00', studio.timezone).toISOString();
  if (ch.metric === 'trainings') {
    return scope.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = $u AND b.status = 'attended' AND b.guest_name IS NULL AND s.starts_at >= $f AND s.starts_at < $t",
      { u: userId, f: from, t: to },
    )!.n;
  }
  if (ch.metric === 'mindful') return scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM mindful_logs WHERE studio_id = $studio AND user_id = $u AND completed_at >= $f AND completed_at < $t', { u: userId, f: from, t: to })!.n;
  return scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM challenge_checkins WHERE studio_id = $studio AND challenge_id = $c AND user_id = $u', { c: ch.id, u: userId })!.n;
}

function completeIfDone(scope: StudioScope, studio: Studio, ch: { id: string; metric: string; target: number; starts_on: string; ends_on: string; badge_code: string | null; title: string }, userId: string) {
  const progress = challengeProgress(scope, studio, ch, userId);
  if (progress < ch.target) return false;
  const r = scope.run('UPDATE challenge_members SET completed_at = $now WHERE studio_id = $studio AND challenge_id = $c AND user_id = $u AND completed_at IS NULL', { c: ch.id, u: userId, now: nowIso() });
  if (!r.changes) return false;
  const today = localParts(new Date(), studio.timezone).date;
  const badge = ch.badge_code && badgeByCode(ch.badge_code);
  // Limitowane odznaki tylko w swoim okresie – potem zostają w archiwum (7.5, M6).
  if (badge && badgeAvailable(badge, today)) grantBadge(scope, userId, badge.code);
  grantBadge(scope, userId, 'challenge');
  awardPoints(scope, studio, userId, 'challenge', ch.id, studio.settings.loyalty.points.challenge);
  notify(scope, { userId, category: 'motivation', tz: studio.timezone, body: `Wyzwanie „${ch.title}” ukończone! Odznaka czeka w profilu 🏅`, action: 'profile/badges' });
  return true;
}

export function communityRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };
  const moderator = requirePerm(db, 'community.moderate');
  const challengesPerm = requirePerm(db, 'challenges.edit');

  app.get('/api/community/rules', member, async () => COMMUNITY_RULES);

  // ——— Feed studia ———

  app.get<{ Querystring: { group?: string; kind?: string } }>('/api/feed', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'community');
    const staff = isStaff(roles);
    if (req.query.group && !staff && !scope.get('SELECT 1 FROM group_members WHERE studio_id = $studio AND group_id = $g AND user_id = $u', { g: req.query.group, u: user.id })) throw forbidden();
    const posts = scope.all<{ id: string; author_id: string; kind: string; body: string; media_id: string | null; event_at: string | null; group_id: string | null; created_at: string; hidden: number; likes: number; liked: number; comments: number }>(
      `SELECT p.*, (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes, (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id AND l.user_id = $u) AS liked,
              (SELECT COUNT(*) FROM post_comments c WHERE c.post_id = p.id AND c.hidden = 0) AS comments
       FROM posts p WHERE p.studio_id = $studio AND (p.hidden = 0 OR $staff = 1) AND ${req.query.group ? 'p.group_id = $g' : 'p.group_id IS NULL'} ${req.query.kind ? 'AND p.kind = $k' : ''}
       ORDER BY CASE WHEN p.kind = 'announcement' AND p.created_at > $recent THEN 0 ELSE 1 END, p.created_at DESC LIMIT 50`,
      { u: user.id, staff: Number(staff), recent: new Date(Date.now() - 3 * 86_400_000).toISOString(), ...(req.query.group ? { g: req.query.group } : {}), ...(req.query.kind ? { k: req.query.kind } : {}) },
    );
    const authors = new Map<string, ReturnType<typeof authorView>>();
    const author = (aid: string) => {
      if (!authors.has(aid)) {
        const a = scope.get<{ id: string; name: string | null; prefs_json: string | null; avatar_mime: string | null; avatar_version: number; staff: number }>(
          "SELECT u.id, u.name, u.prefs_json, u.avatar_mime, u.avatar_version, EXISTS (SELECT 1 FROM memberships m WHERE m.studio_id = $studio AND m.user_id = u.id AND m.role != 'client') AS staff FROM users u WHERE u.id = $id",
          { id: aid },
        );
        authors.set(aid, a ? authorView(scope, user.id, a) : { id: aid, name: 'Klientka', avatarUrl: null, staff: false });
      }
      return authors.get(aid)!;
    };
    return posts.map((p) => ({
      ...p,
      liked: !!p.liked,
      mine: p.author_id === user.id,
      author: author(p.author_id),
      mediaUrl: p.media_id ? `/api/media/${p.media_id}` : null,
      commentsList: scope
        .all<{ id: string; author_id: string; body: string; created_at: string; hidden: number }>('SELECT * FROM post_comments WHERE studio_id = $studio AND post_id = $p AND (hidden = 0 OR $staff = 1) ORDER BY created_at LIMIT 20', { p: p.id, staff: Number(staff) })
        .map((c) => ({ ...c, author: author(c.author_id), mine: c.author_id === user.id })),
    }));
  });

  // Kalendarz wydarzeń studia w feedzie (posty typu „event” z datą).
  app.get('/api/feed/events', member, async (req) => {
    const { scope } = ctx(req);
    return scope.all("SELECT id, body, event_at FROM posts WHERE studio_id = $studio AND kind = 'event' AND hidden = 0 AND event_at >= $now ORDER BY event_at LIMIT 20", { now: new Date(Date.now() - 86_400_000).toISOString() });
  });

  app.post<{ Body: { body: string; kind?: 'post' | 'announcement' | 'story' | 'event'; groupId?: string | null; eventAt?: string | null; photo?: string | null; photoConsent?: boolean } }>(
    '/api/posts',
    { ...member, bodyLimit: 5 * 1024 * 1024 },
    async (req) => {
      const { scope, studio, user, roles } = ctx(req);
      assertFeature(studio, 'community');
      const b = req.body ?? ({} as typeof req.body);
      const kind = b.kind ?? 'post';
      // Ogłoszenia i relacje trenerek – tylko zespół; zwykłe posty – wszystkie klientki.
      if (kind !== 'post' && !isStaff(roles)) throw forbidden();
      const m = moderate(b.body, { maxLength: 1500, allowLinks: isStaff(roles) });
      if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
      if (b.groupId && !isStaff(roles) && !scope.get('SELECT 1 FROM group_members WHERE studio_id = $studio AND group_id = $g AND user_id = $u', { g: b.groupId, u: user.id })) throw forbidden();
      // Zdjęcia innych osób tylko za ich zgodą (4.5, 11) – autorka potwierdza.
      if (b.photo && !b.photoConsent) throw badRequest('Potwierdź, że osoby na zdjęciu zgodziły się na publikację.');
      const media = b.photo ? storeMedia(scope, studio, { dataUrl: b.photo, kind: 'post', ownerId: user.id, allow: ['image'] }) : null;
      const pid = id();
      scope.run(
        'INSERT INTO posts (id, studio_id, author_id, group_id, kind, body, media_id, photo_consent, event_at, created_at) VALUES ($id, $studio, $a, $g, $k, $b, $m, $c, $e, $now)',
        { id: pid, a: user.id, g: b.groupId ?? null, k: kind, b: b.body.trim(), m: media?.id ?? null, c: Number(!!b.photoConsent), e: kind === 'event' ? b.eventAt ?? null : null, now: nowIso() },
      );
      if (kind === 'announcement') {
        const clients = scope.all<{ user_id: string }>("SELECT user_id FROM memberships WHERE studio_id = $studio AND role = 'client'");
        for (const c of clients) notify(scope, { userId: c.user_id, category: 'community', tz: studio.timezone, body: b.body.trim().split(/(?<=[.!?])\s/).slice(0, 2).join(' ').slice(0, 160), action: 'community' });
      }
      return { id: pid };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/posts/:id', member, async (req) => {
    const { scope, user, roles } = ctx(req);
    const p = scope.get<{ author_id: string }>('SELECT author_id FROM posts WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!p) throw notFound();
    if (p.author_id !== user.id && !roles.some((r) => r === 'owner' || r === 'coordinator')) throw forbidden();
    scope.run('DELETE FROM post_likes WHERE studio_id = $studio AND post_id = $id', { id: req.params.id });
    scope.run('DELETE FROM post_comments WHERE studio_id = $studio AND post_id = $id', { id: req.params.id });
    scope.run('DELETE FROM posts WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/posts/:id/like', member, async (req) => {
    const { scope, user } = ctx(req);
    if (!scope.get('SELECT 1 FROM posts WHERE studio_id = $studio AND id = $id AND hidden = 0', { id: req.params.id })) throw notFound();
    const had = scope.get('SELECT 1 FROM post_likes WHERE studio_id = $studio AND post_id = $p AND user_id = $u', { p: req.params.id, u: user.id });
    if (had) scope.run('DELETE FROM post_likes WHERE studio_id = $studio AND post_id = $p AND user_id = $u', { p: req.params.id, u: user.id });
    else scope.run('INSERT INTO post_likes (studio_id, post_id, user_id) VALUES ($studio, $p, $u)', { p: req.params.id, u: user.id });
    return { liked: !had };
  });

  app.post<{ Params: { id: string }; Body: { body: string } }>('/api/posts/:id/comments', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const post = scope.get<{ author_id: string }>('SELECT author_id FROM posts WHERE studio_id = $studio AND id = $id AND hidden = 0', { id: req.params.id });
    if (!post) throw notFound();
    const m = moderate(req.body?.body, { maxLength: 500 });
    if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    scope.run('INSERT INTO post_comments (id, studio_id, post_id, author_id, body, created_at) VALUES ($id, $studio, $p, $a, $b, $now)', { id: id(), p: req.params.id, a: user.id, b: req.body.body.trim(), now: nowIso() });
    if (post.author_id !== user.id) notify(scope, { userId: post.author_id, category: 'community', tz: studio.timezone, body: `${user.name ?? 'Ktoś'} skomentowała Twój wpis 💬`, action: 'community', dedupeKey: `comment:${req.params.id}:${user.id}` });
    return { ok: true };
  });

  // ——— Moderacja (4.5, decyzja 5, 10, 12): zgłoszenia, ukrywanie, log ———

  app.post<{ Body: { targetKind: 'post' | 'comment' | 'question' | 'review' | 'track'; targetId: string; reason: string } }>('/api/reports', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body;
    if (!['post', 'comment', 'question', 'review', 'track'].includes(b?.targetKind) || !b.targetId) throw badRequest('Nieprawidłowe zgłoszenie.');
    scope.run("INSERT INTO reports (id, studio_id, reporter_id, target_kind, target_id, reason, status, created_at) VALUES ($id, $studio, $u, $k, $t, $r, 'open', $now)", {
      id: id(),
      u: user.id,
      k: b.targetKind,
      t: b.targetId,
      r: String(b.reason ?? '').slice(0, 300) || 'bez opisu',
      now: nowIso(),
    });
    const mods = scope.all<{ user_id: string }>("SELECT DISTINCT user_id FROM memberships WHERE studio_id = $studio AND role IN ('owner', 'coordinator')");
    for (const m of mods) notify(scope, { userId: m.user_id, category: 'community', tz: studio.timezone, body: 'Nowe zgłoszenie w społeczności czeka na moderację.', action: 'staff/community' });
    return { message: 'Dziękujemy. Moderacja studia zajmie się tym dyskretnie.' };
  });

  app.get('/api/staff/reports', moderator, async (req) => {
    const { scope } = ctx(req);
    return scope.all<{ target_kind: string; target_id: string }>('SELECT r.*, u.name AS reporter FROM reports r JOIN users u ON u.id = r.reporter_id WHERE r.studio_id = $studio ORDER BY r.status = \'open\' DESC, r.created_at DESC LIMIT 100').map((r) => {
      const table = { post: 'posts', comment: 'post_comments', question: 'course_questions', review: 'course_reviews', track: 'playlist_tracks' }[r.target_kind as 'post'];
      const col = r.target_kind === 'review' ? "course_id || ':' || user_id" : 'id';
      const content = table ? scope.get<{ body?: string; title?: string }>(`SELECT ${r.target_kind === 'track' ? 'title AS body' : 'body'} FROM ${table} WHERE studio_id = $studio AND ${col} = $id`, { id: r.target_id }) : undefined;
      return { ...r, content: content?.body ?? '(usunięte)' };
    });
  });

  app.post<{ Params: { id: string }; Body: { action: 'hide' | 'dismiss' } }>('/api/staff/reports/:id', moderator, async (req) => {
    const { scope, user } = ctx(req);
    const r = scope.get<{ target_kind: string; target_id: string }>('SELECT target_kind, target_id FROM reports WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!r) throw notFound();
    if (req.body?.action === 'hide') hideContent(scope, r.target_kind, r.target_id);
    scope.run('UPDATE reports SET status = $s, resolved_by = $u WHERE studio_id = $studio AND target_kind = $k AND target_id = $t', { s: req.body?.action === 'hide' ? 'hidden' : 'dismissed', u: user.id, k: r.target_kind, t: r.target_id });
    audit(scope, { actorId: user.id, action: `moderation.${req.body?.action}`, entity: r.target_kind, entityId: r.target_id });
    return { ok: true };
  });

  app.post<{ Body: { kind: string; id: string; hidden: boolean } }>('/api/staff/moderate', moderator, async (req) => {
    const { scope, user } = ctx(req);
    if (req.body?.hidden) hideContent(scope, req.body.kind, req.body.id);
    else hideContent(scope, req.body.kind, req.body.id, false);
    audit(scope, { actorId: user.id, action: req.body?.hidden ? 'moderation.hide' : 'moderation.unhide', entity: req.body.kind, entityId: req.body.id });
    return { ok: true };
  });

  // ——— Grupy tematyczne (#26) ———

  app.get('/api/groups', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'community');
    return scope.all(
      `SELECT g.id, g.name, g.description, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
              EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $u) AS joined
       FROM groups g WHERE g.studio_id = $studio ORDER BY g.name`,
      { u: user.id },
    );
  });

  app.post<{ Params: { id: string } }>('/api/groups/:id/join', member, async (req) => {
    const { scope, user } = ctx(req);
    if (!scope.get('SELECT 1 FROM groups WHERE studio_id = $studio AND id = $id', { id: req.params.id })) throw notFound();
    scope.run('INSERT OR IGNORE INTO group_members (studio_id, group_id, user_id, joined_at) VALUES ($studio, $g, $u, $now)', { g: req.params.id, u: user.id, now: nowIso() });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/groups/:id/leave', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('DELETE FROM group_members WHERE studio_id = $studio AND group_id = $g AND user_id = $u', { g: req.params.id, u: user.id });
    return { ok: true };
  });

  app.post<{ Body: { name: string; description?: string } }>('/api/staff/groups', requirePerm(db, 'challenges.edit', 'community.moderate'), async (req) => {
    const { scope } = ctx(req);
    if (!req.body?.name?.trim()) throw badRequest('Podaj nazwę grupy.');
    const gid = id();
    scope.run('INSERT INTO groups (id, studio_id, name, description, created_at) VALUES ($id, $studio, $n, $d, $now)', { id: gid, n: req.body.name.trim().slice(0, 60), d: req.body.description?.slice(0, 300) ?? null, now: nowIso() });
    return { id: gid };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/groups/:id', requirePerm(db, 'community.moderate'), async (req) => {
    const { scope } = ctx(req);
    scope.tx(() => {
      scope.run('DELETE FROM group_members WHERE studio_id = $studio AND group_id = $id', { id: req.params.id });
      scope.run('UPDATE posts SET group_id = NULL, hidden = 1 WHERE studio_id = $studio AND group_id = $id', { id: req.params.id });
      scope.run('DELETE FROM groups WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    });
    return { ok: true };
  });

  // ——— Wyzwania (#27) ———

  app.get('/api/challenges', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'challenges');
    const today = localParts(new Date(), studio.timezone).date;
    return scope
      .all<{ id: string; title: string; description: string | null; metric: string; target: number; starts_on: string; ends_on: string; badge_code: string | null; joined_at: string | null; completed_at: string | null; members: number }>(
        `SELECT c.*, m.joined_at, m.completed_at, (SELECT COUNT(*) FROM challenge_members x WHERE x.challenge_id = c.id) AS members
         FROM challenges c LEFT JOIN challenge_members m ON m.challenge_id = c.id AND m.user_id = $u WHERE c.studio_id = $studio AND c.ends_on >= $past ORDER BY c.starts_on DESC`,
        { u: user.id, past: addDays(today, -30) },
      )
      .map((c) => ({
        ...c,
        badge: c.badge_code ? badgeByCode(c.badge_code) ?? null : null,
        progress: c.joined_at ? challengeProgress(scope, studio, c, user.id) : 0,
        checkedToday: c.metric === 'checkins' && !!scope.get('SELECT 1 FROM challenge_checkins WHERE studio_id = $studio AND challenge_id = $c AND user_id = $u AND date = $d', { c: c.id, u: user.id, d: today }),
        active: c.starts_on <= today && today <= c.ends_on,
      }));
  });

  app.post<{ Params: { id: string } }>('/api/challenges/:id/join', member, async (req) => {
    const { scope, user, studio } = ctx(req);
    const ch = scope.get<{ ends_on: string }>('SELECT ends_on FROM challenges WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!ch) throw notFound();
    if (ch.ends_on < localParts(new Date(), studio.timezone).date) throw conflict('ended', 'To wyzwanie już się zakończyło.');
    scope.run('INSERT OR IGNORE INTO challenge_members (studio_id, challenge_id, user_id, joined_at) VALUES ($studio, $c, $u, $now)', { c: req.params.id, u: user.id, now: nowIso() });
    return { message: 'Dołączyłaś. W swoim tempie 🌿' };
  });

  // Codzienne „odhaczenie” (np. „30 dni planku”) – raz dziennie, tylko w czasie trwania wyzwania.
  app.post<{ Params: { id: string } }>('/api/challenges/:id/checkin', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const ch = scope.get<{ id: string; metric: string; target: number; starts_on: string; ends_on: string; badge_code: string | null; title: string }>('SELECT * FROM challenges WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!ch) throw notFound();
    const today = localParts(new Date(), studio.timezone).date;
    if (today < ch.starts_on || today > ch.ends_on) throw conflict('inactive', 'Wyzwanie nie trwa dziś.');
    if (!scope.get('SELECT 1 FROM challenge_members WHERE studio_id = $studio AND challenge_id = $c AND user_id = $u', { c: ch.id, u: user.id })) throw conflict('not_joined', 'Najpierw dołącz do wyzwania.');
    scope.run('INSERT OR IGNORE INTO challenge_checkins (studio_id, challenge_id, user_id, date) VALUES ($studio, $c, $u, $d)', { c: ch.id, u: user.id, d: today });
    const done = completeIfDone(scope, studio, ch, user.id);
    return { progress: challengeProgress(scope, studio, ch, user.id), completed: done };
  });

  app.post<{ Params: { id: string } }>('/api/challenges/:id/refresh', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const ch = scope.get<{ id: string; metric: string; target: number; starts_on: string; ends_on: string; badge_code: string | null; title: string }>('SELECT * FROM challenges WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!ch) throw notFound();
    return { progress: challengeProgress(scope, studio, ch, user.id), completed: completeIfDone(scope, studio, ch, user.id) };
  });

  app.post<{ Body: { title: string; description?: string; metric: 'trainings' | 'mindful' | 'checkins'; target: number; startsOn: string; endsOn: string; badgeCode?: string | null; themeId?: string | null } }>('/api/staff/challenges', challengesPerm, async (req) => {
    const { scope, user } = ctx(req);
    const b = req.body;
    if (!b?.title?.trim() || !['trainings', 'mindful', 'checkins'].includes(b.metric) || !(b.target >= 1 && b.target <= 365)) throw badRequest('Podaj nazwę, miarę i cel (1–365).');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(b.endsOn) || b.endsOn < b.startsOn) throw badRequest('Podaj daty wyzwania.');
    const m = moderate(`${b.title} ${b.description ?? ''}`, { allowLinks: false });
    if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    const cid = id();
    scope.run('INSERT INTO challenges (id, studio_id, title, description, metric, target, starts_on, ends_on, badge_code, theme_id, created_at) VALUES ($id, $studio, $t, $d, $m, $target, $s, $e, $b, $th, $now)', {
      id: cid,
      t: b.title.trim().slice(0, 80),
      d: b.description?.slice(0, 500) ?? null,
      m: b.metric,
      target: b.target,
      s: b.startsOn,
      e: b.endsOn,
      b: b.badgeCode ?? null,
      th: b.themeId ?? null,
      now: nowIso(),
    });
    audit(scope, { actorId: user.id, action: 'challenge.created', entity: 'challenge', entityId: cid });
    return { id: cid };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/challenges/:id', challengesPerm, async (req) => {
    const { scope } = ctx(req);
    scope.tx(() => {
      scope.run('DELETE FROM challenge_checkins WHERE studio_id = $studio AND challenge_id = $id', { id: req.params.id });
      scope.run('DELETE FROM challenge_members WHERE studio_id = $studio AND challenge_id = $id', { id: req.params.id });
      scope.run('DELETE FROM challenges WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    });
    return { ok: true };
  });

  // Widok moderatorki: posty łącznie z ukrytymi, grupy z liczbą członkiń, wyzwania z uczestniczkami (imiona – bez danych kontaktowych).
  app.get('/api/staff/community', requirePerm(db, 'community.moderate', 'challenges.edit'), async (req) => {
    const { scope } = ctx(req);
    return {
      groups: scope.all('SELECT g.id, g.name, g.description, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members FROM groups g WHERE g.studio_id = $studio ORDER BY g.name'),
      challenges: scope.all(
        'SELECT c.*, (SELECT COUNT(*) FROM challenge_members m WHERE m.challenge_id = c.id) AS members, (SELECT COUNT(*) FROM challenge_members m WHERE m.challenge_id = c.id AND m.completed_at IS NOT NULL) AS done FROM challenges c WHERE c.studio_id = $studio ORDER BY c.starts_on DESC',
      ),
      hidden: scope.all("SELECT p.id, p.body, p.created_at, u.name FROM posts p JOIN users u ON u.id = p.author_id WHERE p.studio_id = $studio AND p.hidden = 1 ORDER BY p.created_at DESC LIMIT 30"),
      openReports: scope.get<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE studio_id = $studio AND status = 'open'")!.n,
    };
  });
}

export function hideContent(scope: StudioScope, kind: string, targetId: string, hidden = true) {
  const h = Number(hidden);
  if (kind === 'post') scope.run('UPDATE posts SET hidden = $h WHERE studio_id = $studio AND id = $id', { h, id: targetId });
  else if (kind === 'comment') scope.run('UPDATE post_comments SET hidden = $h WHERE studio_id = $studio AND id = $id', { h, id: targetId });
  else if (kind === 'question') scope.run('UPDATE course_questions SET hidden = $h WHERE studio_id = $studio AND id = $id', { h, id: targetId });
  else if (kind === 'review') scope.run("UPDATE course_reviews SET hidden = $h WHERE studio_id = $studio AND course_id || ':' || user_id = $id", { h, id: targetId });
  else if (kind === 'track') scope.run("UPDATE playlist_tracks SET status = CASE WHEN $h = 1 THEN 'rejected' ELSE 'approved' END WHERE studio_id = $studio AND id = $id", { h, id: targetId });
  else throw badRequest('Nieznany rodzaj treści.');
}
