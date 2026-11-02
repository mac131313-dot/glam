// Strona studia dla wyszukiwarek i podglądu linków. Front to SPA – bez tego surowy HTML /s/:slug miał tytuł „GLAM”
// i pusty <div id="root">: Messenger i WhatsApp pokazywały „GLAM” bez opisu, a Google nie widział adresu ani godzin.
// Tu powstaje <head> konkretnej podstrony (tytuł, opis, podgląd linku, adres kanoniczny, dane firmy, ikona),
// a także robots.txt i sitemap.xml. Wstrzykuje go nginx (produkcja) albo wtyczka Vite (serwer deweloperski).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { parseSiteDoc, receptionSlots, siteImageUrl, sitePages, type SiteDoc } from '@glam/core';
import type { Deps } from '../context.ts';
import type { Db } from '../db.ts';
import { loadStudio, logoInfo } from '../services/studio.ts';

type StudioRow = { id: string; slug: string; site_json: string | null };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON w <script> – „</script>” w nazwie studia nie może zamknąć znacznika. */
const jsonLd = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');
const parse = (s: string | null) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};
const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function publishedStudio(db: Db, slug: string): StudioRow | undefined {
  return db.prepare("SELECT id, slug, site_json FROM studios WHERE slug = ? AND published = 1 AND status != 'suspended'").get(slug) as StudioRow | undefined;
}

/** „Geodetów 3, 35-328 Rzeszów” → ulica, kod, miasto (PostalAddress). Inny zapis – cały adres jako ulica. */
function postalAddress(address: string, city: string | null) {
  const m = address.match(/^(.*?),?\s*(\d{2}-\d{3})\s+(.+)$/);
  return {
    '@type': 'PostalAddress',
    streetAddress: m ? m[1].trim() : address,
    ...(m ? { postalCode: m[2], addressLocality: m[3].trim() } : city ? { addressLocality: city } : {}),
    addressCountry: 'PL',
  };
}

/** Monogram studia jako ikona karty – pierwsza litera nazwy w kolorach strony, zamiast „g” platformy. */
export function monogramIcon(name: string, ink = '#24201d', bg = '#f7f4ef') {
  const letter = esc((name.trim()[0] ?? 'S').toUpperCase());
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='46' fill='${ink}'/><text x='50' y='66' font-size='46' text-anchor='middle' fill='${bg}' font-family='Georgia, serif'>${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** <head> podstrony studia (path: null = strona główna, „grafik”…). Null – nie ma takiego opublikowanego studia. */
export function siteHead(db: Db, slug: string, path: string | null, origin: string): string | null {
  const row = publishedStudio(db, slug);
  if (!row) return null;
  const studio = loadStudio(db, row.id);
  const doc: SiteDoc = parseSiteDoc(parse(row.site_json));
  const pages = sitePages(doc, { shop: studio.has('shop') });
  const page = path ? pages.find((p) => p.path === path) ?? null : null;
  const section = page ? doc.sections.find((s) => s.key === page.key) : null;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const home = doc.seo.title || (studio.tagline ? `${studio.name} – ${studio.tagline}` : studio.name);
  const title = page ? `${page.label} – ${studio.name}` : home;
  const description = (section && str(section.values.pageIntro)) || doc.seo.description || studio.tagline || `${studio.name} – zapisy na zajęcia w aplikacji.`;
  const url = `${origin}/s/${studio.slug}${page ? `/${page.path}` : ''}`;
  const { logoUrl } = logoInfo(studio);
  const imageId = (section && str(section.values.pageImage)) || str(doc.hero.values.image);
  const image = imageId && doc.media[imageId] !== 'video' ? `${origin}${siteImageUrl(imageId)}` : logoUrl ? `${origin}${logoUrl}` : '';

  const hours = receptionSlots(studio.settings.support.hours);
  const business = {
    '@context': 'https://schema.org',
    '@type': 'ExerciseGym',
    name: studio.name,
    ...(studio.tagline ? { description: studio.tagline } : {}),
    url: `${origin}/s/${studio.slug}`,
    ...(studio.phone ? { telephone: studio.phone } : {}),
    ...(studio.email ? { email: studio.email } : {}),
    ...(studio.address ? { address: postalAddress(studio.address, studio.city) } : {}),
    ...(image ? { image } : {}),
    ...(hours.length
      ? { openingHoursSpecification: hours.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${SCHEMA_DAYS[h.weekday % 7]}`, opens: h.from, closes: h.to })) }
      : {}),
  };

  return [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<link rel="icon" href="${esc(logoUrl ? `${origin}${logoUrl}` : monogramIcon(studio.name))}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:locale" content="pl_PL" />`,
    `<meta property="og:site_name" content="${esc(studio.name)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    image ? `<meta property="og:image" content="${esc(image)}" />` : '',
    `<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`,
    `<script type="application/ld+json">${jsonLd(business)}</script>`,
  ]
    .filter(Boolean)
    .join('\n    ');
}

/** index.html z tytułem i ikoną platformy → ten sam plik z <head> studia. */
export function injectHead(html: string, head: string) {
  return html
    .replace(/<title>[^<]*<\/title>\s*/, '')
    // href ikony to SVG z „>” w środku – dopasowanie do końca cudzysłowu, nie do pierwszego „>”.
    .replace(/<link rel="icon" href="[^"]*"[^>]*>\s*/, '')
    .replace('</head>', `    ${head}\n  </head>`);
}

/** Ścieżka /s/:slug[/:path] → slug i podstrona (bez sklepu z produktem i kursu – mają własne strony). */
export function parseSitePath(uri: string): { slug: string; path: string | null } | null {
  const m = decodeURIComponent(uri.split('?')[0]).match(/^\/s\/([^/]+)(?:\/([^/]+))?\/?$/);
  return m ? { slug: m[1], path: m[2] ?? null } : null;
}

export function siteSeoRoutes(app: FastifyInstance, deps: Deps) {
  const { db } = deps;
  const origin = (deps.publicUrl ?? 'http://localhost:5173').replace(/\/$/, '');
  // Zbudowany front (index.html) – w obrazie Dockera kopiowany obok API (GLAM_WEB_DIST). Czytany raz.
  let template: string | null | undefined;
  const indexHtml = () => {
    if (template === undefined) {
      try {
        template = readFileSync(join(process.env.GLAM_WEB_DIST ?? join(process.cwd(), '..', 'web', 'dist'), 'index.html'), 'utf8');
      } catch {
        template = null;
      }
    }
    return template;
  };

  // Sam <head> – dla wtyczki Vite na serwerze deweloperskim (ona ma własny index.html z HMR).
  app.get<{ Params: { slug: string }; Querystring: { path?: string } }>('/api/public/site-head/:slug', async (req, reply) => {
    const head = siteHead(db, req.params.slug, req.query.path || null, origin);
    if (!head) return reply.code(404).type('text/plain').send('');
    return reply.type('text/html; charset=utf-8').send(head);
  });

  // Cała strona – nginx kieruje tu /s/… (uri = oryginalny adres). Bez szablonu albo studia: zwykły index.html SPA.
  app.get<{ Querystring: { uri?: string } }>('/api/public/site-page', async (req, reply) => {
    const html = indexHtml();
    if (!html) return reply.code(503).type('text/plain').send('Brak zbudowanego frontu (GLAM_WEB_DIST).');
    const at = parseSitePath(req.query.uri ?? '');
    const head = at ? siteHead(db, at.slug, at.path, origin) : null;
    return reply
      .type('text/html; charset=utf-8')
      .header('cache-control', 'no-cache')
      .send(head ? injectHead(html, head) : html);
  });

  // Robots: strona studiów do indeksu, aplikacja, panel i API – nie.
  app.get('/api/public/robots.txt', async (_req, reply) =>
    reply.type('text/plain; charset=utf-8').send(['User-agent: *', 'Allow: /s/', 'Disallow: /api/', 'Disallow: /app', 'Disallow: /panel', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n')),
  );

  // Mapa strony: wszystkie opublikowane studia i ich zakładki.
  app.get('/api/public/sitemap.xml', async (_req, reply) => {
    const rows = db.prepare("SELECT id, slug, site_json FROM studios WHERE published = 1 AND status != 'suspended' ORDER BY slug").all() as StudioRow[];
    const urls: string[] = [];
    for (const r of rows) {
      const studio = loadStudio(db, r.id);
      const doc = parseSiteDoc(parse(r.site_json));
      urls.push(`${origin}/s/${r.slug}`, ...sitePages(doc, { shop: studio.has('shop') }).map((p) => `${origin}/s/${r.slug}/${p.path}`));
    }
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u)}</loc></url>`).join('\n')}\n</urlset>\n`;
    return reply.type('application/xml; charset=utf-8').send(body);
  });
}
