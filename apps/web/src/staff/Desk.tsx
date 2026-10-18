// Kasa recepcji (4.11, V2, V5, 4.8.1): wejściówka dla znajomej sprzedana przy ladzie (gotówka / terminal,
// wydruk albo SMS), sprzedaż merchu bez konta w aplikacji, raport wejściówek. Karnet dla klientki – w karcie klientki.
import { useState } from 'react';
import { api, fmtDay, useApi } from '../api.ts';
import { PAYMENT_LABELS, QrCode, Spinner, Tabs, useAction } from '../ui.tsx';

type Variant = { id: string; label: string; price: string };

export function Desk() {
  const [tab, setTab] = useState<'guest' | 'shop' | 'report'>('guest');
  return (
    <div className="stack-lg" style={{ maxWidth: 760 }}>
      <div>
        <h1>Kasa i wejściówki</h1>
        <p className="muted" style={{ margin: 0 }}>Aplikacja zapisuje sprzedaż do raportu – nie wystawia paragonu. Rozliczenie zostaje po stronie studia.</p>
      </div>
      <Tabs
        label="Kasa"
        value={tab}
        onChange={setTab}
        options={[
          ['guest', 'Wejściówka dla znajomej'],
          ['shop', 'Sprzedaż przy ladzie'],
          ['report', 'Raport wejściówek'],
        ]}
      />
      {tab === 'guest' && <GuestPassSale />}
      {tab === 'shop' && <ShopSale />}
      {tab === 'report' && <GuestReport />}
    </div>
  );
}

function GuestPassSale() {
  const studio = useApi<{ guestPassVariants: Variant[] }>('/studio');
  const [variant, setVariant] = useState('');
  const [phone, setPhone] = useState('');
  const [method, setMethod] = useState<'cash' | 'terminal'>('terminal');
  const [sold, setSold] = useState<{ code: string; variant: string; price: string } | null>(null);
  const { run, busy } = useAction();
  if (!studio.data) return <Spinner />;
  const v = variant || studio.data.guestPassVariants[0]?.id;
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="pill-row">
          {studio.data.guestPassVariants.map((x) => (
            <button key={x.id} className="chip" aria-pressed={v === x.id} onClick={() => setVariant(x.id)}>
              {x.label} · {x.price}
            </button>
          ))}
        </div>
        <div className="field">
          <span className="field-label">Numer obdarowanej (opcjonalnie – wyślemy SMS)</span>
          <input className="input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="500 600 700" />
        </div>
        <div className="chips">
          {(['terminal', 'cash'] as const).map((m) => (
            <button key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
              {PAYMENT_LABELS[m]}
            </button>
          ))}
        </div>
        <button
          className="btn"
          disabled={busy}
          onClick={() => run(async () => {
            const r = await api<{ code: string; variant: string; price: string }>('/staff/guest-passes', { method: 'POST', body: { recipientPhone: phone || undefined, method, variantId: v } });
            setSold(r);
            setPhone('');
          })}
        >
          Wygeneruj wejściówkę
        </button>
      </section>
      {sold && (
        <section className="card soft stack center printable">
          <div className="eyebrow">{sold.variant} · {sold.price}</div>
          <QrCode text={`${location.origin}/app?wejsciowka=${sold.code}`} size={170} label="QR wejściówki" />
          <div className="code" style={{ fontSize: '2rem', fontWeight: 500 }}>{sold.code}</div>
          <p className="small muted" style={{ margin: 0 }}>Wydrukuj albo podyktuj. Znajoma aktywuje kod w aplikacji swoim numerem telefonu.</p>
          <button className="btn ghost" onClick={() => window.print()}>
            Drukuj
          </button>
        </section>
      )}
    </div>
  );
}

function ShopSale() {
  const shop = useApi<{ products: { id: string; name: string; price: string; status: string; categoryLabel: string; variants: { id: string; label: string; stock: number | null }[] }[] }>('/staff/shop');
  const [items, setItems] = useState<{ productId: string; variantId: string; qty: number; label: string }[]>([]);
  const [method, setMethod] = useState<'cash' | 'terminal'>('terminal');
  const { run, busy } = useAction();
  if (shop.error) return <p className="muted">Sklep jest wyłączony w tym studiu.</p>;
  if (!shop.data) return <Spinner />;
  const sale = shop.data.products.filter((p) => p.status === 'available');
  return (
    <div className="stack">
      {sale.map((p) => (
        <div key={p.id} className="row between card flat">
          <span>
            <b>{p.name}</b> · {p.price}
            <span className="tiny muted" style={{ display: 'block' }}>{p.categoryLabel}</span>
          </span>
          <span className="row gap-1" style={{ flexWrap: 'wrap' }}>
            {p.variants.map((v) => (
              <button key={v.id} className="chip" disabled={v.stock === 0} onClick={() => setItems([...items, { productId: p.id, variantId: v.id, qty: 1, label: `${p.name} (${v.label})` }])}>
                + {v.label} ({v.stock === null ? '∞' : v.stock})
              </button>
            ))}
          </span>
        </div>
      ))}
      {items.length > 0 && (
        <section className="card soft stack">
          {items.map((i, k) => (
            <div key={k} className="row between small">
              <span>{i.label}</span>
              <button className="link tiny" onClick={() => setItems(items.filter((_, x) => x !== k))}>
                usuń
              </button>
            </div>
          ))}
          <div className="chips">
            {(['terminal', 'cash'] as const).map((m) => (
              <button key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
          <button className="btn" disabled={busy} onClick={() => run(() => api('/staff/shop/sell', { method: 'POST', body: { items, method } }).then((r) => (setItems([]), shop.reload(), r)))}>
            Zapisz sprzedaż
          </button>
        </section>
      )}
    </div>
  );
}

function GuestReport() {
  const list = useApi<{ code: string; status: string; channel: string; variant: string; recipient_phone: string | null; created_at: string; buyer: string | null; activated_by: string | null }[]>('/staff/guest-passes');
  if (!list.data) return <Spinner />;
  const by = (s: string) => list.data!.filter((g) => g.status === s).length;
  return (
    <div className="stack">
      <div className="kpis">
        <div className="card kpi">
          <div className="eyebrow">Sprzedane</div>
          <div className="value">{list.data.length}</div>
          <div className="small muted">aplikacja {list.data.filter((g) => g.channel === 'app').length} · kasa {list.data.filter((g) => g.channel === 'desk').length}</div>
        </div>
        <div className="card kpi">
          <div className="eyebrow">Aktywowane</div>
          <div className="value">{by('activated') + by('used')}</div>
          <div className="small muted">wygasłe {by('expired')}</div>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Kod</th>
            <th>Kanał</th>
            <th>Kupiła</th>
            <th>Odebrała</th>
            <th>Status</th>
            <th>Data</th>
          </tr>
        </thead>
        <tbody>
          {list.data.map((g) => (
            <tr key={g.code}>
              <td className="code">{g.code}</td>
              <td>{g.channel === 'app' ? 'aplikacja' : 'kasa'}</td>
              <td>{g.buyer ?? '—'}</td>
              <td>{g.activated_by ?? g.recipient_phone ?? '—'}</td>
              <td>{g.status}</td>
              <td className="muted">{fmtDay(g.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
