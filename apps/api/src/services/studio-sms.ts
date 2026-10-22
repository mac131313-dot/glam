// Jedyna droga SMS-ów w imieniu studia. SMS kosztuje GLAM prawdziwe pieniądze, więc – inaczej niż pozostałe
// limity planu – pula SMS na miesiąc jest twarda: po jej wyczerpaniu nic nie wychodzi i nic nie jest liczone.
import { planById, SERVICE_PRICES, smsAllowed } from '@glam/core';
import type { Deps } from '../context.ts';
import { StudioScope } from '../scope.ts';
import { logUsage } from './dispatch.ts';
import { smsUsedThisMonth } from './usage.ts';

/** Czy pula SMS studia na bieżący miesiąc pozwala jeszcze na jedną wiadomość (do wcześniejszej odmowy, zanim ujawnimy cokolwiek o numerze). */
export const studioSmsAvailable = (deps: Deps, studio: { id: string; plan_id: string | null }): boolean =>
  smsAllowed(smsUsedThisMonth(new StudioScope(deps.db, studio.id)), planById(studio.plan_id));

/** Wysyła SMS i zapisuje zużycie; `false` (bez wysyłki), gdy pula planu na bieżący miesiąc jest wyczerpana. */
export async function sendStudioSms(deps: Deps, studio: { id: string; plan_id: string | null }, phone: string, text: string): Promise<boolean> {
  if (!studioSmsAvailable(deps, studio)) return false;
  await deps.sms.send(phone, text);
  logUsage(deps.db, studio.id, 'sms', 1, SERVICE_PRICES.smsGrosze);
  return true;
}
