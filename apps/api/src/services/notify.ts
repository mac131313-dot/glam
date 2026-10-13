// Skrzynka powiadomień + decyzja „czy wysłać teraz” (core/push.ts). Zapis do tabeli notifications;
// samą wysyłkę na urządzenie (Web Push / APNs / FCM) i e-mail robi dyspozytor (services/dispatch.ts),
// więc notify() można bezpiecznie wołać w transakcji.
import { DEFAULT_PUSH_PREFS, localParts, pushDecision, type OccasionToggle, type PushCategory } from '@glam/core';
import { id } from '../db.ts';
import type { StudioScope } from '../scope.ts';

export type NotifyInput = {
  userId: string;
  category: PushCategory;
  body: string;
  tz: string;
  now?: Date;
  title?: string;
  /** Dokąd prowadzi kliknięcie w aplikacji, np. „schedule”, „profile/passes”, „survey/dormant”. */
  action?: string;
  /** Jedno powiadomienie danego rodzaju na osobę (np. „class_24h:<booking>”). */
  dedupeKey?: string;
  /** Okolicznościowe: osobny wyłącznik per typ (8.1.1). */
  occasion?: OccasionToggle;
  channel?: 'push' | 'email' | 'sms';
  campaignId?: string;
  variant?: string;
};

type UserPrefs = { need_quiet: number; push_disabled_json: string; quiet_from: string; quiet_to: string; prefs_json: string | null };

export function notify(scope: StudioScope, input: NotifyInput) {
  const now = input.now ?? new Date();
  // Limity dzienne dotyczą osoby, nie studia – liczymy jej własne powiadomienia ze wszystkich studiów.
  // To agregat danych samej klientki, więc świadomie idziemy obok StudioScope.
  const user = scope.db.prepare('SELECT need_quiet, push_disabled_json, quiet_from, quiet_to, prefs_json FROM users WHERE id = ?').get(input.userId) as UserPrefs | undefined;
  if (!user) return;
  if (input.dedupeKey && scope.get('SELECT 1 FROM notifications WHERE studio_id = $studio AND user_id = $u AND dedupe_key = $k', { u: input.userId, k: input.dedupeKey })) return;

  const today = localParts(now, input.tz).date;
  const sentRows = scope.db
    .prepare("SELECT category, deliver_at FROM notifications WHERE user_id = ? AND status = 'sent' AND deliver_at >= ?")
    .all(input.userId, new Date(now.getTime() - 36 * 3_600_000).toISOString()) as { category: PushCategory; deliver_at: string }[];
  const sentToday: Partial<Record<PushCategory, number>> = {};
  for (const r of sentRows) {
    if (localParts(new Date(r.deliver_at), input.tz).date === today) sentToday[r.category] = (sentToday[r.category] ?? 0) + 1;
  }

  const prefs = user.prefs_json ? (JSON.parse(user.prefs_json) as { occasionsOff?: string[] }) : {};
  let decision = pushDecision({
    category: input.category,
    now,
    tz: input.tz,
    sentToday,
    prefs: { ...DEFAULT_PUSH_PREFS, needQuiet: !!user.need_quiet, disabled: JSON.parse(user.push_disabled_json), quietFrom: user.quiet_from, quietTo: user.quiet_to },
  });
  if (decision.send && input.occasion && prefs.occasionsOff?.includes(input.occasion)) decision = { send: false, reason: 'disabled' };
  // Kampanie marketingowe tylko za zgodą (sekcja 11: opt-in).
  if (decision.send && input.category === 'marketing' && !hasConsent(scope, input.userId, 'marketing')) decision = { send: false, reason: 'disabled' };

  const status = decision.send ? 'sent' : decision.reason === 'quiet_hours' ? 'deferred' : 'suppressed';
  const deliverAt = !decision.send && decision.reason === 'quiet_hours' ? decision.deferUntil : now;
  scope.run(
    `INSERT OR IGNORE INTO notifications (id, studio_id, user_id, category, body, title, action, status, reason, channel, campaign_id, variant, dedupe_key, deliver_at, created_at)
     VALUES ($id, $studio, $user, $category, $body, $title, $action, $status, $reason, $channel, $campaign, $variant, $dedupe, $deliver, $now)`,
    {
      id: id(),
      user: input.userId,
      category: input.category,
      body: input.body,
      title: input.title ?? null,
      action: input.action ?? null,
      status,
      reason: decision.send ? null : decision.reason,
      channel: input.channel ?? 'push',
      campaign: input.campaignId ?? null,
      variant: input.variant ?? null,
      dedupe: input.dedupeKey ?? null,
      deliver: deliverAt.toISOString(),
      now: now.toISOString(),
    },
  );
  return decision;
}

export function hasConsent(scope: StudioScope, userId: string, kind: string): boolean {
  const row = scope.db.prepare("SELECT granted FROM consents WHERE user_id = ? AND kind = ? AND studio_id IN (?, '') ORDER BY studio_id DESC").get(userId, kind, scope.studioId) as
    | { granted: number }
    | undefined;
  return !!row?.granted;
}
