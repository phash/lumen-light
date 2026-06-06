import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ImageEditState } from "../src/api/client";
import { defaultAdjustments } from "../src/editor/adjustments";
import { defaultLensCorrection } from "../src/editor/lens";
import { GROUPS, defaultEnabledGroups, mergeGroups } from "../src/editor/profileGroups";
import { useEditorStore } from "../src/editor/store";
import { defaultCropRect } from "../src/editor/transform";

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

describe("store.applyProfileGroups", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("merged Profil-Gruppen in den Store, eine Undo-Stufe", () => {
    const store = useEditorStore.getState();
    store.resetAll();
    store.setAdjustment("temperature", 0.7);
    // Debounce-Timer der vorherigen Aenderung flushen, damit `before` korrekt ist.
    vi.advanceTimersByTime(300);
    const before = useEditorStore.getState().past.length;
    useEditorStore.getState().applyProfileGroups(
      {
        adjustments: { ...defaultAdjustments(), contrast: 0.5, temperature: -0.5 },
        masks: [],
        crop: null,
        straightenAngle: 0,
        lensCorrection: null,
        lensProfileId: null,
        manualLensOverride: false,
      },
      new Set(["tone"]),
    );
    // Debounce-Timer flushen, damit der Snapshot in past landet.
    vi.advanceTimersByTime(300);
    const s = useEditorStore.getState();
    expect(s.adjustments.contrast).toBe(0.5);     // tone uebernommen
    expect(s.adjustments.temperature).toBe(0.7);  // color blieb
    expect(s.past.length).toBe(before + 1);       // genau ein Snapshot
  });

  test("crop-Gruppe mit null-Crop im Profil setzt Crop auf Identity zurueck", () => {
    const store = useEditorStore.getState();
    store.resetAll();
    store.setCropRect({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    useEditorStore.getState().applyProfileGroups(
      {
        adjustments: defaultAdjustments(),
        masks: [],
        crop: null,            // Profil ohne Crop
        straightenAngle: 0,
        lensCorrection: null,
        lensProfileId: null,
        manualLensOverride: false,
      },
      new Set(["crop"]),       // crop-Gruppe angehakt
    );
    expect(useEditorStore.getState().cropRect).toEqual(defaultCropRect());
  });

  test("lens-Gruppe mit null-LensCorrection im Profil setzt Lens auf Identity zurueck", () => {
    const store = useEditorStore.getState();
    store.resetAll();
    store.setLensCorrection({ distortion: 0.5, vignette: 0.5, tcaR: 0, tcaB: 0 });
    useEditorStore.getState().applyProfileGroups(
      {
        adjustments: defaultAdjustments(),
        masks: [],
        crop: null,
        straightenAngle: 0,
        lensCorrection: null,  // Profil ohne Lens-Korrektur
        lensProfileId: null,
        manualLensOverride: false,
      },
      new Set(["lens"]),       // lens-Gruppe angehakt
    );
    expect(useEditorStore.getState().lensCorrection).toEqual(defaultLensCorrection());
  });
});
