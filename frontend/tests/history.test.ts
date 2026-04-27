import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { defaultLensCorrection } from "../src/editor/lens";
import { useEditorStore } from "../src/editor/store";
import { defaultCropRect } from "../src/editor/transform";

describe("Undo/Redo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.setState({
      adjustments: defaultAdjustments(),
      bypass: false,
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
      masks: [],
      selectedMaskId: null,
      past: [],
      future: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("undo() ohne past ist no-op", () => {
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.exposure).toBe(0);
  });

  it("eine Aenderung -> debounce flush -> undo zurueck zu 0", () => {
    useEditorStore.getState().setAdjustment("exposure", 1.5);
    expect(useEditorStore.getState().adjustments.exposure).toBe(1.5);
    vi.advanceTimersByTime(300);
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.exposure).toBe(0);
    expect(useEditorStore.getState().future).toHaveLength(1);
  });

  it("Burst von 5 Aenderungen wird zu EINEM History-Eintrag debounced", () => {
    useEditorStore.getState().setAdjustment("exposure", 0.1);
    useEditorStore.getState().setAdjustment("exposure", 0.2);
    useEditorStore.getState().setAdjustment("exposure", 0.3);
    useEditorStore.getState().setAdjustment("exposure", 0.4);
    useEditorStore.getState().setAdjustment("exposure", 0.5);
    vi.advanceTimersByTime(300);
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().undo();
    // Eine Cmd+Z bringt uns auf 0 (vor dem Burst), nicht auf 0.4.
    expect(useEditorStore.getState().adjustments.exposure).toBe(0);
  });

  it("redo() stellt nach undo() wieder her", () => {
    useEditorStore.getState().setAdjustment("contrast", 0.6);
    vi.advanceTimersByTime(300);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.contrast).toBe(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().adjustments.contrast).toBe(0.6);
    expect(useEditorStore.getState().future).toHaveLength(0);
  });

  it("nach undo + neuer Aenderung wird future geleert", () => {
    useEditorStore.getState().setAdjustment("contrast", 0.6);
    vi.advanceTimersByTime(300);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().future).toHaveLength(1);
    useEditorStore.getState().setAdjustment("exposure", 0.2);
    vi.advanceTimersByTime(300);
    expect(useEditorStore.getState().future).toHaveLength(0);
  });

  it("History speichert auch Mask-Operationen", () => {
    const id = useEditorStore.getState().addLinearMask()!;
    vi.advanceTimersByTime(300);
    expect(useEditorStore.getState().past).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().masks).toHaveLength(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().masks).toHaveLength(1);
    expect(useEditorStore.getState().masks[0]!.id).toBe(id);
  });

  it("History ist auf 50 Eintraege begrenzt", () => {
    for (let i = 0; i < 60; i++) {
      useEditorStore.getState().setAdjustment("exposure", i * 0.01);
      vi.advanceTimersByTime(300);
    }
    expect(useEditorStore.getState().past.length).toBeLessThanOrEqual(50);
  });

  it("setBypass / selectMask schreiben KEINE History (UI-Modi)", () => {
    useEditorStore.getState().setBypass(true);
    useEditorStore.getState().selectMask(null);
    vi.advanceTimersByTime(300);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});
