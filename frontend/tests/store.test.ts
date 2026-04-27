import { beforeEach, describe, expect, it } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { MAX_STRAIGHTEN_RADIANS, useEditorStore } from "../src/editor/store";
import { defaultCropRect } from "../src/editor/transform";

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      adjustments: defaultAdjustments(),
      bypass: false,
      cropRect: defaultCropRect(),
      straightenAngle: 0,
    });
  });

  it("startet mit allen Adjustments auf 0 und bypass=false", () => {
    const state = useEditorStore.getState();
    expect(state.bypass).toBe(false);
    for (const v of Object.values(state.adjustments)) {
      expect(v).toBe(0);
    }
  });

  it("setAdjustment aendert genau einen Wert, lasst andere unveraendert", () => {
    useEditorStore.getState().setAdjustment("contrast", 0.4);
    const state = useEditorStore.getState();
    expect(state.adjustments.contrast).toBe(0.4);
    expect(state.adjustments.exposure).toBe(0);
  });

  it("setAdjustment clampt Werte ausserhalb des Bereichs", () => {
    useEditorStore.getState().setAdjustment("exposure", 99);
    expect(useEditorStore.getState().adjustments.exposure).toBe(5);
  });

  it("resetAll setzt alles zurueck auf 0", () => {
    useEditorStore.getState().setAdjustment("contrast", 0.5);
    useEditorStore.getState().setAdjustment("exposure", 2);
    useEditorStore.getState().resetAll();
    const adj = useEditorStore.getState().adjustments;
    for (const v of Object.values(adj)) {
      expect(v).toBe(0);
    }
  });

  it("applyAdjustments ueberschreibt KOMPLETT (Default-Basis + Patch)", () => {
    useEditorStore.getState().setAdjustment("contrast", 0.5);
    useEditorStore.getState().setAdjustment("vibrance", -0.3);
    useEditorStore.getState().applyAdjustments({ exposure: 1, saturation: 0.2 });
    const adj = useEditorStore.getState().adjustments;
    expect(adj.exposure).toBe(1);
    expect(adj.saturation).toBe(0.2);
    // Vorherige Werte muessen durch Default ersetzt sein, NICHT erhalten bleiben.
    expect(adj.contrast).toBe(0);
    expect(adj.vibrance).toBe(0);
  });

  it("applyAdjustments clampt", () => {
    useEditorStore.getState().applyAdjustments({ exposure: 99, contrast: -99 });
    const adj = useEditorStore.getState().adjustments;
    expect(adj.exposure).toBe(5);
    expect(adj.contrast).toBe(-1);
  });

  it("setBypass schaltet um", () => {
    useEditorStore.getState().setBypass(true);
    expect(useEditorStore.getState().bypass).toBe(true);
    useEditorStore.getState().setBypass(false);
    expect(useEditorStore.getState().bypass).toBe(false);
  });

  it("setCropRect clampt", () => {
    useEditorStore.getState().setCropRect({ x0: -0.5, y0: 0, x1: 1.5, y1: 1 });
    const r = useEditorStore.getState().cropRect;
    expect(r.x0).toBe(0);
    expect(r.x1).toBe(1);
  });

  it("setStraightenAngle klemmt auf ±MAX_STRAIGHTEN_RADIANS", () => {
    useEditorStore.getState().setStraightenAngle(99);
    expect(useEditorStore.getState().straightenAngle).toBeCloseTo(MAX_STRAIGHTEN_RADIANS, 5);
    useEditorStore.getState().setStraightenAngle(-99);
    expect(useEditorStore.getState().straightenAngle).toBeCloseTo(-MAX_STRAIGHTEN_RADIANS, 5);
    useEditorStore.getState().setStraightenAngle(0.05);
    expect(useEditorStore.getState().straightenAngle).toBeCloseTo(0.05, 5);
  });

  it("resetGeometry setzt cropRect und Angle zurueck", () => {
    useEditorStore.getState().setCropRect({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    useEditorStore.getState().setStraightenAngle(0.05);
    useEditorStore.getState().resetGeometry();
    const s = useEditorStore.getState();
    expect(s.cropRect).toEqual(defaultCropRect());
    expect(s.straightenAngle).toBe(0);
  });
});
