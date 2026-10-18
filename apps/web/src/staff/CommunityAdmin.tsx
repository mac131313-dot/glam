// Społeczność w panelu (4.6, 4.9.4): zgłoszenia (ukryj / odrzuć), ukryte posty (przywróć), grupy, wyzwania
// z odznaką i motywem. Moderatorka widzi imiona – bez danych kontaktowych.
import { useState } from 'react';
import { BADGES } from '@glam/core';
import { api, fmtDay, localDate, addDaysStr, useApi } from '../api.ts';
import { Empty, Field, Select, Spinner, Tabs, Toggle, useAction } from '../ui.tsx';

type Report = { id: string; target_kind: string; target_id: string; reason: string | null; status: string; created_at: string; reporter: string; content?: { body?: string } };
type Hub = {
  groups: { id: string; name: string; description: string | null; approval: number; members: number; trainer_id: string | null }[];
  trainers: { id: string; name: string }[];
  requests: { group_id: string; group_name: string; user_id: string; name: string; message: string | null; created_at: string; goal: string | null }[];
  challenges: { id: string; title: string; metric: string; target: number; starts_on: string; ends_on: string; members: number; done: number }[];
  hidden: { id: string; body: string; name: string; created_at: string }[];
  openReports: number;
};

const KIND: Record<string, string> = { post: 'post', comment: 'komentarz', question: 'pytanie w kursie', review: 'opinia', track: 'utwór', group_chat: 'wiadomość w grupie' };
const METRIC: Record<string, string> = { trainings: 'treningi', mindful: 'minuty uważności', checkins: 'odhaczenia' };

export default function CommunityAdmin() {
  const hub = useApi<Hub>('/staff/community');
  const [tab, setTab] = useState<'reports' | 'groups' | 'challenges'>('reports');
  if (hub.error) return <Empty>Brak uprawnień do moderacji.</Empty>;
  if (!hub.data) return <Spinner />;
  return (
    <div className="stack-lg">
      <h1>Społeczność</h1>
      <Tabs
        label="Społeczność"
        value={tab}
        onChange={setTab}
        options={[
          ['reports', `Zgłoszenia${hub.data.openReports + hub.data.requests.length ? ` (${hub.data.openReports + hub.data.requests.length})` : ''}`],
          ['groups', 'Grupy'],
          ['challenges', 'Wyzwania'],
        ]}
      />
      {tab === 'reports' && <Reports hub={hub.data} reload={hub.reload} />}
      {tab === 'groups' && <Groups hub={hub.data} reload={hub.reload} />}
      {tab === 'challenges' && <Challenges hub={hub.data} reload={hub.reload} />}
    </div>
  );
}

function Reports({ hub, reload }: { hub: Hub; reload: () => Promise<void> }) {
  const list = useApi<Report[]>('/staff/reports');
  const { run } = useAction();
  const act = (r: Report, action: 'hide' | 'dismiss') => run(() => api(`/staff/reports/${r.id}`, { method: 'POST', body: { action } }).then(() => (list.reload(), reload())), action === 'hide' ? 'Ukryte' : 'Odrzucone');
  const decide = (r: Hub['requests'][number], action: 'accept' | 'decline') => run(() => api(`/staff/group-requests/${r.group_id}/${r.user_id}`, { method: 'POST', body: { action } }).then((res) => (reload(), res)));
  return (
    <div className="stack-lg">
      {/* Prośby o dołączenie do grup (grupy „za zgodą”) – na górze zgłoszeń, bo czekają na decyzję studia. */}
      {hub.requests.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Prośby o dołączenie do grup</div>
          {hub.requests.map((r) => (
            <div key={`${r.group_id}:${r.user_id}`} className="card flat row between" style={{ alignItems: 'flex-start' }}>
              <span className="stack gap-1">
                <span>
                  <b>{r.name}</b> <span className="small muted">→ {r.group_name}</span>
                </span>
                {r.message && <span className="small">„{r.message}”</span>}
                <span className="tiny muted">
                  {fmtDay(r.created_at)}
                  {r.goal && ` · cel: ${r.goal}`}
                </span>
              </span>
              <span className="row gap-2">
                <button className="btn sm" onClick={() => decide(r, 'accept')}>
                  Akceptuj
                </button>
                <button className="btn ghost sm" onClick={() => decide(r, 'decline')}>
                  Odrzuć
                </button>
              </span>
            </div>
          ))}
        </section>
      )}
      {!list.data ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        hub.requests.length > 0 ? null :
        <Empty>Żadnych zgłoszeń. Spokojnie jak po stretchingu 🌿</Empty>
      ) : (
        list.data.map((r) => (
          <section key={r.id} className="card flat stack gap-2" style={{ opacity: r.status === 'open' ? 1 : 0.6 }}>
            <div className="tiny muted">
              {KIND[r.target_kind] ?? r.target_kind} · zgłosiła {r.reporter} · {fmtDay(r.created_at)} {r.reason && `· ${r.reason}`}
            </div>
            <div>{r.content?.body ?? <span className="muted">treść usunięta</span>}</div>
            {r.status === 'open' ? (
              <div className="row">
                <button className="btn sm" onClick={() => act(r, 'hide')}>
                  Ukryj
                </button>
                <button className="btn ghost sm" onClick={() => act(r, 'dismiss')}>
                  W porządku
                </button>
              </div>
            ) : (
              <span className="badge" style={{ alignSelf: 'flex-start' }}>
                {r.status === 'hidden' ? 'ukryte' : 'odrzucone'}
              </span>
            )}
          </section>
        ))
      )}
      {hub.hidden.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Ukryte posty</div>
          {hub.hidden.map((p) => (
            <div key={p.id} className="card flat row between">
              <span className="small">
                <b>{p.name}</b>: {p.body.slice(0, 120)}
              </span>
              <button className="btn ghost sm" onClick={() => run(() => api('/staff/moderate', { method: 'POST', body: { kind: 'post', id: p.id, hidden: false } }).then(reload), 'Przywrócone')}>
                Przywróć
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Groups({ hub, reload }: { hub: Hub; reload: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [approval, setApproval] = useState(true);
  const { run, busy } = useAction();
  return (
    <div className="stack-lg">
      {hub.groups.map((g) => (
        <div key={g.id} className="card flat row between">
          <span>
            <b>{g.name}</b> <span className="small muted">· {g.members} członkiń{g.approval ? ' · dołączanie za zgodą' : ''}</span>
            {g.description && <span className="small muted" style={{ display: 'block' }}>{g.description}</span>}
          </span>
          <span className="row gap-2">
          <Select
            ariaLabel={`Opiekunka grupy ${g.name}`}
            value={g.trainer_id ?? ''}
            onChange={(v) => run(() => api(`/staff/groups/${g.id}/trainer`, { method: 'PUT', body: { trainerId: v || null } }).then(reload), v ? 'Opiekunka przypisana – może pisać do grupy z aplikacji' : 'Grupa bez opiekunki')}
            options={[{ value: '', label: 'Bez opiekunki' }, ...hub.trainers.map((t) => ({ value: t.id, label: `Prowadzi ${t.name}` }))]}
          />
          <button className="btn ghost sm" onClick={() => window.confirm(`Usunąć grupę „${g.name}”?`) && run(() => api(`/staff/groups/${g.id}`, { method: 'DELETE' }).then(reload))}>
            Usuń
          </button>
          </span>
        </div>
      ))}
      <section className="card stack">
        <div className="eyebrow">Nowa grupa</div>
        <input className="input" placeholder="Np. Mamy w ruchu" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Opis (opcjonalnie)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <Toggle label="Dołączanie za zgodą" hint="Klientka wysyła prośbę, a studio ją akceptuje tutaj" checked={approval} onChange={setApproval} />
        <button className="btn" disabled={!name || busy} onClick={() => run(() => api('/staff/groups', { method: 'POST', body: { name, description: desc, approval } }).then(() => (setName(''), setDesc(''), reload())), 'Grupa utworzona')}>
          Utwórz
        </button>
      </section>
    </div>
  );
}

function Challenges({ hub, reload }: { hub: Hub; reload: () => Promise<void> }) {
  const [f, setF] = useState({ title: '', description: '', metric: 'trainings', target: 8, startsOn: localDate(), endsOn: addDaysStr(localDate(), 30), badgeCode: '' });
  const { run, busy } = useAction();
  return (
    <div className="stack-lg">
      {hub.challenges.map((c) => (
        <div key={c.id} className="card flat row between">
          <span>
            <b>{c.title}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {c.target} × {METRIC[c.metric] ?? c.metric} · {c.starts_on} – {c.ends_on} · {c.members} uczestniczek, ukończyło {c.done}
            </span>
          </span>
          <button className="btn ghost sm" onClick={() => window.confirm('Usunąć wyzwanie?') && run(() => api(`/staff/challenges/${c.id}`, { method: 'DELETE' }).then(reload))}>
            Usuń
          </button>
        </div>
      ))}
      <section className="card stack">
        <div className="eyebrow">Nowe wyzwanie</div>
        <input className="input" placeholder="Np. 8 treningów w październiku" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <textarea className="input" placeholder="Opis" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        <div className="chips">
          {Object.entries(METRIC).map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={f.metric === k} onClick={() => setF({ ...f, metric: k })}>
              {l}
            </button>
          ))}
        </div>
        <div className="row">
          <Field label="Cel">
            <input className="input" type="number" value={f.target} onChange={(e) => setF({ ...f, target: Number(e.target.value) })} />
          </Field>
          <Field label="Od">
            <input className="input" type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} />
          </Field>
          <Field label="Do">
            <input className="input" type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} />
          </Field>
        </div>
        <Select
          ariaLabel="Odznaka"
          value={f.badgeCode}
          onChange={(v) => setF({ ...f, badgeCode: v })}
          options={[{ value: '', label: 'Odznaka za ukończenie (opcjonalnie)' }, ...BADGES.map((b) => ({ value: b.code, label: b.name }))]}
        />
        <button
          className="btn"
          disabled={!f.title || busy}
          onClick={() => run(() => api('/staff/challenges', { method: 'POST', body: { ...f, badgeCode: f.badgeCode || null } }).then(reload), 'Wyzwanie startuje – klientki dostaną zaproszenie')}
        >
          Utwórz wyzwanie
        </button>
      </section>
    </div>
  );
}

/** 1 członkini · 2–4 członkinie · 5+ członkiń. */
const czlonkinie = (n: number) => (n === 1 ? 'członkini' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'członkinie' : 'członkiń');
