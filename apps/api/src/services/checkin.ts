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
