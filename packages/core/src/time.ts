// Czas lokalny studia. Wszystko w bazie trzymamy w UTC (ISO), a reguły (okna dostępu,
// ciche godziny, limity dzienne/tygodniowe) liczymy w strefie czasowej studia.

export const DEFAULT_TZ = 'Europe/Warsaw';

const formatters = new Map<string, Intl.DateTimeFormat>();

function rawParts(at: Date, tz: string): Record<string, string> {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  const out: Record<string, string> = {};
  for (const p of f.formatToParts(at)) out[p.type] = p.value;
  return out;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export type LocalParts = {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  /** 1 = poniedziałek … 7 = niedziela */
  weekday: number;
  /** minuty od północy */
  minutes: number;
};

export function localParts(at: Date, tz = DEFAULT_TZ): LocalParts {
  const p = rawParts(at, tz);
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}`,
    weekday: WEEKDAYS[p.weekday],
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function offsetMs(at: Date, tz: string): number {
  const p = rawParts(at, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** „2026-10-14 18:00 w Warszawie” → chwila w UTC (poprawnie przez zmianę czasu). */
export function zonedToUtc(date: string, time: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const naive = Date.UTC(y, m - 1, d, hh, mm);
  const first = naive - offsetMs(new Date(naive), tz);
  return new Date(naive - offsetMs(new Date(first), tz));
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Poniedziałek tygodnia, w którym leży data (YYYY-MM-DD). */
export function weekStart(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = niedziela
  return addDays(date, -((dow + 6) % 7));
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export type DayPart = 'morning' | 'afternoon' | 'evening';

/** Smaczek 7.5: pora dnia zmienia ekran startowy. */
export function dayPart(at: Date, tz = DEFAULT_TZ): DayPart {
  const { minutes } = localParts(at, tz);
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 18 * 60) return 'afternoon';
  return 'evening';
}
