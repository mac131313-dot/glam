// Sygnały „wymaga uwagi” dla studiów w konsoli GLAM (trial na finiszu, zaległa płatność, przekroczony limit planu):
// wspólne dla listy studiów i przeglądu „Dziś”, żeby oba pokazywały to samo.
import { localParts, planById, planUsage } from '@glam/core';
import type { Db } from '../db.ts';
import { StudioScope } from '../scope.ts';
import { studioUsage } from './usage.ts';

export type Signal = 'trial_ending' | 'past_due' | 'over_limit';
export type Attention = { signal: Signal; hint: string };
export type AttentionInput = { id: string; plan_id: string | null; status: string; trial_ends_at: string | null; billing_state: string; past_due_since: string | null };

const DAY_MS = 86_400_000;

/** „30.10” – dzień i miesiąc w czasie lokalnym platformy. */
export const shortDate = (iso: string) => {
  const [, month, day] = localParts(new Date(iso)).date.split('-');
  return `${day}.${month}`;
};

/** Sygnały studia z krótkim polskim kontekstem (`hint`). Zużycie planu liczone raz na studio. */
export function studioAttention(db: Db, s: AttentionInput, now = new Date()): Attention[] {
  const out: Attention[] = [];
  const left = s.trial_ends_at ? Date.parse(s.trial_ends_at) - now.getTime() : null;
  if (s.status === 'trial' && s.trial_ends_at && left !== null && left > 0 && left <= 7 * DAY_MS) out.push({ signal: 'trial_ending', hint: `trial do ${shortDate(s.trial_ends_at)}` });
  if (s.billing_state === 'past_due') out.push({ signal: 'past_due', hint: s.past_due_since ? `zaległość od ${shortDate(s.past_due_since)}` : 'zaległa płatność' });
  const over = planUsage(studioUsage(new StudioScope(db, s.id), now), planById(s.plan_id)).filter((u) => u.state === 'over');
  if (over.length) out.push({ signal: 'over_limit', hint: `limit: ${over.map((u) => u.label).join(', ')}` });
  return out;
}
