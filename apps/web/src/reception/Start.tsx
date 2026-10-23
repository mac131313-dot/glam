// Start recepcji: dzień w trzech liczbach, zajęcia teraz / za chwilę i to, co czeka na reakcję.
// Pełna lista dnia jest w Grafiku, skanowanie w Wejściu, rozmowy w Wiadomościach.
import { useEffect, useRef } from 'react';
import { plural } from '@glam/core';
import { fmtLongDay, fmtTime, useApi } from '../api.ts';
import { Empty, ListRow, Pending } from '../ui.tsx';

type Session = { id: string; starts_at: string; ends_at: string; class_name: string; trainer_name: string; zone_name: string; capacity: number; status: string; participants: { status: string }[] };
type Day = { date: string; sessions: Session[] };
type Thread = { client_id: string; unread: number };
export function ReceptionStart({ go }: { go: (tab: 'schedule' | 'entrance' | 'messages') => void }) {
  const day = useApi<Day>('/staff/day');
  const arrivals = useApi<unknown[]>('/staff/arrivals');
  const chats = useApi<Thread[]>('/staff/chats');

  // Telefon leży na ladzie cały dzień: co minutę (i po powrocie do aplikacji) świeże liczby i „Za chwilę”.
  const refresh = () => (day.reload(), arrivals.reload(), chats.reload());
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

      <section className="row" style={{ gap: 0, background: 'var(--soft)', borderRadius: 999, padding: '18px 8px' }} aria-label="Dzień w liczbach">
        <DayNumber value={sessions.length} label={plural(sessions.length, 'zajęcia', 'zajęcia', 'zajęć')} />
        <DayNumber value={sessions.reduce((n, s) => n + booked(s), 0)} label="zapisanych" />
        <DayNumber value={arrivals.data?.length ?? '–'} label="obecnych" />
      </section>

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

      {(unread > 0 || ahead.length > 1) && (
        <section className="list-rows">
          {unread > 0 && <ListRow title={`${unread} ${plural(unread, 'rozmowa czeka', 'rozmowy czekają', 'rozmów czeka')} na odpowiedź`} onClick={() => go('messages')} />}
          {ahead.length > 1 && <ListRow title="Dalej dziś" hint={ahead.slice(1, 4).map((s) => `${fmtTime(s.starts_at)} ${s.class_name}`).join(' · ')} onClick={() => go('schedule')} />}
        </section>
      )}
    </div>
  );
}

function DayNumber({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="grow" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 }}>
      <span style={{ fontSize: '1.25rem', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      <span className="tiny muted">{label}</span>
    </div>
  );
}
