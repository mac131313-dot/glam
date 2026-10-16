// Rozmowy jak w komunikatorze: dymki po lewej (inne osoby) i prawej (ja), podpis autorki nad serią,
// separatory dni, pole wiadomości przypięte na dole. Jeden widok (Conversation) dla czatu grupy
// (Razem → Grupy, aplikacja trenerki → Grupy) i prywatnej rozmowy z trenerką („Napisz do trenerki”).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, fmtDay, fmtLongDay, fmtTime, localDate, useApi } from './api.ts';
import { AttachmentView, ChatComposer, type ChatAttachment } from './chat.tsx';
import { Avatar, Empty, Page, Spinner, useAction } from './ui.tsx';

export type GroupChatMessage = {
  id: string;
  body: string;
  created_at: string;
  hidden: number;
  mine: boolean;
  trainer: boolean;
  author: { id: string; name: string; staff: boolean };
  attachment: ChatAttachment | null;
  /** Rozmowa prywatna: druga strona przeczytała moją wiadomość. */
  seen?: boolean;
};
type GroupChatData = {
  group: { id: string; name: string; description: string | null; members: number; trainer: { id: string; name: string } | null; canModerate: boolean; member: boolean };
  messages: GroupChatMessage[];
};

/** Jak często dociągamy nowe wiadomości, gdy rozmowa jest otwarta. */
const POLL_MS = 4000;

/**
 * Czy wiadomość `next` dokleić do serii `prev` (bez powtarzania imienia i z ciaśniejszym odstępem).
 *
 * TODO(Ty): to decyzja o „rytmie” rozmowy. Teraz: ta sama autorka i najwyżej 5 minut przerwy.
 * Do rozważenia – dłuższe okno sprawia, że rozmowa wygląda spokojniej, ale imię znika z dymków,
 * które dzieli np. pół godziny; wiadomość z załącznikiem można też zawsze zaczynać jako nową serię.
 */
export function sameCluster(prev: GroupChatMessage | undefined, next: GroupChatMessage): boolean {
  if (!prev) return false;
  return prev.author.id === next.author.id && Date.parse(next.created_at) - Date.parse(prev.created_at) < 5 * 60_000;
}

const dayLabel = (iso: string) => {
  const d = localDate(new Date(iso));
  if (d === localDate()) return 'Dziś';
  if (d === localDate(new Date(Date.now() - 86_400_000))) return 'Wczoraj';
  return fmtLongDay(iso);
};

/** Pełnoekranowa rozmowa grupy z nagłówkiem (nazwa, opiekunka, liczba osób) i przypiętym polem wiadomości. */
export function GroupChatPage({ groupId, onBack, onWriteTrainer }: { groupId: string; onBack: () => void; onWriteTrainer?: (trainerId: string) => void }) {
  const chat = useApi<GroupChatData>(`/groups/${groupId}/chat`, [groupId]);
  const { run } = useAction();
  const g = chat.data?.group;
  const leave = () => window.confirm(`Opuścić grupę „${g?.name}”?`) && run(() => api(`/groups/${groupId}/leave`, { method: 'POST' }).then(onBack), 'Grupa opuszczona');
  return (
    <Page
      onBack={onBack}
      bodyClass="gchat-body"
      actions={g?.member && !g.canModerate ? <button className="link tiny" onClick={leave}>Opuść</button> : undefined}
      title={
        <span className="gchat-title">
          <span>{g?.name ?? 'Grupa'}</span>
          {g && (
            <span className="tiny muted">
              {g.trainer && onWriteTrainer && !g.canModerate ? (
                <>
                  <button className="link tiny" onClick={() => onWriteTrainer(g.trainer!.id)} title="Prywatna wiadomość do trenerki">
                    prowadzi {g.trainer.name} · napisz
                  </button>{' '}
                  ·{' '}
                </>
              ) : g.trainer ? (
                `prowadzi ${g.trainer.name} · `
              ) : (
                ''
              )}
              {g.members} {osoby(g.members)}
            </span>
          )}
        </span>
      }
    >
      {chat.error ? <Empty>{chat.error.message ?? 'Nie udało się otworzyć rozmowy.'}</Empty> : !chat.data ? (
        <Spinner />
      ) : (
        <Conversation
          base={`/groups/${groupId}/chat`}
          initialMessages={chat.data.messages}
          canModerate={chat.data.group.canModerate}
          reportKind="group_chat"
          placeholder={chat.data.group.canModerate && !chat.data.group.member ? 'Napisz do grupy…' : 'Wiadomość…'}
        />
      )}
    </Page>
  );
}

/** Prywatna rozmowa klientka ↔ trenerka. `path`: „/dm/<trenerka>” (klientka) albo „/staff/dm/<klientka>” (trenerka). */
export function DirectChatPage({ path, onBack, hint }: { path: string; onBack: () => void; hint: string }) {
  const chat = useApi<{ peer: { id: string; name: string }; messages: GroupChatMessage[] }>(path, [path]);
  return (
    <Page
      onBack={onBack}
      bodyClass="gchat-body"
      title={
        <span className="gchat-title">
          <span>{chat.data?.peer.name ?? 'Rozmowa'}</span>
          <span className="tiny muted">{hint}</span>
        </span>
      }
    >
      {chat.error ? (
        <Empty>{chat.error.message ?? 'Nie udało się otworzyć rozmowy.'}</Empty>
      ) : !chat.data ? (
        <Spinner />
      ) : (
        <Conversation base={path} initialMessages={chat.data.messages} placeholder="Wiadomość…" empty="Napisz, w czym możemy pomóc – odpowiedź przyjdzie tutaj i w powiadomieniu." />
      )}
    </Page>
  );
}

function Conversation({
  base,
  initialMessages,
  canModerate = false,
  reportKind,
  placeholder,
  empty = 'Tu zacznie się Wasza rozmowa. Napisz pierwsza',
}: {
  base: string;
  initialMessages: GroupChatMessage[];
  canModerate?: boolean;
  reportKind?: 'group_chat';
  placeholder: string;
  empty?: string;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [picked, setPicked] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const { run } = useAction();

  // Dociąganie nowych wiadomości (tylko gdy karta jest widoczna) – bez przeładowania całej rozmowy.
  const lastAt = messages.at(-1)?.created_at;
  const pull = async () => {
    const r = await api<{ messages: GroupChatMessage[]; peerReadAt?: string | null }>(`${base}${lastAt ? `?after=${encodeURIComponent(lastAt)}` : ''}`);
    setMessages((m) => {
      const next = r.messages.length ? [...m, ...r.messages.filter((x) => !m.some((y) => y.id === x.id))] : m;
      // Rozmowa prywatna: „przeczytane” pod moimi wiadomościami, do których druga strona doczytała.
      const readAt = r.peerReadAt;
      return readAt && next.some((x) => x.mine && !x.seen && x.created_at <= readAt) ? next.map((x) => (x.mine && x.created_at <= readAt ? { ...x, seen: true } : x)) : next;
    });
  };
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && pull().catch(() => {}), POLL_MS);
    return () => clearInterval(t);
  });

  // Nowa wiadomość przewija na dół, chyba że ktoś czyta starsze (wtedy zostawiamy w spokoju).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const remove = (m: GroupChatMessage) =>
    run(async () => {
      const r = await api<{ deleted?: boolean; hidden?: boolean }>(`${base}/${m.id}`, { method: 'DELETE' });
      setMessages((all) => (r.deleted ? all.filter((x) => x.id !== m.id) : all.map((x) => (x.id === m.id ? { ...x, hidden: Number(!!r.hidden) } : x))));
      setPicked(null);
    }, m.mine ? 'Usunięte' : undefined);

  const report = (m: GroupChatMessage) =>
    run(() => api<{ message: string }>('/reports', { method: 'POST', body: { targetKind: reportKind, targetId: m.id, reason: 'czat grupy' } }).then((r) => (setPicked(null), r)), (r) => r.message);

  return (
    <>
      <div
        ref={scroller}
        className="gchat-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {messages.length === 0 && <Empty>{empty}</Empty>}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || localDate(new Date(prev.created_at)) !== localDate(new Date(m.created_at));
          const first = newDay || !sameCluster(prev, m);
          const nextM = messages[i + 1];
          const last = !nextM || localDate(new Date(nextM.created_at)) !== localDate(new Date(m.created_at)) || !sameCluster(m, nextM);
          return (
            <div key={m.id} className="gchat-item">
              {newDay && <div className="gchat-day tiny muted">{dayLabel(m.created_at)}</div>}
              <div className={`gchat-row ${m.mine ? 'me' : ''} ${first ? 'first' : ''}`}>
                {!m.mine && <span className="gchat-avatar">{last && <Avatar name={m.author.name} size="sm" />}</span>}
                <div className="gchat-col">
                  {first && !m.mine && (
                    <span className="gchat-author tiny">
                      {m.author.name}
                      {m.trainer && <span className="badge">trenerka</span>}
                    </span>
                  )}
                  <button
                    className={`chat-bubble gchat-bubble ${m.mine ? 'me' : ''} ${m.trainer && !m.mine ? 'lead' : ''} ${m.hidden ? 'is-hidden' : ''}`}
                    onClick={() => setPicked(picked === m.id ? null : m.id)}
                    aria-expanded={picked === m.id}
                  >
                    {m.attachment && <AttachmentView a={m.attachment} />}
                    {m.body && <span style={{ whiteSpace: 'pre-wrap' }}>{m.body}</span>}
                  </button>
                  {(last || picked === m.id) && (
                    <span className="gchat-meta tiny muted">
                      {m.hidden ? 'ukryta · ' : ''}
                      {fmtTime(m.created_at)}
                      {m.seen && i === messages.length - 1 ? ' · przeczytane' : ''}
                      {picked === m.id && (
                        <>
                          {m.mine ? (
                            <button className="link tiny" onClick={() => remove(m)}>usuń</button>
                          ) : canModerate ? (
                            <button className="link tiny" onClick={() => remove(m)}>{m.hidden ? 'przywróć' : 'ukryj'}</button>
                          ) : reportKind ? (
                            <button className="link tiny" onClick={() => report(m)}>zgłoś</button>
                          ) : null}
                        </>
                      )}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="gchat-composer">
        <ChatComposer
          variant="bar"
          placeholder={placeholder}
          onSend={async (msg) => {
            stick.current = true;
            await api(base, { method: 'POST', body: msg });
            await pull();
          }}
        />
      </div>
    </>
  );
}

// ——— Lista rozmów (Razem → Grupy i aplikacja trenerki) ———

export type ThreadItem = { id: string; name: string; members?: number; trainer?: string | null; unread: number; last: { body: string; author: string | null; at: string } | null };

const osoby = (n: number) => (n === 1 ? 'osoba' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'osoby' : 'osób');

/** Godzina dla dzisiejszych, dzień tygodnia dla tego tygodnia, data dla starszych – jak w komunikatorach. */
export const threadTime = (iso: string) => {
  const age = Date.now() - Date.parse(iso);
  if (localDate(new Date(iso)) === localDate()) return fmtTime(iso);
  return age < 6 * 86_400_000 ? new Intl.DateTimeFormat('pl-PL', { weekday: 'short' }).format(new Date(iso)) : fmtDay(iso);
};

/** Wiersz rozmowy: inicjał grupy, nazwa, ostatnia wiadomość, godzina i licznik nieprzeczytanych. */
export function ThreadRow({ g, onOpen }: { g: ThreadItem; onOpen: () => void }) {
  return (
    <li>
      <button className={`thread ${g.unread ? 'unread' : ''}`} onClick={onOpen} aria-label={`Otwórz rozmowę ${g.name}${g.unread ? `, ${g.unread} nowych` : ''}`}>
        <Avatar name={g.name} />
        <span className="thread-main">
          <span className="thread-top">
            <span className="thread-name">{g.name}</span>
            {g.last && <span className="tiny muted">{threadTime(g.last.at)}</span>}
          </span>
          <span className="row" style={{ gap: 8 }}>
            <span className="thread-preview grow">{g.last ? `${g.last.author ? `${g.last.author}: ` : ''}${g.last.body}` : g.trainer ? `prowadzi ${g.trainer}` : g.members != null ? `${g.members} ${osoby(g.members)}` : ''}</span>
            {g.unread > 0 && <span className="thread-dot">{g.unread > 99 ? '99+' : g.unread}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

