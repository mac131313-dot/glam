// Muzyka (4.12.4, G5–G7): playlisty studia (zajęcia, medytacja, stretch, sen, motyw) i wspólna playlista klientek
// z propozycjami, moderacją i głosowaniem. Odtwarzanie wyłącznie w oficjalnych aplikacjach dostawców – apka linkuje,
// nie kopiuje muzyki. Przechowujemy tylko adresy / identyfikatory utworów i liczbę głosów, bez historii słuchania.
import type { FastifyInstance } from 'fastify';
import { localParts, moderate, MODERATION_COPY, TRACK_SUGGESTIONS_PER_DAY, weekStart, zonedToUtc } from '@glam/core';
import { assertFeature, ctx, requirePerm, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { notify } from '../services/notify.ts';

/** Link do Spotify / Apple Music → dostawca i rodzaj (playlista / utwór). Inne adresy odrzucamy. */
export function parseMusicUrl(url: string): { provider: 'spotify' | 'apple'; kind: 'playlist' | 'track' | 'album' } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    if (u.hostname === 'open.spotify.com') {
      const kind = u.pathname.split('/').find((p) => ['playlist', 'track', 'album'].includes(p)) as 'playlist' | 'track' | 'album' | undefined;
      return kind ? { provider: 'spotify', kind } : null;
    }
    if (u.hostname === 'music.apple.com') {
      if (u.pathname.includes('/playlist/')) return { provider: 'apple', kind: 'playlist' };
      if (u.searchParams.has('i') || u.pathname.includes('/song/')) return { provider: 'apple', kind: 'track' };
      if (u.pathname.includes('/album/')) return { provider: 'apple', kind: 'album' };
    }
  } catch {
    /* nieprawidłowy adres */
  }
  return null;
}

export function musicRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };
  const mod = requirePerm(db, 'playlists.moderate');

  app.get('/api/playlists', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'music');
    const weekFrom = zonedToUtc(weekStart(localParts(new Date(), studio.timezone).date), '00:00', studio.timezone).toISOString();
    return {
      playlists: scope.all('SELECT p.id, p.provider, p.url, p.name, p.purpose, ct.name AS class_name FROM playlists p LEFT JOIN class_types ct ON ct.id = p.class_type_id WHERE p.studio_id = $studio ORDER BY p.purpose, p.name'),
      shared: scope.all(
        `SELECT t.id, t.title, t.artist, t.track_url, t.status, t.created_at, t.user_id = $u AS mine, u.name AS added_by,
                (SELECT COUNT(*) FROM track_votes v WHERE v.track_id = t.id) AS votes,
                EXISTS (SELECT 1 FROM track_votes v WHERE v.track_id = t.id AND v.user_id = $u) AS voted
         FROM playlist_tracks t JOIN users u ON u.id = t.user_id
         WHERE t.studio_id = $studio AND (t.status = 'approved' OR t.user_id = $u) AND t.created_at >= $from ORDER BY votes DESC, t.created_at`,
        { u: user.id, from: new Date(Date.parse(weekFrom) - 21 * 86_400_000).toISOString() },
      ),
      connected: db.prepare('SELECT provider FROM music_accounts WHERE user_id = ?').all(user.id),
    };
  });

  // Propozycja utworu do wspólnej playlisty: link, max 1 dziennie, filtr treści, tryb „do zatwierdzenia”.
  app.post<{ Body: { url: string; title: string; artist?: string } }>('/api/playlists/shared', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'music');
    const parsed = parseMusicUrl(req.body?.url ?? '');
    if (!parsed || parsed.kind !== 'track') throw badRequest('Wklej link do utworu ze Spotify albo Apple Music.');
    const m = moderate(`${req.body.title ?? ''} ${req.body.artist ?? ''}`, { maxLength: 160 });
    if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
    const today = localParts(new Date(), studio.timezone).date;
    const mine = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM playlist_tracks WHERE studio_id = $studio AND user_id = $u AND created_at >= $from', { u: user.id, from: zonedToUtc(today, '00:00', studio.timezone).toISOString() })!.n;
    if (mine >= TRACK_SUGGESTIONS_PER_DAY) throw conflict('limit', 'Jedna propozycja dziennie – jutro możesz dodać kolejną 🎵');
    let playlist = scope.get<{ id: string }>("SELECT id FROM playlists WHERE studio_id = $studio AND purpose = 'shared' LIMIT 1");
    if (!playlist) {
      playlist = { id: id() };
      const month = new Intl.DateTimeFormat('pl-PL', { month: 'long' }).format(new Date());
      scope.run("INSERT INTO playlists (id, studio_id, provider, url, name, purpose, created_at) VALUES ($id, $studio, 'spotify', 'https://open.spotify.com', $n, 'shared', $now)", { id: playlist.id, n: `Playlista ${month}`, now: nowIso() });
    }
    scope.run("INSERT INTO playlist_tracks (id, studio_id, playlist_id, user_id, track_url, title, artist, status, created_at) VALUES ($id, $studio, $p, $u, $url, $t, $a, 'pending', $now)", {
      id: id(),
      p: playlist.id,
      u: user.id,
      url: req.body.url,
      t: req.body.title.trim().slice(0, 100),
      a: req.body.artist?.trim().slice(0, 80) ?? null,
      now: nowIso(),
    });
    return { message: 'Dziękujemy! Utwór pojawi się po zatwierdzeniu przez trenerkę.' };
  });

  app.post<{ Params: { id: string } }>('/api/playlists/shared/:id/vote', member, async (req) => {
    const { scope, user } = ctx(req);
    if (!scope.get("SELECT 1 FROM playlist_tracks WHERE studio_id = $studio AND id = $id AND status = 'approved'", { id: req.params.id })) throw notFound();
    const had = scope.get('SELECT 1 FROM track_votes WHERE studio_id = $studio AND track_id = $t AND user_id = $u', { t: req.params.id, u: user.id });
    if (had) scope.run('DELETE FROM track_votes WHERE studio_id = $studio AND track_id = $t AND user_id = $u', { t: req.params.id, u: user.id });
    else scope.run('INSERT INTO track_votes (studio_id, track_id, user_id) VALUES ($studio, $t, $u)', { t: req.params.id, u: user.id });
    return { voted: !had };
  });

  // ——— Panel: playlisty studia i moderacja propozycji ———

  app.get('/api/staff/playlists', mod, async (req) => {
    const { scope } = ctx(req);
    return {
      playlists: scope.all('SELECT * FROM playlists WHERE studio_id = $studio ORDER BY purpose, name'),
      pending: scope.all("SELECT t.id, t.title, t.artist, t.track_url, t.created_at, u.name FROM playlist_tracks t JOIN users u ON u.id = t.user_id WHERE t.studio_id = $studio AND t.status = 'pending' ORDER BY t.created_at"),
      // Najpopularniejsze trafiają na playlistę zajęć danego tygodnia.
      topWeek: scope.all(
        "SELECT t.id, t.title, t.artist, t.track_url, (SELECT COUNT(*) FROM track_votes v WHERE v.track_id = t.id) AS votes FROM playlist_tracks t WHERE t.studio_id = $studio AND t.status = 'approved' AND t.created_at >= $from ORDER BY votes DESC LIMIT 10",
        { from: new Date(Date.now() - 7 * 86_400_000).toISOString() },
      ),
    };
  });

  app.post<{ Body: { url: string; name: string; purpose: 'class' | 'meditation' | 'stretch' | 'sleep' | 'shared'; classTypeId?: string | null } }>('/api/staff/playlists', mod, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'music');
    const parsed = parseMusicUrl(req.body?.url ?? '');
    if (!parsed || parsed.kind === 'track') throw badRequest('Wklej link do playlisty ze Spotify albo Apple Music.');
    if (!['class', 'meditation', 'stretch', 'sleep', 'shared'].includes(req.body.purpose)) throw badRequest('Wybierz przeznaczenie playlisty.');
    const pid = id();
    scope.run('INSERT INTO playlists (id, studio_id, provider, url, name, purpose, class_type_id, created_by, created_at) VALUES ($id, $studio, $pr, $url, $n, $pu, $ct, $by, $now)', {
      id: pid,
      pr: parsed.provider,
      url: req.body.url,
      n: req.body.name?.trim().slice(0, 80) || 'Playlista',
      pu: req.body.purpose,
      ct: req.body.classTypeId ?? null,
      by: user.id,
      now: nowIso(),
    });
    if (req.body.classTypeId) scope.run('UPDATE class_types SET playlist_id = $p WHERE studio_id = $studio AND id = $c AND playlist_id IS NULL', { p: pid, c: req.body.classTypeId });
    return { id: pid };
  });

  app.delete<{ Params: { id: string } }>('/api/staff/playlists/:id', mod, async (req) => {
    const { scope } = ctx(req);
    scope.tx(() => {
      scope.run('UPDATE class_types SET playlist_id = NULL WHERE studio_id = $studio AND playlist_id = $id', { id: req.params.id });
      scope.run('UPDATE class_sessions SET playlist_id = NULL WHERE studio_id = $studio AND playlist_id = $id', { id: req.params.id });
      scope.run('DELETE FROM track_votes WHERE studio_id = $studio AND track_id IN (SELECT id FROM playlist_tracks WHERE playlist_id = $id)', { id: req.params.id });
      scope.run('DELETE FROM playlist_tracks WHERE studio_id = $studio AND playlist_id = $id', { id: req.params.id });
      scope.run('DELETE FROM playlists WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { approve: boolean } }>('/api/staff/playlists/tracks/:id', mod, async (req) => {
    const { scope, studio } = ctx(req);
    const t = scope.get<{ user_id: string; title: string }>("SELECT user_id, title FROM playlist_tracks WHERE studio_id = $studio AND id = $id AND status = 'pending'", { id: req.params.id });
    if (!t) throw notFound();
    scope.run('UPDATE playlist_tracks SET status = $s WHERE studio_id = $studio AND id = $id', { s: req.body?.approve ? 'approved' : 'rejected', id: req.params.id });
    if (req.body?.approve) notify(scope, { userId: t.user_id, category: 'community', tz: studio.timezone, body: `„${t.title}” jest na wspólnej playliście 🎵 Głosowanie trwa!`, action: 'community/music' });
    return { ok: true };
  });
}
