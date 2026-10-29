// Grafik recepcji: ten sam grafik co u klientki (pasek dni, Dzień / Tydzień), ale zajęcia jako zwarta lista zajętości,
// plansza pustego dnia – wspólne kawałki są w client/ScheduleParts.tsx. Z oczu studia:
// wszystkie zajęcia (także niepubliczne), zajętość i lista oczekujących, a arkusz to lista uczestniczek z check-inem (dziś).
// Dzisiejsze zajęcia zostają na kafelkach także po ich rozpoczęciu – recepcja zapisuje wejścia.
// Miesiąc to lista wszystkich dni z zajęciami jako zwijane sekcje (zamiast kalendarza) – kafelki powstają po rozwinięciu.
import { useRef, useState, type ReactNode } from 'react';
import { plural } from '@glam/core';
import { addDaysStr, api, fmtLongDay, fmtMinutes, fmtTime, localDate, useApi } from '../api.ts';
import { classCount, DayRest, DayStrip, MonthHead, useMorphSheet, useScheduleView, ViewSwitch, type DayRestKind } from '../client/ScheduleParts.tsx';
import { AddParticipant } from '../staff/Today.tsx';
import { Avatar, Empty, Fold, Sheet, Spinner, UNDO_MS, useAction, useToast } from '../ui.tsx';

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
  // Recepcja patrzy na zajętość, nie na zdjęcia: zwarta lista – na ekranie mieści się cały dzień.
  const grid = (items: Session[]) => (
    <div className="rs-list">
      {items.map((s) => (
        <SessionRow key={s.id} s={s} onOpen={(el) => openFromTile(s, el)} />
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

/** Wiersz zajęć: godzina i czas trwania, nazwa, kto prowadzi i gdzie, zajętość z paskiem. Zakończone i odwołane przygaszone. */
function SessionRow({ s, onOpen }: { s: Session; onOpen: (row: HTMLElement) => void }) {
  const past = Date.parse(s.ends_at) < Date.now();
  const cancelled = s.status === 'cancelled';
  const full = s.taken >= s.capacity;
  const minutes = Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000);
  const badge = cancelled ? 'odwołane' : !s.public ? 'niepubliczne' : s.kind === 'themed' ? 'tematyczne' : s.kind === 'special' ? 'specjalne' : null;
  return (
    <button className={`rs-row${past || cancelled ? ' is-done' : ''}`} onClick={(e) => onOpen(e.currentTarget)}>
      <span className="rs-time">
        {fmtTime(s.starts_at)}
        <span>{minutes} min</span>
      </span>
      <span className="rs-main">
        <span className="rs-name">
          {s.class_name}
          {badge && <span className="badge">{badge}</span>}
        </span>
        <span className="rs-meta">
          {s.trainer_name} · {s.zone_name}
        </span>
      </span>
      {!cancelled && (
        <span className={`rs-count${full ? ' is-full' : ''}`}>
          {s.taken}/{s.capacity}
          <span className="rs-bar" aria-hidden>
            <i style={{ transform: `scaleX(${Math.min(1, s.taken / Math.max(1, s.capacity))})` }} />
          </span>
          {s.waiting > 0 && <span>+{s.waiting} czeka</span>}
        </span>
      )}
    </button>
  );
}

/** Zajęcia w arkuszu – wystarczy to, co mają i Grafik, i Start recepcji (zdjęcie i zajętość są opcjonalne). */
export type SheetSession = Pick<Session, 'id' | 'starts_at' | 'ends_at' | 'class_name' | 'trainer_name' | 'zone_name' | 'capacity' | 'status'> & { photo_url?: string | null; taken?: number };

type Mark = 'attended' | 'no_show';
/**
 * Obecność i nieobecność zapisują się dopiero po czasie na cofnięcie (UNDO_MS) – do tego czasu widać je od razu,
 * a „Cofnij” w komunikacie po prostu nic nie wysyła. Serwer nie musi umieć odkręcać punktów lojalnościowych.
 * Odliczanie żyje poza arkuszem: zamknięcie arkusza nie gubi zapisu, a cofnąć można także po zamknięciu.
 */
const pendingMarks = new Map<string, { kind: Mark; timer: number; send: () => void }>();
const flushMarks = () => {
  for (const [id, m] of pendingMarks) {
    window.clearTimeout(m.timer);
    pendingMarks.delete(id);
    m.send();
  }
};
// Aplikacja chowana albo zamykana – zapisujemy od razu, żeby obecność nie przepadła.
if (typeof window !== 'undefined') window.addEventListener('pagehide', flushMarks);

/** Arkusz zajęć: kto jest zapisany, kto czeka; obecność, nieobecność, wypisanie i dopisanie osoby. Nagłówek i animacje jak u klientki. */
export function SessionSheet({ s, morph, onClose, onChanged }: { s: SheetSession; morph: boolean; onClose: () => void; onChanged: () => unknown }) {
  const date = localDate(new Date(s.starts_at));
  const { data, reload } = useApi<Day>(`/staff/day?date=${date}`, [date]);
  const { run, busy } = useAction();
  const toast = useToast();
  const [marks, setMarks] = useState<Record<string, Mark>>(() => Object.fromEntries([...pendingMarks].map(([id, m]) => [id, m.kind])));
  const [adding, setAdding] = useState(false);
  const [confirmDrop, setConfirmDrop] = useState<string | null>(null);
  const refresh = useRef(() => Promise.all([reload(), onChanged()]));
  refresh.current = () => Promise.all([reload(), onChanged()]);
  const people = data?.sessions.find((x) => x.id === s.id)?.participants ?? null;
  const booked = people?.filter((p) => p.status !== 'waitlist') ?? [];
  const waiting = people?.filter((p) => p.status === 'waitlist') ?? [];
  const isToday = date === localDate();
  const open = s.status !== 'cancelled';
  const ended = Date.parse(s.ends_at) <= Date.now();
  const taken = people ? booked.length : s.taken ?? 0;

  const mark = (p: Participant, kind: Mark) => {
    const drop = () => setMarks(({ [p.booking_id]: _, ...rest }) => rest);
    const send = () =>
      api(`/staff/bookings/${p.booking_id}/${kind === 'attended' ? 'checkin' : 'no-show'}`, { method: 'POST' })
        .then(() => refresh.current())
        .catch((e: Error) => (drop(), toast(e.message || 'Nie udało się zapisać.', 'error')));
    setMarks((m) => ({ ...m, [p.booking_id]: kind }));
    const timer = window.setTimeout(() => {
      pendingMarks.delete(p.booking_id);
      send();
    }, UNDO_MS);
    pendingMarks.set(p.booking_id, { kind, timer, send });
    toast(`${p.name} – ${kind === 'attended' ? 'obecna' : 'nieobecna'}`, 'ok', {
      label: 'Cofnij',
      run: () => {
        const m = pendingMarks.get(p.booking_id);
        if (!m) return;
        window.clearTimeout(m.timer);
        pendingMarks.delete(p.booking_id);
        drop();
      },
    });
  };
  // Wypisanie oddaje wejście i powiadamia klientkę – drugie stuknięcie w ten sam przycisk potwierdza (bez okna, które blokuje ekran).
  const remove = (p: Participant) => {
    if (confirmDrop !== p.booking_id) return setConfirmDrop(p.booking_id);
    setConfirmDrop(null);
    run(() => api(`/staff/bookings/${p.booking_id}`, { method: 'DELETE' }).then(() => refresh.current()), `${p.name} wypisana z zajęć`);
  };

  return (
    <>
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
          {[s.trainer_name, s.zone_name, fmtMinutes(Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60_000)), s.status === 'cancelled' ? 'odwołane' : `${taken} / ${s.capacity}`].map((x) => (
            <span key={x}>{x}</span>
          ))}
        </div>

        {!people && <Spinner />}
        {people && booked.length === 0 && <p className="small muted" style={{ margin: 0 }}>Nikt jeszcze się nie zapisał.</p>}
        {booked.length > 0 && (
          <section className="stack gap-2">
            <div className="eyebrow" style={{ margin: 0 }}>Zapisane</div>
            {booked.map((p) => {
              const status: string = marks[p.booking_id] ?? p.status;
              const undecided = status === 'booked';
              return (
                <PersonRow key={p.booking_id} p={p} badge={status === 'attended' ? <span className="badge ok">obecna</span> : status === 'no_show' ? <span className="badge">nieobecna</span> : null}>
                  {undecided && open && (
                    <div className="person-actions">
                      {isToday && (
                        <>
                          <button className="btn sm" disabled={busy} onClick={() => mark(p, 'attended')}>
                            Obecna
                          </button>
                          <button className="btn ghost sm" disabled={busy} onClick={() => mark(p, 'no_show')}>
                            Nie przyszła
                          </button>
                        </>
                      )}
                      {!ended && (
                        <button className="btn danger sm" disabled={busy} onClick={() => remove(p)} onBlur={() => setConfirmDrop(null)}>
                          {confirmDrop === p.booking_id ? 'Na pewno wypisać?' : 'Wypisz'}
                        </button>
                      )}
                    </div>
                  )}
                </PersonRow>
              );
            })}
          </section>
        )}
        {waiting.length > 0 && (
          <section className="stack gap-2">
            <div className="eyebrow" style={{ margin: 0 }}>Lista oczekujących</div>
            {waiting.map((p, i) => (
              <PersonRow key={p.booking_id} p={p} badge={<span className="badge warn">{i + 1}.</span>} />
            ))}
          </section>
        )}
        {/* Osoba bez zapisu przy ladzie – dopisanie od razu z arkusza (karnet albo płatność na miejscu). */}
        {open && !ended && (
          <button className="btn ghost block" onClick={() => setAdding(true)}>
            Dopisz osobę
          </button>
        )}
      </div>
    </Sheet>
    {/* Obok arkusza, nie w nim: przesuwany arkusz (transform) zamknąłby w sobie okno z position: fixed. */}
    {adding && <AddParticipant session={s} onClose={() => setAdding(false)} onDone={() => refresh.current()} />}
    </>
  );
}

function PersonRow({ p, badge, children }: { p: Participant; badge?: ReactNode; children?: ReactNode }) {
  const health = p.health && [p.health.pregnancy && 'ciąża', p.health.limitations, p.health.injuries].filter(Boolean).join(' · ');
  return (
    <div className="person-row">
      <div className="row">
        <Avatar name={p.name} size="sm" />
        <div className="grow" style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{p.name}</div>
          <div className="tiny muted">
            {p.visits === 0 && !p.guest_name ? 'pierwszy raz' : `${p.visits} ${plural(p.visits, 'wizyta', 'wizyty', 'wizyt')}`}
            {health && <span style={{ color: 'var(--brand-strong)' }}> · ⚑ {health}</span>}
          </div>
        </div>
        {badge}
      </div>
      {children}
    </div>
  );
}
