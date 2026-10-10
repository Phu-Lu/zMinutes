const CACHE = 'zminutes-v11';
const FILES = ['./', './index.html', './styles.css', './app.js', './zminutes-storage.js', './zminutes-workflows.js', './zminutes-ai.js', './zminutes-drive.js', './manifest.webmanifest', './zminutes-icon.svg'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('zminutes-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(e.request, response.clone()));
    return response;
  }).catch(() => caches.match(e.request).then(cached => cached || Response.error())));
});
