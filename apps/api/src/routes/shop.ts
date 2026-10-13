// Sklep studia (4.8.1, S1–S4): katalog merchu z wariantami i stanem, zakup online z wysyłką, rezerwacja do odbioru
// z płatnością na miejscu (sztuka zablokowana na X dni), potwierdzenie odbioru w recepcji. Aplikacja nie wystawia
// paragonów ani faktur za merch – zapisuje tylko ewidencję do raportu właścicielki.
import type { FastifyInstance } from 'fastify';
import { formatPLN, localParts, reservationExpiry, returnStock, takeStock, totalStock, TRIGGERS, variantLabel, type Variant } from '@glam/core';
import { assertFeature, ctx, requirePerm, requireStudio, type Deps } from '../context.ts';
import { unseal } from '../crypto.ts';
import { id, nowIso } from '../db.ts';
import { HttpError, badRequest, conflict, notFound } from '../errors.ts';
import type { StudioScope } from '../scope.ts';
import { DESK_METHODS, PAYMENT_METHODS, type PaymentMethod } from '../sms.ts';
import { audit } from '../services/audit.ts';
import { storeMedia } from '../services/media.ts';
import { notify } from '../services/notify.ts';
import { priceWithCoupon } from '../services/payments.ts';

type ProductRow = { id: string; name: string; description: string | null; price_grosze: number; status: 'available' | 'sold_out' | 'hidden'; variants_json: string; media_id: string | null; reward_eligible: number };
type Item = { productId: string; variantId: string; qty: number; name?: string; variant?: string; price?: number };

function product(scope: StudioScope, pid: string) {
  const p = scope.get<ProductRow>('SELECT * FROM shop_products WHERE studio_id = $studio AND id = $id', { id: pid });
  if (!p) throw notFound('Nie znaleziono produktu.');
  return p;
}

const view = (p: ProductRow) => {
  const variants = JSON.parse(p.variants_json) as Variant[];
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: formatPLN(p.price_grosze),
    priceGrosze: p.price_grosze,
    status: totalStock(variants) === 0 && p.status === 'available' ? 'sold_out' : p.status,
    variants: variants.map((v) => ({ ...v, label: variantLabel(v) })),
    photoUrl: p.media_id ? `/api/public-media/${p.media_id}` : null,
    rewardEligible: !!p.reward_eligible,
  };
};

/** Rezerwuje sztuki (stan ↓) dla pozycji zamówienia – w jednej transakcji, żeby nie sprzedać tego samego dwa razy. */
function reserveItems(scope: StudioScope, items: Item[]): { items: Item[]; total: number } {
  let total = 0;
  const out: Item[] = [];
  for (const it of items) {
    if (!(Number.isInteger(it.qty) && it.qty >= 1 && it.qty <= 10)) throw badRequest('Ilość od 1 do 10.');
    const p = product(scope, it.productId);
    if (p.status === 'hidden') throw notFound('Ten produkt nie jest już dostępny.');
    let variants: Variant[];
    try {
      variants = takeStock(JSON.parse(p.variants_json), it.variantId, it.qty);
    } catch (e) {
      throw conflict('stock', `${p.name}: ${(e as Error).message}`);
    }
    scope.run('UPDATE shop_products SET variants_json = $v, status = CASE WHEN $left = 0 THEN \'sold_out\' ELSE status END WHERE studio_id = $studio AND id = $id', { v: JSON.stringify(variants), left: totalStock(variants), id: p.id });
    const v = variants.find((x) => x.id === it.variantId)!;
    total += p.price_grosze * it.qty;
    out.push({ ...it, name: p.name, variant: variantLabel(v), price: p.price_grosze });
  }
  return { items: out, total };
}

function releaseItems(scope: StudioScope, items: Item[]) {
  for (const it of items) {
    const p = scope.get<ProductRow>('SELECT * FROM shop_products WHERE studio_id = $studio AND id = $id', { id: it.productId });
    if (!p) continue;
    const variants = returnStock(JSON.parse(p.variants_json), it.variantId, it.qty);
    scope.run("UPDATE shop_products SET variants_json = $v, status = CASE WHEN status = 'sold_out' THEN 'available' ELSE status END WHERE studio_id = $studio AND id = $id", { v: JSON.stringify(variants), id: p.id });
  }
}

export function shopRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const member = { preHandler: requireStudio(db) };
  const manage = requirePerm(db, 'shop.manage');

  app.get('/api/shop', member, async (req) => {
    const { scope, studio } = ctx(req);
    assertFeature(studio, 'shop');
    return {
      settings: { reservationDays: studio.settings.shop.reservationDays, shipping: studio.settings.shop.shipping, shippingPrice: formatPLN(studio.settings.shop.shippingGrosze) },
      products: scope.all<ProductRow>("SELECT * FROM shop_products WHERE studio_id = $studio AND status != 'hidden' ORDER BY created_at DESC").map(view),
    };
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
    } else if (b.kind !== 'pickup') throw badRequest('Wybierz wysyłkę albo odbiór w studiu.');
    const today = localParts(new Date(), studio.timezone).date;
    // Najpierw blokujemy sztuki, potem płatność; nieudana płatność zwraca je na stan.
    const reserved = scope.tx(() => reserveItems(scope, b.items));
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
        exp: b.kind === 'pickup' ? reservationExpiry(today, studio.settings.shop.reservationDays) : null,
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
    for (const s of staff) notify(scope, { userId: s.user_id, category: 'shop', tz: studio.timezone, body: b.kind === 'pickup' ? `Nowa rezerwacja do odbioru (${reserved.items.length} poz.).` : 'Nowe zamówienie z wysyłką.', action: 'staff/shop' });
    return {
      id: oid,
      total: formatPLN(total),
      message: b.kind === 'pickup' ? `Zarezerwowane do ${reservationExpiry(today, studio.settings.shop.reservationDays).split('-').reverse().slice(0, 2).join('.')}. Zapłacisz w recepcji – damy znać, gdy będzie czekać.` : 'Zamówienie opłacone. Damy znać, gdy wyślemy paczkę.',
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

  // ——— Panel: katalog, stany, zamówienia, odbiory i sprzedaż przy kasie (S1, S4) ———

  app.get('/api/staff/shop', manage, async (req) => {
    const { scope } = ctx(req);
    return {
      products: scope.all<ProductRow>('SELECT * FROM shop_products WHERE studio_id = $studio ORDER BY created_at DESC').map(view),
      orders: scope
        .all<{ items_json: string; total_grosze: number; address_enc: string | null }>(
          `SELECT o.id, o.kind, o.status, o.items_json, o.total_grosze, o.method, o.address_enc, o.expires_at, o.created_at, u.name, u.phone FROM shop_orders o LEFT JOIN users u ON u.id = o.user_id
           WHERE o.studio_id = $studio ORDER BY o.status IN ('collected', 'shipped', 'cancelled', 'expired'), o.created_at DESC LIMIT 100`,
        )
        .map(({ address_enc, ...o }) => ({ ...o, items: JSON.parse(o.items_json), total: formatPLN(o.total_grosze), address: unseal(address_enc) })),
    };
  });

  app.post<{ Body: { name: string; description?: string; priceGrosze: number; variants: { size?: string; color?: string; stock: number }[]; photo?: string | null; rewardEligible?: boolean; status?: string } }>(
    '/api/staff/shop/products',
    { ...manage, bodyLimit: 5 * 1024 * 1024 },
    async (req) => {
      const { scope, studio, user } = ctx(req);
      assertFeature(studio, 'shop');
      const b = req.body;
      if (!b?.name?.trim() || !(b.priceGrosze >= 0)) throw badRequest('Podaj nazwę i cenę.');
      const variants = (b.variants?.length ? b.variants : [{ stock: 0 }]).map((v) => ({ id: id().slice(0, 8), size: v.size?.trim() || null, color: v.color?.trim() || null, stock: Math.max(0, Math.round(v.stock || 0)) }));
      const media = b.photo ? storeMedia(scope, studio, { dataUrl: b.photo, kind: 'shop', ownerId: user.id, allow: ['image'] }) : null;
      const pid = id();
      scope.run(
        'INSERT INTO shop_products (id, studio_id, name, description, price_grosze, status, variants_json, media_id, reward_eligible, created_at) VALUES ($id, $studio, $n, $d, $p, $s, $v, $m, $r, $now)',
        { id: pid, n: b.name.trim().slice(0, 80), d: b.description?.slice(0, 1000) ?? null, p: Math.round(b.priceGrosze), s: ['available', 'sold_out', 'hidden'].includes(b.status ?? '') ? b.status! : 'available', v: JSON.stringify(variants), m: media?.id ?? null, r: Number(!!b.rewardEligible), now: nowIso() },
      );
      audit(scope, { actorId: user.id, action: 'shop.product_created', entity: 'shop_product', entityId: pid });
      return { id: pid };
    },
  );

  app.put<{ Params: { id: string }; Body: { name?: string; description?: string; priceGrosze?: number; status?: 'available' | 'sold_out' | 'hidden'; variants?: Variant[]; rewardEligible?: boolean } }>('/api/staff/shop/products/:id', manage, async (req) => {
    const { scope, user } = ctx(req);
    const p = product(scope, req.params.id);
    const b = req.body ?? {};
    const variants = b.variants ? b.variants.map((v) => ({ id: v.id || id().slice(0, 8), size: v.size || null, color: v.color || null, stock: Math.max(0, Math.round(v.stock || 0)) })) : JSON.parse(p.variants_json);
    scope.run('UPDATE shop_products SET name = $n, description = $d, price_grosze = $p, status = $s, variants_json = $v, reward_eligible = $r WHERE studio_id = $studio AND id = $id', {
      n: b.name?.trim() || p.name,
      d: b.description !== undefined ? b.description : p.description,
      p: b.priceGrosze ?? p.price_grosze,
      s: b.status ?? p.status,
      v: JSON.stringify(variants),
      r: Number(b.rewardEligible ?? !!p.reward_eligible),
      id: p.id,
    });
    audit(scope, { actorId: user.id, action: 'shop.product_updated', entity: 'shop_product', entityId: p.id, details: { stock: totalStock(variants) } });
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

  // Sprzedaż przy ladzie (bez konta w aplikacji): tylko ewidencja do raportu i zmniejszenie stanu.
  app.post<{ Body: { items: Item[]; method: PaymentMethod } }>('/api/staff/shop/sell', manage, async (req) => {
    const { scope, user } = ctx(req);
    if (!DESK_METHODS.includes(req.body?.method as (typeof DESK_METHODS)[number])) throw badRequest('Wybierz gotówkę albo terminal.');
    const res = scope.tx(() => {
      const r = reserveItems(scope, req.body.items ?? []);
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
    return { total: formatPLN(res.total), message: 'Sprzedaż zapisana w ewidencji. Paragon wystawia studio według swoich zasad.' };
  });
}
