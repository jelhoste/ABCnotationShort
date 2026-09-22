/* Service worker — fonctionnement hors ligne.
 * Pour publier une mise à jour : changez VERSION (les anciens caches sont supprimés). */
const VERSION = 'v2';
const CACHE = 'partition-abc-' + VERSION;
const ABCJS_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/abcjs/6.5.2/abcjs-basic-min.js';
const ABCJS_LOCAL = 'vendor/abcjs-basic-min.js';       // optionnel (voir vendor/LISEZ-MOI.txt)
const CORE = ['./', 'index.html', 'abc-score-editor.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
const RUNTIME_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    // abcjs : mis en cache s'il est disponible (local ou CDN) ; l'échec ne bloque pas l'installation
    await Promise.allSettled([ABCJS_LOCAL, ABCJS_CDN].map(async (u) => {
      const r = await fetch(u, { cache: 'reload' });
      if (r.ok) await c.put(u, r);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('partition-abc-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && RUNTIME_HOSTS.indexOf(url.hostname) < 0) return;

  // Pages : réseau d'abord (mises à jour), cache en secours
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
        const r = await fetch(req, { signal: ctl.signal }); clearTimeout(t);
        if (r.ok) (await caches.open(CACHE)).put('index.html', r.clone());
        return r;
      } catch (err) {
        return (await caches.match('index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Ressources : cache d'abord, puis réseau (et mise en cache)
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) (await caches.open(CACHE)).put(req, r.clone());
      return r;
    } catch (err) {
      return Response.error();
    }
  })());
});
