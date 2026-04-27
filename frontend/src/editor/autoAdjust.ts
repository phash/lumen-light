/**
 * Auto-Adjust-Algorithmen: Auto-Tone und Auto-WB.
 *
 * Beide lesen das aktuelle, gerenderte Canvas-Bild (Browser-Output,
 * also nach allen Adjustments) und berechnen Delta-Werte, die zu den
 * aktuellen Slidern addiert werden. Iterative Korrektur — nochmaliges
 * Anklicken rueckt naeher ans Optimum.
 */
import type { Adjustments } from "./adjustments";

// Downscale-Groesse fuer die Pixel-Analyse — bei 200x200 sind das 40k
// Pixel, was fuer Histogramm-Quantile mehr als genug ist und unter 5 ms
// auf einem typischen Laptop laeuft.
const ANALYSIS_SIZE = 200;

interface HistogramStats {
  /** Quantil 0.5 % der Luminanzverteilung. */
  readonly p005: number;
  /** Quantil 50 % (Median). */
  readonly p500: number;
  /** Quantil 99.5 %. */
  readonly p995: number;
  /** Mittelwert pro Kanal (linear-sRGB-bereinigt nicht — direkter Pixel-Mean). */
  readonly meanR: number;
  readonly meanG: number;
  readonly meanB: number;
}

function readDownscaled(canvas: HTMLCanvasElement): Uint8ClampedArray | null {
  const w = ANALYSIS_SIZE;
  const h = ANALYSIS_SIZE;
  let off: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== "undefined") {
    off = new OffscreenCanvas(w, h);
  } else {
    off = document.createElement("canvas");
    off.width = w;
    off.height = h;
  }
  const ctx = off.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

export function analyze(canvas: HTMLCanvasElement): HistogramStats | null {
  const data = readDownscaled(canvas);
  if (!data) return null;

  // Luminanz-Histogramm 256 bins (Rec. 709 weights).
  const bins = new Uint32Array(256);
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    sumR += r;
    sumG += g;
    sumB += b;
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    bins[lum]!++;
  }

  const total = n;
  const target005 = total * 0.005;
  const target500 = total * 0.5;
  const target995 = total * 0.995;
  let cum = 0;
  let p005 = 0;
  let p500 = 0;
  let p995 = 0;
  let foundLow = false;
  let foundMid = false;
  for (let i = 0; i < 256; i++) {
    cum += bins[i]!;
    if (!foundLow && cum >= target005) {
      p005 = i / 255;
      foundLow = true;
    }
    if (!foundMid && cum >= target500) {
      p500 = i / 255;
      foundMid = true;
    }
    if (cum >= target995) {
      p995 = i / 255;
      break;
    }
  }

  return {
    p005,
    p500,
    p995,
    meanR: sumR / n / 255,
    meanG: sumG / n / 255,
    meanB: sumB / n / 255,
  };
}

/**
 * Auto-Tone — leitet exposure/contrast/whites/blacks aus dem Histogramm
 * ab. Heuristik:
 *
 * - exposure: log2(0.45 / median), geklemmt auf ±1.5 EV. Bei sehr
 *   dunklem Bild (median 0.15) gibt das +1.6 EV; bei hellem (median
 *   0.7) -0.6 EV.
 * - whites: wenn p99.5 unter 0.85 ist, anheben proportional.
 * - blacks: wenn p0.5 ueber 0.15 ist, absenken.
 * - contrast: wenn Histogramm flach (p99.5 - p0.5 < 0.5), +0.15.
 *
 * Werte werden zu den aktuellen Adjustments addiert (iterativ).
 */
export function computeAutoTone(
  stats: HistogramStats,
  current: Adjustments,
): Partial<Adjustments> {
  const out: Partial<Adjustments> = {};

  // Exposure: log2(target/actual)
  const targetMedian = 0.45;
  const median = Math.max(0.02, stats.p500);
  const dExposure = Math.max(-1.5, Math.min(1.5, Math.log2(targetMedian / median)));
  out.exposure = Math.max(-5, Math.min(5, current.exposure + dExposure));

  // Whites: anheben, wenn das obere Ende fehlt
  const dWhites = stats.p995 < 0.85 ? Math.min(0.4, (0.95 - stats.p995) * 1.2) : 0;
  out.whites = Math.max(-1, Math.min(1, current.whites + dWhites));

  // Blacks: absenken, wenn das untere Ende anfaengt
  const dBlacks = stats.p005 > 0.15 ? -Math.min(0.3, (stats.p005 - 0.05) * 1.0) : 0;
  out.blacks = Math.max(-1, Math.min(1, current.blacks + dBlacks));

  // Kontrast leicht anheben, wenn der Bereich schmal ist
  const range = stats.p995 - stats.p005;
  if (range < 0.5) {
    const dContrast = (0.5 - range) * 0.5;
    out.contrast = Math.max(-1, Math.min(1, current.contrast + dContrast));
  }

  return out;
}

/**
 * Auto-WB (Gray-World): Mittelwert R/G/B sollte im neutral-grauen Bild
 * gleich sein. Aus den Mittelwerten leiten wir delta-Temperatur und
 * delta-Tint ab — gleiche Mathematik wie der manuelle Eyedropper, nur
 * dass die Farbe der gesamte Bildmittelwert ist.
 *
 * Annahme: ein typisches Foto ist im Mittel grau-toniert — fuer stark
 * monochromatische Motive (rote Wuerste, blauer Himmel) liefert das
 * falsche Ergebnisse. Dann ist der Eyedropper besser.
 */
export function computeAutoWb(
  stats: HistogramStats,
  current: Adjustments,
): Partial<Adjustments> {
  const r = stats.meanR;
  const g = stats.meanG;
  const b = stats.meanB;
  const sumRb = Math.max(0.001, r + b);
  const dTempK = (b - r) / sumRb;
  const rEff = r * (1 + dTempK);
  const bEff = b * (1 - dTempK);
  const meanRb = (rEff + bEff) / 2;
  const dTintK = meanRb / Math.max(0.001, g) - 1;

  // 0.4 / 0.3 sind die Shader-Gain-Faktoren (siehe shaders.ts „tempK"/
  // „tintK"). Synchron halten — kein Drift-Test, weil Eyedropper-Code
  // dieselben Konstanten benutzt; Drift faellt dort sofort auf.
  const dTempSlider = dTempK / 0.4;
  const dTintSlider = dTintK / 0.3;

  return {
    temperature: Math.max(-1, Math.min(1, current.temperature + dTempSlider)),
    tint: Math.max(-1, Math.min(1, current.tint + dTintSlider)),
  };
}
