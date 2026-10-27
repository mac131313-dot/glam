// Mailing (recepcja i właścicielka – uprawnienie campaigns.edit): nowości e-mailem do klientek ze zgodą,
// test na własny adres, historia z otwarciami i automatyczny szablon „Nowe zajęcia w grafiku”.
import type { FastifyInstance } from 'fastify';
import { fillMail, MAIL_PREVIEW_VARS, MAIL_VARS, NEW_CLASS_MAIL } from '@glam/core';
import { ctx, requirePerm, type Deps } from '../context.ts';
import { badRequest, conflict } from '../errors.ts';
import { audit } from '../services/audit.ts';
import { checkMail, MAIL_FOOTER, mailRecipients, sendMail } from '../services/mailing.ts';

export function mailingRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const perm = requirePerm(db, 'campaigns.edit');

  app.get('/api/staff/mailing', perm, async (req) => {
    const { scope, studio } = ctx(req);
    const counts = scope.get<{ clients: number; with_email: number }>(
      `SELECT COUNT(*) AS clients, SUM(CASE WHEN u.email IS NOT NULL AND u.email != '' THEN 1 ELSE 0 END) AS with_email
       FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.studio_id = $studio AND m.role = 'client' AND u.deleted_at IS NULL`,
    )!;
    const history = scope.all<{ id: string; name: string; variants_json: string; sent_at: string | null; created_at: string; recipients: number; delivered: number; opened: number }>(
      `SELECT c.id, c.name, c.variants_json, c.sent_at, c.created_at,
              (SELECT COUNT(*) FROM notifications n WHERE n.studio_id = c.studio_id AND n.campaign_id = c.id) AS recipients,
              (SELECT COUNT(*) FROM notifications n WHERE n.studio_id = c.studio_id AND n.campaign_id = c.id AND n.pushed_at IS NOT NULL) AS delivered,
              (SELECT COUNT(*) FROM notifications n WHERE n.studio_id = c.studio_id AND n.campaign_id = c.id AND n.opened_at IS NOT NULL) AS opened
       FROM campaigns c WHERE c.studio_id = $studio AND c.channel = 'email' AND c.status = 'sent' ORDER BY c.sent_at DESC LIMIT 40`,
    );
    return {
      available: studio.has('campaigns'),
      studioName: studio.name,
      footer: MAIL_FOOTER,
      counts: { clients: counts.clients, withEmail: counts.with_email ?? 0, subscribed: mailRecipients(scope).length },
      auto: studio.settings.newClassMail,
      defaults: NEW_CLASS_MAIL,
      vars: MAIL_VARS,
      history: history.map(({ variants_json, ...h }) => {
        const v = (JSON.parse(variants_json) as { subject?: string; body: string }[])[0];
        return { ...h, auto: h.name.startsWith('Automat: '), subject: v?.subject ?? h.name, body: v?.body ?? '' };
      }),
    };
  });

  app.get<{ Querystring: { segment?: string } }>('/api/staff/mailing/audience', perm, async (req) => ({ count: mailRecipients(ctx(req).scope, req.query.segment || 'all').length }));

  app.post<{ Body: { subject: string; body: string; segment?: string; test?: boolean } }>('/api/staff/mailing/send', perm, async (req) => {
    const { scope, studio, user } = ctx(req);
    if (!studio.has('campaigns')) throw conflict('plan', 'Mailing jest w planie „Studio” i wyższych.');
    const subject = String(req.body?.subject ?? '').trim();
    const body = String(req.body?.body ?? '').trim();
    checkMail(subject, body);
    if (req.body.test) {
      const to = (db.prepare('SELECT email FROM users WHERE id = ?').get(user.id) as { email: string | null } | undefined)?.email;
      if (!to) throw badRequest('Dodaj swój e-mail w Profilu, żeby wysłać test.');
      const vars = { ...MAIL_PREVIEW_VARS, studio: studio.name, imię: user.name?.split(' ')[0] ?? '' };
      await deps.email?.send(to, `[TEST] ${fillMail(subject, vars)}`, `${fillMail(body, vars)}\n\n—\n${studio.name}\n${MAIL_FOOTER}`);
      return { message: `Test wysłany na ${to}.` };
    }
    const n = sendMail(scope, studio, { name: subject, subject, body, segment: req.body.segment || 'all', createdBy: user.id });
    audit(scope, { actorId: user.id, action: 'mailing.sent', entity: 'campaign', details: { recipients: n, segment: req.body.segment ?? 'all' } });
    return { message: n ? `Wysłane do ${n} ${n === 1 ? 'klientki' : 'klientek'}.` : 'Nikt w tej grupie nie ma jeszcze e-maila ze zgodą – nic nie wysłałyśmy.', recipients: n };
  });

  // Automatyczny e-mail o nowych zajęciach – zapis do ustawień studia (newClassMail).
  app.put<{ Body: { enabled?: boolean; subject?: string; body?: string } }>('/api/staff/mailing/auto', perm, async (req) => {
    const { scope, studio, user } = ctx(req);
    const b = req.body ?? {};
    const next = {
      enabled: b.enabled ?? studio.settings.newClassMail.enabled,
      subject: b.subject !== undefined ? String(b.subject).trim() : studio.settings.newClassMail.subject,
      body: b.body !== undefined ? String(b.body).trim() : studio.settings.newClassMail.body,
    };
    checkMail(next.subject, next.body);
    if (!next.body.includes('{zajęcia}')) throw badRequest('Szablon powinien zawierać {zajęcia} – inaczej klientka nie dowie się, co nowego.');
    const current = scope.get<{ settings_json: string | null }>('SELECT settings_json FROM studios WHERE id = $studio')!;
    const merged = { ...(current.settings_json ? JSON.parse(current.settings_json) : {}), newClassMail: next };
    scope.run('UPDATE studios SET settings_json = $s WHERE id = $studio', { s: JSON.stringify(merged) });
    audit(scope, { actorId: user.id, action: 'settings.updated', entity: 'studio', details: { keys: ['newClassMail'], enabled: next.enabled } });
    return { auto: next };
  });
}
