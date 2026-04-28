/**
 * Vereinfachte Lensfun-Auto-Detection.
 *
 * libraw-wasm liefert keinen Lens-Namen — nur Camera-Make/Model und
 * focal_len. Lookup matcht daher auf (Make exakt, Model substring,
 * optional Focal-Range). k1 ist der Brown-Conrady 1-Term, vignette
 * der Slider-Wert.
 */
import profilesData from "../../../infra/lensfun/profiles.json";
import { DISTORTION_GAIN, type LensCorrection } from "./lens";

export interface LensProfile {
  readonly id: string;
  readonly make: string;
  readonly modelMatch: string;
  readonly focalMin?: number;
  readonly focalMax?: number;
  readonly k1: number;
  readonly vignette: number;
  readonly comment?: string;
}

export interface LensProfileBundle {
  readonly version: number;
  readonly profiles: ReadonlyArray<LensProfile>;
}

const DATA = profilesData as unknown as LensProfileBundle;
export const PROFILES: ReadonlyArray<LensProfile> = DATA.profiles;

export type LookupReason = "matched" | "no-make" | "no-model" | "no-match";

export interface LookupResult {
  readonly profile: LensProfile | null;
  readonly reason: LookupReason;
}

export function findLensProfile(
  make: string | null | undefined,
  model: string | null | undefined,
  focalLen: number | null | undefined,
  profiles: ReadonlyArray<LensProfile> = PROFILES,
): LookupResult {
  if (!make) return { profile: null, reason: "no-make" };
  if (!model) return { profile: null, reason: "no-model" };

  const m = make.toLowerCase();
  const mod = model.toLowerCase();
  const focal = typeof focalLen === "number" ? focalLen : null;

  for (const p of profiles) {
    if (p.make.toLowerCase() !== m) continue;
    if (!mod.includes(p.modelMatch.toLowerCase())) continue;
    if (p.focalMin !== undefined && focal !== null && focal < p.focalMin) continue;
    if (p.focalMax !== undefined && focal !== null && focal > p.focalMax) continue;
    return { profile: p, reason: "matched" };
  }
  return { profile: null, reason: "no-match" };
}

/**
 * Profil → LensCorrection-Slider-Werte.
 * k1 ist der GLSL-Wert in der Brown-Conrady-Formel; der Slider zeigt
 * `distortion = k1 / DISTORTION_GAIN` an.
 */
export function profileToCorrection(profile: LensProfile): LensCorrection {
  return {
    distortion: Math.max(-1, Math.min(1, profile.k1 / DISTORTION_GAIN)),
    vignette: Math.max(-1, Math.min(1, profile.vignette)),
    // Phase G3: TCA-Werte sind heute nicht in `infra/lensfun/profiles.json`
    // — Default 0, der User stellt manuell ein. Migration auf die volle
    // Lensfun-DB mit Stuetzstellen ist Phase G4 (Backlog).
    tcaR: 0,
    tcaB: 0,
  };
}
