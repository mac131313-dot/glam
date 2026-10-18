// „Dla mnie” (4.4, decyzja 9): oddech i medytacje prowadzone przez aplikację.
// Ta zakładka uruchamia sesje; ustawienia haptyki i szumu są wspólne dla wszystkich sesji.
import { useEffect, useState } from 'react';
import { SESSIONS, patternById, type BreathRitual } from '@glam/core';
import { Icon } from '../icons.tsx';
import { Toggle, useAction, useScrollRow } from '../ui.tsx';
import { api, useApi } from '../api.ts';
import { BreathCalendar } from './BreathCalendar.tsx';
import { FeelingsCard } from './Feelings.tsx';
import { ForMeBoard } from './ForMeBoard.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
import { loadBreathChoice } from './senses.ts';

export function ForMe() {
  const { openBreath, open, studio, me, reloadMe } = useClient();
  const { data: ritual, reload: reloadRitual } = useApi<BreathRitual>('/my/breath-ritual');
  const { run } = useAction();
  const [{ patternId, minutes }, setChoice] = useState(loadBreathChoice);
  // Po ukończonej sesji odświeżamy kalendarz kwiatków i ostatnio wybrany rytm.
  useEffect(() => {
    const refresh = () => (reloadRitual(), setChoice(loadBreathChoice()));
    window.addEventListener('glam:passes-changed', refresh);
    return () => window.removeEventListener('glam:passes-changed', refresh);
  }, [reloadRitual]);
  const [calendar, setCalendar] = useState(false);
  const [feelings, setFeelings] = useState(false);
  // Na start same kategorie – lista medytacji pojawia się dopiero po wyborze (drugie dotknięcie ją zwija).
  const [category, setCategory] = useState<string | null>(null);
  const catRow = useScrollRow<HTMLDivElement>();
  const sessions = category ? SESSIONS.filter((x) => x.category === category) : [];
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

      {/* Panel tygodnia: pierścienie, mój dzień i sesje. */}
      <ForMeBoard breath={{ patternId, minutes }} />

      {/* Medytacje: tytuł, rytm i czas – bez powtarzania kategorii i bez przycisków; cały wiersz startuje sesję. */}
      <section className="forme-list">
        <h2 className="forme-h">Medytacje</h2>
        <div ref={catRow} className="chips scroll-row" role="group" aria-label="Kategoria medytacji">
          {[...new Set(SESSIONS.map((x) => x.category))].map((c) => (
            <button key={c} className="chip" aria-pressed={category === c} aria-expanded={category === c} onClick={() => setCategory(category === c ? null : c)}>
              {c}
            </button>
          ))}
        </div>
        <ul className={`session-list${category ? ' is-open' : ''}`} key={category ?? 'none'}>
          {sessions.map((s) => (
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
      </section>

      <Toggle
        label="Dziś odpoczywam"
        hint="Bez celu tygodnia i przypomnień"
        checked={me.user.restToday}
        onChange={(v) =>
          run(async () => {
            await api('/me', { method: 'PATCH', global: true, body: { restToday: v } });
            await reloadMe();
            // Panel tygodnia (podpowiedź „Dzień odpoczynku”) czyta /home – odświeżamy go od razu.
            window.dispatchEvent(new Event('glam:passes-changed'));
          })
        }
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
      {/* Powrót do ankiety po treningu – ta sama karta, która wyskakuje po zajęciach. */}
      <button className="feel-open" onClick={() => setFeelings(true)}>
        Twoje odczucia
      </button>
      {feelings && <FeelingsCard onClose={() => setFeelings(false)} />}
      {calendar && ritual && <BreathCalendar ritual={ritual} onClose={() => setCalendar(false)} />}
    </div>
  );
}

