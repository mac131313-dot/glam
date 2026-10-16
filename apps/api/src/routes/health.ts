// Profil zdrowia i postępów (4.6, #35, #36) – wszystko na życzenie, za odrębną zgodą (RODO art. 9), zaszyfrowane.
// Ankieta startowa (cele, ograniczenia, kontuzje) widoczna dla trenerki; pomiary i zdjęcia – tylko gdy klientka
// sama je udostępni. Wykresy bez oceniania wyglądu. Plus serwowanie plików studia z kontrolą dostępu.
import type { FastifyInstance } from 'fastify';
import { localParts } from '@glam/core';
import { assertFeature, ctx, isStaff, requireStudio, type Deps } from '../context.ts';
import { seal, unseal } from '../crypto.ts';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { sendMedia, storeMedia } from '../services/media.ts';
import { lessonAccess } from './courses.ts';

type HealthProfile = { goals?: string; limitations?: string; injuries?: string; pregnancy?: boolean; postpartum?: boolean; notes?: string };
type Measurement = { weight?: number; waist?: number; hips?: number; chest?: number; wellbeing?: number; note?: string };

function requireHealth(scope: StudioScope, userId: string) {
  const c = scope.db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'health'").get(userId) as { granted: number } | undefined;
  if (!c?.granted) throw new HttpError(403, 'consent_required', 'Ta część wymaga Twojej odrębnej zgody na dane o zdrowiu. Możesz ją wycofać w każdej chwili – dane zostaną usunięte.');
}

export function healthRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };

  app.get('/api/my/health', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'health');
    const consent = !!(db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'health'").get(user.id) as { granted: number } | undefined)?.granted;
    const photosConsent = !!(db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'photos'").get(user.id) as { granted: number } | undefined)?.granted;
    if (!consent) return { consent: false, photosConsent };
    const p = scope.get<{ data_enc: string }>('SELECT data_enc FROM health_profiles WHERE studio_id = $studio AND user_id = $u', { u: user.id });
    return {
      consent: true,
      photosConsent,
      profile: unseal<HealthProfile>(p?.data_enc) ?? {},
      measurements: scope
        .all<{ id: string; date: string; data_enc: string; share_with_trainer: number }>('SELECT id, date, data_enc, share_with_trainer FROM measurements WHERE studio_id = $studio AND user_id = $u ORDER BY date', { u: user.id })
        .map((m) => ({ id: m.id, date: m.date, shared: !!m.share_with_trainer, ...(unseal<Measurement>(m.data_enc) ?? {}) })),
      photos: photosConsent
        ? scope.all("SELECT id, taken_on, share_with_trainer AS shared, '/api/media/' || media_id AS url FROM progress_photos WHERE studio_id = $studio AND user_id = $u ORDER BY taken_on", { u: user.id })
        : [],
      plan: (() => {
        const pl = scope.get<{ title: string; items_json: string; updated_at: string; trainer_id: string }>('SELECT title, items_json, updated_at, trainer_id FROM individual_plans WHERE studio_id = $studio AND client_id = $u', { u: user.id });
        return pl ? { title: pl.title, items: JSON.parse(pl.items_json), updatedAt: pl.updated_at, trainer: (db.prepare('SELECT name FROM users WHERE id = ?').get(pl.trainer_id) as { name: string } | undefined)?.name } : null;
      })(),
    };
  });

  // Ankieta startowa (4.6) – widoczna dla trenerki, bo pomaga bezpiecznie prowadzić zajęcia.
  app.put<{ Body: HealthProfile }>('/api/my/health', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'health');
    requireHealth(scope, user.id);
    const b = req.body ?? {};
    const clean = (s?: string) => (s ? String(s).trim().slice(0, 500) : undefined);
    const data: HealthProfile = { goals: clean(b.goals), limitations: clean(b.limitations), injuries: clean(b.injuries), pregnancy: !!b.pregnancy, postpartum: !!b.postpartum, notes: clean(b.notes) };
    scope.run('INSERT OR REPLACE INTO health_profiles (studio_id, user_id, data_enc, updated_at) VALUES ($studio, $u, $d, $now)', { u: user.id, d: seal(data), now: nowIso() });
    return { ok: true };
  });

  app.post<{ Body: Measurement & { date?: string; share?: boolean } }>('/api/my/measurements', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'health');
    requireHealth(scope, user.id);
    const b = req.body ?? {};
    const num = (v: unknown, min: number, max: number) => (v === undefined || v === null || v === '' ? undefined : Number(v) >= min && Number(v) <= max ? Math.round(Number(v) * 10) / 10 : (() => { throw badRequest('Sprawdź wartości pomiarów.'); })());
    const data: Measurement = { weight: num(b.weight, 30, 250), waist: num(b.waist, 40, 200), hips: num(b.hips, 40, 200), chest: num(b.chest, 40, 200), wellbeing: num(b.wellbeing, 1, 5), note: b.note?.slice(0, 200) };
    if (Object.values(data).every((v) => v === undefined)) throw badRequest('Wpisz co najmniej jedną wartość.');
    const date = b.date && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : localParts(new Date(), studio.timezone).date;
    scope.run('INSERT INTO measurements (id, studio_id, user_id, date, data_enc, share_with_trainer, created_at) VALUES ($id, $studio, $u, $d, $data, $s, $now)', { id: id(), u: user.id, d: date, data: seal(data), s: Number(!!b.share), now: nowIso() });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/my/measurements/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('DELETE FROM measurements WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id });
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { share: boolean } }>('/api/my/measurements/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('UPDATE measurements SET share_with_trainer = $s WHERE studio_id = $studio AND id = $id AND user_id = $u', { s: Number(!!req.body?.share), id: req.params.id, u: user.id });
    return { ok: true };
  });

  // Zdjęcia postępów (#35): opt-in, prywatne, z możliwością usunięcia; brak publikacji bez zgody.
  app.post<{ Body: { dataUrl: string; takenOn?: string; share?: boolean } }>('/api/my/photos', { ...member, bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'health');
    const c = db.prepare("SELECT granted FROM consents WHERE user_id = ? AND studio_id = '' AND kind = 'photos'").get(user.id) as { granted: number } | undefined;
    if (!c?.granted) throw new HttpError(403, 'consent_required', 'Zdjęcia postępów wymagają Twojej zgody.');
    const m = storeMedia(scope, studio, { dataUrl: req.body?.dataUrl, kind: 'progress', ownerId: user.id, private: true, allow: ['image'] });
    scope.run('INSERT INTO progress_photos (id, studio_id, user_id, media_id, taken_on, share_with_trainer, created_at) VALUES ($id, $studio, $u, $m, $d, $s, $now)', {
      id: id(),
      u: user.id,
      m: m.id,
      d: req.body.takenOn && /^\d{4}-\d{2}-\d{2}$/.test(req.body.takenOn) ? req.body.takenOn : localParts(new Date(), studio.timezone).date,
      s: Number(!!req.body.share),
      now: nowIso(),
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/my/photos/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    const p = scope.get<{ media_id: string }>('SELECT media_id FROM progress_photos WHERE studio_id = $studio AND id = $id AND user_id = $u', { id: req.params.id, u: user.id });
    if (!p) throw notFound();
    scope.tx(() => {
      scope.run('DELETE FROM progress_photos WHERE studio_id = $studio AND id = $id', { id: req.params.id });
      scope.run('DELETE FROM media WHERE studio_id = $studio AND id = $m', { m: p.media_id });
    });
    return { ok: true };
  });

  app.patch<{ Params: { id: string }; Body: { share: boolean } }>('/api/my/photos/:id', member, async (req) => {
    const { scope, user } = ctx(req);
    scope.run('UPDATE progress_photos SET share_with_trainer = $s WHERE studio_id = $studio AND id = $id AND user_id = $u', { s: Number(!!req.body?.share), id: req.params.id, u: user.id });
    return { ok: true };
  });

  // ——— Pliki studia z kontrolą dostępu ———

  app.get<{ Params: { id: string } }>('/api/media/:id', member, async (req, reply) => {
    const { scope, user, roles } = ctx(req);
    const m = scope.get<{ id: string; kind: string; owner_id: string | null; mime: string; data: Uint8Array; private: number }>('SELECT * FROM media WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!m) throw notFound();
    const staff = isStaff(roles);
    let ok = !m.private || m.owner_id === user.id;
    if (m.kind === 'progress') {
      // Zdjęcie postępu: właścicielka zdjęcia, a trenerka tylko gdy klientka je udostępniła.
      ok = m.owner_id === user.id || (roles.includes('trainer') && !!scope.get('SELECT 1 FROM progress_photos WHERE studio_id = $studio AND media_id = $m AND share_with_trainer = 1', { m: m.id }));
    } else if (m.kind === 'welcome') {
      ok = staff || !!scope.get('SELECT 1 FROM welcome_messages WHERE studio_id = $studio AND video_id = $m AND client_id = $u', { m: m.id, u: user.id });
    } else if (m.kind === 'chat') {
      // Załącznik z czatu: zespół studia i klientka, której rozmowy dotyczy.
      ok = staff || !!scope.get('SELECT 1 FROM chat_messages WHERE studio_id = $studio AND media_id = $m AND client_id = $u', { m: m.id, u: user.id });
    } else if (m.kind === 'course' || m.kind === 'attachment') {
      ok = staff || lessonAccess(scope, user.id, m.id);
    }
    if (!ok) throw notFound();
    return sendMedia(req, reply, m, m.private ? 'private, no-store' : 'private, max-age=86400');
  });

  // Okładki kursów, zdjęcia produktów sklepu i zdjęcia strony WWW są publiczne (bez danych osobowych).
  app.get<{ Params: { id: string } }>('/api/public-media/:id', async (req, reply) => {
    const m = db.prepare("SELECT mime, data FROM media WHERE id = ? AND kind IN ('cover', 'shop', 'site') AND private = 0").get(req.params.id) as { mime: string; data: Uint8Array } | undefined;
    if (!m) throw notFound();
    return sendMedia(req, reply, m, 'public, max-age=31536000, immutable');
  });
}
