// Panel „Dla mnie” pod piwonią – tydzień klientki w jednym spojrzeniu (inspiracja: pulpit opaski fitness,
// przełożony na to, co GLAM naprawdę wie): ruch z rezerwacji, oddech z sesji w aplikacji, samopoczucie z dziennika.
// Bez ocen i bez wniosków o zdrowiu – tylko lustro tygodnia i jedna podpowiedź, co dalej.
import { useEffect, useRef, useState } from 'react';
import { goalCount, goalExtra, MOOD_LABELS, patternById, sessionById, type BreathRitual } from '@glam/core';
import { fmtTime, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { MiniBloom } from './BreathBloom.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';

type Entry = { date: string; mood: number; energy: number; sleep: number };
type Home = {
  week: { goal: { trainings: number; mindful: number }; done: { trainings: number; mindful: number }; message: string; restDay: boolean };
  upcoming: { booking_id: string; status: string; starts_at: string; class_name: string; trainer_name: string }[];
  ritual: string;
};
type Cycle = { consent: boolean; today?: { label: string; hint: string; day: number } | null };

const DAYS = ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'];
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Samopoczucie dnia (0–100) z wpisu w dzienniku: nastrój, energia i sen, każde w skali 1–5.
 * To odpowiednik „Recovery” – jedna liczba, która ma pomóc wybrać tempo dnia, a nie oceniać.
 */
export function wellbeingScore(e: Pick<Entry, 'mood' | 'energy' | 'sleep'>): number {
  // TODO(Maciek): zdecyduj, jak ważyć trzy składowe. Na razie zwykła średnia przeskalowana z 1–5 na 0–100.
  // Do rozważenia: czy sen powinien ważyć więcej (jak w opaskach), czy nastrój – bo to on mówi, jak się czuje?
  // Czy „ciężko” (1) ma dawać 0%, czy raczej łagodne minimum, żeby pierścień nigdy nie był pusty i nie zawstydzał?
  const avg = (e.mood + e.energy + e.sleep) / 3;
  return Math.round(((avg - 1) / 4) * 100);
}

/**
 * Kolor pierścienia mówi, jak idzie – bez czerwieni i bez oceniania: od ciepłej gliny (dopiero start),
 * przez piasek (w połowie), do szałwii (dobrze) i głębokiej szałwii (cel domknięty).
 * Progi są wspólne dla wszystkich trzech pierścieni, żeby ten sam kolor znaczył wszędzie to samo.
 */
export function ringTone(value: number): 'none' | 'low' | 'mid' | 'good' | 'full' {
  if (value <= 0) return 'none';
  if (value >= 1) return 'full';
  if (value >= 0.67) return 'good';
  if (value >= 0.34) return 'mid';
  return 'low';
}
const TONE_LABEL = { none: 'jeszcze nic', low: 'początek', mid: 'w połowie', good: 'dobrze', full: 'domknięte' } as const;

type BreathChoice = { patternId: string; minutes: number };

export function ForMeBoard({ breath }: { breath: BreathChoice }) {
  const { studio, open, go, openBreath } = useClient();
  const { data: home, reload: reloadHome } = useApi<Home>('/home');
  const { data: ritual, reload: reloadRitual } = useApi<BreathRitual>('/my/breath-ritual');
  // Dziennik wymaga osobnej zgody – bez niej (403) pierścień samopoczucia zaprasza do pierwszego wpisu.
  const { data: journal, reload: reloadJournal } = useApi<{ entries: Entry[] }>('/me/journal');
  const { data: cycle } = useApi<Cycle>(hasFeature(studio, 'cycle') ? '/me/cycle' : null);
  // Zakładka zostaje pod podstronami – po oddechu, zapisie na zajęcia, celu czy wpisie w dzienniku odświeżamy panel.
  useEffect(() => {
    const reload = () => (reloadHome(), reloadRitual(), reloadJournal());
    window.addEventListener('glam:passes-changed', reload);
    return () => window.removeEventListener('glam:passes-changed', reload);
  }, [reloadHome, reloadRitual, reloadJournal]);

  // Mini-pierścienie przyklejone u góry, gdy duże zjadą z ekranu.
  const ringsRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ringsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setCompact(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const today = isoDay(new Date());
  const entries = journal?.entries ?? [];
  const todayEntry = entries.find((e) => e.date === today);
  const week = home?.week;
  const ratio = (done = 0, goal = 0) => (goal > 0 ? Math.min(1, done / goal) : done > 0 ? 1 : 0);

  const rings = [
    { id: 'move', label: `Ruch${goalExtra(week?.done.trainings ?? 0, week?.goal.trainings ?? 0)}`, value: ratio(week?.done.trainings, week?.goal.trainings), text: week ? goalCount(week.done.trainings, week.goal.trainings) : '–', onClick: () => open('goal') },
    { id: 'breath', label: `Oddech${goalExtra(week?.done.mindful ?? 0, week?.goal.mindful ?? 0)}`, value: ratio(week?.done.mindful, week?.goal.mindful), text: week ? goalCount(week.done.mindful, week.goal.mindful) : '–', onClick: () => open('goal') },
    {
      id: 'mood',
      label: 'Samopoczucie',
      value: todayEntry ? wellbeingScore(todayEntry) / 100 : 0,
      text: todayEntry ? `${wellbeingScore(todayEntry)}%` : 'Zapisz',
      onClick: () => open('journal'),
    },
  ].map((r) => ({ ...r, tone: ringTone(r.value) }));

  const todayClasses = (home?.upcoming ?? []).filter((u) => isoDay(new Date(u.starts_at)) === today);
  const evening = new Date().getHours() >= 18;
  const calm = sessionById(evening ? 'sleep-5' : 'stress-3');
  // „Skup się” to zawsze rytm pudełkowy – w odtwarzaczu prowadzi go kwadrat oddechu.
  const focus = sessionById(new Date().getHours() < 11 ? 'focus-3' : 'pre-5');

  return (
    <div className="board stack-lg">
      <div className={`board-mini${compact ? ' is-on' : ''}`} aria-hidden={!compact}>
        {rings.map((r) => (
          <button key={r.id} tabIndex={compact ? 0 : -1} onClick={r.onClick}>
            <Ring value={r.value} tone={r.tone} size={22} stroke={3} />
            {r.label}
          </button>
        ))}
        {/* Szybki start oddechu zostaje pod kciukiem także po przewinięciu – w przyklejonym pasku. */}
        {!ritual?.today && (
          <button className="board-mini-play" tabIndex={compact ? 0 : -1} onClick={() => openBreath(breath)} aria-label={`Zacznij oddech, ${breath.minutes} min`}>
            <Icon name="play" size={12} />
          </button>
        )}
      </div>

      {/* Trzy pierścienie: ruch i oddech wobec celu tygodnia, samopoczucie z dzisiejszego wpisu. */}
      <div ref={ringsRef} className="board-rings" role="group" aria-label="Twój tydzień">
        {rings.map((r) => (
          <button key={r.id} className="board-ring" onClick={r.onClick} aria-label={`${r.label}: ${r.text}, ${TONE_LABEL[r.tone]}`}>
            <Ring value={r.value} tone={r.tone} size={84} stroke={4}>
              <span className={r.text === 'Zapisz' ? 'board-ring-cta' : 'board-ring-num'}>{r.text}</span>
            </Ring>
            <span className="board-ring-label">{r.label}</span>
          </button>
        ))}
      </div>

      {/* Mój dzień tuż pod pierścieniami: dzisiejszy oddech jako pierwsza pozycja planu dnia (zamiast przycisku
          w nagłówku), potem zajęcia. Po oddechu wiersz zamienia się w ✓ – plan dnia sam się odhacza. */}
      <section className="forme-list">
        <h2 className="forme-h">Mój dzień</h2>
        <div className="card board-day">
          {ritual?.today ? (
            <div className="board-act is-soft is-done">
              <span className="board-act-time">
                <Icon name="check" size={14} />
              </span>
              <span className="grow">
                <span className="session-title">Oddech</span>
                <span className="session-meta"> · dziś już był</span>
              </span>
            </div>
          ) : (
            <button className="board-act is-breath" onClick={() => openBreath(breath)} aria-label={`Zacznij oddech, ${breath.minutes} min`}>
              <span className="board-act-time board-act-play">
                <Icon name="play" size={14} />
              </span>
              <span className="grow">
                <span className="session-title">{evening ? 'Oddech na wieczór' : new Date().getHours() < 12 ? 'Poranny oddech' : 'Chwila oddechu'}</span>
                <span className="session-meta">
                  {breath.minutes} min · {patternById(breath.patternId).label.toLowerCase()}
                </span>
              </span>
              <span className="board-act-go">Zacznij</span>
            </button>
          )}
          {todayClasses.map((c) => (
            <button key={c.booking_id} className="board-act" onClick={() => go('start')}>
              <span className="board-act-time">{fmtTime(c.starts_at)}</span>
              <span className="grow">
                <span className="session-title">{c.class_name}</span>
                <span className="session-meta"> · prowadzi {c.trainer_name}</span>
              </span>
            </button>
          ))}
          {!todayClasses.length && (
            <p className="small muted board-empty">
              Bez zajęć na dziś – to też jest plan.{' '}
              <button className="link" onClick={() => go('schedule')}>
                Zobacz grafik
              </button>
            </p>
          )}
        </div>
      </section>

      {/* Podpowiedź na dziś tylko z własną treścią: faza cyklu albo dzień odpoczynku. Słowo o celu tygodnia jest już na Starcie. */}
      {(cycle?.today || week?.restDay) && (
        <article className="card board-insight">
          <div className="eyebrow">{cycle?.today ? `${cycle.today.label} · dzień ${cycle.today.day}` : 'Dzień odpoczynku'}</div>
          <p className="serif board-insight-text">{cycle?.today?.hint ?? week?.message}</p>
        </article>
      )}

      <div className="board-tiles">
        <button className="card board-tile" onClick={() => open('calm7')}>
          <span className="eyebrow">Seria oddechu</span>
          <span className="board-tile-row">
            <span className="board-badge">{ritual?.streak ?? 0}</span>
            <span className="small">{ritual?.today ? 'Dziś już oddychałaś' : (ritual?.streak ?? 0) > 0 ? 'Podtrzymaj ją dziś' : 'Zacznij dziś'}</span>
          </span>
        </button>
        <button className="card board-tile" onClick={() => open('journal')}>
          <span className="eyebrow">Dziennik</span>
          <span className="board-tile-row">
            <span className="board-badge">{entries.length}/7</span>
            <span className="small">{todayEntry ? `Dziś: ${MOOD_LABELS[todayEntry.mood]}` : 'Jak się dziś czujesz?'}</span>
          </span>
        </button>
      </div>

      {/* Dwie sesje na teraz – odpowiednik „zwiększ relaks / zwiększ czujność”. */}
      <section className="forme-list">
        <h2 className="forme-h">Sesje na teraz</h2>
        <div className="board-sessions">
          {[
            { s: calm, tone: 'calm', kicker: 'Wycisz się' },
            { s: focus, tone: 'focus', kicker: 'Skup się' },
          ].map(({ s, tone, kicker }) =>
            s ? (
              <button key={s.id} className={`board-session is-${tone}`} onClick={() => openBreath({ sessionId: s.id })}>
                {/* Znak tego, co prowadzi sesję: piwonia przy wyciszeniu, kwadrat z kropką przy skupieniu. */}
                <span className="board-session-mark" aria-hidden>
                  {tone === 'calm' ? (
                    <MiniBloom />
                  ) : (
                    <svg viewBox="0 0 24 24">
                      <rect x="4" y="4" width="16" height="16" rx="1" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                      <path d="M4 20 V4 H14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      <circle cx="14" cy="4" r="2" fill="currentColor" />
                    </svg>
                  )}
                </span>
                <span className="board-session-kicker">{kicker}</span>
                <span className="board-session-title">{s.title}</span>
                <span className="board-session-min">{s.minutes} min</span>
              </button>
            ) : null,
          )}
        </div>
      </section>

      <WeekChart entries={entries} breath={ritual?.week ?? []} onOpen={() => open('journal')} />
    </div>
  );
}

/** Pierścień postępu – miękka linia, zaokrąglone końce, start na godzinie 12. */
function Ring({ value, tone, size, stroke, children }: { value: number; tone: ReturnType<typeof ringTone>; size: number; stroke: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className={`bring is-${tone}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="bring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="bring-arc"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <span className="bring-inner">{children}</span>}
    </span>
  );
}

/** Tydzień: nastrój i energia z dziennika (linie) oraz dni z oddechem (kropki pod osią). */
function WeekChart({ entries, breath, onOpen }: { entries: Entry[]; breath: boolean[]; onOpen: () => void }) {
  const W = 320;
  const H = 120;
  const pad = 14;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / 6;
  const y = (v: number) => H - pad - ((v - 1) / 4) * (H - 2 * pad);
  const todayIdx = (new Date().getDay() + 6) % 7;
  const byDay = Array.from({ length: 7 }, (_, i) => entries.find((e) => (new Date(`${e.date}T12:00:00`).getDay() + 6) % 7 === i));
  const line = (k: 'mood' | 'energy') =>
    byDay
      .map((e, i) => (e ? `${x(i)},${y(e[k])}` : null))
      .filter(Boolean)
      .join(' ');
  return (
    <section className="forme-list">
      <div className="row between">
        <h2 className="forme-h">Twój tydzień</h2>
        <span className="board-legend tiny muted">
          <i style={{ background: 'var(--ink)' }} /> nastrój <i style={{ background: 'var(--brand)' }} /> energia
        </span>
      </div>
      <button className="card board-chart" onClick={onOpen} aria-label="Twój tydzień w dzienniku">
        {entries.length ? (
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" aria-hidden="true">
            {[1, 3, 5].map((v) => (
              <line key={v} x1={pad} x2={W - pad} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 3 ? '0' : '2 4'} />
            ))}
            <rect x={x(todayIdx) - 14} y={4} width={28} height={H - 8} rx={14} fill="var(--soft)" opacity={0.7} />
            {(['energy', 'mood'] as const).map((k) => (
              <g key={k} stroke={k === 'mood' ? 'var(--ink)' : 'var(--brand)'}>
                <polyline points={line(k)} fill="none" strokeWidth={1.5} strokeLinejoin="round" />
                {byDay.map((e, i) => e && <circle key={i} cx={x(i)} cy={y(e[k])} r={3.5} fill="var(--surface)" strokeWidth={1.5} />)}
              </g>
            ))}
          </svg>
        ) : (
          <p className="serif board-chart-empty">Zapisz, jak się czujesz – tu zobaczysz rytm swojego tygodnia.</p>
        )}
        <span className="board-days">
          {DAYS.map((d, i) => (
            <span key={d} className={i === todayIdx ? 'is-today' : ''}>
              <b className={byDay[i] ? 'is-on' : ''} aria-hidden="true" />
              {d}
              {breath[i] && <i className="board-breath" title="Oddech" />}
            </span>
          ))}
        </span>
      </button>
    </section>
  );
}
