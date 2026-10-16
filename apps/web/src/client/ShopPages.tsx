// Sklep studia (4.8.1): merch z rozmiarami i stanem, rezerwacja do odbioru (płatność na miejscu) albo zakup z wysyłką;
// moje zamówienia; partnerzy studia (4.8.3).
import { useEffect, useRef, useState } from 'react';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, PAYMENT_LABELS, Sheet, Spinner, useAction } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

type Product = { id: string; name: string; description: string | null; price: string; priceGrosze: number; status: string; photoUrl: string | null; variants: { id: string; label: string; stock: number }[] };

export default function ShopPages({ route, arg }: RouteProps) {
  if (route === 'orders') return <Orders />;
  if (route === 'partners') return <Partners />;
  return <Shop productId={arg} />;
}

/** productId – link „Kup teraz” ze strony studia (/app?go=shop/:id) od razu otwiera zakup tego produktu. */
function Shop({ productId }: { productId: string | null }) {
  const { open } = useClient();
  const shop = useApi<{ settings: { reservationDays: number; shipping: boolean; shippingPrice: string }; products: Product[] }>('/shop');
  const [pick, setPick] = useState<Product | null>(null);
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !productId || !shop.data) return;
    linked.current = true;
    const p = shop.data.products.find((x) => x.id === productId);
    if (p && p.status !== 'sold_out') setPick(p);
  }, [productId, shop.data]);
  if (shop.error?.code === 'feature_off') return <Empty>Studio nie prowadzi sklepu w aplikacji.</Empty>;
  if (!shop.data) return <Spinner />;
  return (
    <div className="stack-lg">
      <div className="grid-2" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {shop.data.products.map((p) => (
          <button key={p.id} className="card stack" style={{ padding: 12, gap: 6, textAlign: 'left', cursor: 'pointer', opacity: p.status === 'sold_out' ? 0.55 : 1 }} onClick={() => setPick(p)}>
            <div style={{ aspectRatio: '1', borderRadius: 14, background: 'var(--soft)', overflow: 'hidden' }}>{p.photoUrl && <img src={p.photoUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}</div>
            <b className="small">{p.name}</b>
            <span className="small">{p.status === 'sold_out' ? 'wyprzedane' : p.price}</span>
          </button>
        ))}
      </div>
      <div className="row">
        <button className="btn ghost" onClick={() => open('orders')}>
          Moje zamówienia
        </button>
        <button className="btn ghost" onClick={() => open('partners')}>
          Partnerzy studia
        </button>
      </div>
      <p className="tiny muted">Rezerwacja do odbioru: płacisz w recepcji, sztuka czeka {shop.data.settings.reservationDays} dni. Paragon lub fakturę za produkty wystawia studio.</p>
      {pick && <BuySheet product={pick} settings={shop.data.settings} onClose={() => setPick(null)} onDone={shop.reload} />}
    </div>
  );
}

function BuySheet({ product, settings, onClose, onDone }: { product: Product; settings: { reservationDays: number; shipping: boolean; shippingPrice: string }; onClose: () => void; onDone: () => void }) {
  const { me, open } = useClient();
  const inStock = product.variants.filter((v) => v.stock > 0);
  const [variant, setVariant] = useState(inStock[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [kind, setKind] = useState<'pickup' | 'online'>('pickup');
  const [method, setMethod] = useState('blik');
  const { run, busy } = useAction();
  return (
    <Sheet onClose={onClose} label={product.name}>
      <div className="stack">
        {product.photoUrl && <img src={product.photoUrl} alt="" style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 18 }} />}
        <h2>{product.name}</h2>
        {product.description && <p className="small muted">{product.description}</p>}
        <div className="pill-row">
          {product.variants.map((v) => (
            <button key={v.id} className="chip" disabled={v.stock === 0} aria-pressed={variant === v.id} onClick={() => setVariant(v.id)}>
              {v.label} {v.stock === 0 ? '· brak' : v.stock <= 2 ? `· ostatnie ${v.stock}` : ''}
            </button>
          ))}
        </div>
        <div className="row">
          <button className="btn ghost sm" onClick={() => setQty(Math.max(1, qty - 1))}>
            −
          </button>
          <b>{qty}</b>
          <button className="btn ghost sm" onClick={() => setQty(Math.min(10, qty + 1))}>
            +
          </button>
        </div>
        <div className="segmented">
          <button aria-pressed={kind === 'pickup'} onClick={() => setKind('pickup')}>
            Odbiór w studiu
          </button>
          {settings.shipping && (
            <button aria-pressed={kind === 'online'} onClick={() => setKind('online')}>
              Wysyłka (+{settings.shippingPrice})
            </button>
          )}
        </div>
        {kind === 'online' && (
          <>
            {!me.user.hasAddress && (
              <p className="small">
                Potrzebujemy adresu.{' '}
                <button className="link" onClick={() => open('settings')}>
                  Dodaj adres
                </button>
              </p>
            )}
            <div className="pill-row">
              {['blik', 'apple_pay', 'google_pay', 'p24', 'card'].map((m) => (
                <button key={m} className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </>
        )}
        <button
          className="btn block"
          disabled={!variant || busy}
          onClick={() =>
            run(() =>
              api<{ message: string }>('/shop/orders', { method: 'POST', body: { kind, method: kind === 'online' ? method : undefined, items: [{ productId: product.id, variantId: variant, qty }] } }).then((r) => {
                onDone();
                onClose();
                return r;
              }),
            )
          }
        >
          {kind === 'pickup' ? `Zarezerwuj (zapłacisz na miejscu)` : 'Zapłać i zamów'}
        </button>
      </div>
    </Sheet>
  );
}

function Orders() {
  const orders = useApi<{ id: string; kind: string; status: string; items: { name: string; variant: string; qty: number }[]; total: string; expires_at: string | null; created_at: string }[]>('/my/orders');
  const { run } = useAction();
  const STATUS: Record<string, string> = { reserved: 'zarezerwowane', ready: 'czeka w recepcji', paid: 'opłacone', shipped: 'wysłane', collected: 'odebrane', cancelled: 'anulowane', expired: 'rezerwacja wygasła' };
  if (!orders.data) return <Spinner />;
  return (
    <div className="stack">
      {orders.data.length === 0 && <Empty>Brak zamówień.</Empty>}
      {orders.data.map((o) => (
        <div key={o.id} className="card flat stack" style={{ gap: 6 }}>
          <div className="row between">
            <b>{o.items.map((i) => `${i.name} (${i.variant}) × ${i.qty}`).join(', ')}</b>
            <span className="badge">{STATUS[o.status] ?? o.status}</span>
          </div>
          <div className="row between small muted">
            <span>
              {fmtDay(o.created_at)} · {o.total} {o.expires_at && ['reserved', 'ready'].includes(o.status) && `· odbiór do ${o.expires_at.split('-').reverse().join('.')}`}
            </span>
            {['reserved', 'ready'].includes(o.status) && o.kind === 'pickup' && (
              <button className="link tiny" onClick={() => run(() => api(`/my/orders/${o.id}/cancel`, { method: 'POST' }).then((r) => (orders.reload(), r)))}>
                anuluj
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Partners() {
  const list = useApi<{ id: string; name: string; category: string; description: string | null; perk: string; code: string | null; url: string | null }[]>('/partners');
  if (!list.data) return <Spinner />;
  return (
    <div className="stack">
      {list.data.length === 0 && <Empty>Studio nie ma jeszcze partnerów.</Empty>}
      {list.data.map((p) => (
        <div key={p.id} className="card flat stack" style={{ gap: 6 }}>
          <div className="eyebrow">{p.category}</div>
          <b>{p.name}</b>
          {p.description && <span className="small muted">{p.description}</span>}
          <span className="small">{p.perk}</span>
          <div className="row between">
            {p.code ? <span className="code">{p.code}</span> : <span />}
            {p.url && (
              <a className="small" href={p.url} target="_blank" rel="noreferrer">
                Strona ↗
              </a>
            )}
          </div>
        </div>
      ))}
      <p className="tiny muted">Partnerów weryfikuje studio.</p>
    </div>
  );
}
