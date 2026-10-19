// Sklep i zamówienia (Profil recepcji): odbiory w studiu i wysyłki – te same statusy co w panelu
// (Sklep → Zamówienia i odbiory). Najpierw to, co czeka na recepcję; zamknięte niżej.
import { useState } from 'react';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Page, PAYMENT_LABELS, Pending, Sheet, useAction } from '../ui.tsx';

type Order = { id: string; kind: string; status: string; items: { name: string; variant: string; qty: number }[]; total: string; method: string | null; expires_at: string | null; created_at: string; name: string | null; address: { line: string; city: string; zip: string } | null };

const STATUS: Record<string, string> = { reserved: 'zarezerwowane', ready: 'czeka w recepcji', paid: 'do wysyłki', shipped: 'wysłane', collected: 'odebrane', cancelled: 'anulowane', expired: 'wygasłe' };
const OPEN = ['reserved', 'ready', 'paid'];

export function ShopOrdersPage({ onBack }: { onBack: () => void }) {
  const shop = useApi<{ orders: Order[] }>('/staff/shop');
  const { run, busy } = useAction();
  const [collect, setCollect] = useState<Order | null>(null);
  // Anulowanie zwalnia towar na półkę – na telefonie łatwo trafić przypadkiem, więc pytamy.
  const [cancel, setCancel] = useState<Order | null>(null);
  const set = (o: Order, status: string, method?: string) => run(() => api(`/staff/shop/orders/${o.id}`, { method: 'POST', body: { status, method } }).then(shop.reload));

  const orders = shop.data?.orders ?? [];
  const open = orders.filter((o) => OPEN.includes(o.status));
  const done = orders.filter((o) => !OPEN.includes(o.status));

  const card = (o: Order) => (
    <section key={o.id} className={`card ${OPEN.includes(o.status) ? '' : 'flat'} stack gap-2`}>
      <div className="row between">
        <b>{o.name ?? 'Sprzedaż przy ladzie'}</b>
        <span className={`badge ${o.status === 'ready' ? 'ok' : ''}`}>{STATUS[o.status] ?? o.status}</span>
      </div>
      <div className="small">
        {o.items.map((i) => `${i.name}${i.variant ? ` (${i.variant})` : ''} × ${i.qty}`).join(', ')} · <b>{o.total}</b>
      </div>
      <div className="tiny muted">
        {o.kind === 'pickup' ? `odbiór w studiu${o.expires_at ? ` do ${o.expires_at}` : ''}` : o.kind === 'online' ? 'wysyłka' : 'kasa'} · {fmtDay(o.created_at)}
        {o.method && ` · ${PAYMENT_LABELS[o.method] ?? o.method}`}
      </div>
      {o.address && (
        <div className="tiny">
          {o.address.line}, {o.address.zip} {o.address.city}
        </div>
      )}
      {OPEN.includes(o.status) && (
        <div className="row gap-2 wrap">
          {o.status === 'reserved' && (
            <button className="btn sm" disabled={busy} onClick={() => set(o, 'ready')}>
              Gotowe do odbioru
            </button>
          )}
          {(o.status === 'reserved' || o.status === 'ready') && (
            <button className="btn sm" disabled={busy} onClick={() => setCollect(o)}>
              Odebrane
            </button>
          )}
          {o.status === 'paid' && (
            <button className="btn sm" disabled={busy} onClick={() => set(o, 'shipped')}>
              Wysłane
            </button>
          )}
          <button className="btn ghost sm" disabled={busy} onClick={() => setCancel(o)}>
            Anuluj
          </button>
        </div>
      )}
    </section>
  );

  return (
    <Page title="Sklep i zamówienia" onBack={onBack}>
      {shop.error?.code === 'feature_off' ? (
        <Empty>Sklep nie jest włączony w planie studia.</Empty>
      ) : !shop.data ? (
        <Pending error={shop.error} reload={shop.reload} />
      ) : orders.length === 0 ? (
        <Empty>Brak zamówień.</Empty>
      ) : (
        <div className="stack-lg">
          <section className="stack gap-3">
            <div className="eyebrow" style={{ margin: 0 }}>Do zrobienia · {open.length}</div>
            {open.length ? open.map(card) : <p className="small muted" style={{ margin: 0 }}>Wszystko wydane i wysłane.</p>}
          </section>
          {done.length > 0 && (
            <section className="stack gap-3">
              <div className="eyebrow" style={{ margin: 0 }}>Zakończone</div>
              {done.map(card)}
            </section>
          )}
        </div>
      )}
      {cancel && (
        <Sheet onClose={() => setCancel(null)} label="Anulowanie zamówienia">
          <div className="stack">
            <h2>Anulować zamówienie?</h2>
            <p className="small muted" style={{ margin: 0 }}>
              {cancel.name ?? 'Sprzedaż przy ladzie'} · {cancel.total}. Produkty wrócą do sprzedaży.
            </p>
            <button className="btn block" disabled={busy} onClick={() => (set(cancel, 'cancelled'), setCancel(null))}>
              Tak, anuluj
            </button>
            <button className="btn ghost block" onClick={() => setCancel(null)}>
              Zostaw
            </button>
          </div>
        </Sheet>
      )}
      {collect && (
        <Sheet onClose={() => setCollect(null)} label="Odbiór">
          <div className="stack">
            <h2>Jak klientka zapłaciła?</h2>
            <p className="small muted">Zapisujemy tylko ewidencję do raportu – dokument sprzedaży wystawia studio.</p>
            {(['terminal', 'cash'] as const).map((m) => (
              <button key={m} className="btn ghost block" onClick={() => (set(collect, 'collected', m), setCollect(null))}>
                {PAYMENT_LABELS[m]}
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </Page>
  );
}
