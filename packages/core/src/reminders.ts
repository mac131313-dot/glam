// Przypomnienia przed treningiem (8): klientka sama wybiera, kiedy (dzień wcześniej, 3 h, 2 h, 1 h, 30 min)
// albo wyłącza je całkiem. Prośba o potwierdzenie obecności to osobna zasada studia – nie zależy od tego wyboru.

/** Minuty przed startem zajęć, kiedy przypominamy. */
export const CLASS_REMINDER_OPTIONS: { minutes: number; label: string }[] = [
  { minutes: 1440, label: 'Dzień wcześniej' },
  { minutes: 180, label: '3 h przed' },
  { minutes: 120, label: '2 h przed' },
  { minutes: 60, label: '1 h przed' },
  { minutes: 30, label: '30 min przed' },
];

/** Tak było przed wprowadzeniem wyboru – kto nic nie zmieniał, dostaje to samo. */
export const DEFAULT_CLASS_REMINDERS = [1440, 120];

/** Zapisany wybór → poprawna lista (tylko znane opcje, bez powtórzeń); brak wyboru = domyślne. */
export function classReminderOffsets(saved: number[] | undefined | null): number[] {
  if (!saved) return DEFAULT_CLASS_REMINDERS;
  const known = new Set(CLASS_REMINDER_OPTIONS.map((o) => o.minutes));
  return [...new Set(saved.filter((m) => known.has(m)))].sort((a, b) => b - a);
}

/**
 * Które przypomnienie wysłać teraz (minuty przed startem) albo null.
 * Zadanie chodzi co minutę, a powtórki blokuje dedupe_key per (rezerwacja, offset), więc wystarczy
 * wskazać jeden właściwy offset:
 * – tylko taki, którego moment już minął (zostało ≤ offset do startu),
 * – tylko taki, którego moment nastąpił PO rezerwacji – kto zapisał się 40 min przed zajęciami,
 *   nie dostaje „za 2 godziny”, bo o zajęciach dobrze wie,
 * – z kilku zaległych wybieramy najbliższy startowi (np. po przestoju serwera tylko jedno, aktualne).
 */
export function dueClassReminder(input: { startsAt: Date; bookedAt: Date; now: Date; offsets: number[] }): number | null {
  const { startsAt, bookedAt, now, offsets } = input;
  const left = startsAt.getTime() - now.getTime();
  if (left <= 0) return null;
  const due = offsets.filter((m) => left <= m * 60_000 && bookedAt.getTime() <= startsAt.getTime() - m * 60_000);
  return due.length ? Math.min(...due) : null;
}

/** „za 2 godziny”, „za godzinę”, „za 30 minut” – do treści powiadomienia. */
export function reminderLead(minutes: number): string {
  if (minutes >= 1440) return 'jutro';
  if (minutes === 60) return 'za godzinę';
  if (minutes > 60) return `za ${minutes / 60} godziny`;
  return `za ${minutes} minut`;
}
