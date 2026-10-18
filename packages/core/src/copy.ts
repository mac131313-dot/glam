// Polskie formaty i odmiana. Ton: ciepło, krótko, bez presji (sekcja 10).
import { DEFAULT_TZ, localParts } from './time.ts';

/** plural(3, 'wejście', 'wejścia', 'wejść') → 'wejścia' */
/** Postęp celu tygodnia: licznik nie przekracza celu („3/3”, nie „4/3”). */
export function goalCount(done: number, goal: number): string {
  return goal > 0 ? `${Math.min(done, goal)}/${goal}` : String(done);
}

/** Nadwyżka ponad cel jako „ +1” (z odstępem na początku), pusty napis, gdy jej nie ma. */
export function goalExtra(done: number, goal: number): string {
  return goal > 0 && done > goal ? ` +${done - goal}` : '';
}

export function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const tens = n % 100;
  const units = n % 10;
  if (units >= 2 && units <= 4 && (tens < 12 || tens > 14)) return few;
  return many;
}

export const entries = (n: number) => `${n} ${plural(n, 'wejście', 'wejścia', 'wejść')}`;

/** „30.11” */
export function shortDate(iso: string | Date, tz = DEFAULT_TZ): string {
  const { date } = localParts(typeof iso === 'string' ? new Date(iso) : iso, tz);
  const [, m, d] = date.split('-');
  return `${d}.${m}`;
}

export function formatPLN(grosze: number): string {
  const zl = grosze / 100;
  return `${Number.isInteger(zl) ? zl : zl.toFixed(2).replace('.', ',')} zł`;
}

export const WEEKDAY_SHORT = ['', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'];
export const WEEKDAY_LONG = ['', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota', 'niedziela'];

/** Zakres dni tygodnia jako „pn–pt” albo „pn, śr, pt”. */
export function weekdaysLabel(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sorted.length === 7) return 'codziennie';
  const contiguous = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (contiguous && sorted.length > 2) return `${WEEKDAY_SHORT[sorted[0]]}–${WEEKDAY_SHORT[sorted.at(-1)!]}`;
  return sorted.map((d) => WEEKDAY_SHORT[d]).join(', ');
}

export function greeting(minutes: number): string {
  if (minutes < 5 * 60) return 'Dobranoc';
  if (minutes < 12 * 60) return 'Dzień dobry';
  if (minutes < 18 * 60) return 'Cześć';
  return 'Dobry wieczór';
}
