// Harmonogram cykliczny z wyjątkami (C7) → konkretne sesje.
// System sam uzupełnia grafik (sekcja 1), API woła to cyklicznie i wstawia brakujące sesje.
import { addDays, DEFAULT_TZ, zonedToUtc } from './time.ts';

export type ScheduleTemplate = {
  id: string;
  classTypeId: string;
  zoneId: string;
  trainerId: string;
  /** 1 = poniedziałek … 7 = niedziela */
  weekday: number;
  startTime: string;
  durationMin: number;
  capacity: number;
  validFrom: string;
  validTo: string | null;
};

/** Święto, urlop, zamknięcie sali. zoneId = null → cały obiekt. */
export type ScheduleException = { date: string; zoneId: string | null; reason: string };

export type PlannedSession = {
  templateId: string;
  classTypeId: string;
  trainerId: string;
  startsAt: string;
  endsAt: string;
  capacity: number;
};

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return ((new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7) + 1;
}

/** Klucz „szablon ma już sesję tego dnia” – po zmianie godziny nie powstaje druga sesja w ten sam dzień. */
export const takenKey = (templateId: string, date: string) => `${templateId}|${date}`;

export function planSessions(
  templates: ScheduleTemplate[],
  exceptions: ScheduleException[],
  fromDate: string,
  days: number,
  tz = DEFAULT_TZ,
  taken: ReadonlySet<string> = new Set(),
): PlannedSession[] {
  const out: PlannedSession[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const wd = weekdayOf(date);
    for (const t of templates) {
      if (t.weekday !== wd || date < t.validFrom || (t.validTo && date > t.validTo)) continue;
      const blocked = exceptions.some((e) => e.date === date && (e.zoneId === null || e.zoneId === t.zoneId));
      if (blocked || taken.has(takenKey(t.id, date))) continue;
      const start = zonedToUtc(date, t.startTime, tz);
      out.push({
        templateId: t.id,
        classTypeId: t.classTypeId,
        trainerId: t.trainerId,
        startsAt: start.toISOString(),
        endsAt: new Date(start.getTime() + t.durationMin * 60_000).toISOString(),
        capacity: t.capacity,
      });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Slot w grafiku tak, jak ustawia go właścicielka: jedne zajęcia w kilku dniach tygodnia naraz. */
export type SlotInput = { weekdays: number[]; startTime: string; durationMin: number; capacity: number };

export function validateSlot(s: SlotInput): string[] {
  const errors: string[] = [];
  if (!s.weekdays.length) errors.push('Wybierz przynajmniej jeden dzień.');
  if (s.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) errors.push('Nieznany dzień tygodnia.');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.startTime)) errors.push('Podaj godzinę w formacie GG:MM.');
  if (!Number.isInteger(s.durationMin) || s.durationMin < 10 || s.durationMin > 240) errors.push('Czas trwania: od 10 do 240 minut.');
  if (!Number.isInteger(s.capacity) || s.capacity < 1 || s.capacity > 200) errors.push('Liczba miejsc: od 1 do 200.');
  return errors;
}

/** Zmiana slotu, która przesuwa zajęcia w czasie (inny dzień albo godzina) albo zdejmuje je z grafiku. */
export type SlotEdit = 'retime' | 'remove';

/**
 * Co z już wygenerowaną sesją, na którą są zapisy, gdy właścicielka przesuwa albo usuwa slot.
 *  - 'keep'   – sesja zostaje w starym terminie (zmiana obowiązuje od pierwszego wolnego tygodnia),
 *  - 'cancel' – sesja jest odwoływana, wejścia wracają na karnety, klientki dostają powiadomienie.
 * Sesje bez zapisów system zawsze po cichu przestawia – tu trafiają tylko te z klientkami.
 */
export function bookedSessionFate(input: { edit: SlotEdit; booked: number; hoursUntil: number }): 'keep' | 'cancel' {
  // TODO(użytkownik): reguła biznesowa studia – patrz opis w rozmowie.
  void input;
  return 'keep';
}
