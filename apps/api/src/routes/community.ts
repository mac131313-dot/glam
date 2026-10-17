// Społeczność studia (4.5, decyzja 10: zamknięta w obrębie studia): feed (posty, ogłoszenia, relacje trenerek,
// kalendarz wydarzeń), grupy tematyczne, wyzwania z postępem i odznakami, moderacja i zgłoszenia, widoczność profilu.
import type { FastifyInstance } from 'fastify';
import { badgeAvailable, badgeByCode, can, COMMUNITY_RULES, localParts, moderate, MODERATION_COPY, zonedToUtc, addDays } from '@glam/core';
import { assertFeature, ctx, isStaff, requirePerm, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, conflict, forbidden, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { audit } from '../services/audit.ts';
import { CHAT_BODY_LIMIT, type ChatInput } from '../services/chat.ts';
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

  app.post<{ Body: { targetKind: 'post' | 'comment' | 'question' | 'review' | 'track' | 'group_chat'; targetId: string; reason: string } }>('/api/reports', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body;
    if (!['post', 'comment', 'question', 'review', 'track', 'group_chat'].includes(b?.targetKind) || !b.targetId) throw badRequest('Nieprawidłowe zgłoszenie.');
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
      const table = { post: 'posts', comment: 'post_comments', question: 'course_questions', review: 'course_reviews', track: 'playlist_tracks', group_chat: 'group_chat' }[r.target_kind as 'post'];
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
    return groupList(scope, user.id, 'studio');
  });

  // Grupa bez akceptacji – dołączenie od razu; z akceptacją (approval = 1) – prośba, którą studio rozpatruje w panelu.
  app.post<{ Params: { id: string }; Body: { message?: string } }>('/api/groups/:id/join', member, async (req) => {
    const { scope, user } = ctx(req);
    const g = scope.get<{ approval: number }>('SELECT approval FROM groups WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!g) throw notFound();
    if (scope.get('SELECT 1 FROM group_members WHERE studio_id = $studio AND group_id = $g AND user_id = $u', { g: req.params.id, u: user.id })) return { ok: true };
    if (g.approval) {
      const message = String(req.body?.message ?? '').trim().slice(0, 300) || null;
      if (message) {
        const m = moderate(message, { maxLength: 300, allowLinks: false });
        if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
      }
      scope.run(
        `INSERT INTO group_requests (studio_id, group_id, user_id, message, status, created_at) VALUES ($studio, $g, $u, $m, 'pending', $now)
         ON CONFLICT (group_id, user_id) DO UPDATE SET message = $m, status = 'pending', created_at = $now, decided_at = NULL, decided_by = NULL`,
        { g: req.params.id, u: user.id, m: message, now: nowIso() },
      );
      return { requested: true, message: 'Prośba wysłana – studio da znać, gdy ją przejrzy 🌸' };
    }
    scope.run('INSERT OR IGNORE INTO group_members (studio_id, group_id, user_id, joined_at) VALUES ($studio, $g, $u, $now)', { g: req.params.id, u: user.id, now: nowIso() });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/groups/:id/leave', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('DELETE FROM group_members WHERE studio_id = $studio AND group_id = $g AND user_id = $u', { g: req.params.id, u: user.id });
    // Wycofanie prośby, która jeszcze czeka.
    scope.run("DELETE FROM group_requests WHERE studio_id = $studio AND group_id = $g AND user_id = $u AND status = 'pending'", { g: req.params.id, u: user.id });
    return { ok: true };
  });

  // ——— Czat grupy (Razem → Grupy, aplikacja trenerki) ———
  // Piszą członkinie i trenerka-opiekunka; opiekunka i moderatorki ukrywają wiadomości. Zastępuje feed grup.

  const authorOf = (scope: StudioScope, viewerId: string) => {
    const cache = new Map<string, ReturnType<typeof authorView>>();
    return (aid: string) => {
      if (!cache.has(aid)) {
        const a = scope.get<{ id: string; name: string | null; prefs_json: string | null; avatar_mime: string | null; avatar_version: number; staff: number }>(
          "SELECT u.id, u.name, u.prefs_json, u.avatar_mime, u.avatar_version, EXISTS (SELECT 1 FROM memberships m WHERE m.studio_id = $studio AND m.user_id = u.id AND m.role != 'client') AS staff FROM users u WHERE u.id = $id",
          { id: aid },
        );
        cache.set(aid, a ? authorView(scope, viewerId, a) : { id: aid, name: 'Klientka', avatarUrl: null, staff: false });
      }
      return cache.get(aid)!;
    };
  };

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>('/api/groups/:id/chat', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'community');
    const g = groupAccess(scope, roles, user.id, req.params.id);
    const rows = scope.all<{ id: string; author_id: string; body: string; media_id: string | null; attachment_name: string | null; mime: string | null; hidden: number; created_at: string }>(
      `SELECT c.id, c.author_id, c.body, c.media_id, c.attachment_name, m.mime, c.hidden, c.created_at
       FROM group_chat c LEFT JOIN media m ON m.id = c.media_id AND m.studio_id = c.studio_id
       WHERE c.studio_id = $studio AND c.group_id = $g AND (c.hidden = 0 OR $mod = 1) ${req.query.after ? 'AND c.created_at > $after' : ''}
       ORDER BY c.created_at DESC LIMIT 300`,
      { g: g.id, mod: Number(g.canModerate), ...(req.query.after ? { after: req.query.after } : {}) },
    );
    // Przeczytane = do ostatniej pokazanej wiadomości (nie „teraz”), żeby nic zapisanego w tej samej chwili nie przepadło.
    if (rows.length) markRead(scope, g.id, user.id, rows[0].created_at);
    const author = authorOf(scope, user.id);
    return {
      group: { id: g.id, name: g.name, description: g.description, members: g.members, trainer: g.trainer_id ? author(g.trainer_id) : null, canModerate: g.canModerate, member: g.member },
      messages: rows.reverse().map(({ media_id, attachment_name, mime, author_id, ...r }) => ({
        ...r,
        mine: author_id === user.id,
        trainer: author_id === g.trainer_id,
        author: author(author_id),
        attachment: media_id && mime ? { url: `/api/media/${media_id}`, name: attachment_name, type: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'pdf' } : null,
      })),
    };
  });

  app.post<{ Params: { id: string }; Body: ChatInput }>('/api/groups/:id/chat', { ...member, bodyLimit: CHAT_BODY_LIMIT }, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'community');
    const g = groupAccess(scope, roles, user.id, req.params.id);
    const body = String(req.body?.body ?? '').trim();
    const file = req.body?.attachment ? String(req.body.attachment) : null;
    if (!body && !file) throw badRequest('Napisz wiadomość albo dodaj plik.');
    if (body) {
      const m = moderate(body, { maxLength: 1500, allowLinks: isStaff(roles) });
      if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    }
    const media = file ? storeMedia(scope, studio, { dataUrl: file, kind: 'group', ownerId: user.id, private: true, allow: ['image', 'video', 'pdf'] }) : null;
    const mid = id();
    const now = nowIso();
    scope.run(
      'INSERT INTO group_chat (id, studio_id, group_id, author_id, body, media_id, attachment_name, created_at) VALUES ($id, $studio, $g, $a, $b, $m, $n, $now)',
      { id: mid, g: g.id, a: user.id, b: body, m: media?.id ?? null, n: media ? String(req.body.attachmentName ?? '').trim().slice(0, 120) || null : null, now },
    );
    markRead(scope, g.id, user.id, now);
    notifyGroupChat(scope, studio, g, user.id, body);
    return { id: mid, created_at: now };
  });

  // Autorka usuwa swoją wiadomość; opiekunka i moderatorki ukrywają (i przywracają) cudze.
  app.delete<{ Params: { id: string; messageId: string } }>('/api/groups/:id/chat/:messageId', member, async (req) => {
    const { scope, user, roles } = ctx(req);
    const g = groupAccess(scope, roles, user.id, req.params.id);
    const msg = scope.get<{ author_id: string; hidden: number }>('SELECT author_id, hidden FROM group_chat WHERE studio_id = $studio AND group_id = $g AND id = $id', { g: g.id, id: req.params.messageId });
    if (!msg) throw notFound();
    if (msg.author_id === user.id) {
      scope.run('DELETE FROM group_chat WHERE studio_id = $studio AND id = $id', { id: req.params.messageId });
      return { ok: true, deleted: true };
    }
    if (!g.canModerate) throw forbidden();
    scope.run('UPDATE group_chat SET hidden = 1 - hidden WHERE studio_id = $studio AND id = $id', { id: req.params.messageId });
    audit(scope, { actorId: user.id, action: msg.hidden ? 'moderation.unhide' : 'moderation.hide', entity: 'group_chat', entityId: req.params.messageId });
    return { ok: true, hidden: !msg.hidden };
  });

  // Aplikacja trenerki: grupy, którymi się opiekuje (moderatorki – wszystkie), z podglądem ostatniej wiadomości.
  app.get('/api/staff/group-chats', requirePerm(db, 'messages.group.own', 'community.moderate'), async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'community');
    return groupList(scope, user.id, can(roles, 'community.moderate') ? 'all' : 'trainer');
  });

  app.put<{ Params: { id: string }; Body: { trainerId: string | null } }>('/api/staff/groups/:id/trainer', moderator, async (req) => {
    const { scope, user } = ctx(req);
    const tid = req.body?.trainerId || null;
    if (tid && !scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { u: tid })) throw badRequest('Wybierz trenerkę ze studia.');
    const r = scope.run('UPDATE groups SET trainer_id = $t WHERE studio_id = $studio AND id = $id', { t: tid, id: req.params.id });
    if (!r.changes) throw notFound();
    audit(scope, { actorId: user.id, action: 'group.trainer', entity: 'group', entityId: req.params.id });
    return { ok: true };
  });

  // Prośby o dołączenie – akceptacja dodaje do grupy i wysyła klientce powiadomienie.
  app.post<{ Params: { groupId: string; userId: string }; Body: { action: 'accept' | 'decline' } }>(
    '/api/staff/group-requests/:groupId/:userId',
    requirePerm(db, 'community.moderate'),
    async (req) => {
      const { scope, studio, user } = ctx(req);
      const action = req.body?.action;
      if (action !== 'accept' && action !== 'decline') throw badRequest('Akceptuj albo odrzuć.');
      const r = scope.get<{ name: string }>(
        "SELECT g.name FROM group_requests r JOIN groups g ON g.id = r.group_id WHERE r.studio_id = $studio AND r.group_id = $g AND r.user_id = $u AND r.status = 'pending'",
        { g: req.params.groupId, u: req.params.userId },
      );
      if (!r) throw notFound('Ta prośba została już rozpatrzona.');
      scope.tx(() => {
        scope.run('UPDATE group_requests SET status = $s, decided_at = $now, decided_by = $me WHERE studio_id = $studio AND group_id = $g AND user_id = $u', {
          s: action === 'accept' ? 'accepted' : 'declined',
          now: nowIso(),
          me: user.id,
          g: req.params.groupId,
          u: req.params.userId,
        });
        if (action === 'accept')
          scope.run('INSERT OR IGNORE INTO group_members (studio_id, group_id, user_id, joined_at) VALUES ($studio, $g, $u, $now)', { g: req.params.groupId, u: req.params.userId, now: nowIso() });
      });
      if (action === 'accept') notify(scope, { userId: req.params.userId, category: 'community', tz: studio.timezone, title: studio.name, body: `Witaj w grupie „${r.name}” 🌸`, action: 'community' });
      return { message: action === 'accept' ? 'Dodana do grupy' : 'Prośba odrzucona' };
    },
  );

  app.post<{ Body: { name: string; description?: string; approval?: boolean } }>('/api/staff/groups', requirePerm(db, 'challenges.edit', 'community.moderate'), async (req) => {
    const { scope } = ctx(req);
    if (!req.body?.name?.trim()) throw badRequest('Podaj nazwę grupy.');
    const gid = id();
    scope.run('INSERT INTO groups (id, studio_id, name, description, approval, created_at) VALUES ($id, $studio, $n, $d, $a, $now)', { id: gid, n: req.body.name.trim().slice(0, 60), d: req.body.description?.slice(0, 300) ?? null, a: Number(!!req.body.approval), now: nowIso() });
    return { id: gid };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/groups/:id', requirePerm(db, 'community.moderate'), async (req) => {
    const { scope } = ctx(req);
    scope.tx(() => {
      scope.run('DELETE FROM group_members WHERE studio_id = $studio AND group_id = $id', { id: req.params.id });
      scope.run('DELETE FROM group_requests WHERE studio_id = $studio AND group_id = $id', { id: req.params.id });
      scope.run('UPDATE posts SET group_id = NULL, hidden = 1 WHERE studio_id = $studio AND group_id = $id', { id: req.params.id });
      scope.run('DELETE FROM groups WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    });
    return { ok: true };
  });

  // ——— Wyzwania (#27) ———

  app.get('/api/challenges', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    assertFeature(studio, 'challenges');
    const today = localParts(new Date(), studio.timezone).date;
    // Wyzwanie dla konkretnych zajęć widzą: zespół, uczestniczki tych zajęć (zapis w ostatnich 60 dniach albo przyszły) i osoby już zapisane.
    return scope
      .all<{ id: string; title: string; description: string | null; metric: string; target: number; starts_on: string; ends_on: string; badge_code: string | null; joined_at: string | null; completed_at: string | null; members: number; author_name: string | null; class_name: string | null }>(
        `SELECT c.*, m.joined_at, m.completed_at, (SELECT COUNT(*) FROM challenge_members x WHERE x.challenge_id = c.id) AS members, a.name AS author_name, ct.name AS class_name
         FROM challenges c LEFT JOIN challenge_members m ON m.challenge_id = c.id AND m.user_id = $u
         LEFT JOIN users a ON a.id = c.author_id LEFT JOIN class_types ct ON ct.id = c.class_type_id
         WHERE c.studio_id = $studio AND c.ends_on >= $past
           AND (c.class_type_id IS NULL OR $staff = 1 OR m.user_id IS NOT NULL OR EXISTS (
             SELECT 1 FROM bookings b JOIN class_sessions s ON s.id = b.session_id
             WHERE b.studio_id = $studio AND b.user_id = $u AND s.class_type_id = c.class_type_id AND b.status IN ('booked', 'waitlist', 'attended') AND s.starts_at >= $since))
         ORDER BY c.starts_on DESC`,
        { u: user.id, past: addDays(today, -30), staff: Number(isStaff(roles)), since: new Date(Date.now() - 60 * 86_400_000).toISOString() },
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
    const ch = scope.get<{ ends_on: string; class_type_id: string | null }>('SELECT ends_on, class_type_id FROM challenges WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!ch) throw notFound();
    // Wyzwanie dla konkretnych zajęć – tylko dla ich uczestniczek (jak na liście).
    if (
      ch.class_type_id &&
      !scope.get(
        "SELECT 1 FROM bookings b JOIN class_sessions s ON s.id = b.session_id WHERE b.studio_id = $studio AND b.user_id = $u AND s.class_type_id = $ct AND b.status IN ('booked', 'waitlist', 'attended') AND s.starts_at >= $since",
        { u: user.id, ct: ch.class_type_id, since: new Date(Date.now() - 60 * 86_400_000).toISOString() },
      )
    )
      throw notFound();
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
      groups: scope.all('SELECT g.id, g.name, g.description, g.approval, g.trainer_id, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members FROM groups g WHERE g.studio_id = $studio ORDER BY g.name'),
      trainers: scope.all("SELECT u.id, u.name FROM memberships ms JOIN users u ON u.id = ms.user_id WHERE ms.studio_id = $studio AND ms.role = 'trainer' ORDER BY u.name"),
      requests: scope.all(
        `SELECT r.group_id, g.name AS group_name, r.user_id, u.name, r.message, r.created_at, ms.goal
         FROM group_requests r JOIN groups g ON g.id = r.group_id JOIN users u ON u.id = r.user_id
         LEFT JOIN memberships ms ON ms.studio_id = r.studio_id AND ms.user_id = r.user_id AND ms.role = 'client'
         WHERE r.studio_id = $studio AND r.status = 'pending' ORDER BY r.created_at`,
      ),
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
  else if (kind === 'group_chat') scope.run('UPDATE group_chat SET hidden = $h WHERE studio_id = $studio AND id = $id', { h, id: targetId });
  else if (kind === 'comment') scope.run('UPDATE post_comments SET hidden = $h WHERE studio_id = $studio AND id = $id', { h, id: targetId });
  else if (kind === 'question') scope.run('UPDATE course_questions SET hidden = $h WHERE studio_id = $studio AND id = $id', { h, id: targetId });
  else if (kind === 'review') scope.run("UPDATE course_reviews SET hidden = $h WHERE studio_id = $studio AND course_id || ':' || user_id = $id", { h, id: targetId });
  else if (kind === 'track') scope.run("UPDATE playlist_tracks SET status = CASE WHEN $h = 1 THEN 'rejected' ELSE 'approved' END WHERE studio_id = $studio AND id = $id", { h, id: targetId });
  else throw badRequest('Nieznany rodzaj treści.');
}

type GroupRow = { id: string; name: string; description: string | null; trainer_id: string | null; members: number };

/** Kto wchodzi do czatu grupy: członkini, opiekunka albo moderatorka. Moderują opiekunka i moderatorki. */
export function groupAccess(scope: StudioScope, roles: readonly string[], userId: string, groupId: string) {
  const g = scope.get<GroupRow>('SELECT g.id, g.name, g.description, g.trainer_id, (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members FROM groups g WHERE g.studio_id = $studio AND g.id = $id', { id: groupId });
  if (!g) throw notFound();
  const member = !!scope.get('SELECT 1 FROM group_members WHERE studio_id = $studio AND group_id = $g AND user_id = $u', { g: groupId, u: userId });
  const canModerate = g.trainer_id === userId || can(roles, 'community.moderate');
  if (!member && !canModerate) throw forbidden();
  return { ...g, member, canModerate };
}

function markRead(scope: StudioScope, groupId: string, userId: string, at: string) {
  scope.run(
    'INSERT INTO group_chat_reads (studio_id, group_id, user_id, read_at) VALUES ($studio, $g, $u, $at) ON CONFLICT (group_id, user_id) DO UPDATE SET read_at = MAX(read_at, $at)',
    { g: groupId, u: userId, at },
  );
}

/** Lista grup z podglądem ostatniej wiadomości i liczbą nieprzeczytanych (cudzych, widocznych). */
export function groupList(scope: StudioScope, userId: string, which: 'studio' | 'trainer' | 'all') {
  const rows = scope.all<GroupRow & { approval: number; joined: number; requested: number; trainer_name: string | null; last_body: string | null; last_media: string | null; last_author: string | null; last_at: string | null; unread: number }>(
    `SELECT g.id, g.name, g.description, g.approval, g.trainer_id, t.name AS trainer_name,
            (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
            EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = g.id AND m.user_id = $u) AS joined,
            EXISTS (SELECT 1 FROM group_requests r WHERE r.group_id = g.id AND r.user_id = $u AND r.status = 'pending') AS requested,
            l.body AS last_body, l.media_id AS last_media, lu.name AS last_author, l.created_at AS last_at,
            (SELECT COUNT(*) FROM group_chat c WHERE c.group_id = g.id AND c.hidden = 0 AND c.author_id != $u
               AND c.created_at > COALESCE((SELECT read_at FROM group_chat_reads r WHERE r.group_id = g.id AND r.user_id = $u), '')) AS unread
     FROM groups g
     LEFT JOIN users t ON t.id = g.trainer_id
     LEFT JOIN group_chat l ON l.id = (SELECT c.id FROM group_chat c WHERE c.group_id = g.id AND c.hidden = 0 ORDER BY c.created_at DESC LIMIT 1)
     LEFT JOIN users lu ON lu.id = l.author_id
     WHERE g.studio_id = $studio ${which === 'trainer' ? 'AND g.trainer_id = $u' : ''}
     ORDER BY ${which === 'studio' ? 'g.name' : 'COALESCE(l.created_at, g.created_at) DESC'}`,
    { u: userId },
  );
  return rows.map(({ last_body, last_media, last_author, last_at, trainer_id, trainer_name, ...g }) => {
    const chat = g.joined || trainer_id === userId || which === 'all';
    return {
      ...g,
      trainer: trainer_name,
      mine: trainer_id === userId,
      // Podgląd i licznik tylko dla osób w rozmowie – reszta studia widzi samą grupę.
      unread: chat ? g.unread : 0,
      last: chat && last_at ? { body: last_body || (last_media ? '📎 Załącznik' : ''), author: last_author?.split(' ')[0] ?? null, at: last_at } : null,
    };
  });
}

/**
 * Powiadomienia z czatu grupy. Opiekunka pisze → wszystkie członkinie (jak ogłoszenie);
 * członkini pisze → opiekunka, najwyżej raz na godzinę na grupę, żeby rozmowa nie zasypała jej telefonu.
 */
function notifyGroupChat(scope: StudioScope, studio: Studio, g: GroupRow, authorId: string, body: string) {
  const preview = body ? body.slice(0, 140) : 'Nowy załącznik 📎';
  if (g.trainer_id === authorId) {
    const members = scope.all<{ user_id: string }>('SELECT user_id FROM group_members WHERE studio_id = $studio AND group_id = $g AND user_id != $a', { g: g.id, a: authorId });
    for (const m of members) notify(scope, { userId: m.user_id, category: 'community', tz: studio.timezone, title: g.name, body: preview, action: `community/groups/${g.id}` });
  } else if (g.trainer_id) {
    const hour = new Date().toISOString().slice(0, 13);
    notify(scope, { userId: g.trainer_id, category: 'community', tz: studio.timezone, title: g.name, body: `Nowe wiadomości w grupie: ${preview}`, action: `staff/groups/${g.id}`, dedupeKey: `group-chat:${g.id}:${hour}` });
  }
}
