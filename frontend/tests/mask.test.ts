import { describe, expect, it } from "vitest";

import {
  clampFeather,
  clampLocalAdjustment,
  clampRadius,
  clampUv,
  computeLinearMaskFactor,
  computeRadialMaskFactor,
  defaultLinearMask,
  defaultLocalAdjustments,
  defaultRadialMask,
  LOCAL_ADJUSTMENT_LIMITS,
} from "../src/editor/mask";

describe("defaults", () => {
  it("defaultLinearMask: vertikal, feather 0.4", () => {
    const m = defaultLinearMask();
    expect(m.type).toBe("linear");
    expect(m.p1).toEqual({ u: 0.5, v: 0 });
    expect(m.p2).toEqual({ u: 0.5, v: 1 });
    expect(m.feather).toBe(0);
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

describe("defaultRadialMask + clampRadius", () => {
  it("defaultRadialMask: zentriert, rx=ry=0.25, feather 0.4", () => {
    const m = defaultRadialMask();
    expect(m.type).toBe("radial");
    expect(m.center).toEqual({ u: 0.5, v: 0.5 });
    expect(m.rx).toBe(0.25);
    expect(m.ry).toBe(0.25);
    expect(m.feather).toBe(0);
  });

  it("clampRadius haelt zwischen 0.02 und 1", () => {
    expect(clampRadius(-1)).toBe(0.02);
    expect(clampRadius(0)).toBe(0.02);
    expect(clampRadius(99)).toBe(1);
    expect(clampRadius(0.3)).toBe(0.3);
  });
});

describe("computeRadialMaskFactor", () => {
  const circle = {
    type: "radial" as const,
    center: { u: 0.5, v: 0.5 },
    rx: 0.2,
    ry: 0.2,
    feather: 0.0001,
  };

  it("Zentrum -> 1 (volle Maske)", () => {
    expect(computeRadialMaskFactor(circle, { u: 0.5, v: 0.5 })).toBeCloseTo(1, 3);
  });

  it("ausserhalb der Ellipse -> ~0", () => {
    expect(computeRadialMaskFactor(circle, { u: 0.95, v: 0.95 })).toBeLessThan(0.05);
  });

  it("auf der Ellipsenkante -> ~0.5 (smoothstep-Mitte)", () => {
    // Punkt direkt auf der rx-Achse (u-Distanz = rx, v=center)
    const f = computeRadialMaskFactor(circle, { u: 0.7, v: 0.5 });
    expect(f).toBeCloseTo(0.5, 1);
  });

  it("anisotrope rx != ry: gleiche dist^2 = 1 auf beiden Achsen", () => {
    const ellipse = {
      type: "radial" as const,
      center: { u: 0.5, v: 0.5 },
      rx: 0.4,
      ry: 0.1,
      feather: 0.0001,
    };
    const onRx = computeRadialMaskFactor(ellipse, { u: 0.9, v: 0.5 });
    const onRy = computeRadialMaskFactor(ellipse, { u: 0.5, v: 0.6 });
    expect(onRx).toBeCloseTo(onRy, 2);
  });

  it("feather steuert Uebergangsbreite", () => {
    const sharp = { ...circle, feather: 0.05 };
    const soft = { ...circle, feather: 0.95 };
    // Punkt knapp ausserhalb der Kante (dist^2 ~ 1.21):
    // sharp's Uebergang endet bei 1.025 -> factor=0
    // soft's Uebergang reicht bis 1.475 -> factor > 0
    const sharpFar = computeRadialMaskFactor(sharp, { u: 0.72, v: 0.5 });
    const softFar = computeRadialMaskFactor(soft, { u: 0.72, v: 0.5 });
    expect(softFar).toBeGreaterThan(sharpFar);
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
