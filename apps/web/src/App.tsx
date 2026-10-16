// Tryb demo: dwie powierzchnie pod jednym serwerem, bez ekranu logowania.
//   /panel – panel studia (domyślnie właścicielka Joanna, ma dostęp do wszystkiego)
//   /app   – aplikacja mobilna klientki (domyślnie Magda)
// Inne konto demo: ?jako=marzena, ?jako=kasia, ?jako=ania … (lista w PERSONAS).
// Ekran logowania SMS (screens/Login.tsx) wraca po wyłączeniu DEMO_MODE.
import { useCallback, useEffect, useState } from 'react';
import { can, type Look } from '@glam/core';
import { api, session, SURFACE } from './api.ts';
import { PERSONAS } from './demo.ts';
import { ClientApp } from './client/ClientApp.tsx';
import { applyLook, applySystemLook } from './look.ts';
import { DeviceFrame, Landing } from './screens/Landing.tsx';
import { StudioPicker } from './screens/StudioPicker.tsx';
import { CourseSite } from './site/CourseSite.tsx';
import { ShopSite } from './site/ShopSite.tsx';
import { StudioSite } from './site/StudioSite.tsx';
import { StaffApp } from './staff/StaffApp.tsx';
import { SiteEditor } from './staff/site-editor/SiteEditor.tsx';
import { Spinner } from './ui.tsx';

export type MeStudio = { id: string; name: string; city: string; logo: string; logoUrl: string | null; logoWide: boolean; accent: string; tagline: string; roles: string[]; look: Look };
export type UserPrefs = {
  occasionsOff?: string[];
  reminderTime?: string | null;
  eveningDays?: number[];
  microBreaks?: string[];
  visibility?: 'public' | 'studio' | 'private';
  language?: 'pl';
  sounds?: boolean;
  appIcon?: string;
  a11y?: { fontScale?: number; contrast?: boolean; reduceMotion?: boolean };
  quiz?: { answers: Record<string, unknown>; takenAt: string };
  goal?: string;
  timePrefs?: string[];
  test?: boolean;
};

export type Me = {
  user: {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    birthday: string | null;
    nameday: string | null;
    themeOptOut: boolean;
    needQuiet: boolean;
    restToday: boolean;
    quietFrom: string;
    quietTo: string;
    pushDisabled: string[];
    prefs: UserPrefs;
    hasAddress: boolean;
    address: { line: string; city: string; zip: string } | null;
    avatarUrl: string | null;
    onboarded: boolean;
  };
  studios: MeStudio[];
};


export function App() {
  // Publiczna strona studia: /s/:slug – bez logowania, dane z /api/public.
  // Strona sprzedażowa kursu: /s/:slug/kurs/:id. Sklep: /s/:slug/sklep i /s/:slug/sklep/:id.
  const coursePage = location.pathname.match(/^\/s\/([^/]+)\/kurs\/([^/]+)/);
  if (coursePage) return <CourseSite slug={decodeURIComponent(coursePage[1])} courseId={decodeURIComponent(coursePage[2])} />;
  const shopPage = location.pathname.match(/^\/s\/([^/]+)\/sklep(?:\/([^/]+))?\/?$/);
  if (shopPage) return <ShopSite slug={decodeURIComponent(shopPage[1])} productId={shopPage[2] ? decodeURIComponent(shopPage[2]) : null} />;
  const site = location.pathname.match(/^\/s\/([^/]+)/);
  if (site) return <StudioSite slug={decodeURIComponent(site[1])} />;
  if (SURFACE === 'home') return <HomeOrDomain />;
  return SURFACE === 'app' ? (
    <DeviceFrame>
      <Surface surface="app" />
    </DeviceFrame>
  ) : (
    <Surface surface="panel" />
  );
}

/**
 * Własna domena studia (www.studio.pl wskazuje na nasz serwer): API rozpoznaje studio po nagłówku Host,
 * a front przechodzi na jego stronę – adres staje się /s/:slug/…, więc działają wszystkie odnośniki strony.
 * Na adresie GLAM (404) zostaje zwykła strona startowa.
 */
function HomeOrDomain() {
  const [state, setState] = useState<'checking' | 'site' | 'home'>('checking');
  useEffect(() => {
    fetch('/api/public/domain')
      .then((r) => (r.ok ? (r.json() as Promise<{ slug: string }>) : null))
      .then((res) => {
        if (!res) return setState('home');
        const rest = location.pathname === '/' ? '' : location.pathname;
        history.replaceState(null, '', `/s/${encodeURIComponent(res.slug)}${rest}${location.search}${location.hash}`);
        setState('site');
      })
      .catch(() => setState('home'));
  }, []);
  if (state === 'checking') return null;
  return state === 'site' ? <App /> : <Landing />;
}

function pickPersona(surface: 'panel' | 'app'): string {
  const asked = new URLSearchParams(location.search).get('jako')?.toLowerCase();
  if (asked && PERSONAS[surface][asked]) return asked;
  if (session.persona && PERSONAS[surface][session.persona]) return session.persona;
  return Object.keys(PERSONAS[surface])[0];
}

function Surface({ surface }: { surface: 'panel' | 'app' }) {
  const [persona] = useState(() => pickPersona(surface));
  const [token, setToken] = useState(session.persona === persona ? session.token : null);
  const [studioId, setStudioId] = useState(session.studioId);
  const [me, setMe] = useState<Me | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Automatyczne logowanie na konto demo (zamiast ekranu z kodem SMS).
  useEffect(() => {
    if (token) return;
    api<{ token: string }>('/dev/login', { method: 'POST', body: { phone: PERSONAS[surface][persona].phone }, global: true })
      .then((res) => {
        session.setPersona(persona);
        session.setToken(res.token);
        setToken(res.token);
      })
      .catch(() => setError('Nie udało się połączyć z API. Czy działa `npm run dev`?'));
  }, [token, persona, surface]);

  const loadMe = useCallback(async () => {
    if (!session.token) return;
    try {
      const data = await api<Me>('/me', { global: true });
      setMe(data);
      // Panel: pierwsze studio, w którym konto ma rolę personelu. Aplikacja: dowolne studio.
      const usable = surface === 'panel' ? data.studios.filter((s) => s.roles.some((r) => r !== 'client')) : data.studios;
      if (!usable.some((s) => s.id === session.studioId)) {
        const first = usable[0]?.id ?? null;
        session.setStudio(first);
        setStudioId(first);
      }
    } catch {
      /* 401 → zdarzenie glam:logout */
    }
  }, [surface]);

  useEffect(() => {
    loadMe();
  }, [token, loadMe]);

  // Wygasła sesja → po prostu logujemy się ponownie.
  useEffect(() => {
    const relogin = () => {
      session.setToken(null);
      setToken(null);
      setMe(null);
    };
    window.addEventListener('glam:logout', relogin);
    return () => window.removeEventListener('glam:logout', relogin);
  }, []);

  const studio = me?.studios.find((s) => s.id === studioId);

  useEffect(() => {
    if (surface === 'panel') applySystemLook();
    else if (!studio) applyLook(null);
  }, [surface, studio]);

  const chooseStudio = (id: string) => {
    session.setStudio(id);
    setStudioId(id);
    setPicking(false);
  };

  if (error) return <div className="empty" style={{ paddingTop: 80 }}>{error}</div>;
  if (!me) return <Spinner />;
  if (!studio || picking) {
    return (
      <StudioPicker
        me={{ ...me, studios: surface === 'panel' ? me.studios.filter((s) => s.roles.some((r) => r !== 'client')) : me.studios }}
        onPick={chooseStudio}
        onJoined={loadMe}
        onLogout={() => {}}
        canClose={!!studio}
        onClose={() => setPicking(false)}
      />
    );
  }
  // Edytor strony WWW: pełny ekran poza menu panelu – z własną bramką uprawnień (layout panelu go nie chroni).
  if (surface === 'panel' && location.pathname.startsWith('/panel/strona')) {
    return can(studio.roles, 'config.edit') ? <SiteEditor key={studioId} /> : <div className="empty" style={{ paddingTop: 80 }}>Edytor strony jest dostępny dla właścicielki studia.</div>;
  }
  if (surface === 'panel') {
    return (
      <StaffApp
        key={studioId}
        me={me}
        studio={studio}
        persona={PERSONAS.panel[persona].label}
        reloadMe={loadMe}
        onSwitchStudio={() => setPicking(true)}
        onPreviewClient={() => window.open('/app', 'glam-app')}
        onLogout={() => {}}
      />
    );
  }
  return <ClientApp key={studioId} me={me} reloadMe={loadMe} onSwitchStudio={() => setPicking(true)} onLogout={() => {}} />;
}
