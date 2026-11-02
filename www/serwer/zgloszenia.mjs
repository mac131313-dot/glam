// Zgłoszenia z formularza na glamcore.pl i ich podgląd w /admin. Bez zależności, sam Node.
//
// Usługa słucha tylko na 127.0.0.1 i stoi za Caddy (www/deploy/glam.caddy):
// - POST /api/zgloszenie       – formularz „Umów pokaz”, publiczne,
// - GET  /admin                – ekran logowania albo lista zgłoszeń (zależnie od sesji),
// - GET  /admin/admin.css      – wygląd obu ekranów,
// - POST /api/admin/zaloguj    – hasło → ciasteczko sesji,
// - POST /api/admin/wyloguj,
// - GET  /api/admin/zgloszenia – dane do listy,           tylko z sesją,
// - POST /api/admin/zgloszenia/:id/usun                   tylko z sesją.
// Trasy admina dodatkowo wymagają klucza X-Glam-Klucz, który dokleja tylko Caddy.
// Bez tego inny proces na tej maszynie mógłby próbować haseł albo czytać zgłoszenia prosto z portu.
//
// Hasło: skrót scrypt w GLAM_HASLO (ustawia www/deploy/haslo-admina.sh przez
// `node zgloszenia.mjs skrot-hasla`). Plik jest czytany przy każdym logowaniu,
// więc zmiana hasła nie wymaga restartu. Sesje są w pamięci – restart wylogowuje.
//
// Dane: jeden plik JSON Lines w GLAM_DANE. Bez adresów IP – do odpowiedzi na zgłoszenie
// wystarczą imię, studio i kontakt (RODO: minimum danych).

import { createServer } from 'node:http';
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { appendFile, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const skrot = promisify(scrypt);

// `node zgloszenia.mjs skrot-hasla` – czyta hasło ze stdin, wypisuje skrót do pliku GLAM_HASLO.
// Hasło nie trafia do argumentów procesu (widocznych w `ps`) ani do historii powłoki.
if (process.argv[2] === 'skrot-hasla') {
  let haslo = '';
  for await (const c of process.stdin) haslo += c;
  haslo = haslo.replace(/\r?\n$/, '');
  if (haslo.length < 10) {
    console.error('Hasło musi mieć co najmniej 10 znaków.');
    process.exit(1);
  }
  const sol = randomBytes(16);
  console.log(`scrypt:${sol.toString('hex')}:${(await skrot(haslo, sol, 64)).toString('hex')}`);
  process.exit(0);
}

const PORT = Number(process.env.PORT ?? 3500);
const DANE = process.env.GLAM_DANE ?? './dane';
const KLUCZ = process.env.GLAM_KLUCZ_ADMINA ?? '';
const ORIGIN = process.env.GLAM_ORIGIN ?? 'https://glamcore.pl';
const PLIK_HASLA = process.env.GLAM_HASLO ?? '/opt/glam/admin.haslo';
const PLIK = join(DANE, 'zgloszenia.jsonl');

if (KLUCZ.length < 32) {
  console.error('Brak GLAM_KLUCZ_ADMINA (min. 32 znaki) – nie startuję.');
  process.exit(1);
}
await mkdir(DANE, { recursive: true });

const TU = dirname(fileURLToPath(import.meta.url));
const [STRONA_LOGOWANIA, STRONA_ADMINA, STYL_ADMINA] = await Promise.all(
  ['logowanie.html', 'admin.html', 'admin.css'].map((p) => readFile(join(TU, p), 'utf8')),
);

const POLA = { imie: 80, studio: 120, kontakt: 160 };

// Limit prób z jednego adresu w oknie czasu. W pamięci – po restarcie liczy od zera.
const ogranicznik = (oknoMs, limit) => {
  const proby = new Map();
  return (ip) => {
    const teraz = Date.now();
    const swieze = (proby.get(ip) ?? []).filter((t) => teraz - t < oknoMs);
    swieze.push(teraz);
    proby.set(ip, swieze);
    if (proby.size > 10_000) for (const [k, v] of proby) if (teraz - v.at(-1) > oknoMs) proby.delete(k);
    return swieze.length > limit;
  };
};
const zaDuzoZgloszen = ogranicznik(10 * 60 * 1000, 5);
const zaDuzoLogowan = ogranicznik(15 * 60 * 1000, 8);

// Sesje: losowy token w ciasteczku HttpOnly, ważny 7 dni od zalogowania.
const SESJA_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'glam_sesja';
const sesje = new Map();
const nowaSesja = () => {
  const teraz = Date.now();
  for (const [t, wygasa] of sesje) if (wygasa < teraz) sesje.delete(t);
  const token = randomBytes(32).toString('base64url');
  sesje.set(token, teraz + SESJA_MS);
  return token;
};
const tokenZ = (req) => {
  for (const c of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = c.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return '';
};
const zalogowany = (req) => {
  const wygasa = sesje.get(tokenZ(req));
  return Boolean(wygasa && wygasa > Date.now());
};
const ciasteczko = (token, maxAge) =>
  `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;

const dobreHaslo = async (haslo) => {
  let zapis;
  try {
    zapis = (await readFile(PLIK_HASLA, 'utf8')).trim();
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  const [rodzaj, sol, hash] = zapis.split(':');
  if (rodzaj !== 'scrypt' || !sol || !hash) return null;
  const wlasciwy = Buffer.from(hash, 'hex');
  const podany = await skrot(String(haslo), Buffer.from(sol, 'hex'), wlasciwy.length);
  return timingSafeEqual(podany, wlasciwy);
};

const wczytaj = async () => {
  try {
    const txt = await readFile(PLIK, 'utf8');
    return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
};

// Zapis przez plik tymczasowy i rename – przerwany zapis nie zostawi uciętej listy.
const zapiszWszystkie = async (lista) => {
  const tmp = `${PLIK}.tmp`;
  await writeFile(tmp, lista.map((z) => JSON.stringify(z)).join('\n') + (lista.length ? '\n' : ''), { mode: 0o600 });
  await rename(tmp, PLIK);
};

const czytajCialo = (req, max = 4096) =>
  new Promise((ok, zle) => {
    let dlugosc = 0;
    const kawalki = [];
    // Po przekroczeniu limitu dalsze dane są pomijane (bez zrywania połączenia),
    // żeby klient dostał czytelne 413 zamiast urwanej odpowiedzi.
    req.on('data', (c) => {
      dlugosc += c.length;
      if (dlugosc <= max) kawalki.push(c);
    });
    req.on('end', () => (dlugosc > max ? zle(Object.assign(new Error('za duże'), { status: 413 })) : ok(Buffer.concat(kawalki).toString('utf8'))));
    req.on('error', zle);
  });

const json = (res, status, dane, naglowki = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...naglowki });
  res.end(JSON.stringify(dane));
};

const strona = (res, typ, tresc) => {
  res.writeHead(200, { 'Content-Type': `${typ}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  res.end(tresc);
};

const zgodnyKlucz = (req) => {
  const podany = Buffer.from(String(req.headers['x-glam-klucz'] ?? ''));
  const wlasciwy = Buffer.from(KLUCZ);
  return podany.length === wlasciwy.length && timingSafeEqual(podany, wlasciwy);
};

// Zapytania zmieniające dane muszą przyjść z naszej strony (CSRF; ciasteczko ma też SameSite=Strict).
const zNaszejStrony = (req) => req.headers.origin === ORIGIN;
const ipZ = (req) => String(req.headers['x-real-ip'] ?? 'brak');

async function przyjmijZgloszenie(req, res) {
  if (!zNaszejStrony(req)) return json(res, 403, { blad: 'Niedozwolone źródło.' });
  if (zaDuzoZgloszen(ipZ(req))) return json(res, 429, { blad: 'Za dużo zgłoszeń. Spróbuj za kilka minut.' });

  let dane;
  try {
    dane = JSON.parse(await czytajCialo(req));
  } catch (e) {
    return json(res, e.status ?? 400, { blad: 'Nieprawidłowe dane.' });
  }
  // Pole-pułapka: niewidoczne dla ludzi, boty je wypełniają. Udajemy sukces, nic nie zapisujemy.
  if (typeof dane?.www === 'string' && dane.www.trim()) return json(res, 201, { ok: true });

  const zgl = { id: randomUUID(), kiedy: new Date().toISOString() };
  for (const [pole, max] of Object.entries(POLA)) {
    const v = typeof dane?.[pole] === 'string' ? dane[pole].trim().slice(0, max) : '';
    if (!v) return json(res, 422, { blad: 'Uzupełnij imię, nazwę studia i kontakt.' });
    zgl[pole] = v;
  }
  await appendFile(PLIK, JSON.stringify(zgl) + '\n', { mode: 0o600 });
  json(res, 201, { ok: true });
}

async function zaloguj(req, res) {
  if (!zNaszejStrony(req)) return json(res, 403, { blad: 'Niedozwolone źródło.' });
  if (zaDuzoLogowan(ipZ(req))) return json(res, 429, { blad: 'Za dużo prób. Spróbuj za kwadrans.' });
  let haslo;
  try {
    haslo = JSON.parse(await czytajCialo(req, 1024))?.haslo;
  } catch (e) {
    return json(res, e.status ?? 400, { blad: 'Nieprawidłowe dane.' });
  }
  if (typeof haslo !== 'string' || !haslo) return json(res, 422, { blad: 'Wpisz hasło.' });
  const wynik = await dobreHaslo(haslo);
  if (wynik === null) return json(res, 503, { blad: 'Hasło nie jest jeszcze ustawione.' });
  if (!wynik) return json(res, 401, { blad: 'To nie jest właściwe hasło.' });
  json(res, 200, { ok: true }, { 'Set-Cookie': ciasteczko(nowaSesja(), SESJA_MS / 1000) });
}

const serwer = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/zgloszenie' && req.method === 'POST') return await przyjmijZgloszenie(req, res);

    if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
      if (!zgodnyKlucz(req)) return json(res, 403, { blad: 'Brak dostępu.' });

      if (pathname === '/admin' && req.method === 'GET') return strona(res, 'text/html', zalogowany(req) ? STRONA_ADMINA : STRONA_LOGOWANIA);
      if (pathname === '/admin/admin.css' && req.method === 'GET') return strona(res, 'text/css', STYL_ADMINA);
      if (pathname === '/api/admin/zaloguj' && req.method === 'POST') return await zaloguj(req, res);
      if (pathname === '/api/admin/wyloguj' && req.method === 'POST') {
        if (!zNaszejStrony(req)) return json(res, 403, { blad: 'Niedozwolone źródło.' });
        sesje.delete(tokenZ(req));
        return json(res, 200, { ok: true }, { 'Set-Cookie': ciasteczko('', 0) });
      }

      if (pathname.startsWith('/api/admin/') && !zalogowany(req)) return json(res, 401, { blad: 'Zaloguj się ponownie.' });

      if (pathname === '/api/admin/zgloszenia' && req.method === 'GET') {
        return json(res, 200, (await wczytaj()).reverse());
      }
      const usun = pathname.match(/^\/api\/admin\/zgloszenia\/([0-9a-f-]{36})\/usun$/);
      if (usun && req.method === 'POST') {
        if (!zNaszejStrony(req)) return json(res, 403, { blad: 'Niedozwolone źródło.' });
        const lista = await wczytaj();
        const reszta = lista.filter((z) => z.id !== usun[1]);
        if (reszta.length === lista.length) return json(res, 404, { blad: 'Nie ma takiego zgłoszenia.' });
        await zapiszWszystkie(reszta);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { blad: 'Nie znaleziono.' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { blad: 'Błąd serwera.' });
  }
});

serwer.listen(PORT, '127.0.0.1', () => console.log(`zgłoszenia GLAM na 127.0.0.1:${PORT}`));
