import type { FastifyInstance } from 'fastify';
import { addDays, formatPLN, localParts, parseSiteDoc, receptionSlots, siteImageUrl, siteMediaIds, totalStock, zonedToUtc, type SiteDoc, type Variant } from '@glam/core';
import { ctx, requirePerm, type Deps } from '../context.ts';
import { nowIso, tx, type Db } from '../db.ts';
import { badRequest, notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { audit } from '../services/audit.ts';
import { storeMedia } from '../services/media.ts';
import { loadStudio, logoInfo } from '../services/studio.ts';
import { PHOTO_URL } from './client.ts';

/**
 * Strona internetowa studia (/s/:slug) i jej edytor.
 * Publicznie: tylko odczyt, bez logowania, wyłącznie to, co studio i tak pokazuje światu – bez klientek,
 * rezerwacji i danych kontaktowych trenerek. Treść strony to dokument z core/site.ts:
 *   site_draft_json – szkic z edytora (autozapis), site_json – wersja publiczna (kopiowana przy publikacji).
 * Studio, które nigdy nie publikowało, pokazuje dokument domyślny.
 */
export function publicRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const editor = requirePerm(db, 'config.edit');

  app.get<{ Params: { slug: string } }>('/api/public/studios/:slug', async (req) => {
    const row = db.prepare("SELECT id, site_json FROM studios WHERE slug = ? AND published = 1 AND status != 'suspended'").get(req.params.slug) as
      | { id: string; site_json: string | null }
      | undefined;
    if (!row) throw notFound('Nie ma takiego studia.');
    return sitePayload(db, row.id, parseSiteDoc(json(row.site_json)));
  });

  // Podgląd szkicu w ramce edytora – te same dane co strona publiczna, ale z dokumentem roboczym.
  app.get('/api/site/preview', editor, async (req) => {
    const { studio } = ctx(req);
    return { ...sitePayload(db, studio.id, readSite(db, studio.id).draft), preview: true };
  });

  app.get('/api/site/editor', editor, async (req) => {
    const { studio } = ctx(req);
    return editorState(db, studio.id);
  });

  // Autozapis (auto = true) nie trafia do rejestru zmian – inaczej jedna sesja redagowania to setka wpisów.
  app.put<{ Body: { doc: unknown; auto?: boolean } }>('/api/site/draft', editor, async (req) => {
    const { studio, scope, user } = ctx(req);
    if (!req.body || typeof req.body.doc !== 'object' || req.body.doc === null) throw badRequest('Brak dokumentu strony.');
    const doc = parseSiteDoc(req.body.doc);
    // Zdjęcia i filmy tylko z biblioteki tego studia – id cudzego pliku nie trafi na stronę.
    // Który plik jest filmem, ustala serwer (z biblioteki), a nie edytor.
    const ids = siteMediaIds(doc);
    const own = ids.length
      ? new Map(
          scope
            .all<{ id: string; mime: string }>(`SELECT id, mime FROM media WHERE studio_id = $studio AND kind = 'site' AND id IN (${ids.map((_, i) => `$m${i}`).join(', ')})`, Object.fromEntries(ids.map((m, i) => [`m${i}`, m])))
            .map((r) => [r.id, r.mime]),
        )
      : new Map<string, string>();
    if (ids.some((m) => !own.has(m))) throw badRequest('Jeden z plików nie należy do tego studia. Wgraj go ponownie.');
    doc.media = Object.fromEntries([...own].filter(([, mime]) => mime.startsWith('video/')).map(([id]) => [id, 'video' as const]));
    const now = nowIso();
    tx(db, () => {
      scope.run('UPDATE studios SET site_draft_json = $doc, site_draft_updated_at = $now WHERE id = $studio', { doc: JSON.stringify(doc), now });
      if (!req.body.auto) audit(scope, { actorId: user.id, action: 'site.save', entity: 'studio', entityId: studio.id });
    });
    return editorState(db, studio.id);
  });

  // Zdjęcia i filmy strony: biblioteka studia (rodzaj „site”), serwowane publicznie przez /api/public-media
  // (z obsługą Range – film można przewijać). Film do 40 MB jak wideo kursów, liczy się do miejsca w planie.
  app.post<{ Body: { dataUrl: string; durationSec?: number } }>('/api/site/media', { ...editor, bodyLimit: 60 * 1024 * 1024 }, async (req) => {
    const { studio, scope, user } = ctx(req);
    const dur = Number(req.body?.durationSec);
    const m = storeMedia(scope, studio, { dataUrl: req.body?.dataUrl, kind: 'site', ownerId: user.id, allow: ['image', 'video'], durationSec: Number.isFinite(dur) && dur > 0 ? dur : null });
    const ratio = scope.get<{ ratio: number | null }>('SELECT ratio FROM media WHERE studio_id = $studio AND id = $id', { id: m.id })?.ratio ?? null;
    return { id: m.id, url: siteImageUrl(m.id), type: m.type, ratio };
  });

  // Publikacja w jednej transakcji: czytelnik nigdy nie zobaczy nowego motywu ze starą treścią.
  app.post('/api/site/publish', editor, async (req) => {
    const { studio, scope, user } = ctx(req);
    tx(db, () => {
      const { draft } = readSite(db, studio.id);
      scope.run('UPDATE studios SET site_json = $doc, site_draft_json = $doc, site_published_at = $now WHERE id = $studio', { doc: JSON.stringify(draft), now: nowIso() });
      audit(scope, { actorId: user.id, action: 'site.publish', entity: 'studio', entityId: studio.id });
    });
    return editorState(db, studio.id);
  });

  // Odrzucenie szkicu: wraca to, co jest opublikowane (albo dokument domyślny).
  app.post('/api/site/discard', editor, async (req) => {
    const { studio, scope, user } = ctx(req);
    tx(db, () => {
      scope.run('UPDATE studios SET site_draft_json = site_json, site_draft_updated_at = $now WHERE id = $studio', { now: nowIso() });
      audit(scope, { actorId: user.id, action: 'site.discard', entity: 'studio', entityId: studio.id });
    });
    return editorState(db, studio.id);
  });
}

const json = (s: string | null) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

export function readSite(db: Db, studioId: string) {
  const row = db.prepare('SELECT site_draft_json, site_draft_updated_at, site_json, site_published_at FROM studios WHERE id = ?').get(studioId) as {
    site_draft_json: string | null;
    site_draft_updated_at: string | null;
    site_json: string | null;
    site_published_at: string | null;
  };
  const published = parseSiteDoc(json(row.site_json));
  const draft = row.site_draft_json ? parseSiteDoc(json(row.site_draft_json)) : published;
  return { draft, published, row };
}

function editorState(db: Db, studioId: string) {
  const { draft, published, row } = readSite(db, studioId);
  const studio = loadStudio(db, studioId);
  return {
    doc: draft,
    slug: studio.slug,
    studioName: studio.name,
    studioLook: studio.look,
    publishedAt: row.site_published_at,
    draftUpdatedAt: row.site_draft_updated_at,
    // Czy szkic różni się od wersji publicznej – przycisk „Publikuj” ma wtedy co publikować.
    unpublished: JSON.stringify(draft) !== JSON.stringify(published) || !row.site_published_at,
    // zajęcia i trenerki do ustawienia zdjęć w edytorze (z rezerwą: zdjęcie z panelu)
    catalog: catalog(db, studioId),
  };
}

function catalog(db: Db, studioId: string) {
  const scope = new StudioScope(db, studioId);
  return {
    classes: scope.all<{ id: string; name: string; photo_url: string | null }>(`SELECT ct.id, ct.name, ${PHOTO_URL} FROM class_types ct WHERE ct.studio_id = $studio ORDER BY ct.name`).map((c) => ({ id: c.id, name: c.name, photoUrl: c.photo_url })),
    trainers: scope
      .all<{ id: string; name: string; avatar_mime: string | null; avatar_version: number }>("SELECT u.id, u.name, u.avatar_mime, u.avatar_version FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'trainer' ORDER BY u.name")
      .map((t) => ({ id: t.id, name: t.name, photoUrl: t.avatar_mime ? `/api/users/${t.id}/avatar?v=${t.avatar_version}` : null })),
  };
}

function sitePayload(db: Db, studioId: string, site: SiteDoc) {
  const studio = loadStudio(db, studioId);
  const scope = new StudioScope(db, studio.id);

  const trainers = scope.all<{ id: string; name: string; bio: string | null; about: string | null; avatar_mime: string | null; avatar_version: number }>(
    "SELECT u.id, u.name, m.bio, m.about, u.avatar_mime, u.avatar_version FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'trainer' ORDER BY u.name",
  );
  const classes = scope.all<{ id: string; name: string; level: string | null; color: string; description: string | null; photo_url: string | null; photo_ratio: number | null; zone_name: string; created_at: string | null }>(
    `SELECT ct.id, ct.name, ct.level, ct.color, ct.description, ${PHOTO_URL}, z.name AS zone_name, ct.created_at
     FROM class_types ct JOIN zones z ON z.id = ct.zone_id WHERE ct.studio_id = $studio ORDER BY z.name, ct.name`,
  );
  const teaches = scope.all<{ class_type_id: string; trainer_id: string }>('SELECT class_type_id, trainer_id FROM trainer_class_types WHERE studio_id = $studio');
  // Sklep: tylko to, co klientka i tak widzi w aplikacji – bez ukrytych produktów i bez stanów magazynu.
  const products = studio.has('shop')
    ? scope.all<{ id: string; name: string; description: string | null; price_grosze: number; status: string; variants_json: string; media_id: string | null }>(
        "SELECT id, name, description, price_grosze, status, variants_json, media_id FROM shop_products WHERE studio_id = $studio AND status != 'hidden' ORDER BY created_at, name",
      )
    : [];

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
    // wygląd studia z aplikacji; strona nakłada na niego nadpisania z site.theme (siteLook)
    look: studio.look,
    ...logoInfo(studio),
    phone: studio.phone,
    email: studio.email,
    address: studio.address,
    timezone: studio.timezone,
    joinCode: studio.invite_code,
    // początek oferty – zajęcia z konfiguracji startowej nie są „nowością” (isNewClass)
    createdAt: studio.created_at,
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
      about: t.about,
      avatarUrl: t.avatar_mime ? `/api/users/${t.id}/avatar?v=${t.avatar_version}` : null,
      classes: teaches.filter((x) => x.trainer_id === t.id).map((x) => x.class_type_id),
    })),
    classes: classes.map((c) => ({ id: c.id, name: c.name, level: c.level, color: c.color, description: c.description, photoUrl: c.photo_url, zone: c.zone_name, createdAt: c.created_at })),
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      price: formatPLN(p.price_grosze),
      soldOut: p.status === 'sold_out' || totalStock(JSON.parse(p.variants_json) as Variant[]) === 0,
      photoUrl: p.media_id ? `/api/public-media/${p.media_id}` : null,
    })),
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
    site,
  };
}
