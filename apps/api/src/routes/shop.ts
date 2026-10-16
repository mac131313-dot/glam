// Sklep studia (4.8.1, S1–S4): oferta w kategoriach – menu baru (napoje bez limitu sztuk, z opcjonalnym makro),
// akcesoria i stroje z wariantami (rozmiar wg miary produktu, kolor, stan, własna cena), galeria zdjęć produktu.
// Zakup online z wysyłką albo rezerwacja do odbioru z płatnością na miejscu (sztuka zablokowana na X dni, napój do
// końca dnia), potwierdzenie odbioru w recepcji. Aplikacja nie wystawia paragonów ani faktur za merch – zapisuje
// tylko ewidencję do raportu właścicielki. Katalog jest też publiczny – podstrona /s/:slug/sklep.
import type { FastifyInstance } from 'fastify';
import {
  categoryLabel,
  cleanNutrition,
  DEFAULT_SCALE,
  formatPLN,
  hasStock,
  isShopCategory,
  isSizeScale,
  localParts,
  priceRange,
  reservationExpiry,
  returnStock,
  sitePages,
  SIZE_SCALES,
  sortVariants,
  stockHint,
  takeStock,
  totalStock,
  TRIGGERS,
  variantLabel,
  variantPrice,
  type Nutrition,
  type ShopCategory,
  type SizeScale,
  type Variant,
} from '@glam/core';
import { readSite } from './public.ts';
import { assertFeature, ctx, requirePerm, requireStudio, type Deps } from '../context.ts';
import { unseal } from '../crypto.ts';
import { id, nowIso, type Db } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import { StudioScope } from '../scope.ts';
import { DESK_METHODS, PAYMENT_METHODS, type PaymentMethod } from '../sms.ts';
import { audit } from '../services/audit.ts';
import { deleteMedia, storeMedia } from '../services/media.ts';
import { notify } from '../services/notify.ts';
import { priceWithCoupon } from '../services/payments.ts';
import { loadStudio, logoInfo } from '../services/studio.ts';

type ProductRow = {
  id: string;
  category: ShopCategory;
  name: string;
  description: string | null;
  price_grosze: number;
  status: 'available' | 'sold_out' | 'hidden';
  size_scale: string;
  variants_json: string;
  media_id: string | null;
  gallery_json: string;
  nutrition_json: string | null;
  featured: number;
  reward_eligible: number;
};
type Item = { productId: string; variantId: string; qty: number; name?: string; variant?: string; price?: number };
type ProductInput = {
  category?: string;
  name?: string;
  description?: string | null;
  priceGrosze?: number;
  status?: string;
  sizeScale?: string;
  variants?: Partial<Variant>[];
  photos?: string[];
  nutrition?: Record<string, unknown> | null;
  featured?: boolean;
  rewardEligible?: boolean;
};

const MAX_PHOTOS = 12;
const MAX_VARIANTS = 30;
const STATUSES = ['available', 'sold_out', 'hidden'] as const;

function product(scope: StudioScope, pid: string) {
  const p = scope.get<ProductRow>('SELECT * FROM shop_products WHERE studio_id = $studio AND id = $id', { id: pid });
  if (!p) throw notFound('Nie znaleziono produktu.');
  return p;
}

/** Galeria; produkty sprzed galerii mają tylko okładkę w media_id. */
const photosOf = (p: Pick<ProductRow, 'gallery_json' | 'media_id'>): string[] => {
  const g = JSON.parse(p.gallery_json || '[]') as string[];
  return g.length ? g : p.media_id ? [p.media_id] : [];
};
const scaleOf = (p: Pick<ProductRow, 'size_scale'>): SizeScale => (isSizeScale(p.size_scale) ? p.size_scale : 'none');
const mediaUrl = (m: string) => `/api/public-media/${m}`;

const view = (p: ProductRow) => {
  const variants = JSON.parse(p.variants_json) as Variant[];
  const scale = scaleOf(p);
  const range = priceRange(p.price_grosze, variants);
  const photos = photosOf(p).map((m) => ({ id: m, url: mediaUrl(m) }));
  return {
    id: p.id,
    category: p.category,
    categoryLabel: categoryLabel(p.category),
    name: p.name,
    description: p.description,
    price: range.min === range.max ? formatPLN(range.min) : `od ${formatPLN(range.min)}`,
    priceGrosze: p.price_grosze,
    status: !hasStock(variants) && p.status === 'available' ? 'sold_out' : p.status,
    sizeScale: scale,
    sizeName: SIZE_SCALES[scale].name,
    variants: sortVariants(scale, variants).map((v) => ({
      ...v,
      label: variantLabel(v),
      priceGrosze: v.priceGrosze ?? null,
      price: formatPLN(variantPrice(v, p.price_grosze)),
      hint: stockHint(v.stock),
    })),
    photos,
    photoUrl: photos[0]?.url ?? null,
    nutrition: p.nutrition_json ? (JSON.parse(p.nutrition_json) as Nutrition) : null,
    featured: !!p.featured,
    rewardEligible: !!p.reward_eligible,
  };
};

/** Rezerwuje sztuki (stan ↓) dla pozycji zamówienia – w jednej transakcji, żeby nie sprzedać tego samego dwa razy. */
function reserveItems(scope: StudioScope, items: Item[]): { items: Item[]; total: number; categories: Set<ShopCategory> } {
  let total = 0;
  const out: Item[] = [];
  const categories = new Set<ShopCategory>();
  for (const it of items) {
    if (!(Number.isInteger(it.qty) && it.qty >= 1 && it.qty <= 10)) throw badRequest('Ilość od 1 do 10.');
    const p = product(scope, it.productId);
    if (p.status === 'hidden') throw notFound('Ten produkt nie jest już dostępny.');
    if (p.status === 'sold_out') throw conflict('stock', `${p.name}: chwilowo niedostępne.`);
    let variants: Variant[];
    try {
      variants = takeStock(JSON.parse(p.variants_json), it.variantId, it.qty);
    } catch (e) {
      throw conflict('stock', `${p.name}: ${(e as Error).message}`);
    }
    scope.run("UPDATE shop_products SET variants_json = $v, status = CASE WHEN $left = 0 THEN 'sold_out' ELSE status END WHERE studio_id = $studio AND id = $id", {
      v: JSON.stringify(variants),
      left: Number(hasStock(variants)),
      id: p.id,
    });
    const v = variants.find((x) => x.id === it.variantId)!;
    const price = variantPrice(v, p.price_grosze);
    total += price * it.qty;
    categories.add(p.category);
    out.push({ ...it, name: p.name, variant: variantLabel(v), price });
  }
  return { items: out, total, categories };
}

function releaseItems(scope: StudioScope, items: Item[]) {
  for (const it of items) {
    const p = scope.get<ProductRow>('SELECT * FROM shop_products WHERE studio_id = $studio AND id = $id', { id: it.productId });
    if (!p) continue;
    const variants = returnStock(JSON.parse(p.variants_json), it.variantId, it.qty);
    scope.run("UPDATE shop_products SET variants_json = $v, status = CASE WHEN status = 'sold_out' THEN 'available' ELSE status END WHERE studio_id = $studio AND id = $id", { v: JSON.stringify(variants), id: p.id });
  }
}

function cleanVariants(input: unknown, category: ShopCategory): Variant[] {
  const list = (Array.isArray(input) && input.length ? input : [{ stock: category === 'drink' ? null : 0 }]) as Partial<Variant>[];
  if (list.length > MAX_VARIANTS) throw badRequest(`Najwyżej ${MAX_VARIANTS} wariantów.`);
  const seen = new Set<string>();
  return list.map((v) => {
    let vid = typeof v.id === 'string' && /^[\w-]{1,12}$/.test(v.id) ? v.id : id().slice(0, 8);
    if (seen.has(vid)) vid = id().slice(0, 8);
    seen.add(vid);
    const price = Number(v.priceGrosze);
    return {
      id: vid,
      size: typeof v.size === 'string' ? v.size.trim().slice(0, 20) || null : null,
      color: typeof v.color === 'string' ? v.color.trim().slice(0, 30) || null : null,
      stock: v.stock === null ? null : Math.max(0, Math.min(99_999, Math.round(Number(v.stock) || 0))),
      priceGrosze: v.priceGrosze !== null && v.priceGrosze !== undefined && Number.isFinite(price) && price >= 0 ? Math.round(price) : null,
    };
  });
}

/** Zdjęcia galerii tylko z biblioteki sklepu tego studia – id cudzego pliku nie trafi do produktu. */
function cleanPhotos(scope: StudioScope, input: unknown): string[] {
  if (!Array.isArray(input)) throw badRequest('Nieprawidłowa galeria.');
  const ids = [...new Set(input.filter((x): x is string => typeof x === 'string'))];
  if (ids.length > MAX_PHOTOS) throw badRequest(`Galeria mieści do ${MAX_PHOTOS} zdjęć.`);
  if (!ids.length) return [];
  const own = new Set(
    scope
      .all<{ id: string }>(`SELECT id FROM media WHERE studio_id = $studio AND kind = 'shop' AND mime LIKE 'image/%' AND id IN (${ids.map((_, i) => `$m${i}`).join(', ')})`, Object.fromEntries(ids.map((m, i) => [`m${i}`, m])))
      .map((r) => r.id),
  );
  if (ids.some((m) => !own.has(m))) throw badRequest('Jedno ze zdjęć nie należy do sklepu tego studia. Wgraj je ponownie.');
  return ids;
}

/** Katalog strony WWW: studio z opublikowaną stroną i włączonym sklepem – inaczej 404. */
function publicShop(db: Db, slug: string) {
  const row = db.prepare("SELECT id FROM studios WHERE slug = ? AND published = 1 AND status != 'suspended'").get(slug) as { id: string } | undefined;
  if (!row) throw notFound('Nie ma takiego studia.');
  const studio = loadStudio(db, row.id);
  if (!studio.has('shop')) throw notFound('To studio nie prowadzi sklepu.');
  return { studio, scope: new StudioScope(db, studio.id) };
}

const shopSettings = (s: { reservationDays: number; shipping: boolean; shippingGrosze: number }) => ({ reservationDays: s.reservationDays, shipping: s.shipping, shippingPrice: formatPLN(s.shippingGrosze) });
const CATALOG_ORDER = "ORDER BY featured DESC, CASE category WHEN 'drink' THEN 0 WHEN 'accessory' THEN 1 WHEN 'apparel' THEN 2 ELSE 3 END, created_at DESC";

export function shopRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };
  const manage = requirePerm(db, 'shop.manage');

  app.get('/api/shop', member, async (req) => {
    const { scope, studio } = ctx(req);
    assertFeature(studio, 'shop');
    return {
      settings: shopSettings(studio.settings.shop),
      products: scope.all<ProductRow>(`SELECT * FROM shop_products WHERE studio_id = $studio AND status != 'hidden' ${CATALOG_ORDER}`).map(view),
    };
  });

  const publicStudio = (studio: ReturnType<typeof loadStudio>) => ({
    slug: studio.slug,
    name: studio.name,
    city: studio.city,
    look: studio.look,
    logo: studio.logo,
    ...logoInfo(studio),
    address: studio.address,
    phone: studio.phone,
    email: studio.email,
  });
  const publicView = (p: ProductRow) => {
    const { rewardEligible: _, ...v } = view(p);
    return v;
  };

  // Publiczny katalog (strona /s/:slug/sklep): bez sesji, bez danych klientek; kupuje się w aplikacji.
  app.get<{ Params: { slug: string } }>('/api/public/studios/:slug/shop', async (req) => {
    const { studio, scope } = publicShop(db, req.params.slug);
    return {
      studio: publicStudio(studio),
      settings: shopSettings(studio.settings.shop),
      products: scope.all<ProductRow>(`SELECT * FROM shop_products WHERE studio_id = $studio AND status != 'hidden' ${CATALOG_ORDER}`).map(publicView),
      // zakładki menu strony studia – sklep pokazuje to samo menu co reszta strony
      menu: sitePages(readSite(db, studio.id).published, { shop: true }),
    };
  });

  app.get<{ Params: { slug: string; id: string } }>('/api/public/studios/:slug/shop/:id', async (req) => {
    const { studio, scope } = publicShop(db, req.params.slug);
    const p = scope.get<ProductRow>("SELECT * FROM shop_products WHERE studio_id = $studio AND id = $id AND status != 'hidden'", { id: req.params.id });
    if (!p) throw notFound('Nie znaleziono produktu.');
    return { studio: publicStudio(studio), settings: shopSettings(studio.settings.shop), product: publicView(p) };
  });

  // S2/S3: zamówienie online z wysyłką albo rezerwacja do odbioru (płatność na miejscu).
  app.post<{ Body: { items: Item[]; kind: 'online' | 'pickup'; method?: PaymentMethod; couponCode?: string } }>('/api/shop/orders', member, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'shop');
    const b = req.body;
    if (!Array.isArray(b?.items) || !b.items.length) throw badRequest('Koszyk jest pusty.');
    if (b.kind === 'online') {
      if (!studio.settings.shop.shipping) throw conflict('no_shipping', 'Studio nie prowadzi wysyłki – zarezerwuj do odbioru.');
      if (!PAYMENT_METHODS.includes(b.method as (typeof PAYMENT_METHODS)[number])) throw badRequest('Wybierz metodę płatności.');
      if (!user.address_enc) throw conflict('address', 'Do wysyłki potrzebujemy adresu – dodaj go w Profilu (za zgodą, możesz usunąć w każdej chwili).');
      const drinks = scope.get<{ n: number }>(`SELECT COUNT(*) AS n FROM shop_products WHERE studio_id = $studio AND category = 'drink' AND id IN (${b.items.map((_, i) => `$p${i}`).join(', ')})`, Object.fromEntries(b.items.map((it, i) => [`p${i}`, String(it.productId)])))!.n;
      if (drinks) throw conflict('drink_pickup', 'Napoje przygotowujemy na miejscu – zamów je z odbiorem w studiu.');
    } else if (b.kind !== 'pickup') throw badRequest('Wybierz wysyłkę albo odbiór w studiu.');
    const today = localParts(new Date(), studio.timezone).date;
    // Najpierw blokujemy sztuki, potem płatność; nieudana płatność zwraca je na stan.
    const reserved = scope.tx(() => reserveItems(scope, b.items));
    const onlyDrinks = reserved.categories.size === 1 && reserved.categories.has('drink');
    const expires = b.kind === 'pickup' ? reservationExpiry(today, onlyDrinks ? 0 : studio.settings.shop.reservationDays) : null;
    let total = reserved.total + (b.kind === 'online' ? studio.settings.shop.shippingGrosze : 0);
    let discount = 0;
    if (b.couponCode) {
      const pc = priceWithCoupon(scope, studio, { code: b.couponCode, userId: user.id, kind: 'shop', amountGrosze: total });
      total = pc.final;
      discount = pc.discount;
    }
    let paid = false;
    if (b.kind === 'online') {
      const charge = await deps.payments.charge({ amountGrosze: total, method: b.method!, description: 'Sklep studia', studioId: studio.id });
      if (charge.status !== 'paid') {
        scope.tx(() => releaseItems(scope, reserved.items));
        throw new HttpError(402, 'payment_failed', 'Płatność się nie powiodła – produkty wróciły na stan.');
      }
      paid = true;
    }
    const oid = id();
    scope.run(
      `INSERT INTO shop_orders (id, studio_id, user_id, kind, status, items_json, total_grosze, method, address_enc, expires_at, created_at, updated_at)
       VALUES ($id, $studio, $u, $k, $s, $items, $total, $m, $addr, $exp, $now, $now)`,
      {
        id: oid,
        u: user.id,
        k: b.kind,
        s: paid ? 'paid' : 'reserved',
        items: JSON.stringify(reserved.items),
        total,
        m: paid ? b.method! : null,
        addr: b.kind === 'online' ? user.address_enc : null,
        exp: expires,
        now: nowIso(),
      },
    );
    if (paid) {
      // Zakup online przez bramkę studia – zapisujemy płatność (bez dokumentu sprzedaży z aplikacji, 4.8.1).
      scope.run("INSERT INTO payments (id, studio_id, user_id, kind, reference_id, amount_grosze, discount_grosze, method, status, description, created_at) VALUES ($id, $studio, $u, 'shop', $o, $a, $d, $m, 'paid', 'Sklep studia', $now)", {
        id: id(),
        u: user.id,
        o: oid,
        a: total,
        d: discount,
        m: b.method!,
        now: nowIso(),
      });
    }
    const staff = scope.all<{ user_id: string }>("SELECT DISTINCT user_id FROM memberships WHERE studio_id = $studio AND role IN ('reception', 'owner')");
    const body = b.kind === 'online' ? 'Nowe zamówienie z wysyłką.' : onlyDrinks ? `Zamówienie z baru: ${reserved.items.map((i) => `${i.name} × ${i.qty}`).join(', ')}.` : `Nowa rezerwacja do odbioru (${reserved.items.length} poz.).`;
    for (const s of staff) notify(scope, { userId: s.user_id, category: 'shop', tz: studio.timezone, body, action: 'staff/shop' });
    const until = expires?.split('-').reverse().slice(0, 2).join('.');
    return {
      id: oid,
      total: formatPLN(total),
      message: b.kind === 'online' ? 'Zamówienie opłacone. Damy znać, gdy wyślemy paczkę.' : onlyDrinks ? 'Zamówione! Odbierz i zapłać przy barze po treningu.' : `Zarezerwowane do ${until}. Zapłacisz w recepcji – damy znać, gdy będzie czekać.`,
    };
  });

  app.get('/api/my/orders', member, async (req) => {
    const { scope, user } = ctx(req);
    return scope.all<{ items_json: string; total_grosze: number }>('SELECT id, kind, status, items_json, total_grosze, expires_at, created_at FROM shop_orders WHERE studio_id = $studio AND user_id = $u ORDER BY created_at DESC', { u: user.id }).map((o) => ({ ...o, items: JSON.parse(o.items_json), total: formatPLN(o.total_grosze) }));
  });

  app.post<{ Params: { id: string } }>('/api/my/orders/:id/cancel', member, async (req) => {
    const { scope, user } = ctx(req);
    const o = scope.get<{ items_json: string; status: string }>("SELECT items_json, status FROM shop_orders WHERE studio_id = $studio AND id = $id AND user_id = $u AND kind = 'pickup'", { id: req.params.id, u: user.id });
    if (!o || !['reserved', 'ready'].includes(o.status)) throw notFound('Tej rezerwacji nie da się już anulować.');
    scope.tx(() => {
      releaseItems(scope, JSON.parse(o.items_json));
      scope.run("UPDATE shop_orders SET status = 'cancelled', updated_at = $now WHERE studio_id = $studio AND id = $id", { id: req.params.id, now: nowIso() });
    });
    return { message: 'Rezerwacja anulowana.' };
  });

  // ——— Panel: katalog, galeria, stany, zamówienia, odbiory i sprzedaż przy kasie (S1, S4) ———

  app.get('/api/staff/shop', manage, async (req) => {
    const { scope } = ctx(req);
    return {
      products: scope.all<ProductRow>(`SELECT * FROM shop_products WHERE studio_id = $studio ${CATALOG_ORDER}`).map(view),
      orders: scope
        .all<{ items_json: string; total_grosze: number; address_enc: string | null }>(
          `SELECT o.id, o.kind, o.status, o.items_json, o.total_grosze, o.method, o.address_enc, o.expires_at, o.created_at, u.name, u.phone FROM shop_orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.studio_id = $studio ORDER BY o.status IN ('collected', 'shipped', 'cancelled', 'expired'), o.created_at DESC LIMIT 100`,
        )
        .map(({ address_enc, ...o }) => ({ ...o, items: JSON.parse(o.items_json), total: formatPLN(o.total_grosze), address: unseal(address_enc) })),
    };
  });

  // Zdjęcie do galerii produktu: wgrywane pojedynczo (każde do 3 MB), produkt zapisuje potem listę id.
  app.post<{ Body: { dataUrl: string } }>('/api/staff/shop/media', { ...manage, bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'shop');
    const m = storeMedia(scope, studio, { dataUrl: req.body?.dataUrl, kind: 'shop', ownerId: user.id, allow: ['image'] });
    return { id: m.id, url: mediaUrl(m.id) };
  });

  app.post<{ Body: ProductInput }>('/api/staff/shop/products', manage, async (req) => {
    const { scope, studio, user } = ctx(req);
    assertFeature(studio, 'shop');
    const b = req.body ?? {};
    if (!b.name?.trim() || !(Number(b.priceGrosze) >= 0)) throw badRequest('Podaj nazwę i cenę.');
    const category: ShopCategory = isShopCategory(b.category) ? b.category : 'other';
    const photos = cleanPhotos(scope, b.photos ?? []);
    const nutrition = cleanNutrition(b.nutrition);
    const pid = id();
    scope.run(
      `INSERT INTO shop_products (id, studio_id, category, name, description, price_grosze, status, size_scale, variants_json, media_id, gallery_json, nutrition_json, featured, reward_eligible, created_at)
       VALUES ($id, $studio, $c, $n, $d, $p, $s, $sc, $v, $m, $g, $nu, $f, $r, $now)`,
      {
        id: pid,
        c: category,
        n: b.name.trim().slice(0, 80),
        d: b.description?.trim().slice(0, 2000) || null,
        p: Math.round(Number(b.priceGrosze)),
        s: STATUSES.includes(b.status as (typeof STATUSES)[number]) ? b.status! : 'available',
        sc: isSizeScale(b.sizeScale) ? b.sizeScale : DEFAULT_SCALE[category],
        v: JSON.stringify(cleanVariants(b.variants, category)),
        m: photos[0] ?? null,
        g: JSON.stringify(photos),
        nu: nutrition ? JSON.stringify(nutrition) : null,
        f: Number(!!b.featured),
        r: Number(!!b.rewardEligible),
        now: nowIso(),
      },
    );
    audit(scope, { actorId: user.id, action: 'shop.product_created', entity: 'shop_product', entityId: pid });
    return { id: pid };
  });

  app.put<{ Params: { id: string }; Body: ProductInput }>('/api/staff/shop/products/:id', manage, async (req) => {
    const { scope, user } = ctx(req);
    const p = product(scope, req.params.id);
    const b = req.body ?? {};
    if (b.priceGrosze !== undefined && !(Number(b.priceGrosze) >= 0)) throw badRequest('Nieprawidłowa cena.');
    const category: ShopCategory = isShopCategory(b.category) ? b.category : p.category;
    const variants = b.variants ? cleanVariants(b.variants, category) : (JSON.parse(p.variants_json) as Variant[]);
    const before = photosOf(p);
    const photos = b.photos !== undefined ? cleanPhotos(scope, b.photos) : before;
    const nutrition = b.nutrition !== undefined ? cleanNutrition(b.nutrition) : p.nutrition_json ? (JSON.parse(p.nutrition_json) as Nutrition) : null;
    scope.tx(() => {
      scope.run(
        `UPDATE shop_products SET category = $c, name = $n, description = $d, price_grosze = $p, status = $s, size_scale = $sc, variants_json = $v,
           media_id = $m, gallery_json = $g, nutrition_json = $nu, featured = $f, reward_eligible = $r WHERE studio_id = $studio AND id = $id`,
        {
          c: category,
          n: b.name?.trim().slice(0, 80) || p.name,
          d: b.description !== undefined ? b.description?.trim().slice(0, 2000) || null : p.description,
          p: b.priceGrosze !== undefined ? Math.round(Number(b.priceGrosze)) : p.price_grosze,
          s: STATUSES.includes(b.status as (typeof STATUSES)[number]) ? b.status! : p.status,
          sc: isSizeScale(b.sizeScale) ? b.sizeScale : scaleOf(p),
          v: JSON.stringify(variants),
          m: photos[0] ?? null,
          g: JSON.stringify(photos),
          nu: nutrition ? JSON.stringify(nutrition) : null,
          f: Number(b.featured ?? !!p.featured),
          r: Number(b.rewardEligible ?? !!p.reward_eligible),
          id: p.id,
        },
      );
      // Zdjęcia usunięte z galerii zwalniają miejsce w planie.
      for (const m of before) if (!photos.includes(m)) deleteMedia(scope, m);
    });
    audit(scope, { actorId: user.id, action: 'shop.product_updated', entity: 'shop_product', entityId: p.id, details: { stock: totalStock(variants), photos: photos.length } });
    return { ok: true };
  });

  // Statusy zamówień: gotowe do odbioru (push), odebrane i opłacone na miejscu, wysłane.
  app.post<{ Params: { id: string }; Body: { status: 'ready' | 'collected' | 'shipped' | 'cancelled'; method?: PaymentMethod } }>('/api/staff/shop/orders/:id', manage, async (req) => {
    const { scope, studio, user } = ctx(req);
    const o = scope.get<{ user_id: string | null; status: string; kind: string; items_json: string; total_grosze: number; expires_at: string | null }>('SELECT * FROM shop_orders WHERE studio_id = $studio AND id = $id', { id: req.params.id });
    if (!o) throw notFound();
    const to = req.body?.status;
    scope.tx(() => {
      if (to === 'ready') {
        if (o.user_id) {
          const items = JSON.parse(o.items_json) as Item[];
          const until = (o.expires_at ?? localParts(new Date(), studio.timezone).date).split('-').reverse().slice(0, 2).join('.');
          notify(scope, { userId: o.user_id, category: 'shop', tz: studio.timezone, body: TRIGGERS.pickup_ready.text({ item: items.length === 1 ? `${items[0].name}` : 'Twoje zamówienie', until }), action: 'profile/orders' });
        }
      } else if (to === 'collected') {
        // Płatność na miejscu – studio decyduje, jak ją przyjmuje; zapisujemy tylko ewidencję (4.8.1).
        if (o.kind === 'pickup' && !DESK_METHODS.includes(req.body.method as (typeof DESK_METHODS)[number])) throw badRequest('Jak klientka zapłaciła: gotówka czy terminal?');
      } else if (to === 'cancelled') {
        releaseItems(scope, JSON.parse(o.items_json));
      } else if (to !== 'shipped') throw badRequest('Nieprawidłowy status.');
      scope.run('UPDATE shop_orders SET status = $s, method = COALESCE($m, method), updated_at = $now WHERE studio_id = $studio AND id = $id', { s: to, m: req.body.method ?? null, id: req.params.id, now: nowIso() });
      if (to === 'shipped' && o.user_id) notify(scope, { userId: o.user_id, category: 'shop', tz: studio.timezone, body: 'Twoja paczka ze studia jest w drodze 📦', action: 'profile/orders' });
      audit(scope, { actorId: user.id, action: `shop.order_${to}`, entity: 'shop_order', entityId: req.params.id, subjectUserId: o.user_id });
    });
    return { ok: true };
  });

  // Sprzedaż przy ladzie i barze (bez konta w aplikacji): tylko ewidencja do raportu i zmniejszenie stanu.
  app.post<{ Body: { items: Item[]; method: PaymentMethod } }>('/api/staff/shop/sell', manage, async (req) => {
    const { scope, user } = ctx(req);
    if (!DESK_METHODS.includes(req.body?.method as (typeof DESK_METHODS)[number])) throw badRequest('Wybierz gotówkę albo terminal.');
    if (!Array.isArray(req.body.items) || !req.body.items.length) throw badRequest('Dodaj coś do sprzedaży.');
    const res = scope.tx(() => {
      const r = reserveItems(scope, req.body.items);
      scope.run("INSERT INTO shop_orders (id, studio_id, user_id, kind, status, items_json, total_grosze, method, created_at, updated_at) VALUES ($id, $studio, NULL, 'desk', 'collected', $i, $t, $m, $now, $now)", {
        id: id(),
        i: JSON.stringify(r.items),
        t: r.total,
        m: req.body.method,
        now: nowIso(),
      });
      return r;
    });
    audit(scope, { actorId: user.id, action: 'shop.desk_sale', entity: 'shop_order', details: { total: res.total } });
    return { total: formatPLN(res.total), message: `Sprzedaż ${formatPLN(res.total)} zapisana w ewidencji. Paragon wystawia studio według swoich zasad.` };
  });
}
