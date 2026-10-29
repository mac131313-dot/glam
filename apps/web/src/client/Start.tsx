// Ekran Start (3): powitanie, najbliższe zajęcia, stan karnetu, cel tygodnia.
import { useEffect, useState } from 'react';
import { goalCount, goalExtra, plural, rewardCounterCopy, type ClassFit, type LiveCheckin } from '@glam/core';
import { api, ApiError, fmtDay, fmtTime, useApi } from '../api.ts';
import { Icon, type IconName } from '../icons.tsx';
import { LiveCheckinQr, MoreLink, Progress, Pending, Sheet, rememberOrigin, useAction, useToast } from '../ui.tsx';
import { ClassCover } from './ClassCover.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
import { PassMeter, type Meter } from './PassMeter.tsx';
import { focusSession, pickForYou, SessionCard, type Session } from './Schedule.tsx';
import { InviteCard, type TrainerInvite } from './TrainerInvite.tsx';
import { WelcomePopup } from './WelcomePopup.tsx';

type Upcoming = {
  booking_id: string;
  status: string;
  starts_at: string;
  ends_at: string;
  class_name: string;
  description: string | null;
  trainer_name: string;
  zone_name: string;
  photo_url: string | null;
  photo_ratio: number | null;
  checkin: LiveCheckin | null;
};

type Home = {
  greeting: string;
  dayPart: 'morning' | 'afternoon' | 'evening';
  upcoming: Upcoming[];
  passes: { id: string; productName: string; summary: string; meter: Meter | null; expiringSoon: boolean; unlimited: boolean }[];
  week: { goal: { trainings: number; mindful: number }; done: { trainings: number; mindful: number }; achieved: boolean; message: string; restDay: boolean };
  welcome: { id: string; body: string; trainer_name: string; kind?: string; video_id?: string | null } | null;
  unread: number;
  chatUnread: number;
  /** Nieprzeczytane we wszystkich rozmowach (recepcja, trenerki, grupy). */
  messagesUnread: number;
  ritual: string;
  birthday: boolean;
  eventToday: { id: string; hero: string } | null;
  confirmNeeded: { booking_id: string; class_name: string; starts_at: string } | null;
  reward: { left: number; milestone: number; item: string } | null;
  loyalty: { points: number; current: { name: string }; next: { name: string } | null; toNext: number } | null;
  nps: { id: string } | null;
  survey: { id: string } | null;
  locker: number;
  invites: number;
  trainerInvites: TrainerInvite[];
  challenge: { id: string; title: string } | null;
  quizDue: boolean;
  firstClass: boolean;
  eventsEnabled: boolean;
};

const RITUALS = [
  'Zrób dziś coś tylko dla siebie – choćby pięć minut.',
  'Twoje ciało robi dla Ciebie tyle każdego dnia. Podziękuj mu oddechem.',
  'Nie musisz nic udowadniać. Wystarczy, że jesteś.',
  'Co dziś dało Ci energię? Zauważ to.',
  'Mały krok też jest krokiem.',
];

/**
 * Kod wejścia ma się otworzyć płynnie – kod strony i generator QR ładujemy zawczasu, nie w trakcie animacji.
 * Sam dzisiejszy kod też pobieramy od razu: service worker go zapisze, więc w recepcji zadziała i bez zasięgu.
 */
const preloadPass = () => {
  import('./AccountPages.tsx').catch(() => {});
  import('qrcode-generator').catch(() => {});
  api('/my/checkin-code').catch(() => {});
};

export function Start() {
  const { studio, me, go, openShop, openBreath, open } = useClient();
  const { run } = useAction();
  const { data: home, error, reload } = useApi<Home>('/home');
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [ticket, setTicket] = useState<Upcoming | null>(null);

  useEffect(() => {
    const t = setTimeout(preloadPass, 1500);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    window.addEventListener('glam:passes-changed', reload);
    return () => window.removeEventListener('glam:passes-changed', reload);
  }, [reload]);

  if (!home) return <Pending error={error} reload={reload} />;
  const next = home.upcoming[0];
  const ritual = home.ritual ?? RITUALS[new Date().getDate() % RITUALS.length];
  const [hello] = home.greeting.split(',');

  return (
    <div className="stack-lg">
      <section style={{ paddingTop: 8, position: 'relative' }}>
        {/* Kod wejścia zawsze pod ręką – ten sam co w Profilu. Wiadomości są w Razem. */}
        <button
          className="icon-btn inbox-btn"
          onPointerDown={preloadPass}
          onClick={(e) => {
            rememberOrigin(e.currentTarget);
            open('checkin');
          }}
          aria-label="Mój kod wejścia"
        >
          <Icon name="pass" size={22} />
        </button>
        <p className="eyebrow">{new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
        <h1 className="hello">
          {/* Jedna linijka „Cześć, Julia”; dłuższe imię schodzi w całości do następnej (inline-block nie łamie się w środku). */}
          {hello},{' '}
          <span className="hello-name">
            {me.user.name ?? 'miło Cię widzieć'}
          </span>
        </h1>
      </section>

      {(home.birthday || home.eventToday) && (
        <button className="welcome-hero stack gap-2" style={{ border: 0, textAlign: 'left', cursor: home.eventToday ? 'pointer' : 'default' }} onClick={() => home.eventToday && open(`event/${home.eventToday.id}`)}>
          <div className="eyebrow">{home.birthday ? 'Twój dzień' : 'Dziś'}</div>
          <div className="serif" style={{ fontSize: '1.8rem', lineHeight: 1.15 }}>
            {home.eventToday ? home.eventToday.hero : `Wszystkiego dobrego, ${me.user.name ?? ''}`}
          </div>
          {home.birthday && <div className="small">Prezent czeka w Profilu → Lojalność 🎁</div>}
        </button>
      )}

      {home.confirmNeeded && (
        <section className="card soft row between">
          <span className="small">
            Będziesz na <b>{home.confirmNeeded.class_name}</b> o {fmtTime(home.confirmNeeded.starts_at)}?
          </span>
          <button className="btn sm" onClick={() => run(() => api(`/bookings/${home.confirmNeeded!.booking_id}/confirm`, { method: 'POST' }).then((r) => (reload(), r)))}>
            Potwierdzam
          </button>
        </section>
      )}

      <section className="stack gap-3">
        <div className="sec-head">
          <div className="eyebrow">Najbliższe zajęcia</div>
          {next && <MoreLink label={home.upcoming.length > 1 ? `Grafik · +${home.upcoming.length - 1}` : 'Grafik'} onClick={() => go('schedule')} />}
        </div>
        {next ? (
          <ClassCover
            bleed
            photoUrl={next.photo_url}
            photoRatio={next.photo_ratio}
            onClick={() => setTicket(next)}
            eyebrow={`${fmtDay(next.starts_at)} · ${fmtTime(next.starts_at)}`}
            title={next.class_name}
            meta={`prowadzi ${next.trainer_name} · ${next.zone_name}`}
            corner={next.status === 'waitlist' ? <span className="badge warn">lista oczekujących</span> : <span className="badge ok">zapisana</span>}
          />
        ) : (
          <ForYouNext />
        )}
        {ticket && <ClassTicket item={ticket} onClose={() => setTicket(null)} />}
      </section>

      <section className="stack gap-3">
        <div className="sec-head">
          <div className="eyebrow">Mój karnet</div>
          {home.passes.length > 0 && <MoreLink label="Szczegóły" onClick={() => open('passes')} />}
        </div>
        {home.passes.length === 0 ? (
          <button className="nudge" onClick={() => openShop()}>
            <span className="nudge-icon">
              <Icon name="pass" size={20} />
            </span>
            <span className="grow">
              <span className="nudge-title">Nie masz aktywnego karnetu</span>
              <span className="small muted">Wybierz karnet i zapisuj się na zajęcia</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ) : (
          home.passes.map((p) => (
            <div key={p.id} className={`home-pass${p.expiringSoon ? ' is-expiring' : ''}`}>
              <PassMeter name={p.productName} summary={p.summary} meter={p.meter} />
              {p.expiringSoon && (
                <div className="home-pass-alert">
                  <span>Ostatni tydzień ważności</span>
                  <button className="btn sm" onClick={() => openShop('Przedłuż karnet, żeby nie stracić rytmu.')}>
                    Przedłuż
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="stack gap-3">
        <div className="sec-head">
          <div className="eyebrow">Cel tygodnia</div>
          <MoreLink label="Szczegóły" onClick={() => open('goal')} />
        </div>
        <div className="goal-grid">
          <GoalStat label={plural(home.week.goal.trainings, 'trening', 'treningi', 'treningów')} done={home.week.done.trainings} goal={home.week.goal.trainings} />
          <GoalStat label={plural(home.week.goal.mindful, 'chwila dla siebie', 'chwile dla siebie', 'chwil dla siebie')} done={home.week.done.mindful} goal={home.week.goal.mindful} />
        </div>
        <p className="small muted" style={{ margin: 0 }}>{home.week.message}</p>
      </section>

      {home.trainerInvites.length > 0 && (
        <section className="stack gap-2">
          <div className="eyebrow">Zaproszenia od trenerek</div>
          {home.trainerInvites.map((i) => (
            <InviteCard key={i.id} invite={i} onChange={reload} onTrainer={() => open(`trainer/${i.trainerId}`)} />
          ))}
        </section>
      )}

      {(home.nps || home.survey || home.invites > 0 || home.quizDue || home.challenge) && (
        <section className="stack gap-2">
          <div className="eyebrow">Dla Ciebie</div>
          <div className="nudges">
            {home.survey && <Nudge icon="heart" title="Dawno Cię nie widziałyśmy" hint="Co się stało? Jedno kliknięcie – bez presji." onClick={() => open(`survey/${home.survey!.id}`)} />}
            {home.nps && <Nudge icon="star" title="Jak Ci u nas?" hint="Dwa kliknięcia, a bardzo nam pomogą." onClick={() => open(`nps/${home.nps!.id}`)} />}
            {home.invites > 0 && <Nudge icon="people" title="Masz zaproszenie na wspólny trening" onClick={() => open('invites')} />}
            {home.challenge && <Nudge icon="flag" title={`Wyzwanie: ${home.challenge!.title}`} hint="Dołącz, w swoim tempie" onClick={() => open(`challenges/${home.challenge!.id}`)} />}
            {home.quizDue && <Nudge icon="sun" title="Mój styl dnia" hint="5 pytań, żeby lepiej dopasować przypomnienia" onClick={() => open('quiz')} />}
          </div>
        </section>
      )}

      <section className="ritual">
        <span className="ritual-glow" aria-hidden />
        <div className="eyebrow">Rytuał dnia</div>
        <p className="ritual-text">{ritual}</p>
      </section>

      {/* Na dole tylko skróty do rzeczy dla siebie. Pomoc i telefon do studia są w Profilu → Pomoc, rozmowy w Razem → Wiadomości. */}
      <div className="quick-tiles">
        <QuickTile icon="wave" title="Trzy minuty oddechu" hint="Rytm 4–6" onClick={() => openBreath({ patternId: 'calm', minutes: 3 })} />
        {hasFeature(studio, 'shop') && <QuickTile icon="bag" title="Sklep studia" hint="Maty i akcesoria" onClick={() => open('shop')} />}
        {home.eventsEnabled && <QuickTile icon="sparkle" title="Wydarzenie w studiu" hint="Urodziny, babski wieczór" onClick={() => open('event-new')} />}
      </div>

      {home.welcome && !popupDismissed && (
        <WelcomePopup
          welcome={home.welcome}
          onClose={() => {
            setPopupDismissed(true);
            // Bez sieci powitanie pokaże się jeszcze raz przy następnym wejściu – nic więcej się nie stanie.
            api(`/welcome/${home.welcome!.id}/seen`, { method: 'POST' }).catch(() => {});
          }}
          onBook={() => go('schedule')}
          onStudio={() => go('community')}
          onCourses={hasFeature(studio, 'courses') ? () => open('courses') : undefined}
        />
      )}
    </div>
  );
}

/** Podpowiedź na Starcie (ankieta, wyzwanie, quiz…): kafelek z ikoną, żeby nie ginęła wśród zwykłych wierszy. */
function Nudge({ icon, title, hint, onClick }: { icon: IconName; title: string; hint?: string; onClick: () => void }) {
  return (
    <button className="nudge" onClick={onClick}>
      <span className="nudge-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="grow">
        <span className="nudge-title">{title}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
      <Icon name="chevron" size={18} />
    </button>
  );
}


/** Jedna połowa celu tygodnia: duże „2/3”, podpis i własny pasek. Nadwyżka ponad cel jako „+1”. */
function GoalStat({ label, done, goal }: { label: string; done: number; goal: number }) {
  return (
    <div className={`goal-stat${goal > 0 && done >= goal ? ' is-done' : ''}`}>
      <div className="goal-stat-value">
        {goalCount(done, goal)}
        {goalExtra(done, goal) && <span className="goal-stat-extra">{goalExtra(done, goal)}</span>}
      </div>
      <div className="small muted">{label}</div>
      <Progress value={Math.min(done, goal)} max={Math.max(1, goal)} label={`Cel tygodnia: ${label}`} />
    </div>
  );
}

/** Skrót na dole Startu: ikona i krótki podpis, po dwa w rzędzie. */
function QuickTile({ icon, title, hint, onClick }: { icon: IconName; title: string; hint: string; onClick: () => void }) {
  return (
    <button className="quick-tile" onClick={onClick}>
      <span className="nudge-icon">
        <Icon name={icon} size={20} />
      </span>
      <span className="nudge-title">{title}</span>
      <span className="tiny muted">{hint}</span>
    </button>
  );
}

// Okno po kliknięciu najbliższych zajęć: kod QR do zeskanowania w recepcji i krótki opis spotkania.
/** Ile podpowiedzi pokazujemy i jak daleko w przód szukamy wolnych miejsc. */
const SUGGEST_MAX = 4;
const SUGGEST_DAYS = 14;

/**
 * Brak zapisów: zamiast pustej karty najbliższe zajęcia z ulubionych i dopasowane z ankiety, na które jest jeszcze miejsce.
 * Każdy typ zajęć raz (najbliższy termin), w kolejności godzin. Dotknięcie otwiera te zajęcia w Grafiku.
 */
function ForYouNext() {
  const { go } = useClient();
  const toast = useToast();
  const { data } = useApi<{ sessions: Session[]; fit: ClassFit | null; favorites: string[] }>(`/schedule?days=${SUGGEST_DAYS}`);
  /** Serduszka zmieniamy od razu, lista podpowiedzi zostaje na miejscu do następnego wejścia. */
  const [favs, setFavs] = useState<string[] | null>(null);

  if (!data) return null;
  const favorites = favs ?? data.favorites;
  const bookable = data.sessions.filter((s) => !s.my_status && s.taken < s.capacity);
  // pickForYou daje najlepsze terminy pierwsze – zostawiamy pierwszy termin każdego typu zajęć.
  const seen = new Set<string>();
  const picks = pickForYou(bookable, data.favorites, data.fit)
    .filter(({ s }) => {
      if (seen.has(s.class_type_id)) return false;
      seen.add(s.class_type_id);
      return true;
    })
    .sort((a, b) => a.s.starts_at.localeCompare(b.s.starts_at))
    .slice(0, SUGGEST_MAX);

  if (!picks.length)
    return (
      <button className="nudge" onClick={() => go('schedule')}>
        <span className="nudge-icon">
          <Icon name="calendar" size={20} />
        </span>
        <span className="grow">
          <span className="nudge-title">Nic jeszcze nie zaplanowałaś</span>
          <span className="small muted">Zarezerwuj zajęcia w grafiku</span>
        </span>
        <Icon name="chevron" size={18} />
      </button>
    );

  const toggleFav = async (s: Session) => {
    const on = !favorites.includes(s.class_type_id);
    setFavs(on ? [...favorites, s.class_type_id] : favorites.filter((x) => x !== s.class_type_id));
    try {
      await api(`/favorites/${s.class_type_id}`, { method: on ? 'PUT' : 'DELETE' });
    } catch (e) {
      setFavs(favorites);
      toast((e as ApiError).message, 'error');
    }
  };
  const book = (s: Session) => {
    focusSession(s);
    go('schedule');
  };

  return (
    <div className="stack" style={{ gap: 12 }}>
      <p className="small muted" style={{ margin: 0 }}>
        Nic jeszcze nie zaplanowałaś – te zajęcia są <span className="serif">dla Ciebie</span> i mają wolne miejsca.
      </p>
      <div className="cover-carousel">
        {picks.map(({ s, reason }) => (
          <SessionCard key={s.id} s={s} fav={favorites.includes(s.class_type_id)} onFav={() => toggleFav(s)} onOpen={() => book(s)} reason={reason} day />
        ))}
      </div>
      <div className="sec-head">
        <span />
        <MoreLink label="Cały grafik" onClick={() => go('schedule')} />
      </div>
    </div>
  );
}

function ClassTicket({ item, onClose }: { item: Upcoming; onClose: () => void }) {
  const minutes = Math.round((Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 60_000);
  return (
    <Sheet onClose={onClose} label={`Wejście na ${item.class_name}`}>
      <div className="stack center gap-4" style={{ textAlign: 'center' }}>
        <p className="eyebrow" style={{ margin: 0 }}>
          {fmtDay(item.starts_at)} · {fmtTime(item.starts_at)} · {minutes} min
        </p>
        <h2 className="serif" style={{ margin: 0 }}>{item.class_name}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          prowadzi {item.trainer_name} · {item.zone_name}
        </p>
        {item.description && <p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.description}</p>}
        {item.checkin ? (
          <>
            <LiveCheckinQr checkin={item.checkin} size={220} label={`Kod wejścia na ${item.class_name}`} />
            <p className="tiny muted" style={{ margin: 0 }}>Pokaż ten kod w recepcji – zeskanujemy go przy wejściu. Zmienia się co 30 sekund, więc zrzut ekranu nie zadziała.</p>
          </>
        ) : item.status === 'waitlist' ? (
          <p className="small muted">Jesteś na liście oczekujących. Kod wejścia pojawi się tutaj, gdy zwolni się miejsce.</p>
        ) : (
          <p className="small muted">Kod wejścia pojawi się tutaj w dniu zajęć ({fmtDay(item.starts_at)}).</p>
        )}
        <button className="btn ghost sm" onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Sheet>
  );
}
