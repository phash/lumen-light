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
  type LinearMask,
  type LocalAdjustments,
  type PointUv,
  clampFeather,
  clampLocalAdjustment,
  clampUv,
  defaultLinearMask,
  defaultLocalAdjustments,
} from "./mask";
import {
  type CropRect,
  clampCropRect,
  defaultCropRect,
} from "./transform";

export const MAX_STRAIGHTEN_RADIANS = (10 * Math.PI) / 180; // ±10°

export type LensSource = "manual" | "auto";

export interface EditorState {
  adjustments: Adjustments;
  bypass: boolean;
  cropRect: CropRect;
  straightenAngle: number;
  lensCorrection: LensCorrection;
  lensProfileId: string | null;
  manualLensOverride: boolean;
  linearMaskEnabled: boolean;
  linearMask: LinearMask;
  linearLocalAdj: LocalAdjustments;
  setAdjustment: (key: AdjustmentKey, value: number) => void;
  resetAll: () => void;
  applyAdjustments: (adj: Partial<Adjustments>) => void;
  setBypass: (bypass: boolean) => void;
  setCropRect: (rect: CropRect) => void;
  setStraightenAngle: (angle: number) => void;
  setLensCorrection: (next: Partial<LensCorrection>, source?: LensSource) => void;
  setLensProfile: (id: string | null) => void;
  resetGeometry: () => void;
  setLinearMaskEnabled: (enabled: boolean) => void;
  setLinearMaskPoint: (which: "p1" | "p2", uv: PointUv) => void;
  setLinearMaskFeather: (feather: number) => void;
  setLinearLocalAdjustment: (
    key: keyof LocalAdjustments,
    value: number,
  ) => void;
  resetLinearMask: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
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
  setLinearMaskEnabled: (enabled) => set({ linearMaskEnabled: enabled }),
  setLinearMaskPoint: (which, uv) =>
    set((state) => ({
      linearMask: { ...state.linearMask, [which]: clampUv(uv) },
    })),
  setLinearMaskFeather: (feather) =>
    set((state) => ({
      linearMask: { ...state.linearMask, feather: clampFeather(feather) },
    })),
  setLinearLocalAdjustment: (key, value) =>
    set((state) => ({
      linearLocalAdj: {
        ...state.linearLocalAdj,
        [key]: clampLocalAdjustment(key, value),
      },
    })),
  resetLinearMask: () =>
    set({
      linearMaskEnabled: false,
      linearMask: defaultLinearMask(),
      linearLocalAdj: defaultLocalAdjustments(),
    }),
}));
