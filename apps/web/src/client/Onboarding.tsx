// Onboarding (3): imię, preferencje zajęć (poziom, cel, „o czym warto wiedzieć”, dni, godziny – karuzela w Grafiku),
// urodziny (dobrowolnie, bez roku – 8.1.5), zgody, powiadomienia. Wszystko na pełnym ekranie, jedno pytanie za drugim.
// Quiz „Mój styl dnia” jest opcjonalny – można go zrobić teraz albo później w Profilu.
import { useState } from 'react';
import { fitGoalLabel } from '@glam/core';
import { api } from '../api.ts';
import { EMPTY_FIT, FIT_QUESTIONS, fitQuestion, QuestionFlow, type FitDraft, type Question } from './ClassFitQuestions.tsx';
import type { Me } from '../App.tsx';
import { StudioBrand } from '../StudioBrand.tsx';
import { Toggle, useAction } from '../ui.tsx';
import type { Studio } from './ClientApp.tsx';
import { enablePush, pushSupported } from '../push.ts';

const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function Onboarding({ studio, me, onDone }: { studio: Studio; me: Me; onDone: () => Promise<void> }) {
  const [name, setName] = useState(me.user.name ?? '');
  // E-mail podany przy zakładaniu konta (recepcja, zakup kursu) od razu w polu – klientka tylko potwierdza.
  const [email, setEmail] = useState(me.user.email ?? '');
  const [news, setNews] = useState(false);
  const [fit, setFit] = useState<FitDraft>(EMPTY_FIT);
  const [day, setDay] = useState(0);
  const [month, setMonth] = useState(0);
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
          email: emailOk ? email.trim() : undefined,
          // Cel dla trenerki składamy z ankiety – jedno pytanie mniej.
          goal: fit.level ? fitGoalLabel({ ...fit, level: fit.level }) : undefined,
          classFit: fit.level ? fit : undefined,
          birthday: day && month ? `${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null,
          consents: { terms, marketing, ...(emailOk ? { marketing_email: news } : {}) },
          studioId: studio.id,
        },
      });
      await onDone();
    });

  const named = name.trim().length >= 2;
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const emailBad = email.trim().length > 0 && !emailOk;
  const build = (nav: Parameters<typeof fitQuestion>[3]): Question[] => [
    {
      id: 'name',
      intro: true,
      answered: named,
      body: (
        <div className="stack">
          <div style={{ marginBottom: 16 }}>
            <StudioBrand studio={studio} />
          </div>
          <h1>
            Witaj w <span className="serif">{studio.name}</span>
          </h1>
          <p className="muted">To miejsce dla Ciebie – nie tylko kalendarz zajęć. Kilka szybkich wyborów i zaczynamy.</p>
          <label className="field">
            <span className="field-label">Jak masz na imię?</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && named && nav.next()} autoComplete="given-name" enterKeyHint="next" />
          </label>
        </div>
      ),
      action: (
        <button className="btn block" disabled={!named} onClick={nav.next}>
          Dalej
        </button>
      ),
    },
    {
      id: 'email',
      answered: emailOk,
      optional: true,
      body: (
        <>
          <h2 className="fit-q">
            Twój <span className="serif">e-mail</span>
          </h2>
          <p className="muted small">
            {me.user.email ? 'Mamy ten adres z recepcji – sprawdź, czy się zgadza.' : 'Wyślemy na niego potwierdzenia zakupów i faktury.'} Zmienisz go w każdej chwili w Profilu.
          </p>
          <label className="field">
            <span className="field-label">Adres e-mail</span>
            <input
              className="input"
              type="email"
              inputMode="email"
              autoComplete="email"
              enterKeyHint="next"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && emailOk && nav.next()}
              placeholder="np. magda@poczta.pl"
              aria-invalid={emailBad || undefined}
            />
            {emailBad && <span className="tiny muted">Sprawdź adres – brakuje „@” albo domeny.</span>}
          </label>
          {emailOk && <Toggle label="Nowe zajęcia i nowości mailem" hint="Krótko, gdy w grafiku pojawi się coś nowego. Wypiszesz się jednym kliknięciem." checked={news} onChange={setNews} />}
        </>
      ),
      action: emailBad ? (
        <button className="btn block" disabled>
          Dalej
        </button>
      ) : undefined,
    },
    ...FIT_QUESTIONS.map((id) => fitQuestion(id, fit, setFit, nav)),
    {
      id: 'birthday',
      answered: !!(day && month),
      optional: true,
      body: (
        <>
          <h2 className="fit-q">
            Kiedy masz <span className="serif">urodziny?</span>
          </h2>
          <p className="muted small">Złożymy Ci życzenia. Tylko dzień i miesiąc – bez roku. Zmienisz to albo usuniesz w Ustawieniach.</p>
          <div className="fit-months" role="radiogroup" aria-label="Miesiąc">
            {MONTHS.map((m, i) => (
              <button key={m} type="button" role="radio" aria-checked={month === i + 1} onClick={() => (setMonth(i + 1), day > MONTH_DAYS[i] && setDay(0))}>
                {m}
              </button>
            ))}
          </div>
          {month > 0 && (
            <div className="fit-month-days" role="radiogroup" aria-label="Dzień">
              {Array.from({ length: MONTH_DAYS[month - 1] }, (_, i) => (
                <button key={i} type="button" role="radio" aria-checked={day === i + 1} onClick={() => setDay(i + 1)}>
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </>
      ),
    },
    {
      id: 'consents',
      answered: terms,
      body: (
        <>
          <h2 className="fit-q">
            Ostatnia <span className="serif">rzecz</span>
          </h2>
          <div className="stack">
            <Toggle label="Akceptuję regulamin studia i aplikacji" hint={studio.regulations ? 'Regulamin znajdziesz w Profilu → Pomoc' : undefined} checked={terms} onChange={setTerms} />
            <Toggle label="Chcę dostawać wiadomości o promocjach i wydarzeniach" hint="Max 2 dziennie, nigdy w nocy. Możesz wyłączyć w każdej chwili." checked={marketing} onChange={setMarketing} />
            {pushSupported() && <Toggle label="Powiadomienia na telefonie" hint="Przypomnienia o zajęciach, zwolnione miejsca, wiadomości od trenerki" checked={push} onChange={setPush} />}
            <p className="tiny muted">Dane o zdrowiu (dziennik, pomiary, cykl) zbieramy tylko, jeśli sama zdecydujesz – osobną zgodą w Profilu.</p>
          </div>
        </>
      ),
      action: (
        <button className="btn block" disabled={!terms || busy} onClick={finish}>
          Zaczynamy
        </button>
      ),
    },
  ];

  return (
    <main className="phone fit-page">
      <QuestionFlow
        build={build}
        onDone={finish}
        busy={busy}
        // Ankietę można pominąć w całości – preferencje uzupełni później z Grafiku albo Ustawień.
        top={(q, nav) =>
          (FIT_QUESTIONS as string[]).includes(q.id) ? (
            <button type="button" className="fit-skip" onClick={() => (setFit(EMPTY_FIT), nav.goTo('birthday'))}>
              Pomiń
            </button>
          ) : null
        }
      />
    </main>
  );
}
