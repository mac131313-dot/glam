// Zasady powiadomień (sekcja 8 i 8.1): każdy typ osobno wyłączalny, ciche godziny 22–7
// dla niekrytycznych, max 2 marketingowe i 1 „dla mnie” dziennie, max 1 okolicznościowa,
// „Potrzebuję ciszy” wstrzymuje okolicznościowe.
import { DEFAULT_TZ, addDays, localParts, toMinutes, zonedToUtc } from './time.ts';

export type PushCategory =
  | 'transactional'
  | 'wellbeing'
  | 'motivation'
  | 'community'
  | 'courses'
  | 'theme'
  | 'loyalty'
  | 'reactivation'
  | 'marketing'
  | 'shop'
  | 'events'
  | 'occasional';

/** Kategorie liczone do wspólnego limitu „marketingowych”. */
const MARKETING_GROUP: PushCategory[] = ['marketing', 'theme', 'reactivation', 'shop'];

const DAILY_LIMITS: { categories: PushCategory[]; max: number }[] = [
  { categories: MARKETING_GROUP, max: 2 },
  { categories: ['wellbeing'], max: 1 },
  { categories: ['occasional'], max: 1 },
];

export type PushPrefs = {
  disabled: PushCategory[];
  needQuiet: boolean;
  quietFrom: string;
  quietTo: string;
};

export const DEFAULT_PUSH_PREFS: PushPrefs = { disabled: [], needQuiet: false, quietFrom: '22:00', quietTo: '07:00' };

export type PushDecision =
  | { send: true }
  | { send: false; reason: 'disabled' | 'need_quiet' | 'daily_limit' }
  | { send: false; reason: 'quiet_hours'; deferUntil: Date };

export function pushDecision(input: {
  category: PushCategory;
  now: Date;
  prefs: PushPrefs;
  sentToday: Partial<Record<PushCategory, number>>;
  tz?: string;
}): PushDecision {
  const { category, now, prefs, sentToday } = input;
  const tz = input.tz ?? DEFAULT_TZ;

  // Transakcyjne (zmiana sali, odwołanie zajęć, zwolnione miejsce) dochodzą zawsze.
  if (category === 'transactional') return { send: true };
  if (prefs.disabled.includes(category)) return { send: false, reason: 'disabled' };
  if (category === 'occasional' && prefs.needQuiet) return { send: false, reason: 'need_quiet' };

  for (const limit of DAILY_LIMITS) {
    if (!limit.categories.includes(category)) continue;
    const used = limit.categories.reduce((n, c) => n + (sentToday[c] ?? 0), 0);
    if (used >= limit.max) return { send: false, reason: 'daily_limit' };
  }

  const lp = localParts(now, tz);
  const from = toMinutes(prefs.quietFrom);
  const to = toMinutes(prefs.quietTo);
  const inQuiet = from > to ? lp.minutes >= from || lp.minutes < to : lp.minutes >= from && lp.minutes < to;
  if (inQuiet) {
    const deferDate = from > to && lp.minutes >= from ? addDays(lp.date, 1) : lp.date;
    return { send: false, reason: 'quiet_hours', deferUntil: zonedToUtc(deferDate, prefs.quietTo, tz) };
  }
  return { send: true };
}
