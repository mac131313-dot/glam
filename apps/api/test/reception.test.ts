// Wejście w recepcji (4.11, C3): dopisanie „z ulicy” jednym kliknięciem, ponowny skan bez błędu,
// wejściówka od znajomej zeskanowana z QR i aktywowana przy ladzie.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { canWalkIn } from '@glam/core';
import { buildApp } from '../src/app.ts';
import type { Deps } from '../src/context.ts';
import { openDb } from '../src/db.ts';
import { guestPassCodeOf } from '../src/routes/staff.ts';
import { DEMO, seed } from '../src/seed.ts';
import { ConsoleEmailSender, ConsolePushSender, ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

const db = openDb(':memory:');
const deps: Deps = { db, sms: new ConsoleSmsGateway(true), payments: new MockPaymentProvider(), email: new ConsoleEmailSender(true), push: new ConsolePushSender(true), exposeDevCodes: true, publicUrl: 'http://localhost:5173' };
const app = buildApp(deps);
const R = 'st_rzeszow';
let ip = 0;
let walkInSession = '';

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db);
  console.warn = warn;
  // Zajęcia za 20 minut, na które Magda się nie zapisała – i żadnych jej rezerwacji w oknie check-inu.
  const now = Date.now();
  const trainer = (db.prepare("SELECT trainer_id FROM class_sessions WHERE studio_id = ? AND class_type_id = 'ct_reformer' LIMIT 1").get(R) as { trainer_id: string }).trainer_id;
  walkInSession = 'cs_walkin';
  db.prepare("INSERT INTO class_sessions (id, studio_id, class_type_id, trainer_id, starts_at, ends_at, capacity) VALUES (?, ?, 'ct_reformer', ?, ?, ?, 8)").run(
    walkInSession,
    R,
    trainer,
    new Date(now + 20 * 60_000).toISOString(),
    new Date(now + 75 * 60_000).toISOString(),
  );
  db.prepare(
    "UPDATE bookings SET status = 'cancelled' WHERE user_id = (SELECT id FROM users WHERE phone = ?) AND session_id IN (SELECT id FROM class_sessions WHERE starts_at BETWEEN ? AND ?)",
  ).run(DEMO.magda, new Date(now - 3 * 3_600_000).toISOString(), new Date(now + 4 * 3_600_000).toISOString());
});

async function login(phone: string): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/dev/login', payload: { phone }, remoteAddress: `10.2.0.${++ip}` });
  if (r.statusCode !== 404) return r.json().token;
  const a = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress: `10.2.1.${++ip}` });
  return (await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: a.json().devCode } })).json().token;
}

const call = (token: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}`, origin: 'http://localhost', host: 'localhost', 'x-studio-id': R } });

test('kod wejściówki rozpoznany z linku i z samego kodu; kod klientki i telefon – nie', () => {
  assert.equal(guestPassCodeOf('https://glam.app/app?wejsciowka=ab23cd45'), 'AB23CD45');
  assert.equal(guestPassCodeOf('AB23CD45'), 'AB23CD45');
  assert.equal(guestPassCodeOf('GLAM1.u_005.2026-10-15.abc'), null);
  assert.equal(guestPassCodeOf('500600700'), null);
});

test('okno wejścia bez rezerwacji: wolne miejsce i zajęcia tuż przed / tuż po starcie', () => {
  const now = new Date('2026-10-15T18:00:00Z');
  assert.equal(canWalkIn(new Date('2026-10-15T18:20:00Z'), now, 2), true);
  assert.equal(canWalkIn(new Date('2026-10-15T18:20:00Z'), now, 0), false);
  assert.equal(canWalkIn(new Date('2026-10-15T17:30:00Z'), now, 3), false);
});

test('bez rezerwacji: recepcja dostaje propozycję zajęć, dopisuje i wpuszcza; drugi skan to „już odhaczona”', async () => {
  const magda = await login(DEMO.magda);
  const reception = await login(DEMO.reception);
  const code = (await call(magda, 'GET', '/api/my/checkin-code')).json().code;

  const first = await call(reception, 'POST', '/api/staff/checkin', { code });
  assert.equal(first.statusCode, 409, first.body);
  assert.equal(first.json().error, 'no_booking');
  const option = first.json().details.options.find((o: { sessionId: string }) => o.sessionId === walkInSession);
  assert.ok(option, 'zajęcia za 20 min są na liście');
  assert.equal(option.covered, true);
  assert.equal(first.json().details.name, 'Magda');

  const walkIn = await call(reception, 'POST', '/api/staff/checkin', { code, sessionId: walkInSession });
  assert.equal(walkIn.statusCode, 200, walkIn.body);
  assert.equal(walkIn.json().kind, 'class');
  const b = db.prepare("SELECT status, source FROM bookings WHERE session_id = ? AND user_id = (SELECT id FROM users WHERE phone = ?)").get(walkInSession, DEMO.magda) as { status: string; source: string };
  assert.deepEqual({ ...b }, { status: 'attended', source: 'desk' });

  const arrivals = (await call(reception, 'GET', '/api/staff/arrivals')).json();
  assert.equal(arrivals[0].name, 'Magda', 'najnowsze wejście na górze listy obecnych');
  assert.match(arrivals[0].what, /Reformer/);

  const again = await call(reception, 'POST', '/api/staff/checkin', { code });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(again.json().kind, 'already');
});

test('wejściówka od znajomej: skan QR z kasy → imię i telefon → aktywna i wpuszczona', async () => {
  const reception = await login(DEMO.reception);
  const sold = await call(reception, 'POST', '/api/staff/guest-passes', { method: 'cash' });
  assert.equal(sold.statusCode, 200, sold.body);
  const qr = `http://localhost:5173/app?wejsciowka=${sold.json().code}`;

  const ask = await call(reception, 'POST', '/api/staff/checkin', { code: qr });
  assert.equal(ask.statusCode, 409, ask.body);
  assert.equal(ask.json().error, 'guest_pass_new');

  const go = await call(reception, 'POST', '/api/staff/checkin', { code: qr, guest: { name: 'Kasia', phone: '511 222 333' } });
  assert.ok(go.statusCode === 200 || go.json().error === 'no_booking', go.body);
  const gp = db.prepare('SELECT status, activated_by FROM guest_passes WHERE code = ?').get(sold.json().code) as { status: string; activated_by: string };
  assert.equal(gp.status, 'activated');
  assert.equal((db.prepare('SELECT phone FROM users WHERE id = ?').get(gp.activated_by) as { phone: string }).phone, '+48511222333');
  assert.notEqual(go.json().kind, 'zone', 'aktywacja nie zużywa wejścia na strefę bez wyboru recepcji');
  assert.equal(db.prepare('SELECT 1 FROM zone_checkins WHERE user_id = ?').get(gp.activated_by), undefined);

  const rescan = await call(reception, 'POST', '/api/staff/checkin', { code: qr });
  assert.notEqual(rescan.json().error, 'guest_pass_new');
});

test('pomyłkowa sprzedaż karnetu w recepcji: cofnięta znika z konta i z raportu; użytego karnetu nie cofniesz', async () => {
  const reception = await login(DEMO.reception);
  const magda = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.magda) as { id: string }).id;
  const product = (
    db
      .prepare("SELECT p.id FROM products p JOIN product_versions v ON v.id = p.current_version_id WHERE p.studio_id = ? AND p.published = 1 AND p.channels_json LIKE '%desk%' AND v.rules_json NOT LIKE '%introOnly%' LIMIT 1")
      .get(R) as { id: string }
  ).id;
  const sell = () => call(reception, 'POST', `/api/staff/clients/${magda}/passes`, { productId: product, method: 'cash' });
  const paid = () => (db.prepare("SELECT COUNT(*) AS n FROM payments WHERE studio_id = ? AND status = 'paid'").get(R) as { n: number }).n;

  const before = paid();
  const sold = await sell();
  assert.equal(sold.statusCode, 200, sold.body);
  const passId = sold.json().passId as string;
  const card = (await call(reception, 'GET', `/api/staff/clients/${magda}`)).json();
  assert.equal(card.passes.find((p: { id: string }) => p.id === passId)?.canUndo, true);

  const undo = await call(reception, 'DELETE', `/api/staff/clients/${magda}/passes/${passId}`);
  assert.equal(undo.statusCode, 200, undo.body);
  assert.equal(db.prepare('SELECT 1 FROM passes WHERE id = ?').get(passId), undefined);
  assert.equal(paid(), before, 'cofnięta sprzedaż nie liczy się do przychodu');
  assert.equal((db.prepare("SELECT status FROM payments WHERE reference_id = ?").get(passId) as { status: string }).status, 'voided');

  const second = (await sell()).json().passId as string;
  db.prepare("UPDATE bookings SET pass_id = ? WHERE id = (SELECT id FROM bookings WHERE user_id = ? LIMIT 1)").run(second, magda);
  const blocked = await call(reception, 'DELETE', `/api/staff/clients/${magda}/passes/${second}`);
  assert.equal(blocked.statusCode, 409, blocked.body);
  assert.equal(blocked.json().error, 'cannot_undo');
});

test('historia płatności w aplikacji recepcji: lista bez sum przychodu; trenerka jej nie widzi', async () => {
  const reception = await login(DEMO.reception);
  const res = await call(reception, 'GET', '/api/staff/payments?days=92');
  assert.equal(res.statusCode, 200, res.body);
  const { payments: list, more } = res.json() as { payments: { amount: string; amount_grosze?: number; created_at: string }[]; more: boolean };
  assert.equal(more, false);
  assert.ok(list.length > 0);
  assert.match(list[0].amount, /zł/);
  assert.equal(list[0].amount_grosze, undefined);
  assert.ok(list.every((p, i) => i === 0 || list[i - 1].created_at >= p.created_at), 'najnowsze na górze');
  assert.equal((await call(await login(DEMO.marzena), 'GET', '/api/staff/payments')).statusCode, 403);
});

test('klientka pisze do recepcji: jedno powiadomienie na rozmowę i tylko w godzinach recepcji', async () => {
  const kasia = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.reception) as { id: string }).id;
  const magda = await login(DEMO.magda);
  const pings = () => (db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE studio_id = ? AND user_id = ? AND body LIKE '%napisała do recepcji%'").get(R, kasia) as { n: number }).n;
  const setHours = (slots: { weekday: number; from: string; to: string }[]) => {
    const row = db.prepare('SELECT settings_json FROM studios WHERE id = ?').get(R) as { settings_json: string | null };
    const settings = row.settings_json ? JSON.parse(row.settings_json) : {};
    settings.support = { ...settings.support, hours: { from: '00:00', to: '00:00', weekdays: [], slots } };
    db.prepare('UPDATE studios SET settings_json = ? WHERE id = ?').run(JSON.stringify(settings), R);
  };
  db.prepare('UPDATE chat_messages SET read_at = ? WHERE studio_id = ? AND read_at IS NULL').run(new Date().toISOString(), R);

  setHours([0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, from: '00:00', to: '23:59' })));
  const before = pings();
  assert.equal((await call(magda, 'POST', '/api/chat', { body: 'Dzień dobry, mam pytanie o karnet' })).statusCode, 200);
  assert.equal((await call(magda, 'POST', '/api/chat', { body: 'I jeszcze jedno' })).statusCode, 200);
  assert.equal(pings(), before + 1, 'druga wiadomość w tej samej rozmowie nie dzwoni drugi raz');

  db.prepare('UPDATE chat_messages SET read_at = ? WHERE studio_id = ? AND read_at IS NULL').run(new Date().toISOString(), R);
  setHours([]);
  assert.equal((await call(magda, 'POST', '/api/chat', { body: 'Piszę wieczorem' })).statusCode, 200);
  assert.equal(pings(), before + 1, 'poza godzinami recepcji tylko autoodpowiedź, bez powiadomienia');
});

test('lista klientek: przychód widzi tylko właścicielka; dane bramki płatności – też tylko ona', async () => {
  const owner = await login(DEMO.owner);
  const reception = await login(DEMO.reception);
  const trainer = await login(DEMO.marzena);
  const asOwner = (await call(owner, 'GET', '/api/owner/clients')).json().clients as { revenue?: string }[];
  const asDesk = (await call(reception, 'GET', '/api/owner/clients')).json().clients as { revenue?: string }[];
  assert.ok(asOwner.length > 0 && asOwner.every((c) => typeof c.revenue === 'string'));
  assert.ok(asDesk.length === asOwner.length && asDesk.every((c) => c.revenue === undefined));

  const saved = await call(owner, 'PUT', '/api/owner/gateway', { provider: 'p24', merchantId: 'M-12345', apiKey: 'sekretnyklucz9876', crc: 'crc-abc' });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await call(owner, 'GET', '/api/owner/config')).json().gateway.merchantId, 'M-12345');
  // Zespół wie najwyżej, czy bramka jest połączona (przy płatnościach dzielonych) – bez dostawcy, ID i końcówki klucza.
  db.prepare('INSERT OR REPLACE INTO studio_features (studio_id, flag, enabled) VALUES (?, ?, 1)').run(R, 'split_payments');
  for (const t of [trainer, reception]) {
    const gw = (await call(t, 'GET', '/api/owner/config')).json().gateway;
    assert.deepEqual(Object.keys(gw), ['connected']);
  }
});
