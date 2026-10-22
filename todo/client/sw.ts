// The service worker: keeps the app shell available offline, never caches
// the API, and shows push notifications for reminders.
/// <reference lib="webworker" />
const sw = self as unknown as ServiceWorkerGlobalScope;

const ASSETS: string[] = '__ASSETS__' as unknown as string[];
const CACHE = 'todo-' + '__BUILD__';

sw.addEventListener('install', (e: ExtendableEvent) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => sw.skipWaiting()));
});
sw.addEventListener('activate', (e: ExtendableEvent) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => sw.clients.claim()));
});
sw.addEventListener('fetch', (e: FetchEvent) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || e.request.method !== 'GET') return;
  // navigations: network first (fresh shell), the cached shell when offline
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/').then((r) => r ?? new Response('Offline', { status: 503 }))));
    return;
  }
  // hashed assets: cache first
  e.respondWith(caches.match(e.request).then((r) => r ?? fetch(e.request).then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone())); return res; })));
});

sw.addEventListener('push', (e: PushEvent) => {
  let data: { title?: string; body?: string; url?: string; tag?: string } = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { title: 'To-do', body: e.data?.text() ?? '' }; }
  e.waitUntil(sw.registration.showNotification(data.title || 'To-do reminder', { body: data.body || '', tag: data.tag, data: { url: data.url || '/' }, icon: '/icon-192.png', badge: '/icon-192.png', requireInteraction: true }));
});
sw.addEventListener('notificationclick', (e: NotificationEvent) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', location.origin).href;
  e.waitUntil(sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return sw.clients.openWindow(url);
  }));
});
