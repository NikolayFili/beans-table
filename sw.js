/* Bean's Table service worker.
   PURPOSE: installability + offline caching ONLY. There is no push handling
   here on purpose — web push needs a server, which would break the no-backend rule.
   Reminders are delivered by the user's own calendar app. */

const CACHE = "beans-table-v7";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for our own assets; network for everything else (e.g. the YouTube
// embed and Google Fonts), falling back to cache when offline.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match("./index.html")))
    );
    return;
  }

  // cross-origin (fonts, yt thumbnails): try network, fall back to cache
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
