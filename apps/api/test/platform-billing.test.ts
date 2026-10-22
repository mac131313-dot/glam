// Rozliczenia studiów w konsoli: studio_billing przy rejestracji, wyliczany status, e-maile triala,
// zawieszenie ręczne i karta studia bez danych klientek.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { DEMO, seed } from '../src/seed.ts';
import { syncAccess } from '../src/services/billing.ts';
import { runJobs } from '../src/services/jobs.ts';
import { signStripePayload } from '../src/services/stripe.ts';
import { ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

type Mail = { to: string; subject: string; body: string };
const email = {
  sent: [] as Mail[],
  async send(to: string, subject: string, body: string) {
    this.sent.push({ to, subject, body });
  },
};

/** E-maile rozliczeniowe do adresu (bez linku weryfikacyjnego z rejestracji). */
const billingMails = (to: string) => email.sent.filter((m) => m.to === to && !m.subject.startsWith('Potwierdź'));

// Podstawka Stripe GLAM: zapamiętuje wywołania i odpowiada jak API (klient, Checkout, portal, subskrypcja).
type StripeCall = { path: string; method: string; body: URLSearchParams; auth: string | null };
const stripeCalls: StripeCall[] = [];
let stripeDown = false;
const http = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const path = String(url).replace('https://api.stripe.com/v1', '');
  stripeCalls.push({ path, method, body: new URLSearchParams(String(init?.body ?? '')), auth: new Headers(init?.headers).get('authorization') });
  const json = (data: object, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (stripeDown) return json({ error: { message: 'No such customer: cus_tajne' } }, 400);
  if (path === '/customers' && method === 'POST') return json({ id: `cus_glam_${stripeCalls.length}` });
  if (path === '/checkout/sessions' && method === 'POST') return json({ id: 'cs_glam', url: 'https://checkout.stripe.com/c/pay/cs_glam' });
  if (path === '/billing_portal/sessions' && method === 'POST') return json({ url: 'https://billing.stripe.com/p/session/glam' });
  const sub = path.match(/^\/subscriptions\/(\w+)$/)?.[1];
  if (sub && method === 'GET') return json({ id: sub, items: { data: [{ id: `si_${sub}`, price: { id: 'price_studio' } }] } });
  if (sub && method === 'POST') return json({ id: sub });
  return json({ error: { message: 'not found' } }, 404);
}) as typeof fetch;
const callsTo = (path: string, method = 'POST') => stripeCalls.filter((c) => c.path === path && c.method === method);

const db = openDb(':memory:');
const platformStripe = { secret: 'sk_test_glam', webhookSecret: 'whsec_glam', prices: { start: 'price_start', studio: 'price_studio', siec: 'price_siec' } };
const deps = { db, sms: new ConsoleSmsGateway(true), payments: new MockPaymentProvider(), exposeDevCodes: true, publicUrl: 'https://glam.test', email, http, platformStripe };
const app = buildApp(deps);
const R = 'st_rzeszow';
const DAY = 86_400_000;
let ip = 0;

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db);
  console.warn = warn;
});

async function login(phone: string): Promise<string> {
  const remoteAddress = `10.2.0.${++ip}`;
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress });
  assert.equal(r1.statusCode, 200, r1.body);
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode }, remoteAddress });
  assert.equal(r2.statusCode, 200, r2.body);
  return r2.json().token;
}

const call = (token: string, method: string, url: string, payload?: object, studio = R) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}`, 'x-studio-id': studio } });

/** Rejestruje nowe studio (świeży trial, właścicielka z e-mailem) i zwraca jego id. */
async function signup(phone: string, ownerEmail: string): Promise<string> {
  const remoteAddress = `10.2.0.${++ip}`;
  const code = (await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress })).json().devCode;
  const res = await app.inject({
    method: 'POST',
    url: '/api/signup/studio',
    payload: { studioName: 'Studio Testowe', ownerName: 'Ewa Testowa', phone, code, email: ownerEmail, acceptTerms: true },
    remoteAddress,
  });
  assert.equal(res.statusCode, 200, res.body);
  return res.json().studioId;
}

const studioRow = (studioId: string) => db.prepare('SELECT status, trial_ends_at FROM studios WHERE id = ?').get(studioId) as { status: string; trial_ends_at: string | null };
const audits = (studioId: string, action: string) => db.prepare('SELECT details_json FROM platform_audit WHERE studio_id = ? AND action = ?').all(studioId, action) as { details_json: string | null }[];

test('rejestracja zakłada studio_billing', async () => {
  const studioId = await signup('+48600100201', 'ewa.billing@example.com');
  const row = db.prepare('SELECT state, manual_suspension FROM studio_billing WHERE studio_id = ?').get(studioId) as { state: string; manual_suspension: string | null };
  assert.deepEqual({ ...row }, { state: 'none', manual_suspension: null });
  assert.equal(studioRow(studioId).status, 'trial');
});

test('koniec triala bez karty zawiesza studio i wysyła e-mail', async () => {
  const studioId = await signup('+48600100202', 'ewa.koniec@example.com');
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() - DAY).toISOString(), studioId);
  await runJobs(deps, new Date());
  assert.equal(studioRow(studioId).status, 'suspended');
  const mails = billingMails('ewa.koniec@example.com');
  assert.equal(mails.length, 1);
  assert.match(mails[0]!.subject, /zawieszone/);
  // Kolejny przebieg nie wysyła e-maila drugi raz – status już się nie zmienia.
  await runJobs(deps, new Date());
  assert.equal(billingMails('ewa.koniec@example.com').length, 1);
});

test('przypomnienie 5 dni przed końcem triala', async () => {
  const studioId = await signup('+48600100203', 'ewa.przypomnienie@example.com');
  const now = new Date();
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(now.getTime() + 5 * DAY - 3_600_000).toISOString(), studioId);
  const mails = () => billingMails('ewa.przypomnienie@example.com');
  await runJobs(deps, now);
  assert.equal(mails().length, 1);
  assert.match(mails()[0]!.subject, /5 dni/);
  await runJobs(deps, now);
  assert.equal(mails().length, 1);
  assert.ok(db.prepare('SELECT 1 FROM platform_settings WHERE key = ?').get(`trial-mail:${studioId}:5`));
  assert.equal(studioRow(studioId).status, 'trial');

  // Dzień przed końcem – drugie, osobne przypomnienie (raz).
  const later = new Date(now.getTime() + 4 * DAY + 3_600_000);
  await runJobs(deps, later);
  await runJobs(deps, later);
  assert.equal(mails().length, 2);
  assert.match(mails()[1]!.subject, /jutro/);
});

test('ręczne zawieszenie i odwieszenie', async () => {
  const admin = await login(DEMO.platformAdmin);
  const support = await login(DEMO.platformSupport);
  const magda = await login(DEMO.magda);
  db.prepare('UPDATE users SET email = ? WHERE phone = ?').run('wlascicielka@example.com', DEMO.owner);
  assert.equal((await call(magda, 'GET', '/api/my/payments')).statusCode, 200);

  assert.equal((await call(support, 'POST', `/api/platform/studios/${R}/suspend`, { reason: 'Nieopłacone faktury od 3 mies.' })).statusCode, 403);
  assert.equal((await call(admin, 'POST', `/api/platform/studios/${R}/suspend`, { reason: 'za krótki' })).statusCode, 400);
  assert.equal((await call(admin, 'POST', `/api/platform/studios/nie-ma/suspend`, { reason: 'Nieopłacone faktury od 3 mies.' })).statusCode, 404);

  const before = email.sent.length;
  const res = await call(admin, 'POST', `/api/platform/studios/${R}/suspend`, { reason: 'Nieopłacone faktury od 3 mies.' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(studioRow(R).status, 'suspended');
  assert.deepEqual(audits(R, 'studio.suspend').map((a) => JSON.parse(a.details_json!)), [{ reason: 'Nieopłacone faktury od 3 mies.' }]);
  assert.match(email.sent.slice(before).find((m) => m.to === 'wlascicielka@example.com')?.subject ?? '', /zawieszone/);
  assert.equal((await call(magda, 'GET', '/api/my/payments')).statusCode, 423);

  // Dzienny job nie zdejmuje ręcznego zawieszenia.
  await runJobs(deps, new Date());
  assert.equal(studioRow(R).status, 'suspended');

  assert.equal((await call(support, 'POST', `/api/platform/studios/${R}/unsuspend`)).statusCode, 403);
  assert.equal((await call(admin, 'POST', `/api/platform/studios/${R}/unsuspend`)).statusCode, 200);
  assert.equal(studioRow(R).status, 'active');
  assert.equal(audits(R, 'studio.unsuspend').length, 1);
  assert.equal((await call(magda, 'GET', '/api/my/payments')).statusCode, 200);
});

test('przedłużenie triala przez wsparcie', async () => {
  const studioId = await signup('+48600100204', 'ewa.trial@example.com');
  const support = await login(DEMO.platformSupport);
  const finance = await login(DEMO.platformFinance);
  const was = studioRow(studioId).trial_ends_at!;

  assert.equal((await call(finance, 'POST', `/api/platform/studios/${studioId}/trial`, { days: 7 })).statusCode, 403);
  for (const days of [0, 61, 1.5, 'x']) assert.equal((await call(support, 'POST', `/api/platform/studios/${studioId}/trial`, { days })).statusCode, 400, String(days));

  const res = await call(support, 'POST', `/api/platform/studios/${studioId}/trial`, { days: 7 });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(Date.parse(studioRow(studioId).trial_ends_at!) - Date.parse(was), 7 * DAY);
  assert.equal(audits(studioId, 'studio.trial').length, 1);

  // Po końcu triala przedłużenie liczy się od teraz i zdejmuje zawieszenie.
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() - 10 * DAY).toISOString(), studioId);
  await runJobs(deps, new Date());
  assert.equal(studioRow(studioId).status, 'suspended');
  await call(support, 'POST', `/api/platform/studios/${studioId}/trial`, { days: 3 });
  const row = studioRow(studioId);
  assert.equal(row.status, 'trial');
  assert.ok(Math.abs(Date.parse(row.trial_ends_at!) - (Date.now() + 3 * DAY)) < 60_000);
});

test('karta studia nie zawiera danych klientek', async () => {
  const support = await login(DEMO.platformSupport);
  const res = await call(support, 'GET', `/api/platform/studios/${R}`);
  assert.equal(res.statusCode, 200, res.body);
  const card = res.json();
  assert.equal(card.studio.id, R);
  assert.equal(card.billing.state, 'none');
  assert.equal(card.owner.phone, DEMO.owner);
  assert.ok(Array.isArray(card.usage) && card.usage.length === 5);
  assert.ok(Array.isArray(card.audit));
  assert.ok(typeof card.metrics.requests7d === 'number');
  assert.ok(!res.body.includes('500000005'), 'numer klientki w odpowiedzi');
  assert.ok(!res.body.includes('Magda'), 'imię klientki w odpowiedzi');
  assert.equal((await call(support, 'GET', '/api/platform/studios/nie-ma')).statusCode, 404);
});

test('lista studiów: filtry i sygnały', async () => {
  const studioId = await signup('+48600100205', 'ewa.lista@example.com');
  const admin = await login(DEMO.platformAdmin);
  const list = async (filter?: string) => (await call(admin, 'GET', `/api/platform/studios${filter ? `?filter=${filter}` : ''}`)).json() as { id: string; status: string; billingState: string; signals: string[] }[];
  const find = async (filter?: string) => (await list(filter)).find((s) => s.id === studioId);

  assert.deepEqual((await find('trial'))?.signals, []);
  assert.equal(await find('suspended'), undefined);
  assert.equal((await call(admin, 'GET', '/api/platform/studios?filter=bzdura')).statusCode, 400);

  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() + 3 * DAY).toISOString(), studioId);
  db.prepare("UPDATE studio_billing SET state = 'past_due', past_due_since = ? WHERE studio_id = ?").run(new Date().toISOString(), studioId);
  const hit = await find('past_due');
  assert.equal(hit?.billingState, 'past_due');
  assert.deepEqual(hit?.signals.sort(), ['past_due', 'trial_ending']);
  assert.ok((await list('active')).every((s) => s.status === 'active'));

  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO facilities (id, studio_id, name) VALUES (?, ?, ?)').run(`fac_${i}_${studioId}`, studioId, `Sala ${i}`);
  assert.ok((await find())?.signals.includes('over_limit'));
});

test('demo bez daty końca triala zostaje aktywne po jobach', async () => {
  await runJobs(deps, new Date());
  assert.equal(studioRow(R).status, 'active');
});

test('przedłużenie triala przywraca przypomnienia', async () => {
  const studioId = await signup('+48600100206', 'ewa.ponownie@example.com');
  const support = await login(DEMO.platformSupport);
  const now = new Date();
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(now.getTime() + 5 * DAY - 3_600_000).toISOString(), studioId);
  await runJobs(deps, now);
  assert.equal(billingMails('ewa.ponownie@example.com').length, 1);

  assert.equal((await call(support, 'POST', `/api/platform/studios/${studioId}/trial`, { days: 7 })).statusCode, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM platform_settings WHERE key LIKE ?').get(`trial-mail:${studioId}:%`) as { n: number }).n, 0);

  // Za (nowy koniec − 5 dni) przypomnienie wychodzi ponownie.
  const end = Date.parse(studioRow(studioId).trial_ends_at!);
  const again = new Date(end - 5 * DAY + 3_600_000);
  await runJobs(deps, again);
  await runJobs(deps, again);
  assert.equal(billingMails('ewa.ponownie@example.com').length, 2);
});

test('rozliczenie poza systemem zdejmuje zawieszenie po triale', async () => {
  const studioId = await signup('+48600100207', 'ewa.faktura@example.com');
  const admin = await login(DEMO.platformAdmin);
  const support = await login(DEMO.platformSupport);
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() - DAY).toISOString(), studioId);
  await runJobs(deps, new Date());
  assert.equal(studioRow(studioId).status, 'suspended');

  assert.equal((await call(support, 'POST', `/api/platform/studios/${studioId}/offline-billing`)).statusCode, 403);
  assert.equal((await call(admin, 'POST', '/api/platform/studios/nie-ma/offline-billing')).statusCode, 404);
  const res = await call(admin, 'POST', `/api/platform/studios/${studioId}/offline-billing`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().status, 'active');
  assert.equal(studioRow(studioId).trial_ends_at, null);
  assert.equal(audits(studioId, 'studio.offline_billing').length, 1);
  await runJobs(deps, new Date());
  assert.equal(studioRow(studioId).status, 'active');

  // Ręczne zawieszenie nadal wygrywa.
  await call(admin, 'POST', `/api/platform/studios/${studioId}/suspend`, { reason: 'Spór o fakturę za kwartał' });
  assert.equal(studioRow(studioId).status, 'suspended');
});

test('zawieszenie w trakcie triala i powrót do triala', async () => {
  const studioId = await signup('+48600100208', 'ewa.trwa@example.com');
  const admin = await login(DEMO.platformAdmin);
  assert.equal(studioRow(studioId).status, 'trial');
  assert.equal((await call(admin, 'POST', `/api/platform/studios/${studioId}/suspend`, { reason: 'Podejrzenie nadużycia' })).statusCode, 200);
  assert.equal(studioRow(studioId).status, 'suspended');
  assert.equal((await call(admin, 'POST', `/api/platform/studios/${studioId}/unsuspend`)).statusCode, 200);
  assert.equal(studioRow(studioId).status, 'trial');
});

// ——— Abonament GLAM: Stripe (Checkout, portal, zmiana planu) i webhook ———

const epoch = (ms: number) => Math.floor(ms / 1000);
const isoOf = (sec: number) => new Date(sec * 1000).toISOString();
let evt = 0;
const stripeEvent = (type: string, object: object, id = `evt_glam_${++evt}`) => ({ id, type, data: { object } });
const platformWebhook = (event: object, secret = 'whsec_glam', target = app) => {
  const raw = JSON.stringify(event);
  return target.inject({ method: 'POST', url: '/api/platform/stripe', payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(raw, secret) } });
};
type Billing = { state: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; current_period_end: string | null; past_due_since: string | null; cancel_at_period_end: number; pending_plan_id: string | null; updated_at: string };
const billingRow = (studioId: string) => ({ ...(db.prepare('SELECT * FROM studio_billing WHERE studio_id = ?').get(studioId) as Billing) });
const paymentsOf = (studioId: string) =>
  (db.prepare('SELECT stripe_invoice_id, amount_grosze, plan_id, period_start, period_end FROM platform_payments WHERE studio_id = ?').all(studioId) as { stripe_invoice_id: string; amount_grosze: number; plan_id: string; period_start: string; period_end: string }[]).map((p) => ({ ...p }));
const planOf = (studioId: string) => (db.prepare('SELECT plan_id FROM studios WHERE id = ?').get(studioId) as { plan_id: string | null }).plan_id;

/** Faktura Stripe za okres subskrypcji (PLN w groszach, jak w API Stripe). */
const invoice = (studioId: string, inv: { id: string; amount: number; sub: string; start: number; end: number; price?: string }) => ({
  id: inv.id,
  customer: `cus_${inv.sub}`,
  subscription: inv.sub,
  amount_paid: inv.amount,
  subscription_details: { metadata: { studio_id: studioId } },
  lines: { data: [{ amount: inv.amount, price: { id: inv.price ?? 'price_studio' }, period: { start: inv.start, end: inv.end } }] },
});

/** Nowe studio po trialu, na planie Studio, z subskrypcją założoną przez Checkout (webhook `checkout.session.completed`). */
async function subscribed(phone: string, ownerEmail: string, sub: string): Promise<string> {
  const studioId = await signup(phone, ownerEmail);
  db.prepare("UPDATE studios SET trial_ends_at = ?, plan_id = 'studio' WHERE id = ?").run(new Date(Date.now() - DAY).toISOString(), studioId);
  const res = await platformWebhook(stripeEvent('checkout.session.completed', { id: `cs_${sub}`, mode: 'subscription', client_reference_id: studioId, customer: `cus_${sub}`, subscription: sub, metadata: { studio_id: studioId } }));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(billingRow(studioId).state, 'active');
  assert.equal(studioRow(studioId).status, 'active');
  return studioId;
}

test('checkout wymaga danych do faktury', async () => {
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);
  const trialEnd = Date.now() + 10 * DAY;
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(trialEnd).toISOString(), R);

  assert.equal((await call(magda, 'GET', '/api/owner/billing')).statusCode, 403);
  const none = await call(owner, 'POST', '/api/owner/billing/checkout', { planId: 'studio' });
  assert.equal(none.statusCode, 400, none.body);
  assert.match(none.json().message, /Uzupełnij dane do faktury/);

  const details = { companyName: 'Centrum Ruchu sp. z o.o.', nip: '123-456-32-18', address: 'ul. Długa 1, 35-001 Rzeszów', invoiceEmail: 'faktury@centrum.test' };
  assert.equal((await call(owner, 'PUT', '/api/owner/billing/details', { ...details, nip: '1234563219' })).statusCode, 400);
  assert.equal((await call(owner, 'PUT', '/api/owner/billing/details', { ...details, invoiceEmail: 'faktury@' })).statusCode, 400);
  assert.equal((await call(owner, 'PUT', '/api/owner/billing/details', { ...details, companyName: ' ' })).statusCode, 400);
  const saved = await call(owner, 'PUT', '/api/owner/billing/details', details);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await call(owner, 'POST', '/api/owner/billing/checkout', { planId: 'nie-ma' })).statusCode, 400);

  const res = await call(owner, 'POST', '/api/owner/billing/checkout', { planId: 'studio' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().url, 'https://checkout.stripe.com/c/pay/cs_glam');
  const customer = callsTo('/customers').at(-1)!;
  assert.equal(customer.auth, 'Bearer sk_test_glam');
  assert.equal(customer.body.get('name'), 'Centrum Ruchu sp. z o.o.');
  assert.equal(customer.body.get('email'), 'faktury@centrum.test');
  assert.equal(customer.body.get('metadata[studio_id]'), R);
  const customerId = billingRow(R).stripe_customer_id;
  assert.match(customerId ?? '', /^cus_glam_/);

  const session = callsTo('/checkout/sessions').at(-1)!.body;
  assert.equal(session.get('mode'), 'subscription');
  assert.equal(session.get('customer'), customerId);
  assert.equal(session.get('client_reference_id'), R);
  assert.equal(session.get('line_items[0][price]'), 'price_studio');
  assert.equal(session.get('line_items[0][quantity]'), '1');
  assert.equal(session.get('metadata[studio_id]'), R);
  assert.equal(session.get('subscription_data[metadata][studio_id]'), R);
  assert.equal(session.get('subscription_data[trial_end]'), String(epoch(trialEnd)));
  assert.equal(session.get('success_url'), 'https://glam.test/panel?billing=ok#settings');
  assert.equal(session.get('cancel_url'), 'https://glam.test/panel#settings');

  // Studio spoza triala: bez trial_end, a klient Stripe jest już zapisany – nie zakładamy drugiego.
  db.prepare('UPDATE studios SET trial_ends_at = NULL WHERE id = ?').run(R);
  const customers = callsTo('/customers').length;
  assert.equal((await call(owner, 'POST', '/api/owner/billing/checkout', { planId: 'siec' })).statusCode, 200);
  assert.equal(callsTo('/customers').length, customers);
  const again = callsTo('/checkout/sessions').at(-1)!.body;
  assert.equal(again.get('subscription_data[trial_end]'), null);
  assert.equal(again.get('line_items[0][price]'), 'price_siec');

  const view = await call(owner, 'GET', '/api/owner/billing');
  assert.equal(view.statusCode, 200, view.body);
  const v = view.json();
  assert.equal(v.configured, true);
  assert.equal(v.plan.id, 'studio');
  assert.deepEqual(v.billing, { state: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false, pendingPlanId: null, companyName: details.companyName, nip: '1234563218', address: details.address, invoiceEmail: details.invoiceEmail, hasCard: false });
  assert.equal(v.usage.length, 5);
  assert.deepEqual(v.payments, []);
  assert.deepEqual(v.plans.map((p: { id: string }) => p.id), ['start', 'studio', 'siec']);
  assert.ok(v.plans[0].featureLabels.length > 0 && v.plans[0].limits.staff === 5 && v.plans[0].price === '199 zł');

  // Bez subskrypcji nie ma czego zmieniać ani anulować.
  assert.equal((await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'start' })).statusCode, 409);
  assert.equal((await call(owner, 'POST', '/api/owner/billing/cancel')).statusCode, 409);
});

test('zły podpis webhooka', async () => {
  const event = stripeEvent('invoice.paid', invoice(R, { id: 'in_zly', amount: 39900, sub: 'sub_zly', start: epoch(Date.now()), end: epoch(Date.now() + 30 * DAY) }));
  assert.equal((await platformWebhook(event, 'whsec_obcy')).statusCode, 403);
  const raw = JSON.stringify(event);
  assert.equal((await app.inject({ method: 'POST', url: '/api/platform/stripe', payload: raw, headers: { 'content-type': 'application/json' } })).statusCode, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM platform_stripe_events').get() as { n: number }).n, 0);
  assert.deepEqual(paymentsOf(R), []);
});

test('invoice.paid zapisuje płatność i aktywuje', async () => {
  const studioId = await signup('+48600100301', 'ewa.oplacone@example.com');
  const owner = await login('+48600100301');
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() - 20 * DAY).toISOString(), studioId);
  db.prepare("UPDATE studio_billing SET state = 'past_due', past_due_since = ?, stripe_subscription_id = 'sub_op', stripe_customer_id = 'cus_sub_op' WHERE studio_id = ?").run(new Date(Date.now() - 10 * DAY).toISOString(), studioId);
  await syncAccess(deps, studioId);
  assert.equal(studioRow(studioId).status, 'suspended');

  const start = epoch(Date.now() - DAY);
  const end = epoch(Date.now() + 29 * DAY);
  const res = await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: 'in_op', amount: 39900, sub: 'sub_op', start, end })));
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { received: true });
  assert.deepEqual(paymentsOf(studioId), [{ stripe_invoice_id: 'in_op', amount_grosze: 39900, plan_id: 'studio', period_start: isoOf(start), period_end: isoOf(end) }]);
  const b = billingRow(studioId);
  assert.equal(b.state, 'active');
  assert.equal(b.past_due_since, null);
  assert.equal(b.current_period_end, isoOf(end));
  assert.equal(studioRow(studioId).status, 'active');

  const view = (await call(owner, 'GET', '/api/owner/billing', undefined, studioId)).json();
  assert.equal(view.billing.hasCard, true);
  assert.deepEqual(view.payments.map((p: { amount: string; periodStart: string }) => [p.amount, p.periodStart]), [['399 zł', isoOf(start)]]);
});

test('faktura 0 zł za trial nie trafia na listę', async () => {
  const studioId = await signup('+48600100302', 'ewa.zero@example.com');
  const res = await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: 'in_zero', amount: 0, sub: 'sub_zero', start: epoch(Date.now()), end: epoch(Date.now() + 21 * DAY) })));
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(paymentsOf(studioId), []);
  assert.equal(studioRow(studioId).status, 'trial');
});

test('duplikat zdarzenia', async () => {
  const studioId = await subscribed('+48600100303', 'ewa.duplikat@example.com', 'sub_dup');
  const period = { sub: 'sub_dup', start: epoch(Date.now()), end: epoch(Date.now() + 30 * DAY) };
  const event = stripeEvent('invoice.paid', invoice(studioId, { id: 'in_dup', amount: 39900, ...period }));
  assert.equal((await platformWebhook(event)).statusCode, 200);
  const second = await platformWebhook(event);
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json(), { received: true });
  assert.equal(paymentsOf(studioId).length, 1);
  // Ta sama faktura w innym zdarzeniu (nowe id) też nie dubluje płatności.
  assert.equal((await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: 'in_dup', amount: 39900, ...period })))).statusCode, 200);
  assert.equal(paymentsOf(studioId).length, 1);
});

test('kolejność: subscription.updated przed checkout.session.completed', async () => {
  const studioId = await signup('+48600100304', 'ewa.kolejnosc@example.com');
  const periodEnd = epoch(Date.now() + 30 * DAY);
  const sub = { id: 'sub_ord', customer: 'cus_ord', status: 'active', current_period_end: periodEnd, cancel_at_period_end: false, metadata: { studio_id: studioId } };
  assert.equal((await platformWebhook(stripeEvent('customer.subscription.updated', sub))).statusCode, 200);
  const after = billingRow(studioId);
  assert.equal(after.state, 'active');
  assert.equal(after.stripe_subscription_id, 'sub_ord');
  assert.equal(after.stripe_customer_id, 'cus_ord');
  assert.equal(after.current_period_end, isoOf(periodEnd));

  const done = await platformWebhook(stripeEvent('checkout.session.completed', { id: 'cs_ord', mode: 'subscription', client_reference_id: studioId, customer: 'cus_ord', subscription: 'sub_ord', metadata: { studio_id: studioId, plan_id: 'siec' } }));
  assert.equal(done.statusCode, 200, done.body);
  assert.deepEqual({ ...billingRow(studioId), updated_at: after.updated_at }, after);
  // Plan wybrany przy dodaniu karty obowiązuje od razu.
  assert.equal(planOf(studioId), 'siec');

  // Zaległość: data ustawiana raz, kolejne zdarzenia jej nie przesuwają; powrót do active ją czyści.
  await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, status: 'past_due' }));
  const since = billingRow(studioId).past_due_since;
  assert.ok(since);
  await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, status: 'unpaid' }));
  assert.equal(billingRow(studioId).past_due_since, since);
  assert.equal(billingRow(studioId).state, 'past_due');
  await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, status: 'active', cancel_at_period_end: true }));
  assert.equal(billingRow(studioId).past_due_since, null);
  assert.equal(billingRow(studioId).cancel_at_period_end, 1);

  // Koniec subskrypcji: canceled do końca opłaconego okresu; subskrypcję można potem założyć od nowa.
  const ended = epoch(Date.now() + 5 * DAY);
  await platformWebhook(stripeEvent('customer.subscription.deleted', { ...sub, status: 'canceled', ended_at: ended, metadata: {} }));
  const gone = billingRow(studioId);
  assert.equal(gone.state, 'canceled');
  assert.equal(gone.current_period_end, isoOf(ended));
  assert.equal(gone.stripe_subscription_id, null);

  // Zdarzenie dla nieznanego studia: 200 i bez skutków.
  const stranger = await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, id: 'sub_obce', customer: 'cus_obce', status: 'past_due', metadata: {} }));
  assert.equal(stranger.statusCode, 200);
  assert.deepEqual(billingRow(studioId), gone);
});

test('obniżenie planu od następnego okresu', async () => {
  const studioId = await subscribed('+48600100305', 'ewa.plan@example.com', 'sub_plan');
  const owner = await login('+48600100305');
  const periodEnd = Date.now() + 20 * DAY;
  await platformWebhook(stripeEvent('customer.subscription.updated', { id: 'sub_plan', customer: 'cus_sub_plan', status: 'active', current_period_end: epoch(periodEnd), cancel_at_period_end: false, metadata: { studio_id: studioId } }));

  assert.equal((await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'studio' }, studioId)).statusCode, 400);
  assert.equal((await call(owner, 'POST', '/api/owner/billing/checkout', { planId: 'start' }, studioId)).statusCode, 409);
  const res = await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'start' }, studioId);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { effective: 'next_period' });
  assert.equal(planOf(studioId), 'studio');
  assert.equal(billingRow(studioId).pending_plan_id, 'start');
  const update = callsTo('/subscriptions/sub_plan').at(-1)!.body;
  assert.equal(update.get('items[0][id]'), 'si_sub_plan');
  assert.equal(update.get('items[0][price]'), 'price_start');
  assert.equal(update.get('proration_behavior'), 'none');

  // Faktura za bieżący okres (np. zaległa) nie przełącza planu; dopiero ta za nowy okres.
  await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: 'in_plan_old', amount: 39900, sub: 'sub_plan', start: epoch(periodEnd - 30 * DAY), end: epoch(periodEnd) })));
  assert.equal(planOf(studioId), 'studio');
  await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: 'in_plan_new', amount: 19900, sub: 'sub_plan', start: epoch(periodEnd), end: epoch(periodEnd + 30 * DAY), price: 'price_start' })));
  assert.equal(planOf(studioId), 'start');
  assert.equal(billingRow(studioId).pending_plan_id, null);
  assert.equal(paymentsOf(studioId).find((p) => p.stripe_invoice_id === 'in_plan_new')?.plan_id, 'start');

  // Podwyższenie: od razu, z proporcją.
  const up = await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'siec' }, studioId);
  assert.deepEqual(up.json(), { effective: 'now' });
  assert.equal(planOf(studioId), 'siec');
  const upCall = callsTo('/subscriptions/sub_plan').at(-1)!.body;
  assert.equal(upCall.get('items[0][price]'), 'price_siec');
  assert.equal(upCall.get('proration_behavior'), 'always_invoice');
});

test('obniżenie planu: nowy okres z subscription.updated przed invoice.paid', async () => {
  const studioId = await subscribed('+48600100306', 'ewa.odnowienie@example.com', 'sub_ren');
  const owner = await login('+48600100306');
  const periodEnd = Date.now() + 3 * DAY;
  const sub = { id: 'sub_ren', customer: 'cus_sub_ren', status: 'active', cancel_at_period_end: false, metadata: { studio_id: studioId } };
  await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, current_period_end: epoch(periodEnd) }));
  // Wyższy plan przy czekającym obniżeniu je anuluje; ponowne obniżenie znów czeka.
  assert.deepEqual((await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'start' }, studioId)).json(), { effective: 'next_period' });
  assert.deepEqual((await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'siec' }, studioId)).json(), { effective: 'now' });
  assert.equal(billingRow(studioId).pending_plan_id, null);
  assert.deepEqual((await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'start' }, studioId)).json(), { effective: 'next_period' });
  assert.equal(planOf(studioId), 'siec');

  // Odnowienie: Stripe przesuwa okres, zanim przyśle fakturę.
  await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, current_period_end: epoch(periodEnd + 30 * DAY) }));
  assert.equal(planOf(studioId), 'start');
  await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: 'in_ren', amount: 19900, sub: 'sub_ren', start: epoch(periodEnd), end: epoch(periodEnd + 30 * DAY), price: 'price_start' })));
  assert.equal(planOf(studioId), 'start');
  assert.equal(billingRow(studioId).pending_plan_id, null);
});

test('portal, rezygnacja i wznowienie', async () => {
  const studioId = await subscribed('+48600100307', 'ewa.portal@example.com', 'sub_can');
  const owner = await login('+48600100307');
  const portal = await call(owner, 'POST', '/api/owner/billing/portal', undefined, studioId);
  assert.equal(portal.statusCode, 200, portal.body);
  assert.equal(portal.json().url, 'https://billing.stripe.com/p/session/glam');
  const p = callsTo('/billing_portal/sessions').at(-1)!.body;
  assert.equal(p.get('customer'), 'cus_sub_can');
  assert.equal(p.get('return_url'), 'https://glam.test/panel#settings');

  assert.equal((await call(owner, 'POST', '/api/owner/billing/cancel', undefined, studioId)).statusCode, 200);
  assert.equal(callsTo('/subscriptions/sub_can').at(-1)!.body.get('cancel_at_period_end'), 'true');
  assert.equal(billingRow(studioId).cancel_at_period_end, 1);
  assert.equal((await call(owner, 'POST', '/api/owner/billing/resume', undefined, studioId)).statusCode, 200);
  assert.equal(callsTo('/subscriptions/sub_can').at(-1)!.body.get('cancel_at_period_end'), 'false');
  assert.equal(billingRow(studioId).cancel_at_period_end, 0);

  // Błąd Stripe: 502 z polskim komunikatem, bez treści odpowiedzi Stripe.
  const error = console.error;
  console.error = () => {};
  stripeDown = true;
  try {
    const down = await call(owner, 'POST', '/api/owner/billing/portal', undefined, studioId);
    assert.equal(down.statusCode, 502);
    assert.equal(down.json().error, 'stripe_error');
    assert.equal(down.json().message, 'Płatności chwilowo nie odpowiadają – spróbuj za chwilę.');
    assert.ok(!down.body.includes('cus_tajne'));
  } finally {
    stripeDown = false;
    console.error = error;
  }
});

test('bez konfiguracji Stripe', async () => {
  const bare = buildApp({ ...deps, platformStripe: undefined });
  const owner = await login(DEMO.owner);
  const req = (method: string, url: string, payload?: object) => bare.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${owner}`, 'x-studio-id': R } });
  const view = await req('GET', '/api/owner/billing');
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.json().configured, false);
  assert.equal(view.json().plans.length, 3);
  const calls = stripeCalls.length;
  const actions: [string, object?][] = [['/api/owner/billing/checkout', { planId: 'studio' }], ['/api/owner/billing/portal'], ['/api/owner/billing/plan', { planId: 'start' }], ['/api/owner/billing/cancel'], ['/api/owner/billing/resume']];
  for (const [url, payload] of actions) {
    const res = await req('POST', url, payload);
    assert.equal(res.statusCode, 409, url);
    assert.equal(res.json().error, 'billing_not_configured');
    assert.equal(res.json().message, 'Płatności abonamentu wkrótce');
  }
  assert.equal(stripeCalls.length, calls);
  assert.equal((await req('PUT', '/api/owner/billing/details', { companyName: 'Centrum Ruchu sp. z o.o.', nip: '1234563218', address: 'ul. Długa 1', invoiceEmail: '' })).statusCode, 200);
  assert.equal((await platformWebhook(stripeEvent('invoice.paid', {}), 'whsec_glam', bare)).statusCode, 404);
});

test('nieudana płatność → karencja → zawieszenie', async () => {
  const studioId = await subscribed('+48600100308', 'ewa.karencja@example.com', 'sub_fail');
  const before = billingMails('ewa.karencja@example.com').length;
  const res = await platformWebhook(stripeEvent('invoice.payment_failed', invoice(studioId, { id: 'in_fail', amount: 0, sub: 'sub_fail', start: epoch(Date.now()), end: epoch(Date.now() + 30 * DAY) })));
  assert.equal(res.statusCode, 200, res.body);
  const b = billingRow(studioId);
  assert.equal(b.state, 'past_due');
  assert.ok(b.past_due_since);
  assert.equal(studioRow(studioId).status, 'active');
  const mails = billingMails('ewa.karencja@example.com').slice(before);
  assert.equal(mails.length, 1);
  assert.equal(mails[0]!.subject, 'Płatność za GLAM nie przeszła');
  assert.match(mails[0]!.body, /https:\/\/glam\.test\/panel/);

  await runJobs(deps, new Date(Date.now() + 8 * DAY));
  assert.equal(studioRow(studioId).status, 'suspended');
});
