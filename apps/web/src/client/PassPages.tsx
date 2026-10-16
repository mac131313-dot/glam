// Karnety (4.2): stan, zawieszenie (urlop, choroba, ciąża), odnawianie, historia; płatności i faktury na życzenie.
import { useState } from 'react';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Field, PAYMENT_LABELS, Sheet, Spinner, Toggle, useAction } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

type Pass = {
  id: string;
  productName: string;
  status: string;
  source: string;
  validUntil: string;
  summary: string;
  lines: string[];
  autoRenew: boolean;
  canAutoRenew: boolean;
  expiringSoon: boolean;
  guestsPerMonth: number;
  waitingActivation: boolean;
  freeze: { left: number; daysLeft: number; current: { date_from: string; date_to: string } | null };
};

const STATUS: Record<string, string> = { active: 'aktywny', used: 'wykorzystany', expired: 'wygasł', frozen: 'zawieszony', pending: 'czeka' };
const SOURCE: Record<string, string> = { purchase: 'kupiony w aplikacji', desk: 'kupiony w recepcji', guest_pass: 'prezent od znajomej', referral: 'z polecenia', reward: 'nagroda', renewal: 'odnowienie', import: 'przeniesiony', test: 'testowy' };
const REASONS: [string, string][] = [
  ['vacation', 'Urlop'],
  ['illness', 'Choroba'],
  ['pregnancy', 'Ciąża'],
  ['loss', 'Trudny czas'],
  ['other', 'Inny powód'],
];

export default function PassPages({ route }: RouteProps) {
  return route === 'payments' ? <Payments /> : <Passes />;
}

function Passes() {
  const { openShop, open } = useClient();
  const passes = useApi<Pass[]>('/my/passes');
  const recurring = useApi<{ id: string; weekday: number; start_time: string; class_name: string; trainer_name: string }[]>('/my/recurring');
  const [freeze, setFreeze] = useState<Pass | null>(null);
  const { run } = useAction();
  if (!passes.data) return <Spinner />;
  return (
    <div className="stack-lg">
      <div className="row between">
        <span className="muted small">Karnety w tym studiu</span>
        <button className="btn sm" onClick={() => openShop()}>
          Kup karnet
        </button>
      </div>
      {passes.data.length === 0 && <Empty>Nie masz jeszcze karnetu w tym studiu.</Empty>}
      {passes.data.map((p) => (
        <section key={p.id} className={`card ${p.status === 'active' ? 'soft' : 'flat'} stack`} style={{ gap: 10 }}>
          <div className="row between">
            <span className="card-title">{p.productName}</span>
            <span className={`badge ${p.status === 'active' ? 'ok' : ''}`}>{STATUS[p.status] ?? p.status}</span>
          </div>
          <div className="small">{p.summary}</div>
          {p.waitingActivation && <div className="tiny muted">Ważność liczy się od pierwszego wejścia.</div>}
          <ul className="tiny muted" style={{ margin: 0, paddingLeft: 18 }}>
            {p.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <div className="tiny muted">{SOURCE[p.source] ?? p.source}</div>
          {p.freeze.current && (
            <div className="small">
              Zawieszony: {p.freeze.current.date_from} – {p.freeze.current.date_to}
            </div>
          )}
          {(p.status === 'active' || p.status === 'frozen') && (
            <div className="stack" style={{ gap: 4 }}>
              {p.canAutoRenew && (
                <Toggle
                  label="Odnawiaj automatycznie"
                  hint="Wyłączenie nie skraca opłaconego czasu"
                  checked={p.autoRenew}
                  onChange={(v) => run(() => api(`/passes/${p.id}`, { method: 'PATCH', body: { autoRenew: v } }).then((r) => (passes.reload(), r)))}
                />
              )}
              <div className="row wrap">
                {p.status === 'active' && p.freeze.left > 0 && !p.freeze.current && (
                  <button className="btn ghost sm" onClick={() => setFreeze(p)}>
                    Zawieś karnet
                  </button>
                )}
                {p.expiringSoon && (
                  <button className="btn sm" onClick={() => openShop('Przedłuż karnet, żeby nie stracić rytmu.')}>
                    Przedłuż
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      ))}

      {recurring.data && recurring.data.length > 0 && (
        <section className="stack">
          <div className="eyebrow">Stałe rezerwacje</div>
          {recurring.data.map((r) => (
            <div key={r.id} className="row between card flat">
              <span className="small">
                <b>{r.class_name}</b> · {['', 'pn', 'wt', 'śr', 'czw', 'pt', 'sob', 'nd'][r.weekday]} {r.start_time} · {r.trainer_name}
              </span>
              <button className="btn ghost sm" onClick={() => run(() => api(`/recurring/${r.id}`, { method: 'DELETE' }).then((x) => (recurring.reload(), x)))}>
                Wyłącz
              </button>
            </div>
          ))}
        </section>
      )}

      <button className="btn ghost" onClick={() => open('payments')}>
        Historia płatności
      </button>
      {freeze && <FreezeSheet pass={freeze} onClose={() => setFreeze(null)} onDone={passes.reload} />}
    </div>
  );
}

function FreezeSheet({ pass, onClose, onDone }: { pass: Pass; onClose: () => void; onDone: () => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(new Date(Date.now() + 13 * 86_400_000).toISOString().slice(0, 10));
  const [reason, setReason] = useState('vacation');
  const [support, setSupport] = useState(false);
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label="Zawieś karnet">
      <div className="stack">
        <h2>Zawieś {pass.productName}</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Ważność przesunie się o liczbę dni zawieszenia. Zostało Ci: {pass.freeze.left} × zawieszenie, łącznie {pass.freeze.daysLeft} dni.
        </p>
        <div className="row">
          <Field label="Od">
            <input className="input" type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Do">
            <input className="input" type="date" min={from} value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        <div className="pill-row">
          {REASONS.map(([v, l]) => (
            <button key={v} className="chip" aria-pressed={reason === v} onClick={() => setReason(v)}>
              {l}
            </button>
          ))}
        </div>
        <Toggle label="Chcę dostać od studia kilka ciepłych słów" hint="Tylko jeśli tego chcesz – po 7 dniach. Nie wyciągamy wniosków z powodu zawieszenia." checked={support} onChange={setSupport} />
        <button
          className="btn block"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const r = await api<{ message: string }>(`/passes/${pass.id}/freeze`, { method: 'POST', body: { from, to, reason, wantsSupport: support } });
              onDone();
              onClose();
              return r;
            })
          }
        >
          Zawieś
        </button>
      </div>
    </Sheet>
  );
}

function Payments() {
  const { me } = useClient();
  const payments = useApi<{ id: string; kind: string; amount: string; discount: string | null; method: string; created_at: string; description: string | null; invoiceUrl: string | null; number: string | null }[]>('/my/payments');
  const [inv, setInv] = useState<string | null>(null);
  const [name, setName] = useState(me.user.name ?? '');
  const [nip, setNip] = useState('');
  const [address, setAddress] = useState('');
  const { run, busy } = useAction();
  if (!payments.data) return <Spinner />;
  return (
    <div className="stack">
      {payments.data.length === 0 && <Empty>Tu pojawią się Twoje płatności.</Empty>}
      {payments.data.map((p) => (
        <div key={p.id} className="card flat stack" style={{ gap: 6 }}>
          <div className="row between">
            <b>{p.description ?? p.kind}</b>
            <b>{p.amount}</b>
          </div>
          <div className="row between tiny muted">
            <span>
              {fmtDay(p.created_at)} · {PAYMENT_LABELS[p.method] ?? p.method}
              {p.discount && ` · rabat ${p.discount}`}
            </span>
            {p.invoiceUrl ? (
              <a href={p.invoiceUrl} target="_blank" rel="noreferrer" onClick={(e) => openAuthed(e, p.invoiceUrl!)}>
                Faktura {p.number}
              </a>
            ) : p.kind !== 'shop' ? (
              <button className="link tiny" onClick={() => setInv(p.id)}>
                Poproś o fakturę
              </button>
            ) : (
              <span>dokument wystawia studio</span>
            )}
          </div>
        </div>
      ))}
      {inv && (
        <Sheet onClose={() => setInv(null)} label="Faktura">
          <div className="stack">
            <h2>Dane do faktury</h2>
            <Field label="Imię i nazwisko albo firma">
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="NIP (jeśli na firmę)">
              <input className="input" value={nip} onChange={(e) => setNip(e.target.value)} />
            </Field>
            <Field label="Adres">
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </Field>
            <button
              className="btn block"
              disabled={!name.trim() || busy}
              onClick={() =>
                run(async () => {
                  await api(`/payments/${inv}/invoice`, { method: 'POST', body: { name, nip: nip || undefined, address: address || undefined } });
                  setInv(null);
                  payments.reload();
                }, 'Faktura gotowa')
              }
            >
              Wystaw fakturę
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

/** Faktura to strona HTML do druku – otwieramy ją z tokenem i nagłówkiem studia. */
export async function openAuthed(e: React.MouseEvent, url: string) {
  e.preventDefault();
  const { session } = await import('../api.ts');
  const res = await fetch(url, { headers: { authorization: `Bearer ${session.token}`, 'x-studio-id': session.studioId ?? '' } });
  const html = await res.text();
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }
}
