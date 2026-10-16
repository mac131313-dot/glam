// Szyfrowanie pól z danymi szczególnymi (RODO art. 9 – sekcja 11): dziennik nastroju, pomiary,
// cykl, ankieta zdrowia, adres do wysyłki, klucze bramki płatności studia.
// AES-256-GCM, klucz z GLAM_DATA_KEY (32 bajty base64). Format: v1.<iv>.<tag>.<szyfrogram> (base64url).
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function key(): Buffer {
  const raw = process.env.GLAM_DATA_KEY;
  if (raw) {
    const k = Buffer.from(raw, 'base64');
    if (k.length !== 32) throw new Error('GLAM_DATA_KEY musi mieć 32 bajty (base64).');
    return k;
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Brak GLAM_DATA_KEY w produkcji.');
  return createHash('sha256').update('glam-dev-data-key').digest();
}

export function seal(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function unseal<T = unknown>(sealed: string | null | undefined): T | null {
  if (!sealed) return null;
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1') throw new Error('Nieznany format zaszyfrowanych danych.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const plain = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]);
  return JSON.parse(plain.toString('utf8')) as T;
}

// ——— Podpisane linki do wideo lekcji ———
// Apple TV (AirPlay) i Chromecast same pobierają film – nie mają tokenu sesji ani nagłówka x-studio-id.
// Dlatego lekcja dostaje adres /api/stream/<id>?e=<wygaśnięcie>&sig=<HMAC>, ważny tylko dla tego pliku i do czasu e.

const streamKey = () => createHmac('sha256', key()).update('glam-stream-v1').digest();
const streamSig = (mediaId: string, exp: number) => createHmac('sha256', streamKey()).update(`${mediaId}.${exp}`).digest('base64url');

/**
 * Do kiedy (sekundy epoki) ma działać link do wideo wydany w chwili `nowSec`.
 * Odtwarzacz dociąga film kawałkami (Range) przez cały seans – link musi przeżyć lekcję, pauzę i przewijanie.
 */
export function streamExpiry(nowSec: number): number {
  // TODO(użytkownik): polityka ważności linku – patrz opis w rozmowie.
  return nowSec + 6 * 3600;
}

export function signStreamUrl(mediaId: string, nowSec = Math.floor(Date.now() / 1000)): string {
  const exp = streamExpiry(nowSec);
  return `/api/stream/${mediaId}?e=${exp}&sig=${streamSig(mediaId, exp)}`;
}

export function verifyStream(mediaId: string, exp: unknown, sig: unknown, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const e = Number(exp);
  if (!Number.isInteger(e) || e < nowSec || typeof sig !== 'string') return false;
  const want = Buffer.from(streamSig(mediaId, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
