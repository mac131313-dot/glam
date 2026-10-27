// „Dopasowane do Ciebie”: dla kogo są zajęcia (ustawia studio przy typie zajęć) i co klientka zaznaczyła
// w krótkiej ankiecie po pierwszym logowaniu. Z obu powstaje wynik dopasowania – karuzela w Grafiku.

export type FitLevel = 'beginner' | 'intermediate' | 'advanced';
export type ClassLevel = FitLevel | 'all';
export type Focus = 'strength' | 'stretch' | 'calm' | 'energy' | 'posture';
export type ForWhom = 'return' | 'postnatal' | 'pregnancy' | 'back' | 'gentle';
/** Dawne pory z pierwszej wersji ankiety – czytamy je z bazy i zamieniamy na dni i godziny. */
type DayTime = 'morning' | 'noon' | 'evening' | 'weekend';

/** Ustawiane w panelu przy typie zajęć. */
export type ClassAudience = { level: ClassLevel; focus: Focus[]; forWhom: ForWhom[] };
/**
 * Odpowiedzi klientki z ankiety (prefs.classFit) – zarazem jej preferencje, które zmienia w każdej chwili.
 * `days` – dni tygodnia (0 = niedziela), puste = każdy dzień. `from`/`to` – okno w minutach od północy (czas studia).
 */
export type ClassFit = { level: FitLevel; focus: Focus[]; forWhom: ForWhom[]; days: number[]; from: number; to: number };
/** Kiedy są konkretne zajęcia – dzień tygodnia i minuty od północy w strefie studia. */
export type ClassWhen = { weekday: number; start: number; end: number };

/** Okno „kiedykolwiek” – zajęć przed 6 i po 22 studia praktycznie nie mają. */
export const DAY_FROM = 6 * 60;
export const DAY_TO = 22 * 60;
/** Krok godzin w ankiecie i najkrótsze okno, jakie da się ustawić. */
export const HOUR_STEP = 30;
export const MIN_WINDOW = 60;
/** Dni w polskiej kolejności (od poniedziałku). */
export const WEEK: [number, string, string][] = [
  [1, 'pn', 'poniedziałek'],
  [2, 'wt', 'wtorek'],
  [3, 'śr', 'środa'],
  [4, 'czw', 'czwartek'],
  [5, 'pt', 'piątek'],
  [6, 'sob', 'sobota'],
  [0, 'nd', 'niedziela'],
];
export const WORKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [6, 0];
/** Szybkie wybory godzin – jedno dotknięcie ustawia całe okno, potem można je dociągnąć co pół godziny. */
export const HOUR_PRESETS: [string, number, number][] = [
  ['Rano', 6 * 60, 10 * 60],
  ['Przed południem', 9 * 60, 13 * 60],
  ['W porze lunchu', 11 * 60, 15 * 60],
  ['Po południu', 14 * 60, 18 * 60],
  ['Wieczorem', 17 * 60, 21 * 60],
  ['Kiedykolwiek', DAY_FROM, DAY_TO],
];

export const CLASS_LEVELS: [ClassLevel, string][] = [
  ['all', 'Dla każdej'],
  ['beginner', 'Dla początkujących'],
  ['intermediate', 'Średnio zaawansowane'],
  ['advanced', 'Dla zaawansowanych'],
];
/** Tekst poziomu zapisywany w class_types.level – widoczny w grafiku i na stronie jak dotąd. */
export const LEVEL_TEXT: Record<ClassLevel, string> = { all: 'wszystkie poziomy', beginner: 'dla początkujących', intermediate: 'średnio zaawansowane', advanced: 'dla zaawansowanych' };

export const FIT_LEVELS: [FitLevel, string, string][] = [
  ['beginner', 'Dopiero zaczynam', 'albo wracam po długiej przerwie'],
  ['intermediate', 'Ćwiczę od czasu do czasu', 'znam podstawy'],
  ['advanced', 'Ćwiczę regularnie', 'chcę wyzwań'],
];
export const FOCUS: [Focus, string][] = [
  ['strength', 'Siła i jędrne ciało'],
  ['stretch', 'Rozciąganie i mobilność'],
  ['calm', 'Spokój i oddech'],
  ['energy', 'Energia i spalanie'],
  ['posture', 'Zdrowy kręgosłup i postawa'],
];
export const FOR_WHOM: [ForWhom, string][] = [
  ['return', 'Wracam po przerwie'],
  ['gentle', 'Wolę spokojne tempo'],
  ['back', 'Chcę zadbać o plecy'],
  ['pregnancy', 'Spodziewam się dziecka'],
  ['postnatal', 'Niedawno urodziłam'],
];
/** Te same grupy opisane od strony zajęć – w panelu przy „Dla kogo”. */
export const FOR_WHOM_CLASS: Record<ForWhom, string> = { return: 'Powrót po przerwie', postnatal: 'Po porodzie', pregnancy: 'W ciąży', back: 'Zdrowe plecy', gentle: 'Spokojne tempo' };
/** Te grupy dostają zajęcia „specjalne” – nie podpowiadamy ich osobom spoza grupy. */
const EXCLUSIVE: ForWhom[] = ['pregnancy', 'postnatal'];

const pick = <T extends string>(all: [T, ...unknown[]][], v: unknown): T[] => (Array.isArray(v) ? all.map((x) => x[0]).filter((k) => v.includes(k)) : []);
/** Dawne „50+” zapisane w bazie czytamy jako „spokojne tempo” – o wiek już nie pytamy. */
const pickWho = (v: unknown): ForWhom[] => pick(FOR_WHOM, Array.isArray(v) ? v.map((w) => (w === 'senior' ? 'gentle' : w)) : v);

/** Czyści dane z formularza / bazy – nieznane wartości odpadają, braki dostają bezpieczne domyślne. */
export function cleanAudience(v: unknown, legacyLevel?: string | null): ClassAudience {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const level = CLASS_LEVELS.some(([k]) => k === o.level) ? (o.level as ClassLevel) : levelFromText(legacyLevel);
  return { level, focus: pick(FOCUS, o.focus), forWhom: pickWho(o.forWhom) };
}

export function cleanFit(v: unknown): ClassFit | null {
  const o = (v && typeof v === 'object' ? v : null) as Record<string, unknown> | null;
  if (!o || !FIT_LEVELS.some(([k]) => k === o.level)) return null;
  const base = { level: o.level as FitLevel, focus: pick(FOCUS, o.focus), forWhom: pickWho(o.forWhom) };
  if (!('from' in o) && Array.isArray(o.times)) return { ...base, ...fromLegacyTimes(o.times) };
  const days = Array.isArray(o.days) ? WEEK.map(([d]) => d).filter((d) => (o.days as unknown[]).includes(d)) : [];
  return { ...base, days: days.length === 7 ? [] : days, ...cleanWindow(o.from, o.to) };
}

/** Okno godzin z formularza: pełne pół godziny, w granicach dnia, co najmniej godzina. */
export function cleanWindow(from: unknown, to: unknown): { from: number; to: number } {
  const snap = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(DAY_TO, Math.max(DAY_FROM, Math.round(x / HOUR_STEP) * HOUR_STEP)) : d);
  const f = Math.min(snap(from, DAY_FROM), DAY_TO - MIN_WINDOW);
  return { from: f, to: Math.max(snap(to, DAY_TO), f + MIN_WINDOW) };
}

/** Pierwsza wersja ankiety: rano / lunch / wieczór / weekend → dni i jedno okno od najwcześniejszej do najpóźniejszej pory. */
function fromLegacyTimes(times: unknown[]): Pick<ClassFit, 'days' | 'from' | 'to'> {
  const span: Partial<Record<DayTime, [number, number]>> = { morning: [6 * 60, 11 * 60], noon: [11 * 60, 15 * 60], evening: [17 * 60, 22 * 60] };
  const parts = times.map((t) => span[t as DayTime]).filter((p): p is [number, number] => !!p);
  const onlyWeekend = times.length > 0 && times.every((t) => t === 'weekend');
  return {
    days: onlyWeekend ? [...WEEKEND] : [],
    from: parts.length ? Math.min(...parts.map((p) => p[0])) : DAY_FROM,
    to: parts.length ? Math.max(...parts.map((p) => p[1])) : DAY_TO,
  };
}

/** Typy zajęć sprzed tej funkcji mają poziom wpisany tekstem („podstawowy”, „średniozaawansowany”…). */
export function levelFromText(t?: string | null): ClassLevel {
  const s = (t ?? '').toLowerCase();
  if (/średn|sredn|mid/.test(s)) return 'intermediate';
  if (/począt|poczat|podstaw|basic|beginner/.test(s)) return 'beginner';
  if (/zaawans|advanced/.test(s)) return 'advanced';
  return 'all';
}

/** Czy klientka zawęziła dni albo godziny – bez tego pora nie wpływa na podpowiedzi. */
export const hasWhen = (fit: Pick<ClassFit, 'days' | 'from' | 'to'>) => fit.days.length > 0 || fit.from > DAY_FROM || fit.to < DAY_TO;

/** Czy zajęcia mieszczą się w czasie, który klientka ma dla siebie: właściwy dzień i całe zajęcia w oknie godzin. */
export function fitsWhen(fit: Pick<ClassFit, 'days' | 'from' | 'to'>, w: ClassWhen): boolean {
  if (fit.days.length && !fit.days.includes(w.weekday)) return false;
  return w.start >= fit.from && w.end <= fit.to;
}

const RANK: Record<FitLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };

/**
 * Jak bardzo zajęcia pasują do klientki. 0 lub mniej = nie podpowiadamy (zostają w „Reszcie zajęć”).
 * Ulubione zawsze trafiają do „Dopasowanych”, niezależnie od wyniku – o tym decyduje Grafik, nie ta funkcja.
 */
export function fitScore(a: ClassAudience, fit: ClassFit, when: ClassWhen): number {
  // Poza dniami i godzinami, które klientka sama podała, nie podpowiadamy – i tak by nie przyszła.
  const timed = hasWhen(fit);
  if (timed && !fitsWhen(fit, when)) return 0;
  // Zajęcia wyłącznie „specjalne” (np. tylko dla kobiet w ciąży) podpowiadamy tylko osobom, które to zaznaczyły.
  if (a.forWhom.length && a.forWhom.every((w) => EXCLUSIVE.includes(w)) && !a.forWhom.some((w) => fit.forWhom.includes(w))) return 0;

  let score = 0;
  // Poziom: początkująca nie dostaje zajęć dla zaawansowanych; „dla każdej” pasuje każdemu.
  if (a.level === 'all') score += 1;
  else {
    const gap = RANK[a.level] - RANK[fit.level];
    if (gap >= 2) return 0;
    score += gap === 0 ? 3 : gap === 1 ? 0 : -1;
  }
  score += 2 * a.focus.filter((f) => fit.focus.includes(f)).length;
  score += 3 * a.forWhom.filter((w) => fit.forWhom.includes(w)).length;
  if (timed) score += 1;
  return score;
}

/** Próg, od którego zajęcia lądują w „Dopasowanych do Ciebie”. */
export const FIT_THRESHOLD = 3;

const SHORT: Record<Focus | ForWhom, string> = {
  strength: 'siła',
  stretch: 'rozciąganie',
  calm: 'spokój',
  energy: 'energia',
  posture: 'kręgosłup',
  return: 'na powrót do ruchu',
  postnatal: 'po porodzie',
  pregnancy: 'w ciąży',
  back: 'zdrowe plecy',
  gentle: 'spokojne tempo',
};

/** Krótki powód pod tytułem karty, np. „dla początkujących · rozciąganie”. */
export function fitReason(a: ClassAudience, fit: ClassFit): string | null {
  const parts: string[] = [];
  const who = a.forWhom.find((w) => fit.forWhom.includes(w));
  if (who) parts.push(SHORT[who]);
  if (a.level !== 'all' && a.level === fit.level) parts.push(LEVEL_TEXT[a.level]);
  const f = a.focus.find((x) => fit.focus.includes(x));
  if (f) parts.push(SHORT[f]);
  return parts.length ? parts.slice(0, 2).join(' · ') : null;
}

/** Cel widoczny dla trenerki (memberships.goal) – tylko z celów ćwiczeń. „Dla kogo” zostaje prywatne, jak obiecuje ankieta. */
export function fitGoalLabel(fit: ClassFit): string | undefined {
  const labels = fit.focus.map((f) => FOCUS.find(([k]) => k === f)![1]);
  return labels.length ? labels.join(', ').slice(0, 120) : undefined;
}

/** Minuty od północy jako „17:30”. */
export const timeLabel = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
/** „17:00–21:00”, a całe okno – „o każdej porze”. */
export function windowLabel(fit: Pick<ClassFit, 'from' | 'to'>): string {
  return fit.from <= DAY_FROM && fit.to >= DAY_TO ? 'o każdej porze' : `${timeLabel(fit.from)}–${timeLabel(fit.to)}`;
}

/** „pn–pt”, „weekend”, „pn, śr, pt”, „każdy dzień”. */
export function daysLabel(days: number[]): string {
  const set = new Set(days);
  if (!set.size || set.size === 7) return 'każdy dzień';
  if (set.size === 5 && WORKDAYS.every((d) => set.has(d))) return 'pn–pt';
  if (set.size === 2 && WEEKEND.every((d) => set.has(d))) return 'weekend';
  return WEEK.filter(([d]) => set.has(d))
    .map(([, s]) => s)
    .join(', ');
}
