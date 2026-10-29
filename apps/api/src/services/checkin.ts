// Kod QR klientki do check-inu (C3, 4.11): zmienia się co minutę (liveCheckinCode z core), więc zrzut ekranu szybko przestaje działać.
// Telefon dostaje dzienny sekret i sam liczy kody, także offline; sekret jest podpisany HMAC i ważny tylko w swoim dniu.
import { createHmac } from 'node:crypto';
import { acceptCheckinStep, liveCheckinCode, liveShortCode, type LiveCheckin } from '@glam/core';

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

export const isShortCheckinCode = (s: string) => /^[A-Za-z]{6}$/.test(s.replace(/[\s-]/g, ''));

/**
 * Klientka po kodzie z 6 liter (liveShortCode z core – zmienia się co minutę, jak QR). Kod nie zawiera identyfikatora,
 * więc sprawdzamy klientki studia w bieżącym oknie ± jedno (acceptCheckinStep) – kilka HMAC na osobę.
 */
export function findByShortCode(studioId: string, code: string, today: string, nowStep: number, clientIds: string[]): string | null {
  const want = code.replace(/[\s-]/g, '').toUpperCase();
  const steps = [nowStep - 1, nowStep, nowStep + 1].filter((s) => acceptCheckinStep(s, nowStep));
  return clientIds.find((u) => {
    const seed = checkinSeed(studioId, u, today);
    return steps.some((s) => liveShortCode(seed, s) === want);
  }) ?? null;
}
