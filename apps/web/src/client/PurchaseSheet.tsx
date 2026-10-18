// Zakup pakietu zajęć: subskrypcja (rok / tydzień) albo jedna płatność, bez odnowienia.
// Studia bez planów z `billing` dostają dotychczasową listę karnetów.
import { Fragment, useEffect, useState } from 'react';
import { classPackagePlans, type Billing } from '@glam/core';
import { api, ApiError, goToCheckout, useApi } from '../api.ts';
import { useLayer } from '../back.ts';
import { Icon } from '../icons.tsx';
import { availableMethods, PAYMENT_LABELS, Pending, Sheet, Spinner, useToast } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';

type Product = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  priceGrosze: number;
  validityDays: number;
  billing: Billing | null;
  lines: string[];
};

const METHODS = ['blik', 'apple_pay', 'google_pay', 'p24', 'card'];

type PurchaseResult = { message: string; checkoutUrl?: string };


const LEGAL = {
  terms: 'Subskrypcja odnawia się sama na koniec okresu, w cenie z tego ekranu. Wyłączysz ją w Profilu – opłacone zajęcia zostają do końca. Zakup jednorazowy kończy się razem z pakietem.',
  privacy: 'Płatność idzie prosto na konto studia. W tej wersji demo bramka jest symulowana i nie zapisujemy danych karty.',
} as const;

export function PurchaseSheet({ reason, onClose, highlight }: { reason?: string; onClose: () => void; highlight?: string[] }) {
  const { data: products, error, reload } = useApi<Product[]>('/products');
  const plans = products ? classPackagePlans(products) : [];

  useLayer(onClose);

  if (!products) {
    return (
      <div className="paywall-overlay">
        <div className="paywall" role="dialog" aria-modal="true" aria-label="Pakiet zajęć">
          <Pending error={error} reload={reload} />
        </div>
      </div>
    );
  }

  if (plans.length === 0) {
    return <PassList products={products} reason={reason} highlight={highlight} onClose={onClose} />;
  }

  return <ClassPackagePaywall products={products} reason={reason} highlight={highlight} onClose={onClose} />;
}

function ClassPackagePaywall({ products, reason, highlight, onClose }: { products: Product[]; reason?: string; highlight?: string[]; onClose: () => void }) {
  const { studio } = useClient();
  const covers = (id: string) => !!highlight?.includes(id);
  // Przy zapisie na zajęcia (highlight) karnety, które je obejmują, idą na samą górę – także te spoza planów.
  const plans = classPackagePlans(products);
  const others = products.filter((p) => !p.billing);
  const coveringOthers = others.filter((p) => covers(p.id));
  const restOthers = others.filter((p) => !covers(p.id));
  const suggested = initialChoice(plans, others, highlight);
  const [choice, setChoice] = useState<{ planId: string | null; extraId: string | null } | null>(null);
  const [showOthers, setShowOthers] = useState(suggested.showOthers);
  const [notice, setNotice] = useState<keyof typeof LEGAL | null>(null);
  const [method, setMethod] = useState('blik');
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const toast = useToast();

  const picked = choice ?? { planId: suggested.planId, extraId: suggested.extraId };
  const plan = plans.find((p) => p.productId === picked.planId) ?? null;
  const extra = others.find((p) => p.id === picked.extraId) ?? null;
  const productId = extra?.id ?? plan?.productId ?? null;
  const subscribing = !extra && !!plan?.autoRenew;
  const limit = products.find((p) => p.billing === 'year')?.lines.find((l) => l.includes('tygodniu'));

  const pay = async () => {
    if (!productId) return;
    setBusy(true);
    try {
      const res = await api<PurchaseResult>('/purchases', { method: 'POST', body: { productId, method, couponCode: coupon || undefined } });
      if (goToCheckout(res)) return;
      toast(res.message);
      window.dispatchEvent(new Event('glam:passes-changed'));
      onClose();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const planCard = (p: (typeof plans)[number]) => {
    const on = !extra && plan?.productId === p.productId;
    return (
      <div key={p.productId} className={`plan-wrap${p.savePct ? ' has-badge' : ''}`}>
        {p.savePct != null && <span className="plan-badge">Oszczędzasz {p.savePct}%</span>}
        <button type="button" role="radio" aria-checked={on} className={`plan-card${covers(p.productId) ? ' is-covering' : ''}${on ? ' is-on' : ''}`} onClick={() => setChoice({ planId: p.productId, extraId: null })}>
          <span className="plan-dot" />
          <span className="plan-copy">
            <b>{p.title}</b>
            {covers(p.productId) ? <CoversMark /> : p.caption && <small>{p.caption}</small>}
          </span>
          <span className="plan-price">
            <b>{p.priceMain}</b>
            {p.priceSub && <small>{p.priceSub}</small>}
          </span>
        </button>
      </div>
    );
  };

  return (
    <div className="paywall-overlay" onClick={onClose}>
      <div className="paywall" role="dialog" aria-modal="true" aria-labelledby="paywall-title" onClick={(e) => e.stopPropagation()}>
        <div className="paywall-hero">
          <svg className="paywall-art" viewBox="0 0 390 520" preserveAspectRatio="xMidYMid slice" aria-hidden>
            <defs>
              <linearGradient id="paywall-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#e9e1d6" />
                <stop offset="1" stopColor="#c4b6a5" />
              </linearGradient>
              <radialGradient id="paywall-sun" cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#fbf8f3" />
                <stop offset="0.6" stopColor="#f3ece2" />
                <stop offset="1" stopColor="#f3ece2" stopOpacity="0" />
              </radialGradient>
              <filter id="paywall-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            <rect width="390" height="520" fill="url(#paywall-sky)" />
            <circle cx="262" cy="150" r="120" fill="url(#paywall-sun)" />
            <g filter="url(#paywall-soft)">
              <path d="M-20 330c80-70 150-96 220-96s130 34 210 96v210H-20z" fill="#b5a796" />
              <path d="M-20 400c90-50 170-70 240-64s120 26 190 64v140H-20z" fill="#9c8b79" />
            </g>
          </svg>
          <button type="button" className="paywall-close" onClick={onClose} aria-label="Zamknij">
            <Icon name="close" size={18} />
          </button>
          <div className="paywall-hero-copy">
            <span className="paywall-badge">
              <Icon name="ticket" size={14} /> {studio.name}
            </span>
            <h2 id="paywall-title" className="paywall-name">
              Pakiet zajęć
              <span className="paywall-check" title="Oferta studia">
                <Icon name="check" size={14} />
              </span>
            </h2>
            {limit && <p className="paywall-meta">{limit}</p>}
          </div>
        </div>

        <p className="paywall-kicker">Wybierz plan</p>
        {reason && <p className="muted small center">{reason}</p>}

        <div className="plan-list" role="radiogroup" aria-label="Wybierz plan">
          {plans.filter((p) => covers(p.productId)).map(planCard)}
          {coveringOthers.map((p) => {
            const on = extra?.id === p.id;
            return (
              <div key={p.id} className="plan-wrap">
                <button type="button" role="radio" aria-checked={on} className={`plan-card is-covering${on ? ' is-on' : ''}`} onClick={() => setChoice({ planId: null, extraId: p.id })}>
                  <span className="plan-dot" />
                  <span className="plan-copy">
                    <b>{p.name}</b>
                    <CoversMark />
                  </span>
                  <span className="plan-price">
                    <b>{p.price}</b>
                    <small>bez odnowienia</small>
                  </span>
                </button>
              </div>
            );
          })}
          {plans.filter((p) => !covers(p.productId)).map(planCard)}
        </div>

        {extra && !covers(extra.id) && <p className="center small" style={{ margin: '12px 0 0' }}>{extra.name}</p>}

        <div className="paywall-options">
          <button type="button" aria-expanded={payOpen} onClick={() => setPayOpen((v) => !v)}>
            {PAYMENT_LABELS[method]} · <u>zmień</u>
          </button>
          <span aria-hidden>·</span>
          <button type="button" aria-expanded={codeOpen} onClick={() => setCodeOpen((v) => !v)}>
            {coupon ? `Kod: ${coupon}` : 'Masz kod rabatowy?'}
          </button>
        </div>

        {payOpen && (
          <div className="chips paywall-methods" role="group" aria-label="Płatność">
            {availableMethods(METHODS).map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={method === m} onClick={() => { setMethod(m); setPayOpen(false); }}>
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
        )}

        {codeOpen && (
          <input className="input paywall-code" placeholder="Kod rabatowy" value={coupon} onChange={(e) => setCoupon(e.target.value)} aria-label="Kod rabatowy" autoFocus />
        )}

        <button className="btn paywall-cta" disabled={busy || !productId} onClick={pay}>
          {subscribing ? 'Subskrybuj' : 'Kup raz'}
        </button>
        <p className="paywall-cancel">{subscribing ? 'Anuluj kiedy chcesz' : 'Płatność jednorazowa, bez odnowienia'}</p>

        {notice && <p className="paywall-note">{LEGAL[notice]}</p>}

        <div className="paywall-legal">
          <button type="button" onClick={() => setNotice(notice === 'terms' ? null : 'terms')}>
            Regulamin
          </button>
          <span aria-hidden>|</span>
          <button type="button" onClick={() => setNotice(notice === 'privacy' ? null : 'privacy')}>
            Polityka prywatności
          </button>
          <span aria-hidden>|</span>
          <button type="button" onClick={() => setShowOthers((v) => !v)}>
            Zakupy
          </button>
        </div>
        <p className="tiny muted center" style={{ marginTop: 10 }}>
          Wersja demo: płatność jest symulowana.
        </p>

        {showOthers && (
          <div className="stack" style={{ marginTop: 16 }}>
            <div className="eyebrow center">Inne karnety, bez subskrypcji</div>
            {restOthers.length === 0 && <p className="muted small center">To studio nie ma innych karnetów.</p>}
            {restOthers.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`card flat ${extra?.id === p.id ? 'soft' : ''}`}
                style={{ textAlign: 'left', cursor: 'pointer' }}
                onClick={() => setChoice({ planId: null, extraId: p.id })}
              >
                <div className="row between">
                  <span className="card-title">{p.name}</span>
                  <b>{p.price}</b>
                </div>
                <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {p.lines.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Znacznik „ten karnet obejmuje zajęcia, na które się zapisujesz”. */
function CoversMark() {
  return (
    <small className="covers-mark">
      <Icon name="check" size={12} /> Obejmuje te zajęcia
    </small>
  );
}

function initialChoice(plans: ReturnType<typeof classPackagePlans>, others: Product[], highlight?: string[]) {
  const fromPlan = plans.find((p) => highlight?.includes(p.productId));
  if (fromPlan) return { planId: fromPlan.productId, extraId: null as string | null, showOthers: false };
  const fromOther = others.find((p) => highlight?.includes(p.id));
  if (fromOther) return { planId: null as string | null, extraId: fromOther.id, showOthers: false };
  const best = plans.find((p) => p.savePct) ?? plans[0];
  return { planId: best?.productId ?? null, extraId: null as string | null, showOthers: false };
}

function PassList({ products, reason, highlight, onClose }: { products: Product[]; reason?: string; highlight?: string[]; onClose: () => void }) {
  const [chosen, setChosen] = useState<Product | null>(null);
  // Karnety obejmujące zajęcia, na które ktoś się zapisuje, na górze listy (sort jest stabilny – reszta w kolejności studia).
  const sorted = [...products].sort((a, b) => Number(!!highlight?.includes(b.id)) - Number(!!highlight?.includes(a.id)));
  const [method, setMethod] = useState('blik');
  const [busy, setBusy] = useState(false);
  const [coupon, setCoupon] = useState('');
  const toast = useToast();

  const pay = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      const res = await api<PurchaseResult>('/purchases', { method: 'POST', body: { productId: chosen.id, method, couponCode: coupon || undefined } });
      if (goToCheckout(res)) return;
      toast(res.message);
      window.dispatchEvent(new Event('glam:passes-changed'));
      onClose();
    } catch (e) {
      toast((e as ApiError).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet onClose={onClose} label="Kup karnet">
      {!chosen ? (
        <div className="stack">
          <h2>Wybierz karnet</h2>
          {reason && <p className="muted small">{reason}</p>}
          {sorted.map((p, i) => (
            <Fragment key={p.id}>
            {i > 0 && !highlight?.includes(p.id) && highlight?.includes(sorted[i - 1].id) && <div className="eyebrow" style={{ marginTop: 8 }}>Pozostałe karnety</div>}
            <button className={`card flat ${highlight?.includes(p.id) ? 'pass-covering' : ''}`} style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setChosen(p)}>
              <div className="row between">
                <span className="card-title">{p.name}</span>
                <b>{p.price}</b>
              </div>
              {highlight?.includes(p.id) && <CoversMark />}
              <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {p.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </button>
            </Fragment>
          ))}
        </div>
      ) : (
        <div className="stack">
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setChosen(null)}>
            ← Wróć
          </button>
          <h2>{chosen.name}</h2>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {chosen.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow">Płatność</legend>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {availableMethods(METHODS).map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </fieldset>
          <input className="input" placeholder="Kod rabatowy (opcjonalnie)" value={coupon} onChange={(e) => setCoupon(e.target.value)} aria-label="Kod rabatowy" />
          <p className="tiny muted">Wersja demo: płatność jest symulowana. Nie przechowujemy danych kart.</p>
          <button className="btn block" disabled={busy} onClick={pay}>
            Kup raz · {chosen.price}
          </button>
        </div>
      )}
    </Sheet>
  );
}
