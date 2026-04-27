/**
 * Brücke zwischen runtime MaskInstance (mit id) und Wire-Format
 * (PresetMask, ohne id, exakt was das Backend speichert).
 *
 * Beim Speichern in ein Preset werden IDs verworfen — sie sind nur
 * für Selection im UI. Beim Laden bekommt jede Maske eine frische ID.
 */
import type {
  PresetMask,
  PresetMaskLinear,
  PresetMaskRadial,
} from "../api/client";
import {
  type LinearMaskInstance,
  type MaskInstance,
  type RadialMaskInstance,
  newMaskId,
} from "./mask";

export function maskInstanceToWire(m: MaskInstance): PresetMask {
  if (m.type === "linear") {
    const wire: PresetMaskLinear = {
      type: "linear",
      mask: {
        p1: { u: m.mask.p1.u, v: m.mask.p1.v },
        p2: { u: m.mask.p2.u, v: m.mask.p2.v },
        feather: m.mask.feather,
      },
      localAdj: { ...m.localAdj },
    };
    return wire;
  }
  const wire: PresetMaskRadial = {
    type: "radial",
    mask: {
      center: { u: m.mask.center.u, v: m.mask.center.v },
      rx: m.mask.rx,
      ry: m.mask.ry,
      feather: m.mask.feather,
    },
    localAdj: { ...m.localAdj },
  };
  return wire;
}

export function wireToMaskInstance(w: PresetMask): MaskInstance {
  const id = newMaskId();
  if (w.type === "linear") {
    const inst: LinearMaskInstance = {
      id,
      type: "linear",
      mask: {
        type: "linear",
        p1: { u: w.mask.p1.u, v: w.mask.p1.v },
        p2: { u: w.mask.p2.u, v: w.mask.p2.v },
        feather: w.mask.feather,
      },
      localAdj: { ...w.localAdj },
    };
    return inst;
  }
  const inst: RadialMaskInstance = {
    id,
    type: "radial",
    mask: {
      type: "radial",
      center: { u: w.mask.center.u, v: w.mask.center.v },
      rx: w.mask.rx,
      ry: w.mask.ry,
      feather: w.mask.feather,
    },
    localAdj: { ...w.localAdj },
  };
  return inst;
}

export function masksToWire(
  masks: ReadonlyArray<MaskInstance>,
): PresetMask[] {
  return masks.map(maskInstanceToWire);
}

export function wireToMasks(
  wire: ReadonlyArray<PresetMask>,
): MaskInstance[] {
  return wire.map(wireToMaskInstance);
}
