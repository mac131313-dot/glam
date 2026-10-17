// Testy modułów v2.11: role (koordynatorka), rezerwacje we dwie i cykliczne, zawieszenie, kupony, polecenia,
// społeczność i moderacja, wyzwania, kursy, sklep, wydarzenia, zadania cykliczne (życzenia, ankiety),
// biometria (WebAuthn – programowy authenticator), Web Push (szyfrowanie), RODO (eksport, usunięcie), kalendarz.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, createHash, createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { buildApp } from '../src/app.ts';
import type { Deps } from '../src/context.ts';
import { openDb } from '../src/db.ts';
import { DEMO, seed } from '../src/seed.ts';
import { COUPON_MISSES } from '../src/routes/client.ts';
import { runJobs } from '../src/services/jobs.ts';
import { encryptPayload } from '../src/services/webpush.ts';
import { ConsoleEmailSender, ConsolePushSender, ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

const db = openDb(':memory:');
const sms = new ConsoleSmsGateway(true);
const deps: Deps = { db, sms, payments: new MockPaymentProvider(), email: new ConsoleEmailSender(true), push: new ConsolePushSender(true), exposeDevCodes: true, publicUrl: 'http://localhost:5173' };
const app = buildApp(deps);
const R = 'st_rzeszow';
const tokens = new Map<string, string>();
let ip = 0;

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db);
  console.warn = warn;
});

async function login(phone: string): Promise<string> {
  if (tokens.has(phone)) return tokens.get(phone)!;
  const r = await app.inject({ method: 'POST', url: '/api/dev/login', payload: { phone }, remoteAddress: `10.1.0.${++ip}` });
  if (r.statusCode === 404) {
    const a = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress: `10.1.1.${++ip}` });
    const v = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: a.json().devCode } });
    tokens.set(phone, v.json().token);
    return v.json().token;
  }
  tokens.set(phone, r.json().token);
  return r.json().token;
}

const call = (token: string, studio: string | null, method: string, url: string, payload?: object) =>
  app.inject({ method: method as 'GET', url, payload, headers: { authorization: `Bearer ${token}`, origin: 'http://localhost', host: 'localhost', ...(studio ? { 'x-studio-id': studio } : {}) } });

const futureSession = (classTypeId: string, minHours = 6) =>
  db
    .prepare("SELECT id FROM class_sessions WHERE studio_id = ? AND class_type_id = ? AND status = 'scheduled' AND starts_at > ? AND public = 1 ORDER BY starts_at")
    .all(R, classTypeId, new Date(Date.now() + minHours * 3_600_000).toISOString()) as { id: string }[];

test('koordynatorka: moderuje społeczność, nie widzi finansów ani kampanii', async () => {
  const zuza = await login(DEMO.zuza);
  assert.equal((await call(zuza, R, 'GET', '/api/staff/community')).statusCode, 200);
  assert.equal((await call(zuza, R, 'GET', '/api/owner/finance')).statusCode, 403);
  assert.equal((await call(zuza, R, 'GET', '/api/owner/campaigns')).statusCode, 403);
  assert.equal((await call(zuza, R, 'GET', '/api/staff/clients')).statusCode, 403);
});

test('trening we dwie: dwa miejsca jednym kliknięciem, odwołanie zwalnia oba', async () => {
  const magda = await login(DEMO.magda);
  const sid = futureSession('ct_reformer', 30).find((s) => {
    const taken = (db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND status IN ('booked','attended')").get(s.id) as { n: number }).n;
    const mine = db.prepare("SELECT 1 FROM bookings WHERE session_id = ? AND user_id = 'u_005' AND status IN ('booked','waitlist')").get(s.id);
    return taken <= 5 && !mine;
  })!.id;
  const before = (await call(magda, R, 'GET', '/api/my/passes')).json()[0].balances;
  const res = await call(magda, R, 'POST', '/api/bookings', { sessionId: sid, guest: { name: 'Kasia K.' } });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().seats, 2);
  const after = (await call(magda, R, 'GET', '/api/my/passes')).json()[0].balances;
  assert.equal(Object.values(after)[0] as number, (Object.values(before)[0] as number) - 2);
  const n = (db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND user_id = 'u_005' AND status = 'booked'").get(sid) as { n: number }).n;
  assert.equal(n, 2);
  await call(magda, R, 'DELETE', `/api/bookings/${res.json().bookingId}`);
  const left = (db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE session_id = ? AND user_id = 'u_005' AND status = 'booked'").get(sid) as { n: number }).n;
  assert.equal(left, 0);
  assert.deepEqual((await call(magda, R, 'GET', '/api/my/passes')).json()[0].balances, before);
});

test('rezerwacja cykliczna, potwierdzenie obecności i zawieszenie karnetu', async () => {
  const magda = await login(DEMO.magda);
  const rec = await call(magda, R, 'POST', '/api/recurring', { templateId: 't1' });
  assert.equal(rec.statusCode, 200, rec.body);
  assert.equal((await call(magda, R, 'GET', '/api/my/recurring')).json().length, 1);
  const booking = db.prepare("SELECT id FROM bookings WHERE user_id = 'u_005' AND studio_id = ? AND status = 'booked' LIMIT 1").get(R) as { id: string };
  assert.equal((await call(magda, R, 'POST', `/api/bookings/${booking.id}/confirm`)).statusCode, 200);
  const passes = (await call(magda, R, 'GET', '/api/my/passes')).json();
  const today = new Date().toISOString().slice(0, 10);
  const plus = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
  const fr = await call(magda, R, 'POST', `/api/passes/${passes[0].id}/freeze`, { from: plus(3), to: plus(9), reason: 'vacation' });
  assert.equal(fr.statusCode, 200, fr.body);
  const again = await call(magda, R, 'POST', `/api/passes/${passes[0].id}/freeze`, { from: today, to: plus(100), reason: 'vacation' });
  assert.equal(again.statusCode, 409);
  await call(magda, R, 'DELETE', `/api/recurring/${(await call(magda, R, 'GET', '/api/my/recurring')).json()[0].id}`);
});

test('kupon i polecenie: pierwsze zajęcia gratis dla znajomej, bonus dla zapraszającej po jej zakupie', async () => {
  const magda = await login(DEMO.magda);
  const check = await call(magda, R, 'POST', '/api/coupons/check', { code: 'jesien15', kind: 'pass', amountGrosze: 26000 });
  assert.equal(check.statusCode, 200, check.body);
  assert.equal(check.json().finalGrosze, 22100);
  const ref = await call(magda, R, 'POST', '/api/referrals', { phone: '600 444 555', channel: 'link' });
  assert.equal(ref.statusCode, 200, ref.body);
  const friend = await login('+48600444555');
  const acc = await call(friend, null, 'POST', '/api/referrals/accept', { code: ref.json().code });
  assert.equal(acc.statusCode, 200, acc.body);
  const fp = (await call(friend, R, 'GET', '/api/my/passes')).json();
  assert.equal(fp[0].productName, 'Pierwsze zajęcia gratis');
  const buy = await call(friend, R, 'POST', '/api/purchases', { productId: 'pr_start', method: 'blik' });
  assert.equal(buy.statusCode, 200, buy.body);
  const bonus = db.prepare("SELECT product_name FROM passes WHERE user_id = 'u_005' AND source = 'referral'").get() as { product_name: string } | undefined;
  assert.equal(bonus?.product_name, 'Bonus za polecenie');
  const list = (await call(magda, R, 'GET', '/api/my/referrals')).json();
  assert.match(list.find((r: { code: string }) => r.code === ref.json().code).statusText, /kupiła karnet/);
});

test('społeczność: wulgaryzmy odrzucone, zgłoszenie i ukrycie przez koordynatorkę', async () => {
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'POST', '/api/posts', { body: 'kurwa, jak ciężko' })).statusCode, 400);
  const ok = await call(magda, R, 'POST', '/api/posts', { body: 'Dziękuję za dzisiejszy Reformer 💛' });
  assert.equal(ok.statusCode, 200, ok.body);
  assert.equal((await call(magda, R, 'POST', '/api/posts', { body: 'Ogłoszenie', kind: 'announcement' })).statusCode, 403);
  const ania = await login(DEMO.ania);
  await call(ania, R, 'POST', '/api/reports', { targetKind: 'post', targetId: ok.json().id, reason: 'test' });
  const zuza = await login(DEMO.zuza);
  const reports = (await call(zuza, R, 'GET', '/api/staff/reports')).json();
  const rep = reports.find((r: { target_id: string }) => r.target_id === ok.json().id);
  assert.equal((await call(zuza, R, 'POST', `/api/staff/reports/${rep.id}`, { action: 'hide' })).statusCode, 200);
  const feed = (await call(ania, R, 'GET', '/api/feed')).json();
  assert.ok(!feed.some((p: { id: string }) => p.id === ok.json().id));
});

test('wyzwanie z odhaczaniem: postęp, ukończenie, odznaka i punkty', async () => {
  const owner = await login(DEMO.owner);
  // Dzień w strefie studia, nie w UTC – tuż po północy to dwie różne daty.
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(new Date());
  const ch = await call(owner, R, 'POST', '/api/staff/challenges', { title: 'Jeden dzień', metric: 'checkins', target: 1, startsOn: today, endsOn: today });
  assert.equal(ch.statusCode, 200, ch.body);
  const ania = await login(DEMO.ania);
  assert.equal((await call(ania, R, 'POST', `/api/challenges/${ch.json().id}/checkin`)).statusCode, 409);
  await call(ania, R, 'POST', `/api/challenges/${ch.json().id}/join`);
  const done = (await call(ania, R, 'POST', `/api/challenges/${ch.json().id}/checkin`)).json();
  assert.equal(done.completed, true);
  assert.ok(db.prepare("SELECT 1 FROM user_badges WHERE user_id = 'u_006' AND code = 'challenge'").get());
});

test('kurs w karnecie: dostęp przez Reformer 9, drip, postęp, pytania; kurs czekający na akceptację niewidoczny', async () => {
  const magda = await login(DEMO.magda);
  const list = (await call(magda, R, 'GET', '/api/courses')).json();
  const co1 = list.find((c: { id: string }) => c.id === 'co1');
  assert.equal(co1.access, 'pass');
  assert.ok(!list.some((c: { id: string }) => c.id === 'co2'));
  const detail = (await call(magda, R, 'GET', '/api/courses/co1')).json();
  assert.equal(detail.lessonsList[0].unlocked, true);
  assert.equal(detail.lessonsList.at(-1).unlocked, false, 'drip: ostatnia lekcja odblokuje się później');
  const p = await call(magda, R, 'POST', '/api/lessons/l2/progress', { position: 600, completed: true });
  assert.equal(p.statusCode, 200, p.body);
  assert.ok(p.json().progress >= 40);
  assert.equal((await call(magda, R, 'PUT', '/api/courses/co1/review', { rating: 5, body: 'Spokojnie i jasno.' })).statusCode, 200);
  const owner = await login(DEMO.owner);
  assert.equal((await call(owner, R, 'POST', '/api/creator/courses/co2/status', { to: 'published' })).statusCode, 200);
  const ola = await login(DEMO.ola);
  const bad = await call(ola, R, 'POST', '/api/creator/courses', { title: 'Ten kurs wyleczy plecy', kind: 'program', level: 'wszystkie' });
  assert.equal(bad.statusCode, 400);
});

test('strona sprzedażowa kursu: publiczne dane bez sesji, pakiety, prowadzące, kalendarz; szkic – 404', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/public/studios/centrum-ruchu/courses/co4' });
  assert.equal(r.statusCode, 200, r.body);
  const page = r.json();
  assert.equal(page.salesOpen, true);
  assert.equal(page.edition.theme, 'fit & healthy routine');
  assert.deepEqual(page.tiers.map((t: { name: string }) => t.name), ['Standard', 'Full', 'Personal']);
  assert.equal(page.people.length, 4);
  assert.equal(page.modules.length, 4);
  assert.equal(page.modules[0].lessons, 4);
  assert.ok(page.calendar.length >= 7 && page.calendar[0].day === 1);
  assert.equal(page.course.averageMinutes, 21);
  assert.equal(page.trailer.title, 'Pierwszy trening przy krześle');
  // wspólne cechy na górze tabeli, konsultacja tylko w Personal
  assert.equal(page.comparison[0].common, true);
  const consult = page.comparison.find((c: { feature: string }) => c.feature.startsWith('Konsultacja'));
  assert.deepEqual(consult.tiers, { t4_std: false, t4_full: false, t4_pers: true });
  assert.ok(page.passProducts.some((p: { id: string }) => p.id === 'pr_r9'), 'kanał „w karnecie”');
  assert.ok(!('phone' in page.people[0]) && !JSON.stringify(page).includes('+48500000002'), 'bez danych kontaktowych trenerek');
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/studios/centrum-ruchu/courses/co3' })).statusCode, 404);
});

test('zakup pakietu na www: konto z numeru, płatność, dostęp w aplikacji; drugi raz – 409; po sprzedaży – 409', async () => {
  const url = '/api/public/studios/centrum-ruchu/courses/co4/purchase';
  const buyer = { tierId: 't4_full', name: 'Kasia Nowa', phone: '511 222 333', email: 'kasia@example.com', method: 'blik', acceptTerms: true, waiveWithdrawal: true };
  assert.equal((await app.inject({ method: 'POST', url, payload: { ...buyer, waiveWithdrawal: false } })).statusCode, 400);
  const r = await app.inject({ method: 'POST', url, payload: buyer });
  assert.equal(r.statusCode, 200, r.body);
  const u = db.prepare("SELECT id, name, email FROM users WHERE phone = '+48511222333'").get() as { id: string; name: string; email: string };
  assert.equal(u.name, 'Kasia Nowa');
  const e = db.prepare("SELECT source, tier_id, edition_id, expires_at, price_paid_grosze FROM course_enrollments WHERE course_id = 'co4' AND user_id = ?").get(u.id) as Record<string, unknown>;
  assert.equal(e.source, 'purchase');
  assert.equal(e.tier_id, 't4_full');
  assert.equal(e.edition_id, 'ed4');
  assert.equal(e.price_paid_grosze, 27900);
  assert.ok(e.expires_at, 'dostęp do końca edycji');
  assert.ok(db.prepare("SELECT 1 FROM payments WHERE user_id = ? AND kind = 'course' AND reference_id = 'co4' AND amount_grosze = 27900").get(u.id));
  assert.ok(db.prepare("SELECT 1 FROM memberships WHERE studio_id = ? AND user_id = ? AND role = 'client'").get(R, u.id));
  const kasia = await login('+48511222333');
  const course = (await call(kasia, R, 'GET', '/api/courses/co4')).json();
  assert.equal(course.access, 'purchase');
  assert.equal((await app.inject({ method: 'POST', url, payload: buyer })).statusCode, 409);
  // kanał karnetowy: Magda z Reformer 9 ma kurs bez zakupu
  const magda = await login(DEMO.magda);
  assert.equal((await call(magda, R, 'GET', '/api/courses/co4')).json().access, 'pass');
  const until = (db.prepare("SELECT sales_until FROM course_editions WHERE id = 'ed4'").get() as { sales_until: string }).sales_until;
  db.prepare("UPDATE course_editions SET sales_until = ? WHERE id = 'ed4'").run(new Date(Date.now() - 1000).toISOString());
  const closed = await app.inject({ method: 'POST', url, payload: { ...buyer, phone: '511 222 444' } });
  assert.equal(closed.statusCode, 409);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/studios/centrum-ruchu/courses/co4' })).json().salesOpen, false);
  db.prepare("UPDATE course_editions SET sales_until = ? WHERE id = 'ed4'").run(until);
});

test('edytor strony kursu w panelu: treści, edycje, pakiety (ze sprzedażą – ukryty), prowadzące, lekcje; obca trenerka – 403', async () => {
  const owner = await login(DEMO.owner);
  const ola = await login(DEMO.ola);
  const pub = async () => (await app.inject({ method: 'GET', url: '/api/public/studios/centrum-ruchu/courses/co4' })).json();
  const editor = (await call(owner, R, 'GET', '/api/creator/courses/co4/page')).json();
  assert.equal(editor.slug, 'centrum-ruchu');
  assert.equal(editor.tiers.find((t: { id: string }) => t.id === 't4_full').sold, 1, 'sprzedaż z poprzedniego testu');
  assert.equal((await call(ola, R, 'GET', '/api/creator/courses/co4/page')).statusCode, 403);
  assert.equal((await call(ola, R, 'PUT', '/api/creator/courses/co4/page', { promise: 'x' })).statusCode, 403);

  // treści strony: walidacja medicalClaims i normalizacja przez parseCoursePage
  assert.equal((await call(owner, R, 'PUT', '/api/creator/courses/co4/page', { ...editor.page, faq: [{ q: 'Czy to działa?', a: 'Gwarantuje efekt w tydzień.' }] })).statusCode, 400);
  const saved = await call(owner, R, 'PUT', '/api/creator/courses/co4/page', { ...editor.page, promise: '  Zdrowa rutyna w 25 minut  ', outcomes: ['Elastyczność', '', 7] });
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal((await pub()).page.promise, 'Zdrowa rutyna w 25 minut');
  assert.deepEqual((await pub()).page.outcomes, ['Elastyczność']);

  // edycje: daty w kolejności; edycji z uczestniczkami nie usuwamy
  assert.equal((await call(owner, R, 'POST', '/api/creator/courses/co4/editions', { name: 'Zima', salesFrom: '2027-02-01', salesUntil: '2027-01-01' })).statusCode, 400);
  const ed = await call(owner, R, 'POST', '/api/creator/courses/co4/editions', { name: 'Edycja zimowa', salesFrom: '2027-01-01', salesUntil: '2027-02-01', news: [{ title: 'Nowy blok', body: 'Mobilność' }, { title: '' }] });
  assert.equal(ed.statusCode, 200, ed.body);
  assert.equal((await pub()).edition.id, 'ed4', 'bieżąca edycja to ta w sprzedaży, nie zapowiedziana');
  assert.equal((await call(owner, R, 'PUT', `/api/creator/editions/${ed.json().id}`, { name: 'Edycja zimowa', theme: 'schudniesz do świąt' })).statusCode, 400);
  assert.equal((await call(owner, R, 'DELETE', '/api/creator/editions/ed4')).statusCode, 409);
  assert.equal((await call(owner, R, 'DELETE', `/api/creator/editions/${ed.json().id}`)).statusCode, 200);

  // pakiety: nowy na końcu listy; pakiet ze sprzedażą tylko się chowa (active = 0), bez sprzedaży – znika
  const tier = await call(owner, R, 'POST', '/api/creator/courses/co4/tiers', { name: 'Mini', price: 9900, features: ['Wszystkie treningi edycji', 'Wszystkie treningi edycji'], seatLimit: 5 });
  assert.equal(tier.statusCode, 200, tier.body);
  assert.equal((await pub()).tiers.at(-1).name, 'Mini');
  assert.equal((await call(owner, R, 'POST', '/api/creator/courses/co4/tiers', { name: 'Zła', price: -1 })).statusCode, 400);
  const del = (await call(owner, R, 'DELETE', '/api/creator/tiers/t4_full')).json();
  assert.equal(del.archived, true);
  assert.ok(db.prepare("SELECT 1 FROM course_tiers WHERE id = 't4_full' AND active = 0").get());
  assert.ok(!(await pub()).tiers.some((t: { id: string }) => t.id === 't4_full'));
  assert.equal((await call(owner, R, 'DELETE', `/api/creator/tiers/${tier.json().id}`)).json().archived, false);
  assert.ok(!db.prepare('SELECT 1 FROM course_tiers WHERE id = ?').get(tier.json().id));
  assert.equal((await call(owner, R, 'PUT', '/api/creator/tiers/t4_full', { name: 'Full', price: 27900, features: ['Wszystkie treningi edycji'], highlight: true, active: true })).statusCode, 200);
  assert.ok((await pub()).tiers.some((t: { id: string }) => t.id === 't4_full'), 'pakiet przywrócony');

  // prowadzące: gość bez konta, podpięcie do lekcji, usunięcie odpina lekcję
  assert.equal((await call(owner, R, 'POST', '/api/creator/courses/co4/people', { name: 'Ewa', role: 'guru' })).statusCode, 400);
  assert.equal((await call(owner, R, 'POST', '/api/creator/courses/co4/people', { name: 'Ewa', role: 'expert', bio: 'Leczy kręgosłup.' })).statusCode, 400);
  const person = await call(owner, R, 'POST', '/api/creator/courses/co4/people', { name: 'Ewa Lis', role: 'expert', title: 'dietetyczka', bio: 'Uczy prostych nawyków.' });
  assert.equal(person.statusCode, 200, person.body);
  const linked = await call(owner, R, 'POST', '/api/creator/courses/co4/people', { userId: (db.prepare('SELECT id FROM users WHERE phone = ?').get(DEMO.ola) as { id: string }).id, role: 'trainer' });
  assert.equal(linked.statusCode, 200, linked.body);
  assert.equal((db.prepare('SELECT name FROM course_people WHERE id = ?').get(linked.json().id) as { name: string }).name, 'Ola', 'imię z konta');
  const pid = person.json().id;
  assert.equal((await call(owner, R, 'PUT', '/api/creator/lessons/l4_8/person', { personId: pid })).statusCode, 200);
  assert.equal((await call(owner, R, 'PUT', '/api/creator/lessons/l4_8/person', { personId: 'p_obcy' })).statusCode, 400);
  assert.ok((await pub()).modules.find((m: { name: string }) => m.name === 'Masaż twarzy').people.includes(pid));
  assert.equal((await call(owner, R, 'DELETE', `/api/creator/people/${pid}`)).statusCode, 200);
  assert.equal((db.prepare("SELECT person_id FROM course_lessons WHERE id = 'l4_8'").get() as { person_id: string | null }).person_id, null);
  await call(owner, R, 'DELETE', `/api/creator/people/${linked.json().id}`);
  await call(owner, R, 'PUT', '/api/creator/lessons/l4_8/person', { personId: 'p4_n' });
});

test('wideo lekcji: podpisany link działa bez sesji (AirPlay/Chromecast), podróbka i przeterminowany – 404', async () => {
  const owner = await login(DEMO.owner);
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 7)]);
  const up = await call(owner, R, 'POST', '/api/creator/courses/co1/lessons', { module: 'TV', title: 'Na telewizorze', kind: 'video', freePreview: true, video: { dataUrl: 'data:video/mp4;base64,' + mp4.toString('base64'), durationSec: 60 } });
  assert.equal(up.statusCode, 200, up.body);
  const magda = await login(DEMO.magda);
  const lesson = (await call(magda, R, 'GET', '/api/courses/co1')).json().lessonsList.find((l: { id: string }) => l.id === up.json().id);
  assert.match(lesson.videoUrl, /^\/api\/stream\/[\w-]+\?e=\d+&sig=[\w-]+$/);
  const bare = await app.inject({ method: 'GET', url: lesson.videoUrl, headers: { range: 'bytes=0-9' } });
  assert.equal(bare.statusCode, 206, bare.body);
  assert.equal(bare.headers['content-range'], `bytes 0-9/${mp4.length}`);
  assert.equal((await app.inject({ method: 'GET', url: lesson.videoUrl.replace(/sig=./, 'sig=x') })).statusCode, 404);
  const { signStreamUrl } = await import('../src/crypto.ts');
  const mediaId = lesson.videoUrl.split('/')[3].split('?')[0];
  assert.equal((await app.inject({ method: 'GET', url: signStreamUrl(mediaId, Math.floor(Date.now() / 1000) - 30 * 86400) })).statusCode, 404, 'link sprzed miesiąca wygasł');
});

test('wideo lekcji: wgrywanie kawałkami z wznawianiem, plik na dysku, Range strumieniem', async () => {
  const owner = await login(DEMO.owner);
  const put = (uploadId: string, offset: number, chunk: Buffer) =>
    app.inject({ method: 'PUT', url: `/api/creator/uploads/${uploadId}`, payload: chunk, headers: { authorization: `Bearer ${owner}`, origin: 'http://localhost', host: 'localhost', 'x-studio-id': R, 'content-type': 'application/octet-stream', 'upload-offset': String(offset) } });
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), randomBytes(300_000)]);
  const start = await call(owner, R, 'POST', '/api/creator/uploads', { mime: 'video/mp4', size: mp4.length, durationSec: 2400 });
  assert.equal(start.statusCode, 200, start.body);
  const up = start.json().id;
  assert.equal((await put(up, 0, mp4.subarray(0, 100_000))).json().offset, 100_000);
  // Zerwane połączenie / zły offset: serwer mówi, skąd wznowić.
  const stale = await put(up, 0, mp4.subarray(0, 100_000));
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().details.offset, 100_000);
  assert.equal((await call(owner, R, 'GET', `/api/creator/uploads/${up}`)).json().offset, 100_000);
  const done = await put(up, 100_000, mp4.subarray(100_000));
  assert.equal(done.statusCode, 200, done.body);
  assert.equal(done.json().done, true);
  const row = db.prepare('SELECT path, data, size FROM media WHERE id = ?').get(up) as { path: string; data: Uint8Array | null; size: number };
  assert.ok(row.path && row.data === null, 'film na dysku, nie w bazie');
  assert.equal(row.size, mp4.length);

  const lesson = await call(owner, R, 'POST', '/api/creator/courses/co1/lessons', { module: 'Pełne treningi', title: 'Trening 40 min', kind: 'video', freePreview: true, videoId: up });
  assert.equal(lesson.statusCode, 200, lesson.body);
  assert.equal((await call(owner, R, 'POST', '/api/creator/courses/co1/lessons', { module: 'X', title: 'Drugi raz', kind: 'video', videoId: up })).statusCode, 400, 'film należy do jednej lekcji');
  const magda = await login(DEMO.magda);
  const l = (await call(magda, R, 'GET', '/api/courses/co1')).json().lessonsList.find((x: { id: string }) => x.id === lesson.json().id);
  assert.equal(l.durationSec ?? l.duration_sec ?? 2400, 2400);
  const part = await app.inject({ method: 'GET', url: l.videoUrl, headers: { range: 'bytes=200000-200099' } });
  assert.equal(part.statusCode, 206);
  assert.equal(part.headers['content-range'], `bytes 200000-200099/${mp4.length}`);
  assert.ok(part.rawPayload.equals(mp4.subarray(200_000, 200_100)));
  const whole = await app.inject({ method: 'GET', url: l.videoUrl });
  assert.ok(whole.rawPayload.equals(mp4));

  // Usunięcie lekcji kasuje plik z dysku.
  const { mediaFile } = await import('../src/services/media-files.ts');
  const { existsSync } = await import('node:fs');
  const file = mediaFile(db, row.path);
  assert.ok(existsSync(file));
  assert.equal((await call(owner, R, 'DELETE', `/api/creator/lessons/${lesson.json().id}`)).statusCode, 200);
  assert.ok(!existsSync(file));
});

test('wgrywanie wideo: zła sygnatura po pierwszych bajtach i limit miejsca z planu', async () => {
  const owner = await login(DEMO.owner);
  const s = await call(owner, R, 'POST', '/api/creator/uploads', { mime: 'video/mp4', size: 1000 });
  const fake = await app.inject({ method: 'PUT', url: `/api/creator/uploads/${s.json().id}`, payload: Buffer.alloc(1000, 0x41), headers: { authorization: `Bearer ${owner}`, origin: 'http://localhost', host: 'localhost', 'x-studio-id': R, 'content-type': 'application/octet-stream', 'upload-offset': '0' } });
  assert.equal(fake.statusCode, 415);
  assert.equal((await call(owner, R, 'GET', `/api/creator/uploads/${s.json().id}`)).statusCode, 404, 'nieudane wgrywanie usunięte');
  assert.equal((await call(owner, R, 'POST', '/api/creator/uploads', { mime: 'application/pdf', size: 1000 })).statusCode, 400);

  const { planById } = await import('@glam/core');
  const plan = (db.prepare('SELECT plan_id FROM studios WHERE id = ?').get(R) as { plan_id: string }).plan_id;
  // Trwające wgrywanie rezerwuje miejsce: zapełniamy plan i kolejny film już się nie mieści.
  db.prepare("INSERT INTO media_uploads (id, studio_id, owner_id, kind, mime, size, created_at) VALUES ('up_full', ?, 'x', 'course', 'video/mp4', ?, ?)").run(R, planById(plan).limits.videoMb * 1_000_000, new Date().toISOString());
  try {
    assert.equal((await call(owner, R, 'POST', '/api/creator/uploads', { mime: 'video/mp4', size: 1000 })).statusCode, 413);
  } finally {
    db.prepare("DELETE FROM media_uploads WHERE id = 'up_full'").run();
  }
});

test('migracja: filmy z BLOB-ów trafiają na dysk przy starcie, obrazy zostają w bazie', async () => {
  const { moveVideoBlobsToDisk, mediaFile } = await import('../src/services/media-files.ts');
  const { readFileSync } = await import('node:fs');
  const video = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), randomBytes(5000)]);
  const ins = db.prepare("INSERT INTO media (id, studio_id, owner_id, kind, mime, data, size, private, created_at) VALUES (?, ?, 'x', ?, ?, ?, ?, 0, ?)");
  ins.run('m_old_video', R, 'course', 'video/webm', video, video.length, new Date().toISOString());
  ins.run('m_old_photo', R, 'post', 'image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47]), 4, new Date().toISOString());
  assert.ok(moveVideoBlobsToDisk(db) >= 1);
  const v = db.prepare("SELECT path, data FROM media WHERE id = 'm_old_video'").get() as { path: string; data: Uint8Array | null };
  assert.equal(v.data, null);
  assert.ok(readFileSync(mediaFile(db, v.path)).equals(video));
  assert.equal((db.prepare("SELECT path FROM media WHERE id = 'm_old_photo'").get() as { path: string | null }).path, null);
  assert.equal(moveVideoBlobsToDisk(db), 0, 'drugi start niczego nie przenosi');
  db.prepare("DELETE FROM media WHERE id IN ('m_old_video', 'm_old_photo')").run();
});

test('sklep: rezerwacja do odbioru blokuje sztukę, anulowanie ją zwraca, odbiór w recepcji', async () => {
  const magda = await login(DEMO.magda);
  const stock = () => (JSON.parse((db.prepare("SELECT variants_json FROM shop_products WHERE id = 'sp1'").get() as { variants_json: string }).variants_json) as { id: string; stock: number }[]).find((v) => v.id === 'l')!.stock;
  const s0 = stock();
  const o = await call(magda, R, 'POST', '/api/shop/orders', { kind: 'pickup', items: [{ productId: 'sp1', variantId: 'l', qty: 2 }] });
  assert.equal(o.statusCode, 200, o.body);
  assert.equal(stock(), s0 - 2);
  assert.equal((await call(magda, R, 'POST', '/api/shop/orders', { kind: 'pickup', items: [{ productId: 'sp1', variantId: 'l', qty: 5 }] })).statusCode, 409);
  await call(magda, R, 'POST', `/api/my/orders/${o.json().id}/cancel`);
  assert.equal(stock(), s0);
  const o2 = await call(magda, R, 'POST', '/api/shop/orders', { kind: 'pickup', items: [{ productId: 'sp2', variantId: 'b', qty: 1 }] });
  const kasia = await login(DEMO.reception);
  assert.equal((await call(kasia, R, 'POST', `/api/staff/shop/orders/${o2.json().id}`, { status: 'ready' })).statusCode, 200);
  assert.equal((await call(kasia, R, 'POST', `/api/staff/shop/orders/${o2.json().id}`, { status: 'collected' })).statusCode, 400, 'trzeba podać formę płatności na miejscu');
  assert.equal((await call(kasia, R, 'POST', `/api/staff/shop/orders/${o2.json().id}`, { status: 'collected', method: 'terminal' })).statusCode, 200);
});

test('sklep: menu baru bez limitu sztuk, cena wariantu, makro tylko uzupełnione, miara skarpetek', async () => {
  const magda = await login(DEMO.magda);
  const shop = (await call(magda, R, 'GET', '/api/shop')).json();
  const byId = (pid: string) => shop.products.find((p: { id: string }) => p.id === pid);
  assert.equal(byId('sp1').sizeName, 'Rozmiar skarpetek');
  assert.deepEqual(byId('sp1').variants.map((v: { size: string }) => v.size), ['35–38', '39–42', '43–46']);
  assert.equal(byId('sp8').nutrition, null, 'napój bez makro – nic do pokazania');
  assert.equal(byId('sp7').nutrition.fat, undefined, 'brak tłuszczu w makro – pole pominięte');
  assert.equal(byId('sp7').nutrition.protein, 5);
  assert.equal(byId('sp9').status, 'available');
  assert.match(byId('sp9').price, /^od /, 'hantelki mają różne ceny wag');

  const o = await call(magda, R, 'POST', '/api/shop/orders', { kind: 'pickup', items: [{ productId: 'sp6', variantId: 'xl', qty: 2 }] });
  assert.equal(o.statusCode, 200, o.body);
  const row = db.prepare('SELECT total_grosze, expires_at FROM shop_orders WHERE id = ?').get(o.json().id) as { total_grosze: number; expires_at: string };
  assert.equal(row.total_grosze, 3800, 'cena wariantu 450 ml');
  assert.equal(row.expires_at, new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }), 'napój czeka do końca dnia');
  const matcha = JSON.parse((db.prepare("SELECT variants_json FROM shop_products WHERE id = 'sp6'").get() as { variants_json: string }).variants_json);
  assert.equal(matcha.find((v: { id: string }) => v.id === 'xl').stock, null, 'napój bez limitu – stan się nie zmienia');
  assert.equal((await call(magda, R, 'POST', '/api/shop/orders', { kind: 'pickup', items: [{ productId: 'sp9', variantId: 'h15', qty: 1 }] })).statusCode, 409, '1,5 kg wyprzedane');
  assert.equal((await call(magda, R, 'POST', '/api/shop/orders', { kind: 'online', method: 'blik', items: [{ productId: 'sp5', variantId: 'one', qty: 1 }] })).statusCode, 409, 'napojów się nie wysyła');
});

test('sklep: galeria produktu z biblioteki studia, usunięte zdjęcie zwalnia miejsce; katalog na stronie WWW', async () => {
  const owner = await login(DEMO.owner);
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const a = (await call(owner, R, 'POST', '/api/staff/shop/media', { dataUrl: PNG })).json();
  const b = (await call(owner, R, 'POST', '/api/staff/shop/media', { dataUrl: PNG })).json();
  assert.ok(a.id && b.id);
  const created = await call(owner, R, 'POST', '/api/staff/shop/products', {
    category: 'drink',
    name: 'Kakao proteinowe',
    priceGrosze: 1700,
    photos: [a.id, b.id],
    nutrition: { serving: '300 ml', protein: '22,5', kcal: '', fat: null },
  });
  assert.equal(created.statusCode, 200, created.body);
  const pid = created.json().id;
  const find = async () => ((await call(owner, R, 'GET', '/api/staff/shop')).json().products as { id: string; photos: { id: string }[]; nutrition: object; variants: { stock: number | null }[] }[]).find((p) => p.id === pid)!;
  let p = await find();
  assert.deepEqual(p.photos.map((x) => x.id), [a.id, b.id]);
  assert.deepEqual(p.nutrition, { serving: '300 ml', protein: 22.5 });
  assert.equal(p.variants[0].stock, null, 'nowy napój domyślnie bez limitu');

  assert.equal((await call(owner, R, 'PUT', `/api/staff/shop/products/${pid}`, { photos: ['obce-zdjecie'] })).statusCode, 400);
  assert.equal((await call(owner, R, 'PUT', `/api/staff/shop/products/${pid}`, { photos: [b.id] })).statusCode, 200);
  p = await find();
  assert.deepEqual(p.photos.map((x) => x.id), [b.id]);
  assert.equal(db.prepare('SELECT id FROM media WHERE id = ?').get(a.id), undefined, 'zdjęcie usunięte z galerii znika z biblioteki');

  const pub = await app.inject({ method: 'GET', url: '/api/public/studios/centrum-ruchu/shop' });
  assert.equal(pub.statusCode, 200, pub.body);
  const item = pub.json().products.find((x: { id: string }) => x.id === pid);
  assert.equal(item.photoUrl, `/api/public-media/${b.id}`);
  assert.equal('rewardEligible' in item, false);
  assert.equal((await app.inject({ method: 'GET', url: item.photoUrl })).statusCode, 200);
  const page = await app.inject({ method: 'GET', url: `/api/public/studios/centrum-ruchu/shop/${pid}` });
  assert.equal(page.statusCode, 200, page.body);
  assert.equal(page.json().product.id, pid);
  assert.deepEqual(page.json().product.photos.map((x: { id: string }) => x.id), [b.id]);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/studios/centrum-ruchu/shop/nie-ma' })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/studios/nie-ma/shop' })).statusCode, 404);
});

test('wydarzenie prywatne: zapytanie → oferta → akceptacja blokuje salę w grafiku; RSVP gości', async () => {
  const magda = await login(DEMO.magda);
  const opts = (await call(magda, R, 'GET', '/api/events/options')).json();
  const day = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  const slots = (await call(magda, R, 'GET', `/api/events/slots?date=${day}&zoneId=z_stretch&trainerId=u_003&durationMin=90`)).json();
  assert.ok(slots.length > 0);
  const ev = await call(magda, R, 'POST', '/api/events', { kind: 'birthday', trainerId: 'u_003', zoneId: 'z_stretch', activity: 'Stretch', startsAt: slots[0].startsAt, guests: 6, termsAccepted: true });
  assert.equal(ev.statusCode, 200, ev.body);
  assert.equal(ev.json().status, 'inquiry');
  assert.ok(opts.packages.length >= 1);
  const kasia = await login(DEMO.reception);
  assert.equal((await call(kasia, R, 'POST', `/api/staff/events/${ev.json().id}`, { offer: 'Stretch + herbata, 90 min', price: 70000 })).statusCode, 200);
  assert.equal((await call(magda, R, 'POST', `/api/events/${ev.json().id}/client`, { action: 'accept' })).statusCode, 200);
  const blocked = db.prepare("SELECT public FROM class_sessions WHERE kind = 'event' AND starts_at = ?").get(slots[0].startsAt) as { public: number } | undefined;
  assert.equal(blocked?.public, 0);
  const code = (db.prepare('SELECT invite_code FROM private_events WHERE id = ?').get(ev.json().id) as { invite_code: string }).invite_code;
  assert.equal((await app.inject({ method: 'POST', url: `/api/invite/${code}`, payload: { name: 'Ola K.', rsvp: 'yes' } })).statusCode, 200);
});

test('zadania cykliczne: życzenia urodzinowe o 9:00 z prezentem, ankieta uśpionych, przypomnienia', async () => {
  // Magda ma urodziny 14.03 – uruchamiamy zadania tego dnia o 9:30 czasu studia.
  await runJobs(deps, new Date('2027-03-14T08:30:00Z'));
  const wish = db.prepare("SELECT body FROM notifications WHERE user_id = 'u_005' AND studio_id = ? AND dedupe_key = 'birthday:2027-03-14'").get(R) as { body: string } | undefined;
  assert.match(wish?.body ?? '', /Magda/);
  assert.ok(db.prepare("SELECT 1 FROM coupons WHERE only_user_id = 'u_005' AND label = 'Prezent urodzinowy'").get());
  // Drugie uruchomienie nie dubluje życzeń, a drugie studio Magdy nie przekracza limitu 1 okolicznościowej dziennie.
  await runJobs(deps, new Date('2027-03-14T08:40:00Z'));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_005' AND dedupe_key = 'birthday:2027-03-14' AND status = 'sent'").get() as { n: number }).n, 1);
  await runJobs(deps);
  assert.ok((db.prepare("SELECT COUNT(*) AS n FROM dormant_surveys WHERE studio_id = ?").get(R) as { n: number }).n >= 1);
});

test('RODO: eksport danych zawiera dziennik (odszyfrowany), usunięcie konta anonimizuje', async () => {
  const magda = await login(DEMO.magda);
  const exp = await call(magda, null, 'GET', '/api/me/export');
  assert.equal(exp.statusCode, 200);
  const data = exp.json();
  assert.ok(data.journal.length >= 3 && typeof data.journal[0].mood === 'number');
  const raw = db.prepare('SELECT data_enc FROM journal_entries LIMIT 1').get() as { data_enc: string };
  assert.ok(raw.data_enc.startsWith('v1.') && !raw.data_enc.includes('mood'), 'w bazie tylko szyfrogram');
  const friend = await login('+48600444555');
  assert.equal((await call(friend, null, 'DELETE', '/api/me', { confirm: 'nie' })).statusCode, 400);
  assert.equal((await call(friend, null, 'DELETE', '/api/me', { confirm: 'USUŃ' })).statusCode, 200);
  const u = db.prepare("SELECT phone, name FROM users WHERE phone LIKE 'usunieta:%'").get() as { phone: string; name: string | null };
  assert.equal(u.name, null);
});

test('kalendarz telefonu: prywatny adres .ics z zajęciami', async () => {
  const magda = await login(DEMO.magda);
  const { url } = (await call(magda, null, 'POST', '/api/me/calendar')).json();
  const ics = await app.inject({ method: 'GET', url });
  assert.equal(ics.statusCode, 200);
  assert.match(ics.body, /BEGIN:VCALENDAR[\s\S]*BEGIN:VEVENT/);
});

// ——— Biometria: programowy authenticator (P-256) ———

function cbor(v: unknown): Buffer {
  const head = (major: number, n: number) => (n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.from([(major << 5) | 25, n >> 8, n & 0xff]));
  if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  throw new Error('cbor');
}

test('biometria (WebAuthn): rejestracja klucza na urządzeniu i logowanie bez SMS', async () => {
  const ania = await login(DEMO.ania);
  const opts = (await call(ania, null, 'POST', '/api/me/passkeys/options')).json();
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const credId = randomBytes(16);
  const rpHash = createHash('sha256').update('localhost').digest();
  const cose = new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x!, 'base64url')], [-3, Buffer.from(jwk.y!, 'base64url')]]);
  const authData = Buffer.concat([rpHash, Buffer.from([0x45]), Buffer.from([0, 0, 0, 1]), Buffer.alloc(16), Buffer.from([0, 16]), credId, cbor(cose)]);
  const clientData = (type: string, challenge: string) => Buffer.from(JSON.stringify({ type, challenge, origin: 'http://localhost' })).toString('base64url');
  const att = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  const reg = await call(ania, null, 'POST', '/api/me/passkeys', { id: credId.toString('base64url'), response: { clientDataJSON: clientData('webauthn.create', opts.challenge), attestationObject: att.toString('base64url') } });
  assert.equal(reg.statusCode, 200, reg.body);

  const lo = (await app.inject({ method: 'POST', url: '/api/auth/passkey/options', headers: { host: 'localhost' } })).json();
  const ad = Buffer.concat([rpHash, Buffer.from([0x05]), Buffer.from([0, 0, 0, 2])]);
  const cd = clientData('webauthn.get', lo.challenge);
  const sig = sign('sha256', Buffer.concat([ad, createHash('sha256').update(Buffer.from(cd, 'base64url')).digest()]), privateKey);
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/passkey/verify',
    headers: { host: 'localhost', origin: 'http://localhost' },
    payload: { id: credId.toString('base64url'), response: { clientDataJSON: cd, authenticatorData: ad.toString('base64url'), signature: sig.toString('base64url') } },
  });
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(res.json().user.name, 'Ania');
  // Ten sam podpis drugi raz: wyzwanie już zużyte.
  const replay = await app.inject({ method: 'POST', url: '/api/auth/passkey/verify', headers: { host: 'localhost', origin: 'http://localhost' }, payload: { id: credId.toString('base64url'), response: { clientDataJSON: cd, authenticatorData: ad.toString('base64url'), signature: sig.toString('base64url') } } });
  assert.equal(replay.statusCode, 400);
});

test('Web Push: treść zaszyfrowana aes128gcm daje się odszyfrować kluczem przeglądarki', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const body = encryptPayload('{"title":"GLAM","body":"Jutro o 18:00 Reformer"}', ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
  const salt = body.subarray(0, 16);
  const keyLen = body[20];
  const asPublic = body.subarray(21, 21 + keyLen);
  const cipher = body.subarray(21 + keyLen);
  const hmac = (k: Buffer, d: Buffer) => createHmac('sha256', k).update(d).digest();
  const secret = ua.computeSecret(asPublic);
  const ikm = hmac(hmac(auth, secret), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain.subarray(0, -1).toString(), '{"title":"GLAM","body":"Jutro o 18:00 Reformer"}');
  assert.equal(plain.at(-1), 2);
});

test('CAPTCHA przy podejrzanej aktywności: proof-of-work wymagany po kilku wysyłkach', async () => {
  const phone = '+48600777001';
  let needed = false;
  for (let i = 0; i < 6 && !needed; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone: `+4860077700${i}` }, remoteAddress: '10.9.9.9' });
    needed = r.statusCode === 428;
  }
  for (let i = 0; i < 6 && !needed; i++) {
    const r = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone: `+4860077710${i}` }, remoteAddress: '10.9.9.9' });
    if (r.statusCode === 428) {
      needed = true;
      const { challenge, difficulty } = r.json().details;
      let nonce = 0;
      const zeros = (h: Buffer) => { let n = 0; for (const b of h) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
      while (zeros(createHash('sha256').update(`${challenge}${nonce}`).digest()) < difficulty) nonce++;
      const ok = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone: `+4860077710${i}`, captcha: { challenge, nonce: String(nonce) } }, remoteAddress: '10.9.9.9' });
      assert.equal(ok.statusCode, 200, ok.body);
    }
  }
  assert.ok(needed, phone);
});

test('wydarzenie studia: recepcja dodaje z panelu, termin blokuje salę i trenerkę, trenerka ani klientka nie dodadzą', async () => {
  const [owner, reception, marzena, magda] = await Promise.all([login(DEMO.owner), login(DEMO.reception), login(DEMO.marzena), login(DEMO.magda)]);
  const opts = (await call(owner, R, 'GET', '/api/events/options')).json();
  const zoneId = opts.zones[0].id;
  const trainerId = opts.trainers[0].id;
  const date = new Date(Date.now() + 12 * 86_400_000).toISOString().slice(0, 10);
  const free = (await call(magda, R, 'GET', `/api/events/slots?date=${date}&zoneId=${zoneId}&trainerId=${trainerId}&durationMin=90`)).json();
  const body = { title: 'Halloween Flow', trainerId, zoneId, activity: 'Mat', startsAt: free[0].startsAt, durationMin: 75, capacity: 12, priceGrosze: 8000 };
  assert.equal((await call(marzena, R, 'POST', '/api/staff/events', body)).statusCode, 403);
  assert.equal((await call(magda, R, 'POST', '/api/staff/events', body)).statusCode, 403);
  const r = await call(reception, R, 'POST', '/api/staff/events', body);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await call(owner, R, 'POST', '/api/staff/events', body)).statusCode, 409);
  const ev = (await call(owner, R, 'GET', '/api/staff/events')).json().find((e: { id: string }) => e.id === r.json().id);
  assert.equal(ev.status, 'confirmed');
  assert.equal(ev.title, 'Halloween Flow');
  const after = (await call(magda, R, 'GET', `/api/events/slots?date=${date}&zoneId=${zoneId}&trainerId=${trainerId}&durationMin=90`)).json();
  assert.ok(!after.some((s: { startsAt: string }) => s.startsAt === free[0].startsAt));
});

test('właścicielka prowadzi zajęcia: zajęcia specjalne i zastępstwo z nią przechodzą', async () => {
  const owner = await login(DEMO.owner);
  const cfg = (await call(owner, R, 'GET', '/api/owner/config')).json();
  const ownerId = cfg.trainers.find((t: { id: string; name: string }) => !['Marzena', 'Ola'].some((n) => t.name.startsWith(n)))?.id;
  assert.ok(ownerId, 'właścicielka na liście prowadzących');
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const r = await call(owner, R, 'POST', '/api/staff/sessions', { classTypeId: cfg.classTypes[0].id, trainerId: ownerId, date, time: '21:00', durationMin: 45, capacity: 6, kind: 'special', public: true });
  assert.equal(r.statusCode, 200, r.body);
  const s = futureSession(cfg.classTypes[0].id, 30)[0];
  const swap = await call(owner, R, 'POST', `/api/staff/sessions/${s.id}/trainer`, { trainerId: ownerId });
  assert.equal(swap.statusCode, 200, swap.body);
});

test('wydarzenie: zmiana godziny nie omija innych zajęć, a stare zapytanie wygasa po terminie', async () => {
  const [owner, magda] = await Promise.all([login(DEMO.owner), login(DEMO.magda)]);
  const opts = (await call(magda, R, 'GET', '/api/events/options')).json();
  const zoneId = opts.zones[0].id;
  const trainerId = opts.trainers[0].id;
  const date = new Date(Date.now() + 15 * 86_400_000).toISOString().slice(0, 10);
  const otherTrainerId = opts.trainers[1]?.id ?? trainerId;
  const slots = async (t: string) => (await call(magda, R, 'GET', `/api/events/slots?date=${date}&zoneId=${zoneId}&trainerId=${t}&durationMin=60`)).json() as { startsAt: string }[];
  const free = await slots(trainerId);
  const freeOther = new Set((await slots(otherTrainerId)).map((s) => s.startsAt));
  const at = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();
  // Grafik zależy od dnia tygodnia – szukamy godziny A, przy której A+30 min i A+2 h też są wolne.
  const a = free.find((s) => free.some((x) => x.startsAt === at(s.startsAt, 30)) && free.some((x) => x.startsAt === at(s.startsAt, 120)) && freeOther.has(at(s.startsAt, 120)))?.startsAt;
  assert.ok(a, 'wolne A, A+30 min i A+2 h');
  const b = at(a, 120);
  // Wydarzenie A potwierdzone, a o godzinie B – inne wydarzenie studia w tej samej sali.
  const ev = await call(magda, R, 'POST', '/api/events', { kind: 'birthday', trainerId, zoneId, activity: 'Mat', startsAt: a, durationMin: 60, guests: 6, termsAccepted: true });
  assert.equal(ev.statusCode, 200, ev.body);
  await call(owner, R, 'POST', `/api/staff/events/${ev.json().id}`, { status: 'confirmed' });
  const other = await call(owner, R, 'POST', '/api/staff/events', { title: 'Warsztat oddechu', trainerId: otherTrainerId, zoneId, activity: 'Stretch', startsAt: b, durationMin: 60, capacity: 8 });
  assert.equal(other.statusCode, 200, other.body);
  // Przeniesienie A na godzinę B koliduje z warsztatem – musi być odrzucone.
  assert.equal((await call(magda, R, 'POST', `/api/events/${ev.json().id}/client`, { action: 'reschedule', startsAt: b })).statusCode, 409);
  // Przeniesienie o 30 min nachodzi tylko na samo siebie – przechodzi.
  const half = at(a, 30);
  assert.equal((await call(magda, R, 'POST', `/api/events/${ev.json().id}/client`, { action: 'reschedule', startsAt: half })).statusCode, 200);

  // Zapytanie bez odpowiedzi wygasa po terminie.
  const last = free.at(-1);
  assert.ok(last);
  const inq = await call(magda, R, 'POST', '/api/events', { kind: 'gift', trainerId, zoneId, activity: 'Mat', startsAt: last.startsAt, guests: 4, termsAccepted: true });
  assert.equal(inq.statusCode, 200, inq.body);
  await runJobs(deps, new Date(Date.parse(last.startsAt) + 86_400_000));
  const after = (await call(magda, R, 'GET', `/api/events/${inq.json().id}`)).json();
  assert.equal(after.status, 'cancelled');
  assert.match(after.history.at(-1).text, /Wygasło/);
});

test('wiadomości do znajomych: dzienny limit na klientkę i na numer, odpowiedź nie zdradza członkostwa', async () => {
  const ania = await login(DEMO.ania);
  const zuza = await login(DEMO.zuza);
  const s = db.prepare("SELECT id FROM class_sessions WHERE studio_id = ? AND status = 'scheduled' AND public = 1 AND starts_at > ? ORDER BY starts_at LIMIT 1").get(R, new Date().toISOString()) as { id: string };
  const invite = (token: string, phone: string) => call(token, R, 'POST', `/api/sessions/${s.id}/invite`, { phone });
  // Ta sama odpowiedź dla klientki studia (Magda) i dla obcego numeru.
  const member = await invite(ania, DEMO.magda);
  const stranger = await invite(ania, '600 700 801');
  assert.equal(member.statusCode, 200, member.body);
  assert.deepEqual(member.json(), stranger.json());
  for (const n of [2, 3, 4]) assert.equal((await invite(ania, `600 700 80${n}`)).statusCode, 200);
  const sixth = await invite(ania, '600 700 809');
  assert.equal(sixth.statusCode, 429);
  assert.equal(sixth.json().error, 'sms_limit');
  // Limit na numer liczy się od wszystkich klientek razem: 600 700 801 dostał już jedno zaproszenie.
  assert.equal((await invite(zuza, '600 700 801')).statusCode, 200);
  assert.equal((await invite(zuza, '600 700 801')).statusCode, 429);
  // Polecenie z numerem korzysta z tego samego dziennego limitu klientki.
  const ref = await call(ania, R, 'POST', '/api/referrals', { phone: '600 700 900', channel: 'sms' });
  assert.equal(ref.statusCode, 429);
});

test('autoodnawianie: tylko w karnecie, którego produkt je przewiduje; studio podaje strefę czasową', async () => {
  const magda = await login(DEMO.magda);
  const pass = db.prepare("SELECT p.id FROM passes p JOIN users u ON u.id = p.user_id WHERE p.studio_id = ? AND u.phone = ? AND p.rules_json NOT LIKE '%\"autoRenew\":true%' LIMIT 1").get(R, DEMO.magda) as { id: string } | undefined;
  assert.ok(pass, 'Magda ma karnet bez odnawiania');
  const on = await call(magda, R, 'PATCH', `/api/passes/${pass.id}`, { autoRenew: true });
  assert.equal(on.statusCode, 409, on.body);
  assert.equal(on.json().error, 'no_renewal');
  assert.equal((await call(magda, R, 'PATCH', `/api/passes/${pass.id}`)).statusCode, 400);
  assert.equal((await call(magda, R, 'PATCH', `/api/passes/${pass.id}`, { autoRenew: false })).statusCode, 200);
  assert.match((await call(magda, R, 'GET', '/api/studio')).json().timezone, /^[A-Za-z]+\/[A-Za-z_]+/);
});

test('kody rabatowe: po serii nietrafionych sprawdzanie się zatrzymuje', async () => {
  const zuza = await login(DEMO.zuza);
  const check = (code: string) => call(zuza, R, 'POST', '/api/coupons/check', { code, kind: 'pass', amountGrosze: 26000 });
  assert.equal((await check('jesien15')).statusCode, 200);
  for (let i = 0; i < COUPON_MISSES; i++) assert.equal((await check(`ZGADUJE${i}`)).statusCode, 400);
  const blocked = await check('jesien15');
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error, 'too_many_attempts');
});
