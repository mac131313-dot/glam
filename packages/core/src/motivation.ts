// Motywacja bez presji (4.4, 4.5, 4.7, 4.12.3): cel tygodnia, odznaki i serie, poziomy lojalności,
// nagroda po 10. zajęciach, ramki profilu. Żadnych rankingów i porównań z innymi (sekcja 10).
import { addDays, weekStart } from './time.ts';
import { plural } from './copy.ts';

// ——— Cel tygodnia: „3 treningi + 2 medytacje” ———

export type WeekGoal = { trainings: number; mindful: number };
export const DEFAULT_WEEK_GOAL: WeekGoal = { trainings: 3, mindful: 2 };

export function weekGoalMessage(goal: WeekGoal, done: { trainings: number; mindful: number }, restDay: boolean): string {
  if (restDay) return 'Dziś odpoczywasz. Cel tygodnia poczeka.';
  const left = Math.max(0, goal.trainings - done.trainings) + Math.max(0, goal.mindful - done.mindful);
  if (left === 0) return 'Cel tygodnia zrealizowany. Dobrze, że dbasz o siebie.';
  if (done.trainings + done.mindful === 0) return 'Każdy tydzień to nowy start.';
  if (left === 1) return 'Jesteś blisko. Bez presji.';
  return 'Jesteś w drodze. W swoim tempie.';
}

// ——— Seria: kolejne tygodnie z co najmniej jednym treningiem ———

/** Liczba kolejnych tygodni (licząc wstecz od bieżącego lub poprzedniego) z aktywnością. */
export function weeklyStreak(activityDates: string[], today: string): number {
  const weeks = new Set(activityDates.map((d) => weekStart(d)));
  let cursor = weekStart(today);
  if (!weeks.has(cursor)) cursor = addDays(cursor, -7); // bieżący tydzień jeszcze trwa – nie przerywa serii
  let n = 0;
  while (weeks.has(cursor)) {
    n++;
    cursor = addDays(cursor, -7);
  }
  return n;
}

// ——— Odznaki ———

export type BadgeDef = { code: string; name: string; description: string; icon: string; limited?: { from: string; to: string }; hidden?: boolean };

export const BADGES: BadgeDef[] = [
  { code: 'first_class', name: 'Pierwszy trening', description: 'Pierwsze zajęcia za Tobą.', icon: 'spark' },
  { code: 'ten_classes', name: '10 treningów', description: 'Dziesięć zajęć w studiu.', icon: 'ten' },
  { code: 'fifty_classes', name: '50 treningów', description: 'Pięćdziesiąt zajęć. Piękna regularność.', icon: 'star' },
  { code: 'streak_4', name: 'Seria 4 tygodni', description: 'Cztery tygodnie z ruchem z rzędu.', icon: 'wave' },
  { code: 'streak_12', name: 'Seria 12 tygodni', description: 'Trzy miesiące rytmu.', icon: 'wave' },
  { code: 'friend', name: 'Przyprowadziłaś koleżankę', description: 'Znajoma przyszła na pierwszy trening.', icon: 'heart' },
  { code: 'first_month', name: 'Pierwszy miesiąc', description: 'Miesiąc z nami.', icon: 'moon' },
  { code: 'first_meditation', name: 'Pierwsza medytacja', description: 'Chwila tylko dla siebie.', icon: 'leaf' },
  { code: 'calm_7', name: '7 dni spokoju', description: 'Ukończony mini-kurs.', icon: 'leaf' },
  { code: 'journal_7', name: 'Tydzień z dziennikiem', description: 'Siedem wpisów w dzienniku.', icon: 'pen' },
  { code: 'week_goal', name: 'Cel tygodnia', description: 'Zrealizowany cel tygodnia.', icon: 'check' },
  { code: 'challenge', name: 'Wyzwanie ukończone', description: 'Ukończone wyzwanie studia.', icon: 'flag' },
  { code: 'course', name: 'Kurs ukończony', description: 'Ukończony kurs online.', icon: 'cap' },
  { code: 'event', name: 'Wydarzeniowa', description: 'Wydarzenie w studiu za Tobą.', icon: 'gift' },
  { code: 'anniversary', name: 'Rok z nami', description: 'Rocznica pierwszego treningu.', icon: 'star' },
  { code: 'ghost', name: 'Duch studia', description: 'Halloween w studiu.', icon: 'season', limited: { from: '10-25', to: '11-01' } },
  { code: 'mikolajki', name: 'Mikołajkowa', description: 'Mikołajki w studiu.', icon: 'gift', limited: { from: '12-01', to: '12-07' } },
  { code: 'patriotka', name: 'Patriotka formy', description: '11 listopada na wspólnym treningu.', icon: 'flag', limited: { from: '11-08', to: '11-12' } },
  { code: 'women_power', name: 'Kobieca siła', description: 'Wyzwanie na Dzień Kobiet.', icon: 'flower', limited: { from: '03-01', to: '03-15' } },
  { code: 'breath_october', name: 'Październik oddechowy', description: 'Wyzwanie oddechowe.', icon: 'wave', limited: { from: '10-01', to: '10-31' } },
];

export const badgeByCode = (code: string) => BADGES.find((b) => b.code === code);

/** Odznaka limitowana: dostępna tylko w swoim okresie (MM-DD, także przez nowy rok), potem w archiwum. */
export function badgeAvailable(b: BadgeDef, today: string): boolean {
  if (!b.limited) return true;
  const md = today.slice(5);
  const { from, to } = b.limited;
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

export type BadgeStats = {
  attended: number;
  streakWeeks: number;
  daysSinceJoin: number;
  mindfulSessions: number;
  journalEntries: number;
  calmCourseDone: boolean;
  friendsBrought: number;
};

/** Odznaki należne na podstawie statystyk (bez limitowanych – te przyznają wyzwania). */
export function earnedBadges(s: BadgeStats): string[] {
  const out: string[] = [];
  if (s.attended >= 1) out.push('first_class');
  if (s.attended >= 10) out.push('ten_classes');
  if (s.attended >= 50) out.push('fifty_classes');
  if (s.streakWeeks >= 4) out.push('streak_4');
  if (s.streakWeeks >= 12) out.push('streak_12');
  if (s.daysSinceJoin >= 30 && s.attended >= 1) out.push('first_month');
  if (s.daysSinceJoin >= 365 && s.attended >= 1) out.push('anniversary');
  if (s.mindfulSessions >= 1) out.push('first_meditation');
  if (s.journalEntries >= 7) out.push('journal_7');
  if (s.calmCourseDone) out.push('calm_7');
  if (s.friendsBrought >= 1) out.push('friend');
  return out;
}

// ——— Lojalność: punkty i poziomy Start → Flow → Queen ———

export type Level = { id: string; name: string; minPoints: number };

export function levelFor(points: number, levels: Level[]): { current: Level; next: Level | null; toNext: number } {
  const sorted = [...levels].sort((a, b) => a.minPoints - b.minPoints);
  let current = sorted[0];
  for (const l of sorted) if (points >= l.minPoints) current = l;
  const next = sorted.find((l) => l.minPoints > points) ?? null;
  return { current, next, toNext: next ? next.minPoints - points : 0 };
}

// ——— Nagroda po 10. zajęciach (4.8.2, S5) ———

/** „Do nagrody zostały 3 treningi” – liczą się tylko zrealizowane zajęcia. */
export function rewardCounter(attended: number, every: number): { left: number; milestone: number; reached: number } {
  const reached = Math.floor(attended / every);
  const left = every - (attended % every);
  return { left, milestone: (reached + 1) * every, reached };
}

export function rewardCounterCopy(left: number): string {
  return `Do nagrody ${plural(left, 'został', 'zostały', 'zostało')} ${left} ${plural(left, 'trening', 'treningi', 'treningów')}`;
}

// ——— Ramki i ozdoby profilu (4.12.3, G4) ———

export type Frame = { id: string; name: string; unlock: { badge?: string; level?: string } | null; style: string };

export const FRAMES: Frame[] = [
  { id: 'none', name: 'Bez ramki', unlock: null, style: 'none' },
  { id: 'hairline', name: 'Cienka linia', unlock: null, style: 'hairline' },
  { id: 'spark', name: 'Iskra', unlock: { badge: 'first_class' }, style: 'dashed' },
  { id: 'ten', name: 'Dziesiątka', unlock: { badge: 'ten_classes' }, style: 'double' },
  { id: 'wave', name: 'Fala', unlock: { badge: 'streak_4' }, style: 'ring' },
  { id: 'flow', name: 'Flow', unlock: { level: 'flow' }, style: 'brand' },
  { id: 'queen', name: 'Queen', unlock: { level: 'queen' }, style: 'gold' },
  { id: 'leaf', name: 'Liść', unlock: { badge: 'first_meditation' }, style: 'soft' },
  { id: 'heart', name: 'Serce', unlock: { badge: 'friend' }, style: 'accent' },
];

export function unlockedFrames(input: { badges: string[]; levelId: string; levels: Level[] }): string[] {
  const rank = (id: string) => input.levels.findIndex((l) => l.id === id);
  return FRAMES.filter((f) => {
    if (!f.unlock) return true;
    if (f.unlock.badge) return input.badges.includes(f.unlock.badge);
    if (f.unlock.level) return rank(input.levelId) >= rank(f.unlock.level) && rank(f.unlock.level) >= 0;
    return false;
  }).map((f) => f.id);
}
