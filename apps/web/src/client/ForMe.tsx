// „Dla mnie” (4.4, decyzja 9): oddech i medytacje prowadzone przez aplikację.
// Ta zakładka uruchamia sesje; ustawienia haptyki i szumu są wspólne dla wszystkich sesji.
import { useEffect, useState } from 'react';
import { BREATH_LENGTHS, PATTERNS, SESSIONS, patternById, type BreathRitual } from '@glam/core';
import { Icon } from '../icons.tsx';
import { ListRow, Toggle } from '../ui.tsx';
import { api, useApi } from '../api.ts';
import { BreathBloom } from './BreathBloom.tsx';
import { RitualWeek, streakLine } from './BreathPlayer.tsx';
import { hasFeature, useClient } from './ClientApp.tsx';
import { hapticsSupported, loadSenses, saveSenses, type SenseSettings } from './senses.ts';

export function ForMe() {
  const { openBreath, breathOpen, open, studio, me, reloadMe } = useClient();
  const { data: ritual, reload: reloadRitual } = useApi<BreathRitual>('/my/breath-ritual');
  // Po ukończonej sesji odświeżamy tydzień kwiatków.
  useEffect(() => {
    window.addEventListener('glam:passes-changed', reloadRitual);
    return () => window.removeEventListener('glam:passes-changed', reloadRitual);
  }, [reloadRitual]);
  const [patternId, setPatternId] = useState('calm');
  const [minutes, setMinutes] = useState(3);
  const [senses, setSensesState] = useState<SenseSettings>(loadSenses);
  const setSenses = (s: SenseSettings) => {
    setSensesState(s);
    saveSenses(s);
  };
  const pattern = patternById(patternId);
  const [category, setCategory] = useState('Wszystkie');
  // Medytacja tematyczna z pakietu motywu (7.2) widoczna, gdy motyw jest aktywny.
  const themeEdition = (studio.theme?.pack as { edition?: string } | undefined)?.edition;

  return (
    <div className="stack-lg">
      {/* Główny motyw zakładki: piwonia na cały ekran – tylko data, jedno zdanie i kwiat.
          Pod sesją oddechu scena stoi, żeby nie zabierać płynności. */}
      <section className="forme-hero" aria-label="Oddychaj z piwonią">
        <BreathBloom variant="full" className={breathOpen ? 'is-paused' : ''} />
        <header className="forme-hello">
          <div className="eyebrow">Dla mnie · {new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
          <p className="forme-quote serif">Zacznij dzień od spokojnego oddechu</p>
        </header>
        <button className="forme-more" onClick={() => document.getElementById('forme-choose')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          Twój rytuał <Icon name="down" size={16} />
        </button>
      </section>

      {/* Rytuał w jednej karcie: tydzień kwiatków tuż nad wyborem rytmu i czasu, jeden przycisk startu. */}
      <section id="forme-choose" className="card ritual-card stack" style={{ gap: 16, scrollMarginTop: 16 }}>
        <div className="stack center" style={{ gap: 8, alignItems: 'center' }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>
            {ritual?.today ? 'Dzisiejszy kwiatek już zakwitł' : 'Twój codzienny rytuał'}
          </div>
          {ritual && <RitualWeek ritual={ritual} />}
          <p className="tiny muted" style={{ margin: 0 }}>
            {ritual && ritual.streak > 0 ? streakLine(ritual.streak) : 'Jedna chwila oddechu dziennie. Twój kwiat rośnie z każdym dniem.'}
          </p>
        </div>
        <hr className="hairline" />
        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>Jak chcesz dziś oddychać?</div>
          <div className="chips" role="group" aria-label="Rytm oddechu">
            {PATTERNS.map((p) => (
              <button key={p.id} className="chip" aria-pressed={patternId === p.id} onClick={() => setPatternId(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <div className="small muted">{pattern.hint}</div>
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ marginBottom: 0 }}>Ile czasu dajesz sobie?</div>
          <div className="mood-pick" role="group" aria-label="Długość sesji">
            {BREATH_LENGTHS.map((l) => (
              <button key={l.minutes} aria-pressed={minutes === l.minutes} onClick={() => setMinutes(l.minutes)}>
                <span className="serif">{l.label}</span>
                <span className="tiny">{l.minutes} min</span>
              </button>
            ))}
          </div>
        </div>
        <button className="start-min" onClick={() => openBreath({ patternId, minutes })}>
          <span className="start-min-icon">
            <Icon name="play" size={16} />
          </span>
          Zacznij
        </button>
      </section>

      <section className="stack" style={{ gap: 0 }}>
        <div className="eyebrow">Medytacje prowadzone przez aplikację</div>
        <div className="chips" role="group" aria-label="Kategoria medytacji" style={{ marginBottom: 6 }}>
          {['Wszystkie', ...new Set(SESSIONS.map((x) => x.category))].map((c) => (
            <button key={c} className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        {SESSIONS.filter((x) => category === 'Wszystkie' || x.category === category).filter((x) => !x.edition || x.edition === themeEdition).map((s) => (
          <button
            key={s.id}
            className="row"
            onClick={() => openBreath({ sessionId: s.id })}
            style={{ background: 'none', border: 0, borderBottom: '1px solid var(--line)', padding: '16px 0', cursor: 'pointer', textAlign: 'left', width: '100%' }}
          >
            <div className="grow">
              <div className="card-title">{s.title}</div>
              <div className="small muted">
                {s.category} · {s.minutes} min · {patternById(s.pattern).label.toLowerCase()}
              </div>
            </div>
            <span className="icon-btn" style={{ width: 40, height: 40 }} aria-hidden>
              <Icon name="play" size={16} />
            </span>
          </button>
        ))}
      </section>

      <section className="stack" style={{ gap: 0 }}>
        <div className="eyebrow">Podczas sesji</div>
        <Toggle
          label="Haptyka"
          hint={hapticsSupported() ? 'Delikatna wibracja na początku wdechu i wydechu' : 'Ta przeglądarka nie obsługuje wibracji – zadziała w aplikacji mobilnej'}
          checked={senses.haptics}
          onChange={(v) => setSenses({ ...senses, haptics: v })}
        />
        <Toggle label="Spokojny szum" hint="Miękki biały szum, który oddycha razem z kwiatem" checked={senses.noise} onChange={(v) => setSenses({ ...senses, noise: v })} />
      </section>

      <section className="stack" style={{ gap: 0 }}>
        <div className="eyebrow">Więcej dla Ciebie</div>
        <ListRow title="7 dni spokoju" hint="Mini-kurs: jedna sesja dziennie" onClick={() => open('calm7')} />
        <ListRow title="Rozciąganie" hint="Biuro 5 min, wieczór 10 min, po treningu" onClick={() => open('stretch')} />
        <ListRow title="Dziennik nastroju i energii" hint="Nastrój, energia, sen, jedno zdanie wdzięczności" onClick={() => open('journal')} />
        <ListRow title="Cel tygodnia" hint="Treningi i chwile dla siebie – w Twoim tempie" onClick={() => open('goal')} />
        <ListRow title="Mój styl dnia" hint="Quiz: pora, energia, czas, cel" onClick={() => open('quiz')} />
        {hasFeature(studio, 'cycle') && <ListRow title="Cykl" hint="Sugestie intensywności – osobna zgoda" onClick={() => open('cycle')} />}
        {hasFeature(studio, 'health') && <ListRow title="Zdrowie i postępy" hint="Ankieta, pomiary, zdjęcia – tylko na życzenie" onClick={() => open('health')} />}
        {hasFeature(studio, 'courses') && <ListRow title="Kursy online" hint="Programy od instruktorek" onClick={() => open('courses')} />}
        {hasFeature(studio, 'music') && <ListRow title="Muzyka do medytacji i snu" hint="Playlisty studia" onClick={() => open('music')} />}
        {hasFeature(studio, 'challenges') && <ListRow title="Wyzwania" hint="Np. Październik oddechowy" onClick={() => open('challenges')} />}
      </section>

      <Toggle
        label="Dziś odpoczywam"
        hint="Znika presja celu tygodnia i przypomnień – zostaje oddech i medytacja"
        checked={me.user.restToday}
        onChange={async (v) => {
          await api('/me', { method: 'PATCH', global: true, body: { restToday: v } });
          await reloadMe();
        }}
      />

      <p className="tiny muted center">Treści ogólne – nie zastępują konsultacji lekarskiej.</p>
    </div>
  );
}
