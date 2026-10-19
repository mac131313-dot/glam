// Wydarzenia w studiu (panel właścicielki → Treści → Wydarzenia): np. „Spotkanie z trenerką Anią” 18:00–19:30.
// Bez zapisów, sali i limitu miejsc – samo ogłoszenie. Przy zapisie (i przy zmianie albo odwołaniu, jeśli
// właścicielka zaznaczy) każda klientka studia dostaje powiadomienie w aplikacji; zgody i ciszę nocną pilnuje notify().
import type { FastifyInstance } from 'fastify';
import { localParts, zonedToUtc } from '@glam/core';
import { ctx, requirePerm, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { audit } from '../services/audit.ts';
import { notify } from '../services/notify.ts';
import { audience } from '../services/segments.ts';
import type { Studio } from '../services/studio.ts';

type Row = { id: string; title: string; description: string | null; place: string | null; starts_at: string; ends_at: string; status: 'active' | 'cancelled'; notified_count: number; notified_at: string | null; created_at: string; updated_at: string };
type Input = { title?: string; description?: string; place?: string; date?: string; from?: string; to?: string; notify?: boolean };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Sprawdza formularz i liczy początek / koniec w strefie studia. Zwraca komunikat błędu albo gotowe pola. */
export function parseAnnouncement(b: Input, tz: string, now = new Date()): string | { title: string; description: string | null; place: string | null; startsAt: string; endsAt: string } {
  const title = String(b.title ?? '').trim();
  if (title.length < 3) return 'Wpisz nazwę wydarzenia.';
  if (title.length > 80) return 'Nazwa może mieć najwyżej 80 znaków.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date ?? ''))) return 'Wybierz dzień.';
  if (!TIME.test(String(b.from ?? '')) || !TIME.test(String(b.to ?? ''))) return 'Wpisz godziny od–do, np. 18:00 i 19:30.';
  if (b.to! <= b.from!) return 'Koniec musi być po początku.';
  const start = zonedToUtc(b.date!, b.from!, tz);
  const end = zonedToUtc(b.date!, b.to!, tz);
  if (end <= now) return 'To wydarzenie już by się skończyło – wybierz późniejszy termin.';
  return {
    title,
    description: String(b.description ?? '').trim().slice(0, 1000) || null,
    place: String(b.place ?? '').trim().slice(0, 80) || null,
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
  };
}

/** „pt. 24.10, 18:00–19:30 · Sala 2” – ten sam zapis w powiadomieniu i na liście. */
export function announcementWhen(r: Pick<Row, 'starts_at' | 'ends_at' | 'place'>, tz: string) {
  const s = localParts(new Date(r.starts_at), tz);
  const e = localParts(new Date(r.ends_at), tz);
  const dow = ['nd.', 'pn.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'][new Date(`${s.date}T12:00:00Z`).getUTCDay()];
  return `${dow} ${s.date.slice(8)}.${s.date.slice(5, 7)}, ${s.time}–${e.time}${r.place ? ` · ${r.place}` : ''}`;
}

/** Powiadomienie do każdej klientki studia. Zwraca, do ilu osób poszło. */
function broadcast(scope: StudioScope, studio: Studio, body: string) {
  const users = audience(scope, 'all');
  for (const u of users) notify(scope, { userId: u, category: 'events', tz: studio.timezone, title: studio.name, body, action: 'inbox' });
  return users.length;
}

const view = (r: Row, tz: string) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  place: r.place,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  date: localParts(new Date(r.starts_at), tz).date,
  from: localParts(new Date(r.starts_at), tz).time,
  to: localParts(new Date(r.ends_at), tz).time,
  when: announcementWhen(r, tz),
  status: r.status,
  past: Date.parse(r.ends_at) < Date.now(),
  notifiedCount: r.notified_count,
  notifiedAt: r.notified_at,
});

export function announcementRoutes(app: FastifyInstance, deps: Deps) {
  // Ogłoszenie trafia do wszystkich klientek – tylko właścicielka (ta sama zgoda co ustawienia studia).
  const owner = requirePerm(deps.db, 'config.edit');

  app.get('/api/owner/announcements', owner, async (req) => {
    const { scope, studio } = ctx(req);
    // Nadchodzące od najbliższego, potem minione i odwołane od najnowszego.
    const rows = scope.all<Row>('SELECT * FROM studio_announcements WHERE studio_id = $studio ORDER BY starts_at');
    const now = Date.now();
    const upcoming = rows.filter((r) => r.status === 'active' && Date.parse(r.ends_at) >= now);
    const rest = rows.filter((r) => !upcoming.includes(r)).reverse();
    return { audience: audience(scope, 'all').length, items: [...upcoming, ...rest].map((r) => view(r, studio.timezone)) };
  });

  app.post<{ Body: Input }>('/api/owner/announcements', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const p = parseAnnouncement(req.body ?? {}, studio.timezone);
    if (typeof p === 'string') throw badRequest(p);
    const aid = id();
    const now = nowIso();
    let sent = 0;
    scope.tx(() => {
      scope.run(
        `INSERT INTO studio_announcements (id, studio_id, title, description, place, starts_at, ends_at, created_by, created_at, updated_at)
         VALUES ($id, $studio, $t, $d, $p, $s, $e, $u, $now, $now)`,
        { id: aid, t: p.title, d: p.description, p: p.place, s: p.startsAt, e: p.endsAt, u: user.id, now },
      );
      if (req.body?.notify !== false) {
        sent = broadcast(scope, studio, `${p.title} – ${announcementWhen({ starts_at: p.startsAt, ends_at: p.endsAt, place: p.place }, studio.timezone)}`);
        scope.run('UPDATE studio_announcements SET notified_count = $n, notified_at = $now WHERE studio_id = $studio AND id = $id', { n: sent, now, id: aid });
      }
    });
    audit(scope, { actorId: user.id, action: 'announcement.created', entity: 'announcement', entityId: aid, details: { notified: sent } });
    return { id: aid, message: sent ? `Wydarzenie zapisane. Powiadomienie poszło do ${sent} klientek.` : 'Wydarzenie zapisane bez powiadomienia.' };
  });

  app.post<{ Params: { id: string }; Body: Input }>('/api/owner/announcements/:id', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const r = scope.get<Row>('SELECT * FROM studio_announcements WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!r) throw notFound('Nie znaleziono wydarzenia.');
    if (r.status === 'cancelled') throw badRequest('To wydarzenie jest odwołane.');
    const p = parseAnnouncement(req.body ?? {}, studio.timezone);
    if (typeof p === 'string') throw badRequest(p);
    const now = nowIso();
    let sent = 0;
    scope.tx(() => {
      scope.run('UPDATE studio_announcements SET title = $t, description = $d, place = $p, starts_at = $s, ends_at = $e, updated_at = $now WHERE studio_id = $studio AND id = $id', {
        t: p.title, d: p.description, p: p.place, s: p.startsAt, e: p.endsAt, now, id: r.id,
      });
      // Powiadomienie o zmianie tylko na życzenie – poprawka literówki nie musi budzić wszystkich telefonów.
      if (req.body?.notify) {
        sent = broadcast(scope, studio, `Zmiana: ${p.title} – ${announcementWhen({ starts_at: p.startsAt, ends_at: p.endsAt, place: p.place }, studio.timezone)}`);
        scope.run('UPDATE studio_announcements SET notified_count = $n, notified_at = $now WHERE studio_id = $studio AND id = $id', { n: sent, now, id: r.id });
      }
    });
    audit(scope, { actorId: user.id, action: 'announcement.updated', entity: 'announcement', entityId: r.id, details: { notified: sent } });
    return { message: sent ? `Zmiany zapisane. Powiadomienie poszło do ${sent} klientek.` : 'Zmiany zapisane.' };
  });

  app.post<{ Params: { id: string }; Body: { notify?: boolean } }>('/api/owner/announcements/:id/cancel', owner, async (req) => {
    const { scope, studio, user } = ctx(req);
    const r = scope.get<Row>('SELECT * FROM studio_announcements WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!r) throw notFound('Nie znaleziono wydarzenia.');
    if (r.status === 'cancelled') return { message: 'To wydarzenie jest już odwołane.' };
    let sent = 0;
    scope.tx(() => {
      scope.run("UPDATE studio_announcements SET status = 'cancelled', updated_at = $now WHERE studio_id = $studio AND id = $id", { now: nowIso(), id: r.id });
      if (req.body?.notify && Date.parse(r.ends_at) > Date.now()) sent = broadcast(scope, studio, `Odwołane: ${r.title} – ${announcementWhen(r, studio.timezone)}`);
    });
    audit(scope, { actorId: user.id, action: 'announcement.cancelled', entity: 'announcement', entityId: r.id, details: { notified: sent } });
    return { message: sent ? `Wydarzenie odwołane. Powiadomienie poszło do ${sent} klientek.` : 'Wydarzenie odwołane.' };
  });
}
