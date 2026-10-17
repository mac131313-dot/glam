// Jedna skrzynka „Wiadomości”: wszystkie rozmowy osoby na jednej liście, od najświeższej.
// Trzy źródła mają osobne tabele (chat_messages – recepcja, trainer_messages – „Napisz do trenerki”,
// group_chat – czaty grup) i osobne widoki rozmowy; tu tylko je zbieramy do wspólnego kształtu.
import type { FastifyInstance } from 'fastify';
import { can, type Role } from '@glam/core';
import { ctx, isStaff, requireStudio, type Deps } from '../context.ts';
import { forbidden } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { receptionThreadOf, receptionThreads } from '../services/chat.ts';
import type { Studio } from '../services/studio.ts';
import { groupList } from './community.ts';
import { dmThreads, isTrainer } from './dm.ts';

export type ThreadKind = 'reception' | 'dm' | 'group';
export type Thread = {
  kind: ThreadKind;
  /** Recepcja u klientki: „reception”; w panelu – id klientki. DM: id drugiej strony. Grupa: id grupy. */
  id: string;
  name: string;
  unread: number;
  last: { body: string; author: string | null; at: string } | null;
  /** Grupy: liczba osób i opiekunka. */
  members?: number;
  trainer?: string | null;
  /** Panel: czy to rozmowa tej osoby (jej grupa, jej klientka) – tylko takie liczą się do licznika w menu. */
  mine?: boolean;
};

/** Od najświeższej rozmowy; rozmowy bez wiadomości (np. pusta recepcja) na końcu. */
const byLast = (a: Thread, b: Thread) => (b.last?.at ?? '').localeCompare(a.last?.at ?? '');

/** Skrzynka klientki: recepcja (zawsze – żeby było gdzie napisać), trenerki, do których pisała, i jej grupy. */
export function clientThreads(scope: StudioScope, studio: Studio, userId: string) {
  const r = receptionThreadOf(scope, userId);
  const reception: Thread = {
    kind: 'reception',
    id: 'reception',
    name: 'Recepcja',
    unread: r.unread,
    last: r.last_at ? { body: r.last_body ?? '', author: r.last_staff ? null : 'Ty', at: r.last_at } : null,
  };
  const dms: Thread[] = dmThreads(scope, 'client', userId).map((t) => ({ kind: 'dm', ...t }));
  const groups: Thread[] = studio.has('community')
    ? groupList(scope, userId, 'studio')
        .filter((g) => g.joined)
        .map((g) => ({ kind: 'group', id: g.id, name: g.name, unread: g.unread, last: g.last, members: g.members, trainer: g.trainer }))
    : [];
  const threads = [reception, ...dms, ...groups].sort(byLast);
  return { threads, unread: threads.reduce((n, t) => n + t.unread, 0) };
}

/** Skrzynka panelu – widoczność według uprawnień: recepcja (chat.answer), prywatne od klientek (trenerka), grupy (opiekunka / moderacja). */
export function staffThreads(scope: StudioScope, studio: Studio, roles: readonly Role[], userId: string) {
  const reception: Thread[] = can(roles, 'chat.answer')
    ? receptionThreads(scope).map((t) => ({ kind: 'reception', id: t.client_id, name: t.name, unread: t.unread, last: { body: t.last_body ?? '', author: null, at: t.last_at }, mine: true }))
    : [];
  const dms: Thread[] = isTrainer(scope, userId) ? dmThreads(scope, 'trainer', userId).map((t) => ({ kind: 'dm', ...t, mine: true })) : [];
  const moderator = can(roles, 'community.moderate');
  const groups: Thread[] =
    studio.has('community') && (moderator || can(roles, 'messages.group.own'))
      ? groupList(scope, userId, moderator ? 'all' : 'trainer').map((g) => ({
          kind: 'group',
          id: g.id,
          name: g.name,
          unread: g.unread,
          last: g.last,
          members: g.members,
          trainer: g.trainer,
          mine: g.mine || !!g.joined,
        }))
      : [];
  const threads = [...reception, ...dms, ...groups].sort(byLast);
  // Moderacja widzi wszystkie grupy studia, ale licznik w menu liczy tylko jej własne rozmowy.
  return { threads, unread: threads.reduce((n, t) => n + (t.mine ? t.unread : 0), 0) };
}

export function threadRoutes(app: FastifyInstance, deps: Deps) {
  const member = { preHandler: requireStudio(deps.db) };

  app.get('/api/threads', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    return clientThreads(scope, studio, user.id);
  });

  app.get('/api/staff/threads', member, async (req) => {
    const { scope, studio, user, roles } = ctx(req);
    if (!isStaff(roles)) throw forbidden();
    return staffThreads(scope, studio, roles, user.id);
  });
}
