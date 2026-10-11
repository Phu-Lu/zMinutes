const CACHE = "zminutes-v27";
const FILES = [
  "./index.html",
  "./styles.css?v=27",
  "./zminutes-v2.css?v=27",
  "./zminutes-model.js?v=27",
  "./zminutes-repository.js?v=27",
  "./zminutes-app.js?v=27",
  "./zminutes-views.js?v=27",
  "./zminutes-capture.js?v=27",
  "./zminutes-audio.js?v=27",
  "./zminutes-intelligence.js?v=27",
  "./zminutes-exports.js?v=27",
  "./zminutes-sync.js?v=27",
  "./zminutes-recovery.js?v=27",
  "./zminutes-reminders.js?v=27",
  "./zminutes-pwa.js?v=27",
  "./manifest.webmanifest?v=27",
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
