// Regulamin czasowy, limity miejsc i lista oczekujących (sekcja 4.1, reguła rezerwacji z 1.1.1).

export type BookingPolicy = {
  /** Na ile dni do przodu otwieramy zapisy. */
  opensDaysAhead: number;
  /** Zapis najpóźniej X minut przed startem (spec: „do 2 h przed”). */
  closesMinutesBefore: number;
  /** Bezpłatne odwołanie najpóźniej X minut przed startem. */
  cancelMinutesBefore: number;
  waitlist: boolean;
};

export const DEFAULT_POLICY: BookingPolicy = {
  opensDaysAhead: 14,
  closesMinutesBefore: 120,
  cancelMinutesBefore: 120,
  waitlist: true,
};

export type WindowCheck = { ok: true } | { ok: false; reason: 'started' | 'not_open_yet' | 'closed' };

export const WINDOW_COPY = {
  started: 'Te zajęcia już się zaczęły.',
  not_open_yet: 'Zapisy na te zajęcia jeszcze się nie otworzyły.',
  closed: 'Zapisy na te zajęcia są już zamknięte.',
} as const;

export function bookingWindow(policy: BookingPolicy, startsAt: Date, now: Date): WindowCheck {
  const minutesLeft = (startsAt.getTime() - now.getTime()) / 60_000;
  if (minutesLeft <= 0) return { ok: false, reason: 'started' };
  if (minutesLeft > policy.opensDaysAhead * 24 * 60) return { ok: false, reason: 'not_open_yet' };
  if (minutesLeft < policy.closesMinutesBefore) return { ok: false, reason: 'closed' };
  return { ok: true };
}

/**
 * refund – odwołanie w terminie, wejście wraca na karnet;
 * late – po terminie: miejsce się zwalnia, ale wejście przepada;
 * started – zajęcia trwają lub minęły, odwołać się nie da.
 */
export type CancellationOutcome = 'refund' | 'late' | 'started';

export function cancellationOutcome(policy: BookingPolicy, startsAt: Date, now: Date): CancellationOutcome {
  const minutesLeft = (startsAt.getTime() - now.getTime()) / 60_000;
  if (minutesLeft <= 0) return 'started';
  return minutesLeft >= policy.cancelMinutesBefore ? 'refund' : 'late';
}

/**
 * Wejście „z ulicy” w recepcji: czy klientkę bez rezerwacji można jeszcze dopisać do tych zajęć i wpuścić na salę.
 * Recepcja może zapisać najpóźniej 15 min po starcie (bookSession) – okno nie może sięgać dalej.
 */
export function canWalkIn(startsAt: Date, now: Date, freeSeats: number): boolean {
  const minutes = (startsAt.getTime() - now.getTime()) / 60_000;
  return freeSeats > 0 && minutes >= -10 && minutes <= 45;
}

export type SeatDecision = 'booked' | 'waitlist' | 'full';

export function seatDecision(capacity: number, taken: number, waitlistEnabled: boolean): SeatDecision {
  if (taken < capacity) return 'booked';
  return waitlistEnabled ? 'waitlist' : 'full';
}

/** Lista oczekujących: kolejność zgłoszeń (FIFO). */
export function waitlistOrder<T extends { createdAt: string }>(waitlist: T[]): T[] {
  return [...waitlist].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
