// Help desk i status usług (1.2.11): zgłoszenia właścicielek z SLA widziane po stronie platformy i studia,
// incydenty oraz publiczna strona statusu.
import type { FastifyInstance } from 'fastify';
import { ctx, requireStudio, type Deps } from '../../context.ts';
import { id, nowIso, tx } from '../../db.ts';
import { badRequest, notFound } from '../../errors.ts';
import { platformAudit, requirePlatform } from './guard.ts';

/** SLA odpowiedzi help desku wg priorytetu (1.2.11). */
export const SLA_HOURS: Record<string, number> = { urgent: 2, high: 8, normal: 24, low: 72 };

export function supportRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const desk = requirePlatform(deps, 'admin', 'support');

  // ——— Help desk platformy dla właścicielek (1.2.11) z SLA ———

  app.get('/api/platform/tickets', desk, async () =>
    db
      .prepare(
        `SELECT t.*, s.name AS studio, u.name AS author, (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = t.id) AS messages,
                CASE WHEN t.status = 'open' AND t.sla_due_at < ? THEN 1 ELSE 0 END AS overdue
         FROM support_tickets t JOIN studios s ON s.id = t.studio_id JOIN users u ON u.id = t.author_id ORDER BY t.status = 'closed', t.sla_due_at`,
      )
      .all(nowIso()),
  );

  app.get<{ Params: { id: string } }>('/api/platform/tickets/:id', desk, async (req) => ({
    ticket: db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(req.params.id),
    messages: db.prepare('SELECT m.body, m.from_platform, m.created_at, u.name FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at').all(req.params.id),
  }));

  app.post<{ Params: { id: string }; Body: { body: string; close?: boolean } }>('/api/platform/tickets/:id', desk, async (req) => {
    const t = db.prepare('SELECT studio_id, author_id FROM support_tickets WHERE id = ?').get(req.params.id) as { studio_id: string; author_id: string } | undefined;
    if (!t) throw notFound();
    tx(db, () => {
      if (req.body?.body?.trim()) db.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, from_platform, body, created_at) VALUES (?, ?, ?, 1, ?, ?)').run(id(), req.params.id, req.user!.id, req.body.body.trim(), nowIso());
      db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(req.body?.close ? 'closed' : 'answered', nowIso(), req.params.id);
      platformAudit(db, req.user!.id, 'ticket.reply', t.studio_id, { ticketId: req.params.id, closed: !!req.body?.close });
    });
    return { ok: true };
  });

  // Strona statusu usług (1.2.11).
  app.post<{ Body: { component: string; status: 'degraded' | 'outage' | 'maintenance'; note: string } }>('/api/platform/incidents', desk, async (req) => {
    if (!['degraded', 'outage', 'maintenance'].includes(req.body?.status) || !req.body.note?.trim()) throw badRequest('Podaj komponent, status i opis.');
    const incidentId = id();
    tx(db, () => {
      db.prepare('INSERT INTO status_incidents (id, component, status, note, started_at) VALUES (?, ?, ?, ?, ?)').run(incidentId, req.body.component, req.body.status, req.body.note.trim(), nowIso());
      platformAudit(db, req.user!.id, 'incident.open', null, { component: req.body.component, status: req.body.status });
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/platform/incidents/:id/resolve', desk, async (req) => {
    tx(db, () => {
      if (!db.prepare('UPDATE status_incidents SET resolved_at = ? WHERE id = ?').run(nowIso(), req.params.id).changes) throw notFound();
      platformAudit(db, req.user!.id, 'incident.resolve', null, { incidentId: req.params.id });
    });
    return { ok: true };
  });

  app.get('/api/status', async () => {
    const components = ['Aplikacja', 'Rezerwacje', 'Płatności', 'Powiadomienia', 'SMS'];
    const open = db.prepare('SELECT * FROM status_incidents WHERE resolved_at IS NULL ORDER BY started_at DESC').all() as { component: string; status: string }[];
    return {
      components: components.map((c) => ({ name: c, status: open.find((i) => i.component === c)?.status ?? 'operational' })),
      incidents: db.prepare("SELECT id, component, status, note, started_at, resolved_at FROM status_incidents WHERE started_at >= date('now', '-30 day') ORDER BY started_at DESC").all(),
    };
  });

  // ——— Strona studia: zgłoszenia do platformy ———

  const owner = { preHandler: requireStudio(db, ['owner']) };
  app.get('/api/owner/tickets', owner, async (req) => {
    const { scope } = ctx(req);
    return scope.all<{ id: string }>('SELECT * FROM support_tickets WHERE studio_id = $studio ORDER BY updated_at DESC').map((t) => ({
      ...t,
      messages: db.prepare('SELECT m.body, m.from_platform, m.created_at, u.name FROM ticket_messages m JOIN users u ON u.id = m.author_id WHERE m.ticket_id = ? ORDER BY m.created_at').all(t.id),
    }));
  });

  app.post<{ Body: { subject: string; body: string; priority?: 'low' | 'normal' | 'high' | 'urgent'; grantDataAccess?: boolean } }>('/api/owner/tickets', owner, async (req) => {
    const { scope, user } = ctx(req);
    const b = req.body;
    if (!b?.subject?.trim() || !b.body?.trim()) throw badRequest('Podaj temat i opis.');
    const priority = ['low', 'normal', 'high', 'urgent'].includes(b.priority ?? '') ? b.priority! : 'normal';
    const tid = id();
    tx(db, () => {
      scope.run("INSERT INTO support_tickets (id, studio_id, author_id, subject, priority, status, sla_due_at, data_access_granted, created_at, updated_at) VALUES ($id, $studio, $u, $s, $p, 'open', $sla, $g, $now, $now)", {
        id: tid,
        u: user.id,
        s: b.subject.trim().slice(0, 120),
        p: priority,
        sla: new Date(Date.now() + SLA_HOURS[priority] * 3_600_000).toISOString(),
        g: Number(!!b.grantDataAccess),
        now: nowIso(),
      });
      db.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, from_platform, body, created_at) VALUES (?, ?, ?, 0, ?, ?)').run(id(), tid, user.id, b.body.trim().slice(0, 5000), nowIso());
    });
    return { id: tid, slaHours: SLA_HOURS[priority] };
  });

  app.post<{ Params: { id: string }; Body: { body: string } }>('/api/owner/tickets/:id', owner, async (req) => {
    const { scope, user } = ctx(req);
    if (!scope.get('SELECT 1 FROM support_tickets WHERE studio_id = $studio AND id = $id', { id: req.params.id })) throw notFound();
    db.prepare('INSERT INTO ticket_messages (id, ticket_id, author_id, from_platform, body, created_at) VALUES (?, ?, ?, 0, ?, ?)').run(id(), req.params.id, user.id, String(req.body?.body ?? '').trim().slice(0, 5000), nowIso());
    db.prepare("UPDATE support_tickets SET status = 'open', updated_at = ? WHERE id = ?").run(nowIso(), req.params.id);
    return { ok: true };
  });
}
