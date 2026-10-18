// Ekran Start (3): powitanie, najbliższe zajęcia, stan karnetu, cel tygodnia.
import { useEffect, useState } from 'react';
import { goalCount, goalExtra, plural, rewardCounterCopy } from '@glam/core';
import { api, fmtDay, fmtTime, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { Empty, ListRow, Progress, QrCode, Sheet, Spinner, useAction } from '../ui.tsx';
import { ClassCover } from './ClassCover.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
import { PassMeter, type Meter } from './PassMeter.tsx';
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
  checkin_code: string | null;
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

export function Start() {
  const { studio, me, go, openShop, openBreath, open } = useClient();
  const { run } = useAction();
  const { data: home, reload } = useApi<Home>('/home');
  const [popupDismissed, setPopupDismissed] = useState(false);
  const [ticket, setTicket] = useState<Upcoming | null>(null);

  useEffect(() => {
    window.addEventListener('glam:passes-changed', reload);
    return () => window.removeEventListener('glam:passes-changed', reload);
  }, [reload]);

  if (!home) return <Spinner />;
  const next = home.upcoming[0];
  const ritual = home.ritual ?? RITUALS[new Date().getDate() % RITUALS.length];
  const [hello] = home.greeting.split(',');

  return (
    <div className="stack-lg">
      <section style={{ paddingTop: 8, position: 'relative' }}>
        {/* Jedno wejście do wszystkich rozmów i powiadomień; kropka – coś czeka na przeczytanie. */}
        <button
          className="icon-btn inbox-btn"
          onClick={() => open('messages')}
          aria-label={home.messagesUnread + home.unread > 0 ? `Wiadomości, nieprzeczytane: ${home.messagesUnread + home.unread}` : 'Wiadomości'}
        >
          <Icon name="chat" size={22} />
          {home.messagesUnread + home.unread > 0 && <span className="inbox-dot" aria-hidden />}
        </button>
        <p className="eyebrow">{new Intl.DateTimeFormat('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</p>
        <h1 style={{ fontSize: '2.4rem', lineHeight: 1.05 }}>
          {hello},
          <br />
          <span className="serif" style={{ fontSize: '2.9rem' }}>
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
        <div className="eyebrow" style={{ margin: 0 }}>Najbliższe zajęcia</div>
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
          <div className="card stack">
            <Empty icon="">Nic jeszcze nie zaplanowałaś.</Empty>
          </div>
        )}
        <div className="row between">
          <span className="muted small">{home.upcoming.length > 1 ? `i jeszcze ${home.upcoming.length - 1} w planie` : ''}</span>
          <button className="link small" onClick={() => go('schedule')}>
            {next ? 'Zobacz grafik' : 'Zarezerwuj zajęcia'}
          </button>
        </div>
        {ticket && <ClassTicket item={ticket} onClose={() => setTicket(null)} />}
      </section>

      <section className="card soft stack">
        <div className="eyebrow">Mój karnet</div>
        {home.passes.length === 0 ? (
          <>
            <p style={{ margin: 0 }}>Nie masz aktywnego karnetu.</p>
            <button className="btn" onClick={() => openShop()}>
              Kup karnet
            </button>
          </>
        ) : (
          home.passes.map((p) => (
            <div key={p.id} className="stack gap-2">
              <PassMeter name={p.productName} summary={p.summary} meter={p.meter} />
              {p.expiringSoon && (
                <div className="row between">
                  <span className="small muted">Ostatni tydzień ważności</span>
                  <button className="btn sm" onClick={() => openShop('Przedłuż karnet, żeby nie stracić rytmu.')}>
                    Przedłuż
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="stack gap-2">
        <div className="row between">
          <div className="eyebrow" style={{ margin: 0 }}>Cel tygodnia</div>
          <button className="link small" onClick={() => open('goal')}>
            {goalCount(home.week.done.trainings, home.week.goal.trainings)} {plural(home.week.goal.trainings, 'trening', 'treningi', 'treningów')}
            {goalExtra(home.week.done.trainings, home.week.goal.trainings)} · {goalCount(home.week.done.mindful, home.week.goal.mindful)} {plural(home.week.goal.mindful, 'chwila', 'chwile', 'chwil')}
            {goalExtra(home.week.done.mindful, home.week.goal.mindful)}
          </button>
        </div>
        <Progress value={Math.min(home.week.done.trainings, home.week.goal.trainings) + Math.min(home.week.done.mindful, home.week.goal.mindful)} max={Math.max(1, home.week.goal.trainings + home.week.goal.mindful)} label="Postęp celu tygodnia" />
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
        <section className="list-rows">
          {home.survey && <ListRow title="Dawno Cię nie widziałyśmy" hint="Co się stało? Jedno kliknięcie – bez presji." onClick={() => open(`survey/${home.survey!.id}`)} />}
          {home.nps && <ListRow title="Jak Ci u nas?" hint="Dwa kliknięcia, a bardzo nam pomogą." onClick={() => open(`nps/${home.nps!.id}`)} />}
          {home.invites > 0 && <ListRow title="Masz zaproszenie na wspólny trening" onClick={() => open('invites')} />}
          {home.challenge && <ListRow title={`Wyzwanie: ${home.challenge!.title}`} hint="Dołącz, w swoim tempie" onClick={() => open(`challenges/${home.challenge!.id}`)} />}
          {home.quizDue && <ListRow title="Mój styl dnia" hint="5 pytań, żeby lepiej dopasować przypomnienia" onClick={() => open('quiz')} />}
        </section>
      )}

      <hr className="hairline" />

      <section className="center" style={{ padding: '6px 8px' }}>
        <div className="eyebrow">Rytuał dnia</div>
        <p className="serif" style={{ fontSize: 'var(--text-2xl)', lineHeight: 1.3, margin: 0 }}>
          {ritual}
        </p>
      </section>

      <hr className="hairline" />

      {/* Na dole tylko skróty do rzeczy dla siebie. Pomoc i telefon do studia są w Profilu → Pomoc, rozmowy pod ikoną u góry. */}
      <div className="list-rows">
        <ListRow title="Trzy minuty oddechu" hint="Rytm 4–6, prowadzi aplikacja" onClick={() => openBreath({ patternId: 'calm', minutes: 3 })} />
        {hasFeature(studio, 'shop') && <ListRow title="Sklep studia" hint="Maty, akcesoria i stroje do domu" onClick={() => open('shop')} />}
        {home.eventsEnabled && <ListRow title="Zorganizuj wydarzenie w studiu" hint="Urodziny, babski wieczór, trening w prezencie" onClick={() => open('event-new')} />}
      </div>

      {home.welcome && !popupDismissed && (
        <WelcomePopup
          welcome={home.welcome}
          onClose={async () => {
            setPopupDismissed(true);
            await api(`/welcome/${home.welcome!.id}/seen`, { method: 'POST' });
          }}
          onBook={() => go('schedule')}
          onStudio={() => go('community')}
          onCourses={hasFeature(studio, 'courses') ? () => open('courses') : undefined}
        />
      )}
    </div>
  );
}

// Okno po kliknięciu najbliższych zajęć: kod QR do zeskanowania w recepcji i krótki opis spotkania.
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
        {item.checkin_code ? (
          <>
            <QrCode text={item.checkin_code} size={220} label={`Kod wejścia na ${item.class_name}`} />
            <p className="tiny muted" style={{ margin: 0 }}>Pokaż ten kod w recepcji – zeskanujemy go przy wejściu. Działa w dniu zajęć.</p>
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
