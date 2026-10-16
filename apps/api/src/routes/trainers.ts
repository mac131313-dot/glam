// Profil trenerki w aplikacji: zdjęcie z konta, bio, opis własny, film „poznajmy się” i zaproszenia na jej zajęcia.
// Trenerka sama redaguje profil (/api/staff/profile), klientki studia go oglądają (/api/trainers/:id).
// Teksty przechodzą przez tę samą moderację co powitania i społeczność – bez linków i ocen wyglądu.
import type { FastifyInstance } from 'fastify';
import { homeInvites, moderate, MODERATION_COPY, TRAINER_ABOUT_MAX, TRAINER_BIO_MAX, TRAINER_INVITE_MAX, TRAINER_VIDEO_MAX_SEC } from '@glam/core';
import { ctx, requireStudio, type Deps } from '../context.ts';
import { id, nowIso, tx } from '../db.ts';
import { badRequest, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { deleteMedia, storeMedia } from '../services/media.ts';
import { PHOTO_URL } from './client.ts';

type InviteRow = {
  id: string;
  body: string;
  trainer_id: string;
  trainer_name: string;
  session_id: string;
  starts_at: string;
  ends_at: string;
  class_name: string;
  zone_name: string;
  photo_url: string | null;
  spots_left: number;
  my_status: string | null;
};

/** Zaproszenia na przyszłe, publiczne, zaplanowane zajęcia (opcjonalnie jednej trenerki), od najbliższych. */
export function trainerInvites(scope: StudioScope, userId: string, opts: { trainerId?: string; limit?: number } = {}) {
  return scope
    .all<InviteRow>(
      `SELECT i.id, i.body, i.trainer_id, u.name AS trainer_name, s.id AS session_id, s.starts_at, s.ends_at, COALESCE(s.title, ct.name) AS class_name, z.name AS zone_name, ${PHOTO_URL},
              MAX(s.capacity - (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')), 0) AS spots_left,
              (SELECT b.status FROM bookings b WHERE b.session_id = s.id AND b.user_id = $u AND b.guest_name IS NULL AND b.status IN ('booked', 'waitlist') LIMIT 1) AS my_status
       FROM trainer_invites i JOIN class_sessions s ON s.id = i.session_id JOIN class_types ct ON ct.id = s.class_type_id JOIN zones z ON z.id = ct.zone_id JOIN users u ON u.id = i.trainer_id
       WHERE i.studio_id = $studio AND s.status = 'scheduled' AND s.public = 1 AND s.starts_at > $now AND s.trainer_id = i.trainer_id ${opts.trainerId ? 'AND i.trainer_id = $t' : ''}
       ORDER BY s.starts_at LIMIT $limit`,
      { u: userId, now: nowIso(), limit: opts.limit ?? 20, ...(opts.trainerId ? { t: opts.trainerId } : {}) },
    )
    .map((r) => ({
      id: r.id,
      body: r.body,
      trainerId: r.trainer_id,
      trainerName: r.trainer_name,
      sessionId: r.session_id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      className: r.class_name,
      zone: r.zone_name,
      photoUrl: r.photo_url,
      spotsLeft: r.spots_left,
      myStatus: r.my_status as 'booked' | 'waitlist' | null,
      mine: !!r.my_status,
    }));
}

/** Zaproszenia na ekran Start – wybór należy do reguły z core (homeInvites). */
export const invitesForHome = (scope: StudioScope, userId: string) => homeInvites(trainerInvites(scope, userId));

const avatarUrl = (t: { id: string; avatar_mime: string | null; avatar_version: number }) => (t.avatar_mime ? `/api/users/${t.id}/avatar?v=${t.avatar_version}` : null);

function checkText(text: string, max: number) {
  const mod = moderate(text, { maxLength: max, allowLinks: false });
  if (!mod.ok) throw badRequest(MODERATION_COPY[mod.reason]);
}

export function trainerRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };
  const trainer = { preHandler: requireStudio(db, ['trainer']) };

  // ——— Dla klientek ———

  app.get<{ Params: { id: string } }>('/api/trainers/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    const t = scope.get<{ id: string; name: string; bio: string | null; about: string | null; intro_video_id: string | null; avatar_mime: string | null; avatar_version: number }>(
      "SELECT u.id, u.name, m.bio, m.about, m.intro_video_id, u.avatar_mime, u.avatar_version FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.user_id = $id AND m.role = 'trainer'",
      { id: req.params.id },
    );
    if (!t) throw notFound('Nie znaleziono trenerki.');
    const classes = scope
      .all<{ name: string }>('SELECT ct.name FROM trainer_class_types x JOIN class_types ct ON ct.id = x.class_type_id WHERE x.studio_id = $studio AND x.trainer_id = $id ORDER BY ct.name', { id: t.id })
      .map((c) => c.name);
    return {
      id: t.id,
      name: t.name,
      bio: t.bio,
      about: t.about,
      avatarUrl: avatarUrl(t),
      videoUrl: t.intro_video_id ? `/api/media/${t.intro_video_id}` : null,
      classes,
      invites: trainerInvites(scope, user.id, { trainerId: t.id }),
    };
  });

  // ——— Dla trenerki: własny profil ———

  app.get('/api/staff/profile', trainer, async (req) => {
    const { scope, user } = ctx(req);
    const m = scope.get<{ bio: string | null; about: string | null; intro_video_id: string | null }>(
      "SELECT bio, about, intro_video_id FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'",
      { u: user.id },
    )!;
    // Terminy, na które można zaprosić: własne, publiczne, w ciągu 3 tygodni.
    const sessions = scope.all<{ id: string; starts_at: string; class_name: string; zone_name: string }>(
      `SELECT s.id, s.starts_at, COALESCE(s.title, ct.name) AS class_name, z.name AS zone_name
       FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN zones z ON z.id = ct.zone_id
       WHERE s.studio_id = $studio AND s.trainer_id = $u AND s.status = 'scheduled' AND s.public = 1 AND s.starts_at > $now AND s.starts_at < $to
         AND s.id NOT IN (SELECT session_id FROM trainer_invites WHERE studio_id = $studio)
       ORDER BY s.starts_at LIMIT 60`,
      { u: user.id, now: nowIso(), to: new Date(Date.now() + 21 * 86_400_000).toISOString() },
    );
    return {
      bio: m.bio,
      about: m.about,
      videoUrl: m.intro_video_id ? `/api/media/${m.intro_video_id}` : null,
      invites: trainerInvites(scope, user.id, { trainerId: user.id }),
      sessions: sessions.map((s) => ({ id: s.id, startsAt: s.starts_at, className: s.class_name, zone: s.zone_name })),
      limits: { bio: TRAINER_BIO_MAX, about: TRAINER_ABOUT_MAX, invite: TRAINER_INVITE_MAX, videoSec: TRAINER_VIDEO_MAX_SEC },
    };
  });

  app.put<{ Body: { about?: string | null; bio?: string | null } }>('/api/staff/profile', trainer, async (req) => {
    const { scope, user } = ctx(req);
    // Zachowujemy akapity – opis własny to kilka zdań, nie jedna linijka.
    const about = String(req.body?.about ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (about) checkText(about, TRAINER_ABOUT_MAX);
    // Bio – jedna linijka pod imieniem (jak w /api/staff/me, max 300 znaków).
    const bio = String(req.body?.bio ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, TRAINER_BIO_MAX);
    if (bio) checkText(bio, TRAINER_BIO_MAX);
    scope.run("UPDATE memberships SET about = $a, bio = $b WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { a: about || null, b: bio || null, u: user.id });
    return { ok: true };
  });

  app.post<{ Body: { dataUrl: string; durationSec: number } }>('/api/staff/profile/video', { ...trainer, bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const { studio, scope, user } = ctx(req);
    const dur = Number(req.body?.durationSec);
    if (!(dur > 0 && dur <= TRAINER_VIDEO_MAX_SEC + 0.5)) throw badRequest(`Film może mieć max ${TRAINER_VIDEO_MAX_SEC} sekund.`);
    const old = scope.get<{ intro_video_id: string | null }>("SELECT intro_video_id FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { u: user.id });
    const m = storeMedia(scope, studio, { dataUrl: req.body.dataUrl, kind: 'intro', ownerId: user.id, durationSec: dur, allow: ['video'] });
    tx(db, () => {
      scope.run("UPDATE memberships SET intro_video_id = $m WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { m: m.id, u: user.id });
      if (old?.intro_video_id) deleteMedia(scope, old.intro_video_id);
    });
    return { videoUrl: `/api/media/${m.id}` };
  });

  app.delete('/api/staff/profile/video', trainer, async (req) => {
    const { scope, user } = ctx(req);
    const old = scope.get<{ intro_video_id: string | null }>("SELECT intro_video_id FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { u: user.id });
    tx(db, () => {
      scope.run("UPDATE memberships SET intro_video_id = NULL WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { u: user.id });
      if (old?.intro_video_id) deleteMedia(scope, old.intro_video_id);
    });
    return { ok: true };
  });

  // ——— Dla trenerki: zaproszenia na jej zajęcia ———

  app.post<{ Body: { sessionId: string; body: string } }>('/api/staff/invites', trainer, async (req) => {
    const { scope, user } = ctx(req);
    const body = String(req.body?.body ?? '').replace(/\s+/g, ' ').trim();
    checkText(body, TRAINER_INVITE_MAX);
    const s = scope.get<{ id: string }>(
      "SELECT id FROM class_sessions WHERE studio_id = $studio AND id = $s AND trainer_id = $u AND status = 'scheduled' AND public = 1 AND starts_at > $now",
      { s: req.body?.sessionId, u: user.id, now: nowIso() },
    );
    if (!s) throw badRequest('Zaprosić można tylko na swoje nadchodzące zajęcia.');
    // Jeden termin = jedno zaproszenie; ponowny zapis podmienia treść.
    scope.run(
      `INSERT INTO trainer_invites (id, studio_id, trainer_id, session_id, body, created_at) VALUES ($id, $studio, $u, $s, $b, $now)
       ON CONFLICT (studio_id, session_id) DO UPDATE SET body = $b, trainer_id = $u`,
      { id: id(), u: user.id, s: s.id, b: body, now: nowIso() },
    );
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/invites/:id', trainer, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('DELETE FROM trainer_invites WHERE studio_id = $studio AND id = $id AND trainer_id = $u', { id: req.params.id, u: user.id });
    return { ok: true };
  });
}
