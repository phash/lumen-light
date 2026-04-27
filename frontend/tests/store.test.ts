import { beforeEach, describe, expect, it } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { defaultLensCorrection } from "../src/editor/lens";
import {
  defaultLinearMask,
  defaultLocalAdjustments,
  defaultRadialMask,
} from "../src/editor/mask";
import { MAX_STRAIGHTEN_RADIANS, useEditorStore } from "../src/editor/store";
import { defaultCropRect } from "../src/editor/transform";

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      adjustments: defaultAdjustments(),
      bypass: false,
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
      linearMaskEnabled: false,
      linearMask: defaultLinearMask(),
      linearLocalAdj: defaultLocalAdjustments(),
      radialMaskEnabled: false,
      radialMask: defaultRadialMask(),
      radialLocalAdj: defaultLocalAdjustments(),
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

  it("resetGeometry setzt cropRect, Angle UND lensCorrection zurueck", () => {
    useEditorStore.getState().setCropRect({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    useEditorStore.getState().setStraightenAngle(0.05);
    useEditorStore.getState().setLensCorrection({ distortion: 0.5, vignette: -0.3 });
    useEditorStore.getState().resetGeometry();
    const s = useEditorStore.getState();
    expect(s.cropRect).toEqual(defaultCropRect());
    expect(s.straightenAngle).toBe(0);
    expect(s.lensCorrection).toEqual(defaultLensCorrection());
  });

  it("setLensCorrection: Partial-Update lasst andere Felder unveraendert", () => {
    useEditorStore.getState().setLensCorrection({ distortion: 0.5 });
    expect(useEditorStore.getState().lensCorrection).toEqual({
      distortion: 0.5,
      vignette: 0,
    });
    useEditorStore.getState().setLensCorrection({ vignette: -0.4 });
    expect(useEditorStore.getState().lensCorrection).toEqual({
      distortion: 0.5,
      vignette: -0.4,
    });
  });

  it("setLensCorrection clampt auf [-1, 1]", () => {
    useEditorStore.getState().setLensCorrection({ distortion: 99, vignette: -99 });
    expect(useEditorStore.getState().lensCorrection).toEqual({
      distortion: 1,
      vignette: -1,
    });
  });

  it("setLensCorrection mit source='auto' setzt manualLensOverride NICHT", () => {
    useEditorStore.getState().setLensCorrection({ distortion: 0.4 }, "auto");
    expect(useEditorStore.getState().manualLensOverride).toBe(false);
  });

  it("setLensCorrection mit source='manual' (default) setzt manualLensOverride=true", () => {
    useEditorStore.getState().setLensCorrection({ distortion: 0.4 });
    expect(useEditorStore.getState().manualLensOverride).toBe(true);
  });

  it("setLensProfile setzt profileId und resettet override", () => {
    useEditorStore.getState().setLensCorrection({ distortion: 0.5 });
    expect(useEditorStore.getState().manualLensOverride).toBe(true);
    useEditorStore.getState().setLensProfile("test-profile");
    expect(useEditorStore.getState().lensProfileId).toBe("test-profile");
    expect(useEditorStore.getState().manualLensOverride).toBe(false);
  });

  it("resetGeometry setzt auch lensProfileId und manualLensOverride zurueck", () => {
    useEditorStore.getState().setLensProfile("p");
    useEditorStore.getState().setLensCorrection({ distortion: 0.5 });
    useEditorStore.getState().resetGeometry();
    const s = useEditorStore.getState();
    expect(s.lensProfileId).toBeNull();
    expect(s.manualLensOverride).toBe(false);
  });

  it("setLinearMaskEnabled toggelt", () => {
    useEditorStore.getState().setLinearMaskEnabled(true);
    expect(useEditorStore.getState().linearMaskEnabled).toBe(true);
    useEditorStore.getState().setLinearMaskEnabled(false);
    expect(useEditorStore.getState().linearMaskEnabled).toBe(false);
  });

  it("setLinearMaskPoint clampt UV in [0,1]", () => {
    useEditorStore.getState().setLinearMaskPoint("p1", { u: -1, v: 2 });
    expect(useEditorStore.getState().linearMask.p1).toEqual({ u: 0, v: 1 });
  });

  it("setLinearMaskFeather clampt", () => {
    useEditorStore.getState().setLinearMaskFeather(99);
    expect(useEditorStore.getState().linearMask.feather).toBe(1);
  });

  it("setLinearLocalAdjustment clampt pro Key", () => {
    useEditorStore.getState().setLinearLocalAdjustment("exposure", 99);
    expect(useEditorStore.getState().linearLocalAdj.exposure).toBe(3);
    useEditorStore.getState().setLinearLocalAdjustment("contrast", 99);
    expect(useEditorStore.getState().linearLocalAdj.contrast).toBe(1);
  });

  it("resetLinearMask setzt enabled, mask und localAdj zurueck", () => {
    useEditorStore.getState().setLinearMaskEnabled(true);
    useEditorStore.getState().setLinearMaskPoint("p1", { u: 0.2, v: 0.3 });
    useEditorStore.getState().setLinearLocalAdjustment("exposure", 1.5);
    useEditorStore.getState().resetLinearMask();
    const s = useEditorStore.getState();
    expect(s.linearMaskEnabled).toBe(false);
    expect(s.linearMask).toEqual(defaultLinearMask());
    expect(s.linearLocalAdj).toEqual(defaultLocalAdjustments());
  });

  it("setRadialMaskEnabled toggelt", () => {
    useEditorStore.getState().setRadialMaskEnabled(true);
    expect(useEditorStore.getState().radialMaskEnabled).toBe(true);
    useEditorStore.getState().setRadialMaskEnabled(false);
    expect(useEditorStore.getState().radialMaskEnabled).toBe(false);
  });

  it("setRadialMaskCenter clampt UV in [0,1]", () => {
    useEditorStore.getState().setRadialMaskCenter({ u: -1, v: 2 });
    expect(useEditorStore.getState().radialMask.center).toEqual({ u: 0, v: 1 });
  });

  it("setRadialMaskRadii clampt rx und ry getrennt", () => {
    useEditorStore.getState().setRadialMaskRadii(99, 0);
    const m = useEditorStore.getState().radialMask;
    expect(m.rx).toBe(1);
    expect(m.ry).toBe(0.02);
  });

  it("setRadialMaskFeather clampt", () => {
    useEditorStore.getState().setRadialMaskFeather(99);
    expect(useEditorStore.getState().radialMask.feather).toBe(1);
    useEditorStore.getState().setRadialMaskFeather(-1);
    expect(useEditorStore.getState().radialMask.feather).toBe(0);
  });

  it("setRadialLocalAdjustment clampt pro Key", () => {
    useEditorStore.getState().setRadialLocalAdjustment("exposure", 99);
    expect(useEditorStore.getState().radialLocalAdj.exposure).toBe(3);
    useEditorStore.getState().setRadialLocalAdjustment("contrast", -99);
    expect(useEditorStore.getState().radialLocalAdj.contrast).toBe(-1);
  });

  it("resetRadialMask setzt enabled, mask und localAdj zurueck", () => {
    useEditorStore.getState().setRadialMaskEnabled(true);
    useEditorStore.getState().setRadialMaskCenter({ u: 0.2, v: 0.3 });
    useEditorStore.getState().setRadialMaskRadii(0.4, 0.5);
    useEditorStore.getState().setRadialLocalAdjustment("exposure", 1.5);
    useEditorStore.getState().resetRadialMask();
    const s = useEditorStore.getState();
    expect(s.radialMaskEnabled).toBe(false);
    expect(s.radialMask).toEqual(defaultRadialMask());
    expect(s.radialLocalAdj).toEqual(defaultLocalAdjustments());
  });
});
