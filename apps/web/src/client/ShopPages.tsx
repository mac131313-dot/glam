// Sklep studia (4.8.1): katalog jak butikowa szafka (wyszukiwanie, kategorie, siatka zdjęć), strona produktu
// z galerią i opcjonalnym makro napoju, rezerwacja do odbioru albo wysyłka; zamówienia i partnerzy.
import { useMemo, useRef, useState } from 'react';
import { nutritionHighlight, nutritionRows, SHOP_CATEGORIES, type Nutrition } from '@glam/core';
import { api, fmtDay, goToCheckout, useApi } from '../api.ts';
import { Icon } from '../icons.tsx';
import { Empty, ListRow, availableMethods, PAYMENT_LABELS, Sheet, Spinner, useAction } from '../ui.tsx';
import { useClient } from './ClientApp.tsx';
import type { RouteProps } from './router.tsx';

export type ShopPhoto = { id: string; url: string };
export type ShopVariant = {
  id: string;
  size?: string | null;
  color?: string | null;
  stock: number | null;
  label: string;
  price: string;
  priceGrosze: number | null;
  hint: string | null;
};
export type ShopProduct = {
  id: string;
  category: string;
  categoryLabel: string;
  name: string;
  description: string | null;
  price: string;
  priceGrosze: number;
  status: string;
  sizeScale: string;
  sizeName: string | null;
  variants: ShopVariant[];
  photos: ShopPhoto[];
  photoUrl: string | null;
  nutrition: Nutrition | null;
  featured: boolean;
};
type ShopData = { settings: { reservationDays: number; shipping: boolean; shippingPrice: string }; products: ShopProduct[] };

const CATS = [{ id: 'all', label: 'Wszystko' }, { id: 'featured', label: 'Wyróżnione' }, ...SHOP_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))] as const;

const inStock = (v: Pick<ShopVariant, 'stock'>) => v.stock === null || v.stock > 0;

export default function ShopPages({ route, arg }: RouteProps) {
  if (route === 'orders') return <Orders />;
  if (route === 'partners') return <Partners />;
  if (arg) return <ProductPage id={arg} />;
  return <Shop />;
}

function Shop() {
  const { open } = useClient();
  const shop = useApi<ShopData>('/shop');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string>('all');
  const items = useMemo(() => {
    const list = shop.data?.products ?? [];
    const needle = q.trim().toLowerCase();
    return list.filter((p) => {
      if (cat === 'featured' && !p.featured) return false;
      if (cat !== 'all' && cat !== 'featured' && p.category !== cat) return false;
      if (!needle) return true;
      return `${p.name} ${p.description ?? ''} ${p.categoryLabel}`.toLowerCase().includes(needle);
    });
  }, [shop.data, q, cat]);
  if (shop.error?.code === 'feature_off') return <Empty>Studio nie prowadzi sklepu w aplikacji.</Empty>;
  if (!shop.data) return <Spinner />;
  const present = new Set(shop.data.products.map((p) => p.category));
  const chips = CATS.filter((c) => c.id === 'all' || (c.id === 'featured' ? shop.data!.products.some((p) => p.featured) : present.has(c.id)));
  return (
    <div className="shop-page">
      <h1 className="shop-hello">
        Witaj w szafce
        <span className="serif"> studia.</span>
      </h1>
      <label className="shop-search">
        <span className="sr-only">Szukaj w sklepie</span>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj" autoComplete="off" />
        <span className="shop-search-icon" aria-hidden>
          <Icon name="search" size={18} />
        </span>
      </label>
      <div className="chips shop-cats" role="tablist" aria-label="Kategorie">
        {chips.map((c) => (
          <button key={c.id} type="button" role="tab" className="chip" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <Empty>{q.trim() ? `Nic nie pasuje do „${q.trim()}”.` : 'W tej kategorii na razie pusto.'}</Empty>
      ) : (
        <div className="shop-grid">
          {items.map((p) => (
            <button key={p.id} type="button" className={`shop-card${p.status === 'sold_out' ? ' is-out' : ''}`} onClick={() => open(`shop/${p.id}`)}>
              <span className="shop-photo">{p.photoUrl && <img src={p.photoUrl} alt="" />}</span>
              <b>{p.name}</b>
              <span className="shop-price">{p.status === 'sold_out' ? 'wyprzedane' : p.price}</span>
              {nutritionHighlight(p.nutrition) && <span className="tiny muted">{nutritionHighlight(p.nutrition)}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="list-rows">
        <ListRow title="Moje zamówienia" onClick={() => open('orders')} />
        <ListRow title="Partnerzy" onClick={() => open('partners')} />
      </div>
      <p className="tiny muted">Rezerwacja: płacisz w recepcji, sztuka czeka {shop.data.settings.reservationDays} dni. Napój – do końca dnia. Paragon wystawia studio.</p>
    </div>
  );
}

function ProductPage({ id }: { id: string }) {
  const shop = useApi<ShopData>('/shop');
  const [buy, setBuy] = useState(false);
  if (!shop.data) return shop.error?.code === 'feature_off' ? <Empty>Studio nie prowadzi sklepu w aplikacji.</Empty> : <Spinner />;
  const product = shop.data.products.find((p) => p.id === id);
  if (!product) return <Empty>Ten produkt nie jest już dostępny.</Empty>;
  const macro = nutritionRows(product.nutrition);
  const out = product.status === 'sold_out';
  return (
    <div className="shop-page shop-pdp">
      <Gallery photos={product.photos} name={product.name} />
      <div className="eyebrow">{product.categoryLabel}</div>
      <h1 style={{ fontSize: '1.85rem', letterSpacing: '-0.03em', margin: 0 }}>{product.name}</h1>
      <p className="shop-pdp-price">{out ? 'wyprzedane' : product.price}</p>
      {product.description && <p className="small muted" style={{ margin: 0 }}>{product.description}</p>}
      {product.nutrition?.serving && !macro.length && <p className="tiny muted">Porcja {product.nutrition.serving}</p>}
      {macro.length > 0 && (
        <table className="shop-macro">
          <caption>
            Wartości odżywcze{product.nutrition?.serving ? ` · ${product.nutrition.serving}` : ''}
          </caption>
          <tbody>
            {macro.map((r) => (
              <tr key={r.key} className={r.sub ? 'sub' : undefined}>
                <th scope="row">{r.label}</th>
                <td>{r.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn block" disabled={out} onClick={() => setBuy(true)}>
        {out ? 'Chwilowo niedostępne' : product.category === 'drink' ? 'Zamów do baru' : 'Zarezerwuj albo zamów'}
      </button>
      {buy && <BuySheet product={product} settings={shop.data.settings} onClose={() => setBuy(false)} onDone={shop.reload} />}
    </div>
  );
}

function Gallery({ photos, name }: { photos: ShopPhoto[]; name: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  if (!photos.length) return <div className="shop-slide" aria-hidden />;
  if (photos.length === 1) return <img className="shop-slide" src={photos[0].url} alt={name} />;
  return (
    <div>
      <div
        ref={scroller}
        className="shop-gallery"
        onScroll={(e) => {
          const el = e.currentTarget;
          setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {photos.map((p, k) => (
          <img key={p.id} src={p.url} alt={k === 0 ? name : ''} />
        ))}
      </div>
      <div className="shop-dots" role="tablist" aria-label="Zdjęcia">
        {photos.map((p, k) => (
          <button
            key={p.id}
            type="button"
            className={k === i ? 'on' : undefined}
            aria-label={`Zdjęcie ${k + 1}`}
            aria-current={k === i}
            onClick={() => {
              const el = scroller.current;
              if (el) el.scrollTo({ left: k * el.clientWidth, behavior: 'smooth' });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function BuySheet({ product, settings, onClose, onDone }: { product: ShopProduct; settings: ShopData['settings']; onClose: () => void; onDone: () => void }) {
  const { me, open } = useClient();
  const available = product.variants.filter(inStock);
  const [variant, setVariant] = useState(available[0]?.id ?? '');
  const [qty, setQty] = useState(1);
  const [kind, setKind] = useState<'pickup' | 'online'>('pickup');
  const [method, setMethod] = useState('blik');
  const { run, busy } = useAction();
  const chosen = product.variants.find((v) => v.id === variant);
  const drink = product.category === 'drink';
  const showPicker = product.variants.length > 1 || product.variants.some((v) => v.size || v.color);
  const ship = settings.shipping && !drink;
  return (
    <Sheet onClose={onClose} label={product.name}>
      <div className="stack">
        <h2>{product.name}</h2>
        {showPicker && (
          <>
            {product.sizeName && <div className="eyebrow">{product.sizeName}</div>}
            <div className="pill-row">
              {product.variants.map((v) => (
                <button key={v.id} type="button" className="chip" disabled={!inStock(v)} aria-pressed={variant === v.id} onClick={() => setVariant(v.id)}>
                  {v.label}
                  {v.hint ? ` · ${v.hint}` : !inStock(v) ? ' · brak' : ''}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Mniej">
            −
          </button>
          <b>{qty}</b>
          <button type="button" className="btn ghost sm" onClick={() => setQty(Math.min(10, qty + 1))} aria-label="Więcej">
            +
          </button>
          {chosen && <span className="muted small">{chosen.price}</span>}
        </div>
        <div className="segmented">
          <button type="button" aria-pressed={kind === 'pickup'} onClick={() => setKind('pickup')}>
            {drink ? 'Odbiór przy barze' : 'Odbiór w studiu'}
          </button>
          {ship && (
            <button type="button" aria-pressed={kind === 'online'} onClick={() => setKind('online')}>
              Wysyłka (+{settings.shippingPrice})
            </button>
          )}
        </div>
        {kind === 'online' && (
          <>
            {!me.user.hasAddress && (
              <p className="small">
                Potrzebujemy adresu.{' '}
                <button type="button" className="link" onClick={() => open('settings')}>
                  Dodaj adres
                </button>
              </p>
            )}
            <div className="pill-row">
              {availableMethods(['blik', 'apple_pay', 'google_pay', 'p24', 'card']).map((m) => (
                <button key={m} type="button" className="chip" aria-pressed={method === m} onClick={() => setMethod(m)}>
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
              api<{ message: string; checkoutUrl?: string }>('/shop/orders', { method: 'POST', body: { kind, method: kind === 'online' ? method : undefined, items: [{ productId: product.id, variantId: variant, qty }] } }).then((r) => {
                if (goToCheckout(r)) return r;
                onDone();
                onClose();
                return r;
              }),
            )
          }
        >
          {kind === 'pickup' ? (drink ? 'Zamów (zapłacisz przy barze)' : 'Zarezerwuj (zapłacisz na miejscu)') : 'Zapłać i zamów'}
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
        <div key={o.id} className="card flat stack gap-2">
          <div className="row between">
            <b>{o.items.map((i) => `${i.name} (${i.variant}) × ${i.qty}`).join(', ')}</b>
            <span className="badge">{STATUS[o.status] ?? o.status}</span>
          </div>
          <div className="row between small muted">
            <span>
              {fmtDay(o.created_at)} · {o.total} {o.expires_at && ['reserved', 'ready'].includes(o.status) && `· odbiór do ${o.expires_at.split('-').reverse().join('.')}`}
            </span>
            {['reserved', 'ready'].includes(o.status) && o.kind === 'pickup' && (
              <button type="button" className="link tiny" onClick={() => run(() => api(`/my/orders/${o.id}/cancel`, { method: 'POST' }).then((r) => (orders.reload(), r)))}>
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
        <div key={p.id} className="card flat stack gap-2">
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
