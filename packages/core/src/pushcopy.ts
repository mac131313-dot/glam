// Kalendarz powiadomień (8): treści wyzwalaczy. Max 2 zdania, ciepło, bez presji i porównań.
// Imion nie odmieniamy („prowadzi Marzena”, nie „z Marzeną” – decyzja z README).
import type { PushCategory } from './push.ts';

export type Trigger =
  | 'class_24h'
  | 'class_2h'
  | 'class_soon'
  | 'confirm_2h'
  | 'spot_freed'
  | 'class_cancelled'
  | 'trainer_change'
  | 'pass_expiring'
  | 'no_visits_friday'
  | 'morning_ritual'
  | 'evening_me_time'
  | 'micro_break'
  | 'week_goal_half'
  | 'week_goal_done'
  | 'streak'
  | 'friend_invite'
  | 'friend_joined'
  | 'new_challenge'
  | 'course_lesson'
  | 'trainer_message'
  | 'course_ending'
  | 'birthday'
  | 'anniversary'
  | 'level_up'
  | 'dormant_survey'
  | 'reactivation'
  | 'reward_ready'
  | 'card'
  | 'pickup_ready'
  | 'event_tomorrow'
  | 'gift_received'
  | 'ten_classes';

export const TRIGGERS: Record<Trigger, { label: string; when: string; category: PushCategory; text: (v: Record<string, string>) => string }> = {
  class_24h: { label: 'Zajęcia jutro', when: '24 h przed', category: 'transactional', text: (v) => `Jutro o ${v.time} ${v.class}, prowadzi ${v.trainer}. Do zobaczenia! 💛` },
  class_2h: { label: 'Zajęcia za 2 h', when: '2 h przed', category: 'transactional', text: () => 'Za 2 godziny ruszamy. Weź wodę i matę 🧘‍♀️' },
  class_soon: { label: 'Zajęcia wkrótce', when: 'wybrany czas przed', category: 'transactional', text: (v) => `${v.lead[0].toUpperCase()}${v.lead.slice(1)} ${v.class} o ${v.time}, prowadzi ${v.trainer}. Weź wodę i matę 🧘‍♀️` },
  confirm_2h: { label: 'Potwierdzenie obecności', when: '2 h przed', category: 'transactional', text: (v) => `Będziesz na ${v.class} o ${v.time}? Potwierdź jednym kliknięciem.` },
  spot_freed: { label: 'Zwolnione miejsce', when: 'natychmiast', category: 'transactional', text: (v) => `Zwolniło się miejsce na ${v.time}. Chcesz je?` },
  class_cancelled: { label: 'Odwołanie zajęć', when: 'natychmiast', category: 'transactional', text: (v) => `Zajęcia ${v.time} odwołane. Wybierz inny termin.` },
  trainer_change: { label: 'Zmiana trenerki / sali', when: 'natychmiast', category: 'transactional', text: (v) => `Dziś prowadzi ${v.trainer}, ${v.zone}. Do zobaczenia!` },
  pass_expiring: { label: 'Karnet wygasa', when: '14 / 7 / 1 dzień', category: 'transactional', text: (v) => `Twój karnet kończy się ${v.when}. Przedłużysz?` },
  no_visits_friday: { label: 'Brak wejść w tygodniu', when: 'pt 17:00', category: 'wellbeing', text: () => 'Może spokojna medytacja na weekend? 🌿' },
  morning_ritual: { label: 'Poranny rytuał', when: 'pn–pt 7:30', category: 'wellbeing', text: (v) => `Dzień dobry, ${v.name} ☀️ Dzisiejszy cel: 5 minut oddechu.` },
  evening_me_time: { label: 'Zrób coś dla siebie', when: 'wybrane dni 20:30', category: 'wellbeing', text: () => 'Czas tylko dla Ciebie. 5-minutowa medytacja? 🌙' },
  micro_break: { label: 'Mikroprzerwa', when: 'opt-in, wybrane godziny', category: 'wellbeing', text: () => 'Zrobimy 3 oddechy? Rozciągnij kark na minutę.' },
  week_goal_half: { label: 'Cel tygodnia – połowa', when: 'śr 18:00', category: 'motivation', text: (v) => `Masz ${v.done} z ${v.target} treningów. Jesteś blisko!` },
  week_goal_done: { label: 'Cel tygodnia – osiągnięty', when: 'nd 19:00', category: 'motivation', text: () => 'Cel tygodnia zrealizowany! Odznaka czeka 🏅' },
  streak: { label: 'Seria', when: 'dzień przed przerwą', category: 'motivation', text: (v) => `Twoja seria to ${v.weeks} z ruchem. Jeśli masz ochotę, w tym tygodniu jest jeszcze miejsce na zajęcia.` },
  friend_invite: { label: 'Zaproszenie od znajomej', when: 'natychmiast', category: 'community', text: (v) => `${v.name} zaprasza Cię na trening we dwie 💛` },
  friend_joined: { label: 'Znajoma dołączyła', when: 'natychmiast', category: 'community', text: (v) => `${v.name} dołączyła do Twojego treningu!` },
  new_challenge: { label: 'Nowe wyzwanie', when: 'pn 9:00', category: 'community', text: (v) => `Startuje wyzwanie „${v.title}”. Dołączysz?` },
  course_lesson: { label: 'Nowa lekcja w kursie', when: 'wg harmonogramu', category: 'courses', text: (v) => `Nowa lekcja w kursie „${v.course}” czeka 🎬` },
  trainer_message: { label: 'Wiadomość od trenerki', when: 'natychmiast', category: 'courses', text: () => 'Twoja trenerka napisała do Ciebie 💛' },
  course_ending: { label: 'Kurs kończy się', when: '3 dni przed', category: 'courses', text: (v) => `Dostęp do kursu „${v.course}” kończy się za 3 dni.` },
  birthday: { label: 'Urodziny', when: 'dzień urodzin 9:00', category: 'occasional', text: (v) => `Wszystkiego dobrego, ${v.name}! Prezent czeka 🎁` },
  anniversary: { label: 'Rocznica', when: 'rocznica pierwszego treningu', category: 'occasional', text: () => 'Rok z nami! Dziękujemy za ten czas 💛' },
  level_up: { label: 'Nowy poziom', when: 'natychmiast', category: 'loyalty', text: (v) => `Awansujesz na poziom ${v.level} ✨` },
  dormant_survey: { label: 'Ankieta uśpionych', when: '7 dni nieobecności', category: 'reactivation', text: () => 'Dawno Cię nie widziałyśmy. Co się stało?' },
  reactivation: { label: 'Oferta reaktywacyjna', when: '21 dni nieobecności', category: 'reactivation', text: (v) => `Wracaj, kiedy zechcesz. Pierwsze zajęcia po przerwie –${v.percent}% z kodem ${v.code}.` },
  reward_ready: { label: 'Paczka po 10. treningu', when: 'przy odbiorze / wysyłce', category: 'loyalty', text: () => 'Twoja paczka po 10 treningach czeka w recepcji 🎁' },
  card: { label: 'Kartka od trenerki', when: 'po 1. miesiącu', category: 'loyalty', text: () => 'Dziś dostaniesz od nas coś od serca 💛 Sprawdź pocztę lub recepcję.' },
  pickup_ready: { label: 'Rezerwacja gotowa do odbioru', when: 'gdy produkt czeka', category: 'shop', text: (v) => `${v.item} czeka w studiu 🧦 Odbierz do ${v.until}.` },
  event_tomorrow: { label: 'Wydarzenie jutro', when: 'dzień przed, 18:00', category: 'events', text: (v) => `Jutro ${v.what} w studiu 🎉 Do zobaczenia!` },
  gift_received: { label: 'Prezent od znajomej', when: 'natychmiast po wysyłce', category: 'community', text: (v) => `${v.name} zrobiła Ci prezent 💛 Odbierz wejściówkę na zajęcia.` },
  ten_classes: { label: 'Nagroda za 10 zajęć', when: 'po 10. treningu', category: 'loyalty', text: () => 'Masz nagrodę za 10 treningów 🧦 Wybierz rozmiar w aplikacji.' },
};

/** Przykładowe dane do podglądu treści w panelu („podgląd na telefonie”, 8.1.5). */
export const PREVIEW_VARS: Record<string, string> = {
  time: '18:00',
  class: 'Reformer',
  trainer: 'Marzena',
  zone: 'sala 2',
  lead: 'za godzinę',
  when: 'za tydzień',
  name: 'Magda',
  done: '2',
  target: '4',
  weeks: "5 tygodni",
  title: 'Oddech w październiku',
  course: 'Reformer od podstaw',
  tagline: 'Witaj, jesień w studiu!',
  level: 'Flow',
  percent: '50',
  code: 'WRACAM',
  item: 'Twoje skarpetki',
  until: '20.10',
  what: 'Twoje urodziny',
};

/** Max 2 zdania (8). */
export function sentenceCount(text: string): number {
  return text.split(/[.!?…]+(?:\s|$)/).filter((s) => /\p{L}/u.test(s)).length;
}
