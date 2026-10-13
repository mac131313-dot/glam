// Muzyka (4.10): playlisty studia ze Spotify / Apple Music przypięte do typu zajęć lub motywu, propozycje
// klientek do akceptacji, top tygodnia ze wspólnej playlisty. GLAM nie odtwarza muzyki – tylko linkuje.
import { useState } from 'react';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Spinner, useAction } from '../ui.tsx';

const PURPOSE: Record<string, string> = { class: 'Zajęcia', meditation: 'Medytacja', stretch: 'Rozciąganie', sleep: 'Sen', theme: 'Motyw', shared: 'Wspólna playlista klientek' };

export default function MusicAdmin() {
  const data = useApi<{
    playlists: { id: string; name: string; url: string; provider: string; purpose: string }[];
    pending: { id: string; title: string; artist: string | null; track_url: string; name: string; created_at: string }[];
    topWeek: { id: string; title: string; artist: string | null; votes: number }[];
  }>('/staff/playlists');
  const cfg = useApi<{ classTypes: { id: string; name: string }[] }>('/owner/config');
  const [f, setF] = useState({ url: '', name: '', purpose: 'class', classTypeId: '' });
  const { run, busy } = useAction();
  if (data.error) return <Empty>Muzyka nie jest dostępna w planie studia albo nie masz uprawnień.</Empty>;
  if (!data.data) return <Spinner />;
  return (
    <div className="stack-lg">
      <h1>Muzyka</h1>
      <section className="stack">
        <div className="eyebrow">Propozycje klientek do akceptacji</div>
        {data.data.pending.length === 0 && <Empty>Brak nowych propozycji.</Empty>}
        {data.data.pending.map((t) => (
          <div key={t.id} className="card flat row between">
            <span>
              <a href={t.track_url} target="_blank" rel="noreferrer">
                {t.title}
              </a>{' '}
              {t.artist && <span className="muted">– {t.artist}</span>}
              <span className="tiny muted" style={{ display: 'block' }}>
                {t.name} · {fmtDay(t.created_at)}
              </span>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={() => run(() => api(`/staff/playlists/tracks/${t.id}`, { method: 'POST', body: { approve: true } }).then(data.reload))}>
                Dodaj
              </button>
              <button className="btn ghost sm" onClick={() => run(() => api(`/staff/playlists/tracks/${t.id}`, { method: 'POST', body: { approve: false } }).then(data.reload))}>
                Odrzuć
              </button>
            </span>
          </div>
        ))}
      </section>
      {data.data.topWeek.length > 0 && (
        <section className="card soft stack" style={{ gap: 4 }}>
          <div className="eyebrow">Top tygodnia – na playlistę zajęć</div>
          {data.data.topWeek.map((t, i) => (
            <div key={t.id} className="small">
              {i + 1}. {t.title} {t.artist && `– ${t.artist}`} · {t.votes} głosów
            </div>
          ))}
        </section>
      )}
      <section className="stack">
        <div className="eyebrow">Playlisty studia</div>
        {data.data.playlists.map((p) => (
          <div key={p.id} className="card flat row between">
            <span>
              <a href={p.url} target="_blank" rel="noreferrer">
                {p.name}
              </a>
              <span className="tiny muted" style={{ display: 'block' }}>
                {PURPOSE[p.purpose]} · {p.provider === 'spotify' ? 'Spotify' : 'Apple Music'}
              </span>
            </span>
            <button className="btn ghost sm" onClick={() => window.confirm('Usunąć playlistę?') && run(() => api(`/staff/playlists/${p.id}`, { method: 'DELETE' }).then(data.reload))}>
              Usuń
            </button>
          </div>
        ))}
      </section>
      <section className="card stack">
        <div className="eyebrow">Dodaj playlistę</div>
        <input className="input" placeholder="Link do playlisty Spotify / Apple Music" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <input className="input" placeholder="Nazwa" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <div className="pill-row">
          {Object.entries(PURPOSE).map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={f.purpose === k} onClick={() => setF({ ...f, purpose: k })}>
              {l}
            </button>
          ))}
        </div>
        {f.purpose === 'class' && (
          <select className="input" value={f.classTypeId} onChange={(e) => setF({ ...f, classTypeId: e.target.value })} aria-label="Typ zajęć">
            <option value="">Typ zajęć (opcjonalnie – domyślna playlista)</option>
            {cfg.data?.classTypes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <button className="btn" disabled={!f.url || busy} onClick={() => run(() => api('/staff/playlists', { method: 'POST', body: { ...f, classTypeId: f.classTypeId || null } }).then(() => (setF({ ...f, url: '', name: '' }), data.reload())), 'Playlista dodana')}>
          Dodaj
        </button>
      </section>
    </div>
  );
}
