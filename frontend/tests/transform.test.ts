import { describe, expect, it } from "vitest";

import {
  type CropRect,
  applyUv,
  aspectValue,
  clampCropRect,
  defaultCropRect,
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
});
