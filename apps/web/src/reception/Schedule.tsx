// Grafik recepcji: ten sam układ co u klientki (pasek dni, kafelki ze zdjęciem, Dzień / Tydzień), ale z oczu
// studia – wszystkie zajęcia (także niepubliczne), zajętość i lista oczekujących. Kafelek otwiera listę
// uczestniczek z check-inem (dziś).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { plural } from '@glam/core';
import { addDaysStr, api, fmtLongDay, fmtMinutes, fmtTime, localDate, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { ClassCover } from '../client/ClassCover.tsx';
import { Avatar, Empty, Fold, reducedMotion, Sheet, Spinner, useAction } from '../ui.tsx';

type Session = {
  id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: string;
  kind: string;
  public: number;
  class_name: string;
  level: string | null;
  photo_url: string | null;
  zone_name: string;
  trainer_name: string;
  trainer_avatar_url: string | null;
  taken: number;
  waiting: number;
};

type Participant = { booking_id: string; status: string; name: string; visits: number; guest_name: string | null; health: { limitations?: string; injuries?: string; pregnancy?: boolean } | null };
type Day = { sessions: { id: string; participants: Participant[] }[] };

const DOW = ['nd', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob'];
const classCount = (n: number) => (n === 1 ? 'jedne zajęcia' : `${n} ${n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? 'zajęcia' : 'zajęć'}`);

export function ReceptionSchedule() {
  const today = localDate();
  const [view, setView] = useState<'day' | 'week'>('day');
  const [day, setDay] = useState(today);
  const [detail, setDetail] = useState<Session | null>(null);
  const { data, error, reload } = useApi<Session[]>(`/staff/schedule?from=${today}&days=21`);

  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!strip || !chip) return;
    strip.scrollTo({ left: chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.clientWidth) / 2, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [day, view]);

  const sessions = data ?? [];
  const dateOf = (s: Session) => localDate(new Date(s.starts_at));
  const list = view === 'week' ? sessions.filter((s) => dateOf(s) >= day && dateOf(s) < addDaysStr(day, 7)) : sessions.filter((s) => dateOf(s) === day);
  const days = Array.from({ length: 14 }, (_, i) => addDaysStr(today, i));
  const weekDays: { date: string; items: Session[] }[] = [];
  for (const s of view === 'week' ? list : []) {
    const last = weekDays[weekDays.length - 1];
    if (last?.date === dateOf(s)) last.items.push(s);
    else weekDays.push({ date: dateOf(s), items: [s] });
  }
  const grid = (items: Session[]) => (
    <div className="session-grid">
      {items.map((s) => (
        <SessionTile key={s.id} s={s} onOpen={() => setDetail(s)} />
      ))}
    </div>
  );

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Grafik</h1>
        <div className="segmented" role="group" aria-label="Widok grafiku">
          {(
            [
              ['day', 'Dzień'],
              ['week', 'Tydzień'],
            ] as const
          ).map(([v, l]) => (
            <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="chips" role="group" aria-label="Wybierz dzień" ref={stripRef}>
        {days.map((d) => {
          const date = new Date(`${d}T12:00:00Z`);
          return (
            <button key={d} className="day ring" aria-pressed={d === day} onClick={() => setDay(d)}>
              <svg viewBox="0 0 56 56" aria-hidden="true">
                <circle cx="28" cy="28" r="26" pathLength={24} />
              </svg>
              {d === today ? 'dziś' : DOW[date.getUTCDay()]}
              <b>{date.getUTCDate()}</b>
            </button>
          );
        })}
      </div>

      {!data && error && (
        <Empty>
          Nie udało się wczytać grafiku.{' '}
          <button className="link" onClick={reload}>
            Spróbuj ponownie
          </button>
        </Empty>
      )}
      {!data && !error && <Spinner />}

      {data && list.length === 0 && (
        <section className="day-rest" aria-live="polite">
          <span className="day-rest-icon">
            <Icon name="leaf" size={20} />
          </span>
          <h2>
            {view === 'week' ? 'W tym tygodniu' : 'Tego dnia'} <span className="serif">bez zajęć</span>
          </h2>
        </section>
      )}

      {data && view === 'day' && list.length > 0 && (
        <div className="folds">
          <Fold key={day} title={fmtLongDay(`${day}T12:00:00Z`)} meta={classCount(list.length)} defaultOpen>
            {grid(list)}
          </Fold>
        </div>
      )}

      {data && view === 'week' && (
        <div className="folds">
          {weekDays.map((g, i) => (
            <Fold key={`${day}-${g.date}`} title={fmtLongDay(g.items[0].starts_at)} meta={classCount(g.items.length)} defaultOpen={i === 0}>
              {grid(g.items)}
            </Fold>
          ))}
        </div>
      )}

      {detail && <SessionSheet s={detail} onClose={() => setDetail(null)} onChanged={reload} />}
    </div>
  );
}

function SessionTile({ s, onOpen }: { s: Session; onOpen: () => void }) {
  const past = Date.parse(s.ends_at) < Date.now();
  const full = s.taken >= s.capacity;
  return (
    <ClassCover
      compact
      photoUrl={s.photo_url}
      onClick={onOpen}
      dimmed={past || s.status === 'cancelled'}
      eyebrow={`${fmtTime(s.starts_at)} · ${Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000)} min`}
      title={s.class_name}
      aside={
        <span className="cover-face" title={`prowadzi ${s.trainer_name}`} aria-label={`prowadzi ${s.trainer_name}`} role="img">
          {s.trainer_avatar_url ? <img src={s.trainer_avatar_url} alt="" loading="lazy" /> : s.trainer_name.charAt(0)}
        </span>
      }
      corner={s.status === 'cancelled' ? <span className="badge">odwołane</span> : <span className={`badge ${full ? 'warn' : 'ok'}`}>{s.taken} / {s.capacity}</span>}
      footer={s.status === 'cancelled' ? null : s.waiting > 0 ? `${s.waiting} na liście oczekujących` : full ? 'Komplet' : !s.public ? 'niepubliczne' : null}
    />
  );
}

/** Arkusz zajęć: kto jest zapisany, kto czeka, check-in w dniu zajęć. */
function SessionSheet({ s, onClose, onChanged }: { s: Session; onClose: () => void; onChanged: () => unknown }) {
  const date = localDate(new Date(s.starts_at));
  const { data, reload } = useApi<Day>(`/staff/day?date=${date}`, [date]);
  const { run, busy } = useAction();
  const people = data?.sessions.find((x) => x.id === s.id)?.participants ?? null;
  const booked = people?.filter((p) => p.status !== 'waitlist') ?? [];
  const waiting = people?.filter((p) => p.status === 'waitlist') ?? [];
  const isToday = date === localDate();
  const checkIn = (p: Participant) =>
    run(
      () => api(`/staff/bookings/${p.booking_id}/checkin`, { method: 'POST' }).then(() => Promise.all([reload(), onChanged()])),
      `${p.name} – obecna ✓`,
    );

  return (
    <Sheet onClose={onClose} label={s.class_name}>
      <div className="stack">
        <div className="eyebrow">{fmtLongDay(s.starts_at)}</div>
        <h2 style={{ fontSize: '1.8rem', margin: 0 }}>
          {s.class_name} <span className="serif">{fmtTime(s.starts_at)}</span>
        </h2>
        <div className="meta-line">
          {[s.trainer_name, s.zone_name, fmtMinutes(Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60_000)), s.status === 'cancelled' ? 'odwołane' : `${s.taken} / ${s.capacity}`].map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>

        {!people && <Spinner />}
        {people && booked.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nikt jeszcze się nie zapisał.</p>}
        {booked.length > 0 && (
          <section className="stack gap-2">
            <div className="eyebrow" style={{ margin: 0 }}>Zapisane</div>
            {booked.map((p) => (
              <PersonRow key={p.booking_id} p={p}>
                {p.status === 'attended' ? (
                  <span className="badge ok">obecna</span>
                ) : p.status === 'no_show' ? (
                  <span className="badge">nieobecna</span>
                ) : isToday && s.status !== 'cancelled' ? (
                  <button className="btn sm" disabled={busy} onClick={() => checkIn(p)}>
                    Zapisz wejście
                  </button>
                ) : null}
              </PersonRow>
            ))}
          </section>
        )}
        {waiting.length > 0 && (
          <section className="stack gap-2">
            <div className="eyebrow" style={{ margin: 0 }}>Lista oczekujących</div>
            {waiting.map((p, i) => (
              <PersonRow key={p.booking_id} p={p}>
                <span className="badge warn">{i + 1}.</span>
              </PersonRow>
            ))}
          </section>
        )}
      </div>
    </Sheet>
  );
}

function PersonRow({ p, children }: { p: Participant; children: ReactNode }) {
  const health = p.health && [p.health.pregnancy && 'ciąża', p.health.limitations, p.health.injuries].filter(Boolean).join(' · ');
  return (
    <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <Avatar name={p.name} size="sm" />
      <div className="grow" style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600 }}>{p.name}</div>
        <div className="tiny muted">
          {p.visits === 0 && !p.guest_name ? 'pierwszy raz' : `${p.visits} ${plural(p.visits, 'wizyta', 'wizyty', 'wizyt')}`}
          {health && <span style={{ color: 'var(--brand-strong)' }}> · ⚑ {health}</span>}
        </div>
      </div>
      {children}
    </div>
  );
}
