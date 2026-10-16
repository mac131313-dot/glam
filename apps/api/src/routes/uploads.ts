// Wgrywanie filmów lekcji kawałkami z wznawianiem (pełne treningi 20–60 min, 0,5–2 GB).
//   POST   /api/creator/uploads            { mime, size, durationSec } → { id, offset: 0, chunkSize }
//   PUT    /api/creator/uploads/:id         surowe bajty (application/octet-stream), nagłówek Upload-Offset
//   GET    /api/creator/uploads/:id         → { offset } – skąd wznowić po zerwanym połączeniu
//   DELETE /api/creator/uploads/:id         anulowanie (zwalnia zarezerwowane miejsce)
// Gotowy film dostaje to samo id w media; lekcję tworzy się potem z { videoId }.
import type { FastifyInstance } from 'fastify';
import type { Readable } from 'node:stream';
import { ctx, requirePerm, type Deps } from '../context.ts';
import { badRequest } from '../errors.ts';
import { appendUpload, cancelUpload, getUpload, startUpload, UPLOAD_CHUNK } from '../services/media.ts';

export function uploadRoutes(app: FastifyInstance, deps: Deps) {
  const creator = requirePerm(deps.db, 'courses.create', 'courses.approve');

  // Surowe body nie jest buforowane ani parsowane – handler czyta je strumieniem prosto do pliku.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.post<{ Body: { mime: string; size: number; durationSec?: number } }>('/api/creator/uploads', creator, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body ?? ({} as typeof req.body);
    return startUpload(scope, studio, { kind: 'course', ownerId: user.id, mime: String(b.mime ?? ''), size: Number(b.size), durationSec: b.durationSec });
  });

  app.get<{ Params: { id: string } }>('/api/creator/uploads/:id', creator, async (req) => {
    const { scope, user } = ctx(req);
    const u = getUpload(scope, req.params.id, user.id);
    return { id: u.id, offset: u.received, size: u.size, chunkSize: UPLOAD_CHUNK };
  });

  app.put<{ Params: { id: string } }>('/api/creator/uploads/:id', creator, async (req) => {
    const { scope, user } = ctx(req);
    if (typeof (req.body as Readable | undefined)?.pipe !== 'function') throw badRequest('Wyślij kawałek pliku jako application/octet-stream.');
    const offset = Number(req.headers['upload-offset']);
    if (!Number.isInteger(offset) || offset < 0) throw badRequest('Brak nagłówka Upload-Offset.');
    return appendUpload(scope, req.params.id, user.id, offset, req.body as Readable);
  });

  app.delete<{ Params: { id: string } }>('/api/creator/uploads/:id', creator, async (req) => {
    const { scope, user } = ctx(req);
    cancelUpload(scope, req.params.id, user.id);
    return { ok: true };
  });
}
