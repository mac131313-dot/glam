// „Dla mnie” (4.4, decyzja 9): oddech i medytacje prowadzone przez aplikację.
// Ta zakładka uruchamia sesje; ustawienia haptyki i szumu są wspólne dla wszystkich sesji.
import { useState } from 'react';
import { PATTERNS, SESSIONS, patternById, windAt } from '@glam/core';
import { Icon } from '../icons.tsx';
import { MeadowScene } from './MeadowScene.tsx';
import { ListRow, Toggle } from '../ui.tsx';
import { api } from '../api.ts';
import { hasFeature, useClient } from './ClientApp.tsx';
import { hapticsSupported, loadSenses, saveSenses, type SenseSettings } from './senses.ts';

const DURATIONS = [2, 3, 5, 10];

export function ForMe() {
  const { openBreath, open, studio, me, reloadMe } = useClient();
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
      <div>
        <h1>
          Dla <span className="serif">mnie</span>
        </h1>
        <p className="muted" style={{ margin: 0 }}>
          Chwila tylko dla Ciebie. Bez celu, bez oceniania.
        </p>
      </div>

      <section className="card stack" style={{ gap: 18 }}>
        <div className="row" style={{ gap: 18 }}>
          <MeadowScene className="meadow-mini" detail="mini" wind={() => windAt(pattern, performance.now())} />
          <div>
            <div className="eyebrow" style={{ marginBottom: 2 }}>
              Oddychaj z łąką
            </div>
            <div className="serif" style={{ fontSize: '1.6rem', lineHeight: 1.15 }}>
              {pattern.label}
            </div>
            <div className="small muted">{pattern.hint}</div>
          </div>
        </div>
        <div className="chips" role="group" aria-label="Rytm oddechu">
          {PATTERNS.map((p) => (
            <button key={p.id} className="chip" aria-pressed={patternId === p.id} onClick={() => setPatternId(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="row between wrap">
          <div className="segmented" role="group" aria-label="Długość sesji">
            {DURATIONS.map((m) => (
              <button key={m} aria-pressed={minutes === m} onClick={() => setMinutes(m)}>
                {m} min
              </button>
            ))}
          </div>
          <button className="btn" onClick={() => openBreath({ patternId, minutes })}>
            <Icon name="play" size={18} /> Zacznij
          </button>
        </div>
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
        <Toggle label="Spokojny szum" hint="Miękki biały szum, który oddycha razem z kołem" checked={senses.noise} onChange={(v) => setSenses({ ...senses, noise: v })} />
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
