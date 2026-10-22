// Rozliczenia abonamentu GLAM: stan z `studio_billing` i jedyne miejsce, które ustawia `studios.status`
// (`syncAccess`). Wołają je webhook Stripe, konsola (zawieszenie, trial) i dzienny job.
import { accessFromBilling, type AccessStatus, type BillingFacts, type BillingState } from '@glam/core';
import type { Deps } from '../context.ts';
import { nowIso, type Db } from '../db.ts';

export type BillingRow = {
  studio_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  state: BillingState;
  current_period_end: string | null;
  past_due_since: string | null;
  cancel_at_period_end: number;
  pending_plan_id: string | null;
  manual_suspension: string | null;
  company_name: string | null;
  nip: string | null;
  address: string | null;
  invoice_email: string | null;
  updated_at: string;
};

const DAY_MS = 86_400_000;
/** Na ile dni przed końcem triala przypominamy właścicielce. */
const TRIAL_REMINDER_DAYS = [5, 1] as const;

/** Wiersz rozliczeń studia; dla studia bez wiersza (starsze, demo) zakłada stan `none`. */
export function loadBilling(db: Db, studioId: string): BillingRow {
  db.prepare("INSERT OR IGNORE INTO studio_billing (studio_id, state, updated_at) VALUES (?, 'none', ?)").run(studioId, nowIso());
  return db.prepare('SELECT * FROM studio_billing WHERE studio_id = ?').get(studioId) as BillingRow;
}

const toFacts = (row: BillingRow): BillingFacts => ({ state: row.state, currentPeriodEnd: row.current_period_end, pastDueSince: row.past_due_since, manualSuspension: row.manual_suspension });

const ownerEmails = (db: Db, studioId: string) =>
  (db.prepare("SELECT DISTINCT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? AND m.role = 'owner' AND u.email IS NOT NULL").all(studioId) as { email: string }[]).map((r) => r.email);

/** E-mail do właścicielek studia; błąd wysyłki tylko w logu (nie przerywa rozliczeń). */
export async function mailOwners(deps: Deps, studioId: string, subject: string, body: string) {
  for (const to of ownerEmails(deps.db, studioId)) {
    try {
      await deps.email?.send(to, subject, body);
    } catch (err) {
      console.error(`e-mail do właścicielki (${studioId})`, err);
    }
  }
}

/**
 * Przelicza dostęp studia z triala i rozliczeń i zapisuje `studios.status`, gdy się zmienił.
 * Przy przejściu w `suspended` wysyła właścicielce e-mail. Zwraca wyliczony status.
 */
export async function syncAccess(deps: Deps, studioId: string, now = new Date()): Promise<AccessStatus> {
  const { db } = deps;
  const studio = db.prepare('SELECT name, status, trial_ends_at FROM studios WHERE id = ?').get(studioId) as { name: string; status: AccessStatus; trial_ends_at: string | null } | undefined;
  if (!studio) throw new Error(`Nie ma studia ${studioId}`);
  const status = accessFromBilling(studio.trial_ends_at, toFacts(loadBilling(db, studioId)), now);
  if (status === studio.status) return status;
  db.prepare('UPDATE studios SET status = ? WHERE id = ?').run(status, studioId);
  if (status === 'suspended') {
    await mailOwners(
      deps,
      studioId,
      `Studio ${studio.name} zostało zawieszone`,
      `Dostęp klientek do studia ${studio.name} w GLAM jest wstrzymany. Ty nadal wchodzisz do panelu: ${deps.publicUrl ?? ''}/panel – tam sprawdzisz abonament, a po uregulowaniu płatności dostęp wróci.`,
    );
  }
  return status;
}

/** Dzienny job: przelicza dostęp wszystkich studiów i wysyła przypomnienia 5 i 1 dzień przed końcem triala. */
export async function billingJobs(deps: Deps, now: Date): Promise<void> {
  const studios = deps.db.prepare('SELECT id FROM studios').all() as { id: string }[];
  for (const { id: studioId } of studios) {
    try {
      if ((await syncAccess(deps, studioId, now)) === 'trial') await trialReminder(deps, studioId, now);
    } catch (err) {
      console.error(`rozliczenia (${studioId})`, err);
    }
  }
}

/** Jedno przypomnienie na próg; przy progu już przeskoczonym (np. 1 dzień triala od początku) wcześniejsze uznajemy za wysłane. */
async function trialReminder(deps: Deps, studioId: string, now: Date) {
  const { db } = deps;
  const row = db.prepare('SELECT trial_ends_at FROM studios WHERE id = ?').get(studioId) as { trial_ends_at: string | null };
  if (!row.trial_ends_at || loadBilling(db, studioId).state === 'active') return; // karta już dodana – nie ma o czym przypominać
  const left = (Date.parse(row.trial_ends_at) - now.getTime()) / DAY_MS;
  if (left <= 0) return;
  const due = TRIAL_REMINDER_DAYS.filter((n) => left <= n);
  const next = due[due.length - 1];
  if (next === undefined || db.prepare('SELECT 1 FROM platform_settings WHERE key = ?').get(`trial-mail:${studioId}:${next}`)) return;
  await mailOwners(
    deps,
    studioId,
    next === 1 ? 'Okres próbny w GLAM kończy się jutro' : `Okres próbny w GLAM kończy się za ${next} dni`,
    `Okres próbny Twojego studia kończy się ${row.trial_ends_at.slice(0, 10)}. Żeby klientki nadal mogły korzystać z aplikacji, dodaj kartę w panelu: ${deps.publicUrl ?? ''}/panel (Abonament). Bez opłaconego abonamentu studio zostanie zawieszone.`,
  );
  for (const n of due) db.prepare('INSERT OR IGNORE INTO platform_settings (key, value) VALUES (?, ?)').run(`trial-mail:${studioId}:${n}`, now.toISOString());
}
