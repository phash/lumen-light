import { describe, expect, it } from "vitest";

import {
  type CropRect,
  applyUv,
  invertUvTransform,
  uvTransformMatrix,
} from "../src/editor/transform";

// Rechnet Output-UV in Output-Pixel und Source-UV in Source-Pixel um.
function outPx(u: number, v: number, w: number, h: number, crop: CropRect) {
  return { x: u * w * (crop.x1 - crop.x0), y: v * h * (crop.y1 - crop.y0) };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("uvTransformMatrix mit Seitenverhaeltnis", () => {
  const W = 3000;
  const H = 1000;
  const aspect = W / H;
  const crops: CropRect[] = [
    { x0: 0, y0: 0, x1: 1, y1: 1 },
    { x0: 0.1, y0: 0.2, x1: 0.7, y1: 0.9 },
  ];

  for (const crop of crops) {
    it(`Rotation erhaelt Pixel-Distanzen (crop ${JSON.stringify(crop)})`, () => {
      const m = uvTransformMatrix(crop, 0.12, aspect);
      const pts: Array<[number, number]> = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
        [0.3, 0.7],
      ];
      for (const [au, av] of pts) {
        for (const [bu, bv] of pts) {
          const sa = applyUv(m, au, av);
          const sb = applyUv(m, bu, bv);
          const srcD = dist({ x: sa.x * W, y: sa.y * H }, { x: sb.x * W, y: sb.y * H });
          const outD = dist(outPx(au, av, W, H, crop), outPx(bu, bv, W, H, crop));
          expect(srcD).toBeCloseTo(outD, 3);
        }
      }
    });
  }

  it("Rotation erhaelt rechte Winkel in Pixeln (kein Shear)", () => {
    const m = uvTransformMatrix({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0.1, aspect);
    const o = applyUv(m, 0.5, 0.5);
    const ax = applyUv(m, 0.6, 0.5);
    const ay = applyUv(m, 0.5, 0.6);
    const vx = { x: (ax.x - o.x) * W, y: (ax.y - o.y) * H };
    const vy = { x: (ay.x - o.x) * W, y: (ay.y - o.y) * H };
    const cos = (vx.x * vy.x + vx.y * vy.y) / (Math.hypot(vx.x, vx.y) * Math.hypot(vy.x, vy.y));
    expect(cos).toBeCloseTo(0, 5);
  });

  it("Drehwinkel im Pixelraum entspricht dem Parameter", () => {
    const angle = 0.08;
    const m = uvTransformMatrix({ x0: 0, y0: 0, x1: 1, y1: 1 }, angle, aspect);
    const o = applyUv(m, 0.5, 0.5);
    const ax = applyUv(m, 0.6, 0.5);
    const measured = Math.atan2((ax.y - o.y) * H, (ax.x - o.x) * W);
    // Output-X-Achse landet im Source um -angle gedreht.
    expect(measured).toBeCloseTo(-angle, 6);
  });

  it("Mitte des Crops bleibt fix und Round-Trip ist stabil", () => {
    const crop = { x0: 0.1, y0: 0.2, x1: 0.7, y1: 0.9 };
    const m = uvTransformMatrix(crop, -0.15, aspect);
    const c = applyUv(m, 0.5, 0.5);
    expect(c.x).toBeCloseTo(0.4, 6);
    expect(c.y).toBeCloseTo(0.55, 6);
    const inv = invertUvTransform(m);
    const s = applyUv(m, 0.2, 0.9);
    const back = applyUv(inv, s.x, s.y);
    expect(back.x).toBeCloseTo(0.2, 5);
    expect(back.y).toBeCloseTo(0.9, 5);
  });

  it("Default-Aspect 1 bleibt rueckwaertskompatibel", () => {
    const a = uvTransformMatrix({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0.1);
    const b = uvTransformMatrix({ x0: 0, y0: 0, x1: 1, y1: 1 }, 0.1, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
