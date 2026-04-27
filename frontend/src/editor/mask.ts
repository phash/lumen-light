/**
 * Maskenberechnung für lokale Anpassungen. Pure functions, deren
 * Verhalten 1:1 zum GLSL-Code im FRAG_SRC passt — Tests verifizieren
 * Maskenfaktoren gegen Referenzpunkte und decken so indirekt den
 * Shader-Code mit ab.
 */

export interface PointUv {
  readonly u: number;
  readonly v: number;
}

export interface LinearMask {
  readonly type: "linear";
  readonly p1: PointUv;
  readonly p2: PointUv;
  readonly feather: number;
}

export interface LocalAdjustments {
  readonly exposure: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly temperature: number;
}

export const defaultLocalAdjustments = (): LocalAdjustments => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
});

export const defaultLinearMask = (): LinearMask => ({
  type: "linear",
  p1: { u: 0.5, v: 0 },
  p2: { u: 0.5, v: 1 },
  feather: 0.4,
});

export const LOCAL_ADJUSTMENT_LIMITS: Record<keyof LocalAdjustments, [number, number]> = {
  exposure: [-3, 3],
  contrast: [-1, 1],
  saturation: [-1, 1],
  temperature: [-1, 1],
};

export function clampLocalAdjustment(
  key: keyof LocalAdjustments,
  value: number,
): number {
  const [min, max] = LOCAL_ADJUSTMENT_LIMITS[key];
  if (Number.isNaN(value)) return 0;
  return Math.max(min, Math.min(max, value));
}

export function clampUv(uv: PointUv): PointUv {
  return {
    u: Math.max(0, Math.min(1, uv.u)),
    v: Math.max(0, Math.min(1, uv.v)),
  };
}

export function clampFeather(f: number): number {
  return Math.max(0, Math.min(1, f));
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Maskenfaktor an UV-Position fuer eine lineare Maske.
 *
 * @returns 0..1: 0 = ausserhalb (vor p1), 1 = innerhalb (nach p2),
 * dazwischen: smoothstep mit Feather-Breite.
 */
export function computeLinearMaskFactor(
  mask: LinearMask,
  uv: PointUv,
): number {
  const dx = mask.p2.u - mask.p1.u;
  const dy = mask.p2.v - mask.p1.v;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return 0;

  const t = ((uv.u - mask.p1.u) * dx + (uv.v - mask.p1.v) * dy) / len2;
  const halfFeather = Math.max(0.001, mask.feather * 0.5);
  return smoothstep(0.5 - halfFeather, 0.5 + halfFeather, t);
}
