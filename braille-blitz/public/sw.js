// Offline: cache the whole app on first load, serve from cache after, and
// quietly fetch fresh copies in the background so updates arrive next time.
const VERSION = 'braille-blitz-v1';
const SHELL = ['./', './index.html', './styles.css', './manifest.json', './icon.svg', './apple-touch-icon.png', './icon-512.png',
  './js/app.js', './js/game.js', './js/braille.js', './js/stats.js', './js/audio.js', './js/a11y.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const refresh = fetch(e.request).then((res) => {
        if (res && res.ok) caches.open(VERSION).then((c) => c.put(e.request, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || refresh;
    }),
  );
});
