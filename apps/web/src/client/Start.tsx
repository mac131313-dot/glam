// Ekran Start (3): powitanie, motyw sezonowy, najbliższe zajęcia, stan karnetu, cel tygodnia.
import { useEffect, useState } from 'react';
import { rewardCounterCopy } from '@glam/core';
import { api, fmtDay, fmtTime, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { Empty, Progress, QrCode, Sheet, Spinner, useAction } from '../ui.tsx';
import { ClassCover } from './ClassCover.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
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
  theme: { name: string; tagline: string } | null;
  upcoming: Upcoming[];
  passes: { id: string; summary: string; expiringSoon: boolean; unlimited: boolean }[];
  week: { goal: { trainings: number; mindful: number }; done: { trainings: number; mindful: number }; achieved: boolean; message: string; restDay: boolean };
  welcome: { id: string; body: string; trainer_name: string; kind?: string; video_id?: string | null } | null;
  unread: number;
  chatUnread: number;
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
      <section style={{ paddingTop: 8 }}>
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
        <button className="welcome-hero stack" style={{ border: 0, textAlign: 'left', cursor: home.eventToday ? 'pointer' : 'default', gap: 6 }} onClick={() => home.eventToday && open(`event/${home.eventToday.id}`)}>
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

      {home.theme && (
        <div className="theme-banner">
          <div className="eyebrow">Edycja sezonowa</div>
          <div className="serif" style={{ fontSize: '1.5rem', lineHeight: 1.2 }}>
            {home.theme.name}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            {home.theme.tagline}
          </div>
        </div>
      )}

      <section className="stack" style={{ gap: 12 }}>
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
          <button className="btn ghost sm" onClick={() => go('schedule')}>
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
            <div key={p.id} className="stack" style={{ gap: 10 }}>
              <div className="card-title" style={{ fontSize: '1.15rem' }}>{p.summary}</div>
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

      <section className="stack" style={{ gap: 10 }}>
        <div className="row between">
          <div className="eyebrow" style={{ margin: 0 }}>Cel tygodnia</div>
          <button className="link small" onClick={() => open('goal')}>
            {home.week.done.trainings} / {home.week.goal.trainings} treningi · {home.week.done.mindful} / {home.week.goal.mindful} chwile
          </button>
        </div>
        <Progress value={Math.min(home.week.done.trainings, home.week.goal.trainings) + Math.min(home.week.done.mindful, home.week.goal.mindful)} max={Math.max(1, home.week.goal.trainings + home.week.goal.mindful)} label="Postęp celu tygodnia" />
        <p className="small muted" style={{ margin: 0 }}>{home.week.message}</p>
      </section>

      {hasFeature(studio, 'shop') && (
        <button className="card flat row between" style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => open('shop')}>
          <span>
            <span className="card-title" style={{ display: 'block' }}>
              Sklep studia
            </span>
            <span className="small muted">Maty, akcesoria i stroje do domu</span>
          </span>
          <Icon name="bag" size={18} />
        </button>
      )}

      {home.trainerInvites.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">Zaproszenia od trenerek</div>
          {home.trainerInvites.map((i) => (
            <InviteCard key={i.id} invite={i} onChange={reload} onTrainer={() => open(`trainer/${i.trainerId}`)} />
          ))}
        </section>
      )}

      {(home.nps || home.survey || home.invites > 0 || home.quizDue || home.challenge) && (
        <section className="stack" style={{ gap: 8 }}>
          {home.survey && (
            <button className="card soft" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => open(`survey/${home.survey!.id}`)}>
              <b>Dawno Cię nie widziałyśmy</b>
              <div className="small muted">Co się stało? Jedno kliknięcie – bez presji.</div>
            </button>
          )}
          {home.nps && (
            <button className="card flat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => open(`nps/${home.nps!.id}`)}>
              <b>Jak Ci u nas?</b>
              <div className="small muted">Dwa kliknięcia, a bardzo nam pomogą.</div>
            </button>
          )}
          {home.invites > 0 && (
            <button className="card flat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => open('invites')}>
              <b>Masz zaproszenie na wspólny trening</b>
            </button>
          )}
          {home.challenge && (
            <button className="card flat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => open(`challenges/${home.challenge!.id}`)}>
              <b>Wyzwanie: {home.challenge.title}</b>
              <div className="small muted">Dołącz, w swoim tempie</div>
            </button>
          )}
          {home.quizDue && (
            <button className="card flat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => open('quiz')}>
              <b>Mój styl dnia</b>
              <div className="small muted">5 pytań, żeby lepiej dopasować przypomnienia</div>
            </button>
          )}
        </section>
      )}

      <hr className="hairline" />

      <section className="center" style={{ padding: '6px 8px' }}>
        <div className="eyebrow">Rytuał dnia</div>
        <p className="serif" style={{ fontSize: '1.55rem', lineHeight: 1.3, margin: 0 }}>
          {ritual}
        </p>
      </section>

      <hr className="hairline" />

      <div className="stack" style={{ gap: 0 }}>
        {/* Od najczęściej potrzebnego: kontakt (czat, telefon), potem dodatki. Kod wejścia – w Profilu i na karcie w dniu zajęć. */}
        {[
          // Jedna pozycja: czat z recepcją jest na górze strony Pomocy; licznik nieprzeczytanych zostaje tutaj.
          { label: home.chatUnread ? `Pomoc (${home.chatUnread})` : 'Pomoc', hint: 'Czat z recepcją, pytania i regulamin', to: 'faq' as const },
          ...(studio.phone ? [{ label: 'Zadzwoń do studia', hint: studio.phone, to: 'phone' as const }] : []),
          { label: 'Trzy minuty oddechu', hint: 'Rytm 4–6, prowadzi aplikacja', to: 'breath' as const },
          ...(home.eventsEnabled ? [{ label: 'Zorganizuj wydarzenie w naszym studiu', hint: 'Urodziny, babski wieczór, trening w prezencie', to: 'event-new' as const }] : []),
        ].map((l, i, all) => (
          <button
            key={l.label}
            className="row between"
            onClick={() => (l.to === 'breath' ? openBreath({ patternId: 'calm', minutes: 3 }) : l.to === 'phone' ? (location.href = `tel:${studio.phone!.replace(/\s/g, '')}`) : open(l.to))}
            style={{ background: 'none', border: 0, borderBottom: i < all.length - 1 ? '1px solid var(--line)' : 0, padding: '18px 0', cursor: 'pointer', textAlign: 'left' }}
          >
            <span>
              <span className="card-title" style={{ display: 'block' }}>{l.label}</span>
              <span className="small muted">{l.hint}</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
        ))}
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
      <div className="stack center" style={{ gap: 14, textAlign: 'center' }}>
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
