import { describe, expect, test } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { parseProfileYaml, serializeProfileYaml } from "../src/editor/profileYaml";

describe("profileYaml", () => {
  test("Round-Trip erhaelt name/adjustments/masks/geometry", () => {
    const profile = {
      name: "Mein Look",
      adjustments: { ...defaultAdjustments(), contrast: 0.3 },
      masks: [],
      geometry: {
        crop: { x0: 0, y0: 0, x1: 1, y1: 1 },
        straightenAngle: 0,
        lensCorrection: null,
        lensProfileId: null,
        manualLensOverride: false,
      },
    };
    const text = serializeProfileYaml(profile);
    const parsed = parseProfileYaml(text);
    expect(parsed.name).toBe("Mein Look");
    expect(parsed.adjustments.contrast).toBe(0.3);
    expect(parsed.geometry?.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  test("falsche Version wird abgelehnt", () => {
    expect(() => parseProfileYaml("lumenProfile: 99\nname: x\nadjustments: {}\n")).toThrow();
  });

  test("fehlender Name wird abgelehnt", () => {
    expect(() => parseProfileYaml("lumenProfile: 1\nadjustments: {}\n")).toThrow();
  });
});
