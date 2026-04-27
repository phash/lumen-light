import { describe, expect, it } from "vitest";

import type { PresetMask } from "../src/api/client";
import { defaultLinearMask, defaultRadialMask } from "../src/editor/mask";
import {
  maskInstanceToWire,
  masksToWire,
  wireToMaskInstance,
  wireToMasks,
} from "../src/editor/maskSerializer";

describe("maskInstanceToWire", () => {
  it("Linear-Instanz -> Wire ohne id", () => {
    const inst = {
      id: "abc",
      type: "linear" as const,
      mask: defaultLinearMask(),
      localAdj: { exposure: 1, contrast: 0, saturation: 0, temperature: 0 },
    };
    const w = maskInstanceToWire(inst);
    expect(w).not.toHaveProperty("id");
    expect(w.type).toBe("linear");
    expect(w.localAdj.exposure).toBe(1);
  });

  it("Radial-Instanz -> Wire mit center+rx+ry", () => {
    const inst = {
      id: "xyz",
      type: "radial" as const,
      mask: defaultRadialMask(),
      localAdj: { exposure: 0, contrast: 0, saturation: 0.3, temperature: 0 },
    };
    const w = maskInstanceToWire(inst);
    if (w.type !== "radial") throw new Error("expected radial");
    expect(w.mask.rx).toBe(0.25);
    expect(w.mask.center).toEqual({ u: 0.5, v: 0.5 });
  });
});

describe("wireToMaskInstance", () => {
  it("vergibt frische ID", () => {
    const w: PresetMask = {
      type: "linear",
      mask: { p1: { u: 0, v: 0 }, p2: { u: 1, v: 1 }, feather: 0.4 },
      localAdj: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 },
    };
    const a = wireToMaskInstance(w);
    const b = wireToMaskInstance(w);
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
    expect(a.type).toBe("linear");
  });

  it("Radial wire -> Instanz mit type='radial' im inneren mask-Objekt", () => {
    const w: PresetMask = {
      type: "radial",
      mask: { center: { u: 0.4, v: 0.6 }, rx: 0.3, ry: 0.2, feather: 0.5 },
      localAdj: { exposure: 0, contrast: 0, saturation: 0, temperature: 0 },
    };
    const inst = wireToMaskInstance(w);
    if (inst.type !== "radial") throw new Error("expected radial");
    expect(inst.mask.type).toBe("radial");
    expect(inst.mask.rx).toBe(0.3);
  });
});

describe("Roundtrip", () => {
  it("masksToWire + wireToMasks erhaelt alle Felder ausser ID", () => {
    const original = [
      {
        id: "a",
        type: "linear" as const,
        mask: { type: "linear" as const, p1: { u: 0.2, v: 0 }, p2: { u: 0.8, v: 1 }, feather: 0.3 },
        localAdj: { exposure: 1.5, contrast: 0.2, saturation: -0.1, temperature: 0.05 },
      },
      {
        id: "b",
        type: "radial" as const,
        mask: { type: "radial" as const, center: { u: 0.5, v: 0.5 }, rx: 0.4, ry: 0.2, feather: 0.6 },
        localAdj: { exposure: -0.5, contrast: 0, saturation: 0.3, temperature: 0 },
      },
    ];
    const wire = masksToWire(original);
    expect(wire).toHaveLength(2);
    const restored = wireToMasks(wire);
    // IDs unterschiedlich, aber Inhalte identisch
    expect(restored[0]!.id).not.toBe("a");
    expect(restored[0]!.type).toBe("linear");
    if (restored[0]!.type === "linear" && original[0]!.type === "linear") {
      expect(restored[0]!.mask.p1).toEqual(original[0]!.mask.p1);
      expect(restored[0]!.mask.feather).toBe(0.3);
      expect(restored[0]!.localAdj).toEqual(original[0]!.localAdj);
    }
    if (restored[1]!.type === "radial" && original[1]!.type === "radial") {
      expect(restored[1]!.mask.center).toEqual(original[1]!.mask.center);
      expect(restored[1]!.mask.rx).toBe(0.4);
      expect(restored[1]!.localAdj.saturation).toBe(0.3);
    }
  });

  it("leeres Array -> leeres Array (beide Richtungen)", () => {
    expect(masksToWire([])).toEqual([]);
    expect(wireToMasks([])).toEqual([]);
  });
});
