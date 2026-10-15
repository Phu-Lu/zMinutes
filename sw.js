const CACHE = "zminutes-v35";
const FILES = [
  "./index.html",
  "./styles.css?v=35",
  "./zminutes-v2.css?v=35",
  "./zminutes-ui.css?v=35",
  "./zminutes-model.js?v=35",
  "./zminutes-repository.js?v=35",
  "./zminutes-app.js?v=35",
  "./zminutes-views.js?v=35",
  "./zminutes-editor.bundle.js?v=35",
  "./zminutes-rich-notes.js?v=35",
  "./zminutes-capture.js?v=35",
  "./zminutes-audio.js?v=35",
  "./zminutes-intelligence.js?v=35",
  "./zminutes-exports.js?v=35",
  "./zminutes-sync.js?v=35",
  "./zminutes-recovery.js?v=35",
  "./zminutes-reminders.js?v=35",
  "./zminutes-pwa.js?v=35",
  "./manifest.webmanifest?v=35",
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
