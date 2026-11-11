/**
 * H1 · Szenenbezogene Tonabbildung (Prozessversion 2).
 *
 * Single Source fuer die PV2-Konstanten (Knie, Schulter, Gains, Pivot) —
 * der Fragment-Shader in shaders.ts traegt dieselben Werte als GLSL-
 * Literale, der Sync-Test (tests/shader-limits-sync.test.ts) prueft beide
 * Seiten gegeneinander.
 *
 * Zusaetzlich enthaelt das Modul eine reine TS-Referenz der Ton-Stufe
 * (Weissabgleich, Belichtung, Tonbereiche, Kontrast, Display-Transform)
 * fuer PV1 und PV2. jsdom hat kein WebGL, deshalb laufen die Abnahme-Tests
 * gegen diese Referenz (Muster wie autoStraighten.ts). Die Referenz MUSS
 * Schritt fuer Schritt dem Shader entsprechen.
 *
 * Idee (darktable-Recherche, nur veroeffentlichte Mathematik, kein Code):
 * Tonarbeit auf linearem Licht als Belichtungs-Gains im Log-Raum, Kontrast
 * um Mittelgrau, erst am Ende eine weiche Schulter auf max(r,g,b) mit
 * Entsaettigung Richtung Weiss ("path to white").
 */
import type { ProcessVersion } from "./adjustments";

/** Mittelgrau (linear) — Pivot fuer Log-Belichtung und Kontrast. */
export const TM_PIVOT = 0.18;
/** Untergrenze der Luminanz vor log2 (vermeidet -inf bei Schwarz). */
export const TM_EPS = 0.00001;
/** Knie der Schulter (linear). Darunter ist f die Identitaet. */
export const TM_KNEE = 0.955;
/** Exponent des Schulter-Auslaufs. Kleiner = laengerer Auslauf ueber 1.0. */
export const TM_TAIL = 0.3;
/** Ab Norm 1.0 (Sensor-Weiss) laeuft die Entsaettigung ueber so viele
 *  Blendenstufen von 0 auf 1 ("path to white"). */
export const TM_PTW_EV = 5.0;

// Tonbereich-Masken im Log-Raum: ev = log2(Y / TM_PIVOT). Sensor-Weiss
// (Y = 1) liegt bei ev ~ +2.47, ein 8-bit-Code ueber Schwarz bei ~ -9.5.
// Die Masken sind weiche Rampen (smoothstep) zwischen LO und HI; Tiefen
// und Schwarz fallen nach oben ab, Lichter und Weiss steigen an.
// GAIN = Blendenstufen bei Regler +-1 und voller Maske.
export const TM_SHADOWS_GAIN = 2.5;
export const TM_SHADOWS_LO = -3.0;
export const TM_SHADOWS_HI = 0.5;
export const TM_HIGHLIGHTS_GAIN = 1.5;
export const TM_HIGHLIGHTS_LO = -0.5;
export const TM_HIGHLIGHTS_HI = 2.5;
export const TM_BLACKS_GAIN = 2.0;
export const TM_BLACKS_LO = -4.5;
export const TM_BLACKS_HI = -1.5;
export const TM_WHITES_GAIN = 1.0;
export const TM_WHITES_LO = 1.0;
export const TM_WHITES_HI = 3.0;

/** Alle Konstanten, die als `const float NAME = WERT;` im GLSL stehen
 *  muessen. Der Sync-Test iteriert darueber. */
export const TONEMAP_GLSL_CONSTANTS: Readonly<Record<string, number>> = {
  TM_PIVOT,
  TM_EPS,
  TM_KNEE,
  TM_TAIL,
  TM_PTW_EV,
  TM_SHADOWS_GAIN,
  TM_SHADOWS_LO,
  TM_SHADOWS_HI,
  TM_HIGHLIGHTS_GAIN,
  TM_HIGHLIGHTS_LO,
  TM_HIGHLIGHTS_HI,
  TM_BLACKS_GAIN,
  TM_BLACKS_LO,
  TM_BLACKS_HI,
  TM_WHITES_GAIN,
  TM_WHITES_LO,
  TM_WHITES_HI,
};

export type Rgb = readonly [number, number, number];

/** Regler, die die Ton-Stufe beeinflussen (global + Masken-Anteil bereits
 *  aufaddiert, wie effExposure/effContrast/effTemperature im Shader). */
export interface ToneParams {
  readonly exposure: number;
  readonly contrast: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly whites: number;
  readonly blacks: number;
  readonly temperature: number;
  readonly tint: number;
}

export const NEUTRAL_TONE_PARAMS: ToneParams = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
};

export function srgbToLinear(c: number): number {
  return c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(c: number): number {
  const v = Math.max(c, 0);
  return v < 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** GLSL-smoothstep (edge0 < edge1). */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function luminance(c: Rgb): number {
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Schulter-Kurve f (linear -> linear, Display-Bereich [0,1)).
 *
 *   f(x) = x                                         fuer x <= k
 *   f(x) = 1 - w * (1 + (x - k) / (q * w))^(-q)      fuer x >  k, w = 1 - k
 *
 * Stetig und stetig differenzierbar im Knie (Steigung 1), monoton steigend,
 * Asymptote 1. Der Potenz-Auslauf (q < 1) faellt langsamer als Reinhard
 * (q = 1), damit +2/+3 EV noch unterscheidbar bleiben.
 */
export function shoulder(x: number): number {
  if (x <= TM_KNEE) return Math.max(x, 0);
  const w = 1 - TM_KNEE;
  return 1 - w * Math.pow(1 + (x - TM_KNEE) / (TM_TAIL * w), -TM_TAIL);
}

/** Weissabgleich + Belichtung in linear, identisch fuer PV1 und PV2. */
function whiteBalanceAndExposure(srgb: Rgb, p: ToneParams): [number, number, number] {
  let r = srgbToLinear(srgb[0]);
  let g = srgbToLinear(srgb[1]);
  let b = srgbToLinear(srgb[2]);
  const tempK = p.temperature * 0.4;
  const tintK = p.tint * 0.3;
  r *= 1 + tempK;
  b *= 1 - tempK;
  g *= 1 + tintK;
  r *= 1 - tintK * 0.5;
  b *= 1 - tintK * 0.5;
  const e = Math.pow(2, p.exposure);
  return [Math.max(r * e, 0), Math.max(g * e, 0), Math.max(b * e, 0)];
}

/** PV1-Referenz (Shader-Schritte 4-6, unveraendert seit Phase G). */
function toneV1(lin: Rgb, p: ToneParams): Rgb {
  const c = lin.map((v) => Math.min(2, Math.max(0, linearToSrgb(v)))) as [number, number, number];
  const L = luminance(c);
  // PV1 nutzt smoothstep mit edge0 > edge1 (GLSL undefiniert, in der
  // Praxis 1 - smoothstep(edge1, edge0, x)).
  const shadowMask = 1 - smoothstep(0, 0.55, L);
  const highlightMask = smoothstep(0.45, 1, L);
  const blackMask = 1 - smoothstep(0, 0.25, L);
  const whiteMask = smoothstep(0.75, 1, L);
  const add =
    p.shadows * 0.3 * shadowMask +
    p.highlights * 0.3 * highlightMask +
    p.blacks * 0.25 * blackMask +
    p.whites * 0.25 * whiteMask;
  return c.map((v) => clamp01((v + add - 0.5) * (1 + p.contrast) + 0.5)) as unknown as Rgb;
}

/** Log-Belichtung relativ zu Mittelgrau. */
function evOf(lin: Rgb): number {
  return Math.log2(Math.max(luminance(lin), TM_EPS) / TM_PIVOT);
}

/** Summe der Tonbereich-Gains in Blendenstufen fuer einen ev-Wert. */
export function toneRangeEv(ev: number, p: ToneParams): number {
  return (
    p.shadows * TM_SHADOWS_GAIN * (1 - smoothstep(TM_SHADOWS_LO, TM_SHADOWS_HI, ev)) +
    p.highlights * TM_HIGHLIGHTS_GAIN * smoothstep(TM_HIGHLIGHTS_LO, TM_HIGHLIGHTS_HI, ev) +
    p.blacks * TM_BLACKS_GAIN * (1 - smoothstep(TM_BLACKS_LO, TM_BLACKS_HI, ev)) +
    p.whites * TM_WHITES_GAIN * smoothstep(TM_WHITES_LO, TM_WHITES_HI, ev)
  );
}

/** Display-Transform: Schulter auf max(r,g,b) + Entsaettigung Richtung
 *  Weiss. Eingang linear (unbegrenzt), Ausgang sRGB in [0,1]. */
export function displayTransform(lin: Rgb): Rgb {
  const n = Math.max(lin[0], lin[1], lin[2]);
  if (n <= 1e-6) return [0, 0, 0];
  const fn = shoulder(n);
  const k = fn / n;
  // Ratio-Skalierung erhaelt das Kanalverhaeltnis (Farbton). Die
  // Entsaettigung passiert im Display-Raum, dort ist sie farbtonneutral
  // (HSV-Hue ist invariant gegen Mischen mit Grau).
  const d = smoothstep(0, TM_PTW_EV, Math.log2(n));
  const white = linearToSrgb(fn);
  return lin.map((v) => {
    const s = linearToSrgb(v * k);
    return clamp01(s + (white - s) * d);
  }) as unknown as Rgb;
}

/** PV2-Referenz (Shader toneProcessV2). */
function toneV2(lin: Rgb, p: ToneParams): Rgb {
  const g = Math.pow(2, toneRangeEv(evOf(lin), p));
  const ranged: Rgb = [lin[0] * g, lin[1] * g, lin[2] * g];
  const k = Math.pow(2, evOf(ranged) * p.contrast);
  return displayTransform([ranged[0] * k, ranged[1] * k, ranged[2] * k]);
}

/**
 * Referenz der kompletten Ton-Stufe: sRGB-Eingang (0..1, wie die 8-bit-
 * Quelltextur) -> sRGB-Ausgang (0..1) vor Saettigung/HSL/Tonkurve.
 */
export function toneStage(srgb: Rgb, p: ToneParams, pv: ProcessVersion): Rgb {
  const lin = whiteBalanceAndExposure(srgb, p);
  return pv === 2 ? toneV2(lin, p) : toneV1(lin, p);
}
