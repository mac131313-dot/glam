// Pliki studia (wideo kursów i powitań, zdjęcia feedu, sklepu i postępów, materiały PDF).
// Sprawdzamy sygnaturę pliku, liczymy miejsce do limitu planu (1.2.11) i serwujemy z obsługą Range (przewijanie wideo).
// Obrazy i PDF trzymamy w bazie (BLOB), filmy na dysku (media-files.ts) – pełny trening to 0,5–2 GB.
import { createReadStream, createWriteStream, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { planById } from '@glam/core';
import { id, nowIso, type Db } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { imageRatio } from './image.ts';
import { mediaFile, uploadPart, videoPath } from './media-files.ts';
import type { Studio } from './studio.ts';

export type MediaKind = 'course' | 'welcome' | 'post' | 'progress' | 'shop' | 'cover' | 'attachment' | 'site' | 'intro' | 'chat';
type FileType = 'image' | 'video' | 'pdf';

const SIGNATURES: { mime: string; test: (b: Buffer) => boolean; type: FileType }[] = [
  { mime: 'image/png', type: 'image', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', type: 'image', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', type: 'image', test: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { mime: 'video/mp4', type: 'video', test: (b) => b.toString('ascii', 4, 8) === 'ftyp' },
  { mime: 'video/quicktime', type: 'video', test: (b) => b.toString('ascii', 4, 8) === 'ftyp' || b.toString('ascii', 4, 8) === 'moov' },
  { mime: 'video/webm', type: 'video', test: (b) => b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3 },
  { mime: 'application/pdf', type: 'pdf', test: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
];
/** Tyle bajtów z początku pliku wystarcza każdej sygnaturze powyżej. */
const SIGNATURE_BYTES = 12;

/** Filmy przez dataUrl ogranicza i tak bodyLimit trasy; duże idą kawałkami (POST /api/creator/uploads). */
export const MEDIA_LIMITS: Record<FileType, number> = { image: 3_000_000, video: 3_000_000_000, pdf: 10_000_000 };
/** Rozmiar kawałka przy wgrywaniu – mieści się w limicie nginx i w domyślnym requestTimeout Node. */
export const UPLOAD_CHUNK = 8 * 1024 * 1024;

const signatureOk = (mime: string, head: Buffer) => SIGNATURES.some((s) => s.mime === mime && s.test(head));

/** Miejsce zajęte przez studio: gotowe pliki plus zarezerwowane przez trwające wgrywania. */
function assertSpace(scope: StudioScope, studio: Studio, extra: number) {
  const used = scope.get<{ b: number }>(
    'SELECT (SELECT COALESCE(SUM(size), 0) FROM media WHERE studio_id = $studio) + (SELECT COALESCE(SUM(size), 0) FROM media_uploads WHERE studio_id = $studio) AS b',
  )!.b;
  if (used + extra > planById(studio.plan_id).limits.videoMb * 1_000_000) throw new HttpError(413, 'storage_limit', 'Studio wykorzystało miejsce na pliki w swoim planie.');
}

export function storeMedia(
  scope: StudioScope,
  studio: Studio,
  input: { dataUrl: string; kind: MediaKind; ownerId: string; durationSec?: number | null; private?: boolean; allow?: FileType[] },
) {
  const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(input.dataUrl ?? ''));
  if (!m) throw badRequest('Nieprawidłowy plik.');
  const data = Buffer.from(m[2], 'base64');
  const sig = SIGNATURES.find((s) => s.mime === m[1] && s.test(data));
  if (!sig) throw badRequest('Zawartość pliku nie pasuje do formatu. Dozwolone: JPG, PNG, WebP, MP4, MOV, WebM, PDF.');
  if (input.allow && !input.allow.includes(sig.type)) throw badRequest('Ten rodzaj pliku nie jest tu dozwolony.');
  if (data.length > MEDIA_LIMITS[sig.type]) throw badRequest(`Plik jest za duży (max ${Math.round(MEDIA_LIMITS[sig.type] / 1_000_000)} MB).`);
  // Miejsce na wideo liczy się do limitu planu abonamentowego.
  assertSpace(scope, studio, data.length);
  const mediaId = id();
  const path = sig.type === 'video' ? videoPath(scope.db, studio.id, mediaId, sig.mime) : null;
  if (path) writeFileSync(mediaFile(scope.db, path), data);
  scope.run(
    `INSERT INTO media (id, studio_id, owner_id, kind, mime, data, path, size, duration_sec, ratio, private, created_at)
     VALUES ($id, $studio, $owner, $kind, $mime, $data, $path, $size, $dur, $ratio, $priv, $now)`,
    {
      id: mediaId,
      owner: input.ownerId,
      kind: input.kind,
      mime: sig.mime,
      data: path ? null : data,
      path,
      size: data.length,
      dur: input.durationSec ?? null,
      ratio: sig.type === 'image' ? imageRatio(data, sig.mime) : null,
      priv: Number(!!input.private),
      now: nowIso(),
    },
  );
  return { id: mediaId, url: `/api/media/${mediaId}`, mime: sig.mime, type: sig.type };
}

/** Usuwa plik studia razem z filmem na dysku (jeśli to film). */
export function deleteMedia(scope: StudioScope, mediaId: string) {
  const m = scope.get<{ path: string | null }>('SELECT path FROM media WHERE studio_id = $studio AND id = $id', { id: mediaId });
  if (!m) return;
  scope.run('DELETE FROM media WHERE studio_id = $studio AND id = $id', { id: mediaId });
  if (m.path) rmSync(mediaFile(scope.db, m.path), { force: true });
}

// ——— Wgrywanie filmów kawałkami (pełne treningi) ———

type UploadRow = { id: string; owner_id: string; kind: MediaKind; mime: string; size: number; received: number; duration_sec: number | null };

/** Porzucone wgrywania (np. zamknięta karta) zwalniają miejsce po dobie. */
export function pruneUploads(db: Db, olderThanMs = 86_400_000) {
  const old = db.prepare('SELECT id FROM media_uploads WHERE created_at < ?').all(new Date(Date.now() - olderThanMs).toISOString()) as { id: string }[];
  for (const u of old) {
    db.prepare('DELETE FROM media_uploads WHERE id = ?').run(u.id);
    rmSync(uploadPart(db, u.id), { force: true });
  }
}

export function startUpload(scope: StudioScope, studio: Studio, input: { kind: MediaKind; ownerId: string; mime: string; size: number; durationSec?: number | null }) {
  const sig = SIGNATURES.find((s) => s.mime === input.mime);
  if (sig?.type !== 'video') throw badRequest('Dozwolone filmy: MP4, MOV, WebM.');
  const size = Math.floor(Number(input.size));
  if (!(size >= SIGNATURE_BYTES)) throw badRequest('Nieprawidłowy plik.');
  if (size > MEDIA_LIMITS.video) throw badRequest(`Plik jest za duży (max ${MEDIA_LIMITS.video / 1_000_000_000} GB).`);
  pruneUploads(scope.db);
  assertSpace(scope, studio, size);
  const uploadId = id();
  writeFileSync(uploadPart(scope.db, uploadId), '');
  const dur = Number(input.durationSec);
  scope.run(
    'INSERT INTO media_uploads (id, studio_id, owner_id, kind, mime, size, received, duration_sec, created_at) VALUES ($id, $studio, $o, $k, $m, $s, 0, $d, $now)',
    { id: uploadId, o: input.ownerId, k: input.kind, m: input.mime, s: size, d: Number.isFinite(dur) && dur > 0 ? dur : null, now: nowIso() },
  );
  return { id: uploadId, offset: 0, size, chunkSize: UPLOAD_CHUNK };
}

export function getUpload(scope: StudioScope, uploadId: string, ownerId: string) {
  const u = scope.get<UploadRow>('SELECT * FROM media_uploads WHERE studio_id = $studio AND id = $id AND owner_id = $o', { id: uploadId, o: ownerId });
  if (!u) throw notFound('Wgrywanie wygasło – zacznij od nowa.');
  return u;
}

export function cancelUpload(scope: StudioScope, uploadId: string, ownerId: string) {
  const u = getUpload(scope, uploadId, ownerId);
  scope.run('DELETE FROM media_uploads WHERE studio_id = $studio AND id = $id', { id: u.id });
  rmSync(uploadPart(scope.db, u.id), { force: true });
}

/** Jeden kawałek naraz na dane wgrywanie – równoległe PUT-y z tym samym offsetem nadpisywałyby się nawzajem. */
const busy = new Set<string>();

/**
 * Dopisuje kawałek od bajtu `offset` (musi równać się `received`, inaczej 409 z aktualnym offsetem – klient
 * wznawia od niego). Body czytamy strumieniem prosto do pliku; po pierwszych bajtach sprawdzamy sygnaturę.
 * Zerwany kawałek nie przesuwa `received`, więc ponowna próba nadpisze niedokończone bajty.
 */
export async function appendUpload(scope: StudioScope, uploadId: string, ownerId: string, offset: number, body: Readable) {
  const u = getUpload(scope, uploadId, ownerId);
  if (offset !== u.received) throw conflict('upload_offset', 'Wznów wgrywanie od właściwego miejsca.', { offset: u.received });
  if (busy.has(u.id)) throw conflict('upload_busy', 'Ten plik jest właśnie wgrywany.', { offset: u.received });
  busy.add(u.id);
  try {
    const part = uploadPart(scope.db, u.id);
    let seen = 0;
    let head = offset === 0 ? Buffer.alloc(0) : null;
    // Błędu nie zgłaszamy w trakcie strumienia: zniszczenie body zerwałoby połączenie, zanim klient dostanie
    // odpowiedź. Zapamiętujemy go, resztę kawałka (≤ UPLOAD_CHUNK) odrzucamy i odpowiadamy po końcu body.
    let failure: HttpError | null = null;
    const guard = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        if (failure) return cb();
        seen += chunk.length;
        if (offset + seen > u.size) failure = badRequest('Plik jest większy niż zapowiedziany.');
        else if (head && head.length < SIGNATURE_BYTES) {
          head = Buffer.concat([head, chunk]).subarray(0, SIGNATURE_BYTES);
          if (head.length === SIGNATURE_BYTES && !signatureOk(u.mime, head)) failure = new HttpError(415, 'bad_signature', 'Zawartość pliku nie pasuje do formatu filmu (MP4, MOV, WebM).');
        }
        cb(null, failure ? undefined : chunk);
      },
    });
    await pipeline(body, guard, createWriteStream(part, { flags: 'r+', start: offset }));
    if (!failure && offset === 0 && (head?.length ?? 0) < SIGNATURE_BYTES) failure = badRequest('Pierwszy kawałek pliku jest za krótki.');
    if (failure) {
      if (failure.code === 'bad_signature') cancelUpload(scope, u.id, ownerId);
      throw failure;
    }
    const received = offset + seen;
    if (received < u.size) {
      scope.run('UPDATE media_uploads SET received = $r WHERE studio_id = $studio AND id = $id', { r: received, id: u.id });
      return { offset: received, size: u.size, done: false as const };
    }
    // Komplet: przenosimy plik na miejsce i zamieniamy rezerwację miejsca na wpis w media (to samo id).
    const path = videoPath(scope.db, scope.studioId, u.id, u.mime);
    renameSync(part, mediaFile(scope.db, path));
    scope.tx(() => {
      scope.run('DELETE FROM media_uploads WHERE studio_id = $studio AND id = $id', { id: u.id });
      scope.run(
        `INSERT INTO media (id, studio_id, owner_id, kind, mime, data, path, size, duration_sec, ratio, private, created_at)
         VALUES ($id, $studio, $o, $k, $m, NULL, $p, $s, $d, NULL, 0, $now)`,
        { id: u.id, o: u.owner_id, k: u.kind, m: u.mime, p: path, s: u.size, d: u.duration_sec, now: nowIso() },
      );
    });
    return { offset: received, size: u.size, done: true as const, media: { id: u.id, mime: u.mime, durationSec: u.duration_sec } };
  } finally {
    busy.delete(u.id);
  }
}

// ——— Wysyłka ———

/** Wysyłka pliku z obsługą nagłówka Range (wideo w Safari wymaga odpowiedzi 206). Filmy strumieniem z dysku. */
export function sendMedia(
  db: Db,
  req: FastifyRequest,
  reply: FastifyReply,
  row: { mime: string; data: Uint8Array | null; path?: string | null },
  cache = 'private, max-age=3600',
) {
  const file = row.path ? mediaFile(db, row.path) : null;
  let size: number;
  if (file) {
    try {
      size = statSync(file).size;
    } catch {
      throw notFound('Plik zniknął z dysku.');
    }
  } else size = row.data?.length ?? 0;
  const body = (start: number, end: number) => (file ? createReadStream(file, { start, end }) : Buffer.from(row.data!).subarray(start, end + 1));
  reply.header('content-type', row.mime).header('accept-ranges', 'bytes').header('cache-control', cache).header('x-content-type-options', 'nosniff');
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start >= size || start > end) return reply.status(416).header('content-range', `bytes */${size}`).send();
    return reply.status(206).header('content-range', `bytes ${start}-${end}/${size}`).header('content-length', end - start + 1).send(body(start, end));
  }
  if (size === 0) return reply.send(Buffer.alloc(0));
  return reply.header('content-length', size).send(body(0, size - 1));
}
