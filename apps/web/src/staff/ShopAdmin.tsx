// Sklep w panelu (4.8.1, S1–S4): oferta w kategoriach (menu baru, akcesoria, stroje), galeria zdjęć,
// miara rozmiaru (ubrania / skarpetki / waga / pojemność), opcjonalne makro napojów, stany i zamówienia.
import { useState } from 'react';
import { DEFAULT_SCALE, NUTRIENTS, SHOP_CATEGORIES, SIZE_SCALES, isSizeScale, type Nutrition, type ShopCategory, type SizeScale } from '@glam/core';
import { api, fmtDay, useApi } from '../api.ts';
import { Empty, Field, PAYMENT_LABELS, Sheet, Spinner, Tabs, Toggle, useAction } from '../ui.tsx';
import { preparePhoto } from './logoUpload.ts';

type Photo = { id: string; url: string };
type Variant = { id: string; size?: string | null; color?: string | null; stock: number | null; label: string; priceGrosze?: number | null };
type Product = {
  id: string;
  category: ShopCategory;
  name: string;
  description: string | null;
  price: string;
  priceGrosze: number;
  status: string;
  sizeScale: SizeScale;
  sizeName: string | null;
  photos: Photo[];
  photoUrl: string | null;
  nutrition: Nutrition | null;
  featured: boolean;
  rewardEligible: boolean;
  variants: Variant[];
};
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
      <Tabs label="Sklep" value={tab} onChange={setTab} options={[['orders', 'Zamówienia i odbiory'], ['products', 'Oferta i stany']]} />
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
              <div className="small">
                {o.items.map((i) => `${i.name} (${i.variant}) × ${i.qty}`).join(', ')} · {o.total}
              </div>
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
      {tab === 'products' &&
        (shop.data.products.length === 0 ? (
          <Empty>Dodaj pierwszy produkt – napój, matę albo strój.</Empty>
        ) : (
          SHOP_CATEGORIES.map((c) => {
            const items = shop.data!.products.filter((p) => p.category === c.id);
            if (!items.length) return null;
            return (
              <section key={c.id} className="stack" style={{ gap: 10 }}>
                <div className="eyebrow" style={{ margin: 0 }}>
                  {c.label}
                </div>
                <div className="grid-2">
                  {items.map((p) => (
                    <button key={p.id} className="card stack" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setEdit(p)}>
                      <div className="row" style={{ gap: 12, alignItems: 'stretch' }}>
                        <div className="shop-admin-thumb">{p.photoUrl && <img src={p.photoUrl} alt="" />}</div>
                        <div className="grow stack" style={{ gap: 4 }}>
                          <div className="row between">
                            <b>{p.name}</b>
                            <b>{p.price}</b>
                          </div>
                          <span className="badge" style={{ alignSelf: 'flex-start' }}>
                            {STATUS[p.status]}
                            {p.featured ? ' · wyróżniony' : ''}
                          </span>
                          <div className="small muted">
                            {p.variants.map((v) => `${v.label}: ${v.stock === null ? 'bez limitu' : `${v.stock} szt.`}`).join(' · ')}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })
        ))}
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

type DraftVariant = { id: string; size: string; color: string; stock: string; unlimited: boolean; price: string };

function toDraft(v: Variant): DraftVariant {
  return { id: v.id, size: v.size ?? '', color: v.color ?? '', stock: v.stock === null ? '' : String(v.stock), unlimited: v.stock === null, price: v.priceGrosze != null ? String(v.priceGrosze / 100) : '' };
}

function blankVariant(category: ShopCategory): DraftVariant {
  return { id: '', size: '', color: '', stock: category === 'drink' ? '' : '0', unlimited: category === 'drink', price: '' };
}

function ProductEditor({ product, onClose, onDone }: { product: Product | null; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<ShopCategory>(product?.category ?? 'accessory');
  const [name, setName] = useState(product?.name ?? '');
  const [desc, setDesc] = useState(product?.description ?? '');
  const [price, setPrice] = useState(product ? String(product.priceGrosze / 100) : '');
  const [status, setStatus] = useState(product?.status ?? 'available');
  const [sizeScale, setSizeScale] = useState<SizeScale>(product?.sizeScale ?? DEFAULT_SCALE[product?.category ?? 'accessory']);
  const [reward, setReward] = useState(product?.rewardEligible ?? false);
  const [featured, setFeatured] = useState(product?.featured ?? false);
  const [variants, setVariants] = useState<DraftVariant[]>(product?.variants.map(toDraft) ?? [blankVariant(product?.category ?? 'accessory')]);
  const [photos, setPhotos] = useState<Photo[]>(product?.photos ?? []);
  const [nutrition, setNutrition] = useState<Record<string, string>>(() => {
    const n = product?.nutrition ?? {};
    return { serving: n.serving ?? '', ...Object.fromEntries(NUTRIENTS.map((x) => [x.key, n[x.key] != null ? String(n[x.key]) : ''])) };
  });
  const { run, busy } = useAction();
  const scale = SIZE_SCALES[sizeScale];
  const patch = (i: number, next: Partial<DraftVariant>) => setVariants(variants.map((v, k) => (k === i ? { ...v, ...next } : v)));

  const pickCategory = (c: ShopCategory) => {
    setCategory(c);
    const next = DEFAULT_SCALE[c];
    setSizeScale(next);
    if (!product) setVariants([blankVariant(c)]);
  };

  const fillSizes = () => {
    const have = new Set(variants.map((v) => v.size));
    const add = scale.options.filter((s) => !have.has(s)).map((s) => ({ ...blankVariant(category), size: s, unlimited: false, stock: '0' }));
    setVariants(add.length ? [...variants.filter((v) => v.size || v.color), ...add] : variants);
  };

  const addPhoto = (file: File) =>
    run(async () => {
      const dataUrl = await preparePhoto(file, 1600);
      const m = await api<Photo>('/staff/shop/media', { method: 'POST', body: { dataUrl } });
      setPhotos((p) => [...p, m]);
    });

  const save = () =>
    run(async () => {
      const body = {
        category,
        name,
        description: desc,
        priceGrosze: Math.round(Number(price.replace(',', '.')) * 100),
        status,
        sizeScale,
        rewardEligible: reward,
        featured,
        photos: photos.map((p) => p.id),
        nutrition: category === 'drink' ? nutrition : null,
        variants: variants.map((v) => ({
          id: v.id || undefined,
          size: v.size || null,
          color: v.color || null,
          stock: v.unlimited ? null : Math.max(0, Number(v.stock) || 0),
          priceGrosze: v.price.trim() ? Math.round(Number(v.price.replace(',', '.')) * 100) : null,
        })),
      };
      if (product) await api(`/staff/shop/products/${product.id}`, { method: 'PUT', body });
      else await api('/staff/shop/products', { method: 'POST', body });
      onDone();
      onClose();
    }, 'Zapisane');

  return (
    <Sheet onClose={onClose} label="Produkt">
      <div className="stack">
        <h2>{product ? product.name : 'Nowy produkt'}</h2>
        <div className="chips">
          {SHOP_CATEGORIES.map((c) => (
            <button key={c.id} type="button" className="chip" aria-pressed={category === c.id} onClick={() => pickCategory(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        <Field label="Nazwa">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Opis">
          <textarea className="input" style={{ minHeight: 70 }} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label="Cena (zł)" hint="Gdy warianty mają własne ceny (np. cięższe hantle), to cena bazowa – na karcie pojawi się „od … zł”.">
          <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>

        <div className="eyebrow">Galeria</div>
        <p className="tiny muted" style={{ margin: 0 }}>
          Pierwsze zdjęcie jest okładką w katalogu. Kolejność = kolejność na stronie produktu.
        </p>
        <div className="shop-admin-gallery">
          {photos.map((p, i) => (
            <div key={p.id} className="shop-admin-shot">
              <img src={p.url} alt="" />
              <div className="row" style={{ gap: 4 }}>
                {i > 0 && (
                  <button type="button" className="link tiny" onClick={() => setPhotos(photos.map((x, k) => (k === i ? photos[i - 1] : k === i - 1 ? p : x)))}>
                    ←
                  </button>
                )}
                <button type="button" className="link tiny" onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}>
                  usuń
                </button>
              </div>
            </div>
          ))}
          {photos.length < 12 && (
            <label className="shop-admin-shot add">
              + Zdjęcie
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => e.target.files?.[0] && (addPhoto(e.target.files[0]), (e.target.value = ''))} />
            </label>
          )}
        </div>

        <Field label="Miara wariantu" hint={scale.name ? `W sklepie podpis nad wyborem: „${scale.name}”.` : 'Jedna sztuka albo warianty bez rozmiaru (np. kolor).'}>
          <select className="input" value={sizeScale} onChange={(e) => isSizeScale(e.target.value) && setSizeScale(e.target.value)}>
            {(Object.keys(SIZE_SCALES) as SizeScale[]).map((k) => (
              <option key={k} value={k}>
                {SIZE_SCALES[k].label}
              </option>
            ))}
          </select>
        </Field>
        <div className="eyebrow">{scale.name ?? 'Warianty i stan'}</div>
        {variants.map((v, i) => (
          <div key={i} className="stack" style={{ gap: 8, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <div className="row wrap">
              <input className="input" placeholder={scale.name ?? 'Wariant'} value={v.size} onChange={(e) => patch(i, { size: e.target.value })} aria-label={scale.name ?? 'Wariant'} />
              <input className="input" placeholder="Kolor" value={v.color} onChange={(e) => patch(i, { color: e.target.value })} aria-label="Kolor" />
            </div>
            <div className="row wrap">
              <label className="row" style={{ gap: 8, flex: 'none' }}>
                <input type="checkbox" checked={v.unlimited} onChange={(e) => patch(i, { unlimited: e.target.checked })} />
                <span className="small">bez limitu</span>
              </label>
              {!v.unlimited && (
                <input className="input" type="number" min={0} style={{ maxWidth: 110 }} value={v.stock} onChange={(e) => patch(i, { stock: e.target.value })} aria-label="Liczba sztuk" placeholder="szt." />
              )}
              <input className="input" inputMode="decimal" style={{ maxWidth: 120 }} value={v.price} onChange={(e) => patch(i, { price: e.target.value })} aria-label="Cena wariantu" placeholder="cena zł" />
              {variants.length > 1 && (
                <button type="button" className="link tiny" onClick={() => setVariants(variants.filter((_, k) => k !== i))}>
                  usuń
                </button>
              )}
            </div>
          </div>
        ))}
        <div className="row wrap">
          <button type="button" className="btn ghost sm" onClick={() => setVariants([...variants, blankVariant(category)])}>
            + Wariant
          </button>
          {scale.options.length > 0 && (
            <button type="button" className="btn ghost sm" onClick={fillSizes}>
              Wstaw {scale.name?.toLowerCase() ?? 'warianty'}
            </button>
          )}
        </div>

        {category === 'drink' && (
          <>
            <div className="eyebrow">Makro (opcjonalnie)</div>
            <p className="tiny muted" style={{ margin: 0 }}>
              Wpisz tylko to, co chcesz pokazać. Puste pole nie pojawi się w aplikacji ani na stronie.
            </p>
            <Field label="Porcja">
              <input className="input" value={nutrition.serving ?? ''} onChange={(e) => setNutrition({ ...nutrition, serving: e.target.value })} placeholder="400 ml" />
            </Field>
            <div className="grid-2" style={{ gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {NUTRIENTS.map((n) => (
                <Field key={n.key} label={`${n.label} (${n.unit})`}>
                  <input className="input" inputMode="decimal" value={nutrition[n.key] ?? ''} onChange={(e) => setNutrition({ ...nutrition, [n.key]: e.target.value })} />
                </Field>
              ))}
            </div>
          </>
        )}

        <div className="chips">
          {['available', 'sold_out', 'hidden'].map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
              {STATUS[s]}
            </button>
          ))}
        </div>
        <Toggle label="Wyróżniony w katalogu" hint="Pojawi się w filtrze „Wyróżnione”." checked={featured} onChange={setFeatured} />
        <Toggle label="Może być nagrodą (np. po 10 zajęciach)" checked={reward} onChange={setReward} />
        <button className="btn" disabled={!name || !price || busy} onClick={save}>
          Zapisz
        </button>
      </div>
    </Sheet>
  );
}
