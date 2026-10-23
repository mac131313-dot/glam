// Zużycie planu studia (aktywne klientki, SMS, wideo, zespół, obiekty) – wspólne dla panelu właścicielki i konsoli GLAM.
import type { Usage } from '@glam/core';
import type { StudioScope } from '../scope.ts';
import { clientFacts } from './segments.ts';

const DAY_MS = 86_400_000;

/** SMS-y studia od początku bieżącego miesiąca (UTC) – jedna definicja dla paska zużycia i twardego limitu. */
export function smsUsedThisMonth(scope: StudioScope, now = new Date()): number {
  return scope.get<{ n: number }>("SELECT COALESCE(SUM(units), 0) AS n FROM usage_log WHERE studio_id = $studio AND kind = 'sms' AND created_at >= $m", { m: `${now.toISOString().slice(0, 7)}-01` })!.n;
}

/** Aktywna klientka = wizyta w ostatnich 30 dniach; SMS liczone od początku bieżącego miesiąca. */
export function studioUsage(scope: StudioScope, now = new Date()): Usage {
  const activeClients = clientFacts(scope, now).filter((f) => f.lastVisit && now.getTime() - Date.parse(f.lastVisit) < 30 * DAY_MS).length;
  const smsThisMonth = smsUsedThisMonth(scope, now);
  const storage = scope.get<{ b: number }>('SELECT COALESCE(SUM(size), 0) AS b FROM media WHERE studio_id = $studio')!.b;
  const staff = scope.get<{ n: number }>("SELECT COUNT(DISTINCT user_id) AS n FROM memberships WHERE studio_id = $studio AND role != 'client'")!.n;
  const facilities = scope.get<{ n: number }>('SELECT COUNT(*) AS n FROM facilities WHERE studio_id = $studio')!.n;
  return { activeClients, smsThisMonth, storageMb: Math.round(storage / 100_000) / 10, staff, facilities };
}
