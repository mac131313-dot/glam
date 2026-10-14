import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { StudioScope, TenantViolation } from '../src/scope.ts';
import { DEMO, seed } from '../src/seed.ts';
import { SSG, SSG_STUDIO } from '../src/seed-ssg.ts';
import { ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';
import { jpegHeader } from './fixtures.ts';

const db = openDb(':memory:');
const sms = new ConsoleSmsGateway(true);
const app = buildApp({ db, sms, payments: new MockPaymentProvider(), exposeDevCodes: true });
const R = 'st_rzeszow';
const K = 'st_krakow';
let ipCounter = 0;

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db);
  console.warn = warn;
});

async function login(phone: string): Promise<string> {
  const remoteAddress = `10.0.0.${++ipCounter}`;
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress });
  assert.equal(r1.statusCode, 200, r1.body);
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode }, remoteAddress });
  assert.equal(r2.statusCode, 200, r2.body);
  return r2.json().token;
}

const call = (token: string, studio: string | null, method: string, url: string, payload?: object) =>
  app.inject({
    method: method as 'GET',
    url,
    payload,
    headers: { authorization: `Bearer ${token}`, ...(studio ? { 'x-studio-id': studio } : {}) },
  });

test('logowanie SMS: kod, ponowna wysyłka po 60 s, blokada po 5 błędach', async () => {
  const phone = '600 100 200';
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress: '10.9.9.1' });
  assert.equal(r1.json().phone, '+48600100200');
  assert.match(sms.sent.at(-1)!.text, /\d{6}/);
  const again = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress: '10.9.9.1' });
  assert.equal(again.json().error, 'resend_too_soon');

  const wrongCode = r1.json().devCode === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const bad = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: wrongCode } });
    assert.equal(bad.json().error, 'wrong_code');
  }
  const locked = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode } });
  assert.equal(locked.json().error, 'locked');
});

test('nowa klientka: konto + dołączenie do studia kodem', async () => {
  const token = await login('+48600000777');
  const before = await call(token, null, 'GET', '/api/me');
  assert.deepEqual(before.json().studios, []);
  const join = await call(token, null, 'POST', '/api/studios/join', { code: 'ruch24' });
  assert.equal(join.json().studio.id, R);
  const me = await call(token, null, 'GET', '/api/me');
  assert.deepEqual(me.json().studios.map((s: { id: string }) => s.id), [R]);
});

test('Magda: dwa studia, osobne karnety', async () => {
  const token = await login(DEMO.magda);
  const me = (await call(token, null, 'GET', '/api/me')).json();
  assert.deepEqual(me.studios.map((s: { id: string }) => s.id).sort(), [K, R]);
  const pr = (await call(token, R, 'GET', '/api/my/passes')).json();
  const pk = (await call(token, K, 'GET', '/api/my/passes')).json();
  assert.equal(pr[0].productName, 'Pilates Reformer 9');
  assert.match(pr[0].summary, /pozostały 3/);
  assert.equal(pk[0].productName, 'Karnet 4');
});

test('izolacja: brak członkostwa = 404, rola klientki nie wchodzi do panelu właścicielki', async () => {
  const ania = await login(DEMO.ania);
  assert.equal((await call(ania, K, 'GET', '/api/schedule')).statusCode, 404);
  assert.equal((await call(ania, R, 'GET', '/api/owner/dashboard')).statusCode, 403);
  const beata = await login(DEMO.krakowOwner);
  assert.equal((await call(beata, R, 'GET', '/api/owner/dashboard')).statusCode, 404);
  // Właścicielka Krakowa nie odwoła rezerwacji z Rzeszowa, nawet znając jej id.
  const rzBooking = db.prepare("SELECT id FROM bookings WHERE studio_id = ? AND status = 'booked' LIMIT 1").get(R) as { id: string };
  const res = await call(beata, K, 'DELETE', `/api/staff/bookings/${rzBooking.id}`);
  assert.equal(res.statusCode, 404);
  // Grafik Krakowa nie zawiera żadnych sesji Rzeszowa.
  const krSchedule = (await call(beata, K, 'GET', '/api/schedule?days=14')).json();
  const rzIds = new Set((db.prepare('SELECT id FROM class_sessions WHERE studio_id = ?').all(R) as { id: string }[]).map((r) => r.id));
  assert.ok(krSchedule.sessions.length > 0);
  assert.ok(krSchedule.sessions.every((s: { id: string }) => !rzIds.has(s.id)));
});

test('StudioScope odrzuca zapytanie bez filtra studia i podmianę studia', () => {
  const scope = new StudioScope(db, R);
  assert.throws(() => scope.all('SELECT * FROM bookings'), TenantViolation);
  assert.throws(() => scope.all('SELECT * FROM bookings WHERE studio_id = $studio', { studio: K }), TenantViolation);
});

test('rezerwacja → pełne zajęcia → lista oczekujących → automatyczny awans po odwołaniu', async () => {
  const magda = await login(DEMO.magda);
  const schedule = (await call(magda, R, 'GET', '/api/schedule?days=10')).json();
  const full = schedule.sessions.find((s: { class_name: string; taken: number; capacity: number }) => s.class_name === 'Reformer' && s.taken >= s.capacity);
  assert.ok(full, 'w danych demo jest pełny Reformer');

  const wait = await call(magda, R, 'POST', '/api/bookings', { sessionId: full.id });
  assert.equal(wait.json().status, 'waitlist');
  const before = (await call(magda, R, 'GET', '/api/my/passes')).json()[0].balances.r;

  // Recepcja odwołuje jedną z uczestniczek → Magda wskakuje automatycznie i traci 1 wejście.
  const kasia = await login(DEMO.reception);
  const day = db.prepare("SELECT id FROM bookings WHERE session_id = ? AND status = 'booked' LIMIT 1").get(full.id) as { id: string };
  assert.equal((await call(kasia, R, 'DELETE', `/api/staff/bookings/${day.id}`)).statusCode, 200);

  const mine = (await call(magda, R, 'GET', '/api/schedule?days=10')).json().sessions.find((s: { id: string }) => s.id === full.id);
  assert.equal(mine.my_status, 'booked');
  const after = (await call(magda, R, 'GET', '/api/my/passes')).json()[0].balances.r;
  assert.equal(after, before - 1);
  const inbox = (await call(magda, R, 'GET', '/api/inbox')).json();
  assert.match(inbox[0].body, /Zwolniło się miejsce/);

  // Odwołanie w terminie oddaje wejście.
  const cancel = await call(magda, R, 'DELETE', `/api/bookings/${mine.my_booking_id}`);
  assert.equal(cancel.json().outcome, 'refund');
  assert.equal((await call(magda, R, 'GET', '/api/my/passes')).json()[0].balances.r, before);
});

test('brak pasującego karnetu → 402 z propozycją produktów', async () => {
  const magda = await login(DEMO.magda);
  const schedule = (await call(magda, R, 'GET', '/api/schedule?days=10')).json();
  const stretch = schedule.sessions.find((s: { class_name: string; starts_at: string }) => s.class_name === 'Stretch' && Date.parse(s.starts_at) > Date.now() + 4 * 3_600_000);
  const res = await call(magda, R, 'POST', '/api/bookings', { sessionId: stretch.id });
  assert.equal(res.statusCode, 402);
  const names = res.json().details.suggestions.map((s: { name: string }) => s.name);
  assert.ok(names.includes('Mix 8'));
  assert.ok(!names.includes('Pilates Reformer 9'));
  assert.ok(!names.includes('Pierwsze 3 zajęcia'), 'pakiet startowy nie dla osoby, która już kupowała');
});

test('zakup karnetu, pakiet startowy tylko raz, wersjonowanie ceny', async () => {
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);
  const buy = await call(magda, R, 'POST', '/api/purchases', { productId: 'pr_mix8', method: 'blik' });
  assert.equal(buy.statusCode, 200, buy.body);
  const intro = await call(magda, R, 'POST', '/api/purchases', { productId: 'pr_start', method: 'blik' });
  assert.equal(intro.json().error, 'intro_only');

  const upd = await call(owner, R, 'PUT', '/api/owner/products/pr_mix8', { priceGrosze: 45000 });
  assert.equal(upd.json().version, 2);
  assert.equal(upd.json().price, '450 zł');
  // Kupiony wcześniej karnet ma reguły z wersji 1 (nie zmienia się).
  const pass = db.prepare('SELECT product_version_id FROM passes WHERE id = ?').get(buy.json().passId) as { product_version_id: string };
  assert.equal(pass.product_version_id, 'pr_mix8_v1');
});

test('pakiet zajęć: subskrypcja zapisuje odnowienie, jednorazowy nie, anulowanie zostawia opłacony czas', async () => {
  const magda = await login(DEMO.magda);
  const products = (await call(magda, R, 'GET', '/api/products')).json();
  const year = products.find((p: { billing: string }) => p.billing === 'year');
  const once = products.find((p: { billing: string }) => p.billing === 'once');
  assert.equal(year.id, 'pr_sub_year');
  assert.equal(once.id, 'pr_mix8');
  assert.ok(products.some((p: { billing: string | null }) => p.billing === null), 'pozostałe karnety zostają poza paywallem');

  const sub = await call(magda, R, 'POST', '/api/purchases', { productId: year.id, method: 'blik' });
  assert.equal(sub.statusCode, 200, sub.body);
  assert.equal(sub.json().renews, true);
  assert.equal((db.prepare('SELECT auto_renew FROM passes WHERE id = ?').get(sub.json().passId) as { auto_renew: number }).auto_renew, 1);

  const stop = await call(magda, R, 'POST', `/api/my/passes/${sub.json().passId}/cancel-renewal`);
  assert.equal(stop.statusCode, 200, stop.body);
  assert.match(stop.json().message, /Opłacony czas zostaje/);
  assert.equal((db.prepare('SELECT auto_renew, status FROM passes WHERE id = ?').get(sub.json().passId) as { auto_renew: number; status: string }).auto_renew, 0);
  assert.equal((db.prepare('SELECT status FROM passes WHERE id = ?').get(sub.json().passId) as { status: string }).status, 'active');
  assert.equal((await call(magda, R, 'POST', `/api/my/passes/${sub.json().passId}/cancel-renewal`)).json().error, 'not_renewing');

  const one = await call(magda, R, 'POST', '/api/purchases', { productId: 'pr_mix8', method: 'card' });
  assert.equal(one.statusCode, 200, one.body);
  assert.equal(one.json().renews, false);
  assert.equal((db.prepare('SELECT auto_renew FROM passes WHERE id = ?').get(one.json().passId) as { auto_renew: number }).auto_renew, 0);

  const krakow = (await call(magda, K, 'GET', '/api/products')).json();
  assert.ok(krakow.every((p: { billing: string | null }) => p.billing === null));
});

test('wejściówka dla znajomej: zakup, SMS, aktywacja nowym numerem, dołączenie do studia', async () => {
  const ania = await login(DEMO.ania);
  const gp = await call(ania, R, 'POST', '/api/guest-passes', { recipientPhone: '600 300 400', method: 'blik', message: 'Chodź ze mną!' });
  assert.equal(gp.statusCode, 200, gp.body);
  assert.match(sms.sent.at(-1)!.text, new RegExp(gp.json().code));

  const wrong = await login('+48600999888');
  assert.equal((await call(wrong, null, 'POST', '/api/guest-passes/redeem', { code: gp.json().code })).json().error, 'wrong_recipient');

  const friend = await login('+48600300400');
  const redeem = await call(friend, null, 'POST', '/api/guest-passes/redeem', { code: gp.json().code });
  assert.equal(redeem.statusCode, 200, redeem.body);
  const passes = (await call(friend, R, 'GET', '/api/my/passes')).json();
  assert.equal(passes[0].productName, 'Wejściówka od znajomej');
  assert.equal((await call(friend, null, 'POST', '/api/guest-passes/redeem', { code: gp.json().code })).json().error, 'used');
});

test('powitanie od trenerki: lista „bez powitania”, zapis, popup u klientki', async () => {
  const marzena = await login(DEMO.marzena);
  const todo = (await call(marzena, R, 'GET', '/api/staff/welcome-todo')).json();
  const ania = todo.find((c: { name: string }) => c.name === 'Ania');
  assert.ok(ania);
  const tooLoud = await call(marzena, R, 'POST', '/api/staff/welcome', { clientId: ania.id, body: 'Hej Ania!!!! Super!!! Do zobaczenia na sali!!!' });
  assert.equal(tooLoud.statusCode, 400);
  const ok = await call(marzena, R, 'POST', '/api/staff/welcome', { clientId: ania.id, body: 'Hej Ania! 💛 Zaczniemy spokojnie, bez pośpiechu. Do zobaczenia w środę.' });
  assert.equal(ok.json().status, 'published');
  const aniaToken = await login(DEMO.ania);
  const home = (await call(aniaToken, R, 'GET', '/api/home')).json();
  assert.equal(home.welcome.trainer_name, 'Marzena');
});

test('motywy: jeden aktywny naraz, opt-out „Zawsze standard”', async () => {
  const owner = await login(DEMO.owner);
  await call(owner, R, 'POST', '/api/owner/themes/th_hall/activate');
  const active = db.prepare('SELECT id FROM themes WHERE studio_id = ? AND is_active = 1').all(R) as { id: string }[];
  assert.deepEqual(active.map((t) => t.id), ['th_hall']);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().theme.id, 'th_hall');
  await call(magda, null, 'PATCH', '/api/me', { themeOptOut: true });
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().theme, null);
  await call(magda, null, 'PATCH', '/api/me', { themeOptOut: false });
  await call(owner, R, 'POST', '/api/owner/themes/th_oct/activate');
});

test('blokada sali: odwołanie sesji, zwrot wejść, powiadomienie', async () => {
  const owner = await login(DEMO.owner);
  const s = db
    .prepare(
      "SELECT s.id, s.starts_at FROM class_sessions s JOIN bookings b ON b.session_id = s.id WHERE s.studio_id = ? AND b.status = 'booked' AND s.starts_at > ? ORDER BY s.starts_at LIMIT 1",
    )
    .get(R, new Date().toISOString()) as { id: string; starts_at: string };
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(s.starts_at));
  const res = await call(owner, R, 'POST', '/api/owner/exceptions', { date, reason: 'Remont sali' });
  assert.ok(res.json().cancelledSessions >= 1);
  const status = db.prepare('SELECT status FROM class_sessions WHERE id = ?').get(s.id) as { status: string };
  assert.equal(status.status, 'cancelled');
});

test('grafik slotami: kilka dni naraz, zmiana godziny bez podwójnych sesji, usunięcie', async () => {
  const owner = await login(DEMO.owner);
  const cfg = (await call(owner, R, 'GET', '/api/owner/config')).json();
  const trainerId = cfg.trainers[0].id;
  const created = await call(owner, R, 'POST', '/api/owner/templates', { classTypeId: 'ct_mat', trainerId, weekdays: [1, 3], startTime: '06:30', durationMin: 50, capacity: 10 });
  assert.equal(created.statusCode, 200, created.body);
  assert.ok(created.json().created >= 6);
  const bad = await call(owner, R, 'POST', '/api/owner/templates', { classTypeId: 'ct_mat', trainerId, weekdays: [], startTime: '06:30', durationMin: 50, capacity: 10 });
  assert.equal(bad.statusCode, 400);

  const slots = (await call(owner, R, 'GET', '/api/owner/config')).json().templates.filter((t: { start_time: string }) => t.start_time === '06:30');
  assert.equal(slots.length, 2);
  const moved = await call(owner, R, 'PUT', `/api/owner/templates/${slots[0].id}`, { startTime: '06:45' });
  assert.equal(moved.statusCode, 200, moved.body);
  const times = db.prepare("SELECT starts_at FROM class_sessions WHERE template_id = ? AND status = 'scheduled'").all(slots[0].id) as { starts_at: string }[];
  const local = times.map((t) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' }).format(new Date(t.starts_at)));
  assert.ok(local.length >= 3 && local.every((t) => t === '06:45'), local.join());

  assert.equal((await call(owner, R, 'DELETE', `/api/owner/templates/${slots[1].id}`)).statusCode, 200);
  const left = (await call(owner, R, 'GET', '/api/owner/config')).json().templates.map((t: { id: string }) => t.id);
  assert.ok(!left.includes(slots[1].id));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM class_sessions WHERE template_id = ?").get(slots[1].id) as { n: number }).n, 0);
});

test('przesunięcie slotu z zapisami: sesja z klientkami zostaje albo jest odwołana, nigdy dwie tego samego dnia', async () => {
  const owner = await login(DEMO.owner);
  const booked = db
    .prepare(
      `SELECT s.template_id FROM class_sessions s JOIN bookings b ON b.session_id = s.id
       WHERE s.studio_id = ? AND s.status = 'scheduled' AND b.status = 'booked' AND s.template_id IS NOT NULL AND s.starts_at > ? LIMIT 1`,
    )
    .get(R, new Date().toISOString()) as { template_id: string };
  const res = (await call(owner, R, 'PUT', `/api/owner/templates/${booked.template_id}`, { startTime: '21:10' })).json();
  assert.ok(res.kept + res.cancelled >= 1);
  const perDay = db
    .prepare("SELECT starts_at FROM class_sessions WHERE template_id = ? AND status = 'scheduled' AND starts_at > ?")
    .all(booked.template_id, new Date().toISOString()) as { starts_at: string }[];
  const days = perDay.map((s) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date(s.starts_at)));
  assert.equal(new Set(days).size, days.length);
});

test('administrator platformy widzi liczby, nie dane klientek; dostęp wymaga powodu', async () => {
  const admin = await login(DEMO.platformAdmin);
  const studios = (await call(admin, null, 'GET', '/api/platform/studios')).json();
  assert.ok(studios.every((s: Record<string, unknown>) => !('phone' in s)));
  assert.equal((await call(admin, null, 'POST', '/api/platform/access', { studioId: R, reason: 'krótko' })).statusCode, 400);
  assert.equal((await call(admin, null, 'POST', '/api/platform/access', { studioId: R, reason: 'Zgłoszenie studia #123: błąd karnetu' })).statusCode, 200);
  assert.equal((await call(admin, R, 'GET', '/api/owner/dashboard')).statusCode, 404);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, null, 'GET', '/api/platform/studios')).statusCode, 403);
});

test('wygląd studia: walidacja rejestrem z core, zapis widoczny u klientki, izolacja', async () => {
  const owner = await login(DEMO.owner);
  const bad = await call(owner, R, 'PUT', '/api/owner/look', { fonts: { display: 'rethink' } });
  assert.equal(bad.statusCode, 400, 'sans nie może być fontem akcentu');
  const ok = await call(owner, R, 'PUT', '/api/owner/look', { palette: 'unbound', softness: 'softest', fonts: { head: 'jost' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual(ok.json().look.fonts, { display: 'cormorant', head: 'jost', body: 'rethink', label: 'outfit' });
  const pending = await call(owner, R, 'PUT', '/api/owner/look', { fonts: { head: 'circular' } });
  assert.equal(pending.statusCode, 400, 'krój bez plików nie może być wybrany');
  assert.equal((await call(owner, R, 'PUT', '/api/owner/look', { fonts: { display: 'ballet', label: 'dmmono' } })).statusCode, 200);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().look.palette, 'unbound');
  assert.equal((await call(magda, K, 'GET', '/api/studio')).json().look.palette, 'unbound', 'Kraków ma swój wygląd z seeda');
  assert.equal((await call(magda, R, 'PUT', '/api/owner/look', { palette: 'blush' })).statusCode, 403);
  await call(owner, R, 'PUT', '/api/owner/look', { palette: 'isola', softness: 'softer', fonts: { head: 'outfit' } });
});

test('logowanie demo: działa w trybie deweloperskim, nie istnieje w produkcji', async () => {
  const dev = await app.inject({ method: 'POST', url: '/api/dev/login', payload: { phone: DEMO.owner } });
  assert.equal(dev.statusCode, 200);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${dev.json().token}` } });
  assert.equal(me.json().user.name, 'Joanna');
  assert.equal((await app.inject({ method: 'POST', url: '/api/dev/login', payload: { phone: '600111222' } })).statusCode, 404);

  const prod = buildApp({ db, sms, payments: new MockPaymentProvider(), exposeDevCodes: false });
  assert.equal((await prod.inject({ method: 'POST', url: '/api/dev/login', payload: { phone: DEMO.owner } })).statusCode, 404);
});

test('logo studia: wgranie przez właścicielkę, widoczne u klientki, bezpieczne serwowanie', async () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);

  assert.equal((await call(magda, R, 'PUT', '/api/owner/logo', { dataUrl: PNG })).statusCode, 403, 'klientka nie wgra logo');
  const fake = 'data:image/png;base64,' + Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');
  assert.equal((await call(owner, R, 'PUT', '/api/owner/logo', { dataUrl: fake })).statusCode, 400, 'zawartość musi pasować do typu');
  const evilSvg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
  assert.equal((await call(owner, R, 'PUT', '/api/owner/logo', { dataUrl: evilSvg })).statusCode, 400, 'SVG ze skryptem odrzucony');

  assert.equal((await call(owner, R, 'PUT', '/api/owner/logo', { dataUrl: PNG, ratio: 3.2 })).statusCode, 200);
  const studio = (await call(magda, R, 'GET', '/api/studio')).json();
  assert.match(studio.logoUrl, /^\/api\/studios\/st_rzeszow\/logo\?v=\d+$/);
  assert.equal(studio.logoWide, true);
  const me = (await call(magda, null, 'GET', '/api/me')).json();
  assert.equal(me.studios.find((s: { id: string }) => s.id === K).logoUrl, null, 'Kraków bez logo');

  const img = await app.inject({ method: 'GET', url: studio.logoUrl });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/png');
  assert.equal(img.headers['x-content-type-options'], 'nosniff');
  assert.match(String(img.headers['content-security-policy']), /sandbox/);

  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>').toString('base64');
  assert.equal((await call(owner, R, 'PUT', '/api/owner/logo', { dataUrl: svg, ratio: 1 })).statusCode, 200);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().logoWide, false);

  await call(owner, R, 'DELETE', '/api/owner/logo');
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().logoUrl, null);
  assert.equal((await app.inject({ method: 'GET', url: '/api/studios/st_rzeszow/logo' })).statusCode, 404);
});

test('zdjęcia zajęć: wgrywa właścicielka, grafik dostaje adres, inne studio nie ma dostępu', async () => {
  const JPG = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]).toString('base64');
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);
  const krakowOwner = await login(DEMO.krakowOwner);
  const url = '/api/owner/class-types/ct_reformer/photo';

  assert.equal((await call(magda, R, 'PUT', url, { dataUrl: JPG })).statusCode, 403, 'klientka nie wgra zdjęcia');
  assert.equal((await call(krakowOwner, K, 'PUT', url, { dataUrl: JPG })).statusCode, 404, 'właścicielka innego studia nie widzi tych zajęć');
  const svg = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
  assert.equal((await call(owner, R, 'PUT', url, { dataUrl: svg })).statusCode, 400, 'zdjęcie nie może być SVG');

  assert.equal((await call(owner, R, 'PUT', url, { dataUrl: JPG })).statusCode, 200);
  const sessions = (await call(magda, R, 'GET', '/api/schedule?days=10')).json().sessions as { class_type_id: string; photo_url: string | null; photo_ratio: number | null }[];
  const reformer = sessions.find((s) => s.class_type_id === 'ct_reformer')!;
  assert.match(reformer.photo_url!, /^\/api\/class-types\/ct_reformer\/photo\?v=\d+$/);
  assert.equal(sessions.find((s) => s.class_type_id === 'ct_mat')!.photo_url, null, 'Mat bez zdjęcia');

  // Proporcje karty idą za zdjęciem: pionowe 3:4 → 0.75
  assert.equal((await call(owner, R, 'PUT', url, { dataUrl: 'data:image/jpeg;base64,' + jpegHeader(1200, 1600).toString('base64') })).statusCode, 200);
  const portrait = (await call(magda, R, 'GET', '/api/schedule?days=10')).json().sessions.find((s: { class_type_id: string }) => s.class_type_id === 'ct_reformer');
  assert.equal(portrait.photo_ratio, 0.75);

  const config = (await call(owner, R, 'GET', '/api/owner/config')).json();
  assert.ok(!('photo_data' in config.classTypes[0]), 'lista typów nie wysyła pliku');
  const img = await app.inject({ method: 'GET', url: reformer.photo_url! });
  assert.equal(img.statusCode, 200);
  assert.equal(img.headers['content-type'], 'image/jpeg');

  await call(owner, R, 'DELETE', url);
  assert.equal((await app.inject({ method: 'GET', url: '/api/class-types/ct_reformer/photo' })).statusCode, 404);
});

test('wygląd logo: kształt, rozmiar, kadr – walidacja zakresów i zapis', async () => {
  const owner = await login(DEMO.owner);
  const ok = await call(owner, R, 'PUT', '/api/owner/look', { logo: { shape: 'circle', size: 44, fit: 'cover', zoom: 1.6, x: -10, y: 5, background: 'ink' } });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal(ok.json().look.logo.shape, 'circle');
  assert.equal(ok.json().look.logo.showName, 'auto', 'pozostałe pola zostają domyślne');
  assert.equal((await call(owner, R, 'PUT', '/api/owner/look', { logo: { size: 200 } })).statusCode, 400);
  assert.equal((await call(owner, R, 'PUT', '/api/owner/look', { logo: { shape: 'triangle' } })).statusCode, 400);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().look.logo.size, 44);
  await call(owner, R, 'PUT', '/api/owner/look', { logo: { shape: 'auto', size: 30, fit: 'contain', zoom: 1, x: 0, y: 0, background: 'soft' } });
});

test('przyciemnienie zdjęć zajęć: domyślne, zapis w zakresie, odrzucenie poza nim', async () => {
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().look.photoDim, 0.36, 'stare studia dostają wartość domyślną');
  assert.equal((await call(owner, R, 'PUT', '/api/owner/look', { photoDim: 0.55 })).statusCode, 200);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().look.photoDim, 0.55);
  for (const bad of [0.05, 0.9, 'mocno']) assert.equal((await call(owner, R, 'PUT', '/api/owner/look', { photoDim: bad })).statusCode, 400, String(bad));
  await call(owner, R, 'PUT', '/api/owner/look', { photoDim: 0.36 });
});

test('rozmycie zdjęć zajęć: domyślnie wyłączone, zapis w zakresie, odrzucenie poza nim', async () => {
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().look.photoBlur, 0, 'stare studia: bez rozmycia');
  assert.equal((await call(owner, R, 'PUT', '/api/owner/look', { photoBlur: 12 })).statusCode, 200);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().look.photoBlur, 12);
  for (const bad of [-1, 40, 'mocno']) assert.equal((await call(owner, R, 'PUT', '/api/owner/look', { photoBlur: bad })).statusCode, 400, String(bad));
  await call(owner, R, 'PUT', '/api/owner/look', { photoBlur: 0 });
});

test('zmiana nazwy studia: właścicielka zmienia, klientka widzi, walidacja', async () => {
  const owner = await login(DEMO.owner);
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'PUT', '/api/owner/studio', { name: 'Hack' })).statusCode, 403);
  assert.equal((await call(owner, R, 'PUT', '/api/owner/studio', { name: ' x ' })).statusCode, 400);
  const ok = await call(owner, R, 'PUT', '/api/owner/studio', { name: '  studio   Ruchu ', tagline: 'Pilates i oddech' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.deepEqual([ok.json().name, ok.json().logo], ['studio Ruchu', 'S']);
  assert.equal((await call(magda, R, 'GET', '/api/studio')).json().name, 'studio Ruchu');
  const me = (await call(magda, null, 'GET', '/api/me')).json();
  assert.equal(me.studios.find((s: { id: string }) => s.id === R).tagline, 'Pilates i oddech');
  assert.equal(me.studios.find((s: { id: string }) => s.id === K).name, 'Flow Pilates', 'inne studio bez zmian');
  await call(owner, R, 'PUT', '/api/owner/studio', { name: 'Centrum Ruchu', tagline: 'Pilates, stretch i siłownia' });
});

test('trenerka dodaje klientkę: przypisana do niej, widoczna na liście, z celem i notatką; cudzej nie dopisze', async () => {
  const weronika = await login(SSG.weronika);
  const res = await call(weronika, SSG_STUDIO, 'POST', '/api/staff/clients', { name: 'Karolina', phone: '600 555 101', goal: 'Mocne plecy', note: 'Po kontuzji kolana' });
  assert.equal(res.statusCode, 200, res.body);
  const list = (await call(weronika, SSG_STUDIO, 'GET', '/api/staff/clients')).json() as { id: string; goal: string | null }[];
  assert.equal(list.find((c) => c.id === res.json().id)?.goal, 'Mocne plecy');
  const card = (await call(weronika, SSG_STUDIO, 'GET', `/api/staff/clients/${res.json().id}`)).json();
  assert.equal(card.notes[0].body, 'Po kontuzji kolana');
  // Istniejącej klientki studia trenerka nie przypisze sobie numerem telefonu.
  const taken = await call(weronika, SSG_STUDIO, 'POST', '/api/staff/clients', { name: 'Julia', phone: SSG.julia });
  assert.equal(taken.statusCode, 409);
  // Klientka nie dodaje klientek.
  const julia = await login(SSG.julia);
  assert.equal((await call(julia, SSG_STUDIO, 'POST', '/api/staff/clients', { name: 'Ktoś', phone: '600 555 102' })).statusCode, 403);
});

test('vouchery: recepcja wystawia na wybrane zajęcia z kwotą, oznacza wykorzystanie; trenerka nie ma dostępu', async () => {
  const reception = await login(SSG.reception);
  const created = await call(reception, SSG_STUDIO, 'POST', '/api/staff/vouchers', { classTypeId: 'ss_yoga_stretch', amount: 15000, recipient: 'Ania', validDays: 90 });
  assert.equal(created.statusCode, 200, created.body);
  assert.match(created.json().code, /^VC-[A-Z2-9]{6}$/);
  const list = (await call(reception, SSG_STUDIO, 'GET', '/api/staff/vouchers')).json();
  const v = list.vouchers.find((x: { id: string }) => x.id === created.json().id);
  assert.equal(v.class_name, 'Joga Stretch');
  assert.equal(v.status, 'active');
  assert.ok(list.classTypes.length > 0);
  assert.equal((await call(reception, SSG_STUDIO, 'POST', '/api/staff/vouchers', { amount: 0 })).statusCode, 400);
  assert.equal((await call(reception, SSG_STUDIO, 'PATCH', `/api/staff/vouchers/${v.id}`, { status: 'redeemed' })).statusCode, 200);
  assert.equal((await call(reception, SSG_STUDIO, 'PATCH', `/api/staff/vouchers/${v.id}`, { status: 'cancelled' })).statusCode, 409);
  const weronika = await login(SSG.weronika);
  assert.equal((await call(weronika, SSG_STUDIO, 'GET', '/api/staff/vouchers')).statusCode, 403);
});
