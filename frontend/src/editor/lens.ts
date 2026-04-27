/**
 * Mathematik fuer Objektiv-Korrektur — Distortion (Brown-Conrady 1-Term)
 * und Vignette. Pure functions, identisch zu der GLSL-Implementierung im
 * Fragment-Shader, sodass Tests und Shader synchron bleiben koennen.
 */

export interface LensCorrection {
  readonly distortion: number; // -1..+1
  readonly vignette: number;   // -1..+1
}

export const defaultLensCorrection = (): LensCorrection => ({
  distortion: 0,
  vignette: 0,
});

/** Skalierungsfaktor fuer k1 in der Brown-Conrady-Formel. */
export const DISTORTION_GAIN = 0.4;

/** Skalierungsfaktor fuer den Vignette-Effekt. */
export const VIGNETTE_GAIN = 2.0;

export function clampLens(c: LensCorrection): LensCorrection {
  return {
    distortion: Math.max(-1, Math.min(1, c.distortion)),
    vignette: Math.max(-1, Math.min(1, c.vignette)),
  };
}

/**
 * Brown-Conrady 1-Term Distortion im UV-Space.
 * Eingabe + Ausgabe sind UV-Koordinaten in [0, 1] (theoretisch — ausserhalb
 * werden sie ueber CLAMP_TO_EDGE im Sampler abgefangen).
 */
export function applyDistortion(
  u: number,
  v: number,
  distortion: number,
): { u: number; v: number } {
  const cu = u - 0.5;
  const cv = v - 0.5;
  const r2 = cu * cu + cv * cv;
  const k1 = distortion * DISTORTION_GAIN;
  const factor = 1 + k1 * r2;
  return { u: cu * factor + 0.5, v: cv * factor + 0.5 };
}

/**
 * Vignette-Multiplikator pro UV-Position.
 * 1.0 in der Mitte; an den Ecken: 1 + vignette * VIGNETTE_GAIN * r².
 * Positive Werte hellen die Ecken auf (Korrektur), negative dunkeln sie ab.
 */
export function vignetteMultiplier(
  u: number,
  v: number,
  vignette: number,
): number {
  const cu = u - 0.5;
  const cv = v - 0.5;
  const r2 = cu * cu + cv * cv;
  return 1 + vignette * VIGNETTE_GAIN * r2;
}
