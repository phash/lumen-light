import { describe, expect, it } from "vitest";

import {
  type CropRect,
  applyUv,
  aspectValue,
  clampCropRect,
  cropOutputSize,
  defaultCropRect,
  invertUvTransform,
  isIdentityCrop,
  updateCropOnDrag,
  uvTransformMatrix,
} from "../src/editor/transform";

const ID: CropRect = defaultCropRect();

function approxArr(actual: Float32Array, expected: number[], eps = 1e-5) {
  expect(actual.length).toBe(expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    expect(actual[i]).toBeCloseTo(expected[i]!, 5);
    void eps;
  }
}

describe("uvTransformMatrix", () => {
  it("Identitaet bei (kein Crop, kein Rotate)", () => {
    approxArr(uvTransformMatrix(ID, 0), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("Center-Crop (0.25..0.75) mappt UV(0.5,0.5) auf Mitte", () => {
    const m = uvTransformMatrix({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }, 0);
    const c = applyUv(m, 0.5, 0.5);
    expect(c.x).toBeCloseTo(0.5, 5);
    expect(c.y).toBeCloseTo(0.5, 5);
  });

  it("Center-Crop mappt UV(0,0) auf (0.25, 0.25) und UV(1,1) auf (0.75, 0.75)", () => {
    const m = uvTransformMatrix({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }, 0);
    const a = applyUv(m, 0, 0);
    const b = applyUv(m, 1, 1);
    expect(a.x).toBeCloseTo(0.25, 5);
    expect(a.y).toBeCloseTo(0.25, 5);
    expect(b.x).toBeCloseTo(0.75, 5);
    expect(b.y).toBeCloseTo(0.75, 5);
  });

  it("90° Rotation (kein Crop) bildet Mitte auf Mitte ab", () => {
    const m = uvTransformMatrix(ID, Math.PI / 2);
    const c = applyUv(m, 0.5, 0.5);
    expect(c.x).toBeCloseTo(0.5, 5);
    expect(c.y).toBeCloseTo(0.5, 5);
  });
});

describe("isIdentityCrop", () => {
  it("default ist Identitaet", () => {
    expect(isIdentityCrop(defaultCropRect())).toBe(true);
  });
  it("alles andere nicht", () => {
    expect(isIdentityCrop({ x0: 0.1, y0: 0, x1: 1, y1: 1 })).toBe(false);
  });
});

describe("clampCropRect", () => {
  it("klemmt unter 0", () => {
    const r = clampCropRect({ x0: -0.5, y0: -0.5, x1: 0.5, y1: 0.5 });
    expect(r.x0).toBe(0);
    expect(r.y0).toBe(0);
  });
  it("klemmt ueber 1", () => {
    const r = clampCropRect({ x0: 0.5, y0: 0.5, x1: 1.5, y1: 1.5 });
    expect(r.x1).toBe(1);
    expect(r.y1).toBe(1);
  });
  it("erhaelt minimale Groesse", () => {
    const r = clampCropRect({ x0: 0.5, y0: 0.5, x1: 0.51, y1: 0.51 });
    expect(r.x1 - r.x0).toBeGreaterThanOrEqual(0.05);
    expect(r.y1 - r.y0).toBeGreaterThanOrEqual(0.05);
  });
});

describe("aspectValue", () => {
  it("liefert null fuer 'free'", () => {
    expect(aspectValue("free")).toBeNull();
  });
  it("Verhaeltnisse korrekt", () => {
    expect(aspectValue("1:1")).toBe(1);
    expect(aspectValue("3:2")).toBe(1.5);
    expect(aspectValue("4:3")).toBeCloseTo(1.3333, 4);
    expect(aspectValue("16:9")).toBeCloseTo(1.7778, 4);
  });
});

describe("invertUvTransform", () => {
  it("Identity bleibt Identity", () => {
    const inv = invertUvTransform(uvTransformMatrix(ID, 0));
    approxArr(inv, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });

  it("Center-Crop: Forward+Inverse = Round-Trip", () => {
    const m = uvTransformMatrix({ x0: 0.2, y0: 0.3, x1: 0.8, y1: 0.7 }, 0);
    const inv = invertUvTransform(m);
    // Output-UV (0.5, 0.5) → Source-UV → wieder Output-UV ergibt 0.5, 0.5.
    const src = applyUv(m, 0.5, 0.5);
    const back = applyUv(inv, src.x, src.y);
    expect(back.x).toBeCloseTo(0.5, 5);
    expect(back.y).toBeCloseTo(0.5, 5);
  });

  it("Center-Crop: Source-Mitte mappt zurueck auf Output-Mitte", () => {
    const m = uvTransformMatrix({ x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }, 0);
    const inv = invertUvTransform(m);
    // Source (0.5, 0.5) ist Crop-Mitte → Output (0.5, 0.5).
    const out = applyUv(inv, 0.5, 0.5);
    expect(out.x).toBeCloseTo(0.5, 5);
    expect(out.y).toBeCloseTo(0.5, 5);
    // Source (0.25, 0.25) ist Crop-Top-Left → Output (0, 0).
    const corner = applyUv(inv, 0.25, 0.25);
    expect(corner.x).toBeCloseTo(0, 5);
    expect(corner.y).toBeCloseTo(0, 5);
  });

  it("Mit Rotation: Round-Trip stabil", () => {
    const m = uvTransformMatrix({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }, 0.05);
    const inv = invertUvTransform(m);
    const src = applyUv(m, 0.3, 0.7);
    const back = applyUv(inv, src.x, src.y);
    expect(back.x).toBeCloseTo(0.3, 4);
    expect(back.y).toBeCloseTo(0.7, 4);
  });

  it("liefert bei degeneriertem Crop (det≈0) die Identitaet statt Inf/NaN", () => {
    // a=b=c=d=0 -> det=0 -> Guard greift, sonst spuckt der Picker Inf raus.
    const degenerate = new Float32Array([0, 0, 0, 0, 0, 0, 0.5, 0.5, 1]);
    const inv = invertUvTransform(degenerate);
    expect(Array.from(inv)).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    for (const v of inv) expect(Number.isFinite(v)).toBe(true);
  });
});

describe("updateCropOnDrag", () => {
  it("free: Drag SE-Ecke zieht beide Edges", () => {
    const r = updateCropOnDrag({
      current: ID,
      handle: "se",
      dx: -0.1,
      dy: -0.2,
      aspect: "free",
      imageAspect: 1,
    });
    expect(r.x1).toBeCloseTo(0.9, 5);
    expect(r.y1).toBeCloseTo(0.8, 5);
  });

  it("1:1 auf 1:1-Bild: Drag E-Edge zieht N+S proportional", () => {
    const r = updateCropOnDrag({
      current: ID,
      handle: "e",
      dx: -0.4,
      dy: 0,
      aspect: "1:1",
      imageAspect: 1,
    });
    // cropW = 0.6, cropH = 0.6, zentriert um y=0.5
    expect(r.x1 - r.x0).toBeCloseTo(0.6, 5);
    expect(r.y1 - r.y0).toBeCloseTo(0.6, 5);
    expect((r.y0 + r.y1) / 2).toBeCloseTo(0.5, 5);
  });

  it("1:1 auf 3:2-Bild: cropH-UV = cropW-UV * 1.5 (Quadrat in Pixeln)", () => {
    const r = updateCropOnDrag({
      current: ID,
      handle: "e",
      dx: -0.4,
      dy: 0,
      aspect: "1:1",
      imageAspect: 1.5,
    });
    expect(r.x1 - r.x0).toBeCloseTo(0.6, 5);
    expect(r.y1 - r.y0).toBeCloseTo(0.9, 5);
  });

  it("cropOutputSize mappt das Crop-Rechteck pixelgenau (Full-Res-Export)", () => {
    // Identitaets-Crop -> volle Quell-Aufloesung (C2: 'native' = Original).
    expect(cropOutputSize(6000, 4000, ID)).toEqual({ width: 6000, height: 4000 });
    // Halbes Crop -> halbe Pixel pro Achse.
    expect(
      cropOutputSize(6000, 4000, { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 }),
    ).toEqual({ width: 3000, height: 2000 });
    // Mindestgroesse 0.05 verhindert 0-Pixel-Output bei degeneriertem Crop.
    const tiny = cropOutputSize(100, 100, { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 });
    expect(tiny.width).toBeGreaterThanOrEqual(1);
    expect(tiny.height).toBeGreaterThanOrEqual(1);
  });
});

describe("clampCropRect NaN-Guard", () => {
  it("nicht-finite/defekte Felder werden auf Identitaet geklemmt (kein NaN)", () => {
    // Simuliert ein defektes/importiertes Crop-Objekt (fehlende/falsche Felder).
    const garbage = {
      x0: NaN,
      y0: undefined,
      x1: "x",
      y1: null,
    } as unknown as CropRect;
    const r = clampCropRect(garbage);
    for (const v of [r.x0, r.y0, r.x1, r.y1]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(r.x1).toBeGreaterThan(r.x0);
    expect(r.y1).toBeGreaterThan(r.y0);
  });
});
