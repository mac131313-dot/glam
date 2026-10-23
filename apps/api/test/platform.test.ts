// Konsola GLAM: role zespołu (admin / wsparcie / finanse), strażnik po stronie serwera i dziennik działań.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { bootstrapPlatformStaff, platformAdminPhones } from '../src/routes/platform/guard.ts';
import { DEMO, seed } from '../src/seed.ts';
import { ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

const db = openDb(':memory:');
const sms = new ConsoleSmsGateway(true);
const app = buildApp({ db, sms, payments: new MockPaymentProvider(), exposeDevCodes: true, publicUrl: 'https://glam.test' });
const R = 'st_rzeszow';
let ipCounter = 100;

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db);
  console.warn = warn;
});

async function login(phone: string): Promise<string> {
  const remoteAddress = `10.1.0.${++ipCounter}`;
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress });
  assert.equal(r1.statusCode, 200, r1.body);
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode }, remoteAddress });
  assert.equal(r2.statusCode, 200, r2.body);
  return r2.json().token;
}

const call = (token: string, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}` } });

const status = async (token: string, method: string, url: string, payload?: object) => (await call(token, method, url, payload)).statusCode;

type AuditRow = { action: string; actor: string; studio_id: string | null; studio: string | null; details: Record<string, unknown> | null; created_at: string };

test('macierz ról: admin, wsparcie i finanse widzą tylko swoje', async () => {
  const admin = await login(DEMO.platformAdmin);
  const support = await login(DEMO.platformSupport);
  const finance = await login(DEMO.platformFinance);
  const magda = await login(DEMO.magda);

  const matrix: [string, string, object | undefined, number[]][] = [
    ['GET', '/api/platform/me', undefined, [200, 200, 200]],
    ['GET', '/api/platform/studios', undefined, [200, 200, 200]],
    ['GET', '/api/platform/tickets', undefined, [200, 200, 403]],
    ['POST', '/api/platform/incidents', { component: 'SMS', status: 'maintenance', note: '' }, [400, 400, 403]],
    ['GET', '/api/platform/access-log', undefined, [200, 200, 403]],
    ['GET', '/api/platform/team', undefined, [200, 403, 403]],
    ['GET', '/api/platform/audit', undefined, [200, 200, 403]],
    ['PUT', '/api/platform/studios/st_krakow/flags', { flag: 'nieznana', enabled: true }, [400, 403, 403]],
    ['POST', '/api/platform/access', { studioId: R, reason: 'krótko' }, [400, 400, 403]],
  ];
  for (const [method, url, payload, expected] of matrix) {
    const got = [await status(admin, method, url, payload), await status(support, method, url, payload), await status(finance, method, url, payload)];
    assert.deepEqual(got, expected, `${method} ${url}`);
    assert.equal(await status(magda, method, url, payload), 403, `klientka: ${method} ${url}`);
  }

  // Zmiana planu: tylko admin.
  const planBefore = (db.prepare('SELECT plan_id FROM studios WHERE id = ?').get(R) as { plan_id: string | null }).plan_id;
  assert.equal(await status(support, 'PUT', `/api/platform/studios/${R}`, { planId: 'siec' }), 403);
  assert.equal(await status(finance, 'PUT', `/api/platform/studios/${R}`, { planId: 'siec' }), 403);
  assert.equal((db.prepare('SELECT plan_id FROM studios WHERE id = ?').get(R) as { plan_id: string | null }).plan_id, planBefore);
  assert.equal(await status(admin, 'PUT', `/api/platform/studios/${R}`, { planId: 'siec' }), 200);
  assert.equal(await status(admin, 'PUT', `/api/platform/studios/${R}`, { planId: planBefore ?? 'start' }), 200);

  // Uzupełnienie grafiku: admin; wejście w dane z powodem: admin i wsparcie.
  assert.equal(await status(support, 'POST', `/api/platform/studios/${R}/fill`), 403);
  assert.equal(await status(support, 'POST', '/api/platform/access', { studioId: R, reason: 'Zgłoszenie studia #5: błąd karnetu' }), 200);

  // Strona statusu i cennik zostają publiczne.
  assert.equal((await app.inject({ method: 'GET', url: '/api/status' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'GET', url: '/api/platform/plans' })).statusCode, 200);

  assert.deepEqual((await call(finance, 'GET', '/api/platform/me')).json(), { userId: 'u_012', name: 'Ewa · finanse GLAM', role: 'finance' });
});

test('zaproszenie do zespołu: SMS, nowe konto, rola, wpis w dzienniku', async () => {
  const admin = await login(DEMO.platformAdmin);
  const sent = sms.sent.length;
  const invite = await call(admin, 'POST', '/api/platform/team', { phone: '500000099', name: 'Ola K.', role: 'support' });
  assert.equal(invite.statusCode, 200, invite.body);
  const invitation = sms.sent.slice(sent).find((m) => m.phone === '+48500000099');
  assert.match(invitation!.text, /zaproszenie do konsoli/i);
  assert.match(invitation!.text, /https:\/\/glam\.test\/konsola/);

  const token = await login('+48500000099');
  assert.equal((await call(token, 'GET', '/api/platform/me')).json().role, 'support');
  assert.equal(await status(token, 'GET', '/api/platform/team'), 403);

  const entry = ((await call(admin, 'GET', '/api/platform/audit')).json() as AuditRow[]).find((a) => a.action === 'team.invite');
  assert.ok(entry);
  assert.equal(entry.actor, 'Zespół GLAM');
  assert.equal(entry.details?.role, 'support');

  // Drugie zaproszenie tej samej osoby – konflikt; błędne dane – 400.
  assert.equal(await status(admin, 'POST', '/api/platform/team', { phone: '500000099', name: 'Ola K.', role: 'finance' }), 409);
  assert.equal(await status(admin, 'POST', '/api/platform/team', { phone: '500000098', name: 'Ktoś', role: 'szef' }), 400);
  assert.equal(await status(admin, 'POST', '/api/platform/team', { phone: '12', name: 'Ktoś', role: 'finance' }), 400);
  assert.equal(await status(admin, 'POST', '/api/platform/team', { phone: '500000098', name: '  ', role: 'finance' }), 400);

  const team = (await call(admin, 'GET', '/api/platform/team')).json() as { phone: string; role: string; disabledAt: string | null }[];
  assert.ok(team.some((t) => t.phone === '+48500000099' && t.role === 'support' && t.disabledAt === null));
});

test('wyłączenie unieważnia sesję, ponowne włączenie przywraca dostęp', async () => {
  const admin = await login(DEMO.platformAdmin);
  const token = await login('+48500000099');
  const team = (await call(admin, 'GET', '/api/platform/team')).json() as { userId: string; phone: string }[];
  const ola = team.find((t) => t.phone === '+48500000099')!;

  assert.equal(await status(token, 'GET', '/api/platform/me'), 200);
  assert.equal(await status(admin, 'PUT', `/api/platform/team/${ola.userId}`, { disabled: true }), 200);
  assert.equal(await status(token, 'GET', '/api/platform/me'), 401, 'sesja usunięta od razu');

  const again = await login('+48500000099');
  assert.equal(await status(again, 'GET', '/api/platform/me'), 403, 'wyłączona osoba nie wchodzi do konsoli');

  assert.equal(await status(admin, 'PUT', `/api/platform/team/${ola.userId}`, { disabled: false, role: 'finance' }), 200);
  assert.equal((await call(again, 'GET', '/api/platform/me')).json().role, 'finance');

  const actions = ((await call(admin, 'GET', '/api/platform/audit')).json() as AuditRow[]).map((a) => a.action);
  for (const a of ['team.disable', 'team.enable', 'team.role']) assert.ok(actions.includes(a), a);
  assert.equal(await status(admin, 'PUT', '/api/platform/team/u_nie_ma', { disabled: true }), 404);
  assert.equal(await status(admin, 'PUT', `/api/platform/team/${ola.userId}`, { role: 'szef' }), 400);
});

test('wyłączenie kasuje wszystkie sesje osoby, także z aplikacji studia', async () => {
  const admin = await login(DEMO.platformAdmin);
  const finance = await login(DEMO.platformFinance);
  assert.equal(await status(finance, 'GET', '/api/me'), 200);
  assert.equal(await status(admin, 'PUT', '/api/platform/team/u_012', { disabled: true }), 200);
  assert.equal(await status(finance, 'GET', '/api/me'), 401);
  assert.equal(await status(admin, 'PUT', '/api/platform/team/u_012', { disabled: false }), 200);
});

test('ostatni admin: nie można go wyłączyć ani zdegradować', async () => {
  const admin = await login(DEMO.platformAdmin);
  assert.equal(await status(admin, 'PUT', '/api/platform/team/u_009', { disabled: true }), 400);
  assert.equal(await status(admin, 'PUT', '/api/platform/team/u_009', { role: 'support' }), 400);
  assert.equal(await status(admin, 'GET', '/api/platform/me'), 200, 'konsola nadal działa');

  // Z drugim adminem pierwszego można zdegradować – i dopiero wtedy drugi jest ostatnim.
  assert.equal(await status(admin, 'POST', '/api/platform/team', { phone: '500000097', name: 'Drugi admin', role: 'admin' }), 200);
  const team = (await call(admin, 'GET', '/api/platform/team')).json() as { userId: string; phone: string }[];
  const second = team.find((t) => t.phone === '+48500000097')!;
  assert.equal(await status(admin, 'PUT', '/api/platform/team/u_009', { role: 'support' }), 200);
  const secondToken = await login('+48500000097');
  assert.equal(await status(secondToken, 'PUT', `/api/platform/team/${second.userId}`, { disabled: true }), 400);
  assert.equal(await status(secondToken, 'PUT', `/api/platform/team/${second.userId}`, { role: 'finance' }), 400);
  assert.equal(await status(secondToken, 'PUT', '/api/platform/team/u_009', { role: 'admin' }), 200);
});

test('zmiana planu i flagi trafia do dziennika razem z wejściami z powodem', async () => {
  const admin = await login(DEMO.platformAdmin);
  const planBefore = (db.prepare('SELECT plan_id FROM studios WHERE id = ?').get(R) as { plan_id: string | null }).plan_id ?? 'start';
  assert.equal(await status(admin, 'PUT', `/api/platform/studios/${R}`, { planId: 'siec' }), 200);
  assert.equal(await status(admin, 'PUT', `/api/platform/studios/${R}`, { planId: planBefore }), 200);
  assert.equal(await status(admin, 'PUT', `/api/platform/studios/${R}/flags`, { flag: 'beta_widgets', enabled: true }), 200);
  assert.equal(await status(admin, 'PUT', `/api/platform/studios/nie-ma/flags`, { flag: 'beta_widgets', enabled: true }), 404);
  assert.equal(await status(admin, 'POST', '/api/platform/access', { studioId: R, reason: 'Zgłoszenie studia #7: sprawdzenie karnetu' }), 200);

  const audit = (await call(admin, 'GET', '/api/platform/audit')).json() as AuditRow[];
  const planEntry = audit.find((a) => a.action === 'studio.plan' && a.details?.to === 'siec');
  assert.ok(planEntry);
  assert.equal(planEntry.studio_id, R);
  assert.equal(planEntry.studio, 'Centrum Ruchu');
  assert.ok(audit.some((a) => a.action === 'studio.flag' && a.studio_id === R && a.details?.flag === 'beta_widgets'));
  const access = audit.find((a) => a.action === 'studio.access' && /sprawdzenie karnetu/.test(String(a.details?.reason)));
  assert.ok(access, 'wejścia z powodem są w tym samym dzienniku');
  const times = audit.map((a) => a.created_at);
  assert.deepEqual(times, [...times].sort().reverse(), 'od najnowszych');
  assert.ok(audit.length <= 200);
});

test('zgłoszenia, incydenty i uzupełnienie grafiku zostawiają ślad w dzienniku', async () => {
  const admin = await login(DEMO.platformAdmin);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO support_tickets (id, studio_id, author_id, subject, priority, status, sla_due_at, created_at, updated_at) VALUES ('tk_audit', ?, 'u_001', 'Pytanie', 'normal', 'open', ?, ?, ?)").run(R, now, now, now);

  assert.equal(await status(admin, 'POST', '/api/platform/tickets/tk_audit', { body: 'Już to sprawdzamy.', close: true }), 200);
  assert.equal(await status(admin, 'POST', '/api/platform/tickets/nie-ma', { body: 'x' }), 404);
  assert.equal(await status(admin, 'POST', '/api/platform/incidents', { component: 'SMS', status: 'degraded', note: 'Opóźnione kody' }), 200);
  const incident = db.prepare("SELECT id FROM status_incidents WHERE note = 'Opóźnione kody'").get() as { id: string };
  assert.equal(await status(admin, 'POST', `/api/platform/incidents/${incident.id}/resolve`), 200);
  assert.equal(await status(admin, 'POST', '/api/platform/incidents/nie-ma/resolve'), 404, 'nieznany incydent');
  assert.equal(await status(admin, 'POST', `/api/platform/studios/${R}/fill`), 200);

  const audit = (await call(admin, 'GET', '/api/platform/audit')).json() as AuditRow[];
  const find = (action: string) => audit.find((a) => a.action === action);
  assert.deepEqual(find('ticket.reply')?.details, { ticketId: 'tk_audit', closed: true });
  assert.equal(find('ticket.reply')?.studio_id, R);
  assert.deepEqual(find('incident.open')?.details, { component: 'SMS', status: 'degraded' });
  assert.deepEqual(find('incident.resolve')?.details, { incidentId: incident.id });
  assert.equal(find('studio.fill')?.studio_id, R);
  assert.equal(audit.filter((a) => a.action === 'incident.resolve').length, 1, 'nieudane odwołanie nie zostawia wpisu');

  // Samo zamknięcie bez treści też jest zapisane.
  assert.equal(await status(admin, 'POST', '/api/platform/tickets/tk_audit', { close: true }), 200);
  const replies = ((await call(admin, 'GET', '/api/platform/audit')).json() as AuditRow[]).filter((a) => a.action === 'ticket.reply');
  assert.equal(replies.length, 2);
});

test('start: numery z GLAM_PLATFORM_ADMINS dostają rolę admina tylko raz', () => {
  const d = openDb(':memory:');
  d.prepare("INSERT INTO users (id, phone, name, created_at) VALUES ('u_a', '+48600000001', 'A', ?)").run(new Date().toISOString());
  bootstrapPlatformStaff(d, ['+48600000001', '+48600000002', 'nie-numer']);
  assert.deepEqual(d.prepare('SELECT user_id, role FROM platform_staff').all().map((r) => ({ ...r })), [{ user_id: 'u_a', role: 'admin' }]);
  d.prepare("UPDATE platform_staff SET role = 'support', disabled_at = ? WHERE user_id = 'u_a'").run(new Date().toISOString());
  bootstrapPlatformStaff(d, ['+48600000001']);
  assert.deepEqual(d.prepare('SELECT role, disabled_at IS NOT NULL AS off FROM platform_staff').all().map((r) => ({ ...r })), [{ role: 'support', off: 1 }]);
});

test('admini z GLAM_PLATFORM_ADMINS: numer w dowolnym zapisie, domyślny numer tylko w demo', async () => {
  assert.deepEqual(platformAdminPhones('500 000 009, +48 600-000-001,nie-numer,,', false), ['+48500000009', '+48600000001']);
  assert.deepEqual(platformAdminPhones(undefined, true), ['+48500000009']);
  assert.deepEqual(platformAdminPhones(undefined, false), []);
  assert.deepEqual(platformAdminPhones('', true), []);

  // Świeża baza bez danych demo: konta admina nie ma przy starcie, powstaje przy pierwszym logowaniu.
  const fresh = (platformAdmins?: string[]) => {
    const d = openDb(':memory:');
    return { d, a: buildApp({ db: d, sms, payments: new MockPaymentProvider(), exposeDevCodes: true, publicUrl: 'https://glam.test', platformAdmins }) };
  };
  const loginTo = async (target: typeof app, phone: string) => {
    const remoteAddress = `10.1.1.${++ipCounter}`;
    const code = (await target.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress })).json().devCode;
    const res = await target.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code }, remoteAddress });
    assert.equal(res.statusCode, 200, res.body);
    return res.json().token as string;
  };
  const me = (target: typeof app, token: string) => target.inject({ method: 'GET', url: '/api/platform/me', headers: { authorization: `Bearer ${token}` } });

  const { d, a } = fresh(platformAdminPhones('500 000 009, 500 000 008', false));
  const admin = await me(a, await loginTo(a, '+48500000009'));
  assert.equal(admin.statusCode, 200, admin.body);
  assert.equal(admin.json().role, 'admin');
  assert.equal((await me(a, await loginTo(a, '+48500000007'))).statusCode, 403, 'numer spoza listy');

  // Wyłączona osoba z listy nie wraca do zespołu przy logowaniu.
  const second = await loginTo(a, '+48500000008');
  assert.equal((await me(a, second)).statusCode, 200);
  d.prepare("UPDATE platform_staff SET disabled_at = ? WHERE user_id = (SELECT id FROM users WHERE phone = '+48500000008')").run(new Date().toISOString());
  assert.equal((await me(a, second)).statusCode, 403);

  // Bez listy (nie demo, brak zmiennej) nikt nie zostaje adminem – także numer z danych demo.
  const none = fresh();
  assert.equal((await me(none.a, await loginTo(none.a, '+48500000009'))).statusCode, 403);
  assert.equal((none.d.prepare('SELECT COUNT(*) AS n FROM platform_staff').get() as { n: number }).n, 0);
});
