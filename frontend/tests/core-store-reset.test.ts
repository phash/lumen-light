import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { defaultLensCorrection } from "../src/editor/lens";
import { useEditorStore } from "../src/editor/store";
import { defaultCropRect } from "../src/editor/transform";

describe("Store-Reset pro Bild", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.getState().resetForNewImage();
    vi.runAllTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resetForNewImage setzt Adjustments, Masken, Geometrie und History zurueck", () => {
    const s = useEditorStore.getState();
    s.setAdjustment("exposure", 1);
    s.setHslChannel("hue", "red", 0.5);
    s.setToneCurvePoint(0, 0, 0.2);
    s.addLinearMask();
    s.setStraightenAngle(0.1);
    s.setCropRect({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    vi.advanceTimersByTime(300);
    s.setAdjustment("contrast", 0.5);
    s.setBypass(true);
    expect(useEditorStore.getState().past.length).toBeGreaterThan(0);

    useEditorStore.getState().resetForNewImage();
    // Ausstehender History-Debounce darf danach nichts mehr in past schieben.
    vi.advanceTimersByTime(1000);

    const r = useEditorStore.getState();
    expect(r.adjustments).toEqual(defaultAdjustments());
    expect(r.masks).toEqual([]);
    expect(r.selectedMaskId).toBeNull();
    expect(r.cropRect).toEqual(defaultCropRect());
    expect(r.straightenAngle).toBe(0);
    expect(r.lensCorrection).toEqual(defaultLensCorrection());
    expect(r.lensProfileId).toBeNull();
    expect(r.manualLensOverride).toBe(false);
    expect(r.bypass).toBe(false);
    expect(r.past).toEqual([]);
    expect(r.future).toEqual([]);
  });

  it("applyEditState verwirft ausstehenden History-Debounce", () => {
    useEditorStore.getState().setAdjustment("exposure", 1);
    // Debounce laeuft noch (250 ms) -> applyEditState muss ihn canceln.
    useEditorStore.getState().applyEditState({
      adjustments: { contrast: 0.3 },
      masks: [],
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
    });
    vi.advanceTimersByTime(1000);
    expect(useEditorStore.getState().past).toEqual([]);
    expect(useEditorStore.getState().adjustments.contrast).toBe(0.3);
  });
});
