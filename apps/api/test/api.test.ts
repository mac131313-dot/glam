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

test('Magda: trzy studia, osobne karnety', async () => {
  const token = await login(DEMO.magda);
  const me = (await call(token, null, 'GET', '/api/me')).json();
  assert.deepEqual(me.studios.map((s: { id: string }) => s.id).sort(), [K, R, SSG_STUDIO].sort());
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
  // Slot dodany w swój dzień po godzinie zajęć nie dopisuje sesji wstecz (inaczej test zależał od pory uruchomienia).
  const past = db.prepare('SELECT COUNT(*) AS n FROM class_sessions WHERE template_id IN (?, ?) AND starts_at <= ?').get(slots[0].id, slots[1].id, new Date().toISOString()) as { n: number };
  assert.equal(past.n, 0);
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

test('publiczna strona studia: grafik, zajęcia i trenerki bez logowania, bez danych klientek', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/public/studios/ssg' });
  assert.equal(r.statusCode, 200, r.body);
  const s = r.json();
  assert.equal(s.id, SSG_STUDIO);
  assert.ok(s.classes.length > 0 && s.trainers.length > 0);
  assert.ok(s.schedule.sessions.length > 0);
  assert.ok(s.schedule.sessions.every((x: Record<string, unknown>) => typeof x.spotsLeft === 'number' && !('my_booking_id' in x)));
  assert.ok(!('gateway_enc' in s) && !('nip' in s));
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/studios/nie-ma-takiego' })).statusCode, 404);
  db.prepare("UPDATE studios SET published = 0 WHERE id = ?").run(K);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/studios/flow-pilates' })).statusCode, 404);
  db.prepare("UPDATE studios SET published = 1 WHERE id = ?").run(K);
});

test('edytor strony: autozapis szkicu, publikacja, podgląd tylko dla właścicielki', async () => {
  const beata = await login(DEMO.krakowOwner);
  const iza = await login(DEMO.iza);
  assert.equal((await call(iza, K, 'GET', '/api/site/editor')).statusCode, 403, 'trenerka nie edytuje strony');
  assert.equal((await app.inject({ method: 'GET', url: '/api/site/preview' })).statusCode, 401);

  const start = (await call(beata, K, 'GET', '/api/site/editor')).json();
  assert.equal(start.publishedAt, null);
  assert.equal(start.unpublished, true);
  const doc = start.doc;
  doc.hero.values.serif = 'pilates na Kazimierzu';
  doc.sections.reverse();
  doc.sections.push({ key: 'a-pierwsza', type: 'article', visible: true, nav: 'Pierwsza wizyta', values: { title: 'Pierwsza wizyta', text: 'Przyjdź 10 minut wcześniej.' } });
  const logBefore = (db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE studio_id = ? AND action LIKE 'site.%'").get(K) as { n: number }).n;
  const saved = await call(beata, K, 'PUT', '/api/site/draft', { doc, auto: true });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().doc.sections.at(-1).values.layout, 'plain', 'dokument przechodzi przez parser');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE studio_id = ? AND action LIKE 'site.%'").get(K) as { n: number }).n, logBefore, 'autozapis bez wpisu w rejestrze');

  // Szkic widać w podglądzie, ale nie publicznie.
  const pub = (await app.inject({ method: 'GET', url: '/api/public/studios/flow-pilates' })).json();
  assert.equal(pub.site.hero.values.serif, '');
  const prev = (await call(beata, K, 'GET', '/api/site/preview')).json();
  assert.equal(prev.site.hero.values.serif, 'pilates na Kazimierzu');

  const published = (await call(beata, K, 'POST', '/api/site/publish')).json();
  assert.ok(published.publishedAt);
  assert.equal(published.unpublished, false);
  const after = (await app.inject({ method: 'GET', url: '/api/public/studios/flow-pilates' })).json();
  assert.equal(after.site.hero.values.serif, 'pilates na Kazimierzu');
  assert.equal(after.site.sections.at(-1).key, 'a-pierwsza');

  // Zmiana po publikacji → szkic odrzucony wraca do wersji publicznej.
  doc.hero.values.serif = 'roboczo';
  await call(beata, K, 'PUT', '/api/site/draft', { doc });
  assert.equal((await call(beata, K, 'GET', '/api/site/editor')).json().unpublished, true);
  const discarded = (await call(beata, K, 'POST', '/api/site/discard')).json();
  assert.equal(discarded.doc.hero.values.serif, 'pilates na Kazimierzu');
  assert.ok((db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE studio_id = ? AND action = 'site.save'").get(K) as { n: number }).n >= 1, 'ręczny zapis w rejestrze');
});

test('strona studia: nowe zajęcia dostają datę dodania (nowość), startowe – nie', async () => {
  const beata = await login(DEMO.krakowOwner);
  const created = await call(beata, K, 'POST', '/api/owner/class-types', { zoneId: 'z_kr_sala', name: 'Aerial Yoga', description: 'Joga w hamakach.' });
  assert.equal(created.statusCode, 200, created.body);
  const site = (await app.inject({ method: 'GET', url: '/api/public/studios/flow-pilates' })).json();
  const fresh = site.classes.find((c: { name: string }) => c.name === 'Aerial Yoga');
  assert.ok(fresh.createdAt, 'trigger wypełnia datę dodania');
  assert.ok(Date.now() - Date.parse(fresh.createdAt) < 60_000);
  assert.ok(site.classes.filter((c: { name: string }) => c.name !== 'Aerial Yoga').every((c: { createdAt: string | null }) => !c.createdAt || Date.parse(c.createdAt) - Date.parse(site.createdAt) < 86_400_000));
});

test('zdjęcia strony: wgranie, użycie w szkicu, publiczny adres; cudze zdjęcie odrzucone', async () => {
  const beata = await login(DEMO.krakowOwner);
  const joanna = await login(DEMO.owner);
  const dataUrl = 'data:image/jpeg;base64,' + jpegHeader(1600, 1000).toString('base64');
  const up = await call(beata, K, 'POST', '/api/site/media', { dataUrl });
  assert.equal(up.statusCode, 200, up.body);
  const { id, url, ratio } = up.json();
  assert.equal(url, `/api/public-media/${id}`);
  assert.equal(ratio, 1.6);
  assert.equal((await app.inject({ method: 'GET', url })).statusCode, 200, 'zdjęcie strony jest publiczne');

  const doc = (await call(beata, K, 'GET', '/api/site/editor')).json().doc;
  doc.hero.values.image = id;
  doc.photos.classes.kr_reformer = id;
  const saved = await call(beata, K, 'PUT', '/api/site/draft', { doc, auto: true });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().doc.hero.values.image, id);
  assert.ok(saved.json().catalog.classes.length > 0, 'edytor dostaje listę zajęć do zdjęć');

  // Innemu studiu to id nic nie da.
  const other = (await call(joanna, R, 'GET', '/api/site/editor')).json().doc;
  other.hero.values.image = id;
  assert.equal((await call(joanna, R, 'PUT', '/api/site/draft', { doc: other })).statusCode, 400);
});

test('filmy na stronie: wgranie mp4, serwer sam oznacza film w dokumencie, przewijanie (Range)', async () => {
  const beata = await login(DEMO.krakowOwner);
  // Minimalny nagłówek MP4 (ftyp) – wystarczy do rozpoznania formatu.
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)]);
  const up = await call(beata, K, 'POST', '/api/site/media', { dataUrl: 'data:video/mp4;base64,' + mp4.toString('base64'), durationSec: 12 });
  assert.equal(up.statusCode, 200, up.body);
  assert.equal(up.json().type, 'video');
  const { id, url } = up.json();
  const part = await app.inject({ method: 'GET', url, headers: { range: 'bytes=0-15' } });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-type'], 'video/mp4');

  const doc = (await call(beata, K, 'GET', '/api/site/editor')).json().doc;
  doc.hero.values.image = id;
  doc.media = {}; // edytor „zapomniał” – serwer i tak wie, że to film
  const saved = (await call(beata, K, 'PUT', '/api/site/draft', { doc, auto: true })).json();
  assert.deepEqual(saved.doc.media, { [id]: 'video' });
  // Zdjęcie udające film nie zostaje oznaczone jako film.
  const jpg = (await call(beata, K, 'POST', '/api/site/media', { dataUrl: 'data:image/jpeg;base64,' + jpegHeader(800, 600).toString('base64') })).json();
  doc.hero.values.image = jpg.id;
  doc.media = { [jpg.id]: 'video' };
  assert.deepEqual((await call(beata, K, 'PUT', '/api/site/draft', { doc, auto: true })).json().doc.media, {});
});

test('czat: załącznik ze zdjęciem widzą klientka i recepcja, inna klientka nie; pusta wiadomość i zły plik odpadają', async () => {
  const natalia = await login(SSG.natalia);
  const julia = await login(SSG.julia);
  const reception = await login(SSG.reception);
  const photo = `data:image/jpeg;base64,${jpegHeader(40, 30).toString('base64')}`;

  const sent = await call(natalia, SSG_STUDIO, 'POST', '/api/chat', { body: '', attachment: photo, attachmentName: 'kolano.jpg' });
  assert.equal(sent.statusCode, 200, sent.body);
  // Poza godzinami recepcji po wiadomości przychodzi jeszcze automatyczna odpowiedź – szukamy tej z plikiem.
  const mine = (await call(natalia, SSG_STUDIO, 'GET', '/api/chat')).json().messages.findLast((m: { attachment: unknown }) => m.attachment);
  assert.equal(mine.attachment.type, 'image');
  assert.equal(mine.attachment.name, 'kolano.jpg');

  const threads = (await call(reception, SSG_STUDIO, 'GET', '/api/staff/chats')).json();
  const last = (await call(reception, SSG_STUDIO, 'GET', `/api/staff/chats/${threads.find((t: { name: string }) => t.name === 'Natalia').client_id}`)).json().at(-1);
  if (!last.auto) assert.equal(threads.find((t: { name: string }) => t.name === 'Natalia').last_body, '📎 Załącznik');
  assert.equal((await call(reception, SSG_STUDIO, 'GET', mine.attachment.url)).statusCode, 200);
  assert.equal((await call(natalia, SSG_STUDIO, 'GET', mine.attachment.url)).statusCode, 200);
  assert.equal((await call(julia, SSG_STUDIO, 'GET', mine.attachment.url)).statusCode, 404, 'cudzy załącznik');

  assert.equal((await call(natalia, SSG_STUDIO, 'POST', '/api/chat', { body: '' })).statusCode, 400, 'pusta wiadomość');
  const txt = `data:text/plain;base64,${Buffer.from('hej').toString('base64')}`;
  assert.equal((await call(natalia, SSG_STUDIO, 'POST', '/api/chat', { body: 'plik', attachment: txt })).statusCode, 400, 'tylko zdjęcie, wideo, PDF');

  const clientId = threads.find((t: { name: string }) => t.name === 'Natalia').client_id;
  const reply = await call(reception, SSG_STUDIO, 'POST', `/api/staff/chats/${clientId}`, { body: 'Tak wygląda ćwiczenie', attachment: photo, attachmentName: 'cwiczenie.jpg' });
  assert.equal(reply.statusCode, 200, reply.body);
  const fromStaff = (await call(natalia, SSG_STUDIO, 'GET', '/api/chat')).json().messages.findLast((m: { from_staff: number; auto: number }) => m.from_staff && !m.auto);
  assert.equal(fromStaff.from_staff, 1);
  assert.equal((await call(natalia, SSG_STUDIO, 'GET', fromStaff.attachment.url)).statusCode, 200, 'plik od recepcji');
});

test('profil trenerki: opis własny, film i zaproszenia na jej zajęcia', async () => {
  const marzena = await login(DEMO.marzena);
  const ola = await login(DEMO.ola);
  const magda = await login(DEMO.magda);
  const marzenaId = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.marzena) as { id: string }).id;

  // Opis własny: moderacja (bez linków), akapity zostają.
  assert.equal((await call(marzena, R, 'PUT', '/api/staff/profile', { about: 'Zajrzyj na www.moja-strona.pl' })).statusCode, 400);
  assert.equal((await call(marzena, R, 'PUT', '/api/staff/profile', { about: 'Pierwszy akapit.\n\nDrugi akapit.' })).statusCode, 200);
  assert.equal((await call(magda, R, 'PUT', '/api/staff/profile', { about: 'x' })).statusCode, 403, 'klientka nie ma profilu trenerki');

  // Przełącznik życzeń urodzinowych zapisuje się osobno i nie rusza opisu.
  assert.equal((await call(marzena, R, 'PUT', '/api/staff/profile', { birthdayWishes: true })).statusCode, 200);
  const afterWishes = (await call(marzena, R, 'GET', '/api/staff/profile')).json();
  assert.equal(afterWishes.birthdayWishes, true);
  assert.equal(afterWishes.about, 'Pierwszy akapit.\n\nDrugi akapit.');

  // Zaproszenie tylko na własne zajęcia.
  const own = (await call(marzena, R, 'GET', '/api/staff/profile')).json();
  assert.ok(own.sessions.length > 0);
  const olaSession = (db.prepare("SELECT s.id FROM class_sessions s JOIN users u ON u.id = s.trainer_id WHERE s.studio_id = ? AND u.phone = ? AND s.status = 'scheduled' AND s.starts_at > ? LIMIT 1").get(R, DEMO.ola, new Date().toISOString()) as { id: string } | undefined)?.id;
  if (olaSession) assert.equal((await call(marzena, R, 'POST', '/api/staff/invites', { sessionId: olaSession, body: 'Zapraszam!' })).statusCode, 400);
  const inv = await call(marzena, R, 'POST', '/api/staff/invites', { sessionId: own.sessions[0].id, body: 'Spokojne tempo, dużo oddechu.' });
  assert.equal(inv.statusCode, 200, inv.body);

  // Klientka widzi profil z opisem i zaproszeniami; strona WWW pokazuje opis własny.
  const p = (await call(magda, R, 'GET', `/api/trainers/${marzenaId}`)).json();
  assert.equal(p.about, 'Pierwszy akapit.\n\nDrugi akapit.');
  assert.ok(p.invites.some((i: { sessionId: string }) => i.sessionId === own.sessions[0].id));
  const homeRes = await call(magda, R, 'GET', '/api/home');
  const home = homeRes.json();
  assert.ok(Array.isArray(home.trainerInvites), homeRes.body.slice(0, 300));
  assert.ok(Array.isArray(home.trainerInvites) && home.trainerInvites.length <= 3);
  const site = (await app.inject({ method: 'GET', url: '/api/public/studios/centrum-ruchu' })).json();
  const onSite = site.trainers.find((t: { id: string }) => t.id === marzenaId);
  assert.equal(onSite.about, 'Pierwszy akapit.\n\nDrugi akapit.');

  // Cudzego zaproszenia nie da się usunąć.
  const inviteId = p.invites[0].id;
  await call(ola, R, 'DELETE', `/api/staff/invites/${inviteId}`);
  assert.ok(db.prepare('SELECT 1 FROM trainer_invites WHERE id = ?').get(inviteId));
  await call(marzena, R, 'DELETE', `/api/staff/invites/${inviteId}`);
  assert.equal(db.prepare('SELECT 1 FROM trainer_invites WHERE id = ?').get(inviteId), undefined);
});

test('czat grupy: opiekunka pisze z aplikacji trenerki, członkinie odpowiadają, nieprzeczytane i moderacja', async () => {
  const weronika = await login(SSG.weronika);
  const basia = await login(SSG.basia);
  const karolina = await login(SSG.karolina);
  const natalia = await login(SSG.natalia);
  const uid = (phone: string) => (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string }).id;

  // Aplikacja trenerki widzi tylko swoje grupy, od najświeższej rozmowy.
  const mine = (await call(weronika, SSG_STUDIO, 'GET', '/api/staff/group-chats')).json();
  assert.deepEqual(mine.map((g: { id: string }) => g.id), ['ss_g_split']);
  assert.ok(mine[0].last.body.length > 0);
  assert.equal((await call(basia, SSG_STUDIO, 'GET', '/api/groups/ss_g_split/chat')).statusCode, 403, 'cudza grupa – bez wglądu');
  assert.equal((await call(natalia, SSG_STUDIO, 'GET', '/api/groups/ss_g_split/chat')).statusCode, 403, 'nie członkini');

  // Rozmowa: stare wiadomości z seeda, opiekunka oznaczona.
  const open = (await call(karolina, SSG_STUDIO, 'GET', '/api/groups/ss_g_split/chat')).json();
  assert.equal(open.group.trainer.name, 'Weronika');
  assert.ok(open.messages.some((m: { trainer: boolean }) => m.trainer));
  assert.equal(open.group.canModerate, false);

  // Opiekunka pisze → powiadomienie do członkiń, licznik nieprzeczytanych u Karoliny.
  const sent = await call(weronika, SSG_STUDIO, 'POST', '/api/groups/ss_g_split/chat', { body: 'Jutro zajęcia w sali 2, weźcie paski 🧘‍♀️' });
  assert.equal(sent.statusCode, 200, sent.body);
  assert.ok(db.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND action = 'community/groups/ss_g_split'").get(uid(SSG.karolina)));
  const list = (await call(karolina, SSG_STUDIO, 'GET', '/api/groups')).json().find((g: { id: string }) => g.id === 'ss_g_split');
  assert.equal(list.unread, 1);
  assert.equal(list.trainer, 'Weronika');
  const fresh = (await call(karolina, SSG_STUDIO, 'GET', `/api/groups/ss_g_split/chat?after=${encodeURIComponent(open.messages.at(-1).created_at)}`)).json();
  assert.equal(fresh.messages.length, 1, 'dociąganie tylko nowych');
  assert.equal((await call(karolina, SSG_STUDIO, 'GET', '/api/groups')).json().find((g: { id: string }) => g.id === 'ss_g_split').unread, 0);

  // Członkini odpowiada → opiekunka dostaje jedno zbiorcze powiadomienie na godzinę.
  const reply = (await call(karolina, SSG_STUDIO, 'POST', '/api/groups/ss_g_split/chat', { body: 'Będę!' })).json();
  await call(karolina, SSG_STUDIO, 'POST', '/api/groups/ss_g_split/chat', { body: 'I wezmę koleżankę' });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND action = 'staff/groups/ss_g_split'").get(uid(SSG.weronika)) as { n: number }).n, 1);

  // Opiekunka ukrywa cudzą wiadomość, członkini nie może ukryć wiadomości opiekunki.
  assert.equal((await call(karolina, SSG_STUDIO, 'DELETE', `/api/groups/ss_g_split/chat/${sent.json().id}`)).statusCode, 403);
  assert.equal((await call(weronika, SSG_STUDIO, 'DELETE', `/api/groups/ss_g_split/chat/${reply.id}`)).json().hidden, true);
  assert.ok(!(await call(karolina, SSG_STUDIO, 'GET', '/api/groups/ss_g_split/chat')).json().messages.some((m: { id: string }) => m.id === reply.id));

  // Przypisanie opiekunki – tylko moderacja i tylko trenerka studia.
  const owner = await login(SSG.owner);
  assert.equal((await call(weronika, SSG_STUDIO, 'PUT', '/api/staff/groups/ss_g_split/trainer', { trainerId: uid(SSG.basia) })).statusCode, 403);
  assert.equal((await call(owner, SSG_STUDIO, 'PUT', '/api/staff/groups/ss_g_split/trainer', { trainerId: uid(SSG.karolina) })).statusCode, 400);
});

test('napisz do trenerki: prywatna rozmowa, trenerka tylko odpowiada, recepcja i inne trenerki nie widzą', async () => {
  const julia = await login(SSG.julia);
  const basia = await login(SSG.basia);
  const weronika = await login(SSG.weronika);
  const reception = await login(SSG.reception);
  const uid = (phone: string) => (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string }).id;
  const [basiaId, juliaId] = [uid(SSG.basia), uid(SSG.julia)];

  // Trenerka nie zaczyna rozmowy sama.
  assert.equal((await call(basia, SSG_STUDIO, 'POST', `/api/staff/dm/${juliaId}`, { body: 'Hej!' })).statusCode, 404);
  // Do klientki nie da się „napisać jak do trenerki”.
  assert.equal((await call(basia, SSG_STUDIO, 'POST', `/api/dm/${juliaId}`, { body: 'Hej!' })).statusCode, 404);

  const sent = await call(julia, SSG_STUDIO, 'POST', `/api/dm/${basiaId}`, { body: 'Czy mogę przyjść z lekkim bólem kolana?' });
  assert.equal(sent.statusCode, 200, sent.body);
  await call(julia, SSG_STUDIO, 'POST', `/api/dm/${basiaId}`, { body: 'Chodzi o jutrzejszy Pilates' });
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND action = ?").get(basiaId, `staff/dm/${juliaId}`) as { n: number }).n, 1, 'jedno zbiorcze powiadomienie');

  const inbox = (await call(basia, SSG_STUDIO, 'GET', '/api/staff/dm')).json();
  assert.equal(inbox[0].id, juliaId);
  assert.equal(inbox[0].unread, 2);
  assert.equal((await call(weronika, SSG_STUDIO, 'GET', '/api/staff/dm')).json().length, 0, 'inna trenerka nie widzi');
  assert.equal((await call(reception, SSG_STUDIO, 'GET', `/api/staff/dm/${juliaId}`)).statusCode, 403, 'recepcja nie czyta');

  const conv = (await call(basia, SSG_STUDIO, 'GET', `/api/staff/dm/${juliaId}`)).json();
  assert.equal(conv.messages.length, 2);
  assert.equal((await call(basia, SSG_STUDIO, 'GET', '/api/staff/dm')).json()[0].unread, 0);
  const mine = (await call(julia, SSG_STUDIO, 'GET', `/api/dm/${basiaId}`)).json();
  assert.equal(mine.messages.at(-1).seen, true, 'klientka widzi, że przeczytane');

  // Odpowiedź trenerki → powiadomienie do klientki prowadzące do rozmowy.
  assert.equal((await call(basia, SSG_STUDIO, 'POST', `/api/staff/dm/${juliaId}`, { body: 'Jasne, pokażę Ci wersję bez obciążania kolana.' })).statusCode, 200);
  assert.ok(db.prepare('SELECT 1 FROM notifications WHERE user_id = ? AND action = ?').get(juliaId, `dm/${basiaId}`));
  const threads = (await call(julia, SSG_STUDIO, 'GET', '/api/dm')).json();
  assert.equal(threads[0].name, 'Basia');
  assert.equal(threads[0].unread, 1);

  // Usuwa się tylko własne wiadomości.
  assert.equal((await call(basia, SSG_STUDIO, 'DELETE', `/api/staff/dm/${juliaId}/${sent.json().id}`)).statusCode, 404);
  assert.equal((await call(julia, SSG_STUDIO, 'DELETE', `/api/dm/${basiaId}/${sent.json().id}`)).statusCode, 200);
});

test('jedna skrzynka Wiadomości: recepcja, trenerka i grupy na jednej liście; panel według uprawnień', async () => {
  const natalia = await login(SSG.natalia);
  const basia = await login(SSG.basia);
  const weronika = await login(SSG.weronika);
  const reception = await login(SSG.reception);
  const uid = (phone: string) => (db.prepare('SELECT id FROM users WHERE phone = ?').get(phone) as { id: string }).id;
  const [nataliaId, basiaId] = [uid(SSG.natalia), uid(SSG.basia)];
  type T = { kind: string; id: string; unread: number; last: { body: string; at: string } | null; mine?: boolean };
  const threads = async (token: string, url = '/api/threads') => (await call(token, SSG_STUDIO, 'GET', url)).json() as { threads: T[]; unread: number };

  // Recepcja jest zawsze na liście – nawet bez rozmowy klientka ma gdzie napisać. Grupa: tylko ta, do której należy.
  const before = await threads(natalia);
  assert.ok(before.threads.some((t) => t.kind === 'reception' && t.id === 'reception'));
  assert.ok(before.threads.some((t) => t.kind === 'group' && t.id === 'ss_g_morning'));
  assert.ok(!before.threads.some((t) => t.id === 'ss_g_split'), 'grupa, do której nie należy – poza skrzynką');

  // Trzy źródła: recepcja, prywatnie do trenerki, czat grupy.
  assert.equal((await call(natalia, SSG_STUDIO, 'POST', '/api/chat', { body: 'Czy jutro jest parking?' })).statusCode, 200);
  assert.equal((await call(natalia, SSG_STUDIO, 'POST', `/api/dm/${basiaId}`, { body: 'Czy mogę przyjść później?' })).statusCode, 200);
  assert.equal((await call(basia, SSG_STUDIO, 'POST', '/api/groups/ss_g_morning/chat', { body: 'Jutro zaczynamy 5 minut później' })).statusCode, 200);
  assert.equal((await call(basia, SSG_STUDIO, 'POST', `/api/staff/dm/${nataliaId}`, { body: 'Jasne, daj znać przy wejściu' })).statusCode, 200);

  const after = await threads(natalia);
  const kinds = after.threads.map((t) => t.kind);
  assert.ok(kinds.includes('reception') && kinds.includes('dm') && kinds.includes('group'));
  const at = after.threads.map((t) => t.last?.at ?? '');
  assert.deepEqual(at, [...at].sort().reverse(), 'od najświeższej rozmowy');
  assert.equal(after.threads.find((t) => t.kind === 'dm')!.unread, 1);
  assert.ok(after.threads.find((t) => t.id === 'ss_g_morning')!.unread >= 1);
  assert.equal(after.unread, after.threads.reduce((n, t) => n + t.unread, 0));
  assert.equal((await call(natalia, SSG_STUDIO, 'GET', '/api/home')).json().messagesUnread, after.unread, 'kropka na Start = suma skrzynki');
  // Otwarcie rozmowy z trenerką zdejmuje jej licznik.
  await call(natalia, SSG_STUDIO, 'GET', `/api/dm/${basiaId}`);
  assert.equal((await threads(natalia)).threads.find((t) => t.kind === 'dm')!.unread, 0);

  // Panel: recepcja widzi rozmowę z recepcją, nie prywatną do trenerki.
  const desk = await threads(reception, '/api/staff/threads');
  const fromNatalia = desk.threads.find((t) => t.kind === 'reception' && t.id === nataliaId);
  assert.ok(fromNatalia && fromNatalia.unread >= 1);
  assert.ok(!desk.threads.some((t) => t.kind === 'dm'));
  // Trenerka: swoja klientka prywatnie i swoja grupa; bez czatu recepcji.
  const trainer = await threads(basia, '/api/staff/threads');
  assert.ok(trainer.threads.some((t) => t.kind === 'dm' && t.id === nataliaId));
  assert.ok(trainer.threads.some((t) => t.kind === 'group' && t.id === 'ss_g_morning'));
  assert.ok(!trainer.threads.some((t) => t.kind === 'reception'));
  // Inna trenerka nie widzi cudzej prywatnej rozmowy ani cudzej grupy.
  const other = await threads(weronika, '/api/staff/threads');
  assert.ok(!other.threads.some((t) => t.id === nataliaId || t.id === 'ss_g_morning'));
  // Klientka nie wchodzi do skrzynki panelu.
  assert.equal((await call(natalia, SSG_STUDIO, 'GET', '/api/staff/threads')).statusCode, 403);
});

test('grupy za zgodą: prośba czeka w panelu, akceptacja dodaje do grupy, a klientka dopiero wtedy widzi wpisy', async () => {
  const owner = await login(SSG.owner);
  const julia = await login(SSG.julia);
  const hub = (await call(owner, SSG_STUDIO, 'GET', '/api/staff/community')).json();
  assert.equal(hub.requests.length, 2, 'dwie przykładowe prośby z danych demo');

  const split = (await call(julia, SSG_STUDIO, 'GET', '/api/groups')).json().find((g: { id: string }) => g.id === 'ss_g_split');
  assert.equal(split.approval, 1);
  const asked = await call(julia, SSG_STUDIO, 'POST', '/api/groups/ss_g_split/join', { message: 'Chcę spróbować!' });
  assert.equal(asked.json().requested, true);
  assert.equal((await call(julia, SSG_STUDIO, 'GET', '/api/groups/ss_g_split/chat')).statusCode, 403, 'przed akceptacją bez dostępu do rozmowy');

  const juliaId = (db.prepare('SELECT id FROM users WHERE phone = ?').get(SSG.julia) as { id: string }).id;
  assert.equal((await call(julia, SSG_STUDIO, 'POST', `/api/staff/group-requests/ss_g_split/${juliaId}`, { action: 'accept' })).statusCode, 403, 'klientka nie akceptuje sama');
  assert.equal((await call(owner, SSG_STUDIO, 'POST', `/api/staff/group-requests/ss_g_split/${juliaId}`, { action: 'accept' })).statusCode, 200);
  const after = (await call(julia, SSG_STUDIO, 'GET', '/api/groups')).json().find((g: { id: string }) => g.id === 'ss_g_split');
  assert.equal(after.joined, 1);
  assert.equal(after.requested, 0);
  assert.equal((await call(julia, SSG_STUDIO, 'GET', '/api/groups/ss_g_split/chat')).statusCode, 200);
  assert.equal((await call(owner, SSG_STUDIO, 'POST', `/api/staff/group-requests/ss_g_split/${juliaId}`, { action: 'accept' })).statusCode, 404, 'drugi raz – już rozpatrzona');
});

test('płatność bez opisu pokazuje nazwę kupionego karnetu (pulpit i historia klientki)', async () => {
  const magdaId = (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.magda) as { id: string }).id;
  const pass = db.prepare('SELECT id, product_name FROM passes WHERE studio_id = ? AND user_id = ? LIMIT 1').get(R, magdaId) as { id: string; product_name: string };
  db.prepare("INSERT INTO payments (id, studio_id, user_id, kind, reference_id, amount_grosze, method, status, created_at) VALUES ('pay_nodesc', ?, ?, 'pass', ?, 100, 'blik', 'paid', ?)").run(R, magdaId, pass.id, new Date().toISOString());

  const owner = await login(DEMO.owner);
  const dash = (await call(owner, R, 'GET', '/api/owner/dashboard')).json();
  assert.equal(dash.payments[0].description, pass.product_name);

  const magda = await login(DEMO.magda);
  const mine = (await call(magda, R, 'GET', '/api/my/payments')).json() as { id: string; description: string }[];
  assert.equal(mine.find((p) => p.id === 'pay_nodesc')?.description, pass.product_name);
});
