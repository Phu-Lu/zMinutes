const CACHE = 'zminutes-v18';
const FILES = ['./', './index.html', './styles.css?v=18', './app.js?v=18', './zminutes-storage.js', './zminutes-workflows.js?v=15', './zminutes-recorder.js?v=18', './zminutes-recorder-worklet.js?v=18', './zminutes-ai.js?v=18', './zminutes-drive.js', './manifest.webmanifest?v=18', './zminutes-icon.svg', './zminutes-icon-192.png', './zminutes-icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('zminutes-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request, {cache:'no-store'}).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(e.request, response.clone()));
    return response;
  }).catch(() => caches.match(e.request).then(cached => cached || Response.error())));
});
