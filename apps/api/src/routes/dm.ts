// „Napisz do trenerki”: prywatna rozmowa klientka ↔ trenerka. Widzą ją tylko te dwie osoby (bez recepcji
// i właścicielki). Rozmowę zaczyna klientka – trenerka odpowiada, ale nie pisze pierwsza do kogoś, kto się nie odezwał.
// Odpowiedzi mają ten sam kształt co czat grupy, więc obie strony używają jednego widoku rozmowy.
import type { FastifyInstance } from 'fastify';
import { moderate, MODERATION_COPY } from '@glam/core';
import { ctx, requireStudio, type Deps } from '../context.ts';
import { id, nowIso } from '../db.ts';
import { badRequest, forbidden, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { CHAT_BODY_LIMIT, type ChatInput } from '../services/chat.ts';
import { storeMedia } from '../services/media.ts';
import { notify } from '../services/notify.ts';
import type { Studio } from '../services/studio.ts';

type Side = 'client' | 'trainer';
type Pair = { clientId: string; trainerId: string };

const nameOf = (scope: StudioScope, userId: string) => scope.db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string | null } | undefined;

function isTrainer(scope: StudioScope, userId: string) {
  return !!scope.get("SELECT 1 FROM memberships WHERE studio_id = $studio AND user_id = $u AND role = 'trainer'", { u: userId });
}

function messages(scope: StudioScope, pair: Pair, viewerId: string, after?: string) {
  const rows = scope.all<{ id: string; author_id: string; body: string; media_id: string | null; attachment_name: string | null; mime: string | null; created_at: string; read_at: string | null; author: string | null }>(
    `SELECT t.id, t.author_id, t.body, t.media_id, t.attachment_name, m.mime, t.created_at, t.read_at, u.name AS author
     FROM trainer_messages t LEFT JOIN media m ON m.id = t.media_id AND m.studio_id = t.studio_id LEFT JOIN users u ON u.id = t.author_id
     WHERE t.studio_id = $studio AND t.client_id = $c AND t.trainer_id = $t ${after ? 'AND t.created_at > $after' : ''}
     ORDER BY t.created_at DESC LIMIT 300`,
    { c: pair.clientId, t: pair.trainerId, ...(after ? { after } : {}) },
  );
  // Odczyt rozmowy = przeczytane wszystko, co napisała druga strona.
  scope.run('UPDATE trainer_messages SET read_at = $now WHERE studio_id = $studio AND client_id = $c AND trainer_id = $t AND author_id != $me AND read_at IS NULL', {
    c: pair.clientId,
    t: pair.trainerId,
    me: viewerId,
    now: nowIso(),
  });
  return rows.reverse().map(({ media_id, attachment_name, mime, author_id, author, read_at, ...r }) => ({
    ...r,
    hidden: 0,
    mine: author_id === viewerId,
    trainer: author_id === pair.trainerId,
    seen: author_id === viewerId && !!read_at,
    author: { id: author_id, name: author ?? 'Klientka', avatarUrl: null, staff: author_id === pair.trainerId },
    attachment: media_id && mime ? { url: `/api/media/${media_id}`, name: attachment_name, type: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'pdf' } : null,
  }));
}

/** Do której mojej wiadomości druga strona doczytała – „przeczytane” bez ponownego pobierania całej rozmowy. */
function peerReadAt(scope: StudioScope, pair: Pair, viewerId: string) {
  return scope.get<{ at: string | null }>('SELECT MAX(created_at) AS at FROM trainer_messages WHERE studio_id = $studio AND client_id = $c AND trainer_id = $t AND author_id = $me AND read_at IS NOT NULL', {
    c: pair.clientId,
    t: pair.trainerId,
    me: viewerId,
  })!.at;
}

function send(scope: StudioScope, studio: Studio, pair: Pair, side: Side, authorId: string, input: ChatInput) {
  const body = String(input?.body ?? '').trim();
  const file = input?.attachment ? String(input.attachment) : null;
  if (!body && !file) throw badRequest('Napisz wiadomość albo dodaj plik.');
  if (body) {
    const m = moderate(body, { maxLength: 1500, allowLinks: side === 'trainer' });
    if (!m.ok) throw badRequest(MODERATION_COPY[m.reason]);
  }
  const media = file ? storeMedia(scope, studio, { dataUrl: file, kind: 'dm', ownerId: authorId, private: true, allow: ['image', 'video', 'pdf'] }) : null;
  const mid = id();
  const now = nowIso();
  scope.run(
    'INSERT INTO trainer_messages (id, studio_id, client_id, trainer_id, author_id, body, media_id, attachment_name, created_at) VALUES ($id, $studio, $c, $t, $a, $b, $m, $n, $now)',
    { id: mid, c: pair.clientId, t: pair.trainerId, a: authorId, b: body, m: media?.id ?? null, n: media ? String(input.attachmentName ?? '').trim().slice(0, 120) || null : null, now },
  );
  const preview = body ? body.slice(0, 140) : 'Przesłano plik 📎';
  if (side === 'client') {
    // Trenerka dostaje jedno powiadomienie na godzinę od tej klientki – rozmowa nie zasypie jej telefonu.
    const who = nameOf(scope, pair.clientId)?.name ?? 'Klientka';
    notify(scope, { userId: pair.trainerId, category: 'transactional', tz: studio.timezone, title: who, body: preview, action: `staff/dm/${pair.clientId}`, dedupeKey: `dm:${pair.clientId}:${pair.trainerId}:${now.slice(0, 13)}` });
  } else {
    notify(scope, { userId: pair.clientId, category: 'transactional', tz: studio.timezone, title: nameOf(scope, pair.trainerId)?.name ?? studio.name, body: preview, action: `dm/${pair.trainerId}` });
  }
  return { id: mid, created_at: now };
}

function removeOwn(scope: StudioScope, pair: Pair, userId: string, messageId: string) {
  const r = scope.run('DELETE FROM trainer_messages WHERE studio_id = $studio AND client_id = $c AND trainer_id = $t AND id = $id AND author_id = $me', { c: pair.clientId, t: pair.trainerId, id: messageId, me: userId });
  if (!r.changes) throw notFound();
  return { ok: true, deleted: true };
}

/** Lista rozmów z ostatnią wiadomością i liczbą nieprzeczytanych – dla klientki (z trenerkami) albo trenerki (z klientkami). */
function threads(scope: StudioScope, side: Side, userId: string) {
  const me = side === 'client' ? 'client_id' : 'trainer_id';
  const peer = side === 'client' ? 'trainer_id' : 'client_id';
  return scope
    .all<{ peer: string; name: string | null; last_body: string; last_media: string | null; last_author: string; last_at: string; unread: number }>(
      `SELECT x.${peer} AS peer, u.name, l.body AS last_body, l.media_id AS last_media, l.author_id AS last_author, l.created_at AS last_at,
              (SELECT COUNT(*) FROM trainer_messages n WHERE n.studio_id = x.studio_id AND n.client_id = x.client_id AND n.trainer_id = x.trainer_id AND n.author_id != $u AND n.read_at IS NULL) AS unread
       FROM (SELECT DISTINCT studio_id, client_id, trainer_id FROM trainer_messages WHERE studio_id = $studio AND ${me} = $u) x
       JOIN users u ON u.id = x.${peer}
       JOIN trainer_messages l ON l.id = (SELECT id FROM trainer_messages z WHERE z.studio_id = x.studio_id AND z.client_id = x.client_id AND z.trainer_id = x.trainer_id ORDER BY z.created_at DESC LIMIT 1)
       ORDER BY l.created_at DESC`,
      { u: userId },
    )
    .map((t) => ({
      id: t.peer,
      name: t.name ?? 'Klientka',
      unread: t.unread,
      last: { body: t.last_body || (t.last_media ? '📎 Załącznik' : ''), author: t.last_author === userId ? 'Ty' : null, at: t.last_at },
    }));
}

export function dmRoutes(app: FastifyInstance, deps: Deps) {
  const member = { preHandler: requireStudio(deps.db) };

  // ——— Klientka ———

  const clientPair = (scope: StudioScope, userId: string, trainerId: string): Pair => {
    if (!isTrainer(scope, trainerId)) throw notFound('Nie znaleziono trenerki.');
    if (trainerId === userId) throw badRequest('To Twoja rozmowa ze sobą 🙂');
    return { clientId: userId, trainerId };
  };

  app.get('/api/dm', member, async (req) => {
    const { scope, user } = ctx(req);
    return threads(scope, 'client', user.id);
  });

  app.get<{ Params: { trainerId: string }; Querystring: { after?: string } }>('/api/dm/:trainerId', member, async (req) => {
    const { scope, user } = ctx(req);
    const pair = clientPair(scope, user.id, req.params.trainerId);
    return { peer: { id: pair.trainerId, name: nameOf(scope, pair.trainerId)?.name ?? 'Trenerka' }, messages: messages(scope, pair, user.id, req.query.after), peerReadAt: peerReadAt(scope, pair, user.id) };
  });

  app.post<{ Params: { trainerId: string }; Body: ChatInput }>('/api/dm/:trainerId', { ...member, bodyLimit: CHAT_BODY_LIMIT }, async (req) => {
    const { scope, studio, user } = ctx(req);
    return send(scope, studio, clientPair(scope, user.id, req.params.trainerId), 'client', user.id, req.body);
  });

  app.delete<{ Params: { trainerId: string; messageId: string } }>('/api/dm/:trainerId/:messageId', member, async (req) => {
    const { scope, user } = ctx(req);
    return removeOwn(scope, clientPair(scope, user.id, req.params.trainerId), user.id, req.params.messageId);
  });

  // ——— Trenerka (aplikacja trenerki) ———

  const trainerPair = (scope: StudioScope, userId: string, clientId: string): Pair => {
    if (!isTrainer(scope, userId)) throw forbidden();
    // Trenerka odpowiada – nie zaczyna rozmowy z klientką, która do niej nie napisała.
    if (!scope.get('SELECT 1 FROM trainer_messages WHERE studio_id = $studio AND client_id = $c AND trainer_id = $t', { c: clientId, t: userId })) throw notFound();
    return { clientId, trainerId: userId };
  };

  app.get('/api/staff/dm', member, async (req) => {
    const { scope, user } = ctx(req);
    if (!isTrainer(scope, user.id)) throw forbidden();
    return threads(scope, 'trainer', user.id);
  });

  app.get<{ Params: { clientId: string }; Querystring: { after?: string } }>('/api/staff/dm/:clientId', member, async (req) => {
    const { scope, user } = ctx(req);
    const pair = trainerPair(scope, user.id, req.params.clientId);
    return { peer: { id: pair.clientId, name: nameOf(scope, pair.clientId)?.name ?? 'Klientka' }, messages: messages(scope, pair, user.id, req.query.after), peerReadAt: peerReadAt(scope, pair, user.id) };
  });

  app.post<{ Params: { clientId: string }; Body: ChatInput }>('/api/staff/dm/:clientId', { ...member, bodyLimit: CHAT_BODY_LIMIT }, async (req) => {
    const { scope, studio, user } = ctx(req);
    return send(scope, studio, trainerPair(scope, user.id, req.params.clientId), 'trainer', user.id, req.body);
  });

  app.delete<{ Params: { clientId: string; messageId: string } }>('/api/staff/dm/:clientId/:messageId', member, async (req) => {
    const { scope, user } = ctx(req);
    return removeOwn(scope, trainerPair(scope, user.id, req.params.clientId), user.id, req.params.messageId);
  });
}
