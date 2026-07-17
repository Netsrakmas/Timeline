const CACHE_NAME = 'yearworm-2.2.1';
const ASSETS = ['./', './index.html', './manifest.json', './privacy.html', './icon-192.png', './icon-512.png', './icon-180.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
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
  event.respondWith(fetch(req).catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html'))));
});
