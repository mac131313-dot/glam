// Grafik recepcji: ten sam grafik co u klientki (pasek dni, Dzień / Tydzień, kafelki ze zdjęciem,
// plansza pustego dnia, przelot zdjęcia do arkusza) – wspólne kawałki są w client/ScheduleParts.tsx. Z oczu studia:
// wszystkie zajęcia (także niepubliczne), zajętość i lista oczekujących, a arkusz to lista uczestniczek z check-inem (dziś).
// Dzisiejsze zajęcia zostają na kafelkach także po ich rozpoczęciu – recepcja zapisuje wejścia.
// Miesiąc to lista wszystkich dni z zajęciami jako zwijane sekcje (zamiast kalendarza) – kafelki powstają po rozwinięciu.
import { useRef, useState, type ReactNode } from 'react';
import { plural } from '@glam/core';
import { addDaysStr, api, fmtLongDay, fmtMinutes, fmtTime, localDate, useApi } from '../api.ts';
import { ClassCover } from '../client/ClassCover.tsx';
import { classCount, DayRest, DayStrip, MonthHead, TrainerFace, useMorphSheet, useScheduleView, ViewSwitch, type DayRestKind } from '../client/ScheduleParts.tsx';
import { Avatar, Empty, Fold, Sheet, Spinner, useAction } from '../ui.tsx';

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

export function ReceptionSchedule() {
  /** Hook grafiku przewija do panelu dnia pod kalendarzem; recepcja ma w miesiącu listę dni, więc ref zostaje pusty. */
  const monthDayRef = useRef<HTMLElement>(null);
  const { today, view, day, setDay, month, monthOffset, from, span, changeView, changeMonth } = useScheduleView(monthDayRef);
  const { data, error, reload } = useApi<Session[]>(`/staff/schedule?from=${from}&days=${span}`);
  const [detail, setDetail] = useState<Session | null>(null);
  /** Zdjęcie przelatuje z kafelka na górę arkusza, a przy zamknięciu wraca na swoje miejsce. */
  const { morph, openFromTile, close } = useMorphSheet(setDetail, () => setDetail(null));

  const sessions = data ?? [];
  const dateOf = (s: Session) => localDate(new Date(s.starts_at));
  const list = view === 'month' ? sessions : view === 'week' ? sessions.filter((s) => dateOf(s) >= day && dateOf(s) < addDaysStr(day, 7)) : sessions.filter((s) => dateOf(s) === day);
  /** Pusty dzień – ta sama spokojna plansza co u klientki, z wyjściem do najbliższych zajęć. */
  const dayRest: DayRestKind | null = view === 'day' && list.length === 0 ? (day === today ? 'today-empty' : 'empty') : null;
  const nextAfterDay = dayRest ? sessions.find((s) => s.status !== 'cancelled' && Date.parse(s.starts_at) > Date.now() && dateOf(s) > day) ?? null : null;
  /** Tydzień i miesiąc pogrupowane po dniach – każdy dzień to osobna zwijana sekcja. */
  const weekDays: { date: string; items: Session[] }[] = [];
  for (const s of view === 'day' ? [] : list) {
    const last = weekDays[weekDays.length - 1];
    if (last?.date === dateOf(s)) last.items.push(s);
    else weekDays.push({ date: dateOf(s), items: [s] });
  }
  const grid = (items: Session[]) => (
    <div className="session-grid">
      {items.map((s) => (
        <SessionTile key={s.id} s={s} onOpen={(el) => openFromTile(s, el)} />
      ))}
    </div>
  );

  return (
    <div className="stack">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Grafik</h1>
        <ViewSwitch view={view} onChange={changeView} />
      </div>

      {view === 'month' ? (
        <MonthHead month={month} offset={monthOffset} onMonth={changeMonth} />
      ) : (
        <DayStrip today={today} day={day} view={view} onPick={setDay} />
      )}

      {!data && error && (
        <Empty>
          Nie udało się wczytać grafiku.{' '}
          <button className="link" onClick={reload}>
            Spróbuj ponownie
          </button>
        </Empty>
      )}
      {!data && !error && <Spinner />}

      {data && dayRest && <DayRest kind={dayRest} next={nextAfterDay} onNext={setDay} />}
      {data && view === 'day' && list.length > 0 && (
        <div className="folds">
          <Fold key={`day-${day}`} title="Zajęcia tego dnia" meta={classCount(list.length)} defaultOpen>
            {grid(list)}
          </Fold>
        </div>
      )}

      {/* Tydzień i miesiąc: dni jako zwijane sekcje. W miesiącu wszystkie zwinięte – kafelki powstają dopiero po rozwinięciu dnia. */}
      {view !== 'day' && data && (
        <>
          {list.length === 0 && <Empty>{view === 'week' ? 'W tym tygodniu nie ma zajęć.' : 'W tym miesiącu nie ma już zajęć.'}</Empty>}
          <div className="folds">
            {weekDays.map((g, i) => (
              <Fold
                key={`${view}-${from}-${g.date}`}
                lazy
                title={g.date === today ? `Dziś · ${fmtLongDay(g.items[0].starts_at)}` : fmtLongDay(g.items[0].starts_at)}
                meta={classCount(g.items.length)}
                defaultOpen={view === 'week' && i === 0}
              >
                {grid(g.items)}
              </Fold>
            ))}
          </div>
        </>
      )}

      {detail && <SessionSheet s={detail} morph={morph} onClose={close} onChanged={reload} />}
    </div>
  );
}

/** Kafelek jak u klientki; w stopce zajętość zamiast wolnych miejsc. */
function SessionTile({ s, onOpen }: { s: Session; onOpen: (tile: HTMLElement) => void }) {
  const past = Date.parse(s.ends_at) < Date.now();
  const full = s.taken >= s.capacity;
  return (
    <ClassCover
      compact
      photoUrl={s.photo_url}
      onClick={(e) => onOpen(e.currentTarget)}
      dimmed={past || s.status === 'cancelled'}
      eyebrow={`${fmtTime(s.starts_at)} · ${Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000)} min`}
      title={s.class_name}
      aside={<TrainerFace name={s.trainer_name} url={s.trainer_avatar_url} />}
      corner={
        s.status === 'cancelled' ? (
          <span className="badge">odwołane</span>
        ) : !s.public ? (
          <span className="badge">niepubliczne</span>
        ) : s.kind === 'themed' || s.kind === 'special' ? (
          <span className="badge">{s.kind === 'themed' ? 'tematyczne' : 'specjalne'}</span>
        ) : null
      }
      footer={s.status === 'cancelled' ? null : full ? (s.waiting > 0 ? `Komplet · ${s.waiting} na liście` : 'Komplet') : `${s.taken} z ${s.capacity} zapisanych`}
    />
  );
}

/** Arkusz zajęć: kto jest zapisany, kto czeka, check-in w dniu zajęć. Nagłówek i animacje jak u klientki. */
function SessionSheet({ s, morph, onClose, onChanged }: { s: Session; morph: boolean; onClose: () => void; onChanged: () => unknown }) {
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
    <Sheet onClose={onClose} label={s.class_name} className={morph ? 'class-sheet morph' : 'class-sheet'}>
      <div className="stack">
        {/* Ze zdjęciem: zdjęcie na całą szerokość arkusza, data i nazwa leżą na nim. Bez zdjęcia – zwykły nagłówek. */}
        {s.photo_url ? (
          <div className="sheet-hero">
            <img src={s.photo_url} alt="" />
            <div className="sheet-hero-text">
              <div className="eyebrow">{fmtLongDay(s.starts_at)}</div>
              <h2>
                {s.class_name} <span className="serif">{fmtTime(s.starts_at)}</span>
              </h2>
            </div>
          </div>
        ) : (
          <>
            <div className="eyebrow">{fmtLongDay(s.starts_at)}</div>
            <div className="sheet-title">
              <h2 style={{ fontSize: '1.8rem' }}>
                {s.class_name} <span className="serif">{fmtTime(s.starts_at)}</span>
              </h2>
            </div>
          </>
        )}
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
