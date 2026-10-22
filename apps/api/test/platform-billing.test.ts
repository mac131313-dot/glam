// Rozliczenia studiów w konsoli: studio_billing przy rejestracji, wyliczany status, e-maile triala,
// zawieszenie ręczne i karta studia bez danych klientek.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { DEMO, seed } from '../src/seed.ts';
import { runJobs } from '../src/services/jobs.ts';
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

const db = openDb(':memory:');
const deps = { db, sms: new ConsoleSmsGateway(true), payments: new MockPaymentProvider(), exposeDevCodes: true, publicUrl: 'https://glam.test', email };
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
