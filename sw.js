const CACHE = "zminutes-v24";
const FILES = [
  "./index.html",
  "./styles.css?v=24",
  "./zminutes-v2.css?v=24",
  "./zminutes-model.js?v=24",
  "./zminutes-repository.js?v=24",
  "./zminutes-app.js?v=24",
  "./zminutes-views.js?v=24",
  "./zminutes-capture.js?v=24",
  "./zminutes-audio.js?v=24",
  "./zminutes-intelligence.js?v=24",
  "./zminutes-exports.js?v=24",
  "./zminutes-sync.js?v=24",
  "./zminutes-recovery.js?v=24",
  "./zminutes-reminders.js?v=24",
  "./zminutes-pwa.js?v=24",
  "./manifest.webmanifest?v=24",
  "./zminutes-icon.svg",
  "./zminutes-icon-192.png",
  "./zminutes-icon-512.png",
];
self.addEventListener("install", (e) =>
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES))),
);
self.addEventListener("message", (e) => {
  if (e.data?.type === "ACTIVATE") self.skipWaiting();
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (
    e.request.method !== "GET" ||
    new URL(e.request.url).origin !== self.location.origin
  )
    return;
  const url = new URL(e.request.url);
  if (
    e.request.mode === "navigate" &&
    url.pathname.startsWith(new URL(self.registration.scope).pathname)
  ) {
    e.respondWith(
      caches
        .open(CACHE)
        .then((c) => c.match("./index.html"))
        .then((cached) => cached || fetch(e.request)),
    );
    return;
  }
  e.respondWith(
    caches
      .open(CACHE)
      .then((c) => c.match(e.request))
      .then((cached) => cached || fetch(e.request)),
  );
});
