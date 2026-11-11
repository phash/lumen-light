/**
 * Sync-Test: stellt sicher, dass die GLSL-Konstanten in shaders.ts
 * mit den TS-Konstanten in mask.ts und lens.ts uebereinstimmen.
 * Drift-Detector — schlaegt zu, wenn jemand eine Seite erhoeht ohne
 * die andere mitzuziehen.
 */
import { describe, expect, it } from "vitest";

import {
  HSL_CHANNELS,
  HSL_HUE_GAIN,
  HSL_LUM_GAIN,
  HSL_SIGMA,
  LOCAL_CONTRAST_GAIN,
} from "../src/editor/adjustments";
import { DISTORTION_GAIN, TCA_GAIN, VIGNETTE_GAIN } from "../src/editor/lens";
import { MAX_LINEAR_MASKS, MAX_RADIAL_MASKS } from "../src/editor/mask";
import { FRAG_SRC } from "../src/editor/shaders";
import { TONEMAP_GLSL_CONSTANTS } from "../src/editor/tonemap";

// H1: Snapshot des PV1-Tonblocks (Schritte 4-6) aus main() vor H1. Der
// Block lebt jetzt in toneProcessV1() und muss textgleich bleiben, sonst
// aendern bestehende Edits/Presets ihr Aussehen.
const PV1_BLOCK_SNAPSHOT = `  // 4. Linear -> sRGB fuer perzeptive Tonwertarbeit
  vec3 c = linearToSrgb(lin);
  c = clamp(c, 0.0, 2.0);

  // 5. Tonwertbereiche via Luminanz-Masken
  float L = luminance(c);
  float shadowMask    = smoothstep(0.55, 0.0, L);
  float highlightMask = smoothstep(0.45, 1.0, L);
  float blackMask     = smoothstep(0.25, 0.0, L);
  float whiteMask     = smoothstep(0.75, 1.0, L);
  c += u_shadows    * 0.30 * shadowMask;
  c += u_highlights * 0.30 * highlightMask;
  c += u_blacks     * 0.25 * blackMask;
  c += u_whites     * 0.25 * whiteMask;

  // 6. Kontrast um 0.5
  c = (c - 0.5) * (1.0 + effContrast) + 0.5;
  c = clamp(c, 0.0, 1.0);
`;

describe("Shader-Limits-Sync", () => {
  it("MAX_LINEAR_MASKS in FRAG_SRC matched mask.ts", () => {
    const m = FRAG_SRC.match(/const int MAX_LINEAR_MASKS = (\d+)/);
    expect(m, "FRAG_SRC sollte MAX_LINEAR_MASKS deklarieren").not.toBeNull();
    expect(Number(m![1])).toBe(MAX_LINEAR_MASKS);
  });

  it("MAX_RADIAL_MASKS in FRAG_SRC matched mask.ts", () => {
    const m = FRAG_SRC.match(/const int MAX_RADIAL_MASKS = (\d+)/);
    expect(m, "FRAG_SRC sollte MAX_RADIAL_MASKS deklarieren").not.toBeNull();
    expect(Number(m![1])).toBe(MAX_RADIAL_MASKS);
  });

  it("DISTORTION_GAIN in FRAG_SRC matched lens.ts", () => {
    const m = FRAG_SRC.match(/const float DISTORTION_GAIN = ([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(DISTORTION_GAIN, 5);
  });

  it("VIGNETTE_GAIN in FRAG_SRC matched lens.ts", () => {
    const m = FRAG_SRC.match(/const float VIGNETTE_GAIN = ([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(VIGNETTE_GAIN, 5);
  });

  it("TCA_GAIN in FRAG_SRC matched lens.ts", () => {
    const m = FRAG_SRC.match(/const float TCA_GAIN = ([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(TCA_GAIN, 5);
  });

  it("HSL_CHANNELS in FRAG_SRC matched adjustments.ts", () => {
    const m = FRAG_SRC.match(/const int HSL_CHANNELS = (\d+)/);
    expect(m, "FRAG_SRC sollte HSL_CHANNELS deklarieren").not.toBeNull();
    expect(Number(m![1])).toBe(HSL_CHANNELS.length);
  });

  it("HSL_SIGMA in FRAG_SRC matched adjustments.ts", () => {
    const m = FRAG_SRC.match(/const float HSL_SIGMA = ([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(HSL_SIGMA, 5);
  });

  it("HSL_HUE_GAIN in FRAG_SRC matched adjustments.ts", () => {
    const m = FRAG_SRC.match(/const float HSL_HUE_GAIN = ([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(HSL_HUE_GAIN, 5);
  });

  it("HSL_LUM_GAIN in FRAG_SRC matched adjustments.ts", () => {
    const m = FRAG_SRC.match(/const float HSL_LUM_GAIN = ([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(HSL_LUM_GAIN, 5);
  });

  it("LOCAL_CONTRAST_GAIN in FRAG_SRC matched adjustments.ts", () => {
    const m = FRAG_SRC.match(/const float LOCAL_CONTRAST_GAIN = ([\d.]+)/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeCloseTo(LOCAL_CONTRAST_GAIN, 5);
  });

  for (const [name, value] of Object.entries(TONEMAP_GLSL_CONSTANTS)) {
    it(`${name} in FRAG_SRC matched tonemap.ts`, () => {
      const m = FRAG_SRC.match(new RegExp(`const float ${name} = (-?[\\d.]+);`));
      expect(m, `FRAG_SRC sollte ${name} deklarieren`).not.toBeNull();
      expect(Number(m![1])).toBeCloseTo(value, 8);
    });
  }

  it("u_processVersion ist als int-Uniform deklariert und steuert den Ton-Pfad", () => {
    expect(FRAG_SRC).toMatch(/uniform int u_processVersion;/);
    expect(FRAG_SRC).toMatch(/u_processVersion >= 2\s*\?\s*toneProcessV2\(lin, effContrast\)\s*:\s*toneProcessV1\(lin, effContrast\)/);
  });

  it("PV1-Block ist textgleich zum Stand vor H1", () => {
    const expected = `vec3 toneProcessV1(vec3 lin, float effContrast) {\n${PV1_BLOCK_SNAPSHOT}  return c;\n}`;
    expect(FRAG_SRC).toContain(expected);
  });
});
