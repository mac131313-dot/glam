import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { DEMO, seed } from '../src/seed.ts';
import { normalizeDomain, type DnsResolver } from '../src/services/domain.ts';
import { ConsoleSmsGateway, MockPaymentProvider } from '../src/sms.ts';

// Podstawiony DNS: www.rzeszow-studio.test ma CNAME na nasz host, domena główna wskazuje na cudzy serwer.
const zone: Record<string, { a?: string[]; cname?: string[] }> = {
  localhost: { a: ['127.0.0.1'] },
  'rzeszow-studio.test': { a: ['203.0.113.9'] },
  'www.rzeszow-studio.test': { cname: ['localhost.'] },
};
const nx = () => Promise.reject(Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' }));
const dns: DnsResolver = {
  resolve4: (h) => (zone[h]?.a ? Promise.resolve(zone[h].a) : nx()),
  resolveCname: (h) => (zone[h]?.cname ? Promise.resolve(zone[h].cname) : nx()),
};

const db = openDb(':memory:');
const app = buildApp({ db, sms: new ConsoleSmsGateway(true), payments: new MockPaymentProvider(), exposeDevCodes: true, dns });
const R = 'st_rzeszow';
const K = 'st_krakow';
let ip = 0;

before(() => {
  const warn = console.warn;
  console.warn = () => {};
  seed(db);
  console.warn = warn;
});

async function login(phone: string): Promise<string> {
  const remoteAddress = `10.1.0.${++ip}`;
  const r1 = await app.inject({ method: 'POST', url: '/api/auth/request-code', payload: { phone }, remoteAddress });
  const r2 = await app.inject({ method: 'POST', url: '/api/auth/verify', payload: { phone, code: r1.json().devCode }, remoteAddress });
  return r2.json().token;
}

const putDomain = (token: string, studio: string, domain: string) =>
  app.inject({ method: 'PUT', url: '/api/site/domain', payload: { domain }, headers: { authorization: `Bearer ${token}`, 'x-studio-id': studio } });

const slugOf = (id: string) => (db.prepare('SELECT slug FROM studios WHERE id = ?').get(id) as { slug: string }).slug;

test('domena: porządkowanie wpisu i odrzucanie złych adresów', () => {
  assert.equal(normalizeDomain('  https://www.Studio-Rzeszow.PL/kontakt?x=1 '), 'studio-rzeszow.pl');
  assert.equal(normalizeDomain('studio.pl.'), 'studio.pl');
  assert.equal(normalizeDomain(''), null);
  for (const bad of ['studio', 'studio..pl', '-studio.pl', '1.2.3.4', 'stu dio.pl']) assert.throws(() => normalizeDomain(bad), bad);
});

test('domena: zapis, unikalność i strona studia po nagłówku Host', async () => {
  const owner = await login(DEMO.owner);
  const krakow = await login(DEMO.krakowOwner);

  const saved = await putDomain(owner, R, 'https://www.Rzeszow-Studio.test/');
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().domain, 'rzeszow-studio.test');
  // sprawdzenie DNS po stronie serwera: www wskazuje na nas, domena główna gdzie indziej
  assert.deepEqual(saved.json().check, { domain: 'rzeszow-studio.test', apex: 'other', www: 'ok', ok: true });

  // edytor dostaje zapisaną domenę razem z rekordami DNS
  const editor = await app.inject({ method: 'GET', url: '/api/site/editor', headers: { authorization: `Bearer ${owner}`, 'x-studio-id': R } });
  assert.equal(editor.json().dns.domain, 'rzeszow-studio.test');

  // ta sama domena (także z www) nie może trafić do drugiego studia; adres GLAM też nie
  const taken = await putDomain(krakow, K, 'www.rzeszow-studio.test');
  assert.equal(taken.statusCode, 409);
  assert.equal(taken.json().error, 'domain_taken');
  assert.equal((await putDomain(krakow, K, 'localhost.pl')).json().check.www, 'none');
  assert.equal((await putDomain(krakow, K, 'nie domena')).statusCode, 400);

  // Host z domeną (z www i bez, z portem) → studio, jak /s/:slug
  for (const host of ['rzeszow-studio.test', 'www.rzeszow-studio.test', 'WWW.Rzeszow-Studio.test:8080']) {
    const r = await app.inject({ method: 'GET', url: '/api/public/domain', headers: { host } });
    assert.equal(r.statusCode, 200, `${host}: ${r.body}`);
    assert.equal(r.json().slug, slugOf(R));
    const site = await app.inject({ method: 'GET', url: `/api/public/studios/${r.json().slug}`, headers: { host } });
    assert.equal(site.json().id, R);
  }
  // nginx przekazuje Host dalej, a za drugim proxy liczy się X-Forwarded-Host
  const proxied = await app.inject({ method: 'GET', url: '/api/public/domain', headers: { host: 'api:3001', 'x-forwarded-host': 'www.rzeszow-studio.test' } });
  assert.equal(proxied.json().slug, slugOf(R));
  // pytanie serwera TLS o konkretną domenę
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/domain?domain=www.localhost.pl' })).json().slug, slugOf(K));

  // adres GLAM i obca domena → 404 (front pokazuje zwykłą stronę startową)
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/domain', headers: { host: 'localhost:5173' } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/domain', headers: { host: 'inne-studio.test' } })).statusCode, 404);

  // studio niepublikowane nie odpowiada na swojej domenie
  db.prepare('UPDATE studios SET published = 0 WHERE id = ?').run(R);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/domain', headers: { host: 'rzeszow-studio.test' } })).statusCode, 404);
  db.prepare('UPDATE studios SET published = 1 WHERE id = ?').run(R);

  // pusty wpis odłącza domenę i zwalnia ją dla innych
  const cleared = await putDomain(owner, R, '');
  assert.equal(cleared.json().domain, null);
  assert.equal((await app.inject({ method: 'GET', url: '/api/public/domain', headers: { host: 'rzeszow-studio.test' } })).statusCode, 404);
  assert.equal((await putDomain(krakow, K, 'rzeszow-studio.test')).statusCode, 200);
});

test('domena: tylko osoba z prawem edycji strony', async () => {
  const magda = await login(DEMO.magda);
  assert.equal((await putDomain(magda, R, 'magda.test')).statusCode, 403);
});
