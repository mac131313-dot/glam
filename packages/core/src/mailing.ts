// Mailing studia: nowości pisane ręcznie i automatyczny e-mail „Nowe zajęcia w grafiku”.
// Szablon to dane studia (ustawienia → newClassMail); zmienne w klamrach, akapity zostają.
import { WEEKDAY_LONG } from './copy.ts';

export type NewClassMail = { enabled: boolean; subject: string; body: string };

export const NEW_CLASS_MAIL: NewClassMail = {
  enabled: true,
  subject: 'Nowe w grafiku: {zajęcia}',
  body: 'Cześć {imię}!\n\nW grafiku {studio} pojawiły się nowe zajęcia: {zajęcia} – {termin}. Prowadzi {trenerka}.\n\nMiejsce zarezerwujesz w aplikacji. Do zobaczenia!',
};

/** Zmienne dostępne w e-mailach – z przykładem do podglądu. */
export const MAIL_VARS: { key: string; label: string; example: string }[] = [
  { key: 'imię', label: 'Imię klientki', example: 'Magda' },
  { key: 'studio', label: 'Nazwa studia', example: 'Centrum Ruchu' },
  { key: 'zajęcia', label: 'Nazwa zajęć', example: 'Pilates na macie' },
  { key: 'termin', label: 'Kiedy', example: 'we wtorki o 18:00' },
  { key: 'trenerka', label: 'Trenerka', example: 'Marzena' },
];

export const MAIL_PREVIEW_VARS = Object.fromEntries(MAIL_VARS.map((v) => [v.key, v.example]));

/** Jak fill(), ale zostawia podział na akapity – e-mail to nie push. Brak imienia: „Cześć!” zamiast „Cześć !”. */
export function fillMail(template: string, vars: Record<string, string | null | undefined>) {
  return template
    .replace(/\{([^}]+)\}/g, (_, k: string) => vars[k] ?? '')
    .replace(/[ \t]+([,!.?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const WEEKDAY_PLURAL = ['', 'poniedziałki', 'wtorki', 'środy', 'czwartki', 'piątki', 'soboty', 'niedziele'];

/** „we wtorki i czwartki o 18:00” – termin zajęć z grafiku cyklicznego. */
export function weeklyTermin(weekdays: number[], time: string) {
  const sorted = [...new Set(weekdays)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  const days = sorted.map((d) => WEEKDAY_PLURAL[d]);
  const list = days.length > 1 ? `${days.slice(0, -1).join(', ')} i ${days.at(-1)}` : (days[0] ?? '');
  return `${sorted[0] === 2 ? 'we' : 'w'} ${list} o ${time}`;
}

/** „w piątek 31.10 o 19:00” – termin pojedynczych zajęć (data lokalna studia). */
export function oneOffTermin(date: string, time: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = d.getUTCDay() || 7;
  const day = WEEKDAY_LONG[wd];
  const pre = wd === 2 ? 'we' : 'w';
  const acc = day.replace(/a$/, 'ę');
  return `${pre} ${acc} ${date.slice(8, 10)}.${date.slice(5, 7)} o ${time}`;
}
