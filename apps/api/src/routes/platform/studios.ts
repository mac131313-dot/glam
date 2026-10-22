// Studia na platformie (1.2): lista studiów z liczbami i monitoringiem, plany, status i okres próbny, feature flagi (T11),
// dostęp do danych studia za podaniem powodu z logiem (T7, T8) oraz ręczne uzupełnienie grafiku.
import type { FastifyInstance } from 'fastify';
import { FEATURE_LABEL, formatPLN, PLANS, planById, planUsage, TRIAL_DAYS, type Feature } from '@glam/core';
import type { Deps } from '../../context.ts';
import { id, nowIso, tx } from '../../db.ts';
import { badRequest, notFound } from '../../errors.ts';
import { StudioScope } from '../../scope.ts';
import { fillSchedule } from '../../services/schedule.ts';
import { studioAttention } from '../../services/attention.ts';
import { loadBilling, syncAccess } from '../../services/billing.ts';
import { loadStudio } from '../../services/studio.ts';
import { studioUsage } from '../../services/usage.ts';
import { platformAudit, requirePlatform } from './guard.ts';

export function studioRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const anyRole = requirePlatform(db);
  const adminOnly = requirePlatform(db, 'admin');
  const adminOrSupport = requirePlatform(db, 'admin', 'support');

  const FILTERS = ['trial', 'active', 'past_due', 'suspended'];
  const clearTrialMails = (studioId: string) => db.prepare('DELETE FROM platform_settings WHERE key IN (?, ?)').run(`trial-mail:${studioId}:5`, `trial-mail:${studioId}:1`);

  app.get<{ Querystring: { filter?: string } }>('/api/platform/studios', anyRole, async (req) => {
    const filter = req.query.filter;
    if (filter && !FILTERS.includes(filter)) throw badRequest('Nieznany filtr.');
    return (
      db
        .prepare(
          `SELECT s.id, s.name, s.city, s.status, s.plan_id, s.trial_ends_at, s.created_at, s.catalog_visible,
                  COALESCE(b.state, 'none') AS billing_state, b.past_due_since,
                  (SELECT COUNT(*) FROM memberships m WHERE m.studio_id = s.id AND m.role = 'client') AS clients,
                  (SELECT COUNT(*) FROM class_sessions c WHERE c.studio_id = s.id) AS sessions,
                  (SELECT COALESCE(SUM(units), 0) FROM usage_log u WHERE u.studio_id = s.id AND u.kind = 'sms' AND u.created_at >= date('now', 'start of month')) AS sms,
                  (SELECT COALESCE(SUM(cost_grosze), 0) FROM usage_log u WHERE u.studio_id = s.id AND u.created_at >= date('now', 'start of month')) AS costs,
                  (SELECT COALESCE(SUM(size), 0) FROM media x WHERE x.studio_id = s.id) AS storage,
                  (SELECT COALESCE(SUM(requests), 0) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS requests7d,
                  (SELECT COALESCE(SUM(errors), 0) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS errors7d,
                  (SELECT COALESCE(SUM(total_ms), 0) * 1.0 / MAX(1, SUM(requests)) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS avg_ms
           FROM studios s LEFT JOIN studio_billing b ON b.studio_id = s.id
           WHERE ${filter === 'past_due' ? "COALESCE(b.state, 'none') = 'past_due'" : filter ? 's.status = @filter' : '1 = 1'} ORDER BY s.name`,
        )
        .all(filter && filter !== 'past_due' ? { filter } : {}) as { id: string; plan_id: string | null; status: string; trial_ends_at: string | null; billing_state: string; past_due_since: string | null; costs: number; storage: number }[]
    ).map(({ billing_state, past_due_since, ...s }) => ({
      ...s,
      billingState: billing_state,
      signals: studioAttention(db, { ...s, billing_state, past_due_since }).map((a) => a.signal),
      plan: planById(s.plan_id).name,
      costs: formatPLN(s.costs),
      storageMb: Math.round(s.storage / 100_000) / 10,
      flags: Object.fromEntries((db.prepare('SELECT flag, enabled FROM studio_features WHERE studio_id = ?').all(s.id) as { flag: string; enabled: number }[]).map((f) => [f.flag, !!f.enabled])),
    }));
  });

  // Karta studia: firma, rozliczenia, zużycie planu, monitoring i dziennik – bez danych klientek (T7, T8).
  app.get<{ Params: { id: string } }>('/api/platform/studios/:id', anyRole, async (req) => {
    const studioId = req.params.id;
    const studio = db
      .prepare('SELECT id, name, slug, city, email, phone, nip, address, plan_id, status, trial_ends_at, published, catalog_visible, created_at FROM studios WHERE id = ?')
      .get(studioId) as { plan_id: string | null } | undefined;
    if (!studio) throw notFound();
    const metrics = db
      .prepare(
        `SELECT COALESCE(SUM(requests), 0) AS requests7d, COALESCE(SUM(errors), 0) AS errors7d,
                COALESCE(SUM(total_ms), 0) * 1.0 / MAX(1, SUM(requests)) AS avgMs
         FROM request_metrics WHERE studio_id = ? AND day >= date('now', '-7 day')`,
      )
      .get(studioId) as { requests7d: number; errors7d: number; avgMs: number };
    const usage = studioUsage(new StudioScope(db, studioId));
    return {
      studio,
      billing: loadBilling(db, studioId),
      usage: planUsage(usage, planById(studio.plan_id)),
      flags: Object.fromEntries((db.prepare('SELECT flag, enabled FROM studio_features WHERE studio_id = ?').all(studioId) as { flag: string; enabled: number }[]).map((f) => [f.flag, !!f.enabled])),
      metrics: { ...metrics, avgMs: Math.round(metrics.avgMs), storageMb: usage.storageMb },
      owner: db.prepare("SELECT u.name, u.phone, u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = ? AND m.role = 'owner' ORDER BY m.joined_at LIMIT 1").get(studioId) ?? null,
      audit: (
        db
          .prepare(
            `SELECT a.id, a.created_at, a.action, COALESCE(u.name, u.phone) AS actor, a.details_json FROM platform_audit a JOIN users u ON u.id = a.actor_id
             WHERE a.studio_id = ? ORDER BY a.created_at DESC, a.rowid DESC LIMIT 50`,
          )
          .all(studioId) as { details_json: string | null }[]
      ).map(({ details_json, ...e }) => ({ ...e, details: details_json ? JSON.parse(details_json) : null })),
    };
  });

  app.get('/api/platform/plans', async () => ({ plans: PLANS.map((p) => ({ ...p, price: formatPLN(p.priceGrosze), featureLabels: p.features.map((f) => FEATURE_LABEL[f]) })), features: FEATURE_LABEL, trialDays: TRIAL_DAYS }));

  // Zmiana planu. Status studia jest wyliczany z triala i rozliczeń (`syncAccess`), więc nie ustawia się go ręcznie.
  app.put<{ Params: { id: string }; Body: { planId?: string } }>('/api/platform/studios/:id', adminOnly, async (req) => {
    const b = req.body ?? {};
    if (b.planId && !PLANS.some((p) => p.id === b.planId)) throw badRequest('Nieznany plan.');
    const was = db.prepare('SELECT plan_id FROM studios WHERE id = ?').get(req.params.id) as { plan_id: string | null } | undefined;
    if (!was) throw notFound();
    tx(db, () => {
      db.prepare('UPDATE studios SET plan_id = COALESCE(?, plan_id) WHERE id = ?').run(b.planId ?? null, req.params.id);
      if (b.planId && b.planId !== was.plan_id) platformAudit(db, req.user!.id, 'studio.plan', req.params.id, { from: was.plan_id, to: b.planId });
    });
    return { ok: true };
  });

  // Ręczne zawieszenie (np. nieopłacone faktury poza Stripe): wygrywa z regułami rozliczeń, dopóki Admin go nie zdejmie.
  app.post<{ Params: { id: string }; Body: { reason: string } }>('/api/platform/studios/:id/suspend', adminOnly, async (req) => {
    const reason = String(req.body?.reason ?? '').trim();
    if (reason.length < 10) throw badRequest('Podaj powód zawieszenia (min. 10 znaków).');
    if (!db.prepare('SELECT 1 FROM studios WHERE id = ?').get(req.params.id)) throw notFound();
    tx(db, () => {
      loadBilling(db, req.params.id);
      db.prepare('UPDATE studio_billing SET manual_suspension = ?, updated_at = ? WHERE studio_id = ?').run(reason, nowIso(), req.params.id);
      platformAudit(db, req.user!.id, 'studio.suspend', req.params.id, { reason });
    });
    return { ok: true, status: await syncAccess(deps, req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/platform/studios/:id/unsuspend', adminOnly, async (req) => {
    if (!db.prepare('SELECT 1 FROM studios WHERE id = ?').get(req.params.id)) throw notFound();
    tx(db, () => {
      loadBilling(db, req.params.id);
      db.prepare('UPDATE studio_billing SET manual_suspension = NULL, updated_at = ? WHERE studio_id = ?').run(nowIso(), req.params.id);
      platformAudit(db, req.user!.id, 'studio.unsuspend', req.params.id);
    });
    return { ok: true, status: await syncAccess(deps, req.params.id) };
  });

  // Przedłużenie triala o `days` dni od późniejszej z dat: teraz albo obecny koniec triala.
  app.post<{ Params: { id: string }; Body: { days: number } }>('/api/platform/studios/:id/trial', adminOrSupport, async (req) => {
    const days = Number(req.body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 60) throw badRequest('Przedłuż trial o 1–60 dni.');
    const was = db.prepare('SELECT trial_ends_at FROM studios WHERE id = ?').get(req.params.id) as { trial_ends_at: string | null } | undefined;
    if (!was) throw notFound();
    const from = Math.max(Date.now(), was.trial_ends_at ? Date.parse(was.trial_ends_at) : 0);
    const to = new Date(from + days * 86_400_000).toISOString();
    tx(db, () => {
      db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(to, req.params.id);
      clearTrialMails(req.params.id); // nowy koniec triala = nowe przypomnienia
      platformAudit(db, req.user!.id, 'studio.trial', req.params.id, { from: was.trial_ends_at, to, days });
    });
    return { ok: true, trialEndsAt: to, status: await syncAccess(deps, req.params.id) };
  });

  // Studio rozliczane poza systemem (faktura, umowa): bez daty końca triala jest 'active', chyba że zawieszone ręcznie.
  app.post<{ Params: { id: string } }>('/api/platform/studios/:id/offline-billing', adminOnly, async (req) => {
    const was = db.prepare('SELECT trial_ends_at FROM studios WHERE id = ?').get(req.params.id) as { trial_ends_at: string | null } | undefined;
    if (!was) throw notFound();
    tx(db, () => {
      db.prepare('UPDATE studios SET trial_ends_at = NULL WHERE id = ?').run(req.params.id);
      clearTrialMails(req.params.id);
      platformAudit(db, req.user!.id, 'studio.offline_billing', req.params.id, { trialEndsAt: was.trial_ends_at });
    });
    return { ok: true, status: await syncAccess(deps, req.params.id) };
  });

  // Feature flagi per studio (T11): funkcje w becie tylko dla wybranych studiów. null = jak w planie.
  app.put<{ Params: { id: string }; Body: { flag: Feature; enabled: boolean | null } }>('/api/platform/studios/:id/flags', adminOnly, async (req) => {
    if (!(req.body?.flag in FEATURE_LABEL)) throw badRequest('Nieznana funkcja.');
    if (!db.prepare('SELECT 1 FROM studios WHERE id = ?').get(req.params.id)) throw notFound();
    tx(db, () => {
      if (req.body.enabled === null) db.prepare('DELETE FROM studio_features WHERE studio_id = ? AND flag = ?').run(req.params.id, req.body.flag);
      else db.prepare('INSERT OR REPLACE INTO studio_features (studio_id, flag, enabled) VALUES (?, ?, ?)').run(req.params.id, req.body.flag, Number(req.body.enabled));
      platformAudit(db, req.user!.id, 'studio.flag', req.params.id, { flag: req.body.flag, enabled: req.body.enabled });
    });
    return { ok: true };
  });

  app.post<{ Body: { studioId: string; reason: string } }>('/api/platform/access', adminOrSupport, async (req) => {
    const { studioId, reason } = req.body ?? ({} as { studioId: string; reason: string });
    if (!reason || reason.trim().length < 10) throw badRequest('Podaj uzasadnienie dostępu (zgłoszenie studia, min. 10 znaków).');
    if (!db.prepare('SELECT 1 FROM studios WHERE id = ?').get(studioId)) throw notFound();
    db.prepare('INSERT INTO platform_access_log (id, admin_user_id, studio_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(id(), req.user!.id, studioId, reason.trim(), nowIso());
    return { ok: true, logged: true };
  });

  app.get('/api/platform/access-log', adminOrSupport, async () =>
    db.prepare('SELECT l.created_at, l.reason, s.name AS studio, u.phone AS admin FROM platform_access_log l JOIN studios s ON s.id = l.studio_id JOIN users u ON u.id = l.admin_user_id ORDER BY l.created_at DESC LIMIT 100').all(),
  );

  // Uzupełnienie grafiku ręcznie z platformy (np. po migracji studia).
  app.post<{ Params: { id: string } }>('/api/platform/studios/:id/fill', adminOnly, async (req) => {
    return tx(db, () => {
      const result = fillSchedule(new StudioScope(db, req.params.id), loadStudio(db, req.params.id));
      platformAudit(db, req.user!.id, 'studio.fill', req.params.id, result);
      return result;
    });
  });
}
