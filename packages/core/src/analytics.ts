// Segmenty i analityka właścicielki (4.11, 12): aktywne / uśpione 7/14/30, nowe, ambasadorki,
// ryzyko odejścia; retencja 30/60/90 dni, średnia wejść, LTV, ARPU, NPS, konwersja zaproszeń.

export type ClientFacts = {
  userId: string;
  joinedAt: string;
  lastVisit: string | null;
  /** Daty (ISO) zrealizowanych wejść, od najnowszej. */
  visits: string[];
  /** Ile znajomych przyszło z jej polecenia. */
  referralsConverted: number;
  lastNps: number | null;
  hasActivePass: boolean;
  passEndsInDays: number | null;
  lateCancels30d: number;
  revenueGrosze: number;
};

export type Segment = 'new' | 'active' | 'dormant7' | 'dormant14' | 'dormant30' | 'ambassador' | 'churn_risk';

export const SEGMENT_LABEL: Record<Segment, string> = {
  new: 'Nowe (14 dni)',
  active: 'Aktywne (<7 dni)',
  dormant7: 'Uśpione 7–14 dni',
  dormant14: 'Uśpione 14–30 dni',
  dormant30: 'Uśpione 30+ dni',
  ambassador: 'Ambasadorki',
  churn_risk: 'Ryzyko odejścia',
};

const days = (fromIso: string, now: Date) => (now.getTime() - Date.parse(fromIso)) / 86_400_000;

/** Segment aktywności – dokładnie jeden z: active / dormant7 / dormant14 / dormant30. */
export function activitySegment(c: Pick<ClientFacts, 'lastVisit' | 'joinedAt'>, now: Date): 'active' | 'dormant7' | 'dormant14' | 'dormant30' {
  const d = days(c.lastVisit ?? c.joinedAt, now);
  if (d < 7) return 'active';
  if (d < 14) return 'dormant7';
  if (d < 30) return 'dormant14';
  return 'dormant30';
}

/**
 * Ryzyko odejścia: 0–100. Im wyżej, tym pilniej warto się odezwać (bez presji – ankieta, termin).
 * Dostaje fakty o klientce, zwraca liczbę. Wynik ≥ 60 = segment „Ryzyko odejścia”.
 */
export function churnRisk(c: ClientFacts, now: Date): number {
  // TODO(Ty): to decyzja biznesowa – które sygnały i z jaką wagą? Patrz „Twój ruch” w README.
  // Prosta wersja zastępcza: tylko dni od ostatniej wizyty.
  const d = days(c.lastVisit ?? c.joinedAt, now);
  return Math.min(100, Math.round(d * 3));
}

export function segmentsOf(c: ClientFacts, now: Date): Segment[] {
  const out: Segment[] = [activitySegment(c, now)];
  if (days(c.joinedAt, now) < 14) out.push('new');
  if (c.referralsConverted >= 2 || (c.lastNps !== null && c.lastNps >= 9 && c.visits.length >= 10)) out.push('ambassador');
  if (churnRisk(c, now) >= 60) out.push('churn_risk');
  return out;
}

/** Retencja: odsetek klientek z kohorty (dołączyły ≥ N dni temu), które były na zajęciach po N dniach od dołączenia. */
export function retention(clients: ClientFacts[], horizonDays: number, now: Date): number | null {
  const cohort = clients.filter((c) => days(c.joinedAt, now) >= horizonDays);
  if (cohort.length === 0) return null;
  const kept = cohort.filter((c) => c.visits.some((v) => (Date.parse(v) - Date.parse(c.joinedAt)) / 86_400_000 >= horizonDays));
  return Math.round((kept.length / cohort.length) * 100);
}

/** Średnia wejść na aktywną klientkę w ostatnich 30 dniach. */
export function avgVisits30(clients: ClientFacts[], now: Date): number {
  const recent = clients.map((c) => c.visits.filter((v) => days(v, now) <= 30).length).filter((n) => n > 0);
  return recent.length ? Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 10) / 10 : 0;
}

/** LTV: średni przychód na klientkę od początku (w groszach) i ARPU miesięczne. */
export function ltv(clients: ClientFacts[]): number {
  return clients.length ? Math.round(clients.reduce((a, c) => a + c.revenueGrosze, 0) / clients.length) : 0;
}

export function arpu(revenueThisMonthGrosze: number, activeClients: number): number {
  return activeClients ? Math.round(revenueThisMonthGrosze / activeClients) : 0;
}

/** NPS = % promotorek (9–10) − % krytyczek (0–6). */
export function nps(scores: number[]): number | null {
  if (scores.length === 0) return null;
  const p = scores.filter((s) => s >= 9).length;
  const d = scores.filter((s) => s <= 6).length;
  return Math.round(((p - d) / scores.length) * 100);
}

/** Aktywacja (KPI 12): % nowych klientek z pierwszymi zajęciami w ciągu 7 dni od dołączenia. */
export function activationRate(clients: ClientFacts[], now: Date): number | null {
  const cohort = clients.filter((c) => days(c.joinedAt, now) >= 7 && days(c.joinedAt, now) <= 90);
  if (!cohort.length) return null;
  const ok = cohort.filter((c) => c.visits.some((v) => (Date.parse(v) - Date.parse(c.joinedAt)) / 86_400_000 <= 7));
  return Math.round((ok.length / cohort.length) * 100);
}

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

// ——— A/B test kampanii: przypisanie wariantu stabilne dla osoby ———

export function abVariant(userId: string, campaignId: string, variants: number): number {
  let h = 2166136261;
  for (const ch of `${campaignId}:${userId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % Math.max(1, variants);
}
