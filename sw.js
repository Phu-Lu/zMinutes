const CACHE = "zminutes-v32";
const FILES = [
  "./index.html",
  "./styles.css?v=32",
  "./zminutes-v2.css?v=32",
  "./zminutes-ui.css?v=32",
  "./zminutes-model.js?v=32",
  "./zminutes-repository.js?v=32",
  "./zminutes-app.js?v=32",
  "./zminutes-views.js?v=32",
  "./zminutes-editor.bundle.js?v=32",
  "./zminutes-rich-notes.js?v=32",
  "./zminutes-capture.js?v=32",
  "./zminutes-audio.js?v=32",
  "./zminutes-intelligence.js?v=32",
  "./zminutes-exports.js?v=32",
  "./zminutes-sync.js?v=32",
  "./zminutes-recovery.js?v=32",
  "./zminutes-reminders.js?v=32",
  "./zminutes-pwa.js?v=32",
  "./manifest.webmanifest?v=32",
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
