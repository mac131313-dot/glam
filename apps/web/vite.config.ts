import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const API = `http://127.0.0.1:${process.env.API_PORT ?? 3001}`;

/**
 * Strona studia (/s/:slug[/:zakładka]) dostaje <head> z API – tytuł, opis, podgląd linku, dane firmy i ikonę – już w HTML,
 * jak na produkcji (tam robi to nginx przez /api/public/site-page). Bez tego serwer deweloperski oddawał „GLAM”.
 */
function studioHead(): Plugin {
  return {
    name: 'glam-studio-head',
    async transformIndexHtml(html, ctx) {
      const m = decodeURIComponent((ctx.originalUrl ?? ctx.path).split('?')[0]).match(/^\/s\/([^/]+)(?:\/([^/]+))?\/?$/);
      if (!m) return html;
      try {
        const r = await fetch(`${API}/api/public/site-head/${encodeURIComponent(m[1])}?path=${encodeURIComponent(m[2] ?? '')}`);
        if (!r.ok) return html;
        const head = await r.text();
        return html
          .replace(/<title>[^<]*<\/title>\s*/, '')
          // href ikony to SVG z „>” w środku – dopasowanie do końca cudzysłowu, nie do pierwszego „>”.
          .replace(/<link rel="icon" href="[^"]*"[^>]*>\s*/, '')
          .replace('</head>', `    ${head}\n  </head>`);
      } catch {
        return html;
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), studioHead()],
  server: {
    // PORT / API_PORT pozwalają odpalić kilka podglądów naraz (np. z launch.json z autoPort).
    port: Number(process.env.PORT ?? 5173),
    strictPort: !!process.env.PORT,
    // Widoczny w sieci lokalnej (Wi-Fi), żeby otworzyć demo na telefonie. API zostaje na 127.0.0.1 –
    // telefon dociera do niego przez proxy poniżej. Wyłączenie: usuń tę linię.
    host: true,
    proxy: {
      '/api': API,
      // robots.txt i mapa strony dla wyszukiwarek – z API (jak w nginx).
      '/robots.txt': { target: API, rewrite: () => '/api/public/robots.txt' },
      '/sitemap.xml': { target: API, rewrite: () => '/api/public/sitemap.xml' },
    },
  },
});
