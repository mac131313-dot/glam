// Wydarzenia w studiu (panel → Treści → Wydarzenia): ogłoszenie z powiadomieniem do wszystkich klientek,
// edycja (powiadomienie tylko na życzenie), odwołanie, walidacja terminu i dostęp tylko dla właścicielki.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import type { Deps } from '../src/context.ts';
import { openDb } from '../src/db.ts';
import { parseAnnouncement } from '../src/routes/announcements.ts';
import { DEMO, seed } from '../src/seed.ts';
import { ConsoleEmailSender, ConsolePushSender, ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

const db = openDb(':memory:');
const deps: Deps = { db, sms: new ConsoleSmsGateway(true), payments: new MockPaymentProvider(), email: new ConsoleEmailSender(true), push: new ConsolePushSender(true), exposeDevCodes: true, publicUrl: 'http://localhost:5173' };
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
  const r = await app.inject({ method: 'POST', url: '/api/dev/login', payload: { phone }, remoteAddress: `10.3.0.${++ip}` });
  if (r.statusCode !== 404) return r.json().token;
  const a = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress: `10.3.1.${++ip}` });
  return (await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: a.json().devCode } })).json().token;
}

const call = (token: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}`, origin: 'http://localhost', host: 'localhost', 'x-studio-id': R } });

const inAWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
const sentAbout = (text: string) => (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE studio_id = ? AND body LIKE ?').get(R, `%${text}%`) as { n: number }).n;

test('formularz: nazwa, dzień, godziny od–do i termin w przyszłości', () => {
  const tz = 'Europe/Warsaw';
  assert.equal(parseAnnouncement({ title: 'ab', date: inAWeek(), from: '18:00', to: '19:30' }, tz), 'Wpisz nazwę wydarzenia.');
  assert.equal(parseAnnouncement({ title: 'Spotkanie', date: '', from: '18:00', to: '19:30' }, tz), 'Wybierz dzień.');
  assert.equal(parseAnnouncement({ title: 'Spotkanie', date: inAWeek(), from: '18', to: '19:30' }, tz), 'Wpisz godziny od–do, np. 18:00 i 19:30.');
  assert.equal(parseAnnouncement({ title: 'Spotkanie', date: inAWeek(), from: '19:30', to: '18:00' }, tz), 'Koniec musi być po początku.');
  assert.match(parseAnnouncement({ title: 'Spotkanie', date: '2020-01-01', from: '18:00', to: '19:30' }, tz) as string, /już by się skończyło/);
  const ok = parseAnnouncement({ title: ' Spotkanie z trenerką ', date: '2026-12-04', from: '18:00', to: '19:30' }, tz, new Date('2026-10-01T00:00:00Z'));
  assert.deepEqual(ok, { title: 'Spotkanie z trenerką', description: null, place: null, startsAt: '2026-12-04T17:00:00.000Z', endsAt: '2026-12-04T18:30:00.000Z' });
});

test('właścicielka dodaje wydarzenie – powiadomienie do każdej klientki; zmiana i odwołanie', async () => {
  const owner = await login(DEMO.owner);
  const title = 'Spotkanie z Trenerką Anią';
  const created = await call(owner, 'POST', '/api/owner/announcements', { title, description: 'Rozmowa o oddechu i herbata.', place: 'Sala 2', date: inAWeek(), from: '18:00', to: '19:30' });
  assert.equal(created.statusCode, 200, created.body);
  const list = (await call(owner, 'GET', '/api/owner/announcements')).json();
  const item = list.items.find((x: { id: string }) => x.id === created.json().id);
  assert.ok(list.audience > 0);
  assert.equal(item.notifiedCount, list.audience, 'powiadomienie do wszystkich klientek studia');
  assert.equal(sentAbout(`${title} – `), list.audience);
  assert.match(item.when, /18:00–19:30 · Sala 2$/);
  assert.equal(item.from, '18:00');

  // Poprawka bez powiadomienia nie wysyła nic; z zaznaczonym – „Zmiana: …”.
  const fix = await call(owner, 'POST', `/api/owner/announcements/${item.id}`, { title, place: 'Sala 1', date: inAWeek(), from: '18:00', to: '19:30' });
  assert.equal(fix.statusCode, 200, fix.body);
  assert.equal(sentAbout('Zmiana: '), 0);
  await call(owner, 'POST', `/api/owner/announcements/${item.id}`, { title, place: 'Sala 1', date: inAWeek(), from: '18:30', to: '20:00', notify: true });
  assert.equal(sentAbout('Zmiana: '), list.audience);

  const cancel = await call(owner, 'POST', `/api/owner/announcements/${item.id}/cancel`, { notify: true });
  assert.equal(cancel.statusCode, 200, cancel.body);
  assert.equal(sentAbout('Odwołane: '), list.audience);
  const after = (await call(owner, 'GET', '/api/owner/announcements')).json().items.find((x: { id: string }) => x.id === item.id);
  assert.equal(after.status, 'cancelled');
  assert.equal((await call(owner, 'POST', `/api/owner/announcements/${item.id}`, { title, date: inAWeek(), from: '18:00', to: '19:30' })).statusCode, 400);
});

test('bez powiadomienia, gdy właścicielka je odznaczy; recepcja ma dostęp, klientka nie', async () => {
  const owner = await login(DEMO.owner);
  const before = (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE studio_id = ?').get(R) as { n: number }).n;
  const quiet = await call(owner, 'POST', '/api/owner/announcements', { title: 'Dzień otwarty', date: inAWeek(), from: '10:00', to: '14:00', notify: false });
  assert.equal(quiet.statusCode, 200, quiet.body);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE studio_id = ?').get(R) as { n: number }).n, before);
  assert.equal((await call(await login(DEMO.reception), 'GET', '/api/owner/announcements')).statusCode, 200);
  assert.equal((await call(await login(DEMO.magda), 'POST', '/api/owner/announcements', { title: 'Hack', date: inAWeek(), from: '10:00', to: '11:00' })).statusCode, 403);
});
