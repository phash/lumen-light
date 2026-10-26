/**
 * Leert den Cache-Storage des Service-Workers (DSGVO: nach Logout bzw.
 * Account-Loeschen duerfen keine Inhalte des Users im Browser liegen).
 * Best-effort — Fehler (fehlende API, SecurityError) blockieren den
 * Logout nicht.
 */
export async function clearOfflineCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    /* best-effort */
  }
}
