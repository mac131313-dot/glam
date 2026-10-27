// Start recepcji: zapisy na dzisiejsze zajęcia, zajęcia teraz / za chwilę i to, co czeka na reakcję.
// Pełna lista dnia jest w Grafiku, skanowanie w Wejściu, rozmowy w Wiadomościach.
import { useEffect, useId, useRef, useState } from 'react';
import { plural } from '@glam/core';
import { fmtLongDay, fmtTime, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { Empty, ListRow, Pending } from '../ui.tsx';

type Session = { id: string; starts_at: string; ends_at: string; class_name: string; trainer_name: string; zone_name: string; capacity: number; status: string; participants: { status: string }[] };
type Day = { date: string; sessions: Session[] };
type Thread = { client_id: string; unread: number };
export function ReceptionStart({ go }: { go: (tab: 'schedule' | 'entrance' | 'messages') => void }) {
  const day = useApi<Day>('/staff/day');
  const chats = useApi<Thread[]>('/staff/chats');

  // Telefon leży na ladzie cały dzień: co minutę (i po powrocie do aplikacji) świeże zapisy i „Za chwilę”.
  const refresh = () => (day.reload(), chats.reload());
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    const tick = () => document.visibilityState === 'visible' && refreshRef.current();
    const t = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => (clearInterval(t), document.removeEventListener('visibilitychange', tick));
  }, []);

  if (!day.data) return <Pending error={day.error} reload={day.reload} />;
  const now = Date.now();
  const sessions = day.data.sessions.filter((s) => s.status !== 'cancelled');
  const booked = (s: Session) => s.participants.filter((p) => p.status === 'booked' || p.status === 'attended').length;
  const waiting = (s: Session) => s.participants.filter((p) => p.status === 'waitlist').length;
  const ahead = sessions.filter((s) => Date.parse(s.ends_at) > now);
  const next = ahead[0];
  const live = next && Date.parse(next.starts_at) <= now;
  const unread = (chats.data ?? []).filter((t) => t.unread > 0).length;

  return (
    <div className="stack-lg">
      <section style={{ paddingTop: 8 }}>
        <p className="eyebrow">{fmtLongDay(new Date().toISOString())}</p>
        <h1 style={{ fontSize: '2.4rem', lineHeight: 1.05 }}>
          Dzień dobry
        </h1>
        <p className="serif muted" style={{ fontSize: '1.35rem', margin: '6px 0 0' }}>
          Eat. Sleep. Pilates. Repeat.
        </p>
      </section>

      {sessions.length > 0 && <DayList sessions={sessions} ahead={ahead} booked={booked} now={now} />}

      <section className="stack gap-3">
        <div className="eyebrow" style={{ margin: 0 }}>{live ? 'Teraz' : 'Za chwilę'}</div>
        {next ? (
          <div className="card stack gap-3">
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div>
                <div className="eyebrow" style={{ margin: 0 }}>
                  {fmtTime(next.starts_at)}–{fmtTime(next.ends_at)}
                </div>
                <div className="card-title" style={{ fontSize: '1.3rem' }}>{next.class_name}</div>
                <div className="small muted">
                  {next.trainer_name} · {next.zone_name}
                </div>
              </div>
              <span className={`badge ${booked(next) >= next.capacity ? 'warn' : 'ok'}`}>
                {booked(next)} / {next.capacity}
              </span>
            </div>
            {waiting(next) > 0 && <span className="small muted">Na liście oczekujących: {waiting(next)}</span>}
            <button className="btn" onClick={() => go('entrance')}>
              Zapisz wejście
            </button>
          </div>
        ) : (
          <div className="card">
            <Empty>{sessions.length ? 'Na dziś to już wszystkie zajęcia.' : 'Dziś nie ma zajęć.'}</Empty>
          </div>
        )}
      </section>

      {unread > 0 && (
        <button className="inbox-nudge" onClick={() => go('messages')}>
          <span className="inbox-nudge-icon">
            <Icon name="chat" size={20} />
          </span>
          <span className="grow">
            <span className="card-title" style={{ display: 'block', fontSize: '1rem' }}>
              {unread} {plural(unread, 'rozmowa', 'rozmowy', 'rozmów')}
            </span>
            <span className="small muted">{plural(unread, 'czeka', 'czekają', 'czeka')} na odpowiedź</span>
          </span>
          <Icon name="chevron" size={18} />
        </button>
      )}

      {ahead.length > 1 && (
        <section className="list-rows">
          <ListRow title="Dalej dziś" hint={ahead.slice(1, 4).map((s) => `${fmtTime(s.starts_at)} ${s.class_name}`).join(' · ')} onClick={() => go('schedule')} />
        </section>
      )}
    </div>
  );
}

/**
 * Dzisiejsze zajęcia: trzy najbliższe zawsze widoczne, reszta (dalsze i zakończone) rozwija się w dół.
 * Gdy wszystko już się skończyło, widać trzy pierwsze z dnia.
 */
function DayList({ sessions, ahead, booked, now }: { sessions: Session[]; ahead: Session[]; booked: (s: Session) => number; now: number }) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const main = ahead.length ? ahead : sessions;
  const ended = ahead.length ? sessions.filter((s) => Date.parse(s.ends_at) <= now) : [];
  const later = main.slice(3);
  const hidden = later.length + ended.length;
  const row = (s: Session) => <ClassStat key={s.id} session={s} booked={booked(s)} done={Date.parse(s.ends_at) <= now} />;
  return (
    <section className="stack gap-2" aria-label="Klientki na dzisiejszych zajęciach">
      <div className="row between" style={{ alignItems: 'baseline' }}>
        <div className="eyebrow" style={{ margin: 0 }}>Dziś na zajęciach</div>
        <span className="small muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {sessions.reduce((n, s) => n + booked(s), 0)} / {sessions.reduce((n, s) => n + s.capacity, 0)}
        </span>
      </div>
      <div className="day-list">
        {main.slice(0, 3).map(row)}
        {hidden > 0 && (
          <div className={open ? 'day-more is-open' : 'day-more'} id={bodyId} inert={!open}>
            <div className="day-list">
              {later.map(row)}
              {ended.length > 0 && <div className="day-list-label">Zakończone</div>}
              {ended.map(row)}
            </div>
          </div>
        )}
      </div>
      {hidden > 0 && (
        <button type="button" className="day-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
          {open ? 'Zwiń' : `Pokaż jeszcze ${hidden}`}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
    </section>
  );
}

/** Jeden wiersz rozwijanej listy dnia: godzina, nazwa, zapisane / miejsca; pełne wyraźne, zakończone przygaszone. */
function ClassStat({ session: s, booked, done }: { session: Session; booked: number; done: boolean }) {
  const full = booked >= s.capacity;
  return (
    <div className={done ? 'day-row is-done' : 'day-row'}>
      <span className="day-row-time">{fmtTime(s.starts_at)}</span>
      <span className="day-row-name">{s.class_name}</span>
      <span className={full ? 'day-row-count is-full' : 'day-row-count'}>
        {booked}/{s.capacity}
      </span>
    </div>
  );
}
