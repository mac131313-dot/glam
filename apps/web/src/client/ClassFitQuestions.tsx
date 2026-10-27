// Preferencje zajęć (core/classfit): jak często ćwiczy, co chce poczuć, o czym warto wiedzieć, w które dni
// i w jakich godzinach może. Pytania na pełnym ekranie, jedno za drugim – subtelny pasek postępu, ekrany wjeżdżają z boku.
// `QuestionFlow` prowadzi też cały onboarding. Po wypełnieniu ankieta staje się listą „Twoje preferencje”:
// dotknięcie wiersza otwiera tylko to jedno pytanie, a wybór zapisuje się od razu.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  cleanWindow,
  daysLabel,
  DAY_FROM,
  DAY_TO,
  FIT_LEVELS,
  FOCUS,
  FOR_WHOM,
  HOUR_PRESETS,
  HOUR_STEP,
  MIN_WINDOW,
  timeLabel,
  WEEK,
  WEEKEND,
  windowLabel,
  WORKDAYS,
  type ClassFit,
} from '@glam/core';
import { api } from '../api.ts';
import { useLayer } from '../back.ts';
import { Icon } from '../icons.tsx';
import { ListRow, useAction } from '../ui.tsx';

export type FitDraft = Omit<ClassFit, 'level'> & { level: ClassFit['level'] | null };
export const EMPTY_FIT: FitDraft = { level: null, focus: [], forWhom: [], days: [], from: DAY_FROM, to: DAY_TO };

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d) => b.includes(d));

/** Jeden ekran pytań. */
export type Question = {
  id: string;
  body: ReactNode;
  /** Jest odpowiedź – przycisk „Dalej”. Bez niej: „Pomiń” (gdy `optional`) albo nic (wymagane, przechodzi samo po wyborze). */
  answered: boolean;
  optional?: boolean;
  /** Własny przycisk zamiast „Dalej / Pomiń”. */
  action?: ReactNode;
  /** Ekran powitalny – bez paska postępu i poza licznikiem pytań. */
  intro?: boolean;
};
export type FlowNav = { next: () => void; goTo: (id: string) => void; /** Dalej po chwili – żeby było widać zaznaczenie. */ autoNext: () => void };

/** Po wyborze jednej z kilku odpowiedzi przechodzimy dalej sami – chwila, żeby było widać zaznaczenie. */
const AUTO_NEXT_MS = 320;

/**
 * Pytania na pełnym ekranie, po jednym. `build` dostaje nawigację, żeby pytanie mogło samo przejść dalej
 * albo przeskoczyć do innego (np. „Pomiń ankietę” w onboardingu).
 * `onExit` – „Wstecz” na pierwszym ekranie. `top` – dodatkowy przycisk w pasku na górze (zamknięcie, „Pomiń”).
 */
export function QuestionFlow({
  build,
  onDone,
  onExit,
  doneLabel = 'Gotowe',
  busy,
  top,
}: {
  build: (nav: FlowNav) => Question[];
  onDone: () => void;
  onExit?: () => void;
  doneLabel?: string;
  busy?: boolean;
  top?: (q: Question, nav: FlowNav) => ReactNode;
}) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // `build` czyta stan rodzica przy każdym renderze – nawigacja korzysta z bieżącej listy przez ref.
  const list = useRef<Question[]>([]);
  const at = useRef(0);
  at.current = i;
  // Auto-przejście odpala się po chwili – musi zakończyć ankietę z odpowiedzią, która zdążyła się już zapisać w stanie.
  const done = useRef(onDone);
  done.current = onDone;

  const go = (n: number) => {
    window.clearTimeout(timer.current);
    setDir(n > at.current ? 'fwd' : 'back');
    setI(n);
  };
  const nav: FlowNav = {
    next: () => (at.current >= list.current.length - 1 ? done.current() : go(at.current + 1)),
    goTo: (id) => {
      const n = list.current.findIndex((q) => q.id === id);
      if (n >= 0) go(n);
    },
    autoNext: () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(nav.next, AUTO_NEXT_MS);
    },
  };
  const questions = build(nav);
  list.current = questions;
  const q = questions[Math.min(i, questions.length - 1)];
  const last = i >= questions.length - 1;
  const counted = questions.filter((x) => !x.intro);
  const qIndex = questions.slice(0, i + 1).filter((x) => !x.intro).length;
  const back = () => (i > 0 ? go(i - 1) : onExit?.());

  const action =
    q.action !== undefined ? (
      q.action
    ) : q.answered || last ? (
      <button className="btn block" disabled={busy} onClick={nav.next}>
        {last ? doneLabel : 'Dalej'}
      </button>
    ) : q.optional ? (
      <button className="btn block ghost" onClick={nav.next}>
        Pomiń
      </button>
    ) : null;

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
          aria-label="Postęp"
          aria-valuenow={qIndex}
          aria-valuemax={counted.length}
          data-hidden={q.intro || counted.length < 2 || undefined}
        >
          <span style={{ width: `${(qIndex / Math.max(1, counted.length)) * 100}%` }} />
        </div>
        {top?.(q, nav) ?? <span className="fit-icon" aria-hidden />}
      </div>
      <div key={q.id} className={`fit-step ${dir}`} data-step={q.id}>
        {q.body}
      </div>
      <div key={`a-${q.id}`} className="fit-action">
        {action}
      </div>
    </div>
  );
}

export type FitQuestionId = 'level' | 'focus' | 'forWhom' | 'days' | 'hours';
export const FIT_QUESTIONS: FitQuestionId[] = ['level', 'focus', 'forWhom', 'days', 'hours'];

function Chips<K extends string | number>({ all, picked, onToggle }: { all: [K, string][]; picked: K[]; onToggle: (k: K) => void }) {
  return (
    <div className="pill-row fit-chips">
      {all.map(([k, l]) => (
        <button key={k} type="button" className="chip" aria-pressed={picked.includes(k)} onClick={() => onToggle(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** Jedno pytanie ankiety – to samo w onboardingu, w pełnej ankiecie i przy zmianie jednej preferencji. */
export function fitQuestion(id: FitQuestionId, value: FitDraft, onChange: (v: FitDraft) => void, nav: FlowNav): Question {
  switch (id) {
    case 'level':
      return {
        id,
        answered: !!value.level,
        body: (
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
                    nav.autoNext();
                  }}
                >
                  <b>{l}</b>
                  <span className="tiny muted">{hint}</span>
                </button>
              ))}
            </div>
          </>
        ),
      };
    case 'focus':
      return {
        id,
        answered: value.focus.length > 0,
        optional: true,
        body: (
          <>
            <h2 className="fit-q">
              Co chcesz poczuć <span className="serif">po zajęciach?</span>
            </h2>
            <p className="muted small">Możesz wybrać kilka.</p>
            <Chips all={FOCUS} picked={value.focus} onToggle={(k) => onChange({ ...value, focus: toggle(value.focus, k) })} />
          </>
        ),
      };
    case 'forWhom':
      return {
        id,
        answered: value.forWhom.length > 0,
        optional: true,
        body: (
          <>
            <h2 className="fit-q">
              Coś, o czym <span className="serif">warto wiedzieć?</span>
            </h2>
            <p className="muted small">Dobrowolnie. Służy tylko do podpowiadania zajęć – trenerka nie widzi tych odpowiedzi.</p>
            <Chips all={FOR_WHOM} picked={value.forWhom} onToggle={(k) => onChange({ ...value, forWhom: toggle(value.forWhom, k) })} />
          </>
        ),
      };
    case 'days':
      return { id, answered: true, body: <DaysQuestion value={value} onChange={onChange} /> };
    case 'hours':
      return { id, answered: true, body: <HoursQuestion value={value} onChange={onChange} /> };
  }
}

/** Szybkie wybory dni i pod nimi każdy dzień osobno. Nic nie zaznaczone = każdy dzień (wszystkie podświetlone). */
function DaysQuestion({ value, onChange }: { value: FitDraft; onChange: (v: FitDraft) => void }) {
  const presets: [string, number[]][] = [
    ['Każdy dzień', []],
    ['Pn–pt', WORKDAYS],
    ['Weekend', WEEKEND],
  ];
  const setDays = (days: number[]) => onChange({ ...value, days: days.length === 7 ? [] : days });
  return (
    <>
      <h2 className="fit-q">
        W które dni <span className="serif">możesz?</span>
      </h2>
      <div className="pill-row fit-chips">
        {presets.map(([l, d]) => (
          <button key={l} type="button" className="chip" aria-pressed={sameDays(value.days, d)} onClick={() => setDays([...d])}>
            {l}
          </button>
        ))}
      </div>
      <div className="fit-days" role="group" aria-label="Dni tygodnia">
        {WEEK.map(([d, short, long]) => (
          <button key={d} type="button" aria-label={long} aria-pressed={!value.days.length || value.days.includes(d)} onClick={() => setDays(toggle(value.days.length ? value.days : WEEK.map(([x]) => x), d))}>
            {short}
          </button>
        ))}
      </div>
    </>
  );
}

/** Okno godzin: szybki wybór jednym dotknięciem, potem „Od” i „Do” co pół godziny. Przyciski same pilnują granic. */
function HoursQuestion({ value, onChange }: { value: FitDraft; onChange: (v: FitDraft) => void }) {
  const set = (from: number, to: number) => onChange({ ...value, ...cleanWindow(from, to) });
  const pct = (m: number) => `${((m - DAY_FROM) / (DAY_TO - DAY_FROM)) * 100}%`;
  return (
    <>
      <h2 className="fit-q">
        W jakich <span className="serif">godzinach?</span>
      </h2>
      <p className="muted small">Od której do której możesz – podpowiemy tylko zajęcia, które się w tym zmieszczą.</p>
      <div className="pill-row fit-chips">
        {HOUR_PRESETS.map(([l, f, t]) => (
          <button key={l} type="button" className="chip" aria-pressed={value.from === f && value.to === t} onClick={() => set(f, t)}>
            {l}
          </button>
        ))}
      </div>
      <div className="fit-window">
        <div className="fit-bar" aria-hidden>
          <span style={{ left: pct(value.from), right: `calc(100% - ${pct(value.to)})` }} />
        </div>
        <div className="fit-ticks tiny muted" aria-hidden>
          {[6, 10, 14, 18, 22].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        <div className="fit-range">
          <Stepper label="Od" value={value.from} min={DAY_FROM} max={value.to - MIN_WINDOW} onChange={(f) => set(f, value.to)} />
          <Stepper label="Do" value={value.to} min={value.from + MIN_WINDOW} max={DAY_TO} onChange={(t) => set(value.from, t)} />
        </div>
      </div>
    </>
  );
}

function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="fit-stepper" role="group" aria-label={label}>
      <span className="muted">{label}</span>
      <div>
        <button type="button" aria-label={`${label} – wcześniej`} disabled={value <= min} onClick={() => onChange(value - HOUR_STEP)}>
          −
        </button>
        <b aria-live="polite">{timeLabel(value)}</b>
        <button type="button" aria-label={`${label} – później`} disabled={value >= max} onClick={() => onChange(value + HOUR_STEP)}>
          +
        </button>
      </div>
    </div>
  );
}

/** Ekran „Mamy do Ciebie kilka pytań” przed pierwszą ankietą. */
export const fitIntro = (nav: FlowNav): Question => ({
  id: 'intro',
  intro: true,
  answered: true,
  body: (
    <div className="fit-intro">
      <h1>
        Mamy do Ciebie <span className="serif">kilka pytań</span>
      </h1>
      <p className="muted">Same szybkie wybory – w Grafiku pokażemy na górze to, co najbardziej do Ciebie pasuje. Zmienisz je w każdej chwili.</p>
    </div>
  ),
  action: (
    <button className="btn block" onClick={nav.next}>
      Zaczynamy
    </button>
  ),
});

const labelOf = <K,>(all: [K, string, ...unknown[]][], k: K) => all.find((x) => x[0] === k)?.[1] ?? '';
const listOf = <K,>(all: [K, string][], ks: K[], none: string) => (ks.length ? ks.map((k) => labelOf(all, k)).join(', ') : none);

/** Krótkie podsumowanie odpowiedzi – w wierszach preferencji i w Ustawieniach. */
export function fitSummary(fit: ClassFit): Record<FitQuestionId, [string, string]> {
  return {
    level: ['Jak często ćwiczysz', labelOf(FIT_LEVELS, fit.level)],
    focus: ['Co chcesz poczuć', listOf(FOCUS, fit.focus, 'bez preferencji')],
    forWhom: ['O czym warto wiedzieć', listOf(FOR_WHOM, fit.forWhom, 'nic szczególnego')],
    days: ['Dni', daysLabel(fit.days)],
    hours: ['Godziny', windowLabel(fit)],
  };
}
export const fitShort = (fit: ClassFit) => `${daysLabel(fit.days)} · ${windowLabel(fit)}`;

/**
 * Preferencje zajęć na pełnym ekranie (Grafik, Ustawienia). Bez wcześniejszych odpowiedzi – cała ankieta po kolei;
 * z odpowiedziami – lista, w której każde pytanie zmienia się osobno i zapisuje od razu.
 */
export function ClassFitSheet({ initial, onClose, onSaved }: { initial: ClassFit | null; onClose: () => void; onSaved: () => void }) {
  useLayer(onClose);
  const [saved, setSaved] = useState<ClassFit | null>(initial);
  const [fit, setFit] = useState<FitDraft>(initial ?? EMPTY_FIT);
  const [editing, setEditing] = useState<FitQuestionId | null>(null);
  const { run, busy } = useAction();
  const save = (msg: string) =>
    run(() => api<{ fit: ClassFit }>('/me/class-fit', { method: 'PUT', global: true, body: fit }), msg).then((r) => {
      if (!r) return false;
      setSaved(r.fit);
      setFit(r.fit);
      onSaved();
      return true;
    });
  const close = (
    <button type="button" className="fit-icon" onClick={onClose} aria-label="Zamknij">
      <Icon name="close" size={20} />
    </button>
  );

  let content: ReactNode;
  if (!saved)
    content = (
      <QuestionFlow
        build={(nav) => [fitIntro(nav), ...FIT_QUESTIONS.map((id) => fitQuestion(id, fit, setFit, nav))]}
        onDone={() => save('Gotowe – podpowiadamy zajęcia dla Ciebie').then((ok) => ok && onClose())}
        busy={busy}
        doneLabel="Pokaż moje zajęcia"
        top={() => close}
      />
    );
  else if (editing)
    content = (
      <QuestionFlow
        key={editing}
        build={(nav) => [fitQuestion(editing, fit, setFit, nav)]}
        onDone={() => save('Zapisane').then((ok) => ok && setEditing(null))}
        onExit={() => (setFit(saved), setEditing(null))}
        busy={busy}
        doneLabel="Zapisz"
      />
    );
  else {
    const summary = fitSummary(saved);
    content = (
      <div className="fit-steps">
        <div className="fit-top">
          <span className="fit-icon" aria-hidden />
          <span />
          {close}
        </div>
        <div className="fit-step">
          <h2 className="fit-q">
            Twoje <span className="serif">preferencje</span>
          </h2>
          <p className="muted small">Z nich układamy „Dopasowane do Ciebie” w Grafiku. Dotknij, żeby zmienić.</p>
          <section>
            {FIT_QUESTIONS.map((id) => (
              <ListRow key={id} title={summary[id][0]} hint={summary[id][1]} onClick={() => setEditing(id)} />
            ))}
          </section>
        </div>
      </div>
    );
  }
  return (
    <div className="fit-screen" role="dialog" aria-modal="true" aria-label="Preferencje zajęć">
      {content}
    </div>
  );
}
