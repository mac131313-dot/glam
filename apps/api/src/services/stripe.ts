// Stripe Checkout dla studiów z bramką Stripe (decyzja 23): pieniądze idą prosto na konto studia,
// a Apple Pay i Google Pay pokazuje strona Checkout, gdy telefon i przeglądarka je obsługują.
// Bez SDK – kilka wywołań REST przez fetch (projekt działa bez kroku budowania).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { unseal } from '../crypto.ts';
import type { Db } from '../db.ts';
import { HttpError } from '../errors.ts';
import type { PaymentMethod, PaymentProvider } from '../sms.ts';

const API = 'https://api.stripe.com/v1';

export type StripeGateway = { provider: 'stripe'; apiKey: string; webhookSecret?: string; webhookId?: string };
export type Http = typeof fetch;

/** Bramka Stripe studia albo null, gdy studio ma inną bramkę (albo żadnej – wtedy demo). */
export function stripeGateway(db: Db, studioId: string): StripeGateway | null {
  const row = db.prepare('SELECT gateway_enc FROM studios WHERE id = ?').get(studioId) as { gateway_enc: string | null } | undefined;
  const gw = unseal<{ provider: string; apiKey: string; crc?: string; webhookSecret?: string; webhookId?: string }>(row?.gateway_enc);
  if (gw?.provider !== 'stripe') return null;
  return { provider: 'stripe', apiKey: gw.apiKey, webhookSecret: gw.webhookSecret, webhookId: gw.webhookId };
}

/** Stripe przyjmuje form-urlencoded z zagnieżdżeniem a[b][0]=c. */
export function formEncode(params: Record<string, unknown>, prefix = ''): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') {
      const nested = Array.isArray(v) ? Object.fromEntries(v.map((x, i) => [String(i), x])) : (v as Record<string, unknown>);
      const inner = formEncode(nested, key);
      if (inner) parts.push(inner);
    } else parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.join('&');
}

async function call<T>(http: Http, apiKey: string, path: string, params: Record<string, unknown> = {}, method: 'POST' | 'GET' = 'POST'): Promise<T> {
  const body = formEncode(params);
  const res = await http(method === 'GET' && body ? `${API}${path}?${body}` : `${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'POST' ? body : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) throw new HttpError(502, 'stripe_error', 'Bramka płatności nie odpowiedziała. Spróbuj za chwilę.', { stripe: data.error?.message });
  return data;
}

/**
 * Które metody Stripe Checkout ma pokazać dla wyboru klientki w aplikacji.
 * undefined = Stripe sam dobiera metody włączone w panelu studia (wtedy na iPhonie i tak pojawi się Apple Pay).
 */
export function checkoutMethodTypes(method: PaymentMethod): string[] | undefined {
  // TODO(Maciek): zdecyduj, czy wybór w aplikacji zawęża stronę Checkout.
  // Apple Pay i Google Pay to w Stripe portfele typu „card” – nie ma osobnego 'apple_pay'.
  // BLIK i Przelewy24 to osobne typy: 'blik' i 'p24'.
  void method;
  return undefined;
}

export async function createCheckout(
  http: Http,
  gw: StripeGateway,
  input: { amountGrosze: number; name: string; method: PaymentMethod; successUrl: string; cancelUrl: string; email?: string | null; customer?: string; metadata: Record<string, string> },
) {
  const session = await call<{ id: string; url: string }>(http, gw.apiKey, '/checkout/sessions', {
    mode: 'payment',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    // Subskrypcja: karta zostaje przy klientce Stripe do odnowień off_session (Stripe nie przyjmuje wtedy customer_email).
    customer: input.customer,
    customer_email: input.customer ? undefined : (input.email ?? undefined),
    locale: 'pl',
    payment_method_types: checkoutMethodTypes(input.method),
    line_items: [{ quantity: 1, price_data: { currency: 'pln', unit_amount: input.amountGrosze, product_data: { name: input.name } } }],
    metadata: input.metadata,
    payment_intent_data: { metadata: input.metadata, setup_future_usage: input.customer ? 'off_session' : undefined },
    // Sesja żyje 30 min – tyle zwykle trwa „zapłacę za chwilę”, a nie blokuje kuponu na dobę.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  });
  return session;
}

export async function createCustomer(http: Http, gw: StripeGateway, input: { email?: string | null; name?: string | null; metadata: Record<string, string> }) {
  return call<{ id: string }>(http, gw.apiKey, '/customers', { email: input.email ?? undefined, name: input.name ?? undefined, metadata: input.metadata });
}

/** Metoda płatności, którą Checkout zapisał przy PaymentIntent (karta albo portfel Apple Pay / Google Pay). */
export async function paymentIntentMethod(http: Http, gw: StripeGateway, paymentIntentId: string) {
  const pi = await call<{ payment_method?: string | { id: string } | null }>(http, gw.apiKey, `/payment_intents/${encodeURIComponent(paymentIntentId)}`, {}, 'GET');
  return typeof pi.payment_method === 'string' ? pi.payment_method : (pi.payment_method?.id ?? null);
}

/**
 * Odnowienie subskrypcji zapisaną kartą, bez udziału klientki (off_session).
 * Bank może zażądać potwierdzenia (3-D Secure) – wtedy Stripe odrzuca płatność i job prosi klientkę o zakup w aplikacji.
 */
export async function chargeSaved(
  http: Http,
  gw: StripeGateway,
  card: { customerId: string; paymentMethodId: string },
  input: { amountGrosze: number; description: string; metadata: Record<string, string> },
): Promise<{ status: 'paid' | 'failed'; ref: string }> {
  try {
    const pi = await call<{ id: string; status: string }>(http, gw.apiKey, '/payment_intents', {
      amount: input.amountGrosze,
      currency: 'pln',
      customer: card.customerId,
      payment_method: card.paymentMethodId,
      off_session: true,
      confirm: true,
      description: input.description,
      metadata: input.metadata,
    });
    return { status: pi.status === 'succeeded' ? 'paid' : 'failed', ref: pi.id };
  } catch {
    return { status: 'failed', ref: 'stripe_declined' };
  }
}

/**
 * Zwrot na tę samą metodę, którą klientka zapłaciła (karta, Apple Pay, Google Pay, BLIK).
 * Klucz idempotencji = id zwrotu w GLAM: ponowione kliknięcie albo zapytanie nie zwróci pieniędzy dwa razy.
 */
export async function createRefund(http: Http, gw: StripeGateway, input: { paymentIntentId: string; amountGrosze: number; refundId: string; metadata: Record<string, string> }) {
  const res = await http(`${API}/refunds`, {
    method: 'POST',
    headers: { authorization: `Bearer ${gw.apiKey}`, 'content-type': 'application/x-www-form-urlencoded', 'idempotency-key': `glam-refund-${input.refundId}` },
    body: formEncode({ payment_intent: input.paymentIntentId, amount: input.amountGrosze, reason: 'requested_by_customer', metadata: input.metadata }),
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string } };
  // pending = Stripe przyjął zwrot, bank go jeszcze księguje (BLIK, P24) – dla nas to już zlecony zwrot.
  if (!res.ok || !data.id || data.status === 'failed' || data.status === 'canceled') return { ok: false as const, error: data.error?.message ?? data.status ?? 'unknown' };
  return { ok: true as const, ref: data.id };
}

/**
 * Podpięcie Stripe przez właścicielkę: tworzymy webhook (Stripe zwraca jego sekret tylko raz)
 * i rejestrujemy domeny pod Apple Pay / Google Pay, gdyby płatność miała kiedyś być osadzona na stronie studia.
 */
export async function connectStripe(http: Http, apiKey: string, opts: { webhookUrl: string; domains: string[] }) {
  const hook = await call<{ id: string; secret: string }>(http, apiKey, '/webhook_endpoints', {
    url: opts.webhookUrl,
    description: 'GLAM – potwierdzenia płatności',
    // charge.refunded – zwroty zrobione w panelu Stripe (albo przez nas) wracają do historii płatności w GLAM.
    enabled_events: ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired', 'charge.refunded'],
  });
  const domains: { domain: string; ok: boolean }[] = [];
  for (const domain of [...new Set(opts.domains)]) {
    // Już zarejestrowana domena to też sukces – Stripe odpowiada wtedy błędem, który pomijamy.
    const ok = await call(http, apiKey, '/payment_method_domains', { domain_name: domain }).then(
      () => true,
      () => false,
    );
    domains.push({ domain, ok });
  }
  return { webhookId: hook.id, webhookSecret: hook.secret, domains };
}

/** Nagłówek Stripe-Signature: t=<sekundy>,v1=<HMAC-SHA256 z "t.payload">. Okno 5 min chroni przed powtórką. */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = header.split(',').map((p) => p.split('=') as [string, string]);
  const t = Number(parts.find(([k]) => k === 't')?.[1]);
  if (!Number.isFinite(t) || Math.abs(now / 1000 - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
  return parts
    .filter(([k]) => k === 'v1')
    .some(([, sig]) => {
      const got = Buffer.from(sig ?? '', 'hex');
      return got.length === expected.length && timingSafeEqual(got, expected);
    });
}

export function signStripePayload(rawBody: string, secret: string, now = Date.now()) {
  const t = Math.floor(now / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

/**
 * Bezpiecznik: w studiu ze Stripe płatność online idzie wyłącznie przez Checkout (karnety, sklep, kursy,
 * wydarzenia, wejściówki), a odnowienia przez `chargeSaved`. Gdyby nowa ścieżka sprzedaży zawołała jeszcze
 * `charge()`, symulowana bramka wydałaby towar za darmo – dlatego taka próba kończy się odmową.
 */
export function guardStripeStudios(db: Db, inner: PaymentProvider): PaymentProvider {
  return {
    async charge(input) {
      const offline = input.method === 'cash' || input.method === 'terminal';
      if (!offline && input.studioId && stripeGateway(db, input.studioId)) {
        // Odnowienie spoza `chargeSaved` – job zapisze nieudaną próbę i powiadomi klientkę, zamiast wysypać się na wyjątku.
        if (input.method === 'saved') return { status: 'failed', ref: 'stripe_saved_unsupported' };
        throw new HttpError(409, 'checkout_only', 'Tę płatność obsłużysz na razie w recepcji studia.');
      }
      return inner.charge(input);
    },
    refund: inner.refund?.bind(inner),
  };
}
