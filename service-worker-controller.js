const CACHE_NAME = "scoreboard-controller-v15";
const APP_SHELL = [
  "./controller.html",
  "./controller.css",
  "./controller.js",
  "./styles.css",
  "./firebase.js",
  "./controller.webmanifest",
  "./assets/icons/basketball-ball-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const reqUrl = new URL(event.request.url);
  if (reqUrl.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request);
        if (response && response.ok) {
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (_) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        return cache.match("./controller.html");
      }
    })()
  );
});
