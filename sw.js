/* Service worker: offline support with network-first caching so updated questions are never stuck in cache. */
const BUILD_ID = "dev";
const CACHE = `ai103-study-${BUILD_ID}`;
const PRECACHE = [
  "./",
  "index.html",
  "styles.css",
  "js/core.js",
  "js/app.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "data/bank.json",
  "data/domains.json",
  "data/stats.json",
  "data/glossary.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => null))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("ai103-study-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) => {
          if (cached) return cached;
          if (request.mode === "navigate") return caches.match("index.html");
          return Response.error();
        }),
      ),
  );
});
