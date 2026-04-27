import { describe, expect, it } from "vitest";

import {
  clampFeather,
  clampLocalAdjustment,
  clampUv,
  computeLinearMaskFactor,
  defaultLinearMask,
  defaultLocalAdjustments,
  LOCAL_ADJUSTMENT_LIMITS,
} from "../src/editor/mask";

describe("defaults", () => {
  it("defaultLinearMask: vertikal, feather 0.4", () => {
    const m = defaultLinearMask();
    expect(m.type).toBe("linear");
    expect(m.p1).toEqual({ u: 0.5, v: 0 });
    expect(m.p2).toEqual({ u: 0.5, v: 1 });
    expect(m.feather).toBe(0.4);
  });
  it("defaultLocalAdjustments alle 0", () => {
    expect(defaultLocalAdjustments()).toEqual({
      exposure: 0, contrast: 0, saturation: 0, temperature: 0,
    });
  });
});

describe("computeLinearMaskFactor", () => {
  const verticalMask = {
    type: "linear" as const,
    p1: { u: 0, v: 0 },
    p2: { u: 0, v: 1 },
    feather: 0.0001,
  };

  it("Punkt vor p1 -> 0", () => {
    expect(computeLinearMaskFactor(verticalMask, { u: 0, v: 0 })).toBeLessThan(0.1);
  });

  it("Punkt nach p2 -> 1", () => {
    expect(computeLinearMaskFactor(verticalMask, { u: 0, v: 1 })).toBeGreaterThan(0.9);
  });

  it("Punkt auf der Mitte (t=0.5) -> 0.5", () => {
    expect(computeLinearMaskFactor(verticalMask, { u: 0, v: 0.5 })).toBeCloseTo(0.5, 1);
  });

  it("p1 == p2 (degeneriert) -> 0", () => {
    const m = { type: "linear" as const, p1: { u: 0.5, v: 0.5 }, p2: { u: 0.5, v: 0.5 }, feather: 0.4 };
    expect(computeLinearMaskFactor(m, { u: 0.7, v: 0.3 })).toBe(0);
  });

  it("feather steuert Uebergangsbreite", () => {
    const sharp = { ...verticalMask, feather: 0.05 };
    const soft = { ...verticalMask, feather: 0.95 };
    // Bei t=0.3 (vor der Mitte): sharp -> ~0, soft -> hoeherer Wert
    const sharpAt03 = computeLinearMaskFactor(sharp, { u: 0, v: 0.3 });
    const softAt03 = computeLinearMaskFactor(soft, { u: 0, v: 0.3 });
    expect(softAt03).toBeGreaterThan(sharpAt03);
  });
});

describe("clamp helpers", () => {
  it("clampUv haelt in [0,1]", () => {
    expect(clampUv({ u: -1, v: 2 })).toEqual({ u: 0, v: 1 });
    expect(clampUv({ u: 0.5, v: 0.5 })).toEqual({ u: 0.5, v: 0.5 });
  });

  it("clampFeather haelt in [0,1]", () => {
    expect(clampFeather(-1)).toBe(0);
    expect(clampFeather(2)).toBe(1);
  });

  it("clampLocalAdjustment respektiert Limits", () => {
    expect(clampLocalAdjustment("exposure", 99)).toBe(LOCAL_ADJUSTMENT_LIMITS.exposure[1]);
    expect(clampLocalAdjustment("exposure", -99)).toBe(LOCAL_ADJUSTMENT_LIMITS.exposure[0]);
    expect(clampLocalAdjustment("contrast", 99)).toBe(1);
    expect(clampLocalAdjustment("contrast", -99)).toBe(-1);
    expect(clampLocalAdjustment("saturation", Number.NaN)).toBe(0);
  });
});
