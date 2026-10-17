// Onboarding (3): imię, ankieta „Dopasujmy zajęcia” (karuzela w Grafiku), preferencje czasowe, urodziny
// (dobrowolnie, bez roku – 8.1.5), zgody, powiadomienia.
// Quiz „Mój styl dnia” jest opcjonalny – można go zrobić teraz albo później w Profilu.
import { useState } from 'react';
import { fitGoalLabel } from '@glam/core';
import { api } from '../api.ts';
import { ClassFitSteps, DAY_TIMES, EMPTY_FIT, type FitDraft } from './ClassFitQuestions.tsx';
import type { Me } from '../App.tsx';
import { StudioBrand } from '../StudioBrand.tsx';
import { Toggle, useAction } from '../ui.tsx';
import type { Studio } from './ClientApp.tsx';
import { enablePush, pushSupported } from '../push.ts';

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

export function Onboarding({ studio, me, onDone }: { studio: Studio; me: Me; onDone: () => Promise<void> }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(me.user.name ?? '');
  const [fit, setFit] = useState<FitDraft>(EMPTY_FIT);
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [push, setPush] = useState(false);
  const { run, busy } = useAction();

  const finish = () =>
    run(async () => {
      if (push && pushSupported()) await enablePush().catch(() => false);
      await api('/me/onboarding', {
        method: 'POST',
        global: true,
        body: {
          name: name.trim() || undefined,
          // Cel dla trenerki składamy z ankiety – jedno pytanie mniej.
          goal: fit.level ? fitGoalLabel({ ...fit, level: fit.level }) : undefined,
          timePrefs: fit.times,
          classFit: fit.level ? fit : undefined,
          birthday: day && month ? `${month.padStart(2, '0')}-${day.padStart(2, '0')}` : null,
          consents: { terms, marketing },
          studioId: studio.id,
        },
      });
      await onDone();
    });

  const steps = [
    <div key="0" className="stack">
      <h1>
        Witaj w <span className="serif">{studio.name}</span>
      </h1>
      <p className="muted">To miejsce dla Ciebie – nie tylko kalendarz zajęć. Dwie minuty i zaczynamy.</p>
      <label className="field">
        <span className="field-label">Jak masz na imię?</span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
      </label>
    </div>,
    // Ankieta ma własne ekrany, pasek postępu i przyciski – dolna nawigacja onboardingu jest na tym kroku schowana.
    <ClassFitSteps
      key="fit"
      value={fit}
      onChange={setFit}
      withTimes={false}
      onExit={() => setStep(0)}
      onDone={() => setStep(2)}
      doneLabel="Dalej"
      top={
        <button type="button" className="fit-skip" onClick={() => (setFit(EMPTY_FIT), setStep(2))}>
          Pomiń
        </button>
      }
    />,
    <div key="1" className="stack">
      <h2>Kiedy masz czas dla siebie?</h2>
      <p className="muted small">Podpowiemy zajęcia w tych porach. Możesz wybrać kilka.</p>
      <div className="pill-row">
        {DAY_TIMES.map(([v, l]) => (
          <button key={v} className="chip" aria-pressed={fit.times.includes(v)} onClick={() => setFit({ ...fit, times: fit.times.includes(v) ? fit.times.filter((x) => x !== v) : [...fit.times, v] })}>
            {l}
          </button>
        ))}
      </div>
      <h2 style={{ marginTop: 18 }}>Chcesz, żebyśmy składali Ci życzenia?</h2>
      <p className="muted small">Podaj dzień i miesiąc urodzin – bez roku. Możesz to zmienić albo usunąć później.</p>
      <div className="row">
        <select className="input" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Dzień">
          <option value="">dzień</option>
          {Array.from({ length: 31 }, (_, i) => (
            <option key={i} value={String(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
        <select className="input" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Miesiąc">
          <option value="">miesiąc</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
      </div>
    </div>,
    <div key="2" className="stack">
      <h2>Zgody</h2>
      <Toggle label="Akceptuję regulamin studia i aplikacji" hint={studio.regulations ? 'Regulamin znajdziesz w Profilu → Pomoc' : undefined} checked={terms} onChange={setTerms} />
      <Toggle label="Chcę dostawać wiadomości o promocjach i wydarzeniach" hint="Max 2 dziennie, nigdy w nocy. Możesz wyłączyć w każdej chwili." checked={marketing} onChange={setMarketing} />
      {pushSupported() && <Toggle label="Powiadomienia na telefonie" hint="Przypomnienia o zajęciach, zwolnione miejsca, wiadomości od trenerki" checked={push} onChange={setPush} />}
      <p className="tiny muted">Dane o zdrowiu (dziennik, pomiary, cykl) zbieramy tylko, jeśli sama zdecydujesz – osobną zgodą w Profilu.</p>
    </div>,
  ];

  return (
    <main className="phone" style={{ padding: '24px 22px 40px' }}>
      <div style={{ marginBottom: 24 }}>
        <StudioBrand studio={studio} />
      </div>
      {steps[step]}
      {step !== 1 && (
        <div className="row between" style={{ marginTop: 28 }}>
          <span className="tiny muted">
            {step + 1} / {steps.length}
          </span>
          <div className="row">
            {step > 0 && (
              <button className="btn ghost" onClick={() => setStep(step - 1)}>
                Wstecz
              </button>
            )}
            {step < steps.length - 1 ? (
              <button className="btn" onClick={() => setStep(step + 1)} disabled={step === 0 && name.trim().length < 2}>
                Dalej
              </button>
            ) : (
              <button className="btn" disabled={!terms || busy} onClick={finish}>
                Zaczynamy
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
