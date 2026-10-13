// „Dla mnie” (4.4, 4.6, 4.12.2): dziennik nastroju, moduł cyklu, „7 dni spokoju”, rutyny stretch z przewodnikiem,
// quiz „Mój styl dnia”, cel tygodnia, profil zdrowia i postępów (za zgodą), plan od trenerki.
import { useEffect, useRef, useState } from 'react';
import { ENERGY_LABELS, MOOD_LABELS, QUIZ, routineSeconds, sessionById, SLEEP_LABELS, STRETCH, stretchById, stretchStepAt, type QuizAnswers } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { AuthImg, Empty, Field, ListRow, Progress, readFile, Spinner, Toggle, useAction } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

export default function WellbeingPages({ route, arg, close }: RouteProps) {
  if (route === 'journal') return <Journal />;
  if (route === 'cycle') return <Cycle />;
  if (route === 'calm7') return <Calm7 />;
  if (route === 'stretch') return arg ? <StretchPlayer id={arg} onDone={close} /> : <StretchList />;
  if (route === 'quiz') return <Quiz onDone={close} />;
  if (route === 'goal') return <WeekGoal onDone={close} />;
  if (route === 'plan') return <Plan />;
  return <Health />;
}

const today = () => new Date().toISOString().slice(0, 10);

function ConsentGate({ kind, text, onGranted }: { kind: 'health' | 'cycle' | 'photos'; text: string; onGranted: () => void }) {
  const { run, busy } = useAction();
  return (
    <section className="card soft stack">
      <p style={{ margin: 0 }}>{text}</p>
      <p className="tiny muted" style={{ margin: 0 }}>Dane są zaszyfrowane, widzisz je tylko Ty (chyba że sama coś udostępnisz trenerce). Zgodę wycofasz w każdej chwili – dane zostaną wtedy usunięte.</p>
      <button className="btn" disabled={busy} onClick={() => run(() => api('/me/consents', { method: 'PUT', global: true, body: { kind, granted: true } }).then(onGranted), 'Dziękujemy')}>
        Wyrażam zgodę
      </button>
    </section>
  );
}

function Scale({ label, value, onChange, labels }: { label: string; value: number; onChange: (v: number) => void; labels: string[] }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="mood" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} role="radio" aria-checked={value === n} aria-pressed={value === n} onClick={() => onChange(n)}>
            {labels[n]}
          </button>
        ))}
      </div>
    </div>
  );
}

function Journal() {
  const [week, setWeek] = useState<string | null>(null);
  const { data, error, reload } = useApi<{ week: string; entries: { date: string; mood: number; energy: number; sleep: number; gratitude?: string }[]; summary: { count: number; mood: number | null; energy: number | null; sleep: number | null; note: string; gratitude: { date: string; text: string }[] } }>(`/me/journal${week ? `?week=${week}` : ''}`, [week]);
  const todayEntry = data?.entries.find((e) => e.date === today());
  const [mood, setMood] = useState(3);
  const [energy, setEnergy] = useState(3);
  const [sleep, setSleep] = useState(3);
  const [gratitude, setGratitude] = useState('');
  const { run, busy } = useAction();
  useEffect(() => {
    if (todayEntry) {
      setMood(todayEntry.mood);
      setEnergy(todayEntry.energy);
      setSleep(todayEntry.sleep);
      setGratitude(todayEntry.gratitude ?? '');
    }
  }, [todayEntry]);
  if (error?.code === 'consent_required') return <ConsentGate kind="health" text="Dziennik nastroju, energii i snu to dane o samopoczuciu. Potrzebujemy Twojej osobnej zgody." onGranted={reload} />;
  if (!data) return <Spinner />;
  const shift = (d: number) => {
    const base = new Date(`${data.week}T12:00:00Z`);
    base.setUTCDate(base.getUTCDate() + d);
    setWeek(base.toISOString().slice(0, 10));
  };
  return (
    <div className="stack-lg">
      {!week || week >= today().slice(0, 8) ? (
        <section className="card stack">
          <div className="eyebrow">Dziś</div>
          <Scale label="Nastrój" value={mood} onChange={setMood} labels={MOOD_LABELS} />
          <Scale label="Energia" value={energy} onChange={setEnergy} labels={ENERGY_LABELS} />
          <Scale label="Sen" value={sleep} onChange={setSleep} labels={SLEEP_LABELS} />
          <Field label="Jedno zdanie wdzięczności (opcjonalnie)">
            <input className="input" maxLength={280} value={gratitude} onChange={(e) => setGratitude(e.target.value)} placeholder="Za co dziś dziękuję…" />
          </Field>
          <button className="btn" disabled={busy} onClick={() => run(() => api(`/me/journal/${today()}`, { method: 'PUT', global: true, body: { mood, energy, sleep, gratitude } }).then(reload), 'Zapisane w dzienniku')}>
            {todayEntry ? 'Zaktualizuj wpis' : 'Zapisz wpis'}
          </button>
        </section>
      ) : null}
      <section className="stack">
        <div className="row between">
          <button className="btn ghost sm" onClick={() => shift(-7)} aria-label="Poprzedni tydzień">
            ←
          </button>
          <span className="small">Tydzień od {data.week.split('-').reverse().join('.')}</span>
          <button className="btn ghost sm" onClick={() => shift(7)} aria-label="Następny tydzień">
            →
          </button>
        </div>
        <div className="card soft stack" style={{ gap: 8 }}>
          <div className="eyebrow">Podsumowanie tygodnia</div>
          {data.summary.count === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>Brak wpisów w tym tygodniu.</p>
          ) : (
            <>
              <div className="row between small">
                <span>Nastrój</span>
                <b>{data.summary.mood} / 5</b>
              </div>
              <div className="row between small">
                <span>Energia</span>
                <b>{data.summary.energy} / 5</b>
              </div>
              <div className="row between small">
                <span>Sen</span>
                <b>{data.summary.sleep} / 5</b>
              </div>
              <p className="small" style={{ margin: 0 }}>{data.summary.note}</p>
              {data.summary.gratitude.map((g) => (
                <p key={g.date} className="serif" style={{ margin: 0, fontSize: '1.1rem' }}>
                  „{g.text}”
                </p>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Cycle() {
  const { data, reload } = useApi<{ consent: boolean; entries?: { start: string; length: number }[]; today?: { phase: string; day: number; label: string; hint: string; intensity: string } | null }>('/me/cycle');
  const [start, setStart] = useState(today());
  const [length, setLength] = useState(28);
  const { run, busy } = useAction();
  if (!data) return <Spinner />;
  if (!data.consent) return <ConsentGate kind="cycle" text="Moduł cyklu podpowiada intensywność zajęć. To dane szczególne (RODO art. 9), więc potrzebujemy osobnej zgody." onGranted={reload} />;
  return (
    <div className="stack-lg">
      {data.today && (
        <section className="card soft stack" style={{ gap: 6 }}>
          <div className="eyebrow">Dzień {data.today.day} · {data.today.label}</div>
          <div className="card-title">Intensywność: {data.today.intensity}</div>
          <p className="small" style={{ margin: 0 }}>{data.today.hint}</p>
        </section>
      )}
      <section className="stack">
        <div className="eyebrow">Początek ostatniej miesiączki</div>
        <div className="row">
          <input className="input" type="date" value={start} max={today()} onChange={(e) => setStart(e.target.value)} />
          <input className="input" type="number" min={20} max={45} value={length} onChange={(e) => setLength(Number(e.target.value))} aria-label="Długość cyklu" style={{ maxWidth: 110 }} />
        </div>
        <button className="btn" disabled={busy} onClick={() => run(() => api('/me/cycle', { method: 'POST', global: true, body: { start, length } }).then(reload), 'Zapisane')}>
          Zapisz
        </button>
      </section>
      <p className="tiny muted">Sugestie są ogólne i nie zastępują konsultacji lekarskiej. Nie wnioskujemy z nich o Twoim zdrowiu i nikt w studiu ich nie widzi.</p>
    </div>
  );
}

function Calm7() {
  const { openBreath } = useClient();
  const { data, reload } = useApi<{ title: string; days: { day: number; title: string; sessionId: string; note: string; done: boolean; unlocked: boolean }[] }>('/me/calm7');
  const { run } = useAction();
  if (!data) return <Spinner />;
  const done = data.days.filter((d) => d.done).length;
  return (
    <div className="stack-lg">
      <div>
        <Progress value={done} max={7} label="Postęp kursu" />
        <p className="small muted">{done} z 7 dni. Jeden dzień na raz – kolejny odblokuje się jutro.</p>
      </div>
      {data.days.map((d) => {
        const s = sessionById(d.sessionId);
        return (
          <div key={d.day} className={`card ${d.done ? 'soft' : 'flat'} stack`} style={{ gap: 6, opacity: d.unlocked ? 1 : 0.5 }}>
            <div className="row between">
              <b>
                Dzień {d.day} · {d.title}
              </b>
              {d.done && <span className="badge ok">zrobione</span>}
            </div>
            <span className="small muted">
              {d.note} {s ? `· ${s.minutes} min` : ''}
            </span>
            {d.unlocked && !d.done && (
              <button
                className="btn sm"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => {
                  openBreath({ sessionId: d.sessionId });
                  run(() => api(`/me/calm7/${d.day}`, { method: 'POST', global: true }).then(reload));
                }}
              >
                Zacznij
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StretchList() {
  const { open } = useClient();
  return (
    <div>
      {STRETCH.map((r) => (
        <ListRow key={r.id} title={r.title} hint={`${r.minutes} min · ${r.context} · ${r.steps.length} ćwiczeń`} onClick={() => open(`stretch/${r.id}`)} />
      ))}
      <p className="tiny muted" style={{ marginTop: 16 }}>Ćwicz w swoim zakresie ruchu. Treści ogólne – nie porada medyczna.</p>
    </div>
  );
}

/** Animowany przewodnik po rutynie stretch: krok, podpowiedź, licznik, pauza (#24). */
function StretchPlayer({ id, onDone }: { id: string; onDone: () => void }) {
  const routine = stretchById(id);
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [finished, setFinished] = useState(false);
  const logged = useRef(false);
  useEffect(() => {
    if (paused || finished) return;
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [paused, finished]);
  const at = routine ? stretchStepAt(routine, elapsed) : null;
  useEffect(() => {
    if (routine && !at && !logged.current) {
      logged.current = true;
      setFinished(true);
      api('/mindful', { method: 'POST', body: { kind: 'stretch', ref: routine.id, minutes: routineSeconds(routine) / 60 } }).catch(() => {});
      navigator.vibrate?.(200);
    }
  }, [at, routine]);
  if (!routine) return <Empty>Nie ma takiej rutyny.</Empty>;
  if (finished || !at)
    return (
      <div className="stack center" style={{ paddingTop: 40 }}>
        <div className="serif" style={{ fontSize: '2.4rem' }}>Dobra robota</div>
        <p className="muted">{routine.minutes} minut tylko dla Ciebie. Liczy się do celu tygodnia.</p>
        <button className="btn" onClick={onDone}>
          Zamknij
        </button>
      </div>
    );
  const pct = 1 - at.left / at.step.seconds;
  return (
    <div className="stack-lg center" style={{ paddingTop: 20 }}>
      <div className="eyebrow">
        {at.index + 1} / {routine.steps.length}
      </div>
      <div className="breath-ring" style={{ width: 220, margin: '0 auto' }}>
        <div className="breath-disc" style={{ transform: `scale(${0.5 + pct * 0.5})`, transition: 'transform 1s linear' }} />
        <div className="player-phase">
          <div>
            <div className="serif" style={{ fontSize: '3rem', lineHeight: 1 }}>{at.left}</div>
            <div className="tiny muted">sekund</div>
          </div>
        </div>
      </div>
      <div>
        <h2 style={{ marginBottom: 6 }}>{at.step.name}</h2>
        <p className="muted" style={{ maxWidth: '30ch', margin: '0 auto' }}>{at.step.cue}</p>
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn ghost" onClick={() => setPaused(!paused)}>
          {paused ? 'Wznów' : 'Pauza'}
        </button>
        <button className="btn ghost" onClick={() => setElapsed(routine.steps.slice(0, at.index + 1).reduce((a, s) => a + s.seconds, 0))}>
          Dalej
        </button>
      </div>
    </div>
  );
}

function Quiz({ onDone }: { onDone: () => void }) {
  const { reloadMe, openBreath, go } = useClient();
  const [answers, setAnswers] = useState<Partial<QuizAnswers>>({});
  const [result, setResult] = useState<{ reminderTime: string | null; classKeywords: string[]; meditation: string; stretch: string; goalLabel: string; sequence: { kind: string; ref: string; label: string }[] } | null>(null);
  const { run, busy } = useAction();
  if (result)
    return (
      <div className="stack-lg">
        <div>
          <div className="eyebrow">Twój styl dnia</div>
          <h2 className="serif" style={{ fontSize: '2rem' }}>{result.goalLabel}</h2>
          <p className="muted">
            {result.reminderTime ? `Przypomnienia około ${result.reminderTime}. ` : 'Bez przypomnień – w swoim tempie. '}
            Polecamy zajęcia: {result.classKeywords.join(', ')}.
          </p>
        </div>
        <div className="stack">
          <div className="eyebrow">Pierwsza sekwencja</div>
          {result.sequence.map((s, i) => (
            <ListRow
              key={s.label}
              title={`${i + 1}. ${s.label}`}
              onClick={() => {
                if (s.kind === 'breath') openBreath({ patternId: s.ref, minutes: 3 });
                else if (s.kind === 'stretch') onDone();
                else go('schedule');
              }}
            />
          ))}
        </div>
        <button className="btn" onClick={onDone}>
          Gotowe
        </button>
      </div>
    );
  const complete = QUIZ.every((q) => answers[q.key as keyof QuizAnswers] !== undefined);
  return (
    <div className="stack-lg">
      <p className="muted small">Pięć pytań, żeby lepiej dopasować przypomnienia i propozycje. Nie pytamy o cykl, wagę ani zdrowie. Odpowiedzi widzisz tylko Ty.</p>
      {QUIZ.map((q) => (
        <div key={q.key} className="field">
          <span className="field-label">{q.q}</span>
          <div className="pill-row">
            {q.options.map(([v, l]) => (
              <button key={String(v)} className="chip" aria-pressed={answers[q.key as keyof QuizAnswers] === v} onClick={() => setAnswers({ ...answers, [q.key]: v })}>
                {l}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="row">
        <button className="btn ghost" onClick={onDone}>
          Pomiń
        </button>
        <button
          className="btn"
          disabled={!complete || busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ result: NonNullable<typeof result> }>('/me/quiz', { method: 'POST', global: true, body: answers });
              setResult(r.result);
              await reloadMe();
            })
          }
        >
          Pokaż mój styl
        </button>
      </div>
    </div>
  );
}

function WeekGoal({ onDone }: { onDone: () => void }) {
  const { data } = useApi<{ week: { goal: { trainings: number; mindful: number } } }>('/home');
  const [t, setT] = useState<number | null>(null);
  const [m, setM] = useState<number | null>(null);
  const { run, busy } = useAction();
  if (!data) return <Spinner />;
  const trainings = t ?? data.week.goal.trainings;
  const mindful = m ?? data.week.goal.mindful;
  const Step = ({ value, set, label }: { value: number; set: (n: number) => void; label: string }) => (
    <div className="row between card flat">
      <span>{label}</span>
      <span className="row">
        <button className="btn ghost sm" onClick={() => set(Math.max(0, value - 1))} aria-label={`Mniej: ${label}`}>
          −
        </button>
        <b style={{ minWidth: 20, textAlign: 'center' }}>{value}</b>
        <button className="btn ghost sm" onClick={() => set(Math.min(14, value + 1))} aria-label={`Więcej: ${label}`}>
          +
        </button>
      </span>
    </div>
  );
  return (
    <div className="stack-lg">
      <p className="muted small">Cel jest dla Ciebie, nie dla nikogo innego. Ustaw go tak, żeby był przyjemny.</p>
      <Step value={trainings} set={setT} label="Treningi w tygodniu" />
      <Step value={mindful} set={setM} label="Chwile dla siebie (oddech, medytacja, stretch)" />
      <button className="btn" disabled={busy} onClick={() => run(() => api('/my/week-goal', { method: 'PUT', body: { trainings, mindful } }).then(() => (window.dispatchEvent(new Event('glam:passes-changed')), onDone())), 'Cel zapisany')}>
        Zapisz cel
      </button>
    </div>
  );
}

type HealthData = {
  consent: boolean;
  photosConsent: boolean;
  profile?: { goals?: string; limitations?: string; injuries?: string; pregnancy?: boolean; postpartum?: boolean };
  measurements?: { id: string; date: string; shared: boolean; weight?: number; waist?: number; hips?: number; wellbeing?: number; note?: string }[];
  photos?: { id: string; taken_on: string; shared: number; url: string }[];
  plan?: { title: string; items: { day: string; text: string }[]; trainer?: string; updatedAt: string } | null;
};

function Health() {
  const { data, error, reload } = useApi<HealthData>('/my/health');
  const [profile, setProfile] = useState<HealthData['profile']>(undefined);
  const [m, setM] = useState({ weight: '', waist: '', hips: '', wellbeing: '', share: false });
  const { run, busy } = useAction();
  if (error?.code === 'feature_off') return <Empty>Studio nie prowadzi profilu zdrowia.</Empty>;
  if (!data) return <Spinner />;
  if (!data.consent) return <ConsentGate kind="health" text="Profil zdrowia jest opcjonalny. Ankieta startowa (cele, ograniczenia, kontuzje) pomaga trenerce prowadzić zajęcia bezpiecznie." onGranted={reload} />;
  const p = profile ?? data.profile ?? {};
  return (
    <div className="stack-lg">
      <section className="stack">
        <div className="eyebrow">Ankieta startowa</div>
        <p className="tiny muted" style={{ margin: 0 }}>Widzi ją Twoja trenerka – żeby dopasować ćwiczenia. Bez ocen i diagnoz.</p>
        <Field label="Cele">
          <input className="input" value={p.goals ?? ''} onChange={(e) => setProfile({ ...p, goals: e.target.value })} />
        </Field>
        <Field label="Ograniczenia">
          <input className="input" value={p.limitations ?? ''} onChange={(e) => setProfile({ ...p, limitations: e.target.value })} />
        </Field>
        <Field label="Kontuzje (obecne lub dawne)">
          <input className="input" value={p.injuries ?? ''} onChange={(e) => setProfile({ ...p, injuries: e.target.value })} />
        </Field>
        <Toggle label="Jestem w ciąży" checked={!!p.pregnancy} onChange={(v) => setProfile({ ...p, pregnancy: v })} />
        <Toggle label="Jestem po porodzie (do roku)" checked={!!p.postpartum} onChange={(v) => setProfile({ ...p, postpartum: v })} />
        <button className="btn" disabled={busy} onClick={() => run(() => api('/my/health', { method: 'PUT', body: p }).then(reload), 'Zapisane')}>
          Zapisz ankietę
        </button>
      </section>

      <section className="stack">
        <div className="eyebrow">Pomiary – tylko na Twoje życzenie</div>
        {data.measurements && data.measurements.length > 1 && (
          <div className="bar-chart" aria-label="Samopoczucie w czasie" style={{ marginBottom: 24 }}>
            {data.measurements.map((x) => (
              <div key={x.id} style={{ height: `${((x.wellbeing ?? 0) / 5) * 100}%` }}>
                <span>{x.date.slice(5).split('-').reverse().join('.')}</span>
              </div>
            ))}
          </div>
        )}
        {data.measurements?.map((x) => (
          <div key={x.id} className="row between small">
            <span>
              {fmtDay(`${x.date}T12:00:00Z`)} · {[x.weight && `${x.weight} kg`, x.waist && `talia ${x.waist}`, x.hips && `biodra ${x.hips}`, x.wellbeing && `samopoczucie ${x.wellbeing}/5`].filter(Boolean).join(' · ')}
            </span>
            <span className="row">
              <button className="link tiny" onClick={() => run(() => api(`/my/measurements/${x.id}`, { method: 'PATCH', body: { share: !x.shared } }).then(reload))}>
                {x.shared ? 'udostępnione' : 'udostępnij trenerce'}
              </button>
              <button className="link tiny" onClick={() => run(() => api(`/my/measurements/${x.id}`, { method: 'DELETE' }).then(reload))}>
                usuń
              </button>
            </span>
          </div>
        ))}
        <div className="grid-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <input className="input" inputMode="decimal" placeholder="Waga (kg)" value={m.weight} onChange={(e) => setM({ ...m, weight: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="Talia (cm)" value={m.waist} onChange={(e) => setM({ ...m, waist: e.target.value })} />
          <input className="input" inputMode="decimal" placeholder="Biodra (cm)" value={m.hips} onChange={(e) => setM({ ...m, hips: e.target.value })} />
          <select className="input" value={m.wellbeing} onChange={(e) => setM({ ...m, wellbeing: e.target.value })} aria-label="Samopoczucie">
            <option value="">Samopoczucie</option>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n} / 5
              </option>
            ))}
          </select>
        </div>
        <Toggle label="Udostępnij trenerce" checked={m.share} onChange={(v) => setM({ ...m, share: v })} />
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await api('/my/measurements', { method: 'POST', body: { weight: m.weight || undefined, waist: m.waist || undefined, hips: m.hips || undefined, wellbeing: m.wellbeing || undefined, share: m.share } });
              setM({ weight: '', waist: '', hips: '', wellbeing: '', share: false });
              reload();
            }, 'Zapisane')
          }
        >
          Dodaj pomiar
        </button>
        <p className="tiny muted" style={{ margin: 0 }}>Wykres pokazuje Twoją drogę – bez oceniania wyglądu.</p>
      </section>

      <section className="stack">
        <div className="eyebrow">Zdjęcia postępów</div>
        {!data.photosConsent ? (
          <ConsentGate kind="photos" text="Zdjęcia postępów są prywatne. Możesz je usunąć w każdej chwili i nigdy nie publikujemy ich bez Twojej zgody." onGranted={reload} />
        ) : (
          <>
            <div className="grid-3" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {data.photos?.map((ph) => (
                <div key={ph.id} className="stack" style={{ gap: 4 }}>
                  <AuthImg src={ph.url} alt={`Zdjęcie z ${ph.taken_on}`} style={{ width: '100%', aspectRatio: '3/4', objectFit: 'cover', borderRadius: 12 }} />
                  <button className="link tiny" onClick={() => run(() => api(`/my/photos/${ph.id}`, { method: 'PATCH', body: { share: !ph.shared } }).then(reload))}>
                    {ph.shared ? 'widzi trenerka' : 'tylko ja'}
                  </button>
                  <button className="link tiny" onClick={() => run(() => api(`/my/photos/${ph.id}`, { method: 'DELETE' }).then(reload), 'Usunięte')}>
                    usuń
                  </button>
                </div>
              ))}
            </div>
            <label className="btn ghost">
              Dodaj zdjęcie
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const dataUrl = await readFile(f);
                  run(() => api('/my/photos', { method: 'POST', body: { dataUrl } }).then(reload), 'Zapisane – tylko dla Ciebie');
                }}
              />
            </label>
          </>
        )}
      </section>
      <p className="tiny muted">Treści ogólne, bez diagnoz – nie zastępują konsultacji lekarskiej.</p>
    </div>
  );
}

function Plan() {
  const { data } = useApi<HealthData>('/my/health');
  if (!data) return <Spinner />;
  if (!data.plan) return <Empty>Twoja trenerka może przygotować dla Ciebie plan – zapytaj na zajęciach.</Empty>;
  return (
    <div className="stack">
      <h2 className="serif">{data.plan.title}</h2>
      <p className="small muted">od {data.plan.trainer} · {fmtDay(data.plan.updatedAt)}</p>
      {data.plan.items.map((i, k) => (
        <div key={k} className="card flat">
          <div className="eyebrow">{i.day}</div>
          <div>{i.text}</div>
        </div>
      ))}
    </div>
  );
}
