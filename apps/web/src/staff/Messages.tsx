// Wiadomości (3, #31, 4.9, 4.10): szybkie wiadomości do grupy (trenerka – do swoich zajęć, recepcja – do wszystkich,
// typu zajęć albo grupy), czat z klientkami, prośby o termin z ankiety uśpionych (kontakt w 24 h), skrzynka personelu.
import { useEffect, useRef, useState } from 'react';
import { can, type Role } from '@glam/core';
import { api, fmtDay, fmtTime, localDate, useApi } from '../api.ts';
import { Empty, Select, Spinner, Tabs, useAction } from '../ui.tsx';

export default function Messages({ roles }: { roles: Role[] }) {
  const options: ['group' | 'chat' | 'followups' | 'inbox', string][] = [
    ['group', 'Do grupy'],
    ...(can(roles, 'chat.answer') ? ([['chat', 'Czat z klientkami']] as ['chat', string][]) : []),
    ...(can(roles, 'clients.contact') ? ([['followups', 'Prośby o termin']] as ['followups', string][]) : []),
    ['inbox', 'Dla mnie'],
  ];
  const [tab, setTab] = useState(options[0][0]);
  return (
    <div className="stack-lg">
      <h1>Wiadomości</h1>
      <Tabs label="Wiadomości" value={tab} onChange={setTab} options={options} />
      {tab === 'group' && <GroupMessage roles={roles} />}
      {tab === 'chat' && <Chats />}
      {tab === 'followups' && <Followups />}
      {tab === 'inbox' && <StaffInbox />}
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

function Chats() {
  const threads = useApi<{ client_id: string; name: string; last_at: string; unread: number; last_body: string }[]>('/staff/chats');
  const [open, setOpen] = useState<string | null>(null);
  if (!threads.data) return <Spinner />;
  return (
    <div className="grid-2" style={{ alignItems: 'start' }}>
      <div className="stack" style={{ gap: 4 }}>
        {threads.data.length === 0 && <Empty>Brak rozmów.</Empty>}
        {threads.data.map((t) => (
          <button key={t.client_id} className={`card ${open === t.client_id ? 'soft' : 'flat'}`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(t.client_id)}>
            <div className="row between">
              <b>{t.name}</b>
              {t.unread > 0 && <span className="badge ok">{t.unread}</span>}
            </div>
            <div className="small muted">{t.last_body?.slice(0, 70)}</div>
          </button>
        ))}
      </div>
      {open && <Thread clientId={open} onRead={threads.reload} />}
    </div>
  );
}

function Thread({ clientId, onRead }: { clientId: string; onRead: () => void }) {
  const msgs = useApi<{ id: string; body: string; from_staff: number; auto: number; created_at: string; author: string | null }[]>(`/staff/chats/${clientId}`, [clientId]);
  const [text, setText] = useState('');
  const { run, busy } = useAction();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
    if (msgs.data) onRead();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msgs.data]);
  return (
    <section className="card stack">
      <div className="stack" style={{ gap: 8, maxHeight: 420, overflow: 'auto' }}>
        {msgs.data?.map((m) => (
          <div key={m.id} className={`chat-bubble ${m.from_staff ? 'me' : ''} ${m.auto ? 'auto' : ''}`}>
            {m.body}
            <div className="tiny" style={{ opacity: 0.7 }}>
              {m.auto ? 'automatyczna odpowiedź' : m.author} · {fmtDay(m.created_at)} {fmtTime(m.created_at)}
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="row">
        <input className="input" placeholder="Odpowiedz…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn sm" disabled={!text.trim() || busy} onClick={() => run(() => api(`/staff/chats/${clientId}`, { method: 'POST', body: { body: text } }).then(() => (setText(''), msgs.reload())))}>
          Wyślij
        </button>
      </div>
    </section>
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
