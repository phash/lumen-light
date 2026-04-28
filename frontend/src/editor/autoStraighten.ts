/**
 * Auto-Straighten (E5).
 *
 * Algorithmus:
 *   1. Bild auf 256x256 skaliert (vom Aufrufer mit OffscreenCanvas
 *      vorbereitet — die Analyse selbst liest nur den Pixel-Buffer)
 *   2. Sobel-Magnitude + Gradient-Richtung pro Pixel
 *   3. Kantenrichtung = Gradient + 90 Grad (mod 180)
 *   4. Mod 90 Grad zur naechsten Achse (vertikal/horizontal),
 *      Verschiebung in [-45, +45]
 *   5. Nur Kanten mit Tilt in [-MAX, +MAX] zaehlen, mit Magnitude
 *      gewichtet in 0.5-Grad-Bins eintragen
 *   6. Bin mit hoechstem geglaetteten Vote-Score = dominante Tilt-
 *      Richtung. Negierter Wert = Korrektur-Winkel.
 *
 * Das ist eine vereinfachte Hough-Transform — wir voten nur ueber den
 * Winkel, nicht ueber die rho-Achse, weil die globale Orientierung
 * reicht.
 */

export const ANALYSIS_SIZE = 256;
export const MAX_TILT_DEG = 10;
export const BIN_DEG = 0.5;
export const BIN_COUNT = Math.round((2 * MAX_TILT_DEG) / BIN_DEG); // 40
const SOBEL_MIN_MAGNITUDE = 0.04;

export interface StraightenResult {
  readonly angleRad: number;     // signed, in radian — direkt setStraightenAngle-tauglich
  readonly confidence: number;   // 0..1, höher = klarer Peak im Hough-Vote
  readonly edgePixels: number;   // Anzahl beruecksichtigter Kanten-Samples
}

/**
 * Pure Analyse-Funktion: erwartet einen RGBA-Buffer der Groesse
 * `ANALYSIS_SIZE x ANALYSIS_SIZE` (= ANALYSIS_SIZE*ANALYSIS_SIZE*4 Bytes).
 * Liefert null wenn zu wenig Kanten vorhanden sind, um eine Aussage zu
 * treffen.
 */
export function analyzeStraightenAngle(
  rgba: Uint8ClampedArray | Uint8Array,
): StraightenResult | null {
  const N = ANALYSIS_SIZE;
  if (rgba.length < N * N * 4) return null;

  // Luminanz puffern fuer schnelle Sobel-Reads.
  const lum = new Float32Array(N * N);
  for (let i = 0; i < lum.length; i++) {
    const r = rgba[i * 4]! / 255;
    const g = rgba[i * 4 + 1]! / 255;
    const b = rgba[i * 4 + 2]! / 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  const bins = new Float32Array(BIN_COUNT);
  let totalWeight = 0;
  let edgePixels = 0;

  for (let y = 1; y < N - 1; y++) {
    for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      // Sobel
      const a = lum[i - N - 1]!;
      const b2 = lum[i - N]!;
      const c = lum[i - N + 1]!;
      const d = lum[i - 1]!;
      const f = lum[i + 1]!;
      const g = lum[i + N - 1]!;
      const h = lum[i + N]!;
      const j = lum[i + N + 1]!;
      const gx = -a - 2 * d - g + c + 2 * f + j;
      const gy = -a - 2 * b2 - c + g + 2 * h + j;
      const mag = Math.sqrt(gx * gx + gy * gy);
      if (mag < SOBEL_MIN_MAGNITUDE) continue;

      // Linien-Richtung = senkrecht zum Gradienten, modulo 180°
      let aDeg = ((Math.atan2(gy, gx) + Math.PI / 2) * 180) / Math.PI;
      // Auf [-90, +90] normieren — Linien sind nicht orientiert.
      aDeg = ((aDeg + 540) % 180) - 90;
      // Tilt zur naechsten Achse: 0° = horizontal, ±90° = vertikal.
      let tilt: number;
      if (aDeg > 45) tilt = aDeg - 90;
      else if (aDeg < -45) tilt = aDeg + 90;
      else tilt = aDeg;
      if (tilt <= -MAX_TILT_DEG || tilt >= MAX_TILT_DEG) continue;

      const bin = Math.min(
        BIN_COUNT - 1,
        Math.max(0, Math.floor((tilt + MAX_TILT_DEG) / BIN_DEG)),
      );
      bins[bin]! += mag;
      totalWeight += mag;
      edgePixels++;
    }
  }

  // Schwellenwert: weniger als 200 Edge-Samples ⇒ Aussage zu unsicher.
  if (edgePixels < 200 || totalWeight < 5) return null;

  // Peak mit 1-Bin-Glaetten finden.
  let bestBin = 0;
  let bestSmoothed = -1;
  for (let b = 0; b < BIN_COUNT; b++) {
    const left = b > 0 ? bins[b - 1]! : 0;
    const right = b < BIN_COUNT - 1 ? bins[b + 1]! : 0;
    const v = bins[b]! + 0.5 * left + 0.5 * right;
    if (v > bestSmoothed) {
      bestSmoothed = v;
      bestBin = b;
    }
  }

  const tiltDeg = (bestBin + 0.5) * BIN_DEG - MAX_TILT_DEG;
  // Korrektur-Winkel: negiere, damit Anwenden den Tilt aushebelt.
  const angleRad = (-tiltDeg * Math.PI) / 180;
  // Confidence: Anteil des Peak-Bins (samt Nachbarn) am Total-Weight.
  const peakNeighbor =
    bins[bestBin]! +
    (bestBin > 0 ? bins[bestBin - 1]! : 0) +
    (bestBin < BIN_COUNT - 1 ? bins[bestBin + 1]! : 0);
  const confidence = Math.min(1, peakNeighbor / totalWeight * (BIN_COUNT / 6));
  return { angleRad, confidence, edgePixels };
}

/**
 * Liest das uebergebene Canvas auf 256x256 herunter und ruft die
 * Analyse-Funktion auf. Im Browser-Pfad nutzt der Editor diesen Helper
 * direkt; in Tests wird `analyzeStraightenAngle` mit synthetischen
 * Buffern aufgerufen, weil OffscreenCanvas in jsdom fehlt.
 */
export function analyzeCanvasStraightenAngle(
  canvas: HTMLCanvasElement,
): StraightenResult | null {
  const off = new OffscreenCanvas(ANALYSIS_SIZE, ANALYSIS_SIZE);
  const ctx = off.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE);
  const data = ctx.getImageData(0, 0, ANALYSIS_SIZE, ANALYSIS_SIZE).data;
  return analyzeStraightenAngle(data);
}
