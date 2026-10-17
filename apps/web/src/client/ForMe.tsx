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
import { hapticsSupported, loadSenses, saveSenses, type SenseSettings } from './senses.ts';

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
  const [senses, setSensesState] = useState<SenseSettings>(loadSenses);
  const setSenses = (s: SenseSettings) => {
    setSensesState(s);
    saveSenses(s);
  };
  const [category, setCategory] = useState('Wszystkie');
  // Medytacja tematyczna z pakietu motywu (7.2) widoczna, gdy motyw jest aktywny.
  const themeEdition = (studio.theme?.pack as { edition?: string } | undefined)?.edition;
  const [showAll, setShowAll] = useState(false);
  const catRow = useScrollRow<HTMLDivElement>();
  const sessions = SESSIONS.filter((x) => category === 'Wszystkie' || x.category === category).filter((x) => !x.edition || x.edition === themeEdition);
  // Przy „Wszystkie” na start tylko kilka – reszta pod „Pokaż wszystkie”, żeby lista nie przytłaczała.
  const visibleSessions = showAll || category !== 'Wszystkie' ? sessions : sessions.slice(0, 5);
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
      {/* Nagłówek zakładki: data, jedno zdanie i start oddechu. Piwonia pojawia się dopiero w samej sesji
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
        {/* Jedno dotknięcie pod kwiatem: oddech w ostatnio wybranym rytmie i czasie. */}
        <button className="start-min forme-start" onClick={() => openBreath({ patternId, minutes })} aria-label={`Zacznij oddech, ${minutes} min`}>
          <span className="start-min-icon">
            <Icon name="play" size={16} />
          </span>
          Zacznij · {minutes} min
        </button>
      </section>

      {/* Panel tygodnia: pierścienie, podpowiedź na dziś, mój dzień, sesje i wykres. */}
      <ForMeBoard />

      {/* Ustawienia sesji jako dwie pigułki – bez długich opisów. */}
      <section className="forme-list">
        <h2 className="forme-h">Podczas sesji</h2>
        <div className="chips" role="group" aria-label="Podczas sesji">
          <button
            className="chip"
            aria-pressed={senses.haptics}
            title={hapticsSupported() ? 'Delikatna wibracja przy wdechu i wydechu' : 'Wibracja zadziała w aplikacji mobilnej'}
            onClick={() => setSenses({ ...senses, haptics: !senses.haptics })}
          >
            Haptyka
          </button>
          <button className="chip" aria-pressed={senses.noise} title="Miękki szum, który oddycha razem z kwiatem" onClick={() => setSenses({ ...senses, noise: !senses.noise })}>
            Szum
          </button>
        </div>
      </section>

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

