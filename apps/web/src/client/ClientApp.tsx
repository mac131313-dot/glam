import { createContext, useContext, useEffect, useState } from 'react';
import type { Look, SupportHours } from '@glam/core';
import { api, setStudioTimezone, useApi } from '../api.ts';
import { useLayer } from '../back.ts';
import type { Me } from '../App.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { applyLook } from '../look.ts';
import { StudioBrand } from '../StudioBrand.tsx';
import { BreathPlayer, type BreathRequest } from './BreathPlayer.tsx';
import { AfterClassFeelings } from './Feelings.tsx';
import { Pending, Spinner, useToast } from '../ui.tsx';
import { Community } from './Community.tsx';
import { ForMe } from './ForMe.tsx';
import { Profile } from './Profile.tsx';
import { PurchaseSheet } from './PurchaseSheet.tsx';
import { Schedule } from './Schedule.tsx';
import { Start } from './Start.tsx';
import { normalizeRoute, RouteView } from './router.tsx';
import { Onboarding } from './Onboarding.tsx';

export type Studio = {
  id: string;
  name: string;
  city: string;
  timezone: string;
  tagline: string;
  logo: string;
  logoUrl: string | null;
  logoWide: boolean;
  accent: string;
  look: Look;
  phone: string;
  inviteCode: string;
  guestPassPrice: string;
  roles: string[];
  policy: { cancelMinutesBefore: number; closesMinutesBefore: number };
  trainers: { id: string; name: string; bio: string; avatarUrl?: string | null }[];
  email?: string | null;
  address?: string | null;
  regulations?: string | null;
  features: string[];
  guestPassVariants: { id: string; label: string; price: string; priceGrosze: number; entries: number }[];
  guestPassValidityDays: number;
  referral: { enabled: boolean; friendFirstClassFree: boolean; inviterBonusEntries: number; monthlyCap: number };
  freeze: { maxTimes: number; maxDays: number };
  support: { hours: SupportHours; faq: { q: string; a: string }[] };
  events: { enabled: boolean; regulations: string; minNoticeDays: number; kinds: { id: string; label: string; hero: string }[] };
  loyalty: { enabled: boolean; levels: { id: string; name: string; minPoints: number }[]; points: Record<string, number> };
  reward: { enabled: boolean; every: number; defaultItem: string };
  shop: { reservationDays: number; shipping: boolean };
};

/** Czy funkcja jest włączona w planie / flagach studia (1.2.11). */
export const hasFeature = (s: Pick<Studio, 'features'>, f: string) => s.features?.includes(f);

export type Tab = 'start' | 'schedule' | 'forme' | 'community' | 'profile';

type ClientCtx = {
  studio: Studio;
  me: Me;
  reloadMe: () => Promise<void>;
  reloadStudio: () => Promise<void>;
  go: (t: Tab) => void;
  openShop: (reason?: string, highlight?: string[]) => void;
  openBreath: (req: BreathRequest) => void;
  /** Sesja oddechu jest otwarta – animacje pod nią mogą stanąć. */
  breathOpen: boolean;
  /** Podstrona (karnety, kurs, sklep…) – stos nad zakładkami. */
  open: (route: string) => void;
  /** Akcja z powiadomienia (np. „profile/passes”) – zakładka albo podstrona. */
  follow: (action: string | null | undefined) => void;
  onSwitchStudio: () => void;
  onLogout: () => void;
};
const Ctx = createContext<ClientCtx>(null as unknown as ClientCtx);
export const useClient = () => useContext(Ctx);

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'start', label: 'Start', icon: 'home' },
  { id: 'schedule', label: 'Grafik', icon: 'calendar' },
  { id: 'forme', label: 'Dla mnie', icon: 'leaf' },
  { id: 'community', label: 'Razem', icon: 'heart' },
  { id: 'profile', label: 'Profil', icon: 'user' },
];

export function ClientApp(props: { me: Me; reloadMe: () => Promise<void>; onSwitchStudio: () => void; onLogout: () => void; onBackToStaff?: () => void }) {
  const { data: studio, error, reload } = useApi<Studio>('/studio');
  const [tab, setTab] = useState<Tab>('start');
  const [shop, setShop] = useState<{ reason?: string; highlight?: string[] } | null>(null);
  const [breath, setBreath] = useState<BreathRequest | null>(null);
  const [stack, setStack] = useState<string[]>([]);
  const toast = useToast();

  // Link z powiadomienia push / z kodu QR: /app?go=course/co1
  useEffect(() => {
    const go = new URLSearchParams(location.search).get('go');
    if (go) follow(go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Powrót ze Stripe Checkout: /app?checkout=cs_… – webhook zwykle dociera w kilka sekund, więc chwilę pytamy o wynik.
  // Parametr znika z adresu przy pierwszym odczycie, więc podwójny efekt (StrictMode) nie pyta dwa razy.
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('checkout');
    if (!id) return;
    history.replaceState(null, '', location.pathname);
    if (id === 'cancelled') return toast('Płatność przerwana – możesz wrócić do zakupu w każdej chwili.');
    (async () => {
      for (let i = 0; i < 10; i++) {
        const res = await api<{ kind: string; status: string; message: string }>(`/checkout/${encodeURIComponent(id)}`).catch(() => null);
        if (res && res.status !== 'open') {
          toast(res.message, res.status === 'paid' ? undefined : 'error');
          if (res.status === 'paid' && res.kind === 'pass') window.dispatchEvent(new Event('glam:passes-changed'));
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      toast('Czekamy jeszcze na potwierdzenie z banku – damy znać powiadomieniem, gdy wszystko będzie gotowe.');
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nowa zakładka zaczyna się od góry, a nie w miejscu, do którego przewinięto poprzednią.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector('.device-scroll')?.scrollTo({ top: 0 });
  }, [tab]);

  // Dostępność (sekcja 10): rozmiar tekstu, wysoki kontrast, ograniczenie ruchu – ustawienia klientki.
  useEffect(() => {
    const a = props.me.user.prefs?.a11y ?? {};
    const root = document.documentElement;
    root.style.fontSize = a.fontScale ? `${a.fontScale * 100}%` : '';
    root.classList.toggle('a11y-contrast', !!a.contrast);
    root.classList.toggle('a11y-reduce', !!a.reduceMotion);
  }, [props.me.user.prefs]);

  // Wygląd studia.
  useEffect(() => {
    if (studio) applyLook(studio.look);
  }, [studio]);

  function follow(action: string | null | undefined) {
    if (!action) return;
    const r = normalizeRoute(action);
    if (r.tab) setTab(r.tab as Tab);
    if (r.route) setStack((st) => [...st, r.route!]);
  }

  if (!studio) return <Pending error={error} reload={reload} />;
  // Przed renderem zakładek: grafik i karnety formatują godziny w strefie studia.
  setStudioTimezone(studio.timezone);
  if (!props.me.user.onboarded) return <Onboarding studio={studio} me={props.me} onDone={props.reloadMe} />;

  const ctx: ClientCtx = {
    studio,
    me: props.me,
    reloadMe: props.reloadMe,
    reloadStudio: reload,
    go: setTab,
    openShop: (reason, highlight) => setShop({ reason, highlight }),
    openBreath: setBreath,
    breathOpen: !!breath,
    open: (route) => setStack((st) => [...st, route]),
    follow,
    onSwitchStudio: props.onSwitchStudio,
    onLogout: props.onLogout,
  };

  return (
    <Ctx.Provider value={ctx}>
      <div className="phone" data-tab={tab}>
        <header className="topbar">
          <button className="studio-chip" onClick={props.onSwitchStudio} aria-label={`Studio ${studio.name}. Zmień studio`}>
            <StudioBrand studio={studio} />
            <span className="muted" style={{ display: 'grid' }}>
              <Icon name="down" size={16} />
            </span>
          </button>
          {props.onBackToStaff && (
            <button className="btn quiet sm" onClick={props.onBackToStaff}>
              <Icon name="back" size={16} /> Panel
            </button>
          )}
        </header>
        <main className="content">
          {tab === 'start' && <Start />}
          {tab === 'schedule' && <Schedule />}
          {tab === 'forme' && <ForMe />}
          {tab === 'community' && <Community />}
          {tab === 'profile' && <Profile />}
        </main>
        <nav className="tabbar" aria-label="Główna nawigacja">
          {TABS.map((t) => (
            <button key={t.id} className="tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} />
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {tab !== 'start' && <BackToStart onBack={() => setTab('start')} />}
      {stack.map((route, i) => (
        // Warstwa musi być prawdziwym pudełkiem. `display: contents` przepuszczało kliknięcia –
        // katalog było widać, ale karta produktu nie dostawała zdarzenia.
        <div key={`${route}-${i}`} className="route-layer" style={{ display: i === stack.length - 1 ? 'flex' : 'none', zIndex: 40 + i }}>
          <RouteView route={route} close={() => setStack((st) => st.slice(0, i))} open={ctx.open} />
        </div>
      ))}
      {/* Ankieta po treningu – czeka, aż klientka skończy oddech i zamknie podstronę. */}
      <AfterClassFeelings paused={!!breath || !!shop || stack.length > 0} />
      {breath && <BreathPlayer request={breath} onClose={() => setBreath(null)} />}
      {shop && <PurchaseSheet reason={shop.reason} highlight={shop.highlight} onClose={() => setShop(null)} />}
    </Ctx.Provider>
  );
}

/** Na innej zakładce niż Start przycisk Wstecz telefonu wraca na Start, a dopiero stamtąd wychodzi z aplikacji. */
function BackToStart({ onBack }: { onBack: () => void }) {
  useLayer(onBack);
  return null;
}
