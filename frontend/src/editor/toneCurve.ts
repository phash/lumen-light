/**
 * Tonkurven-Helpers (E2). LUT-Berechnung mit Monotone Cubic Hermite
 * (Fritsch-Carlson) — interpoliert durch alle Stuetzpunkte und vermeidet
 * Overshoot bei monotonen Datensaetzen, was bei Tonkurven der
 * Standardfall ist.
 */
import type { ToneCurve, ToneCurvePoint } from "./adjustments";

export const TONE_CURVE_LUT_SIZE = 256;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Berechnet die Tangenten m_i nach Fritsch-Carlson — monotone, kein
 * Overshoot zwischen Punkten gleicher Richtung.
 */
function tangents(points: ReadonlyArray<ToneCurvePoint>): Float64Array {
  const n = points.length;
  const m = new Float64Array(n);
  if (n < 2) return m;

  // Sekantensteigungen
  const d = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1]!.x - points[i]!.x;
    d[i] = dx > 1e-9 ? (points[i + 1]!.y - points[i]!.y) / dx : 0;
  }

  // Initiale Tangenten = Mittel der angrenzenden Sekanten
  m[0] = d[0]!;
  m[n - 1] = d[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1]! + d[i]!) / 2;

  // Fritsch-Carlson Korrektur fuer Monotonie
  for (let i = 0; i < n - 1; i++) {
    const dk = d[i]!;
    if (Math.abs(dk) < 1e-9) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / dk;
    const b = m[i + 1]! / dk;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * dk;
      m[i + 1] = t * b * dk;
    }
  }
  return m;
}

// WeakMap-Cache: Tangenten pro Curve-Objekt einmal berechnen.
// Hot-Path-Perf — `evaluateToneCurve` wird im UI z.B. 50x pro Render
// aufgerufen (Sample-Polyline im SVG), `tangents(pts)` ist O(n) mit
// Float-Arithmetik. Cache wird automatisch GC'd, sobald die Kurve
// keine Referenz mehr hat (Store baut bei jeder Aenderung neue
// Curve-Objekte).
const tangentCache = new WeakMap<ToneCurve, Float64Array>();

function tangentsCached(curve: ToneCurve): Float64Array {
  let m = tangentCache.get(curve);
  if (!m) {
    m = tangents(curve.points);
    tangentCache.set(curve, m);
  }
  return m;
}

/**
 * Wertet die Kurve an Stelle x ∈ [0,1] aus. Vor dem ersten und nach dem
 * letzten Punkt wird auf den jeweiligen Endpunkt geklemmt.
 */
export function evaluateToneCurve(curve: ToneCurve, x: number): number {
  const pts = curve.points;
  if (pts.length === 0) return clamp01(x);
  if (x <= pts[0]!.x) return clamp01(pts[0]!.y);
  if (x >= pts[pts.length - 1]!.x) return clamp01(pts[pts.length - 1]!.y);

  // Segment finden
  let i = 0;
  while (i < pts.length - 1 && pts[i + 1]!.x < x) i++;
  const p0 = pts[i]!;
  const p1 = pts[i + 1]!;
  const h = p1.x - p0.x;
  if (h < 1e-9) return clamp01(p0.y);

  const m = tangentsCached(curve);
  const t = (x - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  // Hermite-Basis
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const y = h00 * p0.y + h10 * h * m[i]! + h01 * p1.y + h11 * h * m[i + 1]!;
  return clamp01(y);
}

/**
 * Praeberechnete LUT (256 Eintraege Uint8) fuer den Pixel-Shader.
 * lut[i] = round(evaluate(i/255) * 255).
 */
export function computeToneCurveLut(curve: ToneCurve): Uint8Array {
  const lut = new Uint8Array(TONE_CURVE_LUT_SIZE);
  // Tangenten einmal berechnen, dann iterativ Segment-Index fuehren —
  // schneller als evaluate pro i, wenn curve viele Punkte hat.
  const m = tangents(curve.points);
  let seg = 0;
  for (let i = 0; i < TONE_CURVE_LUT_SIZE; i++) {
    const x = i / (TONE_CURVE_LUT_SIZE - 1);
    while (
      seg < curve.points.length - 2 &&
      curve.points[seg + 1]!.x < x
    ) {
      seg++;
    }
    let y: number;
    if (x <= curve.points[0]!.x) {
      y = curve.points[0]!.y;
    } else if (x >= curve.points[curve.points.length - 1]!.x) {
      y = curve.points[curve.points.length - 1]!.y;
    } else {
      const p0 = curve.points[seg]!;
      const p1 = curve.points[seg + 1]!;
      const h = p1.x - p0.x;
      const t = h > 1e-9 ? (x - p0.x) / h : 0;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      y = h00 * p0.y + h10 * h * m[seg]! + h01 * p1.y + h11 * h * m[seg + 1]!;
    }
    lut[i] = Math.max(0, Math.min(255, Math.round(clamp01(y) * 255)));
  }
  return lut;
}
