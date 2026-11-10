// Lumen Service-Worker — Stale-While-Revalidate fuer Same-Origin-GET,
// Network-Only fuer /api/, /auth/, /lumen-images/ (private Bilder ueber
// Pre-Signed-URLs) und /config.js (Runtime-Konfig muss sofort greifen). Runtime-Cache statt Build-time-Manifest:
// Lumen-Assets haben Hash-Filenames, neue Builds liefern andere URLs ->
// alte Cache-Eintraege werden bei naechstem Online-Besuch ueberschrieben
// und sind unschaedlich (anderer Hash != Konflikt).
//
// Bewusst nicht via vite-plugin-pwa: keine Build-Time-Manifest-Magie,
// kein extra Dependency-Bundle. Wenn der User komplett offline ist und
// die App-Shell noch nie online geladen hat, gibt's eine Browser-Default-
// Fehlerseite — das ist akzeptabel im Selfhost-Use-Case.

// v2: purgt v1-Caches, die noch private Bilder (Pre-Signed-URLs) enthielten.
// v3: purgt v2-Caches mit Navigationen unter voller URL (inkl. Query/Callback).
const CACHE_VERSION = "lumen-v3";
const RUNTIME = `${CACHE_VERSION}-runtime`;
// Normalisierter Cache-Key fuer alle Navigationen (App-Shell, ohne Query).
const NAV_CACHE_KEY = "/index.html";

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
  // Bilder aus dem S3-Bucket sind privat (DSGVO: nach Logout/Account-Loeschen
  // darf nichts im Browser-Cache liegen); jede Pre-Signed-URL hat zudem eine
  // eigene Signatur, Cache-Eintraege wuerden nie wiederverwendet.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.pathname.startsWith("/lumen-images/") ||
    url.pathname === "/config.js" ||
    url.searchParams.has("X-Amz-Signature")
  ) {
    return;
  }

  // Navigation (HTML): Network-First mit Cache-Fallback fuer Offline.
  const isNavigation = req.mode === "navigate";

  // OIDC-Callback (?code=&state=) nie anfassen: weder aus dem Cache bedienen
  // noch die Antwort speichern (Auth-Parameter gehoeren nicht in Caches).
  if (isNavigation && url.pathname.startsWith("/callback")) return;

  // Navigationen NICHT pro voller URL cachen (Query traegt private IDs wie
  // ?image=<id>, jede URL waere ein eigener Eintrag): alle App-Routen teilen
  // sich EINEN normalisierten Eintrag als Offline-Shell. Die SPA routet
  // clientseitig anhand von location, die Shell passt fuer jede Route.
  const cacheKey = isNavigation ? NAV_CACHE_KEY : req;

  event.respondWith(
    (async () => {
      const cache = await caches.open(RUNTIME);
      const cached = await cache.match(cacheKey);
      const networkPromise = fetch(req)
        .then((res) => {
          // Nur OK-Antworten in den Cache.
          if (res.ok && res.type === "basic") {
            cache.put(cacheKey, res.clone()).catch(() => {});
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
