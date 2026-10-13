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

// ——— Kalendarz edycji sezonowych (7.4) – propozycje do biblioteki pakietów ———

export type EditionIdea = { id: string; name: string; tagline: string; from: (y: number) => string; to: (y: number) => string; ideas: string; classes: string; badge?: string };

const shift = (f: (y: number) => string, days: number) => (y: number) => {
  const d = new Date(`${f(y)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const EDITIONS: EditionIdea[] = [
  { id: 'styczen', name: 'Nowy rok, nowy oddech', tagline: 'Cel roku bez presji.', from: md(1, 2), to: md(1, 31), ideas: 'Cel roku, wyzwanie „Styczeń w ruchu”, ankieta celów', classes: 'Start roku, Flow ogólny' },
  { id: 'walentynki', name: 'Miłość do siebie', tagline: 'Rytuał samoakceptacji.', from: md(2, 7), to: md(2, 14), ideas: 'Zniżka dla pary, kartka do przyjaciółki', classes: 'Pilates w parze, Stretch' },
  { id: 'dzien_kobiet', name: 'Siła kobiet', tagline: 'Nie musisz nic udowadniać.', from: md(3, 1), to: md(3, 8), ideas: 'Wyzwanie „Kobieca siła”, rabat dla koleżanki', classes: 'Reformer Power, Stretch', badge: 'women_power' },
  { id: 'wiosna', name: 'Odrodzenie', tagline: 'Świeży start.', from: shift(easter, -10), to: shift(easter, 1), ideas: 'Medytacja „Świeży start”, wyzwanie „Lekko w ciele”', classes: 'Oddech i mobilność' },
  { id: 'dzien_matki', name: 'Dla mam i dla Ciebie', tagline: 'Zabierz mamę na trening.', from: md(5, 19), to: md(5, 26), ideas: 'Voucher „Mama + córka”, tryb po porodzie', classes: 'Pilates dla mam, Stretch' },
  { id: 'lato', name: 'Lekkość', tagline: 'Lato w formie bez pośpiechu.', from: md(6, 1), to: md(6, 30), ideas: 'Zajęcia na świeżym powietrzu, playlisty', classes: 'Outdoor' },
  { id: 'wakacje', name: 'Urlop dla ciała', tagline: 'Zamrożenie karnetu z uśmiechem.', from: md(7, 1), to: md(8, 31), ideas: 'Tryb urlopowy, medytacje w podróży, pakiet „Wracam po wakacjach”', classes: 'Krótkie zajęcia, Stretch' },
  { id: 'wrzesien', name: 'Nowy start po wakacjach', tagline: 'Wrzesień na nowo.', from: md(9, 1), to: md(9, 30), ideas: 'Zniżka powrotna, grupy tematyczne', classes: 'Start sezonu, Flow' },
  { id: 'pazdziernik', name: 'Październik oddechowy', tagline: 'Zwolnij i oddychaj.', from: md(10, 1), to: md(10, 30), ideas: 'Wyzwanie oddechowe, herbaciany rytuał, ciepły dziennik', classes: 'Oddech, Stretch wieczorny', badge: 'breath_october' },
  { id: 'halloween', name: 'Strasznie dobry trening', tagline: 'Halloween Flow – bez strasznych treści.', from: md(10, 31), to: md(10, 31), ideas: 'Motyw dyniowy, zajęcia „Mroczny Flow”', classes: 'Zajęcia tematyczne Halloween', badge: 'ghost' },
  { id: 'zaduszki', name: 'Chwila dla siebie', tagline: 'Wyciszenie i wdzięczność.', from: md(11, 1), to: md(11, 2), ideas: 'Medytacja pamięci i wdzięczności, lampion', classes: 'Medytacja, Stretch' },
  { id: 'niepodleglosc', name: 'Silne kobiety w Polsce', tagline: 'Subtelna biel i czerwień.', from: md(11, 11), to: md(11, 11), ideas: 'Odznaka „Patriotka formy”', classes: 'Flow', badge: 'patriotka' },
  { id: 'black_friday', name: 'Dla siebie', tagline: 'Prezent dla przyjaciółki.', from: shift(blackFriday, -3), to: blackFriday, ideas: 'Kampania karnetów (bez presji), voucher dla przyjaciółki', classes: 'Bez zmian' },
  { id: 'mikolajki', name: 'Prezent dla siebie', tagline: 'Mała niespodzianka.', from: md(12, 6), to: md(12, 6), ideas: 'Voucher, wiadomość od trenerki', classes: 'Stretch, Flow', badge: 'mikolajki' },
  { id: 'swieta', name: 'Ciepło i spokój', tagline: 'Światła, herbata i oddech.', from: md(12, 7), to: md(12, 27), ideas: 'Medytacja „Spokojne święta”, wyzwanie „21 dni wdzięczności”', classes: 'Zajęcia świąteczne, Stretch' },
  { id: 'sylwester', name: 'Nowy rok, nowy ja', tagline: 'Co zostawiam w starym roku.', from: md(12, 31), to: md(12, 31), ideas: 'Ankieta „Co chcę zostawić”, motyw złoto-biały', classes: 'Medytacja noworoczna' },
];

export function editionsFor(year: number) {
  return EDITIONS.map((e) => ({ ...e, from: e.from(year), to: e.to(year) }));
}
