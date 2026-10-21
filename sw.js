const CACHE = "zminutes-v41";
const FILES = [
  "./index.html",
  "./zminutes-tokens.css?v=39",
  "./zminutes-layout.css?v=39",
  "./styles.css?v=39",
  "./zminutes-v2.css?v=39",
  "./zminutes-ui.css?v=41",
  "./zminutes-model.js?v=39",
  "./zminutes-repository.js?v=39",
  "./zminutes-app.js?v=41",
  "./zminutes-feedback.js?v=39",
  "./zminutes-views.js?v=41",
  "./zminutes-editor.bundle.js?v=39",
  "./zminutes-rich-notes.js?v=39",
  "./zminutes-capture.js?v=39",
  "./zminutes-audio.js?v=39",
  "./zminutes-intelligence.js?v=39",
  "./zminutes-live.js?v=39",
  "./zminutes-exports.js?v=39",
  "./zminutes-sync.js?v=39",
  "./zminutes-recovery.js?v=39",
  "./zminutes-reminders.js?v=39",
  "./zminutes-pwa.js?v=39",
  "./zminutes-personal-store.js?v=39",
  "./zminutes-personal.js?v=41",
  "./zminutes-personal-export.js?v=39",
  "./manifest.webmanifest?v=39",
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
