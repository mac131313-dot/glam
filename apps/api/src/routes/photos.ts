// Zdjęcia typów zajęć – tło kart w grafiku klientki. Wgrywa właścicielka (jak logo), widzą wszyscy.
import type { FastifyInstance } from 'fastify';
import { ctx, requireStudio, type Deps } from '../context.ts';
import { notFound } from '../errors.ts';
import { imageRatio } from '../services/image.ts';
import { validateImage } from './logo.ts';

/** Zdjęcie jest zmniejszane w przeglądarce do JPG ok. 1600 px, więc 1,5 MB to zapas, nie cel. */
export const PHOTO_MAX_BYTES = 1_500_000;

export function photoRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const owner = { preHandler: requireStudio(db, ['owner']) };

  app.put<{ Params: { id: string }; Body: { dataUrl: string } }>('/api/owner/class-types/:id/photo', { ...owner, bodyLimit: 3 * 1024 * 1024 }, async (req) => {
    const { scope } = ctx(req);
    if (!scope.get('SELECT 1 FROM class_types WHERE studio_id = $studio AND id = $id', { id: req.params.id })) throw notFound('Nie znaleziono typu zajęć.');
    const { mime, data } = validateImage(req.body?.dataUrl, { what: 'Zdjęcie', maxBytes: PHOTO_MAX_BYTES, svg: false });
    scope.run('UPDATE class_types SET photo_mime = $mime, photo_data = $data, photo_ratio = $ratio, photo_version = photo_version + 1 WHERE studio_id = $studio AND id = $id', {
      id: req.params.id,
      mime,
      data,
      ratio: imageRatio(data, mime),
    });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/owner/class-types/:id/photo', owner, async (req) => {
    ctx(req).scope.run('UPDATE class_types SET photo_mime = NULL, photo_data = NULL, photo_ratio = NULL, photo_version = photo_version + 1 WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    return { ok: true };
  });

  // Publiczne jak logo – zdjęcie sali/zajęć to materiał marketingowy studia, bez danych osobowych.
  app.get<{ Params: { id: string } }>('/api/class-types/:id/photo', async (req, reply) => {
    const row = db.prepare('SELECT photo_mime, photo_data FROM class_types WHERE id = ?').get(req.params.id) as
      | { photo_mime: string | null; photo_data: Uint8Array | null }
      | undefined;
    if (!row?.photo_mime || !row.photo_data) throw notFound('Te zajęcia nie mają zdjęcia.');
    return reply
      .header('content-type', row.photo_mime)
      .header('cache-control', 'public, max-age=31536000, immutable') // adres zawiera wersję
      .header('x-content-type-options', 'nosniff')
      .send(Buffer.from(row.photo_data));
  });
}
