import { describe, expect, test } from "vitest";

import type { ImageEditState } from "../src/api/client";
import { defaultAdjustments } from "../src/editor/adjustments";
import { GROUPS, defaultEnabledGroups, mergeGroups } from "../src/editor/profileGroups";

const TOPLEVEL = [
  "masks", "crop", "straightenAngle",
  "lensCorrection", "lensProfileId", "manualLensOverride",
] as const;

function baseEdit(): ImageEditState {
  return {
    adjustments: defaultAdjustments(),
    masks: [],
    crop: null,
    straightenAngle: 0,
    lensCorrection: null,
    lensProfileId: null,
    manualLensOverride: false,
  };
}

describe("profileGroups", () => {
  test("jedes bekannte Feld gehoert zu genau einer Gruppe", () => {
    const adjKeys = Object.keys(defaultAdjustments()); // 14 Skalare + hsl + toneCurve
    const expected = [...adjKeys, ...TOPLEVEL].sort();
    const seen = GROUPS.flatMap((g) => g.fields);
    expect([...seen].sort()).toEqual([...new Set(seen)].sort()); // keine Doppelung
    expect([...new Set(seen)].sort()).toEqual(expected);
  });

  test("defaultEnabledGroups: alles ausser crop/lens", () => {
    const en = defaultEnabledGroups();
    expect(en.has("tone")).toBe(true);
    expect(en.has("crop")).toBe(false);
    expect(en.has("lens")).toBe(false);
  });

  test("mergeGroups: angehakte Gruppe ueberschreibt, andere bleiben", () => {
    const base = baseEdit();
    base.adjustments = { ...base.adjustments, temperature: 0.7 };
    const profile: ImageEditState = {
      ...baseEdit(),
      adjustments: { ...defaultAdjustments(), contrast: 0.5, temperature: -0.5 },
    };
    const merged = mergeGroups(base, profile, new Set(["tone"]));
    expect(merged.adjustments.contrast).toBe(0.5);   // tone uebernommen
    expect(merged.adjustments.temperature).toBe(0.7); // color blieb (Bild-Wert)
  });

  test("mergeGroups: crop-Gruppe zieht Geometrie aus Profil", () => {
    const base = baseEdit();
    const profile: ImageEditState = {
      ...baseEdit(),
      crop: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
      straightenAngle: 0.05,
    };
    const merged = mergeGroups(base, profile, new Set(["crop"]));
    expect(merged.crop).toEqual({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    expect(merged.straightenAngle).toBe(0.05);
  });
});
