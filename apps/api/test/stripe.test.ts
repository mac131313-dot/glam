import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { seal } from '../src/crypto.ts';
import { openDb } from '../src/db.ts';
import { DEMO, seed } from '../src/seed.ts';
import { runJobs } from '../src/services/jobs.ts';
import { formEncode, guardStripeStudios, signStripePayload, verifyStripeSignature } from '../src/services/stripe.ts';
import { ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

// Podstawka Stripe: zapamiętuje wywołania i odpowiada jak API (webhook, domeny, sesja Checkout).
const calls: { url: string; method: string; body: URLSearchParams }[] = [];
const http = (async (url: string | URL | Request, init?: RequestInit) => {
  const body = new URLSearchParams(String(init?.body ?? ''));
  const method = init?.method ?? 'GET';
  calls.push({ url: String(url), method, body });
  const json = (data: object) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  if (String(url).endsWith('/webhook_endpoints')) return json({ id: 'we_1', secret: 'whsec_test' });
  if (String(url).endsWith('/payment_method_domains')) return json({ id: 'pmd_1' });
  if (String(url).endsWith('/checkout/sessions')) return json({ id: `cs_${calls.length}`, url: `https://checkout.stripe.com/c/pay/cs_${calls.length}` });
  if (String(url).endsWith('/customers')) return json({ id: 'cus_1' });
  if (String(url).endsWith('/payment_intents') && method === 'POST') return json({ id: 'pi_renew', status: 'succeeded' });
  if (String(url).includes('/payment_intents/') && method === 'GET') return json({ id: 'pi_sub', payment_method: 'pm_1' });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const db = openDb(':memory:');
const deps = { db, sms: new ConsoleSmsGateway(true), payments: guardStripeStudios(db, new MockPaymentProvider()), exposeDevCodes: true, publicUrl: 'https://app.glam.pl', http };
const app = buildApp(deps);
const R = 'st_rzeszow';
let ip = 0;

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db);
  console.warn = warn;
});

async function login(phone: string): Promise<string> {
  const remoteAddress = `10.1.0.${++ip}`;
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress });
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode }, remoteAddress });
  return r2.json().token;
}

const call = (token: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}`, 'x-studio-id': R } });

const webhook = (event: object, secret = 'whsec_test') => {
  const raw = JSON.stringify(event);
  return app.inject({ method: 'POST', url: `/api/payments/stripe/${R}`, payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(raw, secret) } });
};

test('podpis Stripe: poprawny, zły sekret, przeterminowany', () => {
  const raw = '{"id":"evt_1"}';
  assert.ok(verifyStripeSignature(raw, signStripePayload(raw, 'whsec_a'), 'whsec_a'));
  assert.ok(!verifyStripeSignature(raw, signStripePayload(raw, 'whsec_b'), 'whsec_a'));
  assert.ok(!verifyStripeSignature(raw, signStripePayload(raw, 'whsec_a', Date.now() - 600_000), 'whsec_a'));
  assert.equal(formEncode({ line_items: [{ price_data: { unit_amount: 100 } }] }), 'line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=100');
});

test('Stripe: podpięcie, Checkout, karnet dopiero po webhooku, bez dublowania', async () => {
  const owner = await login(DEMO.owner);
  const connect = await call(owner, 'PUT', '/api/owner/gateway', { provider: 'stripe', apiKey: 'sk_test_123' });
  assert.equal(connect.statusCode, 200, connect.body);
  assert.deepEqual(connect.json().domains, [{ domain: 'app.glam.pl', ok: true }]);

  const magda = await login(DEMO.magda);
  const before = (await call(magda, 'GET', '/api/my/payments')).json().length;
  const buy = await call(magda, 'POST', '/api/purchases', { productId: 'pr_mix8', method: 'apple_pay' });
  assert.equal(buy.statusCode, 200, buy.body);
  const { checkoutId, checkoutUrl } = buy.json();
  assert.match(checkoutUrl, /^https:\/\/checkout\.stripe\.com/);
  const session = calls.find((c) => c.url.endsWith('/checkout/sessions'))!;
  assert.equal(session.body.get('line_items[0][price_data][currency]'), 'pln');
  assert.equal(session.body.get('success_url'), 'https://app.glam.pl/app?checkout={CHECKOUT_SESSION_ID}');

  // Zanim przyjdzie webhook – nic nie zostało wydane.
  assert.equal((await call(magda, 'GET', `/api/checkout/${checkoutId}`)).json().status, 'open');
  assert.equal((await call(magda, 'GET', '/api/my/payments')).json().length, before);

  assert.equal((await webhook({ type: 'checkout.session.completed', data: { object: { id: checkoutId, payment_status: 'paid' } } }, 'whsec_zly')).statusCode, 403);
  const event = { type: 'checkout.session.completed', data: { object: { id: checkoutId, payment_status: 'paid', payment_intent: 'pi_1' } } };
  assert.equal((await webhook(event)).statusCode, 200);
  assert.equal((await webhook(event)).statusCode, 200, 'Stripe ponawia zdarzenia');

  assert.equal((await call(magda, 'GET', `/api/checkout/${checkoutId}`)).json().status, 'paid');
  const payments = (await call(magda, 'GET', '/api/my/payments')).json();
  assert.equal(payments.length, before + 1, 'jeden karnet mimo dwóch zdarzeń');
  assert.equal(payments[0].method, 'apple_pay');
});

test('Stripe: BLIK w drodze nie wydaje karnetu, wygaśnięcie zamyka sesję', async () => {
  const magda = await login(DEMO.magda);
  const { checkoutId } = (await call(magda, 'POST', '/api/purchases', { productId: 'pr_mix8', method: 'blik' })).json();
  await webhook({ type: 'checkout.session.completed', data: { object: { id: checkoutId, payment_status: 'unpaid' } } });
  assert.equal((await call(magda, 'GET', `/api/checkout/${checkoutId}`)).json().status, 'open');
  await webhook({ type: 'checkout.session.expired', data: { object: { id: checkoutId } } });
  assert.equal((await call(magda, 'GET', `/api/checkout/${checkoutId}`)).json().status, 'expired');
});

test('Stripe: symulowana bramka nie wyda niczego za darmo poza Checkout', async () => {
  const guarded = guardStripeStudios(db, new MockPaymentProvider());
  await assert.rejects(guarded.charge({ amountGrosze: 100, method: 'card', description: 'Sklep', studioId: R }), /recepcji/);
  assert.equal((await guarded.charge({ amountGrosze: 100, method: 'saved', description: 'Odnowienie', studioId: R })).status, 'failed');
  assert.equal((await guarded.charge({ amountGrosze: 100, method: 'cash', description: 'Recepcja', studioId: R })).status, 'paid');
});

// ——— Pozostałe zakupy online: Checkout → podpisany webhook → wydanie, bez dublowania ———

const paid = (id: string, pi = `pi_${id}`) => ({ type: 'checkout.session.completed', data: { object: { id, payment_status: 'paid', payment_intent: pi } } });
const lastSession = () => calls.filter((c) => c.url.endsWith('/checkout/sessions')).at(-1)!;
const count = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n;

/** Zakup → sesja Checkout; dwa takie same zdarzenia webhooka (Stripe ponawia) → wydanie raz. */
async function payTwice(checkoutId: string) {
  assert.equal((await webhook(paid(checkoutId))).statusCode, 200);
  assert.equal((await webhook(paid(checkoutId))).statusCode, 200, 'Stripe ponawia zdarzenia');
  assert.equal((db.prepare('SELECT status FROM checkout_sessions WHERE id = ?').get(checkoutId) as { status: string }).status, 'paid');
}

test('Stripe Checkout: sklep – sztuki zablokowane na czas płatności, zamówienie z webhooka, wygaśnięcie oddaje stan', async () => {
  const magda = await login(DEMO.magda);
  const uid = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.magda) as { id: string }).id;
  db.prepare('UPDATE users SET address_enc = ? WHERE id = ?').run(seal('ul. Testowa 1, Rzeszów'), uid);
  const stock = () => JSON.parse((db.prepare("SELECT variants_json FROM shop_products WHERE id = 'sp2'").get() as { variants_json: string }).variants_json)[0].stock as number;
  const orders = () => count("SELECT COUNT(*) AS n FROM shop_orders WHERE user_id = ? AND kind = 'online'", uid);
  const start = stock();

  const buy = await call(magda, 'POST', '/api/shop/orders', { kind: 'online', method: 'google_pay', items: [{ productId: 'sp2', variantId: 'b', qty: 1 }] });
  assert.equal(buy.statusCode, 200, buy.body);
  const { checkoutId, checkoutUrl } = buy.json();
  assert.match(checkoutUrl, /^https:\/\/checkout\.stripe\.com/);
  assert.equal(lastSession().body.get('line_items[0][price_data][unit_amount]'), String(6900 + 1500), 'produkt + wysyłka');
  assert.equal(lastSession().body.get('metadata[kind]'), 'shop');
  assert.equal(stock(), start - 1, 'sztuka zablokowana');
  assert.equal(orders(), 0, 'bez zamówienia przed webhookiem');

  await payTwice(checkoutId);
  assert.equal(orders(), 1, 'jedno zamówienie mimo dwóch zdarzeń');
  assert.equal(count("SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND kind = 'shop' AND provider_ref = ?", uid, `pi_${checkoutId}`), 1);
  assert.match((await call(magda, 'GET', `/api/checkout/${checkoutId}`)).json().message, /Zamówienie opłacone/);

  const again = (await call(magda, 'POST', '/api/shop/orders', { kind: 'online', method: 'blik', items: [{ productId: 'sp2', variantId: 'b', qty: 1 }] })).json();
  assert.equal(stock(), start - 2);
  await webhook({ type: 'checkout.session.expired', data: { object: { id: again.checkoutId } } });
  await webhook({ type: 'checkout.session.expired', data: { object: { id: again.checkoutId } } });
  assert.equal(stock(), start - 1, 'wygasła sesja oddaje sztukę – raz');
  assert.equal(orders(), 1);
});

test('Stripe Checkout: kurs w aplikacji – dostęp dopiero po webhooku', async () => {
  db.exec(`CREATE TEMP TABLE c AS SELECT * FROM courses WHERE id = 'co1';
           UPDATE c SET id = 'co_stripe', price_grosze = 9900, included_product_ids_json = '[]';
           INSERT INTO courses SELECT * FROM c; DROP TABLE c;`);
  db.prepare("INSERT OR REPLACE INTO studio_features (studio_id, flag, enabled) VALUES (?, 'courses_paid', 1)").run(R);
  const ania = await login(DEMO.ania);
  const uid = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.ania) as { id: string }).id;
  const enrolled = () => count("SELECT COUNT(*) AS n FROM course_enrollments WHERE course_id = 'co_stripe' AND user_id = ?", uid);

  const buy = await call(ania, 'POST', '/api/courses/co_stripe/enroll', { method: 'apple_pay', waiveWithdrawal: true });
  assert.equal(buy.statusCode, 200, buy.body);
  const { checkoutId } = buy.json();
  assert.ok(checkoutId, buy.body);
  assert.equal(lastSession().body.get('metadata[kind]'), 'course');
  assert.equal(enrolled(), 0);

  await payTwice(checkoutId);
  assert.equal(enrolled(), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND kind = 'course' AND reference_id = 'co_stripe'", uid), 1);
  assert.equal((await call(ania, 'GET', '/api/courses/co_stripe')).json().access, 'purchase');
});

test('Stripe Checkout: kurs na www – konto i dostęp z webhooka, powrót na stronę kursu', async () => {
  const url = '/api/public/studios/centrum-ruchu/courses/co4/purchase';
  const buyer = { tierId: 't4_std', name: 'Ola Stripe', phone: '511 999 888', email: 'ola@example.com', method: 'blik', acceptTerms: true, waiveWithdrawal: true };
  const r = await app.inject({ method: 'POST', url, payload: buyer });
  assert.equal(r.statusCode, 200, r.body);
  const { checkoutId } = r.json();
  assert.equal(lastSession().body.get('success_url'), 'https://app.glam.pl/s/centrum-ruchu/kurs/co4?checkout={CHECKOUT_SESSION_ID}');
  assert.equal(lastSession().body.get('customer_email'), 'ola@example.com');
  assert.ok(!db.prepare("SELECT 1 FROM users WHERE phone = '+48511999888'").get(), 'konto powstaje dopiero po zapłacie');
  const status = (id: string) => app.inject({ method: 'GET', url: `/api/public/studios/centrum-ruchu/courses/co4/checkout/${id}` });
  assert.equal((await status(checkoutId)).json().status, 'open');

  await payTwice(checkoutId);
  const u = db.prepare("SELECT id, name FROM users WHERE phone = '+48511999888'").get() as { id: string; name: string };
  assert.equal(u.name, 'Ola Stripe');
  assert.equal(count("SELECT COUNT(*) AS n FROM course_enrollments WHERE course_id = 'co4' AND user_id = ? AND tier_id = 't4_std'", u.id), 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND kind = 'course'", u.id), 1);
  const back = (await status(checkoutId)).json();
  assert.equal(back.status, 'paid');
  assert.match(back.message, /\+48 511 999 888/);
  assert.equal((await status('cs_nieznana')).statusCode, 404);
});

test('Stripe Checkout: wydarzenie prywatne – zaliczka opłacona z webhooka', async () => {
  const magda = await login(DEMO.magda);
  const uid = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.magda) as { id: string }).id;
  const at = new Date(Date.now() + 20 * 86_400_000);
  db.prepare(
    `INSERT INTO private_events (id, studio_id, client_id, kind, activity, starts_at, ends_at, guests, status, price_grosze, deposit_grosze, payment_mode, invite_code, terms_accepted_at, created_at, updated_at)
     VALUES ('ev_stripe', ?, ?, 'birthday', 'Stretch', ?, ?, 6, 'confirmed', 70000, 20000, 'deposit', 'EVSTRIPE', ?, ?, ?)`,
  ).run(R, uid, at.toISOString(), new Date(at.getTime() + 5_400_000).toISOString(), at.toISOString(), at.toISOString(), at.toISOString());

  const buy = await call(magda, 'POST', '/api/events/ev_stripe/client', { action: 'pay', method: 'p24' });
  assert.equal(buy.statusCode, 200, buy.body);
  const { checkoutId } = buy.json();
  assert.equal(lastSession().body.get('line_items[0][price_data][unit_amount]'), '20000', 'zaliczka');
  const state = () => (db.prepare("SELECT status FROM private_events WHERE id = 'ev_stripe'").get() as { status: string }).status;
  assert.equal(state(), 'confirmed');

  // P24 / BLIK: completed bez zapłaty, potem async_payment_succeeded – dwa razy.
  await webhook({ type: 'checkout.session.completed', data: { object: { id: checkoutId, payment_status: 'unpaid' } } });
  assert.equal(state(), 'confirmed');
  const ok = { type: 'checkout.session.async_payment_succeeded', data: { object: { id: checkoutId, payment_intent: 'pi_ev' } } };
  await webhook(ok);
  await webhook(ok);
  assert.equal(state(), 'paid');
  assert.equal(count("SELECT COUNT(*) AS n FROM payments WHERE kind = 'event' AND reference_id = 'ev_stripe' AND amount_grosze = 20000"), 1);
});

test('Stripe Checkout: wejściówka dla znajomej – kod z webhooka, bez dublowania', async () => {
  const ania = await login(DEMO.ania);
  const uid = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.ania) as { id: string }).id;
  const gifts = () => count('SELECT COUNT(*) AS n FROM guest_passes WHERE buyer_id = ?', uid);
  const before = gifts();
  const buy = await call(ania, 'POST', '/api/guest-passes', { variantId: 'single', recipientPhone: '600 300 999', method: 'card', message: 'Do zobaczenia!' });
  assert.equal(buy.statusCode, 200, buy.body);
  const { checkoutId } = buy.json();
  assert.equal(lastSession().body.get('metadata[kind]'), 'guest_pass');
  assert.equal(gifts(), before);

  await payTwice(checkoutId);
  assert.equal(gifts(), before + 1);
  const code = (db.prepare('SELECT code FROM guest_passes WHERE buyer_id = ? ORDER BY created_at DESC').get(uid) as { code: string }).code;
  assert.match((await call(ania, 'GET', `/api/checkout/${checkoutId}`)).json().message, new RegExp(code));
});

test('Stripe: subskrypcja zapisuje kartę w Checkout, odnowienie idzie PaymentIntent off_session', async () => {
  const magda = await login(DEMO.magda);
  const uid = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.magda) as { id: string }).id;
  const buy = await call(magda, 'POST', '/api/purchases', { productId: 'pr_sub_week', method: 'apple_pay' });
  assert.equal(buy.statusCode, 200, buy.body);
  const session = lastSession().body;
  assert.equal(session.get('customer'), 'cus_1');
  assert.equal(session.get('customer_email'), null, 'Stripe nie przyjmuje customer razem z customer_email');
  assert.equal(session.get('payment_intent_data[setup_future_usage]'), 'off_session');

  await webhook(paid(buy.json().checkoutId, 'pi_sub'));
  assert.equal((db.prepare('SELECT payment_method_id FROM stripe_customers WHERE studio_id = ? AND user_id = ?').get(R, uid) as { payment_method_id: string }).payment_method_id, 'pm_1');
  const pass = db.prepare("SELECT id FROM passes WHERE user_id = ? AND auto_renew = 1 ORDER BY created_at DESC").get(uid) as { id: string };
  assert.ok(pass, 'karnet z odnowieniem');

  // Okres się kończy – job odnawia zapisaną kartą.
  db.prepare('UPDATE passes SET valid_until = ? WHERE id = ?').run(new Date(Date.now() + 10 * 60_000).toISOString(), pass.id);
  const renewals = () => count("SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND kind = 'renewal'", uid);
  const before = renewals();
  await runJobs(deps);
  await runJobs(deps);
  const pi = calls.filter((c) => c.url.endsWith('/payment_intents') && c.method === 'POST');
  assert.equal(pi.length, 1, 'jedno obciążenie mimo dwóch przebiegów joba');
  assert.equal(pi[0].body.get('off_session'), 'true');
  assert.equal(pi[0].body.get('confirm'), 'true');
  assert.equal(pi[0].body.get('customer'), 'cus_1');
  assert.equal(pi[0].body.get('payment_method'), 'pm_1');
  assert.equal(pi[0].body.get('amount'), '7900');
  assert.equal(renewals(), before + 1);
  assert.equal(count("SELECT COUNT(*) AS n FROM passes WHERE user_id = ? AND source = 'renewal' AND auto_renew = 1", uid), 1);
});
