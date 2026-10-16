// Wydarzenia prywatne (4.13): urodziny, babski wieczór, prezent-trening, rocznica, grupa z pracy,
// rodzinne zajęcia. Kreator, wolne sloty (sala + trenerka), statusy, RSVP, cena z cennika lub do ustalenia.

export const EVENT_KINDS = [
  { id: 'birthday', label: 'Urodziny', hero: 'Dziś Twoje urodziny w studiu' },
  { id: 'girls_night', label: 'Babski wieczór', hero: 'Dziś Wasz babski wieczór w studiu' },
  { id: 'gift', label: 'Prezent-trening', hero: 'Dziś trening w prezencie' },
  { id: 'anniversary', label: 'Rocznica', hero: 'Dziś świętujecie w studiu' },
  { id: 'team', label: 'Grupa z pracy', hero: 'Dziś Wasz zespół w studiu' },
  { id: 'family', label: 'Rodzinne zajęcia', hero: 'Dziś rodzinne zajęcia w studiu' },
] as const;
export type EventKind = (typeof EVENT_KINDS)[number]['id'];

export const EVENT_ACTIVITIES = ['Reformer', 'Mat', 'Stretch', 'Połączenie'] as const;
export const EVENT_ADDONS = [
  { id: 'playlist', label: 'Playlista na życzenie' },
  { id: 'decor', label: 'Dekoracje' },
  { id: 'snacks', label: 'Poczęstunek' },
] as const;

export type EventStatus = 'inquiry' | 'offer' | 'confirmed' | 'paid' | 'done' | 'cancelled';
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  inquiry: 'zapytanie',
  offer: 'oferta',
  confirmed: 'potwierdzone',
  paid: 'opłacone',
  done: 'zrealizowane',
  cancelled: 'odwołane',
};

const FLOW: Record<EventStatus, EventStatus[]> = {
  inquiry: ['offer', 'confirmed', 'cancelled'],
  offer: ['confirmed', 'paid', 'cancelled', 'offer'],
  confirmed: ['paid', 'done', 'cancelled'],
  paid: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

export const eventTransitionOk = (from: EventStatus, to: EventStatus) => FLOW[from].includes(to);

export type Interval = { start: string; end: string };
const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

/** Wolne sloty dla sali i trenerki w danym dniu (co 30 min w godzinach otwarcia). */
export function freeSlots(input: { dayStartIso: string; dayEndIso: string; durationMin: number; busyZone: Interval[]; busyTrainer: Interval[]; stepMin?: number; notBeforeIso?: string }): string[] {
  const step = (input.stepMin ?? 30) * 60_000;
  const dur = input.durationMin * 60_000;
  const out: string[] = [];
  for (let t = Date.parse(input.dayStartIso); t + dur <= Date.parse(input.dayEndIso); t += step) {
    const slot = { start: new Date(t).toISOString(), end: new Date(t + dur).toISOString() };
    if (input.notBeforeIso && slot.start < input.notBeforeIso) continue;
    if (input.busyZone.some((b) => overlaps(b, slot)) || input.busyTrainer.some((b) => overlaps(b, slot))) continue;
    out.push(slot.start);
  }
  return out;
}

export function validateEventRequest(input: { guests: number; min: number; max: number; startsAt: string; now: Date; minNoticeDays: number; termsAccepted: boolean }): string | null {
  if (!input.termsAccepted) return 'Zaakceptuj regulamin wydarzenia.';
  if (!Number.isInteger(input.guests) || input.guests < input.min || input.guests > input.max) return `Liczba osób: od ${input.min} do ${input.max}.`;
  if ((Date.parse(input.startsAt) - input.now.getTime()) / 86_400_000 < input.minNoticeDays) return `Wydarzenie trzeba zaplanować z wyprzedzeniem min. ${input.minNoticeDays} dni.`;
  return null;
}

/** Wydarzenie organizowane przez studio (np. Halloween Flow): dodaje je recepcja albo właścicielka z panelu. */
export type StudioEventInput = { title: string; startsAt: string; durationMin: number; capacity: number; priceGrosze: number | null; now: Date };

/** Zwraca komunikat dla recepcji (po polsku, jedno zdanie) albo null, gdy wszystko w porządku. */
export function validateStudioEvent(input: StudioEventInput): string | null {
  // Te same granice co przy zajęciach specjalnych w grafiku, żeby recepcja nie musiała pamiętać dwóch zestawów zasad.
  if (input.title.trim().length < 3) return 'Podaj nazwę wydarzenia.';
  if (Number.isNaN(Date.parse(input.startsAt))) return 'Wybierz dzień i godzinę.';
  if (Date.parse(input.startsAt) < input.now.getTime()) return 'Ten termin już minął – wybierz przyszły.';
  if (!Number.isInteger(input.durationMin) || input.durationMin < 15 || input.durationMin > 240) return 'Czas trwania: od 15 do 240 minut.';
  if (!Number.isInteger(input.capacity) || input.capacity < 1 || input.capacity > 200) return 'Liczba miejsc: od 1 do 200.';
  if (input.priceGrosze !== null && !(input.priceGrosze >= 0)) return 'Cena nie może być ujemna.';
  return null;
}

export function canClientCancel(startsAt: string, now: Date, cancelDays: number): boolean {
  return (Date.parse(startsAt) - now.getTime()) / 86_400_000 >= cancelDays;
}
