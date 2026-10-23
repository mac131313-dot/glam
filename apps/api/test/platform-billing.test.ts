// Rozliczenia studiów w konsoli: studio_billing przy rejestracji, wyliczany status, e-maile triala,
// zawieszenie ręczne i karta studia bez danych klientek.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localParts } from '@glam/core';
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
type StripeCall = { path: string; method: string; body: URLSearchParams; auth: string | null; idempotencyKey: string | null };
const stripeCalls: StripeCall[] = [];
let stripeDown = false;
const http = (async (url: string | URL | Request, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  const path = String(url).replace('https://api.stripe.com/v1', '');
  const headers = new Headers(init?.headers);
  stripeCalls.push({ path, method, body: new URLSearchParams(String(init?.body ?? '')), auth: headers.get('authorization'), idempotencyKey: headers.get('idempotency-key') });
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

test('baza sprzed rozliczeń: ręcznie ustawiony status przetrwa pierwsze przeliczenie', async () => {
  // Baza w kształcie sprzed rozliczeń: bez `studio_billing`, status studiów ustawiany ręcznie w konsoli.
  const dir = mkdtempSync(join(tmpdir(), 'glam-legacy-'));
  const file = join(dir, 'glam.db');
  const old = openDb(file);
  const warn = console.warn;
  console.warn = () => {};
  seed(old);
  console.warn = warn;
  const past = new Date(Date.now() - 30 * DAY).toISOString();
  const future = new Date(Date.now() + 10 * DAY).toISOString();
  old.prepare("UPDATE studios SET status = 'active', trial_ends_at = ? WHERE id = 'st_rzeszow'").run(past);
  old.prepare("UPDATE studios SET status = 'suspended', trial_ends_at = ? WHERE id = 'st_krakow'").run(future);
  old.prepare("UPDATE studios SET status = 'suspended', trial_ends_at = NULL WHERE id = 'st_ssg'").run();
  old.exec('DROP TABLE studio_billing');
  old.close();

  const migrated = openDb(file);
  try {
    const mails: Mail[] = [];
    const legacyDeps = { db: migrated, sms: new ConsoleSmsGateway(true), payments: new MockPaymentProvider(), exposeDevCodes: true, email: { async send(to: string, subject: string, body: string) { mails.push({ to, subject, body }); } } };
    const row = (studioId: string) => ({ ...(migrated.prepare('SELECT s.status, s.trial_ends_at, b.manual_suspension FROM studios s LEFT JOIN studio_billing b ON b.studio_id = s.id WHERE s.id = ?').get(studioId) as { status: string; trial_ends_at: string | null; manual_suspension: string | null }) });
    assert.deepEqual(row('st_rzeszow'), { status: 'active', trial_ends_at: null, manual_suspension: null }, 'aktywne po dacie triala = rozliczane poza systemem');
    assert.deepEqual(row('st_krakow'), { status: 'suspended', trial_ends_at: future, manual_suspension: 'Zawieszone przed wprowadzeniem rozliczeń' });
    assert.deepEqual(row('st_ssg'), { status: 'suspended', trial_ends_at: null, manual_suspension: 'Zawieszone przed wprowadzeniem rozliczeń' });
    await runJobs(legacyDeps, new Date());
    assert.equal(row('st_rzeszow').status, 'active');
    assert.equal(row('st_krakow').status, 'suspended');
    assert.equal(row('st_ssg').status, 'suspended');
    assert.equal(mails.filter((m) => /zawieszone/.test(m.subject)).length, 0, 'bez e-maili o zawieszeniu');

    // Kolejne uruchomienie (tabela już jest) niczego nie nadpisuje.
    migrated.prepare("UPDATE studio_billing SET manual_suspension = NULL WHERE studio_id = 'st_krakow'").run();
    migrated.close();
    const again = openDb(file);
    assert.equal((again.prepare("SELECT manual_suspension FROM studio_billing WHERE studio_id = 'st_krakow'").get() as { manual_suspension: string | null }).manual_suspension, null);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
const stripeEvent = (type: string, object: object, id = `evt_glam_${++evt}`, created = epoch(Date.now())) => ({ id, type, created, data: { object } });
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
  assert.deepEqual(v.billing, { state: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false, pendingPlanId: null, pastDueSince: null, companyName: details.companyName, nip: '1234563218', address: details.address, invoiceEmail: details.invoiceEmail, hasCard: false });
  assert.equal(v.usage.length, 5);
  assert.equal(v.payments.length, 1, 'tylko płatność z danych demo (seed)');
  assert.deepEqual(v.plans.map((p: { id: string }) => p.id), ['start', 'studio', 'siec']);
  assert.ok(v.plans[0].featureLabels.length > 0 && v.plans[0].limits.staff === 5 && v.plans[0].price === '199 zł');

  // Bez subskrypcji nie ma czego zmieniać ani anulować.
  assert.equal((await call(owner, 'POST', '/api/owner/billing/plan', { planId: 'start' })).statusCode, 409);
  assert.equal((await call(owner, 'POST', '/api/owner/billing/cancel')).statusCode, 409);
});

test('zły podpis webhooka', async () => {
  const seeded = paymentsOf(R); // płatność z danych demo (seed)
  const event = stripeEvent('invoice.paid', invoice(R, { id: 'in_zly', amount: 39900, sub: 'sub_zly', start: epoch(Date.now()), end: epoch(Date.now() + 30 * DAY) }));
  assert.equal((await platformWebhook(event, 'whsec_obcy')).statusCode, 403);
  const raw = JSON.stringify(event);
  assert.equal((await app.inject({ method: 'POST', url: '/api/platform/stripe', payload: raw, headers: { 'content-type': 'application/json' } })).statusCode, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM platform_stripe_events').get() as { n: number }).n, 0);
  assert.deepEqual(paymentsOf(R), seeded);
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

test('kolejność: spóźnione zdarzenia nie cofają stanu', async () => {
  const studioId = await subscribed('+48600100309', 'ewa.spoznione@example.com', 'sub_late');
  const now = epoch(Date.now());
  const periodEnd = now + 30 * 86_400;

  // Porażka płatności dostarczona po opłaceniu tej samej faktury.
  await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: 'in_late', amount: 39900, sub: 'sub_late', start: now, end: periodEnd })));
  const mails = billingMails('ewa.spoznione@example.com').length;
  assert.equal((await platformWebhook(stripeEvent('invoice.payment_failed', invoice(studioId, { id: 'in_late', amount: 0, sub: 'sub_late', start: now, end: periodEnd })))).statusCode, 200);
  assert.equal(billingRow(studioId).state, 'active');
  assert.equal(billingRow(studioId).past_due_since, null);
  assert.equal(billingMails('ewa.spoznione@example.com').length, mails);

  // Starsze zdarzenie subskrypcji (created wcześniej) dostarczone po nowszym – pomijane w całości.
  const sub = { id: 'sub_late', customer: 'cus_sub_late', status: 'active', current_period_end: periodEnd, cancel_at_period_end: false, metadata: { studio_id: studioId } };
  await platformWebhook(stripeEvent('customer.subscription.updated', sub, undefined, now));
  await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, status: 'past_due', current_period_end: periodEnd + 30 * 86_400 }, undefined, now - 60));
  await platformWebhook(stripeEvent('customer.subscription.deleted', { ...sub, status: 'canceled', ended_at: now - 60 }, undefined, now - 60));
  let b = billingRow(studioId);
  assert.equal(b.state, 'active');
  assert.equal(b.past_due_since, null);
  assert.equal(b.stripe_subscription_id, 'sub_late');
  assert.equal(b.current_period_end, isoOf(periodEnd));

  // Okres nie cofa się, a zdarzenie z tej samej sekundy jest stosowane.
  await platformWebhook(stripeEvent('customer.subscription.updated', { ...sub, current_period_end: periodEnd - 10 * 86_400, cancel_at_period_end: true }, undefined, now));
  b = billingRow(studioId);
  assert.equal(b.current_period_end, isoOf(periodEnd));
  assert.equal(b.cancel_at_period_end, 1);
});

test('anulowana subskrypcja działa do końca okresu, potem zawieszenie', async () => {
  const studioId = await subscribed('+48600100310', 'ewa.anulowane@example.com', 'sub_end');
  const end = Date.now() + 5 * DAY;
  const sub = { id: 'sub_end', customer: 'cus_sub_end', status: 'active', current_period_end: epoch(end), cancel_at_period_end: true, metadata: { studio_id: studioId } };
  await platformWebhook(stripeEvent('customer.subscription.updated', sub));
  assert.equal((await platformWebhook(stripeEvent('customer.subscription.deleted', { ...sub, status: 'canceled', ended_at: epoch(end) }))).statusCode, 200);
  assert.equal(billingRow(studioId).state, 'canceled');
  assert.equal(studioRow(studioId).status, 'active');

  const before = billingMails('ewa.anulowane@example.com').length;
  await runJobs(deps, new Date(end + DAY));
  assert.equal(studioRow(studioId).status, 'suspended');
  const mails = billingMails('ewa.anulowane@example.com').slice(before);
  assert.equal(mails.length, 1);
  assert.match(mails[0]!.subject, /zawieszone/);
});

// ——— Pieniądze: lista do zafakturowania, CSV dla księgowej i przegląd „Dziś” ———

type PaymentRow = { id: string; studio: string; studioId: string; companyName: string | null; nip: string | null; amount: string; amountGrosze: number; periodStart: string; periodEnd: string; paidAt: string; invoicedAt: string | null; invoiceNumber: string | null };

/** Studio na planie Studio z opłaconą fakturą 399 zł i danymi firmy; zwraca id studia i płatności. */
async function paidStudio(phone: string, ownerEmail: string, sub: string, company: string): Promise<{ studioId: string; paymentId: string }> {
  const studioId = await subscribed(phone, ownerEmail, sub);
  db.prepare('UPDATE studio_billing SET company_name = ?, nip = ? WHERE studio_id = ?').run(company, '1234563218', studioId);
  const res = await platformWebhook(stripeEvent('invoice.paid', invoice(studioId, { id: `in_${sub}`, amount: 39900, sub, start: epoch(Date.now()), end: epoch(Date.now() + 30 * DAY) })));
  assert.equal(res.statusCode, 200, res.body);
  const { id } = db.prepare('SELECT id FROM platform_payments WHERE stripe_invoice_id = ?').get(`in_${sub}`) as { id: string };
  return { studioId, paymentId: id };
}

test('płatności: finanse oznaczają fakturę, wsparcie nie ma wstępu', async () => {
  const { studioId, paymentId } = await paidStudio('+48600100401', 'ewa.fv@example.com', 'sub_fv', 'Ruch sp. z o.o.');
  const finance = await login(DEMO.platformFinance);
  const support = await login(DEMO.platformSupport);
  const outsider = await login(DEMO.magda);
  const list = async (query = '') => (await call(finance, 'GET', `/api/platform/payments${query}`)).json() as PaymentRow[];

  assert.equal((await call(support, 'GET', '/api/platform/payments')).statusCode, 403);
  assert.equal((await call(outsider, 'GET', '/api/platform/payments')).statusCode, 403);
  assert.equal((await call(finance, 'GET', '/api/platform/payments?status=bzdura')).statusCode, 400);

  const row = (await list()).find((p) => p.id === paymentId);
  assert.ok(row, 'płatność na liście domyślnej (do zafakturowania)');
  assert.equal(row.studioId, studioId);
  assert.equal(row.studio, 'Studio Testowe');
  assert.equal(row.companyName, 'Ruch sp. z o.o.');
  assert.equal(row.nip, '1234563218');
  assert.equal(row.amount, '399 zł');
  assert.equal(row.amountGrosze, 39900);
  assert.equal(row.invoicedAt, null);
  assert.equal(row.invoiceNumber, null);
  assert.ok(row.periodStart < row.periodEnd && row.paidAt);

  const paidAts = (await list()).map((p) => p.paidAt);
  assert.deepEqual(paidAts, [...paidAts].sort().reverse(), 'od najnowszej');

  const mark = (id: string, payload?: object, token = finance) => call(token, 'POST', `/api/platform/payments/${id}/invoice`, payload);
  assert.equal((await mark(paymentId, { number: 'FV/2026/11/001' }, support)).statusCode, 403);
  assert.equal((await mark(paymentId, {})).statusCode, 400);
  assert.equal((await mark(paymentId, { number: '   ' })).statusCode, 400);
  assert.equal((await mark(paymentId, { number: 'F'.repeat(41) })).statusCode, 400);
  assert.equal((await mark('nie-ma', { number: 'FV/1' })).statusCode, 404);
  assert.equal((await list('?status=uninvoiced')).find((p) => p.id === paymentId)?.invoicedAt, null);

  const ok = await mark(paymentId, { number: '  FV/2026/11/001 ' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await list()).find((p) => p.id === paymentId), undefined, 'znika z do zafakturowania');
  const done = (await list('?status=all')).find((p) => p.id === paymentId)!;
  assert.equal(done.invoiceNumber, 'FV/2026/11/001');
  assert.ok(done.invoicedAt);
  const stored = db.prepare('SELECT invoiced_by FROM platform_payments WHERE id = ?').get(paymentId) as { invoiced_by: string };
  assert.equal(stored.invoiced_by, (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.platformFinance) as { id: string }).id);
  assert.deepEqual(audits(studioId, 'payment.invoiced').map((a) => JSON.parse(a.details_json!)), [{ paymentId, number: 'FV/2026/11/001' }]);

  const again = await mark(paymentId, { number: 'FV/2026/11/002' });
  assert.equal(again.statusCode, 409);
  assert.equal((await list('?status=all')).find((p) => p.id === paymentId)!.invoiceNumber, 'FV/2026/11/001');
  assert.equal(audits(studioId, 'payment.invoiced').length, 1);
});

test('CSV płatności dla księgowej', async () => {
  const { paymentId } = await paidStudio('+48600100402', 'ewa.csv@example.com', 'sub_csv', 'Firma "Ruch"; sp. z o.o.');
  await paidStudio('+48600100403', 'ewa.formula@example.com', 'sub_formula', '=HYPERLINK("http://zlosliwy.test")');
  const finance = await login(DEMO.platformFinance);
  const support = await login(DEMO.platformSupport);
  assert.equal((await call(finance, 'POST', `/api/platform/payments/${paymentId}/invoice`, { number: 'FV/2026/11/001' })).statusCode, 200);

  assert.equal((await call(support, 'GET', '/api/platform/payments.csv')).statusCode, 403);
  assert.equal((await call(finance, 'GET', '/api/platform/payments.csv?from=wczoraj')).statusCode, 400);
  assert.equal((await call(finance, 'GET', '/api/platform/payments.csv?to=2026-02-30')).statusCode, 400);

  const paidAt = (db.prepare('SELECT paid_at FROM platform_payments WHERE id = ?').get(paymentId) as { paid_at: string }).paid_at;
  const day = localParts(new Date(paidAt)).date;
  const res = await call(finance, 'GET', `/api/platform/payments.csv?from=${day}&to=${day}`);
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.headers['content-type'], 'text/csv; charset=utf-8');
  assert.equal(res.headers['content-disposition'], `attachment; filename="glam-platnosci-${day}-${day}.csv"`);
  assert.ok(res.body.startsWith('﻿Data płatności;Studio;Firma;NIP;Okres od;Okres do;Kwota brutto;Nr faktury\r\n'), res.body);
  assert.ok(res.body.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(res.body), 'tylko \\r\\n');
  const lines = res.body.split('\r\n');
  const period = db.prepare('SELECT period_start, period_end FROM platform_payments WHERE id = ?').get(paymentId) as { period_start: string; period_end: string };
  assert.ok(
    lines.includes(`${day};Studio Testowe;"Firma ""Ruch""; sp. z o.o.";1234563218;${localParts(new Date(period.period_start)).date};${localParts(new Date(period.period_end)).date};399,00;FV/2026/11/001`),
    res.body,
  );
  const formula = lines.find((l) => l.includes('HYPERLINK'))!;
  assert.ok(formula.includes(`;"'=HYPERLINK(""http://zlosliwy.test"")";`), formula);
  assert.ok(formula.endsWith(';399,00;'), 'niezafakturowana: pusty numer');

  // Zakres dat odcina inne dni; brak granic oddaje wszystko, także zafakturowane.
  const before = await call(finance, 'GET', '/api/platform/payments.csv?to=2000-01-01');
  assert.equal(before.body, '﻿Data płatności;Studio;Firma;NIP;Okres od;Okres do;Kwota brutto;Nr faktury\r\n');
  assert.equal(before.headers['content-disposition'], 'attachment; filename="glam-platnosci-do-2000-01-01.csv"');
  const all = await call(finance, 'GET', '/api/platform/payments.csv');
  assert.equal(all.headers['content-disposition'], 'attachment; filename="glam-platnosci.csv"');
  assert.ok(all.body.includes('FV/2026/11/001'));
  assert.equal((await call(await login(DEMO.platformAdmin), 'GET', '/api/platform/payments.csv')).statusCode, 200);
});

type Row = { id: string; name: string; hint: string };
type Overview = { mrr: string; mrrGrosze: number; paying: number; byPlan: { plan: string; studios: number; mrr: string }[]; trialsEnding: Row[]; pastDue: Row[]; overLimit: Row[]; overdueTickets: number; openIncidents: number };

test('przegląd „Dziś”: MRR z planów, sygnały i liczniki', async () => {
  const admin = await login(DEMO.platformAdmin);
  const overview = async () => (await call(admin, 'GET', '/api/platform/overview')).json() as Overview;
  for (const phone of [DEMO.platformSupport, DEMO.platformFinance]) assert.equal((await call(await login(phone), 'GET', '/api/platform/overview')).statusCode, 200);
  assert.equal((await call(await login(DEMO.magda), 'GET', '/api/platform/overview')).statusCode, 403);

  const was = await overview();
  const price: Record<string, number> = { start: 19900, studio: 39900, siec: 89900 };
  const active = db.prepare("SELECT s.plan_id FROM studios s JOIN studio_billing b ON b.studio_id = s.id WHERE b.state = 'active'").all() as { plan_id: string | null }[];
  assert.equal(was.mrrGrosze, active.reduce((sum, s) => sum + price[s.plan_id ?? 'studio']!, 0), 'MRR z cen planów');
  assert.equal(was.paying, active.length);

  const studioId = await signup('+48600100404', 'ewa.dzis@example.com');
  db.prepare("UPDATE studios SET plan_id = 'studio' WHERE id = ?").run(studioId);
  db.prepare("UPDATE studio_billing SET state = 'active' WHERE studio_id = ?").run(studioId);
  let now = await overview();
  assert.equal(now.paying, was.paying + 1);
  assert.equal(now.mrrGrosze, was.mrrGrosze + 39900);
  assert.equal(now.mrr, `${now.mrrGrosze / 100} zł`);
  assert.deepEqual(now.byPlan.map((p) => p.plan), ['Start', 'Studio', 'Sieć']);
  assert.equal(now.byPlan[1]!.studios, was.byPlan[1]!.studios + 1);
  assert.equal(now.byPlan.reduce((n, p) => n + p.studios, 0), now.paying);
  assert.equal(now.byPlan[1]!.mrr, `${now.byPlan[1]!.studios * 399} zł`);

  // MRR to plany, nie faktury: zmiana kwoty płatności go nie rusza.
  db.prepare('UPDATE platform_payments SET amount_grosze = 1').run();
  assert.equal((await overview()).mrrGrosze, now.mrrGrosze);

  // Sygnały z krótkim kontekstem; zaległa płatność nie liczy się do płacących.
  const trialEnd = new Date(Date.now() + 3 * DAY);
  db.prepare("UPDATE studios SET trial_ends_at = ?, status = 'trial' WHERE id = ?").run(trialEnd.toISOString(), studioId);
  db.prepare("UPDATE studio_billing SET state = 'past_due', past_due_since = ? WHERE studio_id = ?").run('2026-10-21T10:00:00.000Z', studioId);
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO facilities (id, studio_id, name) VALUES (?, ?, ?)').run(`fac_dzis_${i}`, studioId, `Sala ${i}`);
  now = await overview();
  const [, month, day] = localParts(trialEnd).date.split('-');
  assert.deepEqual(now.trialsEnding.find((r) => r.id === studioId), { id: studioId, name: 'Studio Testowe', hint: `trial do ${day}.${month}` });
  assert.deepEqual(now.pastDue.find((r) => r.id === studioId), { id: studioId, name: 'Studio Testowe', hint: 'zaległość od 21.10' });
  assert.deepEqual(now.overLimit.find((r) => r.id === studioId), { id: studioId, name: 'Studio Testowe', hint: 'limit: Obiekty' });
  assert.equal(now.paying, was.paying);

  // Zgłoszenia po terminie SLA i otwarte incydenty.
  const author = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.owner) as { id: string }).id;
  const ticket = db.prepare("INSERT INTO support_tickets (id, studio_id, author_id, subject, priority, status, sla_due_at, created_at, updated_at) VALUES (?, ?, ?, 'Pytanie', 'normal', ?, ?, ?, ?)");
  const stamp = new Date().toISOString();
  ticket.run('tk_late', studioId, author, 'open', new Date(Date.now() - 3_600_000).toISOString(), stamp, stamp);
  ticket.run('tk_ontime', studioId, author, 'open', new Date(Date.now() + 3_600_000).toISOString(), stamp, stamp);
  ticket.run('tk_closed', studioId, author, 'closed', new Date(Date.now() - 3_600_000).toISOString(), stamp, stamp);
  const incident = db.prepare('INSERT INTO status_incidents (id, component, status, note, started_at, resolved_at) VALUES (?, ?, ?, ?, ?, ?)');
  incident.run('inc_open', 'api', 'degraded', 'Wolniej', stamp, null);
  incident.run('inc_done', 'api', 'outage', 'Było', stamp, stamp);
  const after = await overview();
  assert.equal(after.overdueTickets, now.overdueTickets + 1);
  assert.equal(after.openIncidents, now.openIncidents + 1);
});

type Banner = { text: string; tone: 'info' | 'warn' } | null;

test('pasek w panelu: zawieszone studio wygrywa z pozostałymi sygnałami', async () => {
  const phone = '+48600100504';
  const studioId = await signup(phone, 'ewa.zawieszona@example.com');
  const owner = await login(phone);
  // Trial za 2 dni i zaległa płatność – oba ustępują zawieszeniu.
  db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() + 2 * DAY).toISOString(), studioId);
  db.prepare("UPDATE studio_billing SET state = 'past_due', past_due_since = ?, manual_suspension = 'Spór o fakturę za kwartał' WHERE studio_id = ?").run(new Date().toISOString(), studioId);
  assert.equal(await syncAccess(deps, studioId), 'suspended');
  const res = await call(owner, 'GET', '/api/owner/billing/banner', undefined, studioId);
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(res.json(), { text: 'Studio jest zawieszone – klientki nie mają teraz dostępu. Zobacz Abonament.', tone: 'warn' });
});

test('pasek w panelu: kolejność sygnałów, tylko dla właścicielki', async () => {
  const phone = '+48600100405';
  const studioId = await signup(phone, 'ewa.pasek@example.com');
  const owner = await login(phone);
  const banner = async () => {
    const res = await call(owner, 'GET', '/api/owner/billing/banner', undefined, studioId);
    assert.equal(res.statusCode, 200, res.body);
    return res.json() as Banner;
  };
  const trialIn = (days: number) => db.prepare('UPDATE studios SET trial_ends_at = ? WHERE id = ?').run(new Date(Date.now() + days * DAY).toISOString(), studioId);

  // Recepcja nie widzi paska.
  assert.equal((await call(await login(DEMO.magda), 'GET', '/api/owner/billing/banner')).statusCode, 403);

  // Świeży trial i studio w limitach – bez paska; 6 dni to jeszcze za wcześnie.
  assert.equal(await banner(), null);
  trialIn(6);
  assert.equal(await banner(), null);

  // ≤ 5 dni triala bez karty.
  trialIn(2.5);
  const trial = (await banner())!;
  assert.equal(trial.tone, 'info');
  assert.equal(trial.text, 'Okres próbny kończy się za 3 dni – dodaj kartę, żeby studio działało dalej');
  trialIn(0.4);
  assert.match((await banner())!.text, /za 1 dzień /);

  // Karta dodana – trial już nie niepokoi.
  db.prepare("UPDATE studio_billing SET stripe_subscription_id = 'sub_pasek', state = 'active' WHERE studio_id = ?").run(studioId);
  assert.equal(await banner(), null);

  // Nieudana płatność: data końca karencji = początek zaległości + 7 dni, i wygrywa z triałem.
  trialIn(2);
  const since = new Date(Date.now() - DAY);
  db.prepare("UPDATE studio_billing SET state = 'past_due', past_due_since = ? WHERE studio_id = ?").run(since.toISOString(), studioId);
  const [, month, day] = localParts(new Date(since.getTime() + 7 * DAY)).date.split('-');
  assert.deepEqual(await banner(), { text: `Płatność za GLAM nie przeszła – zaktualizuj kartę do ${day}.${month}`, tone: 'warn' });

  // Przekroczony limit (plan Studio: 2 obiekty).
  db.prepare("UPDATE studio_billing SET state = 'active', past_due_since = NULL WHERE studio_id = ?").run(studioId);
  db.prepare("UPDATE studios SET plan_id = 'studio', trial_ends_at = ? WHERE id = ?").run(new Date(Date.now() - DAY).toISOString(), studioId);
  assert.equal(await banner(), null);
  for (let i = 0; i < 3; i++) db.prepare('INSERT INTO facilities (id, studio_id, name) VALUES (?, ?, ?)').run(`fac_pasek_${i}`, studioId, `Sala ${i}`);
  assert.deepEqual(await banner(), { text: 'Studio przekroczyło limit: Obiekty. Zobacz plany', tone: 'warn' });
});

test('konsola nie zmienia planu, triala ani rozliczeń studia z subskrypcją Stripe', async () => {
  const studioId = await subscribed('+48600100501', 'ewa.stripe@example.com', 'sub_konsola');
  const admin = await login(DEMO.platformAdmin);
  const was = { plan: planOf(studioId), trial: studioRow(studioId).trial_ends_at };

  const plan = await call(admin, 'PUT', `/api/platform/studios/${studioId}`, { planId: 'siec' });
  assert.equal(plan.statusCode, 409, plan.body);
  assert.equal(plan.json().message, 'Studio ma aktywną subskrypcję – plan zmienia właścicielka w Abonamencie.');
  for (const [path, body] of [['/trial', { days: 7 }], ['/offline-billing', undefined]] as const) {
    const res = await call(admin, 'POST', `/api/platform/studios/${studioId}${path}`, body);
    assert.equal(res.statusCode, 409, `${path}: ${res.body}`);
    assert.equal(res.json().message, 'Studio ma aktywną subskrypcję – trial i rozliczenia prowadzi Stripe.');
  }
  assert.deepEqual({ plan: planOf(studioId), trial: studioRow(studioId).trial_ends_at }, was);
  for (const action of ['studio.plan', 'studio.trial', 'studio.offline_billing']) assert.equal(audits(studioId, action).length, 0, action);

  // Po zakończeniu subskrypcji plan znów ustawia konsola.
  assert.equal((await platformWebhook(stripeEvent('customer.subscription.deleted', { id: 'sub_konsola', customer: 'cus_sub_konsola', status: 'canceled', metadata: { studio_id: studioId } }))).statusCode, 200);
  assert.equal((await call(admin, 'PUT', `/api/platform/studios/${studioId}`, { planId: 'siec' })).statusCode, 200);
  assert.equal(planOf(studioId), 'siec');
});

test('dwa kliknięcia „Dodaj kartę” z rzędu: ten sam klucz idempotencji Checkout', async () => {
  const phone = '+48600100502';
  const studioId = await signup(phone, 'ewa.dwaklik@example.com');
  const owner = await login(phone);
  assert.equal((await call(owner, 'PUT', '/api/owner/billing/details', { companyName: 'Studio Dwa Kliki', nip: '1234563218' }, studioId)).statusCode, 200);
  const before = callsTo('/checkout/sessions').length;
  for (let i = 0; i < 2; i++) assert.equal((await call(owner, 'POST', '/api/owner/billing/checkout', { planId: 'studio' }, studioId)).statusCode, 200);
  const [first, second] = callsTo('/checkout/sessions').slice(before).map((c) => c.idempotencyKey);
  assert.match(first ?? '', new RegExp(`^glam-checkout-${studioId}-studio-\\d+$`));
  assert.equal(second, first, 'Stripe zwróci tę samą sesję zamiast drugiej subskrypcji');

  // Inny plan to inna sesja.
  assert.equal((await call(owner, 'POST', '/api/owner/billing/checkout', { planId: 'siec' }, studioId)).statusCode, 200);
  assert.notEqual(callsTo('/checkout/sessions').at(-1)!.idempotencyKey, first);
});

test('druga zakończona sesja Checkout z inną subskrypcją nie nadpisuje bieżącej', async () => {
  const studioId = await subscribed('+48600100503', 'ewa.druga@example.com', 'sub_pierwsza');
  const errors: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => errors.push(args.join(' '));
  try {
    const res = await platformWebhook(stripeEvent('checkout.session.completed', { id: 'cs_druga', mode: 'subscription', client_reference_id: studioId, customer: 'cus_sub_pierwsza', subscription: 'sub_druga', metadata: { studio_id: studioId, plan_id: 'siec' } }));
    assert.equal(res.statusCode, 200, res.body);
  } finally {
    console.error = error;
  }
  assert.equal(billingRow(studioId).stripe_subscription_id, 'sub_pierwsza');
  assert.equal(planOf(studioId), 'studio');
  assert.ok(errors.some((e) => e.includes('sub_pierwsza') && e.includes('sub_druga')), 'oba identyfikatory w logu do ręcznego wyjaśnienia');

  // Po anulowaniu poprzedniej nowa subskrypcja z Checkout zostaje bieżącą.
  db.prepare("UPDATE studio_billing SET state = 'canceled' WHERE studio_id = ?").run(studioId);
  assert.equal((await platformWebhook(stripeEvent('checkout.session.completed', { id: 'cs_trzecia', mode: 'subscription', client_reference_id: studioId, customer: 'cus_sub_pierwsza', subscription: 'sub_trzecia', metadata: { studio_id: studioId, plan_id: 'siec' } }))).statusCode, 200);
  assert.equal(billingRow(studioId).stripe_subscription_id, 'sub_trzecia');
  assert.equal(billingRow(studioId).state, 'active');
  assert.equal(planOf(studioId), 'siec');
});
