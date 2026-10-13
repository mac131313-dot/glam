// Sklep w panelu (4.8.1, S1–S4): produkty z wariantami (rozmiar, kolor) i stanem, statusy, zdjęcie,
// zamówienia online i rezerwacje do odbioru (gotowe → odebrane z formą płatności na miejscu, wysłane).
import { useState } from 'react';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Field, PAYMENT_LABELS, readFile, Sheet, Spinner, Tabs, Toggle, useAction } from '../ui.tsx';

type Product = { id: string; name: string; description: string | null; price: string; priceGrosze: number; status: string; photoUrl: string | null; rewardEligible: boolean; variants: { id: string; size?: string | null; color?: string | null; stock: number; label: string }[] };
type Order = { id: string; kind: string; status: string; items: { name: string; variant: string; qty: number }[]; total: string; method: string | null; expires_at: string | null; created_at: string; name: string | null; phone: string | null; address: { line: string; city: string; zip: string } | null };

const STATUS: Record<string, string> = { reserved: 'zarezerwowane', ready: 'czeka w recepcji', paid: 'opłacone – do wysyłki', shipped: 'wysłane', collected: 'odebrane', cancelled: 'anulowane', expired: 'wygasłe', available: 'dostępny', sold_out: 'wyprzedany', hidden: 'ukryty' };

export default function ShopAdmin() {
  const shop = useApi<{ products: Product[]; orders: Order[] }>('/staff/shop');
  const [tab, setTab] = useState<'orders' | 'products'>('orders');
  const [edit, setEdit] = useState<Product | 'new' | null>(null);
  const [collect, setCollect] = useState<Order | null>(null);
  const { run } = useAction();
  if (shop.error?.code === 'feature_off') return <Empty>Sklep nie jest włączony w planie studia.</Empty>;
  if (!shop.data) return <Spinner />;
  const set = (o: Order, status: string, method?: string) => run(() => api(`/staff/shop/orders/${o.id}`, { method: 'POST', body: { status, method } }).then(shop.reload));
  return (
    <div className="stack-lg">
      <div className="row between">
        <h1 style={{ margin: 0 }}>Sklep</h1>
        <button className="btn" onClick={() => setEdit('new')}>
          + Produkt
        </button>
      </div>
      <Tabs label="Sklep" value={tab} onChange={setTab} options={[['orders', 'Zamówienia i odbiory'], ['products', 'Produkty i stany']]} />
      {tab === 'orders' &&
        (shop.data.orders.length === 0 ? (
          <Empty>Brak zamówień.</Empty>
        ) : (
          shop.data.orders.map((o) => (
            <section key={o.id} className="card flat stack" style={{ gap: 6 }}>
              <div className="row between">
                <b>{o.name ?? 'Sprzedaż przy ladzie'}</b>
                <span className="badge">{STATUS[o.status] ?? o.status}</span>
              </div>
              <div className="small">{o.items.map((i) => `${i.name} (${i.variant}) × ${i.qty}`).join(', ')} · {o.total}</div>
              <div className="tiny muted">
                {o.kind === 'pickup' ? `odbiór w studiu${o.expires_at ? ` do ${o.expires_at}` : ''}` : o.kind === 'online' ? 'wysyłka' : 'kasa'} · {fmtDay(o.created_at)} {o.method && `· ${PAYMENT_LABELS[o.method] ?? o.method}`}
              </div>
              {o.address && (
                <div className="tiny">
                  {o.address.line}, {o.address.zip} {o.address.city}
                </div>
              )}
              <div className="row" style={{ gap: 6 }}>
                {o.status === 'reserved' && (
                  <button className="btn sm" onClick={() => set(o, 'ready')}>
                    Gotowe do odbioru
                  </button>
                )}
                {['reserved', 'ready'].includes(o.status) && (
                  <button className="btn sm" onClick={() => setCollect(o)}>
                    Odebrane
                  </button>
                )}
                {o.status === 'paid' && (
                  <button className="btn sm" onClick={() => set(o, 'shipped')}>
                    Wysłane
                  </button>
                )}
                {['reserved', 'ready', 'paid'].includes(o.status) && (
                  <button className="btn ghost sm" onClick={() => set(o, 'cancelled')}>
                    Anuluj
                  </button>
                )}
              </div>
            </section>
          ))
        ))}
      {tab === 'products' && (
        <div className="grid-2">
          {shop.data.products.map((p) => (
            <button key={p.id} className="card stack" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setEdit(p)}>
              <div className="row between">
                <b>{p.name}</b>
                <b>{p.price}</b>
              </div>
              <span className="badge" style={{ alignSelf: 'flex-start' }}>
                {STATUS[p.status]}
              </span>
              <div className="small muted">{p.variants.map((v) => `${v.label}: ${v.stock}`).join(' · ')}</div>
            </button>
          ))}
        </div>
      )}
      {edit && <ProductEditor product={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onDone={shop.reload} />}
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
    </div>
  );
}

function ProductEditor({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [desc, setDesc] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? String(product.priceGrosze / 100) : '');
  const [status, setStatus] = useState(product?.status ?? 'available');
  const [reward, setReward] = useState(product?.rewardEligible ?? false);
  const [variants, setVariants] = useState(product?.variants.map((v) => ({ id: v.id, size: v.size ?? '', color: v.color ?? '', stock: v.stock })) ?? [{ id: '', size: 'M', color: '', stock: 5 }]);
  const [photo, setPhoto] = useState<string | null>(null);
  const { run, busy } = useAction();
  const save = () =>
    run(async () => {
      const body = { name, description: desc, priceGrosze: Math.round(Number(price.replace(',', '.')) * 100), status, rewardEligible: reward, variants, photo };
      if (product) await api(`/staff/shop/products/${product.id}`, { method: 'PUT', body });
      else await api('/staff/shop/products', { method: 'POST', body });
      onDone();
      onClose();
    }, 'Zapisane');
  return (
    <Sheet onClose={onClose} label="Produkt">
      <div className="stack">
        <h2>{product ? product.name : 'Nowy produkt'}</h2>
        <Field label="Nazwa">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Opis">
          <textarea className="input" style={{ minHeight: 70 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label="Cena (zł)">
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
        <div className="eyebrow">Warianty i stan</div>
        {variants.map((v, i) => (
          <div key={i} className="row">
            <input className="input" placeholder="Rozmiar" value={v.size} onChange={(e) => setVariants(variants.map((x, k) => (k === i ? { ...x, size: e.target.value } : x)))} />
            <input className="input" placeholder="Kolor" value={v.color} onChange={(e) => setVariants(variants.map((x, k) => (k === i ? { ...x, color: e.target.value } : x)))} />
            <input className="input" type="number" style={{ maxWidth: 90 }} value={v.stock} onChange={(e) => setVariants(variants.map((x, k) => (k === i ? { ...x, stock: Number(e.target.value) } : x)))} aria-label="Stan" />
          </div>
        ))}
        <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setVariants([...variants, { id: '', size: '', color: '', stock: 0 }])}>
          + Wariant
        </button>
        <div className="chips">
          {['available', 'sold_out', 'hidden'].map((s) => (
            <button key={s} className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {STATUS[s]}
            </button>
          ))}
        </div>
        <Toggle label="Może być nagrodą (np. po 10 zajęciach)" checked={reward} onChange={setReward} />
        {!product && (
          <label className="btn ghost">
            {photo ? 'Zdjęcie wybrane ✓' : 'Dodaj zdjęcie'}
            <input type="file" accept="image/*" hidden onChange={async (e) => e.target.files?.[0] && setPhoto(await readFile(e.target.files[0]))} />
          </label>
        )}
        <button className="btn" disabled={!name || !price || busy} onClick={save}>
          Zapisz
        </button>
      </div>
    </Sheet>
  );
}
