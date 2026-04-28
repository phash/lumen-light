/**
 * Consent-Toggles fuer optionale Features mit Datenschutz-Implikation.
 *
 * Aktuell:
 *   - faceDetection: TF.js-Modell wird vom Google-CDN geladen ->
 *     Drittlandtransfer (USA), DSGVO Art. 49 Abs. 1 lit. a setzt
 *     ausdrueckliche Einwilligung voraus. Default `false`.
 *
 * Persistenz: localStorage. Modul-Level-Cache haelt den Wert
 * synchron, damit `isFaceDetectionConsented()` deterministisch ist
 * (auch wenn Test-Umgebungen mit eigenen jsdom-Storage-Quirks
 * nicht stabil zurueckschreiben).
 */

const STORAGE_KEY = "lumen.consent.faceDetection";

let cachedConsent: boolean = (() => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
})();

export function isFaceDetectionConsented(): boolean {
  return cachedConsent;
}

export function setFaceDetectionConsent(consented: boolean): void {
  cachedConsent = consented;
  try {
    if (consented) {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* localStorage unverfuegbar — Default-aus bleibt aktiv */
  }
}
