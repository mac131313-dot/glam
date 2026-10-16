// Pliki studia (wideo kursów i powitań, zdjęcia feedu, sklepu i postępów, materiały PDF).
// Sprawdzamy sygnaturę pliku, liczymy miejsce do limitu planu (1.2.11) i serwujemy z obsługą Range (przewijanie wideo).
import type { FastifyReply, FastifyRequest } from 'fastify';
import { planById } from '@glam/core';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { imageRatio } from './image.ts';
import type { Studio } from './studio.ts';

export type MediaKind = 'course' | 'welcome' | 'post' | 'progress' | 'shop' | 'cover' | 'attachment' | 'site' | 'chat';

const SIGNATURES: { mime: string; test: (b: Buffer) => boolean; type: 'image' | 'video' | 'pdf' }[] = [
  { mime: 'image/png', type: 'image', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', type: 'image', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', type: 'image', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'video/mp4', type: 'video', test: (b) => b.toString('ascii', 4, 8) === 'ftyp' },
  { mime: 'video/quicktime', type: 'video', test: (b) => b.toString('ascii', 4, 8) === 'ftyp' || b.toString('ascii', 4, 8) === 'moov' },
  { mime: 'video/webm', type: 'video', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'application/pdf', type: 'pdf', test: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
];

export const MEDIA_LIMITS: Record<'image' | 'video' | 'pdf', number> = { image: 3_000_000, video: 40_000_000, pdf: 10_000_000 };

export function storeMedia(
  scope: StudioScope,
  studio: Studio,
  input: { dataUrl: string; kind: MediaKind; ownerId: string; durationSec?: number | null; private?: boolean; allow?: ('image' | 'video' | 'pdf')[] },
) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(input.dataUrl ?? ''));
  if (!m) throw badRequest('Nieprawidłowy plik.');
  const data = Buffer.from(m[2], 'base64');
  const sig = SIGNATURES.find((s) => s.mime === m[1] && s.test(data));
  if (!sig) throw badRequest('Zawartość pliku nie pasuje do formatu. Dozwolone: JPG, PNG, WebP, MP4, MOV, WebM, PDF.');
  if (input.allow && !input.allow.includes(sig.type)) throw badRequest('Ten rodzaj pliku nie jest tu dozwolony.');
  if (data.length > MEDIA_LIMITS[sig.type]) throw badRequest(`Plik jest za duży (max ${Math.round(MEDIA_LIMITS[sig.type] / 1_000_000)} MB).`);
  // Miejsce na wideo liczy się do limitu planu abonamentowego.
  const used = scope.get<{ b: number }>('SELECT COALESCE(SUM(size), 0) AS b FROM media WHERE studio_id = $studio', {})!.b;
  if (used + data.length > planById(studio.plan_id).limits.videoMb * 1_000_000) throw new HttpError(413, 'storage_limit', 'Studio wykorzystało miejsce na pliki w swoim planie.');
  const mediaId = id();
  scope.run(
    `INSERT INTO media (id, studio_id, owner_id, kind, mime, data, size, duration_sec, ratio, private, created_at)
     VALUES ($id, $studio, $owner, $kind, $mime, $data, $size, $dur, $ratio, $priv, $now)`,
    {
      id: mediaId,
      owner: input.ownerId,
      kind: input.kind,
      mime: sig.mime,
      data,
      size: data.length,
      dur: input.durationSec ?? null,
      ratio: sig.type === 'image' ? imageRatio(data, sig.mime) : null,
      priv: Number(!!input.private),
      now: nowIso(),
    },
  );
  return { id: mediaId, url: `/api/media/${mediaId}`, mime: sig.mime, type: sig.type };
}

/** Wysyłka pliku z obsługą nagłówka Range (wideo w Safari wymaga odpowiedzi 206). */
export function sendMedia(req: FastifyRequest, reply: FastifyReply, row: { mime: string; data: Uint8Array }, cache = 'private, max-age=3600') {
  const buf = Buffer.from(row.data);
  reply.header('content-type', row.mime).header('accept-ranges', 'bytes').header('cache-control', cache).header('x-content-type-options', 'nosniff');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range) {
    const start = range[1] ? Number(range[1]) : Math.max(0, buf.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), buf.length - 1) : buf.length - 1;
    if (start >= buf.length || start > end) return reply.status(416).header('content-range', `bytes */${buf.length}`).send();
    return reply.status(206).header('content-range', `bytes ${start}-${end}/${buf.length}`).send(buf.subarray(start, end + 1));
  }
  return reply.send(buf);
}
