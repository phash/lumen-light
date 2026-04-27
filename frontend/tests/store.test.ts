import { beforeEach, describe, expect, it } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { useEditorStore } from "../src/editor/store";

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.setState({
      adjustments: defaultAdjustments(),
      bypass: false,
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
});
