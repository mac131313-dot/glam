// Panele ról (3, 2.1): menu budowane z siatki uprawnień (core/roles.ts) – to samo, co sprawdza serwer.
// Pokrewne ekrany to zakładki jednej sekcji (Recepcja: Przegląd/Kasa, Pulpit: Przegląd/KPI, Grafik: sale/zastępstwa),
// żeby menu było krótkie. Adres: #sekcja albo #sekcja/zakładka; dawne #entrance, #desk, #analytics, #extras działają dalej.
// Wiadomości łączą dawne Rozmowy (#groups): wątki z klientkami i grupami oraz wiadomość do grupy.
// Właścicielka: wszystko (panel w stylu Shopify); pozostałe role widzą tylko to, na co pozwala siatka uprawnień.
import { lazy, Suspense, useEffect, useState } from 'react';
import { can, ROLE_LABEL, type Permission, type Role } from '@glam/core';
import type { Me, MeStudio } from '../App.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { StudioBrand } from '../StudioBrand.tsx';
import { Select, Spinner, Tabs, Watermark } from '../ui.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Desk } from './Desk.tsx';
import { Entrance, Passes } from './Entrance.tsx';
import { LookEditor } from './LookEditor.tsx';
import { Products } from './Products.tsx';
import { ClassTypesAdmin, ScheduleAdmin } from './ScheduleAdmin.tsx';
import { Today } from './Today.tsx';
import { Welcomes } from './Welcomes.tsx';
import { SiteOverview } from './site-editor/SiteOverview.tsx';

const Analytics = lazy(() => import('./Analytics.tsx'));
const Clients = lazy(() => import('./Clients.tsx'));
const Messages = lazy(() => import('./Messages.tsx'));
const ScheduleExtras = lazy(() => import('./ScheduleExtras.tsx'));
const Gifts = lazy(() => import('./Gifts.tsx'));
const ShopAdmin = lazy(() => import('./ShopAdmin.tsx'));
const EventsAdmin = lazy(() => import('./EventsAdmin.tsx'));
const CreatorStudio = lazy(() => import('./CreatorStudio.tsx'));
const CommunityAdmin = lazy(() => import('./CommunityAdmin.tsx'));
const MusicAdmin = lazy(() => import('./MusicAdmin.tsx'));
const Marketing = lazy(() => import('./Marketing.tsx'));
const LoyaltyAdmin = lazy(() => import('./LoyaltyAdmin.tsx'));
const Finance = lazy(() => import('./Finance.tsx'));
const Settings = lazy(() => import('./Settings.tsx'));
const TrainerProfile = lazy(() => import('./TrainerProfile.tsx'));

/** Zakładka sekcji – ekran pokazywany pod paskiem zakładek, jeśli rola ma do niego uprawnienie. */
type Tab = { id: string; label: string; perms: Permission[] };
/** role – sekcja tylko dla osób z tą rolą (np. profil trenerki nie dotyczy właścicielki, która nie prowadzi zajęć).
 *  tabs – sekcja złożona z kilku ekranów; widoczna, gdy widać choć jedną zakładkę. */
type Section = { id: string; label: string; icon: IconName; perms: Permission[]; group: string; role?: Role; tabs?: Tab[] };
const SECTIONS: Section[] = [
  {
    id: 'dashboard',
    label: 'Pulpit',
    icon: 'chart',
    perms: ['finance.view'],
    group: 'Codziennie',
    tabs: [
      { id: 'overview', label: 'Przegląd', perms: ['finance.view'] },
      { id: 'kpi', label: 'KPI', perms: ['finance.view'] },
    ],
  },
  {
    id: 'reception',
    label: 'Recepcja',
    icon: 'ticket',
    perms: ['participants.manage', 'desk.sell'],
    group: 'Codziennie',
    tabs: [
      { id: 'entrance', label: 'Przegląd', perms: ['participants.manage'] },
      { id: 'desk', label: 'Kasa', perms: ['desk.sell'] },
    ],
  },
  { id: 'passes', label: 'Wejściówki', icon: 'qr', perms: ['participants.manage'], group: 'Codziennie' },
  { id: 'today', label: 'Dziś', icon: 'sun', perms: ['day.own'], group: 'Codziennie' },
  { id: 'clients', label: 'Klientki', icon: 'people', perms: ['clients.view', 'notes.write'], group: 'Codziennie' },
  { id: 'messages', label: 'Wiadomości', icon: 'chat', perms: ['messages.group.own', 'messages.group.all', 'chat.answer', 'community.moderate'], group: 'Codziennie' },
  {
    id: 'schedule',
    label: 'Grafik',
    icon: 'calendar',
    perms: ['schedule.edit', 'schedule.view'],
    group: 'Codziennie',
    tabs: [
      { id: 'plan', label: 'Grafik i sale', perms: ['schedule.edit'] },
      { id: 'extras', label: 'Zastępstwa i specjalne', perms: ['schedule.view'] },
      { id: 'types', label: 'Typy zajęć', perms: ['schedule.edit'] },
    ],
  },
  { id: 'welcomes', label: 'Powitania', icon: 'mail', perms: ['welcomes.write', 'welcomes.approve'], group: 'Relacje' },
  { id: 'profile', label: 'Mój profil', icon: 'user', perms: ['day.own'], group: 'Relacje', role: 'trainer' },
  { id: 'gifts', label: 'Kartki i vouchery', icon: 'pen', perms: ['cards.write', 'cards.manage'], group: 'Relacje' },
  { id: 'events', label: 'Wydarzenia', icon: 'sparkle', perms: ['events.manage', 'day.own'], group: 'Relacje' },
  {
    id: 'marketing',
    label: 'Marketing',
    icon: 'bell',
    perms: ['campaigns.edit', 'loyalty.edit'],
    group: 'Relacje',
    tabs: [
      { id: 'campaigns', label: 'Kampanie i życzenia', perms: ['campaigns.edit'] },
      { id: 'loyalty', label: 'Lojalność', perms: ['loyalty.edit'] },
    ],
  },
  { id: 'courses', label: 'Kursy', icon: 'cap', perms: ['courses.create', 'courses.approve'], group: 'Treści' },
  {
    id: 'community',
    label: 'Społeczność',
    icon: 'heart',
    perms: ['community.moderate', 'challenges.edit', 'playlists.moderate'],
    group: 'Treści',
    tabs: [
      { id: 'moderation', label: 'Społeczność', perms: ['community.moderate', 'challenges.edit'] },
      { id: 'music', label: 'Muzyka', perms: ['playlists.moderate'] },
    ],
  },
  { id: 'shop', label: 'Sklep', icon: 'bag', perms: ['shop.manage'], group: 'Sprzedaż' },
  { id: 'products', label: 'Karnety', icon: 'ticket', perms: ['config.edit'], group: 'Sprzedaż' },
  { id: 'finance', label: 'Finanse', icon: 'card', perms: ['finance.view', 'finance.export'], group: 'Sprzedaż' },
  {
    id: 'brand',
    label: 'Marka',
    icon: 'type',
    perms: ['config.edit'],
    group: 'Studio',
    tabs: [
      { id: 'look', label: 'Wygląd', perms: ['config.edit'] },
      { id: 'site', label: 'Strona WWW', perms: ['config.edit'] },
    ],
  },
  { id: 'settings', label: 'Ustawienia', icon: 'settings', perms: ['config.edit'], group: 'Studio' },
];

/** Dawne sekcje, dziś zakładki – stare linki i zakładki przeglądarki trafiają we właściwe miejsce. */
const ALIASES: Record<string, string> = {
  entrance: 'reception/entrance',
  desk: 'reception/desk',
  analytics: 'dashboard/kpi',
  extras: 'schedule/extras',
  groups: 'messages',
  look: 'brand/look',
  site: 'brand/site',
  themes: 'brand/look',
  music: 'community/music',
  loyalty: 'marketing/loyalty',
};

export function StaffApp(props: { me: Me; studio: MeStudio; persona?: string; reloadMe: () => Promise<void>; onSwitchStudio: () => void; onPreviewClient: () => void; onLogout: () => void }) {
  const roles = props.studio.roles as Role[];
  const allowed = (perms: Permission[]) => perms.some((p) => can(roles, p));
  const tabsOf = (s: Section) => (s.tabs ?? []).filter((t) => allowed(t.perms));
  const visible = SECTIONS.filter((s) => allowed(s.perms) && (!s.role || roles.includes(s.role)) && (!s.tabs || tabsOf(s).length > 0));
  const fallback = visible[0]?.id ?? 'today';
  /** „sekcja” albo „sekcja/zakładka” (także dawne id z ALIASES) → miejsce, które ta rola może zobaczyć. */
  const resolve = (raw: string) => {
    const [id, tabId] = (ALIASES[raw] ?? raw).split('/');
    const sec = visible.find((s) => s.id === id) ?? visible.find((s) => s.id === fallback);
    const tabs = sec ? tabsOf(sec) : [];
    const tab = tabs.find((t) => t.id === tabId)?.id ?? tabs[0]?.id;
    return tab ? `${sec?.id ?? fallback}/${tab}` : (sec?.id ?? fallback);
  };
  const [place, setPlace] = useState(() => resolve(location.hash.slice(1)));
  const [section, tab] = place.split('/');
  const setSection = (raw: string) => {
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
  const current = visible.find((s) => s.id === section);
  const tabs = current ? tabsOf(current) : [];
  const mainRole = (['owner', 'reception', 'coordinator', 'trainer'] as Role[]).find((r) => roles.includes(r))!;
  const groups = [...new Set(visible.map((s) => s.group))];

  return (
    <div className="staff with-watermark">
      <Watermark src={props.studio.look.watermark} />
      <aside className="side" aria-label="Menu panelu">
        <div style={{ padding: '4px 12px 14px' }}>
          <div className="cobrand" aria-label={`glam × ${props.studio.name}`}>
            <span className="wordmark" style={{ fontSize: '1.7rem' }}>
              glam
            </span>
            <span className="cobrand-x" aria-hidden="true">
              ×
            </span>
            <span className="cobrand-name">{props.studio.name}</span>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g} className="side-group">
            <div className="side-group-label">{g}</div>
            {visible
              .filter((s) => s.group === g)
              .map((s) => (
                <button key={s.id} className="side-link" aria-current={section === s.id ? 'page' : undefined} onClick={() => s.id !== section && setSection(s.id)}>
                  <Icon name={s.icon} size={18} /> {s.label}
                </button>
              ))}
          </div>
        ))}
        <div style={{ flex: 1, minHeight: 16 }} />
        <button className="side-link" onClick={props.onPreviewClient}>
          <Icon name="phone" size={18} /> Aplikacja mobilna
        </button>
        {!props.persona && (
          <button className="side-link" onClick={props.onLogout}>
            <Icon name="out" size={18} /> Wyloguj
          </button>
        )}
        <div style={{ padding: '14px 12px 4px' }}>
          <button className="studio-chip" onClick={props.onSwitchStudio} title="Zmień studio">
            <StudioBrand studio={props.studio} showName={false} />
            <span className="small muted">Zmień studio</span>
          </button>
          <div className="tiny muted" style={{ marginTop: 10, paddingLeft: 4 }}>
            {props.me.user.name} · {ROLE_LABEL[mainRole]}
            {props.persona && (
              <>
                <br />
                <a href="/" style={{ color: 'var(--muted)' }}>
                  tryb demo · zmień konto
                </a>
              </>
            )}
          </div>
        </div>
      </aside>
      <nav className="mobile-nav" aria-label="Menu panelu">
        <div className="wordmark" style={{ fontSize: '1.5rem' }}>
          glam
        </div>
        <Select
          className="grow"
          ariaLabel="Sekcja panelu"
          value={section}
          onChange={setSection}
          options={groups.flatMap((g) => visible.filter((s) => s.group === g).map((s) => ({ value: s.id, label: s.label, group: g })))}
        />
        <button className="studio-chip" onClick={props.onSwitchStudio} aria-label={`Studio ${props.studio.name} – zmień`}>
          <StudioBrand studio={props.studio} showName={false} />
        </button>
      </nav>
      <main className="main">
        {current && tabs.length > 1 && (
          <div style={{ marginBottom: 20 }}>
            <Tabs label={current.label} value={tab} onChange={(t) => setSection(`${current.id}/${t}`)} options={tabs.map((t) => [t.id, t.label])} />
          </div>
        )}
        <Suspense fallback={<Spinner />}>
          {place === 'dashboard/overview' && <Dashboard go={setSection} />}
          {place === 'dashboard/kpi' && <Analytics />}
          {place === 'reception/entrance' && <Entrance roles={roles} go={setSection} />}
          {place === 'reception/desk' && <Desk />}
          {section === 'passes' && <Passes />}
          {section === 'today' && <Today roles={roles} />}
          {section === 'clients' && <Clients roles={roles} />}
          {section === 'messages' && <Messages roles={roles} />}
          {section === 'welcomes' && <Welcomes me={props.me} isOwner={roles.includes('owner')} />}
          {section === 'profile' && <TrainerProfile me={props.me} reloadMe={props.reloadMe} />}
          {section === 'gifts' && <Gifts roles={roles} />}
          {section === 'events' && <EventsAdmin roles={roles} />}
          {place === 'schedule/plan' && <ScheduleAdmin />}
          {place === 'schedule/extras' && <ScheduleExtras roles={roles} />}
          {place === 'schedule/types' && <ClassTypesAdmin />}
          {section === 'courses' && <CreatorStudio roles={roles} />}
          {place === 'community/moderation' && <CommunityAdmin />}
          {place === 'community/music' && <MusicAdmin />}
          {place === 'marketing/campaigns' && <Marketing />}
          {place === 'marketing/loyalty' && <LoyaltyAdmin />}
          {section === 'shop' && <ShopAdmin />}
          {section === 'products' && <Products />}
          {section === 'finance' && <Finance roles={roles} />}
          {section === 'settings' && <Settings studio={props.studio} onSaved={props.reloadMe} />}
          {place === 'brand/look' && <LookEditor studio={props.studio} onSaved={props.reloadMe} />}
          {place === 'brand/site' && <SiteOverview />}
        </Suspense>
      </main>
    </div>
  );
}
