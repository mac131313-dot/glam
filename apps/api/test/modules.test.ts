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
  const today = new Date().toISOString().slice(0, 10);
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
