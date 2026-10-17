// Wiadomości – jedno miejsce na wszystkie rozmowy panelu (3, #31, 4.9, 4.10):
// · Rozmowy – wspólna lista wątków: czat z recepcją (klientki), prywatne wiadomości do trenerki, czaty grup,
//   każdy z licznikiem nieprzeczytanych; widoczność według uprawnień (GET /api/staff/threads),
// · Napisz do grupy – szybka wiadomość jako powiadomienie (trenerka – do swoich zajęć, recepcja – do wszystkich, typu zajęć albo grupy),
// · Prośby o kontakt – z ankiety uśpionych (kontakt w 24 h), · Dla mnie – skrzynka personelu.
import { useEffect, useRef, useState } from 'react';
import { can, type Role } from '@glam/core';
import { api, fmtDay, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Page, Select, Spinner, Tabs, useAction } from '../ui.tsx';
import { AttachmentView, ChatComposer, type ChatMessage } from '../chat.tsx';
import { DirectChatPage, GroupChatPage, ThreadRow, type ThreadItem } from '../groupChat.tsx';

type Tab = 'threads' | 'group' | 'followups' | 'inbox';

export default function Messages({ roles }: { roles: Role[] }) {
  const hasThreads = can(roles, 'chat.answer') || can(roles, 'messages.group.own') || can(roles, 'community.moderate') || roles.includes('trainer');
  const threads = useApi<{ threads: ThreadItem[]; unread: number }>(hasThreads ? '/staff/threads' : null);
  const unread = threads.data?.unread ?? 0;
  const options: [Tab, string][] = [
    ...(hasThreads ? ([['threads', unread ? `Rozmowy (${unread})` : 'Rozmowy']] as [Tab, string][]) : []),
    ...(can(roles, 'messages.group.own') || can(roles, 'messages.group.all') ? ([['group', 'Napisz do grupy']] as [Tab, string][]) : []),
    ...(can(roles, 'clients.contact') ? ([['followups', 'Prośby o kontakt']] as [Tab, string][]) : []),
    // Skrzynka „Dla mnie” – dla zespołu (np. zastępstwa trenerek); właścicielka jej nie potrzebuje.
    ...(roles.includes('owner') ? [] : ([['inbox', 'Dla mnie']] as [Tab, string][])),
  ];
  const [tab, setTab] = useState<Tab>(options[0]?.[0] ?? 'inbox');
  return (
    <div className="stack-lg">
      <h1>Wiadomości</h1>
      {options.length > 1 && <Tabs label="Wiadomości" value={tab} onChange={setTab} options={options} />}
      {tab === 'threads' && <Threads list={threads} />}
      {tab === 'group' && <GroupMessage roles={roles} />}
      {tab === 'followups' && <Followups />}
      {tab === 'inbox' && <StaffInbox />}
    </div>
  );
}

/** Wspólna lista rozmów; rozmowa otwiera się na pełnym ekranie, po powrocie liczniki się odświeżają. */
function Threads({ list }: { list: ReturnType<typeof useApi<{ threads: ThreadItem[]; unread: number }>> }) {
  const [open, setOpen] = useState<ThreadItem | null>(null);
  const reload = list.reload;
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === 'visible' && !open && reload(), 15_000);
    return () => clearInterval(t);
  }, [reload, open]);
  if (!list.data) return <Spinner />;
  const mine = list.data.threads.filter((t) => t.mine);
  // Moderacja widzi też grupy, którymi opiekują się inne osoby – osobno, żeby nie mieszały się z jej rozmowami.
  const rest = list.data.threads.filter((t) => !t.mine);
  const back = () => (setOpen(null), reload());
  return (
    <div className="stack" style={{ maxWidth: 640, gap: 0 }}>
      {mine.length === 0 && rest.length === 0 && <Empty>Na razie cisza. Gdy klientka napisze, rozmowa pojawi się tutaj.</Empty>}
      {mine.length > 0 && (
        <ul className="thread-list">
          {mine.map((t) => (
            <ThreadRow key={`${t.kind}:${t.id}`} g={t} onOpen={() => setOpen(t)} />
          ))}
        </ul>
      )}
      {rest.length > 0 && (
        <section>
          <div className="eyebrow thread-group-head">{mine.length > 0 ? 'Pozostałe grupy studia' : 'Grupy studia'}</div>
          <ul className="thread-list">
            {rest.map((t) => (
              <ThreadRow key={`${t.kind}:${t.id}`} g={t} onOpen={() => setOpen(t)} />
            ))}
          </ul>
        </section>
      )}
      {open?.kind === 'group' && <GroupChatPage groupId={open.id} onBack={back} />}
      {open?.kind === 'dm' && <DirectChatPage path={`/staff/dm/${open.id}`} hint="prywatna rozmowa z klientką" onBack={back} />}
      {open?.kind === 'reception' && <ReceptionChatPage clientId={open.id} name={open.name} onBack={back} />}
    </div>
  );
}

function GroupMessage({ roles }: { roles: Role[] }) {
  const day = useApi<{ sessions: { id: string; starts_at: string; class_name: string; participants: unknown[] }[] }>(`/staff/day?date=${localDate()}`);
  const history = useApi<{ id: string; body: string; audience: string; recipients: number; created_at: string; author: string }[]>('/staff/messages');
  const cfg = useApi<{ classTypes: { id: string; name: string }[] }>(can(roles, 'messages.group.all') ? '/owner/config' : null);
  const groups = useApi<{ id: string; name: string }[]>(can(roles, 'messages.group.all') ? '/groups' : null);
  const [target, setTarget] = useState('');
  const [body, setBody] = useState('');
  const { run, busy } = useAction();
  const send = () => {
    const payload = target.startsWith('session:') ? { sessionId: target.slice(8), body } : { audience: target || 'all', body };
    return run(() => api('/staff/messages', { method: 'POST', body: payload }).then((r) => (setBody(''), history.reload(), r)));
  };
  return (
    <div className="stack-lg">
      <section className="card stack">
        <Select
          ariaLabel="Do kogo"
          value={target}
          onChange={setTarget}
          options={[
            ...(can(roles, 'messages.group.all') ? [{ value: 'all', label: 'Wszystkie klientki studia' }] : [{ value: '', label: 'Wybierz zajęcia' }]),
            ...(day.data?.sessions ?? []).map((s) => ({ value: `session:${s.id}`, label: `Dziś ${fmtTime(s.starts_at)} · ${s.class_name} (${s.participants.length})` })),
            ...(cfg.data?.classTypes ?? []).map((c) => ({ value: `class_type:${c.id}`, label: `Uczestniczki zajęć: ${c.name}` })),
            ...(groups.data ?? []).map((g) => ({ value: `group:${g.id}`, label: `Grupa: ${g.name}` })),
          ]}
        />
        <textarea className="input" placeholder="Np. „Dziś zajęcia w sali 2 – do zobaczenia!”" value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} />
        <button className="btn" disabled={!body.trim() || (!target && !can(roles, 'messages.group.all')) || busy} onClick={send}>
          Wyślij
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>Wiadomość trafi do aplikacji klientek jako powiadomienie.</p>
      </section>
      <section className="stack" style={{ gap: 6 }}>
        <div className="eyebrow">Wysłane</div>
        {history.data?.map((m) => (
          <div key={m.id} className="card flat small">
            <div className="tiny muted">
              {m.author} · {fmtDay(m.created_at)} · {m.recipients} odbiorczyń
            </div>
            {m.body}
          </div>
        ))}
      </section>
    </div>
  );
}

/** Czat recepcji z jedną klientką – na pełnym ekranie, jak pozostałe rozmowy. */
function ReceptionChatPage({ clientId, name, onBack }: { clientId: string; name: string; onBack: () => void }) {
  const msgs = useApi<ChatMessage[]>(`/staff/chats/${clientId}`, [clientId]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs.data]);
  return (
    <Page
      onBack={onBack}
      title={
        <span className="gchat-title">
          <span>{name}</span>
          <span className="tiny muted">czat z recepcją</span>
        </span>
      }
    >
      <div className="stack">
        {!msgs.data ? (
          <Spinner />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            {msgs.data.map((m) => (
              <div key={m.id} className={`chat-bubble ${m.from_staff ? 'me' : ''} ${m.auto ? 'auto' : ''}`}>
                {m.attachment && <AttachmentView a={m.attachment} />}
                {m.body}
                <div className="tiny" style={{ opacity: 0.7 }}>
                  {m.auto ? 'automatyczna odpowiedź' : m.author} · {fmtDay(m.created_at)} {fmtTime(m.created_at)}
                </div>
              </div>
            ))}
            <div ref={end} />
          </div>
        )}
        <div style={{ position: 'sticky', bottom: 0, background: 'var(--bg)', paddingTop: 8 }}>
          <ChatComposer placeholder="Odpowiedz…" onSend={(msg) => api(`/staff/chats/${clientId}`, { method: 'POST', body: msg }).then(msgs.reload)} />
        </div>
      </div>
    </Page>
  );
}

function Followups() {
  const list = useApi<{ id: string; name: string; phone: string; reasons_json: string | null; comment: string | null; contact_due_at: string }[]>('/staff/followups');
  const { run } = useAction();
  // Dwa kroki: „Skontaktuj się” odsłania telefon, a dopiero „Potwierdź kontakt” zdejmuje prośbę z listy.
  const [contacting, setContacting] = useState<string | null>(null);
  if (!list.data) return <Spinner />;
  const REASON: Record<string, string> = { time: 'czas', health: 'zdrowie', price: 'cena', trainer: 'trenerka', other: 'inne' };
  return (
    <div className="stack">
      {list.data.length === 0 && <Empty>Nikt nie czeka na propozycję terminu.</Empty>}
      {list.data.map((f) => {
        const late = Date.parse(f.contact_due_at) < Date.now();
        return (
          <div key={f.id} className="card flat row between">
            <span>
              <b>{f.name}</b> · <a href={`tel:${f.phone}`}>{f.phone}</a>
              <span className="small muted" style={{ display: 'block' }}>
                {(f.reasons_json ? (JSON.parse(f.reasons_json) as string[]) : []).map((r) => REASON[r] ?? r).join(', ')} {f.comment && `– „${f.comment}”`}
              </span>
              <span className="tiny" style={{ color: late ? 'var(--danger)' : 'var(--muted)' }}>
                {late ? 'Po terminie 24 h' : `Kontakt do ${fmtDay(f.contact_due_at)} ${fmtTime(f.contact_due_at)}`}
              </span>
            </span>
            {contacting === f.id ? (
              <span className="row" style={{ gap: 8, flex: 'none' }}>
                <a className="btn ghost sm" href={`tel:${f.phone}`}>
                  Zadzwoń
                </a>
                <button className="btn sm" onClick={() => run(() => api(`/staff/followups/${f.id}/done`, { method: 'POST' }).then(() => (setContacting(null), list.reload())), 'Kontakt potwierdzony')}>
                  Potwierdź kontakt
                </button>
              </span>
            ) : (
              <button className="btn sm" style={{ flex: 'none' }} onClick={() => setContacting(f.id)}>
                Skontaktuj się
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StaffInbox() {
  const inbox = useApi<{ id: string; body: string; deliver_at: string }[]>('/staff/inbox');
  if (!inbox.data) return <Spinner />;
  return (
    <div className="stack" style={{ gap: 6 }}>
      {inbox.data.length === 0 && <Empty>Brak powiadomień.</Empty>}
      {inbox.data.map((n) => (
        <div key={n.id} className="card flat small row between">
          <span>{n.body}</span>
          <span className="tiny muted">{fmtDay(n.deliver_at)}</span>
        </div>
      ))}
    </div>
  );
}
