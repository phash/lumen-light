/**
 * Histogramm-Bins-Berechnung — pure function, in Tests gegen
 * Beispiel-Pixeldaten verifizierbar.
 */

export interface HistogramBins {
  readonly r: Uint32Array;
  readonly g: Uint32Array;
  readonly b: Uint32Array;
  readonly max: number;
}

export const HISTOGRAM_BIN_COUNT = 64;

/**
 * Berechnet RGB-Histogramme aus RGBA-Pixeldaten (z. B. ImageData.data).
 * Each pixel = 4 Bytes (RGBA). Verteilt auf binCount-Buckets per Channel,
 * gibt zusaetzlich das maximale Bin-Count fuer Skalierung zurueck.
 */
export function computeHistogram(
  data: Uint8ClampedArray | Uint8Array,
  binCount: number = HISTOGRAM_BIN_COUNT,
): HistogramBins {
  if (binCount <= 0 || binCount > 256) {
    throw new Error(`binCount muss in (0, 256] liegen, war ${binCount}`);
  }
  if (data.length % 4 !== 0) {
    throw new Error("Pixel-Daten muessen ein Vielfaches von 4 (RGBA) sein");
  }

  const r = new Uint32Array(binCount);
  const g = new Uint32Array(binCount);
  const b = new Uint32Array(binCount);
  const shift = 256 / binCount;

  for (let i = 0; i < data.length; i += 4) {
    const ri = Math.min(binCount - 1, Math.floor(data[i]! / shift));
    const gi = Math.min(binCount - 1, Math.floor(data[i + 1]! / shift));
    const bi = Math.min(binCount - 1, Math.floor(data[i + 2]! / shift));
    r[ri]! += 1;
    g[gi]! += 1;
    b[bi]! += 1;
  }

  let max = 0;
  for (let i = 0; i < binCount; i += 1) {
    if (r[i]! > max) max = r[i]!;
    if (g[i]! > max) max = g[i]!;
    if (b[i]! > max) max = b[i]!;
  }

  return { r, g, b, max: max || 1 };
}
