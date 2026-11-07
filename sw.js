// App shell cache so the calendar opens fast and works on spotty connections.
// Event data always comes from the network.
const CACHE = 'phoenix-events-v26';
const SHELL = ['./', 'index.html', 'styles.css?v=26', 'app.js?v=26', 'ocr.js?v=26', 'config.js?v=26', 'faq.js?v=26', 'campaign.js?v=26', 'icon-192.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // Network first so updates show up right away; fall back to cache when offline
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html'))));
});
