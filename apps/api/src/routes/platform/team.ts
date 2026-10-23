// Zespół konsoli GLAM: kto jest kim (admin / wsparcie / finanse), zaproszenia, wyłączanie osób i wspólny dziennik działań.
import type { FastifyInstance } from 'fastify';
import { logoutAll, normalizePhone } from '../../auth.ts';
import type { Deps } from '../../context.ts';
import { id, nowIso, tx } from '../../db.ts';
import { HttpError, badRequest, notFound } from '../../errors.ts';
import { PLATFORM_ROLES, platformAudit, requirePlatform, type PlatformRole } from './guard.ts';

type StaffRow = { user_id: string; role: PlatformRole; disabled_at: string | null };

export function teamRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const anyRole = requirePlatform(deps);
  const adminOnly = requirePlatform(deps, 'admin');
  const adminOrSupport = requirePlatform(deps, 'admin', 'support');
  const isRole = (r: unknown): r is PlatformRole => PLATFORM_ROLES.includes(r as PlatformRole);
  const activeAdmins = () => (db.prepare("SELECT COUNT(*) AS n FROM platform_staff WHERE role = 'admin' AND disabled_at IS NULL").get() as { n: number }).n;

  app.get('/api/platform/me', anyRole, async (req) => ({ userId: req.user!.id, name: req.user!.name, role: req.platformRole! }));

  app.get('/api/platform/team', adminOnly, async () =>
    (db.prepare('SELECT s.user_id, u.name, u.phone, s.role, s.disabled_at FROM platform_staff s JOIN users u ON u.id = s.user_id ORDER BY s.created_at, u.name').all() as { user_id: string; name: string | null; phone: string; role: PlatformRole; disabled_at: string | null }[]).map(
      (m) => ({ userId: m.user_id, name: m.name, phone: m.phone, role: m.role, disabledAt: m.disabled_at }),
    ),
  );

  app.post<{ Body: { phone: string; name: string; role: PlatformRole } }>('/api/platform/team', adminOnly, async (req) => {
    const b = req.body ?? ({} as { phone: string; name: string; role: PlatformRole });
    const phone = normalizePhone(b.phone);
    const name = String(b.name ?? '').trim().slice(0, 80);
    if (!name) throw badRequest('Podaj imię osoby.');
    if (!isRole(b.role)) throw badRequest('Wybierz rolę: admin, wsparcie lub finanse.');
    const existing = db.prepare('SELECT id, name FROM users WHERE phone = ?').get(phone) as { id: string; name: string | null } | undefined;
    const staff = existing ? (db.prepare('SELECT user_id, role, disabled_at FROM platform_staff WHERE user_id = ?').get(existing.id) as StaffRow | undefined) : undefined;
    if (staff && !staff.disabled_at) throw new HttpError(409, 'already_member', 'Ta osoba jest już w zespole GLAM.');

    const userId = existing?.id ?? id();
    tx(db, () => {
      if (!existing) db.prepare('INSERT INTO users (id, phone, name, created_at) VALUES (?, ?, ?, ?)').run(userId, phone, name, nowIso());
      else if (!existing.name) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
      // Ponowne zaproszenie wyłączonej osoby przywraca ją z nową rolą.
      if (staff) db.prepare('UPDATE platform_staff SET role = ?, invited_by = ?, disabled_at = NULL WHERE user_id = ?').run(b.role, req.user!.id, userId);
      else db.prepare('INSERT INTO platform_staff (user_id, role, invited_by, created_at) VALUES (?, ?, ?, ?)').run(userId, b.role, req.user!.id, nowIso());
      platformAudit(db, req.user!.id, 'team.invite', null, { userId, role: b.role });
    });
    await deps.sms.send(phone, `GLAM: zaproszenie do konsoli zespołu GLAM. Zaloguj się tym numerem na ${deps.publicUrl ?? ''}/konsola.`);
    return { ok: true, userId };
  });

  app.put<{ Params: { userId: string }; Body: { role?: PlatformRole; disabled?: boolean } }>('/api/platform/team/:userId', adminOnly, async (req) => {
    const b = req.body ?? {};
    if (b.role !== undefined && !isRole(b.role)) throw badRequest('Wybierz rolę: admin, wsparcie lub finanse.');
    if (b.disabled !== undefined && typeof b.disabled !== 'boolean') throw badRequest('Nieprawidłowe zapytanie.');
    const target = db.prepare('SELECT user_id, role, disabled_at FROM platform_staff WHERE user_id = ?').get(req.params.userId) as StaffRow | undefined;
    if (!target) throw notFound();

    const role = b.role ?? target.role;
    const disabled = b.disabled ?? !!target.disabled_at;
    // Konsola musi mieć kogoś, kto zarządza zespołem: odmowa, gdyby po zmianie nie został żaden aktywny admin.
    const wasActiveAdmin = target.role === 'admin' && !target.disabled_at;
    const staysActiveAdmin = role === 'admin' && !disabled;
    if (wasActiveAdmin && !staysActiveAdmin && activeAdmins() <= 1) throw badRequest('To ostatni administrator konsoli. Najpierw nadaj tę rolę komuś innemu.');

    tx(db, () => {
      if (role !== target.role) {
        db.prepare('UPDATE platform_staff SET role = ? WHERE user_id = ?').run(role, target.user_id);
        platformAudit(db, req.user!.id, 'team.role', null, { userId: target.user_id, from: target.role, to: role });
      }
      if (disabled && !target.disabled_at) {
        db.prepare('UPDATE platform_staff SET disabled_at = ? WHERE user_id = ?').run(nowIso(), target.user_id);
        logoutAll(db, target.user_id);
        platformAudit(db, req.user!.id, 'team.disable', null, { userId: target.user_id });
      } else if (!disabled && target.disabled_at) {
        db.prepare('UPDATE platform_staff SET disabled_at = NULL WHERE user_id = ?').run(target.user_id);
        platformAudit(db, req.user!.id, 'team.enable', null, { userId: target.user_id });
      }
    });
    return { ok: true };
  });

  // Dziennik: działania zespołu (`platform_audit`) i wejścia w dane studia z powodem (`platform_access_log`), od najnowszych.
  app.get('/api/platform/audit', adminOrSupport, async () =>
    (
      db
        .prepare(
          `SELECT * FROM (
             SELECT a.id, a.created_at, a.action, COALESCE(u.name, u.phone) AS actor, a.studio_id, s.name AS studio, a.details_json
             FROM platform_audit a JOIN users u ON u.id = a.actor_id LEFT JOIN studios s ON s.id = a.studio_id
             UNION ALL
             SELECT l.id, l.created_at, 'studio.access', COALESCE(u.name, u.phone), l.studio_id, s.name, json_object('reason', l.reason)
             FROM platform_access_log l JOIN users u ON u.id = l.admin_user_id JOIN studios s ON s.id = l.studio_id
           ) ORDER BY created_at DESC LIMIT 200`,
        )
        .all() as { id: string; created_at: string; action: string; actor: string; studio_id: string | null; studio: string | null; details_json: string | null }[]
    ).map(({ details_json, ...e }) => ({ ...e, details: details_json ? JSON.parse(details_json) : null })),
  );
}
