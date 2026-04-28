// Lumen Service-Worker — Stale-While-Revalidate fuer Same-Origin-GET,
// Network-Only fuer /api/, /auth/. Runtime-Cache statt Build-time-Manifest:
// Lumen-Assets haben Hash-Filenames, neue Builds liefern andere URLs ->
// alte Cache-Eintraege werden bei naechstem Online-Besuch ueberschrieben
// und sind unschaedlich (anderer Hash != Konflikt).
//
// Bewusst nicht via vite-plugin-pwa: keine Build-Time-Manifest-Magie,
// kein extra Dependency-Bundle. Wenn der User komplett offline ist und
// die App-Shell noch nie online geladen hat, gibt's eine Browser-Default-
// Fehlerseite — das ist akzeptabel im Selfhost-Use-Case.

const CACHE_VERSION = "lumen-v1";
const RUNTIME = `${CACHE_VERSION}-runtime`;

self.addEventListener("install", (event) => {
  // Sofort aktivieren, alten SW abloesen.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Veraltete Versionen aufraeumen.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // API + Auth: Network-only, niemals cachen (Tokens, dynamische Daten).
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    return;
  }

  // Navigation (HTML): Network-First mit Cache-Fallback fuer Offline.
  const isNavigation = req.mode === "navigate";

  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(req);
      const networkPromise = fetch(req)
        .then((res) => {
          // Nur OK-Antworten in den Cache.
          if (res.ok && res.type === "basic") {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        })
        .catch(() => null);

      if (isNavigation) {
        // Online bevorzugen, offline Cache.
        const fresh = await networkPromise;
        if (fresh) return fresh;
        return cached || new Response("Offline", { status: 503 });
      }

      // Statics: Cache-First mit Background-Refresh (stale-while-revalidate).
      if (cached) {
        // Refresh im Hintergrund, return Cache sofort.
        void networkPromise;
        return cached;
      }
      const fresh = await networkPromise;
      return fresh || new Response("Offline", { status: 503 });
    })(),
  );
});
