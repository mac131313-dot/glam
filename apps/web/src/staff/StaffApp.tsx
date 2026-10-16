// Panele ról (3, 2.1): menu budowane z siatki uprawnień (core/roles.ts) – to samo, co sprawdza serwer.
// Trenerka: Dziś · Rozmowy (grupy i wiadomości od klientek) · Klientki · Wiadomości · Powitania · Mój profil · Kursy · Kartki · Mój grafik.
// Recepcja: Wejście · Dziś · Klientki · Grafik · Wiadomości · Kasa · Sklep · Wydarzenia.
// Koordynatorka: Społeczność · Edycje sezonowe · Muzyka. Właścicielka: wszystko (panel w stylu Shopify).
import { lazy, Suspense, useEffect, useState } from 'react';
import { can, ROLE_LABEL, type Permission, type Role } from '@glam/core';
import type { Me, MeStudio } from '../App.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { StudioBrand } from '../StudioBrand.tsx';
import { Select, Spinner, Watermark } from '../ui.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Desk } from './Desk.tsx';
import { Entrance } from './Entrance.tsx';
import { LookEditor } from './LookEditor.tsx';
import { Products } from './Products.tsx';
import { ScheduleAdmin } from './ScheduleAdmin.tsx';
import { Themes } from './Themes.tsx';
import { Today } from './Today.tsx';
import { Welcomes } from './Welcomes.tsx';
import { SiteOverview } from './site-editor/SiteOverview.tsx';

const Analytics = lazy(() => import('./Analytics.tsx'));
const Clients = lazy(() => import('./Clients.tsx'));
const Messages = lazy(() => import('./Messages.tsx'));
const GroupChats = lazy(() => import('./GroupChats.tsx'));
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

/** role – sekcja tylko dla osób z tą rolą (np. profil trenerki nie dotyczy właścicielki, która nie prowadzi zajęć). */
type Section = { id: string; label: string; icon: IconName; perms: Permission[]; group: string; role?: Role };
const SECTIONS: Section[] = [
  { id: 'dashboard', label: 'Pulpit', icon: 'chart', perms: ['finance.view'], group: 'Studio' },
  { id: 'analytics', label: 'Analityka i KPI', icon: 'chart', perms: ['finance.view'], group: 'Studio' },
  { id: 'entrance', label: 'Wejście', icon: 'ticket', perms: ['participants.manage'], group: 'Codziennie' },
  { id: 'today', label: 'Dziś', icon: 'sun', perms: ['day.own', 'day.all'], group: 'Codziennie' },
  { id: 'groups', label: 'Rozmowy', icon: 'chat', perms: ['messages.group.own', 'community.moderate'], group: 'Codziennie' },
  { id: 'clients', label: 'Klientki', icon: 'people', perms: ['clients.view', 'notes.write'], group: 'Codziennie' },
  { id: 'messages', label: 'Wiadomości', icon: 'chat', perms: ['messages.group.own', 'messages.group.all', 'chat.answer'], group: 'Codziennie' },
  { id: 'desk', label: 'Kasa i wejściówki', icon: 'gift', perms: ['desk.sell'], group: 'Codziennie' },
  { id: 'welcomes', label: 'Powitania', icon: 'mail', perms: ['welcomes.write', 'welcomes.approve'], group: 'Relacje' },
  { id: 'profile', label: 'Mój profil', icon: 'user', perms: ['day.own'], group: 'Relacje', role: 'trainer' },
  { id: 'gifts', label: 'Kartki i vouchery', icon: 'pen', perms: ['cards.write', 'cards.manage'], group: 'Relacje' },
  { id: 'events', label: 'Wydarzenia', icon: 'sparkle', perms: ['events.manage', 'day.own'], group: 'Relacje' },
  { id: 'schedule', label: 'Grafik i sale', icon: 'grid', perms: ['schedule.edit'], group: 'Grafik' },
  { id: 'extras', label: 'Zastępstwa i specjalne', icon: 'calendar', perms: ['schedule.view'], group: 'Grafik' },
  { id: 'courses', label: 'Kursy', icon: 'cap', perms: ['courses.create', 'courses.approve'], group: 'Treści' },
  { id: 'community', label: 'Społeczność', icon: 'heart', perms: ['community.moderate', 'challenges.edit'], group: 'Treści' },
  { id: 'music', label: 'Muzyka', icon: 'music', perms: ['playlists.moderate'], group: 'Treści' },
  { id: 'themes', label: 'Edycje sezonowe', icon: 'season', perms: ['themes.edit'], group: 'Marketing' },
  { id: 'marketing', label: 'Kampanie i życzenia', icon: 'bell', perms: ['campaigns.edit'], group: 'Marketing' },
  { id: 'shop', label: 'Sklep', icon: 'bag', perms: ['shop.manage'], group: 'Sprzedaż' },
  { id: 'products', label: 'Karnety', icon: 'ticket', perms: ['config.edit'], group: 'Sprzedaż' },
  { id: 'finance', label: 'Finanse', icon: 'card', perms: ['finance.view', 'finance.export'], group: 'Sprzedaż' },
  { id: 'settings', label: 'Ustawienia', icon: 'settings', perms: ['config.edit'], group: 'Ustawienia' },
  { id: 'look', label: 'Wygląd', icon: 'type', perms: ['config.edit'], group: 'Ustawienia' },
  { id: 'site', label: 'Strona WWW', icon: 'grid', perms: ['config.edit'], group: 'Ustawienia' },
];

export function StaffApp(props: { me: Me; studio: MeStudio; persona?: string; reloadMe: () => Promise<void>; onSwitchStudio: () => void; onPreviewClient: () => void; onLogout: () => void }) {
  const roles = props.studio.roles as Role[];
  const visible = SECTIONS.filter((s) => s.perms.some((p) => can(roles, p)) && (!s.role || roles.includes(s.role)));
  const fallback = visible[0]?.id ?? 'today';
  const fromHash = () => {
    const id = location.hash.slice(1);
    return visible.some((s) => s.id === id) ? id : fallback;
  };
  const [section, setSectionState] = useState(fromHash);
  const setSection = (id: string) => {
    if (id === section) return;
    history.pushState(null, '', `${location.pathname}${location.search}#${id}`);
    setSectionState(id);
    window.scrollTo({ top: 0 });
  };
  useEffect(() => {
    const onPop = () => setSectionState(fromHash());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });
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
                <button key={s.id} className="side-link" aria-current={section === s.id ? 'page' : undefined} onClick={() => setSection(s.id)}>
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
        <Suspense fallback={<Spinner />}>
          {section === 'dashboard' && <Dashboard go={setSection} />}
          {section === 'analytics' && <Analytics />}
          {section === 'entrance' && <Entrance />}
          {section === 'today' && <Today roles={roles} />}
          {section === 'clients' && <Clients roles={roles} />}
          {section === 'groups' && <GroupChats roles={roles} />}
          {section === 'messages' && <Messages roles={roles} />}
          {section === 'welcomes' && <Welcomes me={props.me} isOwner={roles.includes('owner')} />}
          {section === 'profile' && <TrainerProfile me={props.me} reloadMe={props.reloadMe} />}
          {section === 'gifts' && <Gifts roles={roles} />}
          {section === 'desk' && <Desk />}
          {section === 'events' && <EventsAdmin roles={roles} />}
          {section === 'schedule' && <ScheduleAdmin />}
          {section === 'extras' && <ScheduleExtras roles={roles} />}
          {section === 'courses' && <CreatorStudio roles={roles} />}
          {section === 'community' && <CommunityAdmin />}
          {section === 'music' && <MusicAdmin />}
          {section === 'themes' && <Themes />}
          {section === 'marketing' && <Marketing />}
          {section === 'loyalty' && <LoyaltyAdmin />}
          {section === 'shop' && <ShopAdmin />}
          {section === 'products' && <Products />}
          {section === 'finance' && <Finance roles={roles} />}
          {section === 'settings' && <Settings studio={props.studio} onSaved={props.reloadMe} />}
          {section === 'look' && <LookEditor studio={props.studio} onSaved={props.reloadMe} />}
          {section === 'site' && <SiteOverview />}
        </Suspense>
      </main>
    </div>
  );
}
