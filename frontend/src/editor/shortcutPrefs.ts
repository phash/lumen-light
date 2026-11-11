/**
 * Nutzer-Einstellung fuer Einzeltasten-Shortcuts (Editor: 0, R, P, \, +, -, ?;
 * Bibliothek/Lupe, H2c: 0-9, P, X, U, E, C, Enter, ?).
 *
 * WCAG 2.1.4 (Character Key Shortcuts, Level A): Shortcuts aus einem
 * einzelnen Zeichen muessen abschaltbar sein. Kombinationen mit
 * Strg/Cmd (Undo, Export, ...) bleiben davon unberuehrt.
 *
 * Persistenz wie consent.ts: Modul-Cache als primaere Wahrheit,
 * localStorage als Sync-Backup. Default: aktiv.
 */

const STORAGE_KEY = "lumen.shortcuts.singleKey";

let cachedEnabled: boolean = (() => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
})();

export function getSingleKeyShortcutsEnabled(): boolean {
  return cachedEnabled;
}

export function setSingleKeyShortcutsEnabled(enabled: boolean): void {
  cachedEnabled = enabled;
  try {
    if (enabled) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, "0");
    }
  } catch {
    /* localStorage unverfuegbar — Modul-Cache bleibt gueltig */
  }
}
