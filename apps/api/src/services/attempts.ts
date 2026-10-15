// Proste liczniki nieudanych prób w pamięci procesu (np. zgadywanie kodów rabatowych).
// Po restarcie serwera liczniki zaczynają się od zera – to hamulec na skrypty, nie zapis do rozliczeń.
import { HttpError } from '../errors.ts';

const buckets = new Map<string, number[]>();

function recent(key: string, windowMs: number, now: number) {
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length) buckets.set(key, list);
  else buckets.delete(key);
  return list;
}

/** Rzuca 429, gdy w oknie czasowym było już `max` nieudanych prób. */
export function assertAttemptsLeft(key: string, max: number, windowMs: number, message: string, now = Date.now()) {
  if (recent(key, windowMs, now).length >= max) throw new HttpError(429, 'too_many_attempts', message);
}

export function recordFailedAttempt(key: string, now = Date.now()) {
  buckets.set(key, [...(buckets.get(key) ?? []), now]);
}
