// Publiczny cennik i rejestracja studia: /start. Plany z GET /api/platform/plans (zero cen i limitów na sztywno),
// rejestracja w 3 krokach w jednym widoku: (1) telefon i kod SMS, (2) studio, (3) właścicielka i zgody.
// Pola same pilnują wartości – „Dalej” jest nieaktywne, dopóki dane nie są poprawne. Po sukcesie sesja z
// POST /api/signup/studio przechodzi do panelu (handOffSession), a nowa właścicielka ląduje w swoim studiu.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PRESETS, validEmail, TRIAL_DAYS, type Plan, type PlanLimits } from '@glam/core';
import { api, ApiError, handOffSession, useApi } from '../api.ts';
import { Field, Pending } from '../ui.tsx';
import './start.css';

type PricedPlan = Plan & { price: string; featureLabels: string[] };
type PlansResponse = { plans: PricedPlan[]; trialDays: number };
type SignupResponse = { studioId: string; token: string; inviteCode: string; trialDays: number; message: string };
type Step = 1 | 2 | 3;
/** Pole, przy którym pokazujemy błąd z API (albo `general` – spokojny komunikat nad przyciskiem). */
type ErrKey = 'phone' | 'code' | 'studio' | 'owner' | 'email' | 'terms' | 'general';
type Errors = Partial<Record<ErrKey, string>>;

const FEATURED_PLAN = 'studio';
const DEFAULT_PLAN = FEATURED_PLAN;
const STEP_LABEL: Record<Step, string> = { 1: 'Twój numer', 2: 'Studio', 3: 'Ty i zgody' };
const CODE_LENGTH = 6;

const fmt = (n: number) => n.toLocaleString('pl-PL');
const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n % 10 >= 2 && n % 10 <= 4 && !(n % 100 >= 12 && n % 100 <= 14) ? few : many);

function limitLines(l: PlanLimits): string[] {
  return [
    `${fmt(l.facilities)} ${plural(l.facilities, 'obiekt', 'obiekty', 'obiektów')}`,
    `${fmt(l.activeClients)} aktywnych klientek`,
    `${fmt(l.staff)} ${plural(l.staff, 'osoba', 'osoby', 'osób')} w zespole`,
    `${fmt(l.smsPerMonth)} SMS-ów miesięcznie`,
    l.videoMb >= 1000 ? `${fmt(l.videoMb / 1000)} GB wideo` : `${fmt(l.videoMb)} MB wideo`,
  ];
}

/** Numer jak w API (normalizePhone): 9 cyfr albo numer z kierunkowym (+48… / 0048…). */
function validPhone(raw: string): boolean {
  const digits = raw.replace(/[\s\-()]/g, '');
  const full = /^\d{9}$/.test(digits) ? `+48${digits}` : digits.startsWith('00') ? `+${digits.slice(2)}` : digits;
  return /^\+\d{9,15}$/.test(full);
}

/** CAPTCHA bez dostawcy (proof-of-work, jak w API): szukamy liczby, dla której SHA-256(wyzwanie + liczba) zaczyna się od N zerowych bitów. */
async function solveCaptcha(challenge: string, difficulty: number): Promise<{ challenge: string; nonce: string }> {
  const enc = new TextEncoder();
  for (let nonce = 0; nonce < 5_000_000; nonce++) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${challenge}${nonce}`)));
    let bits = 0;
    for (const byte of hash) {
      if (byte === 0) bits += 8;
      else {
        bits += Math.clz32(byte) - 24;
        break;
      }
    }
    if (bits >= difficulty) return { challenge, nonce: String(nonce) };
  }
  throw new Error('captcha');
}

/** Błąd z POST /api/signup/studio → pole i krok, których dotyczy (po komunikacie API); reszta to ogólny komunikat. */
function whereIs(e: ApiError): { key: ErrKey; step: Step } {
  if (['wrong_code', 'expired', 'no_code', 'locked'].includes(e.code)) return { key: 'code', step: 1 };
  const m = e.message.toLowerCase();
  if (m.includes('telefon')) return { key: 'phone', step: 1 };
  if (m.includes('nazw') && m.includes('studia')) return { key: 'studio', step: 2 };
  if (m.includes('imię')) return { key: 'owner', step: 3 };
  if (m.includes('e-mail')) return { key: 'email', step: 3 };
  if (m.includes('regulamin')) return { key: 'terms', step: 3 };
  return { key: 'general', step: 3 };
}

export function StartSite() {
  const plans = useApi<PlansResponse>('/platform/plans', [], { global: true });
  const [planId, setPlanId] = useState(DEFAULT_PLAN);
  const formRef = useRef<HTMLElement>(null);

  useEffect(() => {
    document.title = 'GLAM – załóż studio';
  }, []);

  const trialDays = plans.data?.trialDays ?? TRIAL_DAYS;
  const choosePlan = (id: string) => {
    setPlanId(id);
    formRef.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <main className="start">
      <header className="start-top">
        <a href="/" className="wordmark" aria-label="GLAM – strona główna">
          glam
        </a>
        <a className="small" href="/panel">
          Mam już studio
        </a>
      </header>

      <section className="start-hero" aria-labelledby="start-h1">
        <div className="eyebrow">Dla właścicielek studiów</div>
        <h1 id="start-h1">
          {trialDays} dni za darmo, <span className="serif">bez karty</span>
        </h1>
        <p>Grafik, karnety, klientki i strona internetowa studia w jednym miejscu. Zakładasz studio w trzy minuty.</p>
        <a className="btn" href="#zaloz" onClick={(e) => (e.preventDefault(), choosePlan(planId))}>
          Załóż studio
        </a>
      </section>

      <section aria-labelledby="start-ceny">
        <div className="eyebrow" id="start-ceny">
          Cennik
        </div>
        {plans.data ? (
          <div className="start-plans">
            {plans.data.plans.map((p, i) => (
              <PlanColumn key={p.id} plan={p} previous={plans.data!.plans[i - 1]} selected={p.id === planId} featured={p.id === FEATURED_PLAN} onChoose={() => choosePlan(p.id)} />
            ))}
          </div>
        ) : (
          <Pending error={plans.error} reload={plans.reload} />
        )}
        <p className="start-foot" style={{ marginTop: 16 }}>
          Plan możesz zmienić w każdej chwili w ustawieniach studia. Pierwsze {trialDays} dni bez karty i bez zobowiązań.
        </p>
      </section>

      <section id="zaloz" ref={formRef} className="start-form" aria-label="Rejestracja studia">
        <Signup planId={planId} setPlanId={setPlanId} plans={plans.data?.plans ?? []} />
      </section>
    </main>
  );
}

function PlanColumn({ plan, previous, selected, featured, onChoose }: { plan: PricedPlan; previous?: PricedPlan; selected: boolean; featured: boolean; onChoose: () => void }) {
  // Funkcje wyższego planu pokazujemy jako dodatek do niższego – lista nie powtarza się trzy razy.
  const extra = previous ? plan.featureLabels.filter((l) => !previous.featureLabels.includes(l)) : plan.featureLabels;
  return (
    <article className={`start-plan${featured ? ' featured' : ''}`}>
      <div className="eyebrow" style={{ margin: 0, visibility: featured ? 'visible' : 'hidden' }} aria-hidden={!featured}>
        Najczęściej wybierany
      </div>
      <h3>{plan.name}</h3>
      <div className="start-price">
        <b>{plan.price}</b>
        <span>/ miesiąc</span>
      </div>
      <ul className="limits">
        {limitLines(plan.limits).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <p className="lead-in">{previous ? `Wszystko z planu ${previous.name} i dodatkowo:` : 'W planie:'}</p>
      <ul className="feats">
        {extra.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="fill" />
      <button type="button" className={`btn${selected ? '' : ' ghost'}`} aria-pressed={selected} onClick={onChoose}>
        {selected ? `Wybrany: ${plan.name}` : `Wybieram ${plan.name}`}
      </button>
    </article>
  );
}

function Signup({ planId, setPlanId, plans }: { planId: string; setPlanId: (id: string) => void; plans: PricedPlan[] }) {
  const [step, setStep] = useState<Step>(1);
  const [phone, setPhone] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [studioName, setStudioName] = useState('');
  const [city, setCity] = useState('');
  const [presetId, setPresetId] = useState<string | null>(null);
  const [ownerName, setOwnerName] = useState('');
  const [email, setEmail] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const interacted = useRef(false);
  const stepRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  // Po przejściu do innego kroku kursor ląduje w pierwszym polu (nie przy pierwszym wejściu na stronę).
  useEffect(() => {
    if (!interacted.current) return;
    stepRef.current?.querySelector<HTMLElement>('input:not([type=checkbox]):not([disabled])')?.focus();
  }, [step, codeSent]);

  const setError = (key: ErrKey, message?: string) => setErrors(message ? { [key]: message } : {});
  const goTo = (s: Step) => {
    interacted.current = true;
    setErrors({});
    setStep(s);
  };

  const phoneOk = validPhone(phone);
  const codeOk = code.length === CODE_LENGTH;
  const studioOk = studioName.trim().length >= 2;
  const ownerOk = ownerName.trim().length >= 2;
  const emailOk = validEmail(email.trim());
  const ready = step === 1 ? codeSent && codeOk : step === 2 ? studioOk : ownerOk && emailOk && terms;

  const requestCode = async () => {
    interacted.current = true;
    setBusy(true);
    setErrors({});
    const send = (captcha?: { challenge: string; nonce: string }) => api<{ resendIn: number; devCode?: string }>('/auth/request-code', { method: 'POST', body: { phone, captcha }, global: true });
    try {
      let res: { resendIn: number; devCode?: string };
      try {
        res = await send();
      } catch (e) {
        if (!(e instanceof ApiError) || e.code !== 'captcha_required') throw e;
        res = await send(await solveCaptcha(e.details.challenge, e.details.difficulty));
      }
      setCodeSent(true);
      setCooldown(res.resendIn);
      setDevCode(res.devCode ?? null);
      setCode('');
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      if (err?.code === 'resend_too_soon') {
        // Kod już poszedł (np. po odświeżeniu strony) – pozwalamy go wpisać.
        setCodeSent(true);
        setCooldown(err.details?.retryIn ?? 60);
        setError('code', err.message);
      } else {
        setError(codeSent ? 'code' : 'phone', err?.message ?? 'Nie udało się wysłać kodu. Spróbuj za chwilę.');
      }
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setErrors({});
    try {
      const res = await api<SignupResponse>('/signup/studio', {
        method: 'POST',
        global: true,
        body: {
          studioName: studioName.trim(),
          city: city.trim() || undefined,
          ownerName: ownerName.trim(),
          phone,
          code,
          email: email.trim(),
          presetId: presetId ?? undefined,
          planId,
          acceptTerms: terms,
        },
      });
      setDone(res.message);
      handOffSession('panel', res.token, res.studioId);
      location.href = '/panel';
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      const { key, step: at } = err ? whereIs(err) : { key: 'general' as ErrKey, step: 3 as Step };
      const message = err?.details?.attemptsLeft !== undefined ? `${err.message} Zostało prób: ${err.details.attemptsLeft}.` : (err?.message ?? 'Nie udało się założyć studia. Spróbuj za chwilę.');
      interacted.current = true;
      if (key === 'code') setCode('');
      setStep(at);
      setErrors({ [key]: message });
      setBusy(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || done) return;
    if (step === 1) {
      if (!codeSent) {
        if (phoneOk) requestCode();
      } else if (codeOk) goTo(2);
    } else if (step === 2) {
      if (studioOk) goTo(3);
    } else if (ownerOk && emailOk && terms) submit();
  };

  if (done) {
    return (
      <div className="start-step" role="status">
        <h2>Studio gotowe</h2>
        <p className="muted">{done} Otwieram panel…</p>
      </div>
    );
  }

  const preset = PRESETS.find((p) => p.id === presetId);
  const fieldError = (k: ErrKey) => (errors[k] ? <p className="start-err" role="alert">{errors[k]}</p> : null);

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="stack-lg" style={{ gap: 'var(--space-5)' }}>
        <div className="stack gap-2">
          <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)' }}>
            Załóż <span className="serif">studio</span>
          </h2>
          <div className="start-progress" role="img" aria-label={`Krok ${step} z 3`}>
            {[1, 2, 3].map((n) => (
              <i key={n} data-on={n <= step} />
            ))}
          </div>
          <div className="tiny muted">
            Krok {step} z 3 · {STEP_LABEL[step]}
          </div>
        </div>

        <div className="start-step" ref={stepRef}>
          {step === 1 && (
            <>
              <Field label="Numer telefonu" hint={codeSent ? undefined : 'Wyślemy jednorazowy kod SMS. Bez hasła.'}>
                <input
                  className="input"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="500 600 700"
                  value={phone}
                  disabled={codeSent || busy}
                  onChange={(e) => (setPhone(e.target.value), setErrors({}))}
                />
              </Field>
              {fieldError('phone')}
              {codeSent && (
                <>
                  <p className="small muted" style={{ margin: 0 }}>
                    Wysłałyśmy {CODE_LENGTH} cyfr na numer {phone}.{' '}
                    <button type="button" className="link" onClick={() => (setCodeSent(false), setCode(''), setDevCode(null), setErrors({}))}>
                      Zmień numer
                    </button>
                  </p>
                  <input
                    className="input otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={CODE_LENGTH}
                    value={code}
                    aria-label="Kod z SMS"
                    onChange={(e) => (setCode(e.target.value.replace(/\D/g, '')), setErrors({}))}
                  />
                  {devCode && (
                    <p className="tiny muted center" style={{ margin: 0 }}>
                      Tryb deweloperski – kod: <b>{devCode}</b>
                    </p>
                  )}
                  {fieldError('code')}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <Field label="Nazwa studia">
                <input className="input" autoComplete="organization" maxLength={60} value={studioName} onChange={(e) => setStudioName(e.target.value)} />
              </Field>
              {fieldError('studio')}
              <Field label="Miasto" hint="Niewymagane">
                <input className="input" autoComplete="address-level2" maxLength={60} value={city} onChange={(e) => setCity(e.target.value)} />
              </Field>
              <div className="field">
                <span className="field-label" id="preset-label">
                  Rodzaj studia
                </span>
                <div className="chips-wrap" role="group" aria-labelledby="preset-label">
                  {PRESETS.map((p) => (
                    <button key={p.id} type="button" className="chip" aria-pressed={presetId === p.id} onClick={() => setPresetId(presetId === p.id ? null : p.id)}>
                      {p.label}
                    </button>
                  ))}
                </div>
                <span className="tiny muted">{preset ? preset.description : 'Niewymagane – bez wyboru zaczynasz od pustego studia.'}</span>
              </div>
              {plans.length > 0 && (
                <div className="field">
                  <span className="field-label" id="plan-label">
                    Plan
                  </span>
                  <div className="chips-wrap" role="group" aria-labelledby="plan-label">
                    {plans.map((p) => (
                      <button key={p.id} type="button" className="chip" aria-pressed={planId === p.id} onClick={() => setPlanId(p.id)}>
                        {p.name} · {p.price}
                      </button>
                    ))}
                  </div>
                  <span className="tiny muted">Zmienisz go w każdej chwili.</span>
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <Field label="Imię i nazwisko">
                <input className="input" autoComplete="name" maxLength={80} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              </Field>
              {fieldError('owner')}
              <Field label="E-mail" hint="Wyślemy na niego link potwierdzający.">
                <input className="input" type="email" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
              {email.trim() && !emailOk && <p className="tiny muted" style={{ margin: 0 }}>Sprawdź adres – brakuje np. @ albo końcówki, jak .pl.</p>}
              {fieldError('email')}
              <label className="start-check">
                <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
                <span>Akceptuję regulamin platformy GLAM i umowę powierzenia przetwarzania danych (DPA).</span>
              </label>
              {fieldError('terms')}
            </>
          )}

          {errors.general && (
            <p className="start-err" role="alert">
              {errors.general}
            </p>
          )}

          <div className="start-actions">
            {step === 1 && !codeSent ? (
              <button className="btn block" disabled={busy || !phoneOk}>
                Wyślij kod
              </button>
            ) : (
              <button className="btn block" disabled={busy || !ready}>
                {step === 3 ? 'Załóż studio' : 'Dalej'}
              </button>
            )}
            {step === 1 && codeSent && (
              <button type="button" className="btn ghost block" disabled={busy || cooldown > 0} onClick={requestCode}>
                {cooldown > 0 ? `Wyślij ponownie za ${cooldown} s` : 'Wyślij kod ponownie'}
              </button>
            )}
            {step > 1 && (
              <button type="button" className="btn ghost block" disabled={busy} onClick={() => goTo((step - 1) as Step)}>
                Wstecz
              </button>
            )}
          </div>
          <p className="start-foot" style={{ margin: 0 }}>
            {step === 3 ? `${TRIAL_DAYS} dni za darmo, bez karty. Po okresie próbnym sam wybierzesz, czy zostajesz.` : 'Bez karty i bez zobowiązań.'}
          </p>
        </div>
      </div>
    </form>
  );
}
