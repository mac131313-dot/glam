// Dyspozytor: wysyła na urządzenia powiadomienia, których czas nadszedł (także odroczone po ciszy nocnej),
// e-maile kampanii oraz SMS-y (tylko po zgodzie na SMS marketingowe). Kopie zapasowe bazy raz na dobę.
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { SERVICE_PRICES } from '@glam/core';
import type { Deps } from '../context.ts';
import { DATA_DIR, id, nowIso, type Db } from '../db.ts';

export async function dispatch(deps: Deps, now = new Date()) {
  const due = deps.db
    .prepare(
      `SELECT n.id, n.studio_id, n.user_id, n.body, n.title, n.action, n.channel, s.name AS studio_name, u.email, u.phone
       FROM notifications n JOIN studios s ON s.id = n.studio_id JOIN users u ON u.id = n.user_id
       WHERE n.status IN ('sent', 'deferred') AND n.pushed_at IS NULL AND n.deliver_at <= ? ORDER BY n.deliver_at LIMIT 200`,
    )
    .all(now.toISOString()) as { id: string; studio_id: string; user_id: string; body: string; title: string | null; action: string | null; channel: string; studio_name: string; email: string | null; phone: string }[];
  for (const n of due) {
    deps.db.prepare('UPDATE notifications SET pushed_at = ? WHERE id = ?').run(now.toISOString(), n.id);
    if (n.channel === 'email') {
      if (n.email && deps.email) await deps.email.send(n.email, n.title ?? n.studio_name, n.body);
      continue;
    }
    if (n.channel === 'sms') {
      await deps.sms.send(n.phone, `${n.studio_name}: ${n.body}`);
      logUsage(deps.db, n.studio_id, 'sms', 1, SERVICE_PRICES.smsGrosze);
      continue;
    }
    if (!deps.push) continue;
    const subs = deps.db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(n.user_id) as { endpoint: string; p256dh: string; auth: string }[];
    for (const sub of subs) {
      const res = await deps.push.send(sub, { title: n.title ?? n.studio_name, body: n.body, url: `/app?studio=${n.studio_id}${n.action ? `&go=${encodeURIComponent(n.action)}` : ''}` });
      if (res === 'gone') deps.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint);
    }
  }
  return due.length;
}

export function logUsage(db: Db, studioId: string | null, kind: string, units: number, costGrosze: number) {
  db.prepare('INSERT INTO usage_log (id, studio_id, kind, units, cost_grosze, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id(), studioId, kind, units, costGrosze * units, nowIso());
}

/** Kopia zapasowa (4.11) – spójny zrzut przez VACUUM INTO, trzymamy 14 ostatnich. */
export function backup(db: Db, dir = process.env.GLAM_BACKUP_DIR ?? join(DATA_DIR, 'backups'), now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `glam-${now.toISOString().slice(0, 10)}.db`);
  rmSync(file, { force: true });
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const all = readdirSync(dir).filter((f) => /^glam-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - 14))) rmSync(join(dir, old), { force: true });
  return file;
}
