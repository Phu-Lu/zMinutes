const CACHE = "zminutes-v37";
const FILES = [
  "./index.html",
  "./zminutes-tokens.css?v=37",
  "./zminutes-layout.css?v=37",
  "./styles.css?v=37",
  "./zminutes-v2.css?v=37",
  "./zminutes-ui.css?v=37",
  "./zminutes-model.js?v=37",
  "./zminutes-repository.js?v=37",
  "./zminutes-app.js?v=37",
  "./zminutes-views.js?v=37",
  "./zminutes-editor.bundle.js?v=37",
  "./zminutes-rich-notes.js?v=37",
  "./zminutes-capture.js?v=37",
  "./zminutes-audio.js?v=37",
  "./zminutes-intelligence.js?v=37",
  "./zminutes-live.js?v=37",
  "./zminutes-exports.js?v=37",
  "./zminutes-sync.js?v=37",
  "./zminutes-recovery.js?v=37",
  "./zminutes-reminders.js?v=37",
  "./zminutes-pwa.js?v=37",
  "./manifest.webmanifest?v=37",
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
