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
  type CropRect,
  clampCropRect,
  defaultCropRect,
} from "./transform";

export const MAX_STRAIGHTEN_RADIANS = (10 * Math.PI) / 180; // ±10°

export interface EditorState {
  adjustments: Adjustments;
  bypass: boolean;
  cropRect: CropRect;
  straightenAngle: number;
  lensCorrection: LensCorrection;
  setAdjustment: (key: AdjustmentKey, value: number) => void;
  resetAll: () => void;
  applyAdjustments: (adj: Partial<Adjustments>) => void;
  setBypass: (bypass: boolean) => void;
  setCropRect: (rect: CropRect) => void;
  setStraightenAngle: (angle: number) => void;
  setLensCorrection: (next: Partial<LensCorrection>) => void;
  resetGeometry: () => void;
}

export const useEditorStore = create<EditorState>((set) => ({
  adjustments: defaultAdjustments(),
  bypass: false,
  cropRect: defaultCropRect(),
  straightenAngle: 0,
  lensCorrection: defaultLensCorrection(),
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
  setLensCorrection: (next) =>
    set((state) => ({
      lensCorrection: clampLens({ ...state.lensCorrection, ...next }),
    })),
  resetGeometry: () =>
    set({
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
    }),
}));
