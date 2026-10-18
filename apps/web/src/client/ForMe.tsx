// „Dla mnie” (4.4, decyzja 9): oddech i medytacje prowadzone przez aplikację.
// Ta zakładka uruchamia sesje; ustawienia haptyki i szumu są wspólne dla wszystkich sesji.
import { useEffect, useState } from 'react';
import { BREATH_LENGTHS, PATTERNS, SESSIONS, patternById, type BreathRitual } from '@glam/core';
import { Icon } from '../icons.tsx';
import { Toggle, useScrollRow } from '../ui.tsx';
import { api, useApi } from '../api.ts';
import { BreathCalendar } from './BreathCalendar.tsx';
import { ForMeBoard } from './ForMeBoard.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';

export function ForMe() {
  const { openBreath, open, studio, me, reloadMe } = useClient();
  const { data: ritual, reload: reloadRitual } = useApi<BreathRitual>('/my/breath-ritual');
  // Po ukończonej sesji odświeżamy kalendarz kwiatków.
  useEffect(() => {
    window.addEventListener('glam:passes-changed', reloadRitual);
    return () => window.removeEventListener('glam:passes-changed', reloadRitual);
  }, [reloadRitual]);
  const [{ patternId, minutes }] = useState(loadChoice);
  const [calendar, setCalendar] = useState(false);
  const [category, setCategory] = useState('Wszystkie');
  const [showAll, setShowAll] = useState(false);
  const catRow = useScrollRow<HTMLDivElement>();
  const sessions = SESSIONS.filter((x) => category === 'Wszystkie' || x.category === category);
  // Przy „Wszystkie” na start tylko kilka – reszta pod „Pokaż wszystkie”, żeby lista nie przytłaczała.
  const visibleSessions = showAll || category !== 'Wszystkie' ? sessions : sessions.slice(0, 3);
  const more: [string, string][] = [
    ['7 dni spokoju', 'calm7'],
    ['Rozciąganie', 'stretch'],
    ['Dziennik nastroju', 'journal'],
    ['Cel tygodnia', 'goal'],
    ['Mój styl dnia', 'quiz'],
    ...(hasFeature(studio, 'health') ? ([['Zdrowie i postępy', 'health']] as [string, string][]) : []),
    ...(hasFeature(studio, 'cycle') ? ([['Cykl', 'cycle']] as [string, string][]) : []),
    ...(hasFeature(studio, 'courses') ? ([['Kursy online', 'courses']] as [string, string][]) : []),
    ...(hasFeature(studio, 'music') ? ([['Muzyka do medytacji i snu', 'music']] as [string, string][]) : []),
    ...(hasFeature(studio, 'challenges') ? ([['Wyzwania', 'challenges']] as [string, string][]) : []),
  ];

  return (
    <div className="stack-lg">
      {/* Nagłówek zakładki: data i jedno zdanie. Start oddechu mieszka w „Mój dzień” (i w przyklejonym pasku). Piwonia pojawia się dopiero w samej sesji
          (oddech i medytacje), żeby ekran główny został lekki. */}
      <section className="forme-hero forme-head" aria-label="Oddech na dziś">
        {/* Kalendarz kwiatków: wszystkie dni z oddechem, miesiąc po miesiącu. */}
        <button className="forme-cal" aria-label="Kalendarz oddechu" disabled={!ritual} onClick={() => setCalendar(true)}>
          <Icon name="calendar" size={20} />
        </button>
        <header className="forme-hello">
          <div className="eyebrow">Dla mnie · {new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <p className="forme-quote serif">Zacznij dzień od spokojnego oddechu</p>
        </header>
      </section>

      {/* Panel tygodnia: pierścienie, podpowiedź na dziś, mój dzień, sesje i wykres. */}
      <ForMeBoard breath={{ patternId, minutes }} />

      {/* Medytacje: tytuł, rytm i czas – bez powtarzania kategorii i bez przycisków; cały wiersz startuje sesję. */}
      <section className="forme-list">
        <h2 className="forme-h">Medytacje</h2>
        <div ref={catRow} className="chips scroll-row" role="group" aria-label="Kategoria medytacji">
          {['Wszystkie', ...new Set(SESSIONS.map((x) => x.category))].map((c) => (
            <button
              key={c}
              className="chip"
              aria-pressed={category === c}
              onClick={() => {
                setCategory(c);
                setShowAll(false);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        <ul className="session-list">
          {visibleSessions.map((s) => (
            <li key={s.id}>
              <button className="session-row" onClick={() => openBreath({ sessionId: s.id })} aria-label={`${s.title}, ${s.minutes} min – zacznij`}>
                <span className="session-text">
                  <span className="session-title">{s.title}</span>
                  <span className="session-meta">{patternById(s.pattern).label.toLowerCase()}</span>
                </span>
                <span className="session-min">{s.minutes} min</span>
              </button>
            </li>
          ))}
        </ul>
        {sessions.length > visibleSessions.length && (
          <button className="ritual-toggle" onClick={() => setShowAll(true)}>
            Pokaż wszystkie ({sessions.length})
          </button>
        )}
      </section>

      <Toggle
        label="Dziś odpoczywam"
        hint="Bez celu tygodnia i przypomnień"
        checked={me.user.restToday}
        onChange={async (v) => {
          await api('/me', { method: 'PATCH', global: true, body: { restToday: v } });
          await reloadMe();
        }}
      />

      <section className="forme-list">
        <h2 className="forme-h">Więcej dla Ciebie</h2>
        {/* Zawijane pigułki zamiast długiej listy – wszystko na jednym ekranie. */}
        <nav className="more-pills" aria-label="Więcej dla Ciebie">
          {more.map(([title, route]) => (
            <button key={route} onClick={() => open(route)}>
              {title}
            </button>
          ))}
        </nav>
      </section>

      <p className="tiny muted center">Treści ogólne – nie zastępują konsultacji lekarskiej.</p>
      {calendar && ritual && <BreathCalendar ritual={ritual} onClose={() => setCalendar(false)} />}
    </div>
  );
}

type RitualChoice = { patternId: string; minutes: number };
const CHOICE_KEY = 'glam.breath.choice';

/** Ostatnio wybrany rytm i czas – żeby przy powrocie wystarczyło „Zacznij”. Tylko wygoda na tym urządzeniu. */
function loadChoice(): RitualChoice {
  const fallback = { patternId: 'calm', minutes: 3 };
  try {
    const v = JSON.parse(localStorage.getItem(CHOICE_KEY) ?? 'null') as Partial<RitualChoice> | null;
    const patternOk = PATTERNS.some((p) => p.id === v?.patternId);
    const minutesOk = BREATH_LENGTHS.some((l) => l.minutes === v?.minutes);
    return { patternId: patternOk ? v!.patternId! : fallback.patternId, minutes: minutesOk ? v!.minutes! : fallback.minutes };
  } catch {
    return fallback;
  }
}

