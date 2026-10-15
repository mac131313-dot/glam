import type { FastifyInstance } from 'fastify';
import { addDays, localParts, receptionSlots, zonedToUtc } from '@glam/core';
import type { Deps } from '../context.ts';
import { notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { loadStudio, logoInfo } from '../services/studio.ts';
import { PHOTO_URL } from './client.ts';

/**
 * Publiczna strona studia (/s/:slug): tylko odczyt, bez logowania.
 * Zwraca wyłącznie to, co studio i tak pokazuje światu – bez klientek, rezerwacji i danych kontaktowych trenerek.
 */
export function publicRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;

  app.get<{ Params: { slug: string } }>('/api/public/studios/:slug', async (req) => {
    const row = db.prepare("SELECT id FROM studios WHERE slug = ? AND published = 1 AND status != 'suspended'").get(req.params.slug) as { id: string } | undefined;
    if (!row) throw notFound('Nie ma takiego studia.');
    const studio = loadStudio(db, row.id);
    const scope = new StudioScope(db, studio.id);

    const trainers = scope.all<{ id: string; name: string; bio: string | null; avatar_mime: string | null; avatar_version: number }>(
      "SELECT u.id, u.name, m.bio, u.avatar_mime, u.avatar_version FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'trainer' ORDER BY u.name",
    );
    const classes = scope.all<{ id: string; name: string; level: string | null; color: string; description: string | null; photo_url: string | null; photo_ratio: number | null; zone_name: string }>(
      `SELECT ct.id, ct.name, ct.level, ct.color, ct.description, ${PHOTO_URL}, z.name AS zone_name
       FROM class_types ct JOIN zones z ON z.id = ct.zone_id WHERE ct.studio_id = $studio ORDER BY z.name, ct.name`,
    );
    const teaches = scope.all<{ class_type_id: string; trainer_id: string }>('SELECT class_type_id, trainer_id FROM trainer_class_types WHERE studio_id = $studio');

    const from = localParts(new Date(), studio.timezone).date;
    const sessions = scope.all<{ id: string; starts_at: string; ends_at: string; capacity: number; class_type_id: string; class_name: string; trainer_id: string; trainer_name: string; zone_name: string; kind: string; taken: number }>(
      `SELECT s.id, s.starts_at, s.ends_at, s.capacity, s.class_type_id, COALESCE(s.title, ct.name) AS class_name, s.trainer_id, u.name AS trainer_name, z.name AS zone_name, s.kind,
              (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status IN ('booked', 'attended')) AS taken
       FROM class_sessions s JOIN class_types ct ON ct.id = s.class_type_id JOIN zones z ON z.id = ct.zone_id JOIN users u ON u.id = s.trainer_id
       WHERE s.studio_id = $studio AND s.public = 1 AND s.status = 'scheduled' AND s.starts_at >= $from AND s.starts_at < $to
       ORDER BY s.starts_at`,
      { from: zonedToUtc(from, '00:00', studio.timezone).toISOString(), to: zonedToUtc(addDays(from, 7), '00:00', studio.timezone).toISOString() },
    );

    return {
      id: studio.id,
      slug: studio.slug,
      name: studio.name,
      city: studio.city,
      tagline: studio.tagline,
      logo: studio.logo,
      look: studio.look,
      ...logoInfo(studio),
      phone: studio.phone,
      email: studio.email,
      address: studio.address,
      timezone: studio.timezone,
      joinCode: studio.invite_code,
      hours: receptionSlots(studio.settings.support.hours),
      faq: studio.settings.support.faq,
      // Odnośniki do podstron, które powstaną później – strona pokazuje je tylko, gdy moduł jest włączony.
      modules: {
        events: studio.settings.events.enabled && studio.has('events'),
        courses: studio.has('courses'),
        shop: studio.has('shop'),
      },
      trainers: trainers.map((t) => ({
        id: t.id,
        name: t.name,
        bio: t.bio,
        avatarUrl: t.avatar_mime ? `/api/users/${t.id}/avatar?v=${t.avatar_version}` : null,
        classes: teaches.filter((x) => x.trainer_id === t.id).map((x) => x.class_type_id),
      })),
      classes: classes.map((c) => ({ id: c.id, name: c.name, level: c.level, color: c.color, description: c.description, photoUrl: c.photo_url, zone: c.zone_name })),
      schedule: {
        from,
        sessions: sessions.map((s) => ({
          id: s.id,
          startsAt: s.starts_at,
          endsAt: s.ends_at,
          classTypeId: s.class_type_id,
          className: s.class_name,
          trainer: s.trainer_name,
          zone: s.zone_name,
          kind: s.kind,
          spotsLeft: Math.max(s.capacity - s.taken, 0),
        })),
      },
    };
  });
}
