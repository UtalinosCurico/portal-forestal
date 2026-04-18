const CACHE_NAME = "portal-fmn-shell-v31";
const DATA_CACHE  = "portal-fmn-data-v1";
const OFFLINE_SHELL = ["/web", "/assets/fmn-icon-192.png", "/assets/fmn-icon-512.png"];

function isRuntimeAsset(url) {
  return (
    url.pathname === "/web" ||
    url.pathname.endsWith(".html") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".webmanifest")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(OFFLINE_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME && key !== DATA_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (request.method !== "GET") {
      // Escrituras (POST/PATCH/DELETE): dejar pasar — fallarán offline (Phase 2 agrega cola)
      event.respondWith(fetch(request));
      return;
    }
    // GETs de API: network-first, cache-fallback para offline
    event.respondWith(
      fetch(request)
        .then(async (res) => {
          if (res.ok) {
            const cache = await caches.open(DATA_CACHE);
            cache.put(request, res.clone());
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  if (request.mode === "navigate" || isRuntimeAsset(url)) {
    event.respondWith(
      fetch(request)
        .then(async (networkResponse) => {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, networkResponse.clone());
          return networkResponse;
        })
        .catch(async () => {
          const cachedResponse = await caches.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }

          return caches.match("/web");
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(async (cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      const networkResponse = await fetch(request);
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
      return networkResponse;
    })
  );
});
