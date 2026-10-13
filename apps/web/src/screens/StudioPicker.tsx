// „Moje studia” (1.2.2): jedno konto, wiele studiów, dane osobne. Dołączanie kodem lub wejściówką.
import { useState } from 'react';
import { api, ApiError } from '../api.ts';
import type { Me } from '../App.tsx';
import { Icon } from '../icons.tsx';
import { StudioBrand } from '../StudioBrand.tsx';
import { useToast } from '../ui.tsx';

const ROLE: Record<string, string> = { client: 'klientka', trainer: 'trenerka', reception: 'recepcja', owner: 'właścicielka' };

export function StudioPicker(props: { me: Me; onPick: (id: string) => void; onJoined: () => Promise<void>; onLogout: () => void; canClose: boolean; onClose: () => void }) {
  // Link z zaproszenia albo wejściówki: /app?zaproszenie=KOD, /app?wejsciowka=KOD
  const [code, setCode] = useState(() => {
    const q = new URLSearchParams(location.search);
    return (q.get('zaproszenie') ?? q.get('wejsciowka') ?? '').toUpperCase();
  });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [catalog, setCatalog] = useState<{ id: string; name: string; city: string | null; tagline: string | null; rating: number | null; reviews: number; classes: string[] }[] | null>(null);
  const search = async () => setCatalog(await api(`/catalog?q=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}`, { global: true }));
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const join = async () => {
    setBusy(true);
    try {
      const trimmed = code.trim();
      // 6 znaków = kod studia; 8 znaków = wejściówka od znajomej albo zaproszenie (polecenie) – próbujemy po kolei.
      let res;
      if (trimmed.length === 8) {
        try {
          res = await api('/guest-passes/redeem', { method: 'POST', body: { code: trimmed }, global: true });
        } catch (e) {
          if ((e as ApiError).status !== 404) throw e;
          res = await api('/studios/join', { method: 'POST', body: { code: trimmed }, global: true });
        }
      } else res = await api('/studios/join', { method: 'POST', body: { code: trimmed }, global: true });
      toast(res.message ?? `Witaj w ${res.studio.name}`);
      await props.onJoined();
      props.onPick(res.studio.id);
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="phone">
      <div className="topbar">
        <h1 style={{ margin: 0 }}>Moje studia</h1>
        {props.canClose && (
          <button className="btn ghost sm" onClick={props.onClose}>
            Zamknij
          </button>
        )}
      </div>
      <div className="content stack-lg">
        {props.me.studios.length === 0 && (
          <div className="welcome-hero">
            <h2>
              Hej{props.me.user.name ? ', ' : ''}
              <span className="serif">{props.me.user.name ?? ''}</span>
            </h2>
            <p>Dołącz do swojego studia kodem z recepcji albo odbierz wejściówkę od znajomej.</p>
          </div>
        )}
        <div className="stack">
          {props.me.studios.map((s) => (
            <button key={s.id} className="card row" style={{ textAlign: 'left', cursor: 'pointer', alignItems: 'flex-start' }} onClick={() => props.onPick(s.id)}>
              <span className="grow">
                <span className="row" style={{ marginBottom: 10 }}>
                  <StudioBrand studio={s} scale={1.5} showName={false} />
                </span>
                <span className="card-title" style={{ display: 'block' }}>
                  {s.name} <span className="muted small">· {s.city}</span>
                </span>
                <span className="muted small">{s.tagline}</span>
                <span className="row wrap" style={{ marginTop: 6, gap: 6 }}>
                  {s.roles.map((r) => (
                    <span key={r} className="badge">
                      {ROLE[r] ?? r}
                    </span>
                  ))}
                </span>
              </span>
              <span className="muted" style={{ display: 'grid' }}>
                <Icon name="chevron" size={18} />
              </span>
            </button>
          ))}
        </div>

        <div className="card stack">
          <h3>Dołącz do studia</h3>
          <div className="field">
            <label htmlFor="code">Kod studia lub wejściówki</label>
            <input id="code" className="input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="np. RUCH24" />
            <span className="muted tiny">Karnety i historia są osobne w każdym studiu.</span>
          </div>
          <button className="btn" disabled={busy || code.trim().length < 4} onClick={join}>
            Dołącz
          </button>
        </div>

        <div className="card stack">
          <h3>Znajdź studio</h3>
          <div className="row">
            <input className="input" placeholder="Zajęcia, np. Reformer" value={q} onChange={(e) => setQ(e.target.value)} />
            <input className="input" placeholder="Miasto" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <button className="btn ghost" onClick={search}>
            Szukaj w katalogu
          </button>
          {catalog?.length === 0 && <p className="small muted">Nic nie znalazłyśmy. Studia same decydują, czy są w katalogu.</p>}
          {catalog?.map((c) => (
            <div key={c.id} className="row between">
              <span>
                <b>{c.name}</b> <span className="small muted">· {c.city}</span>
                <span className="tiny muted" style={{ display: 'block' }}>
                  {c.classes.slice(0, 4).join(', ')} {c.rating ? `· ★ ${c.rating} (${c.reviews})` : ''}
                </span>
              </span>
              <button
                className="btn sm"
                onClick={async () => {
                  try {
                    const r = await api<{ studio: { id: string; name: string } }>(`/catalog/${c.id}/join`, { method: 'POST', global: true });
                    toast(`Witaj w ${r.studio.name}`);
                    await props.onJoined();
                    props.onPick(r.studio.id);
                  } catch (e) {
                    toast((e as ApiError).message, 'error');
                  }
                }}
              >
                Dołącz
              </button>
            </div>
          ))}
        </div>


      </div>
    </main>
  );
}
