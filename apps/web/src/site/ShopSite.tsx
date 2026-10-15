// Publiczny sklep studia: /s/:slug/sklep i /s/:slug/sklep/:id. Katalog i strona produktu – ten sam wygląd
// co strona studia (site.css). Zakupy tylko w aplikacji; tu jest oferta, galeria i makro napojów.
import { useEffect, useMemo, useState } from 'react';
import { nutritionHighlight, nutritionRows, SHOP_CATEGORIES, type Look, type Nutrition } from '@glam/core';
import { applyLook } from '../look.ts';
import { StudioBrand } from '../StudioBrand.tsx';
import { Spinner } from '../ui.tsx';
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
  status: string;
  sizeName: string | null;
  variants: Variant[];
  photos: Photo[];
  photoUrl: string | null;
  nutrition: Nutrition | null;
  featured: boolean;
};
type Studio = { slug: string; name: string; city: string | null; look: Look; logo: string; logoUrl: string | null; logoWide: boolean; address: string | null; phone: string | null; email: string | null };
type Catalog = { studio: Studio; products: Product[] };

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
      <header className="site-nav">
        <a className="site-brand" href={`/s/${encodeURIComponent(data.studio.slug)}`} aria-label={`${data.studio.name} – strona studia`}>
          {data.studio.logoUrl ? <StudioBrand studio={data.studio} scale={1} /> : <span className="site-wordmark">{data.studio.name}</span>}
        </a>
        <nav className="site-links" aria-label="Sklep">
          <a href={`/s/${encodeURIComponent(slug)}/sklep`}>Sklep</a>
        </nav>
        <a className="btn sm" href={`${APP}?go=shop${product ? `/${product.id}` : ''}`}>
          {product ? 'Kup w aplikacji' : 'Aplikacja'}
        </a>
      </header>
      <main>{product ? <ProductView studio={data.studio} product={product} slug={slug} onBack={closeProduct} /> : <CatalogView studio={data.studio} products={data.products} slug={slug} onOpen={openProduct} />}</main>
    </div>
  );
}

function CatalogView({ studio, products, slug, onOpen }: { studio: Studio; products: Product[]; slug: string; onOpen: (id: string) => void }) {
  const [cat, setCat] = useState('all');
  const present = new Set(products.map((p) => p.category));
  const chips = CATS.filter((c) => c.id === 'all' || (c.id === 'featured' ? products.some((p) => p.featured) : present.has(c.id)));
  const items = useMemo(() => products.filter((p) => (cat === 'all' ? true : cat === 'featured' ? p.featured : p.category === cat)), [products, cat]);
  return (
    <>
      <section className="site-section shop-site-hero">
        <p className="site-eyebrow">Sklep {studio.name}</p>
        <h1 className="site-title">
          Szafka
          <span className="serif"> studia</span>
        </h1>
        <p className="site-lead">Bar po treningu, akcesoria z logo i stroje – do domu i na salę.</p>
      </section>
      <section className="site-section">
        <div className="site-filter" role="tablist" aria-label="Kategorie">
          {chips.map((c) => (
            <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>
              {c.label}
            </button>
          ))}
        </div>
        {items.length === 0 ? (
          <p className="site-empty">W tej kategorii na razie pusto.</p>
        ) : (
          <div className="shop-site-grid">
            {items.map((p) => (
              <a
                key={p.id}
                className={`shop-site-card${p.status === 'sold_out' ? ' is-out' : ''}`}
                href={`/s/${encodeURIComponent(slug)}/sklep/${encodeURIComponent(p.id)}`}
                onClick={(e) => {
                  e.preventDefault();
                  onOpen(p.id);
                }}
              >
                <div className="site-photo">{p.photoUrl && <img src={p.photoUrl} alt="" />}</div>
                <h2 className="shop-site-name">{p.name}</h2>
                <p className="shop-site-price">{p.status === 'sold_out' ? 'wyprzedane' : p.price}</p>
                {nutritionHighlight(p.nutrition) && <p className="site-quiet">{nutritionHighlight(p.nutrition)}</p>}
              </a>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function ProductView({ studio, product, slug, onBack }: { studio: Studio; product: Product; slug: string; onBack: () => void }) {
  const [shot, setShot] = useState(0);
  const photos = product.photos;
  const photo = photos[shot] ?? photos[0];
  const macro = nutritionRows(product.nutrition);
  const sizes = product.variants.filter((v) => v.size || v.color);
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
    </>
  );
}
