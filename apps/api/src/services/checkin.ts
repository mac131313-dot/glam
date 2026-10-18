// Kod QR klientki do check-inu (C3, 4.11): podpisany HMAC, ważny w dniu wystawienia – zrzut ekranu z wczoraj nie zadziała.
import { createHmac } from 'node:crypto';

const key = () => process.env.GLAM_QR_KEY ?? 'dev-qr-key';

export function checkinCode(studioId: string, userId: string, date: string): string {
  const sig = createHmac('sha256', key()).update(`${studioId}:${userId}:${date}`).digest('base64url').slice(0, 16);
  return `GLAM1.${userId}.${date}.${sig}`;
}

export function parseCheckinCode(studioId: string, code: string, today: string): string | null {
  const [v, userId, date] = code.trim().split('.');
  if (v !== 'GLAM1' || !userId || date !== today) return null;
  return checkinCode(studioId, userId, date) === code.trim() ? userId : null;
}

/** Data z prawdziwego kodu wystawionego na inny dzień niż dziś (np. zrzut ekranu z wczoraj); w pozostałych przypadkach null. */
export function checkinCodeOtherDay(studioId: string, code: string, today: string): string | null {
  const [v, userId, date] = code.trim().split('.');
  if (v !== 'GLAM1' || !userId || !date || date === today) return null;
  return checkinCode(studioId, userId, date) === code.trim() ? date : null;
}

/** Litery bez łatwych do pomylenia (I/L, O/Q) – kod czyta się na głos albo przepisuje z ekranu. */
const LETTERS = 'ABCDEFGHJKMNPRSTUVWXYZ';

/** Zapasowy kod z 6 liter, gdy QR się nie czyta: też podpisany i ważny tylko w swoim dniu. */
export function shortCheckinCode(studioId: string, userId: string, date: string): string {
  const mac = createHmac('sha256', key()).update(`short:${studioId}:${userId}:${date}`).digest();
  return Array.from(mac.subarray(0, 6), (b) => LETTERS[b % LETTERS.length]).join('');
}

export const isShortCheckinCode = (s: string) => /^[A-Za-z]{6}$/.test(s.replace(/[\s-]/g, ''));

/** Klientka po kodzie z liter: kod nie zawiera identyfikatora, więc sprawdzamy klientki studia (to tylko HMAC na osobę). */
export function findByShortCode(studioId: string, code: string, today: string, clientIds: string[]): string | null {
  const want = code.replace(/[\s-]/g, '').toUpperCase();
  return clientIds.find((u) => shortCheckinCode(studioId, u, today) === want) ?? null;
}
