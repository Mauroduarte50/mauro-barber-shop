// v2: API routes are NEVER read from or written to the Cache Storage — they
// always hit the network. A stale cached response for e.g. /api/public/config
// (from an earlier install, or a different origin's cache bleeding through a
// browser bug) previously showed a client the wrong barbershop name / an
// empty service list with no error, because caches.match() was consulted for
// every non-navigation request, API calls included. Bumping the cache name
// also forces `activate` below to purge any old (pre-v2) cache still held by
// a phone/browser from earlier testing.
const CACHE = "barberia-v2";
const CORE = ["/", "/reservar", "/manifest.webmanifest"];

// Only these are safe to serve cache-first: built static assets and local
// images. Everything else (pages, and especially /api/*) must go to network.
function isCacheableAsset(url) {
  return url.includes("/_next/static/") || url.includes("/images/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith("http")) return;

  // API routes: always network, never touch the Cache Storage in either
  // direction. Bookings/availability must reflect live server state.
  if (new URL(req.url).pathname.startsWith("/api/")) {
    return; // let the browser handle it natively — no respondWith at all
  }

  // Navigation (page loads): network-first, cached only as an offline
  // fallback, keyed by the actual URL (not a shared "/" bucket).
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/"))),
    );
    return;
  }

  // Static assets / images: cache-first, refreshed in the background.
  if (isCacheableAsset(req.url)) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          }),
      ),
    );
    return;
  }

  // Everything else: straight to network, no caching.
});

// ---- Web Push: new booking / cancellation / reschedule notifications ----
self.addEventListener("push", (event) => {
  let data = { title: "Nueva notificación", body: "", url: "/admin" };
  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/images/icon-192.png",
      badge: "/images/icon-192.png",
      data: { url: data.url || "/admin" },
      vibrate: [200, 100, 200],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/admin";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
