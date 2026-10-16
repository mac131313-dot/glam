// Podstrony aplikacji klientki: stos „otwórz → wróć” nad pięcioma zakładkami. Trasa to krótki tekst,
// np. „passes”, „course/co1”, „survey/abc” – te same, które przychodzą w powiadomieniach (pole action).
import { lazy, Suspense, type ComponentType } from 'react';
import { DirectChatPage, GroupChatPage } from '../groupChat.tsx';
import { Page, Spinner } from '../ui.tsx';

const AccountPages = lazy(() => import('./AccountPages.tsx'));
const PassPages = lazy(() => import('./PassPages.tsx'));
const LoyaltyPages = lazy(() => import('./LoyaltyPages.tsx'));
const WellbeingPages = lazy(() => import('./WellbeingPages.tsx'));
const CommunityPages = lazy(() => import('./CommunityPages.tsx'));
const CoursePages = lazy(() => import('./CoursePages.tsx'));
const ShopPages = lazy(() => import('./ShopPages.tsx'));
const EventPages = lazy(() => import('./EventPages.tsx'));
const FeedbackPages = lazy(() => import('./Feedback.tsx'));
const TrainerPages = lazy(() => import('./TrainerPages.tsx'));

export type RouteProps = { route: string; arg: string | null; close: () => void };

const TITLES: Record<string, string> = {
  settings: 'Ustawienia',
  notifications: 'Powiadomienia',
  privacy: 'Prywatność i zgody',
  security: 'Logowanie i urządzenia',
  a11y: 'Dostępność',
  inbox: 'Wiadomości',
  chat: 'Czat z recepcją',
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
  if (['start', 'schedule', 'forme', 'community', 'profile'].includes(a)) return { tab: a };
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
  return (
    <Page title={TITLES[head] ?? ''} onBack={close}>
      <Suspense fallback={<Spinner />}>{Group ? <Group route={head} arg={arg} close={close} /> : <p className="muted">Nie ma takiej strony.</p>}</Suspense>
    </Page>
  );
}
