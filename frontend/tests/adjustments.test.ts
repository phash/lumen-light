import { describe, expect, it } from "vitest";

import {
  ADJUSTMENTS,
  HSL_CHANNELS,
  adjustmentsByGroup,
  clampAdjustment,
  defaultAdjustments,
  defaultHslAdjustments,
  formatAdjustmentValue,
  getAdjustment,
  isAtDefault,
  isHslNeutral,
} from "../src/editor/adjustments";

describe("adjustments definitions", () => {
  it("hat 13 Adjustments mit eindeutigen keys", () => {
    expect(ADJUSTMENTS).toHaveLength(13);
    const keys = new Set(ADJUSTMENTS.map((a) => a.key));
    expect(keys.size).toBe(13);
  });

  it("ranges: exposure -5..+5, einseitig-positive 0..+1, Rest -1..+1", () => {
    const expo = getAdjustment("exposure");
    expect(expo.min).toBe(-5);
    expect(expo.max).toBe(5);
    // Highlight-Recovery + Detail-Sektion: 0..1 (negative Werte sinnlos)
    const positiveOnly = new Set([
      "sharpness",
      "noiseReduction",
      "highlightRecovery",
    ]);
    for (const a of ADJUSTMENTS) {
      if (a.key === "exposure") continue;
      if (positiveOnly.has(a.key)) {
        expect(a.min).toBe(0);
        expect(a.max).toBe(1);
      } else {
        expect(a.min).toBe(-1);
        expect(a.max).toBe(1);
      }
    }
  });

  it("alle Defaults sind 0", () => {
    for (const a of ADJUSTMENTS) {
      expect(a.default).toBe(0);
    }
  });
});

describe("defaultAdjustments", () => {
  it("liefert die 10 Scalar-Slider auf 0 plus hsl=null", () => {
    const adj = defaultAdjustments();
    expect(adj.hsl).toBeNull();
    for (const a of ADJUSTMENTS) {
      expect(adj[a.key]).toBe(0);
    }
  });
});

describe("HSL", () => {
  it("HSL_CHANNELS hat 8 eindeutige Eintraege", () => {
    expect(HSL_CHANNELS).toHaveLength(8);
    expect(new Set(HSL_CHANNELS).size).toBe(8);
  });

  it("defaultHslAdjustments liefert 24 Felder = 0", () => {
    const hsl = defaultHslAdjustments();
    for (const axis of ["hue", "saturation", "luminance"] as const) {
      for (const ch of HSL_CHANNELS) {
        expect(hsl[axis][ch]).toBe(0);
      }
    }
  });

  it("isHslNeutral: null und Default sind neutral, sonst nicht", () => {
    expect(isHslNeutral(null)).toBe(true);
    expect(isHslNeutral(defaultHslAdjustments())).toBe(true);
    const hsl = defaultHslAdjustments();
    const tweaked = { ...hsl, saturation: { ...hsl.saturation, red: 0.5 } };
    expect(isHslNeutral(tweaked)).toBe(false);
  });
});

describe("clampAdjustment", () => {
  it("haelt Werte im Bereich", () => {
    expect(clampAdjustment("exposure", 99)).toBe(5);
    expect(clampAdjustment("exposure", -99)).toBe(-5);
    expect(clampAdjustment("contrast", 0.4)).toBe(0.4);
  });

  it("ersetzt NaN durch Default", () => {
    expect(clampAdjustment("contrast", Number.NaN)).toBe(0);
  });
});

describe("isAtDefault", () => {
  it("true bei kleinen Abweichungen vom Default", () => {
    expect(isAtDefault("exposure", 0)).toBe(true);
    expect(isAtDefault("exposure", 0.00005)).toBe(true);
    expect(isAtDefault("exposure", 0.5)).toBe(false);
  });
});

describe("formatAdjustmentValue", () => {
  it("exposure mit Vorzeichen + 2 Nachkommastellen", () => {
    expect(formatAdjustmentValue("exposure", 0)).toBe("+0.00");
    expect(formatAdjustmentValue("exposure", 1.5)).toBe("+1.50");
    expect(formatAdjustmentValue("exposure", -2.25)).toBe("-2.25");
  });

  it("Rest als Prozent (Multiplikation × 100, gerundet)", () => {
    expect(formatAdjustmentValue("contrast", 0)).toBe("0");
    expect(formatAdjustmentValue("contrast", 0.4)).toBe("40");
    expect(formatAdjustmentValue("vibrance", -0.5)).toBe("-50");
  });
});

describe("adjustmentsByGroup", () => {
  it("Licht=7, Farbe=4, Detail=2", () => {
    const groups = adjustmentsByGroup();
    expect(groups.get("Licht")).toHaveLength(7);
    expect(groups.get("Farbe")).toHaveLength(4);
    expect(groups.get("Detail")).toHaveLength(2);
  });
});
