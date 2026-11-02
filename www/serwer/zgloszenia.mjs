// Zgłoszenia z formularza na glamcore.pl i ich podgląd w /admin. Bez zależności, sam Node.
//
// Usługa słucha tylko na 127.0.0.1 i stoi za Caddy (www/deploy/glam.caddy):
// - POST /api/zgloszenie       – formularz „Umów pokaz”, publiczne,
// - GET  /admin                – lista zgłoszeń,          za hasłem w Caddy,
// - GET  /api/admin/zgloszenia – dane do listy,           za hasłem w Caddy,
// - POST /api/admin/zgloszenia/:id/usun                   za hasłem w Caddy.
// Trasy admina dodatkowo wymagają klucza X-Glam-Klucz, który dokleja tylko Caddy po udanym
// logowaniu. Bez tego inny proces na tej maszynie mógłby czytać zgłoszenia prosto z portu.
//
// Dane: jeden plik JSON Lines w GLAM_DANE. Bez adresów IP – do odpowiedzi na zgłoszenie
// wystarczą imię, studio i kontakt (RODO: minimum danych).

import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { appendFile, readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 3500);
const DANE = process.env.GLAM_DANE ?? './dane';
const KLUCZ = process.env.GLAM_KLUCZ_ADMINA ?? '';
const ORIGIN = process.env.GLAM_ORIGIN ?? 'https://glamcore.pl';
const PLIK = join(DANE, 'zgloszenia.jsonl');

if (KLUCZ.length < 32) {
  console.error('Brak GLAM_KLUCZ_ADMINA (min. 32 znaki) – nie startuję.');
  process.exit(1);
}
await mkdir(DANE, { recursive: true });

const POLA = { imie: 80, studio: 120, kontakt: 160 };

// Limit zgłoszeń z jednego adresu: 5 na 10 minut. W pamięci – po restarcie liczy od zera.
const OKNO_MS = 10 * 60 * 1000;
const LIMIT = 5;
const proby = new Map();
const zaDuzo = (ip) => {
  const teraz = Date.now();
  const swieze = (proby.get(ip) ?? []).filter((t) => teraz - t < OKNO_MS);
  swieze.push(teraz);
  proby.set(ip, swieze);
  if (proby.size > 10_000) for (const [k, v] of proby) if (teraz - v.at(-1) > OKNO_MS) proby.delete(k);
  return swieze.length > LIMIT;
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

const json = (res, status, dane) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dane));
};

const zgodnyKlucz = (req) => {
  const podany = Buffer.from(String(req.headers['x-glam-klucz'] ?? ''));
  const wlasciwy = Buffer.from(KLUCZ);
  return podany.length === wlasciwy.length && timingSafeEqual(podany, wlasciwy);
};

// Zapytania zmieniające dane muszą przyjść z naszej strony (ochrona przed CSRF przy Basic Auth).
const zNaszejStrony = (req) => req.headers.origin === ORIGIN;

async function przyjmijZgloszenie(req, res) {
  if (!zNaszejStrony(req)) return json(res, 403, { blad: 'Niedozwolone źródło.' });
  if (zaDuzo(String(req.headers['x-real-ip'] ?? 'brak'))) return json(res, 429, { blad: 'Za dużo zgłoszeń. Spróbuj za kilka minut.' });

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

const serwer = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');

    if (pathname === '/api/zgloszenie' && req.method === 'POST') return await przyjmijZgloszenie(req, res);

    if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin/')) {
      if (!zgodnyKlucz(req)) return json(res, 403, { blad: 'Brak dostępu.' });

      if (pathname === '/admin' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
        return res.end(STRONA_ADMINA);
      }
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

const STRONA_ADMINA = `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Zgłoszenia – GLAM</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<style>
  :root { --bg: #f3f0ea; --surface: #fbfaf7; --ink: #1d1a17; --muted: #77706a; --line: #e2ddd5; }
  @media (prefers-color-scheme: dark) { :root { --bg: #171513; --surface: #211e1b; --ink: #f1ece5; --muted: #a39a90; --line: #34302b; } }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.5 system-ui, -apple-system, sans-serif; }
  main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
  h1 { font-size: 28px; font-weight: 500; letter-spacing: -0.02em; margin: 0 0 4px; }
  .muted { color: var(--muted); }
  ul { list-style: none; padding: 0; margin: 24px 0 0; display: grid; gap: 8px; }
  li { background: var(--surface); border-radius: 16px; padding: 16px; display: flex; gap: 16px; align-items: flex-start; }
  li div { flex: 1; min-width: 0; }
  b { font-weight: 500; }
  .kontakt { overflow-wrap: anywhere; }
  small { color: var(--muted); font-size: 13px; }
  button { font: inherit; font-size: 14px; border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 999px; padding: 6px 14px; cursor: pointer; }
  button:hover { color: var(--ink); border-color: var(--ink); }
  .pusto { margin-top: 32px; }
</style>
</head>
<body>
<main>
  <h1>Zgłoszenia</h1>
  <p class="muted" id="ile">Wczytuję…</p>
  <ul id="lista"></ul>
</main>
<script>
const lista = document.getElementById('lista');
const ile = document.getElementById('ile');
const kiedy = (iso) => new Date(iso).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
const tekst = (t) => document.createTextNode(t);

async function wczytaj() {
  const r = await fetch('/api/admin/zgloszenia', { cache: 'no-store' });
  if (!r.ok) { ile.textContent = 'Nie udało się wczytać zgłoszeń.'; return; }
  const dane = await r.json();
  ile.textContent = dane.length ? 'Wszystkich: ' + dane.length + ', najnowsze na górze.' : 'Na razie nie ma żadnych zgłoszeń.';
  lista.replaceChildren(...dane.map((z) => {
    const li = document.createElement('li');
    const d = document.createElement('div');
    const g = document.createElement('b'); g.append(tekst(z.imie + ' · ' + z.studio));
    const k = document.createElement('div'); k.className = 'kontakt'; k.append(tekst(z.kontakt));
    const c = document.createElement('small'); c.append(tekst(kiedy(z.kiedy)));
    d.append(g, k, c);
    const b = document.createElement('button'); b.type = 'button'; b.textContent = 'Usuń';
    b.onclick = async () => {
      if (!confirm('Usunąć zgłoszenie od ' + z.imie + '? Tego nie da się cofnąć.')) return;
      const r = await fetch('/api/admin/zgloszenia/' + z.id + '/usun', { method: 'POST' });
      if (r.ok) wczytaj(); else alert('Nie udało się usunąć.');
    };
    li.append(d, b);
    return li;
  }));
}
wczytaj();
</script>
</body>
</html>`;
