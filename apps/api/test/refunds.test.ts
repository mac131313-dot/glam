import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { DEMO, seed } from '../src/seed.ts';
import { guardStripeStudios, signStripePayload } from '../src/services/stripe.ts';
import { ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

// Podstawka Stripe: Checkout, webhook i zwroty. failRefund = bramka odrzuca zwrot.
const calls: { url: string; body: URLSearchParams; headers: Record<string, string> }[] = [];
let failRefund = false;
const http = (async (url: string | URL | Request, init?: RequestInit) => {
  const body = new URLSearchParams(String(init?.body ?? ''));
  calls.push({ url: String(url), body, headers: (init?.headers ?? {}) as Record<string, string> });
  const json = (data: object, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (String(url).endsWith('/webhook_endpoints')) return json({ id: 'we_1', secret: 'whsec_test' });
  if (String(url).endsWith('/payment_method_domains')) return json({ id: 'pmd_1' });
  if (String(url).endsWith('/checkout/sessions')) return json({ id: `cs_${calls.length}`, url: `https://checkout.stripe.com/c/pay/cs_${calls.length}` });
  if (String(url).endsWith('/refunds')) return failRefund ? json({ error: { message: 'charge_already_refunded' } }, 400) : json({ id: `re_${calls.length}`, status: 'succeeded' });
  return new Response('{}', { status: 404 });
}) as typeof fetch;

const db = openDb(':memory:');
const app = buildApp({ db, sms: new ConsoleSmsGateway(true), payments: guardStripeStudios(db, new MockPaymentProvider()), exposeDevCodes: true, publicUrl: 'https://app.glam.pl', http });
const R = 'st_rzeszow';
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
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode }, remoteAddress });
  return r2.json().token;
}

const call = (token: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}`, 'x-studio-id': R } });

const userId = (phone: string) => (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string }).id;
const passOf = (paymentId: string) => db.prepare('SELECT p.id, p.status, p.product_name, p.auto_renew FROM payments x JOIN passes p ON p.id = x.reference_id WHERE x.id = ?').get(paymentId) as { id: string; status: string; product_name: string };
const lastPayment = (uid: string) => (db.prepare("SELECT id FROM payments WHERE studio_id = ? AND user_id = ? AND kind = 'pass' ORDER BY created_at DESC, rowid DESC").get(R, uid) as { id: string }).id;

const webhook = (event: object) => {
  const raw = JSON.stringify(event);
  return app.inject({ method: 'POST', url: `/api/payments/stripe/${R}`, payload: raw, headers: { 'content-type': 'application/json', 'stripe-signature': signStripePayload(raw, 'whsec_test') } });
};

test('zwrot z panelu: tylko właścicielka, limit wpłaty, karnet anulowany i znika z rezerwacji', async () => {
  const owner = await login(DEMO.owner);
  const reception = await login(DEMO.reception);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, 'POST', '/api/purchases', { productId: 'pr_r9', method: 'blik' })).statusCode, 200);
  const pay = lastPayment(userId(DEMO.magda));

  const quote = (await call(owner, 'GET', `/api/owner/payments/${pay}/refund`)).json();
  assert.equal(quote.maxGrosze, 52000);
  assert.equal(quote.passName, 'Pilates Reformer 9');

  assert.equal((await call(reception, 'POST', `/api/owner/payments/${pay}/refund`, { amountGrosze: 100 })).statusCode, 403, 'recepcja nie zwraca');
  assert.equal((await call(owner, 'POST', `/api/owner/payments/${pay}/refund`, { amountGrosze: 60000 })).statusCode, 400, 'nie więcej niż wpłata');

  const res = await call(owner, 'POST', `/api/owner/payments/${pay}/refund`, { amountGrosze: 52000, reason: 'Kupiony przez pomyłkę' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(passOf(pay).status, 'cancelled');
  assert.equal((await call(owner, 'POST', `/api/owner/payments/${pay}/refund`, { amountGrosze: 100 })).json().error, 'nothing_to_refund');

  const passes = (await call(magda, 'GET', '/api/my/passes')).json() as { id: string; status: string }[];
  assert.equal(passes.find((p) => p.id === passOf(pay).id)?.status, 'cancelled');

  const fin = (await call(owner, 'GET', '/api/owner/finance')).json();
  assert.equal(fin.refunds.n, 1);
  assert.equal(fin.payments.find((p: { id: string }) => p.id === pay).refunded, fin.refunds.amount);
});

test('gotówka z recepcji: zwrot tylko zapisany do wydania w kasie', async () => {
  const owner = await login(DEMO.owner);
  const ania = userId(DEMO.ania);
  assert.equal((await call(owner, 'POST', `/api/staff/clients/${ania}/passes`, { productId: 'pr_gym', method: 'cash' })).statusCode, 200);
  const pay = lastPayment(ania);
  const q = (await call(owner, 'GET', `/api/owner/payments/${pay}/refund`)).json();
  assert.equal(q.channel, 'manual');
  const res = (await call(owner, 'POST', `/api/owner/payments/${pay}/refund`, { amountGrosze: 14900 })).json();
  assert.match(res.message, /gotówka/);
});

test('podmiana karnetu: tańszy – zwrot różnicy, droższy – dopłata w recepcji', async () => {
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);
  const uid = userId(DEMO.magda);
  await call(magda, 'POST', '/api/purchases', { productId: 'pr_mix8', method: 'blik' });
  const pay = lastPayment(uid);
  const oldPass = passOf(pay).id;

  const swap = await call(owner, 'POST', `/api/owner/passes/${oldPass}/swap`, { userId: uid, productId: 'pr_p4', refundDifference: true });
  assert.equal(swap.statusCode, 200, swap.body);
  assert.match(swap.json().message, /Różnica 140 zł wraca/);
  assert.equal((db.prepare('SELECT status FROM passes WHERE id = ?').get(oldPass) as { status: string }).status, 'cancelled');
  assert.equal(passOf(pay).product_name, 'Pilates 4 zajęcia', 'płatność przypięta do nowego karnetu');
  assert.equal(passOf(pay).status, 'active');

  const up = (await call(owner, 'POST', `/api/owner/passes/${passOf(pay).id}/swap`, { userId: uid, productId: 'pr_r9' })).json();
  assert.match(up.message, /Do dopłaty 260 zł/);
});

test('Stripe: zwrot przez API z kluczem idempotencji, webhook nie dubluje, zwrot z panelu Stripe dopisany', async () => {
  const owner = await login(DEMO.owner);
  assert.equal((await call(owner, 'PUT', '/api/owner/gateway', { provider: 'stripe', apiKey: 'sk_test_123' })).statusCode, 200);
  const magda = await login(DEMO.magda);
  const { checkoutId } = (await call(magda, 'POST', '/api/purchases', { productId: 'pr_mix8', method: 'apple_pay' })).json();
  await webhook({ type: 'checkout.session.completed', data: { object: { id: checkoutId, payment_status: 'paid', payment_intent: 'pi_42' } } });
  const pay = (db.prepare("SELECT id FROM payments WHERE provider_ref = 'pi_42'").get() as { id: string }).id;

  failRefund = true;
  assert.equal((await call(owner, 'POST', `/api/owner/payments/${pay}/refund`, { amountGrosze: 10000 })).json().error, 'refund_failed');
  assert.equal((await call(owner, 'GET', `/api/owner/payments/${pay}/refund`)).json().maxGrosze, 40000, 'nieudany zwrot nie blokuje kwoty');
  failRefund = false;

  assert.equal((await call(owner, 'POST', `/api/owner/payments/${pay}/refund`, { amountGrosze: 10000 })).statusCode, 200);
  const refund = calls.filter((c) => c.url.endsWith('/refunds')).at(-1)!;
  assert.equal(refund.body.get('payment_intent'), 'pi_42');
  assert.equal(refund.body.get('amount'), '10000');
  assert.match(refund.headers['idempotency-key'], /^glam-refund-/);

  await webhook({ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_42', amount_refunded: 10000 } } });
  assert.equal((await call(owner, 'GET', `/api/owner/payments/${pay}/refund`)).json().maxGrosze, 30000, 'nasz zwrot nie liczy się drugi raz');

  await webhook({ type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: 'pi_42', amount_refunded: 40000 } } });
  assert.equal((await call(owner, 'GET', `/api/owner/payments/${pay}/refund`)).json().maxGrosze, 0, 'reszta zwrócona w panelu Stripe');
});
