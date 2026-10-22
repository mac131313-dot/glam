// Studia na platformie (1.2): lista studiów z liczbami i monitoringiem, plany, status i okres próbny, feature flagi (T11),
// dostęp do danych studia za podaniem powodu z logiem (T7, T8) oraz ręczne uzupełnienie grafiku.
import type { FastifyInstance } from 'fastify';
import { FEATURE_LABEL, formatPLN, PLANS, planById, TRIAL_DAYS, type Feature } from '@glam/core';
import type { Deps } from '../../context.ts';
import { id, nowIso, tx } from '../../db.ts';
import { badRequest, notFound } from '../../errors.ts';
import { StudioScope } from '../../scope.ts';
import { fillSchedule } from '../../services/schedule.ts';
import { loadStudio } from '../../services/studio.ts';
import { platformAudit, requirePlatform } from './guard.ts';

export function studioRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const anyRole = requirePlatform(db);
  const adminOnly = requirePlatform(db, 'admin');
  const adminOrSupport = requirePlatform(db, 'admin', 'support');

  app.get('/api/platform/studios', anyRole, async () =>
    (
      db
        .prepare(
          `SELECT s.id, s.name, s.city, s.status, s.plan_id, s.trial_ends_at, s.created_at, s.catalog_visible,
                  (SELECT COUNT(*) FROM memberships m WHERE m.studio_id = s.id AND m.role = 'client') AS clients,
                  (SELECT COUNT(*) FROM class_sessions c WHERE c.studio_id = s.id) AS sessions,
                  (SELECT COALESCE(SUM(units), 0) FROM usage_log u WHERE u.studio_id = s.id AND u.kind = 'sms' AND u.created_at >= date('now', 'start of month')) AS sms,
                  (SELECT COALESCE(SUM(cost_grosze), 0) FROM usage_log u WHERE u.studio_id = s.id AND u.created_at >= date('now', 'start of month')) AS costs,
                  (SELECT COALESCE(SUM(size), 0) FROM media x WHERE x.studio_id = s.id) AS storage,
                  (SELECT COALESCE(SUM(requests), 0) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS requests7d,
                  (SELECT COALESCE(SUM(errors), 0) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS errors7d,
                  (SELECT COALESCE(SUM(total_ms), 0) * 1.0 / MAX(1, SUM(requests)) FROM request_metrics r WHERE r.studio_id = s.id AND r.day >= date('now', '-7 day')) AS avg_ms
           FROM studios s ORDER BY s.name`,
        )
        .all() as { id: string; plan_id: string | null; costs: number; storage: number }[]
    ).map((s) => ({
      ...s,
      plan: planById(s.plan_id).name,
      costs: formatPLN(s.costs),
      storageMb: Math.round(s.storage / 100_000) / 10,
      flags: Object.fromEntries((db.prepare('SELECT flag, enabled FROM studio_features WHERE studio_id = ?').all(s.id) as { flag: string; enabled: number }[]).map((f) => [f.flag, !!f.enabled])),
    })),
  );

  app.get('/api/platform/plans', async () => ({ plans: PLANS.map((p) => ({ ...p, price: formatPLN(p.priceGrosze), featureLabels: p.features.map((f) => FEATURE_LABEL[f]) })), features: FEATURE_LABEL, trialDays: TRIAL_DAYS }));

  app.put<{ Params: { id: string }; Body: { planId?: string; status?: 'trial' | 'active' | 'suspended'; trialEndsAt?: string | null } }>('/api/platform/studios/:id', adminOnly, async (req) => {
    const b = req.body ?? {};
    if (b.planId && !PLANS.some((p) => p.id === b.planId)) throw badRequest('Nieznany plan.');
    if (b.status && !['trial', 'active', 'suspended'].includes(b.status)) throw badRequest('Nieznany status.');
    const was = db.prepare('SELECT plan_id, status, trial_ends_at FROM studios WHERE id = ?').get(req.params.id) as { plan_id: string | null; status: string; trial_ends_at: string | null } | undefined;
    if (!was) throw notFound();
    tx(db, () => {
      db.prepare('UPDATE studios SET plan_id = COALESCE(?, plan_id), status = COALESCE(?, status), trial_ends_at = COALESCE(?, trial_ends_at) WHERE id = ?').run(b.planId ?? null, b.status ?? null, b.trialEndsAt ?? null, req.params.id);
      if (b.planId && b.planId !== was.plan_id) platformAudit(db, req.user!.id, 'studio.plan', req.params.id, { from: was.plan_id, to: b.planId });
      if (b.status && b.status !== was.status) platformAudit(db, req.user!.id, 'studio.status', req.params.id, { from: was.status, to: b.status });
      if (b.trialEndsAt && b.trialEndsAt !== was.trial_ends_at) platformAudit(db, req.user!.id, 'studio.trial', req.params.id, { from: was.trial_ends_at, to: b.trialEndsAt });
    });
    return { ok: true };
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
  app.post<{ Params: { id: string } }>('/api/platform/studios/:id/fill', adminOnly, async (req) => fillSchedule(new StudioScope(db, req.params.id), loadStudio(db, req.params.id)));
}
