import { describe, expect, it } from "vitest";

import { computeToneCurveLut, evaluateToneCurve } from "../src/editor/toneCurve";

describe("toneCurve Fritsch-Carlson Vorzeichenwechsel", () => {
  it("Extrempunkt bekommt Tangente 0 -> kein Overshoot ueber den Gipfel", () => {
    const curve = {
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.8 },
        { x: 1, y: 0.2 },
      ],
    };
    for (let x = 0.4; x <= 0.6; x += 0.01) {
      expect(evaluateToneCurve(curve, x)).toBeLessThanOrEqual(0.8 + 1e-9);
    }
    // Auch die GPU-LUT ueberschreitet den Gipfel nicht.
    const lut = computeToneCurveLut(curve);
    expect(Math.max(...lut)).toBeLessThanOrEqual(Math.round(0.8 * 255));
  });

  it("Talpunkt unterschreitet das Minimum nicht", () => {
    const curve = {
      points: [
        { x: 0, y: 1 },
        { x: 0.5, y: 0.3 },
        { x: 1, y: 0.6 },
      ],
    };
    for (let x = 0.4; x <= 0.6; x += 0.01) {
      expect(evaluateToneCurve(curve, x)).toBeGreaterThanOrEqual(0.3 - 1e-9);
    }
  });
});
