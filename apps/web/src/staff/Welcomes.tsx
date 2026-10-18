// Edytor powitań (6, P1–P8): lista klientek bez powitania, szablony „girl vibe” z serwera, podgląd jak u klientki,
// limit 400 znaków, opcjonalne wideo (max 30 s, pionowe 9:16), wysyłka zaplanowana, wysłane z odczytem.
// Właścicielka: akceptacja / zwrot do poprawki i statystyka powitań per trenerka.
import { useState } from 'react';
import { api, fmtDay, fmtTime, useApi } from '../api.ts';
import type { Me } from '../App.tsx';
import { AuthVideo, Avatar, Empty, Field, readFile, Sheet, Spinner, Tabs, useAction } from '../ui.tsx';

type Todo = { id: string; name: string; goal: string | null; first_class: string | null };
type Pending = { id: string; body: string; video_id: string | null; trainer_name: string; client_name: string };
type Sent = { id: string; body: string; status: string; publish_at: string | null; seen_at: string | null; video_id: string | null; created_at: string; client_name: string; trainer_name: string | null };
type Template = { id: string; label: string; body: string };

const MAX = 400;
const fill = (t: string, v: Record<string, string>) => t.replace(/\{([^}]+)\}/g, (_, k) => v[k] ?? '');

export function Welcomes({ me, isOwner }: { me: Me; isOwner: boolean }) {
  const [tab, setTab] = useState<'todo' | 'sent' | 'owner'>(isOwner ? 'owner' : 'todo');
  return (
    <div className="stack-lg">
      <div>
        <h1>Powitania</h1>
        <p className="muted">Kilka zdań od Ciebie, zanim klientka przyjdzie pierwszy raz. Pisze człowiek, nie automat.</p>
      </div>
      <Tabs
        label="Powitania"
        value={tab}
        onChange={setTab}
        options={[...(isOwner ? ([['owner', 'Akceptacja i statystyki']] as ['owner', string][]) : []), ['todo', 'Do napisania'], ['sent', 'Wysłane']]}
      />
      {tab === 'todo' && <TodoList me={me} isOwner={isOwner} />}
      {tab === 'sent' && <SentList isOwner={isOwner} />}
      {tab === 'owner' && <OwnerView />}
    </div>
  );
}

function TodoList({ me, isOwner }: { me: Me; isOwner: boolean }) {
  const todo = useApi<Todo[]>('/staff/welcome-todo');
  const [editing, setEditing] = useState<Todo | null>(null);
  return (
    <section className="stack">
      {todo.error && <Empty>{todo.error.message}</Empty>}
      {!todo.data && !todo.error && <Spinner />}
      {todo.data?.length === 0 && <Empty icon="✨">{isOwner ? 'Każda klientka studia dostała już powitanie.' : 'Wszystkie Twoje klientki dostały powitanie.'}</Empty>}
      {todo.data?.map((c) => (
        <div key={c.id} className="card row">
          <Avatar name={c.name} size="sm" />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{c.name}</div>
            <div className="small muted">
              {c.first_class ? `Najbliższe zajęcia: ${fmtDay(c.first_class)}` : 'Bez zapisu na najbliższe zajęcia'}
              {c.goal ? ` · cel: ${c.goal}` : ''}
            </div>
          </div>
          <button className="btn sm" onClick={() => setEditing(c)}>
            Napisz powitanie
          </button>
        </div>
      ))}
      {editing && <Editor me={me} client={editing} onClose={() => setEditing(null)} onDone={todo.reload} />}
    </section>
  );
}

function Editor({ me, client, onClose, onDone }: { me: Me; client: Todo; onClose: () => void; onDone: () => void }) {
  const templates = useApi<Template[]>('/staff/welcome-templates');
  const myName = me.user.name ?? 'Twoja trenerka';
  const vars = { imię: client.name, trenerka: myName, cel: client.goal?.toLowerCase() ?? 'zadbać o siebie', kiedy: client.first_class ? `${fmtDay(client.first_class)} o ${fmtTime(client.first_class)}` : 'już niedługo' };
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [video, setVideo] = useState<{ dataUrl: string; durationSec: number; ratio: number; url: string } | null>(null);
  const [publishAt, setPublishAt] = useState('');
  const [videoError, setVideoError] = useState('');
  const { run, busy } = useAction();
  const body = text || (templates.data ? fill(templates.data[0].body, vars) : '');
  const exclam = (body.match(/!/g) ?? []).length;

  const pickVideo = async (file: File) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = url;
    v.onloadedmetadata = async () => {
      const ratio = v.videoWidth / v.videoHeight;
      if (v.duration > 30.5) return setVideoError('Wideo może mieć max 30 sekund.');
      if (ratio >= 0.8) return setVideoError('Nagraj pionowo (9:16) – tak jak klientka ogląda na telefonie.');
      setVideoError('');
      setVideo({ dataUrl: await readFile(file), durationSec: v.duration, ratio, url });
    };
  };

  const send = () =>
    run(
      () =>
        api<{ message: string }>('/staff/welcome', {
          method: 'POST',
          body: { clientId: client.id, body, video: video ? { dataUrl: video.dataUrl, durationSec: video.durationSec, ratio: video.ratio } : null, publishAt: publishAt ? new Date(publishAt).toISOString() : null },
        }).then((r) => (onDone(), onClose(), r)),
    );

  return (
    <Sheet onClose={onClose} label={`Powitanie – ${client.name}`}>
      {!preview ? (
        <div className="stack">
          <h2>Powitanie – {client.name}</h2>
          <div className="chips">
            {templates.data?.map((t) => (
              <button key={t.id} className="chip" onClick={() => setText(fill(t.body, vars))}>
                {t.label}
              </button>
            ))}
          </div>
          <textarea className="input" value={body} onChange={(e) => setText(e.target.value)} maxLength={MAX} aria-label="Treść powitania" />
          <div className="row between tiny">
            <span className={exclam > 3 ? '' : 'muted'} style={exclam > 3 ? { color: 'var(--danger)' } : undefined}>
              Wykrzykniki: {exclam}/3 · 1–3 emoji · bez presji i obietnic wyglądu
            </span>
            <span className="muted">
              {body.length}/{MAX}
            </span>
          </div>
          <label className="btn ghost">
            {video ? `Wideo ${Math.round(video.durationSec)} s ✓` : 'Dodaj wideo (max 30 s, pionowo)'}
            <input type="file" accept="video/*" capture="user" hidden onChange={(e) => e.target.files?.[0] && pickVideo(e.target.files[0])} />
          </label>
          {videoError && <span className="tiny" style={{ color: 'var(--danger)' }}>{videoError}</span>}
          <Field label="Wyślij później (opcjonalnie)" hint="Np. wieczór przed pierwszymi zajęciami.">
            <input className="input" type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
          </Field>
          <button className="btn ghost" onClick={() => setPreview(true)}>
            Podgląd jak u klientki
          </button>
          <button className="btn" onClick={send} disabled={body.trim().length < 20 || exclam > 3 || busy}>
            {publishAt ? 'Zaplanuj powitanie' : 'Wyślij powitanie'}
          </button>
        </div>
      ) : (
        <div className="stack">
          <div className="welcome-hero stack">
            <div className="row">
              <Avatar name={myName} />
              <div>
                <div className="eyebrow" style={{ marginBottom: 0 }}>
                  Od Twojej trenerki
                </div>
                <div className="card-title">{myName}</div>
              </div>
            </div>
            {video && <video src={video.url} controls playsInline style={{ width: '60%', alignSelf: 'center', borderRadius: 18 }} />}
            <p style={{ margin: 0 }}>{body}</p>
            <p className="serif" style={{ fontSize: '1.5rem', margin: 0 }}>Twoja {myName}</p>
          </div>
          <button className="btn ghost" onClick={() => setPreview(false)}>
            ← Edytuj
          </button>
          <button className="btn" onClick={send} disabled={exclam > 3 || busy}>
            {publishAt ? 'Zaplanuj powitanie' : 'Wyślij powitanie'}
          </button>
        </div>
      )}
    </Sheet>
  );
}

function SentList({ isOwner }: { isOwner: boolean }) {
  const list = useApi<Sent[]>('/staff/welcomes/sent');
  const STATUS: Record<string, string> = { published: 'wysłane', scheduled: 'zaplanowane', pending: 'czeka na akceptację' };
  if (list.error) return <Empty>{list.error.message}</Empty>;
  if (!list.data) return <Spinner />;
  if (!list.data.length) return <Empty>{isOwner ? 'W studiu nie ma jeszcze wysłanych powitań.' : 'Jeszcze nic nie wysłałaś.'}</Empty>;
  return (
    <div className="stack">
      {list.data.map((w) => (
        <div key={w.id} className="card flat stack gap-1">
          <div className="row between">
            <b>
              {w.client_name}
              {isOwner && w.trainer_name && <span className="small muted" style={{ fontWeight: 400 }}> · od {w.trainer_name}</span>}
            </b>
            <span className="badge">
              {STATUS[w.status] ?? w.status}
              {w.status === 'scheduled' && w.publish_at ? ` ${fmtDay(w.publish_at)} ${fmtTime(w.publish_at)}` : ''}
            </span>
          </div>
          <div className="small">{w.body}</div>
          <div className="tiny muted">
            {fmtDay(w.created_at)} {w.video_id ? '· z wideo' : ''} · {w.seen_at ? `przeczytane ${fmtDay(w.seen_at)}` : 'jeszcze nieprzeczytane'}
          </div>
        </div>
      ))}
    </div>
  );
}

function OwnerView() {
  const pending = useApi<Pending[]>('/owner/welcome/pending');
  const stats = useApi<{ trainer_name: string; written: number; seen: number; videos: number; booked_after: number }[]>('/owner/welcome/stats');
  const [note, setNote] = useState<Record<string, string>>({});
  const { run } = useAction();
  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="eyebrow">Czekają na akceptację</div>
        {pending.data?.length === 0 && <Empty>Nic nie czeka.</Empty>}
        {pending.data?.map((p) => (
          <section key={p.id} className="card butter stack gap-2">
            <span className="small">
              <b>{p.trainer_name}</b> → {p.client_name}
            </span>
            {p.video_id && <AuthVideo src={`/api/media/${p.video_id}`} controls playsInline style={{ maxWidth: 180, borderRadius: 14 }} />}
            <div className="small">„{p.body}”</div>
            <div className="row">
              <button className="btn sm" onClick={() => run(() => api(`/owner/welcome/${p.id}/approve`, { method: 'POST' }).then(pending.reload), 'Zaakceptowane')}>
                Akceptuj
              </button>
              <input className="input" placeholder="Uwagi do poprawki" value={note[p.id] ?? ''} onChange={(e) => setNote({ ...note, [p.id]: e.target.value })} />
              <button className="btn ghost sm" onClick={() => run(() => api(`/owner/welcome/${p.id}/reject`, { method: 'POST', body: { note: note[p.id] } }).then(pending.reload), 'Wróciło do trenerki')}>
                Do poprawki
              </button>
            </div>
          </section>
        ))}
      </section>
      <section className="stack">
        <div className="eyebrow">Powitania per trenerka</div>
        <table className="table">
          <thead>
            <tr>
              <th>Trenerka</th>
              <th>Napisane</th>
              <th>Przeczytane</th>
              <th>Z wideo</th>
              <th>Zapis po powitaniu</th>
            </tr>
          </thead>
          <tbody>
            {stats.data?.map((s) => (
              <tr key={s.trainer_name}>
                <td>{s.trainer_name}</td>
                <td>{s.written}</td>
                <td>{s.seen ?? 0}</td>
                <td>{s.videos ?? 0}</td>
                <td>{s.booked_after ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
