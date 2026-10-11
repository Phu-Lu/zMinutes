const CACHE = "zminutes-v26";
const FILES = [
  "./index.html",
  "./styles.css?v=26",
  "./zminutes-v2.css?v=26",
  "./zminutes-model.js?v=26",
  "./zminutes-repository.js?v=26",
  "./zminutes-app.js?v=26",
  "./zminutes-views.js?v=26",
  "./zminutes-capture.js?v=26",
  "./zminutes-audio.js?v=26",
  "./zminutes-intelligence.js?v=26",
  "./zminutes-exports.js?v=26",
  "./zminutes-sync.js?v=26",
  "./zminutes-recovery.js?v=26",
  "./zminutes-reminders.js?v=26",
  "./zminutes-pwa.js?v=26",
  "./manifest.webmanifest?v=26",
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
