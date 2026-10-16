// Publiczny sklep studia: /s/:slug/sklep i /s/:slug/sklep/:id. Katalog i strona produktu – ten sam wygląd
// co strona studia (site.css). Zakupy tylko w aplikacji; tu jest oferta, galeria i makro napojów.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { formatPLN, nutritionHighlight, nutritionRows, SHOP_CATEGORIES, shopSuggestions, type Look, type Nutrition, type SitePage } from '@glam/core';
import { applyLook } from '../look.ts';
import { StudioBrand } from '../StudioBrand.tsx';
import { Spinner } from '../ui.tsx';
import { SiteNav } from './SiteNav.tsx';
import './site.css';

type Photo = { id: string; url: string };
type Variant = { id: string; size?: string | null; color?: string | null; stock: number | null; label: string; price: string; hint: string | null };
type Product = {
  id: string;
  category: string;
  categoryLabel: string;
  name: string;
  description: string | null;
  price: string;
  priceGrosze: number;
  status: string;
  sizeName: string | null;
  variants: Variant[];
  photos: Photo[];
  photoUrl: string | null;
  nutrition: Nutrition | null;
  featured: boolean;
  set: string | null;
};
type Studio = { slug: string; name: string; city: string | null; look: Look; logo: string; logoUrl: string | null; logoWide: boolean; address: string | null; phone: string | null; email: string | null };
type Catalog = { studio: Studio; products: Product[]; menu?: SitePage[] };

const APP = '/app';
const CATS = [{ id: 'all', label: 'Wszystko' }, { id: 'featured', label: 'Wyróżnione' }, ...SHOP_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))];

export function ShopSite({ slug, productId }: { slug: string; productId: string | null }) {
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState(productId);

  useEffect(() => {
    fetch(`/api/public/studios/${encodeURIComponent(slug)}/shop`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.message ?? 'Nie udało się wczytać sklepu.');
        setData(body as Catalog);
      })
      .catch((e: Error) => setError(e.message));
  }, [slug]);

  useEffect(() => setCurrentId(productId), [productId]);
  useEffect(() => {
    const sync = () => {
      const m = location.pathname.match(/^\/s\/[^/]+\/sklep(?:\/([^/]+))?\/?$/);
      setCurrentId(m?.[1] ? decodeURIComponent(m[1]) : null);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  useEffect(() => {
    if (!data) return;
    applyLook(data.studio.look);
    const p = currentId ? data.products.find((x) => x.id === currentId) : null;
    document.title = p ? `${p.name} – ${data.studio.name}` : `Sklep – ${data.studio.name}`;
  }, [data, currentId]);

  if (error)
    return (
      <main className="site-state">
        <div className="wordmark">glam</div>
        <p className="muted">{error}</p>
        <a className="btn ghost sm" href={`/s/${encodeURIComponent(slug)}`}>
          Strona studia
        </a>
      </main>
    );
  if (!data)
    return (
      <main className="site-state">
        <Spinner />
      </main>
    );

  const product = currentId ? data.products.find((p) => p.id === currentId) : null;
  const openProduct = (id: string) => {
    const href = `/s/${encodeURIComponent(slug)}/sklep/${encodeURIComponent(id)}`;
    history.pushState(null, '', href);
    setCurrentId(id);
    window.scrollTo(0, 0);
  };
  const closeProduct = () => {
    history.pushState(null, '', `/s/${encodeURIComponent(slug)}/sklep`);
    setCurrentId(null);
    window.scrollTo(0, 0);
  };
  if (currentId && !product)
    return (
      <main className="site-state">
        <p className="muted">Tego produktu już nie ma w ofercie.</p>
        <a className="btn ghost sm" href={`/s/${encodeURIComponent(slug)}/sklep`}>
          Wróć do sklepu
        </a>
      </main>
    );

  return (
    <div className="site shop-site">
      {/* To samo menu co na stronie studia – tu zakładka „Sklep” jest bieżąca. */}
      <SiteNav
        slug={data.studio.slug}
        brand={data.studio.logoUrl ? <StudioBrand studio={data.studio} scale={1} /> : <span className="site-wordmark">{data.studio.name}</span>}
        brandLabel={`${data.studio.name} – strona główna`}
        pages={data.menu ?? []}
        current="sklep"
        button={{ label: product ? 'Kup w aplikacji' : 'Aplikacja', href: `${APP}?go=shop${product ? `/${product.id}` : ''}` }}
      />
      <main>{product ? <ProductView studio={data.studio} product={product} products={data.products} slug={slug} onBack={closeProduct} onOpen={openProduct} /> : <CatalogView studio={data.studio} products={data.products} slug={slug} onOpen={openProduct} />}</main>
    </div>
  );
}

/** Ile kolumn ma siatka – wybór klienta zapamiętany w przeglądarce (jak „View by 3 4 6” w sklepach modowych). */
const VIEW_KEY = 'glam-shop-cols';
const VIEWS = [2, 3, 4] as const;
type View = (typeof VIEWS)[number];
const readView = (): View => {
  try {
    const n = Number(localStorage.getItem(VIEW_KEY));
    return (VIEWS as readonly number[]).includes(n) ? (n as View) : 4;
  } catch {
    return 4;
  }
};

function CatalogView({ studio, products, slug, onOpen }: { studio: Studio; products: Product[]; slug: string; onOpen: (id: string) => void }) {
  const [cat, setCat] = useState('all');
  const [cols, setCols] = useState<View>(readView);
  const pickCols = (n: View) => {
    setCols(n);
    try {
      localStorage.setItem(VIEW_KEY, String(n));
    } catch {
      /* tryb prywatny – wybór działa do odświeżenia */
    }
  };
  const present = new Set(products.map((p) => p.category));
  const chips = CATS.filter((c) => c.id === 'all' || (c.id === 'featured' ? products.some((p) => p.featured) : present.has(c.id)));
  const items = useMemo(() => products.filter((p) => (cat === 'all' ? true : cat === 'featured' ? p.featured : p.category === cat)), [products, cat]);
  // Najwyżej dwa wyróżnione produkty dostają duży kafel 2×2 – reszta siatki zostaje równa i czytelna.
  const heroes = new Set(cols >= 3 ? items.filter((p) => p.featured).slice(0, 2).map((p) => p.id) : []);
  return (
    <>
      <section className="site-section shop-site-hero">
        <div>
          <p className="site-eyebrow">Sklep {studio.name}</p>
          <h1 className="site-h2">
            Szafka <span className="serif">studia</span>
          </h1>
        </div>
        <p className="site-quiet shop-site-lead">Akcesoria z logo i stroje – zamawiasz w aplikacji, przyjeżdżają do domu.</p>
      </section>
      <section className="shop-catalog">
        <div className="shop-toolbar">
          <div className="shop-chips" role="group" aria-label="Kategorie">
            {chips.map((c) => (
              <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="shop-view" role="group" aria-label="Liczba kolumn">
            <span>Widok</span>
            {VIEWS.map((n) => (
              <button key={n} type="button" aria-pressed={cols === n} onClick={() => pickCols(n)}>
                {n}
              </button>
            ))}
          </div>
        </div>
        {items.length === 0 ? (
          <p className="site-empty">W tej kategorii na razie pusto.</p>
        ) : (
          <div className="shop-site-grid" style={{ '--cols': cols } as CSSProperties}>
            {items.map((p) => (
              <ProductCard key={p.id} product={p} slug={slug} hero={heroes.has(p.id)} onOpen={onOpen} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

const productHref = (slug: string, id: string) => `/s/${encodeURIComponent(slug)}/sklep/${encodeURIComponent(id)}`;

/** Kafel produktu – ten sam w katalogu i w propozycjach pod produktem. */
function ProductCard({ product: p, slug, hero = false, onOpen }: { product: Product; slug: string; hero?: boolean; onOpen: (id: string) => void }) {
  const out = p.status === 'sold_out';
  const macro = nutritionHighlight(p.nutrition);
  return (
    <a
      className={`shop-site-card${out ? ' is-out' : ''}${hero ? ' is-hero' : ''}`}
      href={productHref(slug, p.id)}
      onClick={(e) => {
        e.preventDefault();
        onOpen(p.id);
      }}
    >
      <div className={`site-photo shop-site-photo${p.photoUrl ? '' : ' empty'}`}>
        {p.photoUrl ? <img src={p.photoUrl} alt="" loading="lazy" /> : <span className="serif">{p.name.charAt(0)}</span>}
        {(out || p.featured) && <span className="shop-site-tag">{out ? 'Wyprzedane' : 'Polecamy'}</span>}
      </div>
      <div className="shop-site-meta">
        <h2 className="shop-site-name">{p.name}</h2>
        <p className="shop-site-price">
          {out ? 'wyprzedane' : p.price}
          {macro && <span> · {macro}</span>}
        </p>
      </div>
    </a>
  );
}

function ProductView({ studio, product, products, slug, onBack, onOpen }: { studio: Studio; product: Product; products: Product[]; slug: string; onBack: () => void; onOpen: (id: string) => void }) {
  const [shot, setShot] = useState(0);
  const photos = product.photos;
  const photo = photos[shot] ?? photos[0];
  const macro = nutritionRows(product.nutrition);
  const sizes = product.variants.filter((v) => v.size || v.color);
  const { set, more } = useMemo(() => shopSuggestions(product, products), [product, products]);
  useEffect(() => setShot(0), [product.id]);
  return (
    <>
      <section className="site-section shop-pdp-split">
        <div>
          {photo ? (
            <div className="site-photo shop-pdp-photo">
              <img src={photo.url} alt={product.name} />
            </div>
          ) : (
            <div className="site-photo shop-pdp-photo empty" aria-hidden>
              <span className="serif">{product.name.charAt(0)}</span>
            </div>
          )}
          {photos.length > 1 && (
            <div className="shop-pdp-thumbs">
              {photos.map((p, i) => (
                <button key={p.id} type="button" className={i === shot ? 'on' : undefined} aria-label={`Zdjęcie ${i + 1}`} aria-pressed={i === shot} onClick={() => setShot(i)}>
                  <img src={p.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="shop-pdp-copy">
          <a
            className="site-quiet"
            href={`/s/${encodeURIComponent(slug)}/sklep`}
            onClick={(e) => {
              e.preventDefault();
              onBack();
            }}
          >
            ← Sklep
          </a>
          <p className="site-eyebrow">{product.categoryLabel}</p>
          <h1 className="site-h2">{product.name}</h1>
          <p className="shop-pdp-price">{product.status === 'sold_out' ? 'wyprzedane' : product.price}</p>
          {product.description && <p className="site-prose">{product.description}</p>}
          {sizes.length > 0 && (
            <div className="shop-pdp-sizes">
              <p className="site-eyebrow">{product.sizeName ?? 'Wariant'}</p>
              <ul>
                {product.variants.map((v) => (
                  <li key={v.id} className={v.stock === 0 ? 'out' : undefined}>
                    {v.label}
                    {v.hint ? ` · ${v.hint}` : v.stock === 0 ? ' · brak' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {macro.length > 0 && (
            <table className="shop-macro site-macro">
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
          <div className="site-actions">
            <a className="btn" href={`${APP}?go=shop/${product.id}`}>
              {product.category === 'drink' ? 'Zamów w aplikacji' : 'Kup w aplikacji'}
            </a>
            <a className="site-link" href={`/s/${encodeURIComponent(slug)}`}>
              {studio.name}
            </a>
          </div>
        </div>
      </section>
      {set.length > 0 && <SetSection product={product} set={set} slug={slug} onOpen={onOpen} />}
      {more.length > 0 && (
        <section className="site-section shop-pdp-more">
          <h2 className="site-h3">
            Może Ci się <span className="serif">spodobać</span>
          </h2>
          <div className="shop-site-grid" style={{ '--cols': 4 } as CSSProperties}>
            {more.map((p) => (
              <ProductCard key={p.id} product={p} slug={slug} onOpen={onOpen} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

/** „Skompletuj zestaw”: oglądany produkt + reszta kompletu, z łączną ceną całości. */
function SetSection({ product, set, slug, onOpen }: { product: Product; set: Product[]; slug: string; onOpen: (id: string) => void }) {
  const all = [product, ...set];
  const total = all.reduce((n, p) => n + p.priceGrosze, 0);
  // „od” – gdy któraś część ma warianty w różnych cenach (np. cięższe hantle)
  const from = all.some((p) => p.price.startsWith('od '));
  return (
    <section className="site-section shop-set">
      <div className="shop-set-head">
        <p className="site-eyebrow">{product.set}</p>
        <h2 className="site-h3">
          Skompletuj <span className="serif">zestaw</span>
        </h2>
      </div>
      <ul className="shop-set-list">
        {all.map((p) => (
          <li key={p.id} className={p.id === product.id ? 'is-current' : undefined}>
            <a
              href={productHref(slug, p.id)}
              aria-current={p.id === product.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                if (p.id !== product.id) onOpen(p.id);
              }}
            >
              <span className={`site-photo shop-set-thumb${p.photoUrl ? '' : ' empty'}`}>{p.photoUrl ? <img src={p.photoUrl} alt="" loading="lazy" /> : <span className="serif">{p.name.charAt(0)}</span>}</span>
              <span className="shop-set-name">
                {p.name}
                {p.id === product.id && <small>oglądasz</small>}
              </span>
              <span className="shop-set-price">{p.price}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="shop-set-total">
        <span>
          Cały komplet · {all.length} rzeczy
        </span>
        <strong>{(from ? 'od ' : '') + formatPLN(total)}</strong>
        <a className="btn" href={`${APP}?go=shop/${product.id}`}>
          Kup komplet w aplikacji
        </a>
      </div>
    </section>
  );
}
