// GLAM – service worker: powiadomienia push (sekcja 8) i tryb offline dla grafiku, karnetu i listy zajęć (sekcja 10).
const CACHE = 'glam-v1';
const OFFLINE_API = ['/api/schedule', '/api/home', '/api/my/passes', '/api/my/bookings', '/api/studio', '/api/me'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // API: najpierw sieć, bez sieci – ostatnia zapisana odpowiedź (osobno per studio).
  if (OFFLINE_API.some((p) => url.pathname.startsWith(p))) {
    const key = `${url.pathname}${url.search}#${e.request.headers.get('x-studio-id') ?? ''}`;
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(key, res.clone()));
          return res;
        })
        .catch(() => caches.open(CACHE).then((c) => c.match(key)).then((r) => r ?? new Response(JSON.stringify({ error: 'offline', message: 'Brak internetu – pokazujemy ostatnio zapisane dane.' }), { status: 503, headers: { 'content-type': 'application/json' } }))),
    );
    return;
  }
  // Pobrane lekcje kursów (offline, K11) i powłoka aplikacji.
  if (url.pathname.startsWith('/api/media/')) {
    e.respondWith(caches.open('glam-offline-media').then((c) => c.match(url.pathname).then((hit) => hit ?? fetch(e.request))));
    return;
  }
  if (url.pathname === '/app' || url.pathname === '/') {
    e.respondWith(fetch(e.request).then((res) => { caches.open(CACHE).then((c) => c.put(url.pathname, res.clone())); return res; }).catch(() => caches.match(url.pathname)));
  }
});

self.addEventListener('push', (e) => {
  let data = { title: 'GLAM', body: '', url: '/app' };
  try {
    data = { ...data, ...e.data.json() };
  } catch {}
  e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: '/icon.svg', badge: '/icon.svg', data: { url: data.url } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = e.notification.data?.url ?? '/app';
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((list) => {
      const open = list.find((c) => c.url.includes('/app'));
      if (open) return open.focus().then((c) => c.navigate(target));
      return self.clients.openWindow(target);
    }),
  );
});
