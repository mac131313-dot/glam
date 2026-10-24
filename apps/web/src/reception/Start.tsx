// Start recepcji: zapisy na dzisiejsze zajęcia, zajęcia teraz / za chwilę i to, co czeka na reakcję.
// Pełna lista dnia jest w Grafiku, skanowanie w Wejściu, rozmowy w Wiadomościach.
import { useEffect, useRef } from 'react';
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

      {sessions.length > 0 && (
        <section className="stack gap-2" aria-label="Klientki na dzisiejszych zajęciach">
          <div className="eyebrow" style={{ margin: 0 }}>Dziś na zajęciach</div>
          {sessions.map((s) => (
            <ClassStat key={s.id} session={s} booked={booked(s)} done={Date.parse(s.ends_at) <= now} />
          ))}
        </section>
      )}

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

/** Jedne zajęcia dnia: godzina, nazwa, zapisane / miejsca i cienki pasek zapełnienia; zakończone przygaszone. */
function ClassStat({ session: s, booked, done }: { session: Session; booked: number; done: boolean }) {
  const full = booked >= s.capacity;
  return (
    <div className="stack gap-1" style={{ opacity: done ? 0.6 : 1 }}>
      <div className="row" style={{ gap: 10, color: 'var(--ink)', fontWeight: 600 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums', width: 46, flex: 'none' }}>{fmtTime(s.starts_at)}</span>
        <span className="grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.class_name}</span>
        <span style={{ fontVariantNumeric: 'tabular-nums', flex: 'none' }}>
          {booked}
          <span style={{ fontWeight: 400 }}> / {s.capacity}</span>
        </span>
      </div>
      <div style={{ marginLeft: 56, height: 3, borderRadius: 2, background: 'var(--soft)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, (booked / Math.max(1, s.capacity)) * 100)}%`, height: '100%', background: full ? 'var(--ink)' : 'var(--brand)' }} />
      </div>
    </div>
  );
}
