import { create } from "zustand";

import {
  type AdjustmentKey,
  type Adjustments,
  clampAdjustment,
  defaultAdjustments,
} from "./adjustments";
import {
  type LensCorrection,
  clampLens,
  defaultLensCorrection,
} from "./lens";
import {
  type LinearMaskInstance,
  type LocalAdjustments,
  MAX_LINEAR_MASKS,
  MAX_RADIAL_MASKS,
  type MaskInstance,
  type PointUv,
  type RadialMaskInstance,
  clampFeather,
  clampLocalAdjustment,
  clampRadius,
  clampUv,
  defaultLinearMask,
  defaultLocalAdjustments,
  defaultRadialMask,
} from "./mask";
import {
  type CropRect,
  clampCropRect,
  defaultCropRect,
} from "./transform";

export const MAX_STRAIGHTEN_RADIANS = (10 * Math.PI) / 180; // ±10°

export type LensSource = "manual" | "auto";

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m-${Math.random().toString(36).slice(2, 10)}`;
}

export interface EditorState {
  adjustments: Adjustments;
  bypass: boolean;
  cropRect: CropRect;
  straightenAngle: number;
  lensCorrection: LensCorrection;
  lensProfileId: string | null;
  manualLensOverride: boolean;
  masks: ReadonlyArray<MaskInstance>;
  selectedMaskId: string | null;
  setAdjustment: (key: AdjustmentKey, value: number) => void;
  resetAll: () => void;
  applyAdjustments: (adj: Partial<Adjustments>) => void;
  setBypass: (bypass: boolean) => void;
  setCropRect: (rect: CropRect) => void;
  setStraightenAngle: (angle: number) => void;
  setLensCorrection: (next: Partial<LensCorrection>, source?: LensSource) => void;
  setLensProfile: (id: string | null) => void;
  resetGeometry: () => void;
  addLinearMask: () => string | null;
  addRadialMask: () => string | null;
  removeMask: (id: string) => void;
  selectMask: (id: string | null) => void;
  setLinearMaskPoint: (id: string, which: "p1" | "p2", uv: PointUv) => void;
  setRadialMaskCenter: (id: string, uv: PointUv) => void;
  setRadialMaskRadii: (id: string, rx: number, ry: number) => void;
  setMaskFeather: (id: string, feather: number) => void;
  setMaskLocalAdjustment: (
    id: string,
    key: keyof LocalAdjustments,
    value: number,
  ) => void;
  removeSelectedMask: () => void;
  clearMasks: () => void;
}

function findMask(
  masks: ReadonlyArray<MaskInstance>,
  id: string,
): MaskInstance | undefined {
  return masks.find((m) => m.id === id);
}

function countByType(
  masks: ReadonlyArray<MaskInstance>,
  type: "linear" | "radial",
): number {
  let n = 0;
  for (const m of masks) if (m.type === type) n++;
  return n;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  adjustments: defaultAdjustments(),
  bypass: false,
  cropRect: defaultCropRect(),
  straightenAngle: 0,
  lensCorrection: defaultLensCorrection(),
  lensProfileId: null,
  manualLensOverride: false,
  masks: [],
  selectedMaskId: null,
  setAdjustment: (key, value) =>
    set((state) => ({
      adjustments: { ...state.adjustments, [key]: clampAdjustment(key, value) },
    })),
  resetAll: () => set({ adjustments: defaultAdjustments() }),
  applyAdjustments: (incoming) =>
    set(() => {
      const base = defaultAdjustments();
      const merged: Adjustments = { ...base };
      for (const [k, v] of Object.entries(incoming) as [AdjustmentKey, number][]) {
        merged[k] = clampAdjustment(k, v);
      }
      return { adjustments: merged };
    }),
  setBypass: (bypass) => set({ bypass }),
  setCropRect: (rect) => set({ cropRect: clampCropRect(rect) }),
  setStraightenAngle: (angle) =>
    set({
      straightenAngle: Math.max(
        -MAX_STRAIGHTEN_RADIANS,
        Math.min(MAX_STRAIGHTEN_RADIANS, angle),
      ),
    }),
  setLensCorrection: (next, source = "manual") =>
    set((state) => ({
      lensCorrection: clampLens({ ...state.lensCorrection, ...next }),
      manualLensOverride:
        source === "manual" ? true : state.manualLensOverride,
    })),
  setLensProfile: (id) => set({ lensProfileId: id, manualLensOverride: false }),
  resetGeometry: () =>
    set({
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
    }),
  addLinearMask: () => {
    const state = get();
    if (countByType(state.masks, "linear") >= MAX_LINEAR_MASKS) return null;
    const id = newId();
    const instance: LinearMaskInstance = {
      id,
      type: "linear",
      mask: defaultLinearMask(),
      localAdj: defaultLocalAdjustments(),
    };
    set({ masks: [...state.masks, instance], selectedMaskId: id });
    return id;
  },
  addRadialMask: () => {
    const state = get();
    if (countByType(state.masks, "radial") >= MAX_RADIAL_MASKS) return null;
    const id = newId();
    const instance: RadialMaskInstance = {
      id,
      type: "radial",
      mask: defaultRadialMask(),
      localAdj: defaultLocalAdjustments(),
    };
    set({ masks: [...state.masks, instance], selectedMaskId: id });
    return id;
  },
  removeMask: (id) =>
    set((state) => ({
      masks: state.masks.filter((m) => m.id !== id),
      selectedMaskId:
        state.selectedMaskId === id ? null : state.selectedMaskId,
    })),
  selectMask: (id) =>
    set((state) => {
      if (id === null) return { selectedMaskId: null };
      return findMask(state.masks, id) ? { selectedMaskId: id } : state;
    }),
  setLinearMaskPoint: (id, which, uv) =>
    set((state) => ({
      masks: state.masks.map((m) =>
        m.id === id && m.type === "linear"
          ? { ...m, mask: { ...m.mask, [which]: clampUv(uv) } }
          : m,
      ),
    })),
  setRadialMaskCenter: (id, uv) =>
    set((state) => ({
      masks: state.masks.map((m) =>
        m.id === id && m.type === "radial"
          ? { ...m, mask: { ...m.mask, center: clampUv(uv) } }
          : m,
      ),
    })),
  setRadialMaskRadii: (id, rx, ry) =>
    set((state) => ({
      masks: state.masks.map((m) =>
        m.id === id && m.type === "radial"
          ? {
              ...m,
              mask: { ...m.mask, rx: clampRadius(rx), ry: clampRadius(ry) },
            }
          : m,
      ),
    })),
  setMaskFeather: (id, feather) =>
    set((state) => ({
      masks: state.masks.map((m): MaskInstance => {
        if (m.id !== id) return m;
        const f = clampFeather(feather);
        if (m.type === "linear") {
          return { ...m, mask: { ...m.mask, feather: f } };
        }
        return { ...m, mask: { ...m.mask, feather: f } };
      }),
    })),
  setMaskLocalAdjustment: (id, key, value) =>
    set((state) => ({
      masks: state.masks.map((m) =>
        m.id === id
          ? {
              ...m,
              localAdj: {
                ...m.localAdj,
                [key]: clampLocalAdjustment(key, value),
              },
            }
          : m,
      ),
    })),
  removeSelectedMask: () => {
    const id = get().selectedMaskId;
    if (id === null) return;
    set((state) => ({
      masks: state.masks.filter((m) => m.id !== id),
      selectedMaskId: null,
    }));
  },
  clearMasks: () => set({ masks: [], selectedMaskId: null }),
}));

export function selectedMask(state: EditorState): MaskInstance | null {
  if (state.selectedMaskId === null) return null;
  return findMask(state.masks, state.selectedMaskId) ?? null;
}
