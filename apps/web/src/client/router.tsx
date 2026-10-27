// Podstrony aplikacji klientki: stos „otwórz → wróć” nad pięcioma zakładkami. Trasa to krótki tekst,
// np. „passes”, „course/co1”, „survey/abc” – te same, które przychodzą w powiadomieniach (pole action).
import { useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { DirectChatPage, GroupChatPage } from '../groupChat.tsx';
import { Lazy, lazyRetry, Page, takeOrigin } from '../ui.tsx';

export const AccountPages = lazyRetry(() => import('./AccountPages.tsx'));
const PassPages = lazyRetry(() => import('./PassPages.tsx'));
const LoyaltyPages = lazyRetry(() => import('./LoyaltyPages.tsx'));
const WellbeingPages = lazyRetry(() => import('./WellbeingPages.tsx'));
export const CommunityPages = lazyRetry(() => import('./CommunityPages.tsx'));
const CoursePages = lazyRetry(() => import('./CoursePages.tsx'));
const ShopPages = lazyRetry(() => import('./ShopPages.tsx'));
const EventPages = lazyRetry(() => import('./EventPages.tsx'));
const FeedbackPages = lazyRetry(() => import('./Feedback.tsx'));
const TrainerPages = lazyRetry(() => import('./TrainerPages.tsx'));

export type RouteProps = { route: string; arg: string | null; close: () => void };

const TITLES: Record<string, string> = {
  settings: 'Ustawienia',
  notifications: 'Powiadomienia',
  privacy: 'Prywatność i zgody',
  security: 'Logowanie i urządzenia',
  a11y: 'Dostępność',
  inbox: 'Wiadomości',
  messages: 'Wiadomości',
  chat: 'Recepcja',
  faq: 'Pomoc',
  checkin: 'Mój kod wejścia',
  passes: 'Karnety',
  payments: 'Historia płatności',
  loyalty: 'Lojalność i odznaki',
  locker: 'Moja szafka',
  journal: 'Dziennik',
  cycle: 'Cykl',
  calm7: '7 dni spokoju',
  stretch: 'Rozciąganie',
  quiz: 'Mój styl dnia',
  goal: 'Cel tygodnia',
  health: 'Zdrowie i postępy',
  plan: 'Mój plan',
  feed: 'Feed studia',
  groups: 'Grupy',
  challenges: 'Wyzwania',
  music: 'Muzyka',
  invites: 'Zaproś znajomą',
  courses: 'Kursy',
  course: 'Kurs',
  shop: 'Sklep',
  orders: 'Moje zamówienia',
  partners: 'Partnerzy',
  events: 'Wydarzenia',
  'event-new': 'Zorganizuj wydarzenie',
  event: 'Wydarzenie',
  nps: 'Twoja opinia',
  survey: 'Co się stało?',
  wellbeing: 'Dla mnie',
  trainer: 'Trenerka',
  dm: 'Wiadomość do trenerki',
};

const GROUP: Record<string, ComponentType<RouteProps>> = {
  settings: AccountPages,
  notifications: AccountPages,
  privacy: AccountPages,
  security: AccountPages,
  a11y: AccountPages,
  inbox: AccountPages,
  messages: AccountPages,
  chat: AccountPages,
  faq: AccountPages,
  checkin: AccountPages,
  passes: PassPages,
  payments: PassPages,
  loyalty: LoyaltyPages,
  locker: LoyaltyPages,
  journal: WellbeingPages,
  cycle: WellbeingPages,
  calm7: WellbeingPages,
  stretch: WellbeingPages,
  quiz: WellbeingPages,
  goal: WellbeingPages,
  health: WellbeingPages,
  plan: WellbeingPages,
  feed: CommunityPages,
  groups: CommunityPages,
  challenges: CommunityPages,
  music: CommunityPages,
  invites: CommunityPages,
  courses: CoursePages,
  course: CoursePages,
  shop: ShopPages,
  orders: ShopPages,
  partners: ShopPages,
  events: EventPages,
  'event-new': EventPages,
  event: EventPages,
  nps: FeedbackPages,
  survey: FeedbackPages,
  trainer: TrainerPages,
};

/** Akcje z powiadomień → trasy (np. „profile/passes” → „passes”). Zakładki obsługuje ClientApp. */
export function normalizeRoute(action: string): { tab?: string; route?: string } {
  const a = action.replace(/^profile\//, '').replace(/^community\/(challenge\/)?/, (m) => (m.includes('challenge') ? 'challenges/' : ''));
  if (['start', 'schedule', 'forme', 'store', 'community', 'profile'].includes(a)) return { tab: a };
  if (a === 'survey/dormant') return { route: 'survey' };
  if (a.startsWith('confirm/')) return { tab: 'start' };
  if (a.startsWith('gift/')) return { route: 'invites' };
  if (a === 'badges' || a === 'gifts') return { route: 'loyalty' };
  if (a === 'staff/welcomes') return { tab: 'start' };
  const [head] = a.split('/');
  return TITLES[head] ? { route: a } : { tab: 'start' };
}

export function RouteView({ route, close, open }: { route: string; close: () => void; open: (route: string) => void }) {
  const [head, ...rest] = route.split('/');
  const arg = rest.join('/') || null;
  const Group = GROUP[head];
  // Rozmowa grupy ma własny pełny ekran (nagłówek z grupą, pole wiadomości na dole).
  if (head === 'groups' && arg) return <GroupChatPage groupId={arg} onBack={close} onWriteTrainer={(t) => open(`dm/${t}`)} />;
  // „Napisz do trenerki” – prywatna rozmowa (także z powiadomienia „dm/<trenerka>”).
  if (head === 'dm' && arg) return <DirectChatPage path={`/dm/${arg}`} onBack={close} hint="prywatnie · widzicie to tylko Wy dwie" />;
  const body = <Lazy>{Group ? <Group route={head} arg={arg} close={close} /> : <p className="muted">Nie ma takiej strony.</p>}</Lazy>;
  // Kod wejścia wyrasta z karty, którą kliknięto, i przy wyjściu do niej wraca.
  if (head === 'checkin') return <PassPage title={TITLES[head]} close={close}>{body}</PassPage>;
  return (
    <Page title={TITLES[head] ?? ''} onBack={close}>
      {body}
    </Page>
  );
}

/** Strona, która wyrasta z klikniętego elementu (skala od jego środka) i przy wyjściu do niego wraca. */
function PassPage({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const [origin] = useState(() => {
    const r = takeOrigin();
    if (!r) return undefined;
    return {
      '--ox': `${r.left + r.width / 2}px`,
      '--oy': `${r.top + r.height / 2}px`,
      // Startowo strona jest niewiele większa od karty – nie mniej niż 0.12, żeby od razu było widać ruch.
      '--os': Math.max(0.12, (r.width * 2) / window.innerWidth).toFixed(3),
    } as CSSProperties;
  });
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    close();
  };
  const leave = () => {
    if (leaving) return;
    setLeaving(true);
    // Zapas, gdyby animationend nie przyszło (np. karta w tle).
    setTimeout(finish, 600);
  };
  return (
    <Page
      title={title}
      onBack={leave}
      className={`pass-page${leaving ? ' leaving' : ''}`}
      style={origin}
      onAnimationEnd={(e) => e.target === e.currentTarget && e.animationName === 'pass-close' && finish()}
    >
      {children}
    </Page>
  );
}
