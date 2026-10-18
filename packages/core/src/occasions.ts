// Ciepłe wiadomości i życzenia (8.1) oraz kalendarz edycji (7.4). To gest, nie reklama:
// okolicznościowe bez sprzedaży (wyjątek: urodziny i rocznica – jeden delikatny prezent).
// Daty ruchome (Wielkanoc, Black Friday) liczymy, ale przed publikacją zawsze do weryfikacji.

export type OccasionKind = 'birthday' | 'nameday' | 'anniversary' | 'studio_anniversary' | 'holiday' | 'milestone' | 'support';

/** Typy do osobnego wyłączenia w ustawieniach (8.1.1). */
export const OCCASION_TOGGLES = [
  { id: 'birthday', label: 'Urodziny' },
  { id: 'anniversary', label: 'Rocznice' },
  { id: 'holiday', label: 'Święta' },
  { id: 'milestone', label: 'Gratulacje' },
  { id: 'support', label: 'Wsparcie' },
] as const;
export type OccasionToggle = (typeof OCCASION_TOGGLES)[number]['id'];

export type Holiday = { id: string; date: (year: number) => string; time: string; body: string; extra?: string; toggle: OccasionToggle };

const md = (m: number, d: number) => (y: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Wielkanoc (algorytm Meeusa/Jonesa/Butchera). */
export function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return md(month, day)(year);
}

/** Black Friday: dzień po czwartym czwartku listopada. */
export function blackFriday(year: number): string {
  const nov1 = new Date(Date.UTC(year, 10, 1)).getUTCDay(); // 0 = nd
  const firstThu = 1 + ((4 - nov1 + 7) % 7);
  return md(11, firstThu + 21 + 1)(year);
}

export const HOLIDAYS: Holiday[] = [
  { id: 'babcia', date: md(1, 21), time: '09:00', toggle: 'holiday', body: 'Dla kobiet, które są inspiracją: dla Ciebie i dla Twojej babci 🌼' },
  { id: 'walentynki', date: md(2, 14), time: '09:00', toggle: 'holiday', body: 'Miłość zaczyna się od Ciebie. Wybierz dziś coś dla siebie 💗', extra: 'Medytacja „Miłość do siebie”' },
  { id: 'dzien_kobiet', date: md(3, 8), time: '09:00', toggle: 'holiday', body: 'Dzień Kobiet to Twój dzień. Nie musisz nic udowadniać, wystarczy, że jesteś 🌷', extra: 'Wyzwanie „Kobieca siła”' },
  { id: 'dzien_matki', date: md(5, 26), time: '09:00', toggle: 'holiday', body: 'Dla wszystkich mam: dziś Twój czas. Zabierz siebie na 10 minut oddechu 💛' },
  { id: 'mikolajki', date: md(12, 6), time: '09:00', toggle: 'holiday', body: 'Mikołaj zostawił dla Ciebie małą niespodziankę w aplikacji 🎁' },
  { id: 'wigilia', date: md(12, 24), time: '09:00', toggle: 'holiday', body: 'Spokojnych Świąt, {imię}. Życzę Ci czasu dla siebie i ciepła w gronie bliskich 🎄' },
  { id: 'sylwester', date: md(12, 31), time: '18:00', toggle: 'holiday', body: 'Do zobaczenia w nowym roku! Co zostawiasz za sobą, a co chcesz zabrać ze sobą? ✨' },
];

export function holidaysOn(date: string): Holiday[] {
  const year = Number(date.slice(0, 4));
  return HOLIDAYS.filter((h) => h.date(year) === date);
}

export const fill = (template: string, vars: Record<string, string | null | undefined>) =>
  template.replace(/\{([^}]+)\}/g, (_, k: string) => vars[k] ?? '').replace(/,\s*([!.?])/g, '$1').replace(/\s{2,}/g, ' ').trim();

export const WISHES = {
  birthday: 'Wszystkiego dobrego, {imię}! 🎂 Niech ten rok przyniesie Ci spokój i radość. Dziś dla Ciebie: 10 minut medytacji bez ciśnienia 💛',
  birthdayTrainer: '{imię}, wszystkiego najlepszego! Cieszę się, że jesteś z nami. Do zobaczenia na sali 🌸 Twoja {trenerka}',
  nameday: 'Imieniny to dobry powód, żeby zrobić coś tylko dla siebie 🌷 Wszystkiego najlepszego!',
  anniversary: 'Rok temu zrobiłaś pierwszy krok. Dziś możesz być z siebie dumna ✨',
  studioAnniversary: 'Dziękujemy, że jesteście z nami 💛',
  support: 'Trzymamy kciuki. Gdy będziesz gotowa, drzwi są otwarte 🌸',
};

export const MILESTONES = {
  tenClasses: '10 treningów za Tobą! To duży krok 🏅',
  firstMeditation: 'Pierwsza medytacja za Tobą. Brawo za chwilę tylko dla siebie 🌙',
  course: (name: string) => `Gratulacje! Ukończyłaś ${name} 🎓`,
  friendFirstClass: (name: string) => `${name} ma już za sobą pierwszy trening. Dziękujemy, że ją zaprosiłaś 💛`,
  comeback: 'Witaj z powrotem! Dobrze, że jesteś. Zaczynamy spokojnie 🌿',
};

/** Rocznica: ten sam dzień i miesiąc, co najmniej rok później (29.02 → 28.02 w latach nieprzestępnych). */
export function isAnniversary(firstIsoDate: string, today: string): number {
  const [fy, fm, fd] = firstIsoDate.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const day = fm === 2 && fd === 29 && !leap(ty) ? 28 : fd;
  return ty > fy && tm === fm && td === day ? ty - fy : 0;
}
