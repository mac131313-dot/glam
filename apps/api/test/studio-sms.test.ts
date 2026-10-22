// Twardy limit SMS studia: pula z planu na miesiąc, jedna bramka dla zaproszeń, poleceń, prezentów,
// linków do płatności i powiadomień. Dzienne limity klientki działają przed limitem studia.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { id, openDb } from '../src/db.ts';
import { DEMO, seed } from '../src/seed.ts';
import { dispatch } from '../src/services/dispatch.ts';
import { ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

const db = openDb(':memory:');
const sms = new ConsoleSmsGateway(true);
const deps = { db, sms, payments: new MockPaymentProvider(), exposeDevCodes: true, publicUrl: 'https://glam.test' };
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
  const remoteAddress = `10.3.0.${++ip}`;
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress });
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode }, remoteAddress });
  assert.equal(r2.statusCode, 200, r2.body);
  sms.sent.length = 0; // kod logowania też idzie bramką SMS – liczą się tylko wiadomości studia
  return r2.json().token;
}

const call = (token: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}`, 'x-studio-id': R } });

/** Wpisuje do rozliczeń studia `units` SMS-ów (domyślnie z bieżącego miesiąca). */
function useSms(units: number, createdAt = new Date().toISOString()) {
  db.prepare("INSERT INTO usage_log (id, studio_id, kind, units, cost_grosze, created_at) VALUES (?, ?, 'sms', ?, ?, ?)").run(id(), R, units, units * 9, createdAt);
}
const smsRows = () => (db.prepare("SELECT COUNT(*) AS n FROM usage_log WHERE studio_id = ? AND kind = 'sms'").get(R) as { n: number }).n;

beforeEach(() => {
  db.prepare("DELETE FROM usage_log WHERE kind = 'sms'").run();
  db.prepare('DELETE FROM client_sms_log').run();
  db.prepare('DELETE FROM session_invites').run();
  db.prepare("UPDATE studios SET plan_id = 'start' WHERE id = ?").run(R);
  sms.sent.length = 0;
});

const upcomingSession = () =>
  (db.prepare("SELECT id FROM class_sessions WHERE studio_id = ? AND status = 'scheduled' AND public = 1 AND starts_at > ? ORDER BY starts_at LIMIT 1").get(R, new Date().toISOString()) as { id: string }).id;

test('wyczerpana pula SMS: zaproszenie znajomej odpada z 429, nic nie wychodzi i nie jest liczone', async () => {
  const ania = await login(DEMO.ania);
  useSms(300);
  const res = await call(ania, 'POST', `/api/sessions/${upcomingSession()}/invite`, { phone: '600 800 101' });
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(res.json().error, 'studio_sms_limit');
  const code = (db.prepare('SELECT invite_code FROM studios WHERE id = ?').get(R) as { invite_code: string }).invite_code;
  assert.equal(res.json().message, `Studio wykorzystało w tym miesiącu pulę SMS. Podaj znajomej kod studia: ${code}.`);
  assert.deepEqual(sms.sent, []);
  assert.equal(smsRows(), 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM session_invites').get() as { n: number }).n, 0);
});

test('299 z 300 SMS-ów: ostatnie zaproszenie wychodzi i trafia do rozliczeń po cenie z cennika', async () => {
  const ania = await login(DEMO.ania);
  useSms(299);
  const res = await call(ania, 'POST', `/api/sessions/${upcomingSession()}/invite`, { phone: '600 800 102' });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(sms.sent.length, 1);
  assert.equal(smsRows(), 2);
  const last = db.prepare("SELECT units, cost_grosze FROM usage_log WHERE studio_id = ? AND kind = 'sms' ORDER BY rowid DESC LIMIT 1").get(R) as { units: number; cost_grosze: number };
  assert.deepEqual({ ...last }, { units: 1, cost_grosze: 9 });
  // Kolejne już się nie mieści.
  assert.equal((await call(ania, 'POST', `/api/sessions/${upcomingSession()}/invite`, { phone: '600 800 103' })).statusCode, 429);
  assert.equal(sms.sent.length, 1);
});

test('SMS-y z poprzedniego miesiąca nie zajmują puli', async () => {
  const ania = await login(DEMO.ania);
  const now = new Date();
  useSms(300, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 3_600_000).toISOString());
  const res = await call(ania, 'POST', `/api/sessions/${upcomingSession()}/invite`, { phone: '600 800 104' });
  assert.equal(res.statusCode, 200, res.body);
});

test('dzienny limit klientki liczy się przed limitem studia', async () => {
  const ania = await login(DEMO.ania);
  for (let n = 0; n < 5; n++) assert.equal((await call(ania, 'POST', `/api/sessions/${upcomingSession()}/invite`, { phone: `600 800 20${n}` })).statusCode, 200);
  useSms(300);
  const res = await call(ania, 'POST', `/api/sessions/${upcomingSession()}/invite`, { phone: '600 800 209' });
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().error, 'sms_limit');
});

test('polecenie SMS-em przy wyczerpanej puli: 429 bez zapisu polecenia', async () => {
  const ania = await login(DEMO.ania);
  useSms(300);
  const before = (db.prepare('SELECT COUNT(*) AS n FROM referrals').get() as { n: number }).n;
  const res = await call(ania, 'POST', '/api/referrals', { phone: '600 800 301', channel: 'sms' });
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(res.json().error, 'studio_sms_limit');
  assert.deepEqual(sms.sent, []);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM referrals').get() as { n: number }).n, before);
  // Link do udostępnienia (bez SMS) nadal działa.
  assert.equal((await call(ania, 'POST', '/api/referrals', { phone: '600 800 302', channel: 'link' })).statusCode, 200);
});

test('prezent przy wyczerpanej puli: wejściówka powstaje, SMS nie wychodzi, odpowiedź podaje kod', async () => {
  const ania = await login(DEMO.ania);
  useSms(300);
  const res = await call(ania, 'POST', '/api/guest-passes', { recipientPhone: '600 800 401', method: 'card' });
  assert.equal(res.statusCode, 200, res.body);
  assert.ok(res.json().code);
  assert.match(res.json().message, /pul[aę] SMS/i);
  assert.deepEqual(sms.sent, []);
  assert.equal(smsRows(), 1);
});

test('link do płatności z recepcji przy wyczerpanej puli: 429 z linkiem do skopiowania', async () => {
  const reception = await login(DEMO.reception);
  const magda = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.magda) as { id: string }).id;
  const product = (db.prepare('SELECT id FROM products WHERE studio_id = ? AND published = 1 LIMIT 1').get(R) as { id: string }).id;
  useSms(300);
  const res = await call(reception, 'POST', `/api/staff/clients/${magda}/passes`, { productId: product, method: 'link' });
  assert.equal(res.statusCode, 429, res.body);
  assert.equal(res.json().message, 'Pula SMS na ten miesiąc się skończyła. Skopiuj link i wyślij go klientce.');
  assert.match(res.json().details.link, /^https:\/\/glam\.test\/zaplac\/\w+$/);
  assert.deepEqual(sms.sent, []);
  // Link jest ważny – można go przekazać klientce inaczej niż SMS-em.
  assert.ok(db.prepare("SELECT 1 FROM payment_links WHERE studio_id = ? AND token = ? AND status = 'open'").get(R, res.json().details.link.split('/').pop()));
  // Gdy pula wystarcza, SMS wychodzi i jest liczony.
  db.prepare("DELETE FROM usage_log WHERE kind = 'sms'").run();
  const ok = await call(reception, 'POST', `/api/staff/clients/${magda}/passes`, { productId: product, method: 'link' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(sms.sent.length, 1);
  assert.equal(smsRows(), 1);
});

test('dispatch: powiadomienie SMS przy wyczerpanej puli nie wysyła SMS-a ani nie zapisuje zużycia', async () => {
  const user = db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.magda) as { id: string };
  const now = new Date();
  const add = () => {
    const nid = id();
    db.prepare("INSERT INTO notifications (id, studio_id, user_id, category, body, status, channel, deliver_at, created_at) VALUES (?, ?, ?, 'courses', 'Do zobaczenia jutro', 'sent', 'sms', ?, ?)").run(nid, R, user.id, now.toISOString(), now.toISOString());
    return nid;
  };
  useSms(300);
  const blocked = add();
  await dispatch(deps, new Date(now.getTime() + 1000));
  assert.deepEqual(sms.sent, []);
  assert.equal(smsRows(), 1);
  assert.ok((db.prepare('SELECT pushed_at FROM notifications WHERE id = ?').get(blocked) as { pushed_at: string | null }).pushed_at, 'powiadomienie jest oznaczone jako obsłużone');

  db.prepare("DELETE FROM usage_log WHERE kind = 'sms'").run();
  add();
  await dispatch(deps, new Date(now.getTime() + 2000));
  assert.equal(sms.sent.length, 1);
  assert.equal(smsRows(), 1);
});
