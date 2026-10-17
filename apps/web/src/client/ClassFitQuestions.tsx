// Ankieta „Dopasujmy zajęcia” (core/classfit): jak często ćwiczy, co chce poczuć, o czym warto wiedzieć, kiedy ma czas.
// Etapowa: jedno pytanie na ekranie, subtelny pasek postępu na górze, ekrany wjeżdżają z boku.
// Ta sama w onboardingu po pierwszym logowaniu i w Grafiku („Zmień odpowiedzi”) – tam na pełnym ekranie.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FIT_LEVELS, FOCUS, FOR_WHOM, type ClassFit, type DayTime } from '@glam/core';
import { api } from '../api.ts';
import { useLayer } from '../back.ts';
import { Icon } from '../icons.tsx';
import { useAction } from '../ui.tsx';

export type FitDraft = Omit<ClassFit, 'level'> & { level: ClassFit['level'] | null };
export const EMPTY_FIT: FitDraft = { level: null, focus: [], forWhom: [], times: [] };

export const DAY_TIMES: [DayTime, string][] = [
  ['morning', 'Rano'],
  ['noon', 'W porze lunchu'],
  ['evening', 'Wieczorem'],
  ['weekend', 'W weekend'],
];

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

type Step = 'intro' | 'level' | 'focus' | 'forWhom' | 'times';
/** Po wyborze poziomu przechodzimy dalej sami – chwila, żeby było widać zaznaczenie. */
const AUTO_NEXT_MS = 320;

/**
 * Pytania po jednym na ekranie. `withTimes` – w onboardingu pory są na osobnym kroku razem z urodzinami.
 * `intro` – ekran „Mamy do Ciebie kilka pytań” przed pierwszym pytaniem.
 * `onExit` – „Wstecz” na pierwszym ekranie (np. poprzedni krok onboardingu).
 */
export function ClassFitSteps({
  value,
  onChange,
  onDone,
  onExit,
  withTimes = true,
  intro = true,
  doneLabel = 'Gotowe',
  busy,
  top,
}: {
  value: FitDraft;
  onChange: (v: FitDraft) => void;
  onDone: () => void;
  onExit?: () => void;
  withTimes?: boolean;
  intro?: boolean;
  doneLabel?: string;
  busy?: boolean;
  /** Dodatkowy przycisk w pasku na górze (np. zamknięcie). */
  top?: ReactNode;
}) {
  const steps: Step[] = [...(intro ? (['intro'] as const) : []), 'level', 'focus', 'forWhom', ...(withTimes ? (['times'] as const) : [])];
  const questions = steps.filter((s) => s !== 'intro').length;
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const step = steps[i];
  const qIndex = steps.slice(0, i + 1).filter((s) => s !== 'intro').length; // 1…questions, 0 na intro
  const last = i === steps.length - 1;
  const go = (n: number) => {
    window.clearTimeout(timer.current);
    setDir(n > i ? 'fwd' : 'back');
    setI(n);
  };
  const next = () => (last ? onDone() : go(i + 1));
  const back = () => (i > 0 ? go(i - 1) : onExit?.());

  const chips = <K extends string>(all: [K, string][], picked: K[], set: (v: K[]) => void) => (
    <div className="pill-row fit-chips">
      {all.map(([k, l]) => (
        <button key={k} type="button" className="chip" aria-pressed={picked.includes(k)} onClick={() => set(toggle(picked, k))}>
          {l}
        </button>
      ))}
    </div>
  );

  let body: ReactNode;
  let action: ReactNode = null;
  const nextBtn = (picked: number) => (
    <button className={`btn block${picked || last ? '' : ' ghost'}`} disabled={busy} onClick={next}>
      {last ? doneLabel : picked ? 'Dalej' : 'Pomiń'}
    </button>
  );
  switch (step) {
    case 'intro':
      body = (
        <div className="fit-intro">
          <h1>
            Mamy do Ciebie <span className="serif">kilka pytań</span>
          </h1>
          <p className="muted">Kilka dotknięć – w Grafiku pokażemy na górze to, co najbardziej do Ciebie pasuje.</p>
        </div>
      );
      action = (
        <button className="btn block" onClick={next}>
          Zaczynamy
        </button>
      );
      break;
    case 'level':
      body = (
        <>
          <h2 className="fit-q">
            Jak często <span className="serif">ćwiczysz?</span>
          </h2>
          <div className="fit-options" role="radiogroup" aria-label="Jak często ćwiczysz?">
            {FIT_LEVELS.map(([k, l, hint]) => (
              <button
                key={k}
                type="button"
                className="fit-option"
                role="radio"
                aria-checked={value.level === k}
                onClick={() => {
                  onChange({ ...value, level: k });
                  window.clearTimeout(timer.current);
                  timer.current = window.setTimeout(next, AUTO_NEXT_MS);
                }}
              >
                <b>{l}</b>
                <span className="tiny muted">{hint}</span>
              </button>
            ))}
          </div>
        </>
      );
      // Poziom jest wymagany; gdy już wybrany (powrót „Wstecz”), można iść dalej bez ponownego dotykania.
      if (value.level)
        action = (
          <button className="btn block" onClick={next}>
            Dalej
          </button>
        );
      break;
    case 'focus':
      body = (
        <>
          <h2 className="fit-q">
            Co chcesz poczuć <span className="serif">po zajęciach?</span>
          </h2>
          <p className="muted small">Możesz wybrać kilka.</p>
          {chips(FOCUS, value.focus, (focus) => onChange({ ...value, focus }))}
        </>
      );
      action = nextBtn(value.focus.length);
      break;
    case 'forWhom':
      body = (
        <>
          <h2 className="fit-q">
            Coś, o czym <span className="serif">warto wiedzieć?</span>
          </h2>
          <p className="muted small">Dobrowolnie. Służy tylko do podpowiadania zajęć – trenerka nie widzi tych odpowiedzi.</p>
          {chips(FOR_WHOM, value.forWhom, (forWhom) => onChange({ ...value, forWhom }))}
        </>
      );
      action = nextBtn(value.forWhom.length);
      break;
    case 'times':
      body = (
        <>
          <h2 className="fit-q">
            Kiedy masz czas <span className="serif">dla siebie?</span>
          </h2>
          <p className="muted small">Podpowiemy zajęcia w tych porach.</p>
          {chips(DAY_TIMES, value.times, (times) => onChange({ ...value, times }))}
        </>
      );
      action = nextBtn(value.times.length);
      break;
  }

  return (
    <div className="fit-steps">
      <div className="fit-top">
        {i > 0 || onExit ? (
          <button type="button" className="fit-icon" onClick={back} aria-label="Wstecz">
            <Icon name="back" size={20} />
          </button>
        ) : (
          <span className="fit-icon" aria-hidden />
        )}
        <div
          className="fit-progress"
          role="progressbar"
          aria-label="Postęp ankiety"
          aria-valuenow={qIndex}
          aria-valuemax={questions}
          data-hidden={step === 'intro' || undefined}
        >
          <span style={{ width: `${(qIndex / questions) * 100}%` }} />
        </div>
        {top ?? <span className="fit-icon" aria-hidden />}
      </div>
      <div key={step} className={`fit-step ${dir}`} data-step={step}>
        {body}
      </div>
      <div key={`a-${step}`} className="fit-action">
        {action}
      </div>
    </div>
  );
}

/** Ankieta na pełnym ekranie – dla klientek, które przeszły onboarding przed tą funkcją, i do zmiany odpowiedzi. */
export function ClassFitSheet({ initial, onClose, onSaved }: { initial: ClassFit | null; onClose: () => void; onSaved: () => void }) {
  useLayer(onClose);
  const [fit, setFit] = useState<FitDraft>(initial ?? EMPTY_FIT);
  const { run, busy } = useAction();
  const save = () => run(() => api('/me/class-fit', { method: 'PUT', global: true, body: fit }), 'Gotowe – podpowiadamy zajęcia dla Ciebie').then((r) => r && (onSaved(), onClose()));
  return (
    <div className="fit-screen" role="dialog" aria-modal="true" aria-label="Dopasujmy zajęcia">
      <ClassFitSteps
        value={fit}
        onChange={setFit}
        onDone={save}
        busy={busy}
        doneLabel="Pokaż moje zajęcia"
        top={
          <button type="button" className="fit-icon" onClick={onClose} aria-label="Zamknij">
            <Icon name="close" size={20} />
          </button>
        }
      />
    </div>
  );
}
