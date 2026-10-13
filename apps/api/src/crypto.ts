// Szyfrowanie pól z danymi szczególnymi (RODO art. 9 – sekcja 11): dziennik nastroju, pomiary,
// cykl, ankieta zdrowia, adres do wysyłki, klucze bramki płatności studia.
// AES-256-GCM, klucz z GLAM_DATA_KEY (32 bajty base64). Format: v1.<iv>.<tag>.<szyfrogram> (base64url).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

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
