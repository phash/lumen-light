/**
 * H2b: Ansicht der Bibliothek (Raster/Liste), pro Browser gemerkt.
 *
 * Gleiches Muster wie consent.ts: Modul-Level-Cache ist die primaere
 * Wahrheit, localStorage nur Sync-Backup (in vitest/jsdom unzuverlaessig,
 * im privaten Modus evtl. gar nicht verfuegbar).
 */

export type LibraryView = "grid" | "list";

const STORAGE_KEY = "lumen.library.view";

let cachedView: LibraryView = (() => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
})();

export function getLibraryView(): LibraryView {
  return cachedView;
}

export function setLibraryView(view: LibraryView): void {
  cachedView = view;
  try {
    if (view === "grid") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    /* localStorage unverfuegbar — Modul-Cache gilt fuer diese Sitzung */
  }
}
