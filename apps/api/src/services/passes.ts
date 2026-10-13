import { activationValidity, isUsedUp, localParts, weekStart, type Pass, type PassStatus, type ProductRules } from '@glam/core';
import { id, nowIso } from '../db.ts';
import type { StudioScope } from '../scope.ts';

export type PassRow = {
  id: string;
  user_id: string;
  product_version_id: string | null;
  product_name: string;
  rules_json: string;
  balances_json: string;
  valid_from: string;
  valid_until: string;
  status: PassStatus | 'pending';
  source: string;
  auto_renew: number;
  frozen_until: string | null;
  freezes_used: number;
  freeze_days_used: number;
  guests_used_json: string;
  activated_at: string | null;
  created_at: string;
};

export function toPass(row: PassRow, now = new Date()): Pass {
  const expired = row.status === 'active' && Date.parse(row.valid_until) < now.getTime();
  return {
    id: row.id,
    productName: row.product_name,
    rules: JSON.parse(row.rules_json) as ProductRules,
    balances: JSON.parse(row.balances_json) as Record<string, number>,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    status: expired ? 'expired' : row.status === 'pending' ? 'frozen' : row.status,
    activatedAt: row.activated_at,
    guestsUsed: JSON.parse(row.guests_used_json || '{}'),
  };
}

export function loadPasses(scope: StudioScope, userId: string, now = new Date()): Pass[] {
  return scope.all<PassRow>("SELECT * FROM passes WHERE studio_id = $studio AND user_id = $user AND status != 'pending' ORDER BY valid_until", { user: userId }).map((r) => toPass(r, now));
}

export function passRows(scope: StudioScope, userId: string): PassRow[] {
  return scope.all<PassRow>('SELECT * FROM passes WHERE studio_id = $studio AND user_id = $user ORDER BY created_at DESC', { user: userId });
}

export function loadPass(scope: StudioScope, passId: string): Pass | undefined {
  const row = scope.get<PassRow>('SELECT * FROM passes WHERE studio_id = $studio AND id = $id', { id: passId });
  return row && toPass(row);
}

function saveBalances(scope: StudioScope, pass: Pass) {
  const status: PassStatus = pass.status === 'active' || pass.status === 'used' ? (isUsedUp(pass) ? 'used' : 'active') : pass.status;
  scope.run('UPDATE passes SET balances_json = $b, status = $s WHERE studio_id = $studio AND id = $id', {
    b: JSON.stringify(pass.balances),
    s: status,
    id: pass.id,
  });
}

/** Zdjęcie wejścia; karnet „od aktywacji” przy pierwszym wejściu dostaje ważność liczoną od dnia zajęć. */
export function consumeEntry(scope: StudioScope, pass: Pass, poolId: string | null, sessionStart?: Date) {
  if (pass.rules.validFrom === 'activation' && !pass.activatedAt && sessionStart) {
    const v = activationValidity(pass.rules, sessionStart);
    scope.run('UPDATE passes SET valid_from = $f, valid_until = $u, activated_at = $now WHERE studio_id = $studio AND id = $id', { f: v.validFrom, u: v.validUntil, now: nowIso(), id: pass.id });
    pass.validFrom = v.validFrom;
    pass.validUntil = v.validUntil;
    pass.activatedAt = nowIso();
  }
  if (poolId === null) return; // dostęp czasowy – nic nie odejmujemy
  pass.balances[poolId] = (pass.balances[poolId] ?? 0) - 1;
  saveBalances(scope, pass);
}

export function refundEntry(scope: StudioScope, passId: string | null, poolId: string | null) {
  if (!passId || poolId === null) return;
  const pass = loadPass(scope, passId);
  if (!pass) return;
  pass.balances[poolId] = (pass.balances[poolId] ?? 0) + 1;
  if (pass.status === 'used') pass.status = 'active';
  saveBalances(scope, pass);
}

// ——— Wejście z gościem (C8): limit miesięczny z reguł produktu ———

const monthKey = (at: Date, tz: string) => localParts(at, tz).date.slice(0, 7);

export function guestAllowance(pass: Pass, at: Date, tz: string): number {
  const limit = pass.rules.guestsPerMonth ?? 0;
  return Math.max(0, limit - (pass.guestsUsed?.[monthKey(at, tz)] ?? 0));
}

export function useGuestAllowance(scope: StudioScope, pass: Pass, at: Date, tz: string) {
  const used = { ...(pass.guestsUsed ?? {}) };
  const k = monthKey(at, tz);
  used[k] = (used[k] ?? 0) + 1;
  scope.run('UPDATE passes SET guests_used_json = $g WHERE studio_id = $studio AND id = $id', { g: JSON.stringify(used), id: pass.id });
}

export function returnGuestAllowance(scope: StudioScope, passId: string | null, at: Date, tz: string) {
  if (!passId) return;
  const pass = loadPass(scope, passId);
  if (!pass) return;
  const used = { ...(pass.guestsUsed ?? {}) };
  const k = monthKey(at, tz);
  if (used[k]) used[k]--;
  scope.run('UPDATE passes SET guests_used_json = $g WHERE studio_id = $studio AND id = $id', { g: JSON.stringify(used), id: pass.id });
}

/** Ile wejść tym karnetem w dniu / tygodniu zajęć – do limitów dziennych i tygodniowych. */
export function usageFor(scope: StudioScope, passId: string, startsAt: Date, tz: string) {
  const rows = scope.all<{ starts_at: string }>(
    `SELECT s.starts_at FROM bookings b JOIN class_sessions s ON s.id = b.session_id
     WHERE b.studio_id = $studio AND b.pass_id = $pass AND b.status IN ('booked', 'attended', 'late_cancel') AND b.guest_name IS NULL`,
    { pass: passId },
  );
  const target = localParts(startsAt, tz);
  const targetWeek = weekStart(target.date);
  let day = 0;
  let week = 0;
  for (const r of rows) {
    const lp = localParts(new Date(r.starts_at), tz);
    if (lp.date === target.date) day++;
    if (weekStart(lp.date) === targetWeek) week++;
  }
  return { day, week };
}

/** Wystawia karnet z kopią reguł (C5). Wspólne dla zakupu, kasy, poleceń, nagród i odnowień. */
export function issuePass(
  scope: StudioScope,
  input: { userId: string; versionId: string | null; name: string; rules: ProductRules; validFrom: string; validUntil: string; source: PassRow['source']; balances: Record<string, number>; autoRenew?: boolean; status?: 'active' | 'pending' },
) {
  const passId = id();
  scope.run(
    `INSERT INTO passes (id, studio_id, user_id, product_version_id, product_name, rules_json, balances_json, valid_from, valid_until, status, source, auto_renew, created_at)
     VALUES ($id, $studio, $user, $ver, $name, $rules, $bal, $from, $until, $status, $source, $auto, $now)`,
    {
      id: passId,
      user: input.userId,
      ver: input.versionId,
      name: input.name,
      rules: JSON.stringify(input.rules),
      bal: JSON.stringify(input.balances),
      from: input.validFrom,
      until: input.validUntil,
      status: input.status ?? 'active',
      source: input.source,
      auto: input.autoRenew ? 1 : 0,
      now: nowIso(),
    },
  );
  return passId;
}
