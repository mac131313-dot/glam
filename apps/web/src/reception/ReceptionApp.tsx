// Aplikacja mobilna – konto firmowe recepcji. Osobna powierzchnia, bez zakładek klientki
// (karnety, „Dla mnie”, społeczność): Start, Grafik, Wejście (skaner), Wiadomości i Profil konta studia.
import { useEffect, useState } from 'react';
import { setStudioTimezone, useApi } from '../api.ts';
import type { Me, MeStudio } from '../App.tsx';
import { useLayer } from '../back.ts';
import { Icon, type IconName } from '../icons.tsx';
import { applyLook } from '../look.ts';
import { StudioBrand } from '../StudioBrand.tsx';
import { ReceptionEntrance } from './Entrance.tsx';
import { ReceptionMessages } from './Messages.tsx';
import { ReceptionProfile } from './Profile.tsx';
import { ReceptionSchedule } from './Schedule.tsx';
import { ReceptionStart } from './Start.tsx';

type Tab = 'start' | 'schedule' | 'entrance' | 'messages' | 'profile';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'start', label: 'Start', icon: 'home' },
  { id: 'schedule', label: 'Grafik', icon: 'calendar' },
  { id: 'entrance', label: 'Wejście', icon: 'qr' },
  { id: 'messages', label: 'Wiadomości', icon: 'chat' },
  { id: 'profile', label: 'Profil', icon: 'user' },
];

export function ReceptionApp(props: { me: Me; studio: MeStudio; onSwitchStudio: () => void }) {
  // Dotknięcie powiadomienia: /app?go=messages – od razu właściwa zakładka.
  const [tab, setTab] = useState<Tab>(() => {
    const go = new URLSearchParams(location.search).get('go');
    return TABS.some((t) => t.id === go) ? (go as Tab) : 'start';
  });
  // Kropka przy Wiadomościach: ten sam licznik co „Rozmowy (n)”; odświeżany co minutę, po powrocie do aplikacji
  // i przy każdej zmianie zakładki (np. po odpisaniu w Wiadomościach znika od razu po wyjściu).
  const threads = useApi<{ unread: number }>('/staff/threads');
  const reloadThreads = threads.reload;
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && reloadThreads();
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => (clearInterval(t), document.removeEventListener('visibilitychange', tick));
  }, [reloadThreads]);
  useEffect(() => {
    reloadThreads();
  }, [tab, reloadThreads]);
  const unread = threads.data?.unread ?? 0;
  // Godziny zajęć w strefie studia, nie telefonu.
  const { data: tz } = useApi<{ timezone: string }>('/studio');
  if (tz) setStudioTimezone(tz.timezone);

  useEffect(() => {
    applyLook(props.studio.look);
  }, [props.studio]);

  // Nowa zakładka zaczyna się od góry.
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.querySelector('.device-scroll')?.scrollTo({ top: 0 });
  }, [tab]);

  return (
    <div className="phone" data-tab={tab}>
      <header className="topbar">
        <button className="studio-chip" onClick={props.onSwitchStudio} aria-label={`Studio ${props.studio.name}. Zmień studio`}>
          <StudioBrand studio={props.studio} />
          <span className="muted" style={{ display: 'grid' }}>
            <Icon name="down" size={16} />
          </span>
        </button>
        <span className="tiny muted">Recepcja</span>
      </header>
      <main className="content">
        {tab === 'start' ? <ReceptionStart go={setTab} /> : tab === 'schedule' ? <ReceptionSchedule /> : tab === 'entrance' ? <ReceptionEntrance /> : tab === 'messages' ? <ReceptionMessages roles={props.studio.roles} /> : <ReceptionProfile me={props.me} />}
      </main>
      <nav className="tabbar" aria-label="Główna nawigacja">
        {TABS.map((t) => (
          <button
            key={t.id}
            className="tab"
            aria-current={tab === t.id ? 'page' : undefined}
            aria-label={t.id === 'messages' && unread ? `${t.label}, nieprzeczytane: ${unread}` : undefined}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} />
            {t.id === 'messages' && unread > 0 && <span className="tab-dot" aria-hidden="true" />}
            {t.label}
          </button>
        ))}
      </nav>
      {tab !== 'start' && <BackToStart onBack={() => setTab('start')} />}
    </div>
  );
}

/** Jak u klientki: na innej zakładce Wstecz telefonu wraca na Start, a dopiero stamtąd wychodzi z aplikacji. */
function BackToStart({ onBack }: { onBack: () => void }) {
  useLayer(onBack);
  return null;
}
