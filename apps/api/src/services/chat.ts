// Czat klientka ↔ recepcja (4.9): wspólny zapis i odczyt wiadomości dla aplikacji klientki i panelu.
// Wiadomość może mieć jeden załącznik (zdjęcie, wideo albo PDF) – prywatny plik studia (media, rodzaj „chat”),
// który widzą tylko ta klientka i zespół studia (GET /api/media/:id).
import { id, nowIso } from '../db.ts';
import { badRequest } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { storeMedia } from './media.ts';
import type { Studio } from './studio.ts';

export type ChatInput = { body?: string; attachment?: string | null; attachmentName?: string | null };

/** Limit żądania z załącznikiem: wideo do 40 MB w base64 to ok. 54 MB. */
export const CHAT_BODY_LIMIT = 60 * 1024 * 1024;

/** Lista wiadomości jednej rozmowy (najstarsze pierwsze), z typem załącznika do podglądu. */
export function chatMessages(scope: StudioScope, clientId: string) {
  const rows = scope.all<{ id: string; body: string; from_staff: number; auto: number; created_at: string; author: string | null; media_id: string | null; attachment_name: string | null; mime: string | null }>(
    `SELECT c.id, c.body, c.from_staff, c.auto, c.created_at, u.name AS author, c.media_id, c.attachment_name, m.mime
     FROM chat_messages c LEFT JOIN users u ON u.id = c.author_id LEFT JOIN media m ON m.id = c.media_id AND m.studio_id = c.studio_id
     WHERE c.studio_id = $studio AND c.client_id = $c ORDER BY c.created_at`,
    { c: clientId },
  );
  return rows.map(({ media_id, attachment_name, mime, ...r }) => ({
    ...r,
    attachment: media_id && mime ? { url: `/api/media/${media_id}`, name: attachment_name, type: mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : 'pdf' } : null,
  }));
}

/** Zapisuje wiadomość: tekst, załącznik albo oba. Pusta wiadomość bez pliku – błąd. */
export function postChatMessage(
  scope: StudioScope,
  studio: Studio,
  msg: { clientId: string; authorId: string; fromStaff: boolean; body: string; input: ChatInput },
) {
  const file = msg.input.attachment ? String(msg.input.attachment) : null;
  if (!msg.body && !file) throw badRequest('Napisz wiadomość albo dodaj plik.');
  const media = file ? storeMedia(scope, studio, { dataUrl: file, kind: 'chat', ownerId: msg.authorId, private: true, allow: ['image', 'video', 'pdf'] }) : null;
  const name = media ? String(msg.input.attachmentName ?? '').trim().slice(0, 120) || null : null;
  scope.run(
    'INSERT INTO chat_messages (id, studio_id, client_id, author_id, from_staff, body, media_id, attachment_name, created_at) VALUES ($id, $studio, $c, $a, $s, $b, $m, $n, $now)',
    { id: id(), c: msg.clientId, a: msg.authorId, s: Number(msg.fromStaff), b: msg.body, m: media?.id ?? null, n: name, now: nowIso() },
  );
}

/** Podgląd ostatniej wiadomości na liście rozmów: sam plik bez tekstu → opis załącznika. */
export const CHAT_LAST_BODY = `(SELECT CASE WHEN x.body != '' THEN x.body WHEN x.media_id IS NOT NULL THEN '📎 Załącznik' ELSE '' END
  FROM chat_messages x WHERE x.studio_id = c.studio_id AND x.client_id = c.client_id ORDER BY x.created_at DESC LIMIT 1)`;

/** Rozmowy z recepcją dla panelu: jedna na klientkę, z liczbą nieprzeczytanych wiadomości klientki. */
export function receptionThreads(scope: StudioScope) {
  return scope.all<{ client_id: string; name: string; last_at: string; unread: number; last_body: string }>(
    `SELECT c.client_id, u.name, MAX(c.created_at) AS last_at,
            SUM(CASE WHEN c.from_staff = 0 AND c.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
            ${CHAT_LAST_BODY} AS last_body
     FROM chat_messages c JOIN users u ON u.id = c.client_id WHERE c.studio_id = $studio GROUP BY c.client_id ORDER BY last_at DESC`,
  );
}

/** Rozmowa klientki z recepcją: ostatnia wiadomość i liczba nieprzeczytanych odpowiedzi studia. */
export function receptionThreadOf(scope: StudioScope, clientId: string) {
  return scope.get<{ last_at: string | null; unread: number; last_body: string | null; last_staff: number | null }>(
    `SELECT MAX(c.created_at) AS last_at,
            COALESCE(SUM(CASE WHEN c.from_staff = 1 AND c.read_at IS NULL THEN 1 ELSE 0 END), 0) AS unread,
            ${CHAT_LAST_BODY} AS last_body,
            (SELECT x.from_staff FROM chat_messages x WHERE x.studio_id = $studio AND x.client_id = $c ORDER BY x.created_at DESC LIMIT 1) AS last_staff
     FROM chat_messages c WHERE c.studio_id = $studio AND c.client_id = $c`,
    { c: clientId },
  )!;
}
