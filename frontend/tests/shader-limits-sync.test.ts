/**
 * Sync-Test: stellt sicher, dass die GLSL-Konstanten in shaders.ts
 * mit den TS-Konstanten in mask.ts und lens.ts uebereinstimmen.
 * Drift-Detector — schlaegt zu, wenn jemand eine Seite erhoeht ohne
 * die andere mitzuziehen.
 */
import { describe, expect, it } from "vitest";

import { DISTORTION_GAIN, VIGNETTE_GAIN } from "../src/editor/lens";
import { MAX_LINEAR_MASKS, MAX_RADIAL_MASKS } from "../src/editor/mask";
import { FRAG_SRC } from "../src/editor/shaders";

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
});
