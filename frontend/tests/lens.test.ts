import { describe, expect, it } from "vitest";

import {
  DISTORTION_GAIN,
  VIGNETTE_GAIN,
  applyDistortion,
  clampLens,
  defaultLensCorrection,
  vignetteMultiplier,
} from "../src/editor/lens";

describe("defaultLensCorrection", () => {
  it("liefert alle Werte 0", () => {
    expect(defaultLensCorrection()).toEqual({
      distortion: 0,
      vignette: 0,
      tcaR: 0,
      tcaB: 0,
    });
  });
});

describe("clampLens", () => {
  it("klemmt Werte auf [-1, 1]", () => {
    expect(
      clampLens({ distortion: 99, vignette: -99, tcaR: 5, tcaB: -5 }),
    ).toEqual({ distortion: 1, vignette: -1, tcaR: 1, tcaB: -1 });
  });
  it("laesst Werte im Bereich unveraendert", () => {
    expect(
      clampLens({ distortion: 0.5, vignette: -0.3, tcaR: 0.1, tcaB: -0.2 }),
    ).toEqual({ distortion: 0.5, vignette: -0.3, tcaR: 0.1, tcaB: -0.2 });
  });
});

describe("applyDistortion", () => {
  it("Mittelpunkt (0.5, 0.5) bleibt unveraendert", () => {
    const r = applyDistortion(0.5, 0.5, 0.7);
    expect(r.u).toBeCloseTo(0.5, 6);
    expect(r.v).toBeCloseTo(0.5, 6);
  });

  it("k1=0 ist Identitaet", () => {
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      for (const v of [0, 0.25, 0.5, 0.75, 1]) {
        const r = applyDistortion(u, v, 0);
        expect(r.u).toBeCloseTo(u, 6);
        expect(r.v).toBeCloseTo(v, 6);
      }
    }
  });

  it("k1>0 dehnt nach aussen — Eckpunkt wandert ueber 1.0 hinaus", () => {
    // Bei (0,0) ist r²=0.5, k1=0.4: factor = 1 + 0.4*0.5 = 1.2
    // c=(-0.5,-0.5) wird zu (-0.6,-0.6), src_uv=(-0.1,-0.1)
    const r = applyDistortion(0, 0, 1);
    expect(r.u).toBeCloseTo(-0.5 * (1 + DISTORTION_GAIN * 0.5) + 0.5, 6);
    expect(r.v).toBeCloseTo(-0.5 * (1 + DISTORTION_GAIN * 0.5) + 0.5, 6);
  });
});

describe("vignetteMultiplier", () => {
  it("ist 1.0 in der Mitte unabhaengig vom v-Wert", () => {
    expect(vignetteMultiplier(0.5, 0.5, 0)).toBeCloseTo(1, 6);
    expect(vignetteMultiplier(0.5, 0.5, 0.5)).toBeCloseTo(1, 6);
    expect(vignetteMultiplier(0.5, 0.5, -0.5)).toBeCloseTo(1, 6);
  });

  it("v>0 hellt Ecken auf, v<0 dunkelt sie ab", () => {
    // r² in den Ecken = 0.5
    const corner = vignetteMultiplier(0, 0, 0.5);
    expect(corner).toBeCloseTo(1 + 0.5 * VIGNETTE_GAIN * 0.5, 6);
    const corner_neg = vignetteMultiplier(0, 0, -0.5);
    expect(corner_neg).toBeCloseTo(1 - 0.5 * VIGNETTE_GAIN * 0.5, 6);
  });
});

describe("clampLens NaN-Guard", () => {
  it("nicht-finite/defekte Werte werden zu 0 (neutral, kein NaN)", () => {
    const garbage = {
      distortion: NaN,
      vignette: undefined,
      tcaR: "x",
      tcaB: null,
    } as unknown as Parameters<typeof clampLens>[0];
    const r = clampLens(garbage);
    for (const v of [r.distortion, r.vignette, r.tcaR, r.tcaB]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(r.distortion).toBe(0);
  });
});
