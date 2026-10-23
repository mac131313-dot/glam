// Tryb demo: dwie powierzchnie pod jednym serwerem, bez ekranu logowania.
//   /panel – panel studia (domyślnie właścicielka Joanna, ma dostęp do wszystkiego)
//   /app   – aplikacja mobilna klientki (domyślnie Magda)
// Inne konto demo: ?jako=marzena, ?jako=kasia, ?jako=ania … (lista w PERSONAS).
// Ekran logowania SMS (screens/Login.tsx) wraca po wyłączeniu DEMO_MODE.
import { useCallback, useEffect, useState } from 'react';
import { can, type Look } from '@glam/core';
import { api, session, SURFACE } from './api.ts';
import { PERSONAS } from './demo.ts';
import { applyLook, applySystemLook } from './look.ts';
import { DeviceFrame, Landing } from './screens/Landing.tsx';
import { StudioPicker } from './screens/StudioPicker.tsx';
import { Lazy, lazyRetry, Spinner } from './ui.tsx';

// Każda powierzchnia osobno, na żądanie: klientka nie pobiera panelu studia ani stron WWW (i odwrotnie).
const ClientApp = lazyRetry(() => import('./client/ClientApp.tsx').then((m) => ({ default: m.ClientApp })));
const StaffApp = lazyRetry(() => import('./staff/StaffApp.tsx').then((m) => ({ default: m.StaffApp })));
const SiteEditor = lazyRetry(() => import('./staff/site-editor/SiteEditor.tsx').then((m) => ({ default: m.SiteEditor })));
const CourseSite = lazyRetry(() => import('./site/CourseSite.tsx').then((m) => ({ default: m.CourseSite })));
const ShopSite = lazyRetry(() => import('./site/ShopSite.tsx').then((m) => ({ default: m.ShopSite })));
const StudioSite = lazyRetry(() => import('./site/StudioSite.tsx').then((m) => ({ default: m.StudioSite })));
const KonsolaApp = lazyRetry(() => import('./konsola/KonsolaApp.tsx').then((m) => ({ default: m.KonsolaApp })));
const StartSite = lazyRetry(() => import('./site/StartSite.tsx').then((m) => ({ default: m.StartSite })));

export type MeStudio = { id: string; name: string; city: string; logo: string; logoUrl: string | null; logoWide: boolean; accent: string; tagline: string; roles: string[]; look: Look; panelTint?: string };
export type UserPrefs = {
  occasionsOff?: string[];
  reminderTime?: string | null;
  eveningDays?: number[];
  microBreaks?: string[];
  classReminders?: number[];
  visibility?: 'public' | 'studio' | 'private';
  language?: 'pl';
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
  if (coursePage) return <Lazy><CourseSite slug={decodeURIComponent(coursePage[1])} courseId={decodeURIComponent(coursePage[2])} /></Lazy>;
  const shopPage = location.pathname.match(/^\/s\/([^/]+)\/sklep(?:\/([^/]+))?\/?$/);
  if (shopPage) return <Lazy><ShopSite slug={decodeURIComponent(shopPage[1])} productId={shopPage[2] ? decodeURIComponent(shopPage[2]) : null} /></Lazy>;
  const site = location.pathname.match(/^\/s\/([^/]+)/);
  if (site) return <Lazy><StudioSite slug={decodeURIComponent(site[1])} /></Lazy>;
  // Publiczny cennik i rejestracja studia: /start – przed stroną startową, bez udziału powierzchni (SURFACE zostaje „home”).
  if (/^\/start(\/|$)/.test(location.pathname)) return <Lazy><StartSite /></Lazy>;
  if (SURFACE === 'konsola') return <Lazy><KonsolaApp /></Lazy>;
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

/** Persona zapisana przez /start: właścicielka nowego studia ma własny token, nie konto demo. */
const SIGNUP = 'signup';
const defaultPersona = (surface: 'panel' | 'app') => Object.keys(PERSONAS[surface])[0];

function pickPersona(surface: 'panel' | 'app'): string {
  const asked = new URLSearchParams(location.search).get('jako')?.toLowerCase();
  if (asked && PERSONAS[surface][asked]) return asked;
  if (surface === 'panel' && session.persona === SIGNUP && session.token) return SIGNUP;
  if (session.persona && PERSONAS[surface][session.persona]) return session.persona;
  return defaultPersona(surface);
}

/** Wylogowanie właścicielki z /start (konta demo nie mają wylogowania): kasujemy sesję panelu i wracamy na stronę startową. */
function signOutOwner() {
  // Zwykły fetch, nie api(): odrzucony token nie ma tu wywołać ponownego logowania na konto demo.
  fetch('/api/auth/logout', { method: 'POST', headers: { authorization: `Bearer ${session.token}` } })
    .catch(() => {})
    .finally(() => {
      session.setToken(null);
      session.setPersona(null);
      session.setStudio(null);
      location.href = '/start';
    });
}

function Surface({ surface }: { surface: 'panel' | 'app' }) {
  const [persona, setPersona] = useState(() => pickPersona(surface));
  const [token, setToken] = useState(session.persona === persona ? session.token : null);
  const [studioId, setStudioId] = useState(session.studioId);
  const [me, setMe] = useState<Me | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Automatyczne logowanie na konto demo (zamiast ekranu z kodem SMS).
  useEffect(() => {
    if (token || persona === SIGNUP) return;
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
      // Sesja właścicielki z /start wygasła: wracamy do konta demo (jednorazowo – dalej działa zwykłe logowanie demo).
      setPersona((p) => (p === SIGNUP ? defaultPersona(surface) : p));
    };
    window.addEventListener('glam:logout', relogin);
    return () => window.removeEventListener('glam:logout', relogin);
  }, [surface]);

  const studio = me?.studios.find((s) => s.id === studioId);

  useEffect(() => {
    if (surface === 'panel') applySystemLook(studio?.panelTint);
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
    return can(studio.roles, 'config.edit') ? <Lazy><SiteEditor key={studioId} /></Lazy> : <div className="empty" style={{ paddingTop: 80 }}>Edytor strony jest dostępny dla właścicielki studia.</div>;
  }
  if (surface === 'panel') {
    return (
      <Lazy>
      <StaffApp
        key={studioId}
        me={me}
        studio={studio}
        persona={persona === SIGNUP ? undefined : PERSONAS.panel[persona].label}
        reloadMe={loadMe}
        onSwitchStudio={() => setPicking(true)}
        onPreviewClient={() => window.open('/app', 'glam-app')}
        onLogout={persona === SIGNUP ? signOutOwner : () => {}}
      />
      </Lazy>
    );
  }
  return <Lazy><ClientApp key={studioId} me={me} reloadMe={loadMe} onSwitchStudio={() => setPicking(true)} onLogout={() => {}} /></Lazy>;
}
