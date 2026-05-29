import { beforeEach, describe, expect, it } from "vitest";

import { ADJUSTMENTS, defaultAdjustments, defaultHslAdjustments } from "../src/editor/adjustments";
import { takeSnapshot } from "../src/editor/history";
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
    for (const a of ADJUSTMENTS) {
      expect(state.adjustments[a.key]).toBe(0);
    }
    expect(state.adjustments.hsl).toBeNull();
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
    useEditorStore.getState().setHslChannel("saturation", "red", 0.5);
    useEditorStore.getState().resetAll();
    const adj = useEditorStore.getState().adjustments;
    for (const a of ADJUSTMENTS) {
      expect(adj[a.key]).toBe(0);
    }
    expect(adj.hsl).toBeNull();
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

  it("applyAdjustments uebernimmt hsl-Objekt komplett (kein deep-merge)", () => {
    useEditorStore.getState().setHslChannel("hue", "red", 0.4);
    const incoming = defaultHslAdjustments();
    const tweaked = {
      ...incoming,
      saturation: { ...incoming.saturation, blue: -0.6 },
    };
    useEditorStore.getState().applyAdjustments({ hsl: tweaked });
    const adj = useEditorStore.getState().adjustments;
    expect(adj.hsl).not.toBeNull();
    expect(adj.hsl!.hue.red).toBe(0);
    expect(adj.hsl!.saturation.blue).toBe(-0.6);
  });

  it("applyAdjustments mit hsl=null setzt HSL zurueck", () => {
    useEditorStore.getState().setHslChannel("hue", "red", 0.4);
    useEditorStore.getState().applyAdjustments({ hsl: null });
    expect(useEditorStore.getState().adjustments.hsl).toBeNull();
  });

  it("setHslChannel erzeugt hsl-Objekt aus null und setzt Wert", () => {
    expect(useEditorStore.getState().adjustments.hsl).toBeNull();
    useEditorStore.getState().setHslChannel("saturation", "green", 0.5);
    const adj = useEditorStore.getState().adjustments;
    expect(adj.hsl).not.toBeNull();
    expect(adj.hsl!.saturation.green).toBe(0.5);
    expect(adj.hsl!.hue.red).toBe(0);
  });

  it("setHslChannel clampt Werte ausserhalb [-1,1]", () => {
    useEditorStore.getState().setHslChannel("luminance", "blue", 99);
    expect(useEditorStore.getState().adjustments.hsl!.luminance.blue).toBe(1);
    useEditorStore.getState().setHslChannel("luminance", "blue", -99);
    expect(useEditorStore.getState().adjustments.hsl!.luminance.blue).toBe(-1);
  });

  it("setHslChannel auf 0 setzt hsl zurueck auf null wenn alle 24 = 0", () => {
    useEditorStore.getState().setHslChannel("hue", "red", 0.4);
    expect(useEditorStore.getState().adjustments.hsl).not.toBeNull();
    useEditorStore.getState().setHslChannel("hue", "red", 0);
    expect(useEditorStore.getState().adjustments.hsl).toBeNull();
  });

  it("resetHsl setzt hsl auf null", () => {
    useEditorStore.getState().setHslChannel("hue", "red", 0.4);
    useEditorStore.getState().setHslChannel("saturation", "blue", -0.2);
    useEditorStore.getState().resetHsl();
    expect(useEditorStore.getState().adjustments.hsl).toBeNull();
  });

  it("setToneCurvePoint baut Kurve aus null und ueberschreibt y des Endpunkts", () => {
    expect(useEditorStore.getState().adjustments.toneCurve).toBeNull();
    useEditorStore.getState().setToneCurvePoint(1, 0.5, 0.7);
    const c = useEditorStore.getState().adjustments.toneCurve;
    expect(c).not.toBeNull();
    // Endpunkt-x muss auf 1 fixiert bleiben.
    expect(c!.points[1]!.x).toBe(1);
    expect(c!.points[1]!.y).toBe(0.7);
  });

  it("setToneCurvePoint clampt innere Punkte zwischen Nachbarn", () => {
    useEditorStore.getState().addToneCurvePoint(0.4, 0.4);
    useEditorStore.getState().setToneCurvePoint(1, 1.5, 0.5);
    const c = useEditorStore.getState().adjustments.toneCurve!;
    // x wurde auf < 1 (max wegen Endpunkt) geklemmt.
    expect(c.points[1]!.x).toBeLessThan(1);
    expect(c.points[1]!.x).toBeGreaterThan(0);
  });

  it("addToneCurvePoint sortiert nach x und respektiert Maximum", () => {
    useEditorStore.getState().addToneCurvePoint(0.7, 0.6);
    useEditorStore.getState().addToneCurvePoint(0.3, 0.2);
    const points = useEditorStore.getState().adjustments.toneCurve!.points;
    const xs = points.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(points.length).toBe(4);
  });

  it("removeToneCurvePoint entfernt nur innere Punkte", () => {
    useEditorStore.getState().addToneCurvePoint(0.4, 0.5);
    useEditorStore.getState().removeToneCurvePoint(0); // Endpunkt → no-op
    expect(useEditorStore.getState().adjustments.toneCurve!.points.length).toBe(3);
    useEditorStore.getState().removeToneCurvePoint(1);
    // Bleibt Identitaet (2 Punkte (0,0)/(1,1)) → toneCurve wird null.
    expect(useEditorStore.getState().adjustments.toneCurve).toBeNull();
  });

  it("resetToneCurve setzt auf null", () => {
    useEditorStore.getState().addToneCurvePoint(0.4, 0.5);
    useEditorStore.getState().resetToneCurve();
    expect(useEditorStore.getState().adjustments.toneCurve).toBeNull();
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
      tcaR: 0,
      tcaB: 0,
    });
    useEditorStore.getState().setLensCorrection({ vignette: -0.4 });
    expect(useEditorStore.getState().lensCorrection).toEqual({
      distortion: 0.5,
      vignette: -0.4,
      tcaR: 0,
      tcaB: 0,
    });
  });

  it("setLensCorrection clampt auf [-1, 1]", () => {
    useEditorStore.getState().setLensCorrection({
      distortion: 99,
      vignette: -99,
      tcaR: 5,
      tcaB: -5,
    });
    expect(useEditorStore.getState().lensCorrection).toEqual({
      distortion: 1,
      vignette: -1,
      tcaR: 1,
      tcaB: -1,
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

  it("applyEditState setzt den kompletten Stand und leert die History (C1)", () => {
    // History vorab fuellen, um zu pruefen, dass applyEditState sie leert.
    const snap = takeSnapshot(useEditorStore.getState());
    useEditorStore.setState({ past: [snap], future: [snap] });
    expect(useEditorStore.getState().past).toHaveLength(1);

    useEditorStore.getState().applyEditState({
      adjustments: { exposure: 0.6 },
      masks: [],
      cropRect: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 },
      straightenAngle: 0.05,
      lensCorrection: { distortion: 0.2, vignette: -0.1, tcaR: 0, tcaB: 0 },
      lensProfileId: "p-1",
      manualLensOverride: true,
    });

    const s = useEditorStore.getState();
    expect(s.adjustments.exposure).toBe(0.6);
    // Nicht uebergebene Felder fallen auf Default zurueck (nicht alter State).
    expect(s.adjustments.contrast).toBe(0);
    expect(s.cropRect).toEqual({ x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 });
    expect(s.straightenAngle).toBeCloseTo(0.05);
    expect(s.lensCorrection.distortion).toBe(0.2);
    expect(s.lensProfileId).toBe("p-1");
    expect(s.manualLensOverride).toBe(true);
    expect(s.past).toEqual([]);
    expect(s.future).toEqual([]);
  });
});
