// Kod QR klientki do check-inu (C3, 4.11): zmienia się co 30 s (liveCheckinCode z core), więc zrzut ekranu szybko przestaje działać.
// Telefon dostaje dzienny sekret i sam liczy kody, także offline; sekret jest podpisany HMAC i ważny tylko w swoim dniu.
import { createHmac } from 'node:crypto';
import { acceptCheckinStep, liveCheckinCode, type LiveCheckin } from '@glam/core';

const key = () => process.env.GLAM_QR_KEY ?? 'dev-qr-key';

export function checkinSeed(studioId: string, userId: string, date: string): LiveCheckin {
  return { user: userId, date, seed: createHmac('sha256', key()).update(`seed:${studioId}:${userId}:${date}`).digest('base64url').slice(0, 22) };
}

/** Prawdziwy kod tej klientki (podpis się zgadza) – bez sprawdzania dnia i okna. */
function genuine(studioId: string, code: string): { user: string; date: string; step: number } | null {
  const [v, user, date, step] = code.trim().split('.');
  if (v !== 'GLAM2' || !user || !date || !/^\d+$/.test(step ?? '')) return null;
  return liveCheckinCode(checkinSeed(studioId, user, date), Number(step)) === code.trim() ? { user, date, step: Number(step) } : null;
}

export function parseCheckinCode(studioId: string, code: string, today: string, nowStep: number): string | null {
  const c = genuine(studioId, code);
  return c && c.date === today && acceptCheckinStep(c.step, nowStep) ? c.user : null;
}

/** Dlaczego prawdziwy kod nie przeszedł: wystawiony na inny dzień albo przeterminowany (zrzut ekranu). Dla obcych kodów null. */
export function checkinCodeProblem(studioId: string, code: string, today: string): { kind: 'other_day'; date: string } | { kind: 'expired' } | null {
  const c = genuine(studioId, code);
  if (!c) return code.trim().startsWith('GLAM1.') ? { kind: 'expired' } : null;
  return c.date !== today ? { kind: 'other_day', date: c.date } : { kind: 'expired' };
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
