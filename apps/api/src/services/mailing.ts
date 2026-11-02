// Mailing studia: nowości wysyłane ręcznie (recepcja / właścicielka) i automatyczny e-mail o nowych zajęciach.
// Każdy e-mail to wpis w campaigns (historia, statystyka) + powiadomienia kanału „email” – samą wysyłkę robi
// dyspozytor, a zgody (marketing_email), limity dzienne i ciche godziny pilnuje notify().
import { fillMail, moderate, MODERATION_COPY } from '@glam/core';
import { id } from '../db.ts';
import { badRequest } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { hasConsent, notify } from './notify.ts';
import { audience } from './segments.ts';
import type { Studio } from './studio.ts';

export const MAIL_FOOTER = 'Dostajesz tę wiadomość, bo zgodziłaś się na e-maile od studia. Wyłączysz je w aplikacji: Profil → Zgody.';

export type Recipient = { id: string; name: string | null; email: string };

/** Klientki z adresem e-mail i zgodą na e-mail marketingowy – opcjonalnie z jednego segmentu. */
export function mailRecipients(scope: StudioScope, segment = 'all', now = new Date()): Recipient[] {
  const ids = new Set(audience(scope, segment, now));
  return scope
    .all<Recipient>(
      `SELECT u.id, u.name, u.email FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.studio_id = $studio AND m.role = 'client' AND u.deleted_at IS NULL AND u.email IS NOT NULL AND u.email != ''`,
    )
    .filter((u) => ids.has(u.id) && hasConsent(scope, u.id, 'marketing_email'));
}

export function checkMail(subject: string, body: string) {
  if (!subject.trim()) throw badRequest('Dodaj temat e-maila.');
  if (subject.length > 120) throw badRequest('Temat może mieć do 120 znaków.');
  const m = moderate(body, { allowLinks: true, maxLength: 4000 });
  if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
  if (/musisz|ostatnia szansa|tylko dziś|straciłaś|zaległości/i.test(`${subject} ${body}`)) throw badRequest('Bez presji: unikaj „musisz”, „ostatnia szansa”, „straciłaś” (sekcja 10).');
}

/** Wysyła e-mail do odbiorczyń; zmienne ({imię}, {studio}, …) wypełniamy osobno dla każdej. Zwraca liczbę adresatek. */
export function sendMail(
  scope: StudioScope,
  studio: Studio,
  mail: { name: string; subject: string; body: string; segment?: string; vars?: Record<string, string>; createdBy: string | null },
  now = new Date(),
) {
  const recipients = mailRecipients(scope, mail.segment ?? 'all', now);
  const cid = id();
  scope.tx(() => {
    scope.run(
      `INSERT INTO campaigns (id, studio_id, name, channel, segment, variants_json, status, sent_at, created_by, created_at)
       VALUES ($id, $studio, $n, 'email', $seg, $v, 'sent', $now, $by, $now)`,
      { id: cid, n: mail.name.slice(0, 80), seg: mail.segment ?? 'all', v: JSON.stringify([{ id: 'A', subject: mail.subject, body: mail.body }]), by: mail.createdBy, now: now.toISOString() },
    );
    for (const r of recipients) {
      const vars = { studio: studio.name, ...mail.vars, imię: r.name?.split(' ')[0] ?? '' };
      notify(scope, {
        userId: r.id,
        category: 'marketing',
        channel: 'email',
        tz: studio.timezone,
        now,
        title: fillMail(mail.subject, vars),
        body: `${fillMail(mail.body, vars)}\n\n—\n${studio.name}\n${MAIL_FOOTER}`,
        campaignId: cid,
        variant: 'A',
        dedupeKey: `mail:${cid}`,
      });
    }
  });
  return recipients.length;
}

/**
 * Automat „Nowe zajęcia w grafiku”: po dodaniu zajęć cyklicznych albo pojedynczych (okolicznościowych, live)
 * wysyła szablon ze studia. Zajęcia niepubliczne i studio bez planu z kampaniami e-mail – bez wysyłki.
 */
export function announceNewClass(scope: StudioScope, studio: Studio, input: { classTypeId: string; trainerId: string; termin: string; title?: string | null; actorId: string | null }, now = new Date()) {
  const tpl = studio.settings.newClassMail;
  if (!tpl.enabled || !studio.has('campaigns')) return 0;
  const ct = scope.get<{ name: string }>('SELECT name FROM class_types WHERE studio_id = $studio AND id = $id', { id: input.classTypeId });
  const trainer = scope.db.prepare('SELECT name FROM users WHERE id = ?').get(input.trainerId) as { name: string | null } | undefined;
  const zajecia = input.title?.trim() || ct?.name || 'Zajęcia';
  return sendMail(
    scope,
    studio,
    { name: `Automat: ${zajecia}`, subject: tpl.subject, body: tpl.body, vars: { zajęcia: zajecia, termin: input.termin, trenerka: trainer?.name?.split(' ')[0] ?? 'nasza trenerka' }, createdBy: input.actorId },
    now,
  );
}
