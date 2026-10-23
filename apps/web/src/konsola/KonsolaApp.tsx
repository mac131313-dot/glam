// Konsola GLAM (/konsola): narzędzie zespołu platformy – Dziś, Studia, Pieniądze, Wsparcie, Zespół, Dziennik.
// Wygląd i układ jak panel studia (menu boczne, na telefonie lista sekcji); menu zależy od roli z `platform_staff`.
// Serwer egzekwuje macierz ról – tu elementy niedostępne są tylko ukryte. Adres: #sekcja albo #studios/<id> (karta studia).
// Tryb demo: logowanie na konto zespołu bez kodu SMS (?jako=admin | wsparcie | finanse).
import { useEffect, useState } from 'react';
import { ApiError, api, session, useApi } from '../api.ts';
import { PERSONAS } from '../demo.ts';
import { applySystemLook } from '../look.ts';
import { Icon, type IconName } from '../icons.tsx';
import { Empty, Pending, Select, Spinner } from '../ui.tsx';
import { Studios } from './Studios.tsx';
import { Today } from './Today.tsx';

export type PlatformRole = 'admin' | 'support' | 'finance';
/** Sekcja menu; `roles` – kto ją widzi (zgodnie z macierzą w guard.ts i trasach `/api/platform`). */
export type Section = { id: string; label: string; icon: IconName; roles: PlatformRole[] };
/** Przejście do sekcji albo karty studia: `go('studios')`, `go('studios/<id>')`. */
export type Go = (place: string) => void;

const ALL: PlatformRole[] = ['admin', 'support', 'finance'];

export const SECTIONS: Section[] = [
  { id: 'today', label: 'Dziś', icon: 'sun', roles: ALL },
  { id: 'studios', label: 'Studia', icon: 'home', roles: ALL },
  { id: 'money', label: 'Pieniądze', icon: 'card', roles: ['admin', 'finance'] },
  { id: 'support', label: 'Wsparcie', icon: 'chat', roles: ['admin', 'support'] },
  { id: 'team', label: 'Zespół', icon: 'people', roles: ['admin'] },
  { id: 'log', label: 'Dziennik', icon: 'shield', roles: ['admin', 'support'] },
];

const ROLE_LABEL: Record<PlatformRole, string> = { admin: 'admin', support: 'wsparcie', finance: 'finanse' };

type PlatformMe = { userId: string; name: string | null; role: PlatformRole };

const GLOBAL = { global: true } as const;

function pickPersona(): string {
  const personas = PERSONAS.konsola;
  const asked = new URLSearchParams(location.search).get('jako')?.toLowerCase();
  if (asked && personas[asked]) return asked;
  if (session.persona && personas[session.persona]) return session.persona;
  return Object.keys(personas)[0];
}

export function KonsolaApp() {
  const [persona] = useState(pickPersona);
  const [token, setToken] = useState(session.persona === persona ? session.token : null);
  const [failed, setFailed] = useState(false);

  // Automatyczne logowanie na konto demo (zamiast ekranu z kodem SMS).
  useEffect(() => {
    if (token) return;
    api<{ token: string }>('/dev/login', { method: 'POST', body: { phone: PERSONAS.konsola[persona].phone }, ...GLOBAL })
      .then((res) => {
        session.setPersona(persona);
        session.setToken(res.token);
        setToken(res.token);
      })
      .catch(() => setFailed(true));
  }, [token, persona]);

  // Wygasła sesja → logujemy się ponownie.
  useEffect(() => {
    const relogin = () => {
      session.setToken(null);
      setToken(null);
    };
    window.addEventListener('glam:logout', relogin);
    return () => window.removeEventListener('glam:logout', relogin);
  }, []);

  useEffect(() => applySystemLook(), []);

  const { data: me, error, reload } = useApi<PlatformMe>(token ? '/platform/me' : null, [token], GLOBAL);

  if (failed) return <div className="empty" style={{ paddingTop: 80 }}>Nie udało się połączyć z API. Czy działa `npm run dev`?</div>;
  // Zalogowana, ale poza zespołem GLAM (albo wyłączona z zespołu).
  if ((error as ApiError | undefined)?.status === 403) return <div className="empty" style={{ paddingTop: 80 }}>Ta część jest dla zespołu GLAM.</div>;
  if (error && (error as ApiError).status !== 401) return <Pending error={error} reload={reload} />;
  if (!me) return <Spinner />;
  return <Shell me={me} persona={PERSONAS.konsola[persona].label} />;
}

function Shell({ me, persona }: { me: PlatformMe; persona: string }) {
  const visible = SECTIONS.filter((s) => s.roles.includes(me.role));
  /** „sekcja” albo „studios/<id>” → miejsce, które ta rola może zobaczyć (nieznane i niedostępne wraca na „Dziś”). */
  const resolve = (raw: string) => {
    const [id, ...rest] = raw.split('/');
    const sec = visible.find((s) => s.id === id) ?? visible[0];
    const param = sec.id === 'studios' && sec.id === id ? rest.join('/') : '';
    return param ? `${sec.id}/${param}` : sec.id;
  };
  const [place, setPlace] = useState(() => resolve(location.hash.slice(1)));
  const [section, param] = [place.split('/')[0], place.split('/').slice(1).join('/')];

  const go: Go = (raw) => {
    const next = resolve(raw);
    if (next === place) return;
    history.pushState(null, '', `${location.pathname}${location.search}#${next}`);
    setPlace(next);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const onPop = () => setPlace(resolve(location.hash.slice(1)));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  return (
    <div className="staff">
      <aside className="side" aria-label="Menu konsoli">
        <div style={{ padding: '4px 12px 14px' }}>
          <div className="cobrand" aria-label="glam konsola">
            <span className="wordmark" style={{ fontSize: '1.7rem' }}>
              glam
            </span>
            <span className="cobrand-x" aria-hidden="true">
              ·
            </span>
            <span className="cobrand-name">konsola</span>
          </div>
        </div>
        {visible.map((s) => (
          <button key={s.id} className="side-link" aria-current={section === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
            <Icon name={s.icon} size={18} /> {s.label}
          </button>
        ))}
        <div style={{ flex: 1, minHeight: 16 }} />
        <div className="tiny muted" style={{ padding: '14px 12px 4px' }}>
          {me.name ?? persona} · {ROLE_LABEL[me.role]}
          <br />
          <a href="/" style={{ color: 'var(--muted)' }}>
            tryb demo · zmień konto
          </a>
        </div>
      </aside>
      <nav className="mobile-nav" aria-label="Menu konsoli">
        <div className="wordmark" style={{ fontSize: '1.5rem' }}>
          glam
        </div>
        <Select className="grow" ariaLabel="Sekcja konsoli" value={section} onChange={go} options={visible.map((s) => ({ value: s.id, label: s.label }))} />
      </nav>
      <main className="main">
        {/* key po sekcji – lista studiów i karta studia to ten sam ekran, więc filtr zostaje po powrocie z karty. */}
        <div key={section} className="staff-view">
          {section === 'today' && <Today role={me.role} go={go} />}
          {section === 'studios' && <Studios role={me.role} studioId={param || null} go={go} />}
          {/* Pieniądze, Wsparcie, Zespół i Dziennik dochodzą w kolejnym zadaniu. */}
          {['money', 'support', 'team', 'log'].includes(section) && <Empty>{visible.find((s) => s.id === section)?.label} – ta sekcja pojawi się wkrótce.</Empty>}
        </div>
      </main>
    </div>
  );
}
