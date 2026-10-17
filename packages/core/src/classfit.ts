// „Dopasowane do Ciebie”: dla kogo są zajęcia (ustawia studio przy typie zajęć) i co klientka zaznaczyła
// w krótkiej ankiecie po pierwszym logowaniu. Z obu powstaje wynik dopasowania – karuzela w Grafiku.

export type FitLevel = 'beginner' | 'intermediate' | 'advanced';
export type ClassLevel = FitLevel | 'all';
export type Focus = 'strength' | 'stretch' | 'calm' | 'energy' | 'posture';
export type ForWhom = 'return' | 'postnatal' | 'pregnancy' | 'back' | 'gentle';
export type DayTime = 'morning' | 'noon' | 'evening' | 'weekend';

/** Ustawiane w panelu przy typie zajęć. */
export type ClassAudience = { level: ClassLevel; focus: Focus[]; forWhom: ForWhom[] };
/** Odpowiedzi klientki z ankiety (prefs.classFit). */
export type ClassFit = { level: FitLevel; focus: Focus[]; forWhom: ForWhom[]; times: DayTime[] };

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
  const times: [DayTime][] = [['morning'], ['noon'], ['evening'], ['weekend']];
  return { level: o.level as FitLevel, focus: pick(FOCUS, o.focus), forWhom: pickWho(o.forWhom), times: pick(times, o.times) };
}

/** Typy zajęć sprzed tej funkcji mają poziom wpisany tekstem („podstawowy”, „średniozaawansowany”…). */
export function levelFromText(t?: string | null): ClassLevel {
  const s = (t ?? '').toLowerCase();
  if (/średn|sredn|mid/.test(s)) return 'intermediate';
  if (/począt|poczat|podstaw|basic|beginner/.test(s)) return 'beginner';
  if (/zaawans|advanced/.test(s)) return 'advanced';
  return 'all';
}

/** Pora zajęć w języku ankiety (godzina i dzień tygodnia w strefie studia). */
export function dayTimesOf(hour: number, weekday: number): DayTime[] {
  const out: DayTime[] = [];
  if (weekday === 0 || weekday === 6) out.push('weekend');
  if (hour < 11) out.push('morning');
  else if (hour < 15) out.push('noon');
  else if (hour >= 17) out.push('evening');
  return out;
}

const RANK: Record<FitLevel, number> = { beginner: 0, intermediate: 1, advanced: 2 };

/**
 * Jak bardzo zajęcia pasują do klientki. 0 lub mniej = nie podpowiadamy (zostają w „Reszcie zajęć”).
 * Ulubione zawsze trafiają do „Dopasowanych”, niezależnie od wyniku – o tym decyduje Grafik, nie ta funkcja.
 */
export function fitScore(a: ClassAudience, fit: ClassFit, times: DayTime[]): number {
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
  if (fit.times.length && times.some((t) => fit.times.includes(t))) score += 1;
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
