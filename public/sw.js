/**
 * Aegis Share service worker — offline-first app shell.
 *
 * Strategies:
 *   - Navigation requests (HTML pages): network-first, fall back to cached
 *     `/index.html` when offline. This keeps the live version fresh while
 *     still serving a working shell offline.
 *   - _next/static/* (content-hashed chunks, CSS, fonts): cache-first with
 *     background revalidation (stale-while-revalidate). These URLs are
 *     immutable, so the cached copy is always safe to use.
 *   - Other same-origin GETs (robots.txt, 404, etc.): stale-while-revalidate.
 *   - /api/* (Cloudflare Pages Function — Download Booster): never cached,
 *     always hits the network. The booster is a proxy; caching its
 *     responses would break Range requests and serve stale upstream data.
 *
 * Cross-origin requests are passed through untouched (the SW only acts as
 * a transparent pass-through so the page can still fetch external URLs).
 *
 * Cache versioning: bump CACHE_VERSION when the SW logic itself changes.
 * Content-hashed asset URLs handle their own invalidation, so day-to-day
 * deploys don't need a version bump.
 */

const CACHE_VERSION = "v5";
const SHELL_CACHE = `aegis-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `aegis-runtime-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/index.html",
  "/robots.txt",
  "/404.html",
  "/favicon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // allSettled: install still succeeds if the user is offline at install
      // time (precaching is best-effort; runtime caching fills the gaps).
      await Promise.allSettled(PRECACHE_URLS.map((u) => cache.add(u)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(`aegis-`) || (k !== SHELL_CACHE && k !== RUNTIME_CACHE))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Cross-origin: pass through untouched.
  if (url.origin !== self.location.origin) return;

  // Never intercept the booster Function — it's a network proxy.
  if (url.pathname.startsWith("/api/")) return;

  // Don't intercept the service worker itself (or its source maps).
  if (url.pathname === "/sw.js" || url.pathname === "/sw.js.map") return;

  // Navigations (HTML page loads): network-first, cache fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          // Cache a copy so the next offline visit has the latest shell.
          const copy = fresh.clone();
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(request, copy);
          return fresh;
        } catch {
          // Offline: serve the exact cached page if we have it,
          // otherwise fall back to the precached index.
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match("/index.html");
          if (shell) return shell;
          return new Response(
            "<h1>Aegis Share is offline</h1><p>Open the page once online to cache it for offline use.</p>",
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
    return;
  }

  // _next/static/* — content-hashed immutable assets (JS/CSS/fonts).
  // Stale-while-revalidate: serve cache immediately, refresh in background.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.status === 200) {
              const copy = response.clone();
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      })()
    );
    return;
  }

  // Everything else same-origin: stale-while-revalidate.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })()
  );
});

// Allow the page to trigger an immediate update (skipWaiting + claim).
self.addEventListener("message", (event) => {
  if (event.data === "aegis-skip-waiting") self.skipWaiting();
});
