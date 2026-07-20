const CACHE_NAME = 'yearworm-4.0.0-dev';
const ASSETS = ['./', './index.html', './manifest.json', './privacy.html', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', event => {
  // bypass the HTTP cache while filling ours — GitHub Pages serves max-age=600,
  // so a plain addAll could seed a stale index.html as the offline copy
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(ASSETS.map(u => new Request(u, { cache: 'no-cache' })))));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  // Navigations revalidate with the server (bypassing GitHub Pages' 10-minute
  // max-age HTTP cache) so a new deploy shows up on the next open — a 304 when
  // nothing changed keeps this fast. Everything else stays plain network-first.
  const req = event.request.mode === 'navigate'
    ? new Request(event.request, { cache: 'no-cache' })
    : event.request;
  // The index.html fallback is for NAVIGATIONS ONLY: handing HTML to a failed
  // script/audio/API request makes offline launches "glitch" instead of the
  // request failing fast like a normal dropped connection.
  event.respondWith(fetch(req).catch(() => caches.match(event.request).then(cached =>
    cached || (event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error())
  )));
});
