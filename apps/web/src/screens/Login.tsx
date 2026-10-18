// Logowanie numerem telefonu + kod SMS (2.2). Ekran startowy: logo, data i godzina, klimatyczne tło.
import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, fmtLongDay } from '../api.ts';

const DEMO = [
  ['Magda – klientka (2 studia)', '500000005'],
  ['Ania – nowa klientka', '500000006'],
  ['Marzena – trenerka', '500000002'],
  ['Kasia – recepcja', '500000004'],
  ['Joanna – właścicielka', '500000001'],
  ['Beata – Flow Kraków', '500000007'],
];

export function Login({ onLoggedIn }: { onLoggedIn: (token: string) => void }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => {
      setNow(new Date());
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const send = async (p = phone) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ resendIn: number; devCode?: string }>('/auth/request-code', { method: 'POST', body: { phone: p }, global: true });
      setStep('code');
      setCooldown(res.resendIn);
      setDevCode(res.devCode ?? null);
      setCode('');
    } catch (e) {
      const err = e as ApiError;
      setError(err.message);
      if (err.code === 'resend_too_soon') {
        setStep('code');
        setCooldown(err.details?.retryIn ?? 60);
      }
    } finally {
      setBusy(false);
    }
  };

  const verify = async (e?: FormEvent, c = code) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>('/auth/verify', { method: 'POST', body: { phone, code: c }, global: true });
      onLoggedIn(res.token);
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.details?.attemptsLeft !== undefined ? `${ae.message} Zostało prób: ${ae.details.attemptsLeft}.` : ae.message);
    } finally {
      setBusy(false);
    }
  };

  const time = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit' }).format(now);

  return (
    <main className="login">
      <div className="login-card stack-lg">
        <div className="center stack gap-2" style={{ paddingBottom: 8 }}>
          <div className="wordmark" aria-label="GLAM">glam</div>
          <div className="serif" style={{ fontSize: '1.35rem' }}>ruch, oddech i chwila dla siebie</div>
          <div className="rule tiny muted" style={{ marginTop: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            {fmtLongDay(now.toISOString())} · {time}
          </div>
        </div>

        <div className="card stack" style={{ padding: 28 }}>
          {step === 'phone' ? (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <h2>Zaloguj się</h2>
              <div className="field">
                <label htmlFor="phone">Numer telefonu</label>
                <input id="phone" className="input" inputMode="tel" autoComplete="tel" placeholder="500 600 700" value={phone} onChange={(e) => setPhone(e.target.value)} required />
                <span className="muted tiny">Wyślemy jednorazowy kod SMS. Bez hasła.</span>
              </div>
              {error && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
              <button className="btn block" disabled={busy || phone.replace(/\D/g, '').length < 9}>
                Wyślij kod
              </button>
            </form>
          ) : (
            <form className="stack" onSubmit={verify}>
              <h2>Wpisz kod z SMS</h2>
              <p className="muted small">
                Wysłałyśmy 6 cyfr na numer {phone}.{' '}
                <button type="button" className="btn ghost sm" onClick={() => setStep('phone')}>
                  Zmień numer
                </button>
              </p>
              <input
                className="input otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                aria-label="Kod SMS"
                autoFocus
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '');
                  setCode(v);
                  if (v.length === 6) verify(undefined, v);
                }}
              />
              {devCode && (
                <p className="tiny muted center">
                  Tryb deweloperski – kod: <b>{devCode}</b>
                </p>
              )}
              {error && <p className="small" style={{ color: 'var(--danger)' }} role="alert">{error}</p>}
              <button className="btn block" disabled={busy || code.length !== 6}>
                Zaloguj
              </button>
              <button type="button" className="btn ghost block" disabled={cooldown > 0 || busy} onClick={() => send()}>
                {cooldown > 0 ? `Wyślij ponownie za ${cooldown} s` : 'Wyślij kod ponownie'}
              </button>
            </form>
          )}
        </div>

        {import.meta.env.DEV && step === 'phone' && (
          <div className="stack">
            <p className="eyebrow center">Konta demo</p>
            <div className="demo-list">
              {DEMO.map(([label, p]) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setPhone(p);
                    send(p);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
