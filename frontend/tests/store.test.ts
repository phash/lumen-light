import { beforeEach, describe, expect, it } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { defaultLensCorrection } from "../src/editor/lens";
import { MAX_LINEAR_MASKS, MAX_RADIAL_MASKS } from "../src/editor/mask";
import {
  MAX_STRAIGHTEN_RADIANS,
  selectedMask,
  useEditorStore,
} from "../src/editor/store";
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
      masks: [],
      selectedMaskId: null,
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
});

describe("Multi-Mask", () => {
  beforeEach(() => {
    useEditorStore.setState({ masks: [], selectedMaskId: null });
  });

  it("addLinearMask haengt eine Linear-Maske an und selektiert sie", () => {
    const id = useEditorStore.getState().addLinearMask();
    expect(id).not.toBeNull();
    const s = useEditorStore.getState();
    expect(s.masks).toHaveLength(1);
    expect(s.masks[0]!.type).toBe("linear");
    expect(s.selectedMaskId).toBe(id);
  });

  it("addRadialMask haengt eine Radial-Maske an und selektiert sie", () => {
    const id = useEditorStore.getState().addRadialMask();
    const s = useEditorStore.getState();
    expect(s.masks).toHaveLength(1);
    expect(s.masks[0]!.type).toBe("radial");
    expect(s.selectedMaskId).toBe(id);
  });

  it("Linear+Radial koexistieren in einer Liste", () => {
    useEditorStore.getState().addLinearMask();
    useEditorStore.getState().addRadialMask();
    useEditorStore.getState().addLinearMask();
    const s = useEditorStore.getState();
    expect(s.masks).toHaveLength(3);
    expect(s.masks.map((m) => m.type)).toEqual(["linear", "radial", "linear"]);
  });

  it("addLinearMask gibt null zurueck wenn MAX_LINEAR_MASKS erreicht ist", () => {
    for (let i = 0; i < MAX_LINEAR_MASKS; i++) {
      expect(useEditorStore.getState().addLinearMask()).not.toBeNull();
    }
    expect(useEditorStore.getState().addLinearMask()).toBeNull();
    expect(useEditorStore.getState().masks).toHaveLength(MAX_LINEAR_MASKS);
  });

  it("addRadialMask gibt null zurueck wenn MAX_RADIAL_MASKS erreicht ist", () => {
    for (let i = 0; i < MAX_RADIAL_MASKS; i++) {
      expect(useEditorStore.getState().addRadialMask()).not.toBeNull();
    }
    expect(useEditorStore.getState().addRadialMask()).toBeNull();
  });

  it("removeMask entfernt die Maske und clearet Selection wenn betroffen", () => {
    const a = useEditorStore.getState().addLinearMask()!;
    const b = useEditorStore.getState().addLinearMask()!;
    expect(useEditorStore.getState().selectedMaskId).toBe(b);
    useEditorStore.getState().removeMask(b);
    expect(useEditorStore.getState().masks).toHaveLength(1);
    expect(useEditorStore.getState().selectedMaskId).toBeNull();
    // unbetroffene Maske bleibt
    expect(useEditorStore.getState().masks[0]!.id).toBe(a);
  });

  it("removeMask laesst Selection unveraendert wenn andere Maske geloescht wird", () => {
    const a = useEditorStore.getState().addLinearMask()!;
    const b = useEditorStore.getState().addLinearMask()!;
    useEditorStore.getState().selectMask(a);
    useEditorStore.getState().removeMask(b);
    expect(useEditorStore.getState().selectedMaskId).toBe(a);
  });

  it("selectMask wechselt Selektion, ignoriert unbekannte IDs", () => {
    const a = useEditorStore.getState().addLinearMask()!;
    const b = useEditorStore.getState().addRadialMask()!;
    useEditorStore.getState().selectMask(a);
    expect(useEditorStore.getState().selectedMaskId).toBe(a);
    useEditorStore.getState().selectMask("nonexistent-id");
    expect(useEditorStore.getState().selectedMaskId).toBe(a);
    useEditorStore.getState().selectMask(b);
    expect(useEditorStore.getState().selectedMaskId).toBe(b);
    useEditorStore.getState().selectMask(null);
    expect(useEditorStore.getState().selectedMaskId).toBeNull();
  });

  it("setLinearMaskPoint clampt UV und greift nur fuer Linear-Masken", () => {
    const id = useEditorStore.getState().addLinearMask()!;
    useEditorStore.getState().setLinearMaskPoint(id, "p1", { u: -1, v: 2 });
    const m = useEditorStore.getState().masks[0]!;
    if (m.type !== "linear") throw new Error("expected linear");
    expect(m.mask.p1).toEqual({ u: 0, v: 1 });
  });

  it("setRadialMaskCenter clampt UV", () => {
    const id = useEditorStore.getState().addRadialMask()!;
    useEditorStore.getState().setRadialMaskCenter(id, { u: -1, v: 2 });
    const m = useEditorStore.getState().masks[0]!;
    if (m.type !== "radial") throw new Error("expected radial");
    expect(m.mask.center).toEqual({ u: 0, v: 1 });
  });

  it("setRadialMaskRadii clampt rx und ry getrennt", () => {
    const id = useEditorStore.getState().addRadialMask()!;
    useEditorStore.getState().setRadialMaskRadii(id, 99, 0);
    const m = useEditorStore.getState().masks[0]!;
    if (m.type !== "radial") throw new Error("expected radial");
    expect(m.mask.rx).toBe(1);
    expect(m.mask.ry).toBe(0.02);
  });

  it("setMaskFeather klemmt + funktioniert fuer Linear und Radial", () => {
    const lin = useEditorStore.getState().addLinearMask()!;
    const rad = useEditorStore.getState().addRadialMask()!;
    useEditorStore.getState().setMaskFeather(lin, 99);
    useEditorStore.getState().setMaskFeather(rad, -1);
    const masks = useEditorStore.getState().masks;
    expect(masks[0]!.mask.feather).toBe(1);
    expect(masks[1]!.mask.feather).toBe(0);
  });

  it("setMaskLocalAdjustment clampt pro Key", () => {
    const id = useEditorStore.getState().addLinearMask()!;
    useEditorStore.getState().setMaskLocalAdjustment(id, "exposure", 99);
    expect(useEditorStore.getState().masks[0]!.localAdj.exposure).toBe(3);
    useEditorStore.getState().setMaskLocalAdjustment(id, "contrast", -99);
    expect(useEditorStore.getState().masks[0]!.localAdj.contrast).toBe(-1);
  });

  it("removeSelectedMask entfernt nur die selektierte Maske", () => {
    const a = useEditorStore.getState().addLinearMask()!;
    useEditorStore.getState().addLinearMask();
    useEditorStore.getState().selectMask(a);
    useEditorStore.getState().removeSelectedMask();
    const s = useEditorStore.getState();
    expect(s.masks).toHaveLength(1);
    expect(s.selectedMaskId).toBeNull();
  });

  it("removeSelectedMask ist no-op ohne Selection", () => {
    useEditorStore.getState().addLinearMask();
    useEditorStore.getState().selectMask(null);
    useEditorStore.getState().removeSelectedMask();
    expect(useEditorStore.getState().masks).toHaveLength(1);
  });

  it("clearMasks leert die Liste komplett", () => {
    useEditorStore.getState().addLinearMask();
    useEditorStore.getState().addRadialMask();
    useEditorStore.getState().clearMasks();
    const s = useEditorStore.getState();
    expect(s.masks).toEqual([]);
    expect(s.selectedMaskId).toBeNull();
  });

  it("selectedMask-Selector liefert die selektierte Maske oder null", () => {
    expect(selectedMask(useEditorStore.getState())).toBeNull();
    const id = useEditorStore.getState().addLinearMask()!;
    const m = selectedMask(useEditorStore.getState());
    expect(m?.id).toBe(id);
    expect(m?.type).toBe("linear");
  });

  it("Mask-IDs sind eindeutig", () => {
    const ids = new Set<string>();
    for (let i = 0; i < MAX_LINEAR_MASKS; i++) {
      const id = useEditorStore.getState().addLinearMask()!;
      ids.add(id);
    }
    for (let i = 0; i < MAX_RADIAL_MASKS; i++) {
      const id = useEditorStore.getState().addRadialMask()!;
      ids.add(id);
    }
    expect(ids.size).toBe(MAX_LINEAR_MASKS + MAX_RADIAL_MASKS);
  });

  it("applyMasks ersetzt die Liste atomar und respektiert Caps", () => {
    useEditorStore.getState().addLinearMask();
    useEditorStore.getState().addRadialMask();
    // Eingabe bewusst ueber Cap: 5 linear + 5 radial -> auf 4+4 truncaten
    const incoming = [
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `lin-${i}`,
        type: "linear" as const,
        mask: { type: "linear" as const, p1: { u: 0, v: 0 }, p2: { u: 1, v: 1 }, feather: 0.4 },
        localAdj: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 },
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        id: `rad-${i}`,
        type: "radial" as const,
        mask: { type: "radial" as const, center: { u: 0.5, v: 0.5 }, rx: 0.25, ry: 0.25, feather: 0.4 },
        localAdj: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 },
      })),
    ];
    useEditorStore.getState().applyMasks(incoming);
    const s = useEditorStore.getState();
    expect(s.masks.filter((m) => m.type === "linear")).toHaveLength(MAX_LINEAR_MASKS);
    expect(s.masks.filter((m) => m.type === "radial")).toHaveLength(MAX_RADIAL_MASKS);
    expect(s.selectedMaskId).toBeNull();
  });

  it("applyMasks([]) leert die Liste", () => {
    useEditorStore.getState().addLinearMask();
    useEditorStore.getState().applyMasks([]);
    expect(useEditorStore.getState().masks).toEqual([]);
    expect(useEditorStore.getState().selectedMaskId).toBeNull();
  });
});
