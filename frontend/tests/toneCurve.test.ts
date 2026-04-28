import { describe, expect, it } from "vitest";

import type { ToneCurve } from "../src/editor/adjustments";
import {
  TONE_CURVE_LUT_SIZE,
  computeToneCurveLut,
  evaluateToneCurve,
} from "../src/editor/toneCurve";

const identity: ToneCurve = {
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
};

const sCurve: ToneCurve = {
  points: [
    { x: 0, y: 0 },
    { x: 0.25, y: 0.15 }, // schiebt Schatten runter
    { x: 0.75, y: 0.85 }, // schiebt Lichter hoch
    { x: 1, y: 1 },
  ],
};

describe("evaluateToneCurve", () => {
  it("Identity gibt x = y", () => {
    expect(evaluateToneCurve(identity, 0)).toBe(0);
    expect(evaluateToneCurve(identity, 0.5)).toBeCloseTo(0.5, 4);
    expect(evaluateToneCurve(identity, 1)).toBe(1);
  });

  it("S-Curve: Mittel ~0.5, Schatten unter Identity, Lichter ueber Identity", () => {
    expect(evaluateToneCurve(sCurve, 0.25)).toBeCloseTo(0.15, 2);
    expect(evaluateToneCurve(sCurve, 0.75)).toBeCloseTo(0.85, 2);
    expect(evaluateToneCurve(sCurve, 0.125)).toBeLessThan(0.125);
    expect(evaluateToneCurve(sCurve, 0.875)).toBeGreaterThan(0.875);
  });

  it("klemmt vor dem ersten und nach dem letzten Punkt", () => {
    const curve: ToneCurve = {
      points: [
        { x: 0.2, y: 0.3 },
        { x: 0.8, y: 0.7 },
      ],
    };
    expect(evaluateToneCurve(curve, 0)).toBe(0.3);
    expect(evaluateToneCurve(curve, 1)).toBe(0.7);
  });
});

describe("computeToneCurveLut", () => {
  it("liefert 256 Eintraege im Bereich [0, 255]", () => {
    const lut = computeToneCurveLut(sCurve);
    expect(lut.length).toBe(TONE_CURVE_LUT_SIZE);
    for (const v of lut) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it("Identity-LUT entspricht Linear-Ramp (Toleranz ±1 wegen Rundung)", () => {
    const lut = computeToneCurveLut(identity);
    for (let i = 0; i < TONE_CURVE_LUT_SIZE; i++) {
      expect(Math.abs(lut[i]! - i)).toBeLessThanOrEqual(1);
    }
  });

  it("S-Curve LUT: schwarz->schwarz, mittel-tief unter Identity, mittel-hoch ueber Identity, weiss->weiss", () => {
    const lut = computeToneCurveLut(sCurve);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(255);
    expect(lut[64]!).toBeLessThan(64);
    expect(lut[192]!).toBeGreaterThan(192);
  });

  it("monoton nicht-fallend bei monotonen Stuetzpunkten", () => {
    const lut = computeToneCurveLut(sCurve);
    for (let i = 1; i < lut.length; i++) {
      expect(lut[i]!).toBeGreaterThanOrEqual(lut[i - 1]!);
    }
  });
});
