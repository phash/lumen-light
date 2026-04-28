import { create } from "zustand";

import {
  type AdjustmentKey,
  type Adjustments,
  type HslAdjustments,
  type HslAxis,
  type HslChannel,
  TONE_CURVE_MAX_POINTS,
  TONE_CURVE_MIN_POINTS,
  type ToneCurve,
  type ToneCurvePoint,
  clampAdjustment,
  defaultAdjustments,
  defaultHslAdjustments,
  defaultToneCurve,
  isHslNeutral,
  isToneCurveIdentity,
} from "./adjustments";
import {
  type DebounceContext,
  type HistorySnapshot,
  MAX_HISTORY,
  captureBeforeChange,
  flushPending,
  makeDebounce,
  takeSnapshot,
} from "./history";
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
  newMaskId,
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
  masks: ReadonlyArray<MaskInstance>;
  selectedMaskId: string | null;
  setAdjustment: (key: AdjustmentKey, value: number) => void;
  resetAll: () => void;
  applyAdjustments: (adj: Partial<Adjustments>) => void;
  setHslChannel: (axis: HslAxis, channel: HslChannel, value: number) => void;
  resetHsl: () => void;
  setToneCurvePoint: (index: number, x: number, y: number) => void;
  addToneCurvePoint: (x: number, y: number) => number | null;
  removeToneCurvePoint: (index: number) => void;
  resetToneCurve: () => void;
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
  applyMasks: (masks: ReadonlyArray<MaskInstance>) => void;
  past: ReadonlyArray<HistorySnapshot>;
  future: ReadonlyArray<HistorySnapshot>;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
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

// Module-scoped Debounce — Snapshots werden nur gepusht, wenn 250 ms
// keine weitere Aenderung kommt. So entsteht aus einem Slider-Drag mit
// 100 onChange-Events EIN History-Eintrag.
const _historyDebounce: DebounceContext = makeDebounce();

function _snapshotBefore(state: EditorState): void {
  captureBeforeChange(_historyDebounce, state, {
    pushPast: (snap) => {
      useEditorStore.setState((s) => ({
        past: [...s.past.slice(-(MAX_HISTORY - 1)), snap],
        future: [],
      }));
    },
  });
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
  past: [],
  future: [],
  setAdjustment: (key, value) => {
    _snapshotBefore(get());
    set((state) => ({
      adjustments: { ...state.adjustments, [key]: clampAdjustment(key, value) },
    }));
  },
  resetAll: () => {
    _snapshotBefore(get());
    set({ adjustments: defaultAdjustments() });
  },
  applyAdjustments: (incoming) => {
    _snapshotBefore(get());
    set(() => {
      const base = defaultAdjustments();
      const merged: Record<AdjustmentKey, number> & {
        hsl: HslAdjustments | null;
        toneCurve: ToneCurve | null;
      } = { ...base };
      for (const [k, v] of Object.entries(incoming)) {
        if (k === "hsl" || k === "toneCurve") continue;
        const key = k as AdjustmentKey;
        merged[key] = clampAdjustment(key, v as number);
      }
      if ("hsl" in incoming) merged.hsl = incoming.hsl ?? null;
      if ("toneCurve" in incoming) merged.toneCurve = incoming.toneCurve ?? null;
      return { adjustments: merged };
    });
  },
  setHslChannel: (axis, channel, value) => {
    _snapshotBefore(get());
    const v = Math.max(-1, Math.min(1, Number.isNaN(value) ? 0 : value));
    set((state) => {
      const base: HslAdjustments = state.adjustments.hsl ?? defaultHslAdjustments();
      const nextAxis = { ...base[axis], [channel]: v };
      const next: HslAdjustments = { ...base, [axis]: nextAxis };
      return {
        adjustments: {
          ...state.adjustments,
          hsl: isHslNeutral(next) ? null : next,
        },
      };
    });
  },
  resetHsl: () => {
    _snapshotBefore(get());
    set((state) => ({ adjustments: { ...state.adjustments, hsl: null } }));
  },
  setToneCurvePoint: (index, x, y) => {
    _snapshotBefore(get());
    set((state) => {
      const curve: ToneCurve = state.adjustments.toneCurve ?? defaultToneCurve();
      const points = [...curve.points];
      const last = points.length - 1;
      if (index < 0 || index > last) return state;
      // Endpunkte: x bleibt fix (0 bzw. 1), nur y darf bewegt werden.
      let nextX = Math.max(0, Math.min(1, Number.isNaN(x) ? 0 : x));
      const nextY = Math.max(0, Math.min(1, Number.isNaN(y) ? 0 : y));
      if (index === 0) nextX = 0;
      else if (index === last) nextX = 1;
      else {
        const prev = points[index - 1]!;
        const next = points[index + 1]!;
        // Mindestabstand 1/255, damit keine zwei Punkte denselben x haben.
        nextX = Math.max(prev.x + 1 / 255, Math.min(next.x - 1 / 255, nextX));
      }
      points[index] = { x: nextX, y: nextY };
      const nextCurve: ToneCurve = { points };
      return {
        adjustments: {
          ...state.adjustments,
          toneCurve: isToneCurveIdentity(nextCurve) ? null : nextCurve,
        },
      };
    });
  },
  addToneCurvePoint: (x, y) => {
    const state = get();
    const curve: ToneCurve = state.adjustments.toneCurve ?? defaultToneCurve();
    if (curve.points.length >= TONE_CURVE_MAX_POINTS) return null;
    const cx = Math.max(0, Math.min(1, x));
    const cy = Math.max(0, Math.min(1, y));
    // Ablegen so, dass die Liste sortiert bleibt.
    const points: ToneCurvePoint[] = [];
    let inserted = false;
    let insertIdx = -1;
    for (const p of curve.points) {
      if (!inserted && cx < p.x) {
        insertIdx = points.length;
        points.push({ x: cx, y: cy });
        inserted = true;
      }
      points.push(p);
    }
    if (!inserted) {
      // Nach allen vorhandenen — direkt vor dem Endpunkt einsortieren,
      // damit der letzte Punkt (1, *) der Endpunkt bleibt.
      insertIdx = Math.max(0, points.length - 1);
      points.splice(insertIdx, 0, { x: cx, y: cy });
    }
    _snapshotBefore(state);
    set((s) => ({
      adjustments: { ...s.adjustments, toneCurve: { points } },
    }));
    return insertIdx;
  },
  removeToneCurvePoint: (index) => {
    const state = get();
    const curve = state.adjustments.toneCurve;
    if (curve === null) return;
    if (curve.points.length <= TONE_CURVE_MIN_POINTS) return;
    if (index === 0 || index === curve.points.length - 1) return;
    _snapshotBefore(state);
    const points = curve.points.filter((_, i) => i !== index);
    const next: ToneCurve = { points };
    set((s) => ({
      adjustments: {
        ...s.adjustments,
        toneCurve: isToneCurveIdentity(next) ? null : next,
      },
    }));
  },
  resetToneCurve: () => {
    _snapshotBefore(get());
    set((state) => ({ adjustments: { ...state.adjustments, toneCurve: null } }));
  },
  setBypass: (bypass) => set({ bypass }),
  setCropRect: (rect) => {
    _snapshotBefore(get());
    set({ cropRect: clampCropRect(rect) });
  },
  setStraightenAngle: (angle) => {
    _snapshotBefore(get());
    set({
      straightenAngle: Math.max(
        -MAX_STRAIGHTEN_RADIANS,
        Math.min(MAX_STRAIGHTEN_RADIANS, angle),
      ),
    });
  },
  setLensCorrection: (next, source = "manual") => {
    _snapshotBefore(get());
    set((state) => ({
      lensCorrection: clampLens({ ...state.lensCorrection, ...next }),
      manualLensOverride:
        source === "manual" ? true : state.manualLensOverride,
    }));
  },
  setLensProfile: (id) => {
    _snapshotBefore(get());
    set({ lensProfileId: id, manualLensOverride: false });
  },
  resetGeometry: () => {
    _snapshotBefore(get());
    set({
      cropRect: defaultCropRect(),
      straightenAngle: 0,
      lensCorrection: defaultLensCorrection(),
      lensProfileId: null,
      manualLensOverride: false,
    });
  },
  addLinearMask: () => {
    const state = get();
    if (countByType(state.masks, "linear") >= MAX_LINEAR_MASKS) return null;
    _snapshotBefore(state);
    const id = newMaskId();
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
    _snapshotBefore(state);
    const id = newMaskId();
    const instance: RadialMaskInstance = {
      id,
      type: "radial",
      mask: defaultRadialMask(),
      localAdj: defaultLocalAdjustments(),
    };
    set({ masks: [...state.masks, instance], selectedMaskId: id });
    return id;
  },
  removeMask: (id) => {
    _snapshotBefore(get());
    set((state) => ({
      masks: state.masks.filter((m) => m.id !== id),
      selectedMaskId:
        state.selectedMaskId === id ? null : state.selectedMaskId,
    }));
  },
  selectMask: (id) =>
    set((state) => {
      if (id === null) return { selectedMaskId: null };
      return findMask(state.masks, id) ? { selectedMaskId: id } : state;
    }),
  setLinearMaskPoint: (id, which, uv) => {
    _snapshotBefore(get());
    set((state) => ({
      masks: state.masks.map((m) =>
        m.id === id && m.type === "linear"
          ? { ...m, mask: { ...m.mask, [which]: clampUv(uv) } }
          : m,
      ),
    }));
  },
  setRadialMaskCenter: (id, uv) => {
    _snapshotBefore(get());
    set((state) => ({
      masks: state.masks.map((m) =>
        m.id === id && m.type === "radial"
          ? { ...m, mask: { ...m.mask, center: clampUv(uv) } }
          : m,
      ),
    }));
  },
  setRadialMaskRadii: (id, rx, ry) => {
    _snapshotBefore(get());
    set((state) => ({
      masks: state.masks.map((m) =>
        m.id === id && m.type === "radial"
          ? {
              ...m,
              mask: { ...m.mask, rx: clampRadius(rx), ry: clampRadius(ry) },
            }
          : m,
      ),
    }));
  },
  setMaskFeather: (id, feather) => {
    _snapshotBefore(get());
    set((state) => ({
      masks: state.masks.map((m): MaskInstance => {
        if (m.id !== id) return m;
        const f = clampFeather(feather);
        if (m.type === "linear") {
          return { ...m, mask: { ...m.mask, feather: f } };
        }
        return { ...m, mask: { ...m.mask, feather: f } };
      }),
    }));
  },
  setMaskLocalAdjustment: (id, key, value) => {
    _snapshotBefore(get());
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
    }));
  },
  removeSelectedMask: () => {
    const id = get().selectedMaskId;
    if (id === null) return;
    _snapshotBefore(get());
    set((state) => ({
      masks: state.masks.filter((m) => m.id !== id),
      selectedMaskId: null,
    }));
  },
  clearMasks: () => {
    _snapshotBefore(get());
    set({ masks: [], selectedMaskId: null });
  },
  applyMasks: (incoming) => {
    _snapshotBefore(get());
    set(() => {
      const result: MaskInstance[] = [];
      let lin = 0;
      let rad = 0;
      for (const m of incoming) {
        if (m.type === "linear") {
          if (lin < MAX_LINEAR_MASKS) {
            result.push(m);
            lin++;
          }
        } else if (rad < MAX_RADIAL_MASKS) {
          result.push(m);
          rad++;
        }
      }
      return { masks: result, selectedMaskId: null };
    });
  },
  undo: () => {
    const state = get();
    // Pending Burst flushen, damit Cmd+Z mid-drag nicht den falschen
    // Snapshot pickt.
    flushPending(_historyDebounce, {
      pushPast: (snap) => {
        useEditorStore.setState((s) => ({
          past: [...s.past.slice(-(MAX_HISTORY - 1)), snap],
          future: [],
        }));
      },
    });
    const fresh = get();
    if (fresh.past.length === 0) return;
    const target = fresh.past[fresh.past.length - 1]!;
    const current = takeSnapshot(fresh);
    set({
      past: fresh.past.slice(0, -1),
      future: [current, ...fresh.future],
      adjustments: target.adjustments,
      masks: target.masks,
      cropRect: target.cropRect,
      straightenAngle: target.straightenAngle,
      lensCorrection: target.lensCorrection,
      lensProfileId: target.lensProfileId,
      manualLensOverride: target.manualLensOverride,
    });
    void state; // silence unused if other branches removed
  },
  redo: () => {
    const state = get();
    if (state.future.length === 0) return;
    const target = state.future[0]!;
    const current = takeSnapshot(state);
    set({
      past: [...state.past, current],
      future: state.future.slice(1),
      adjustments: target.adjustments,
      masks: target.masks,
      cropRect: target.cropRect,
      straightenAngle: target.straightenAngle,
      lensCorrection: target.lensCorrection,
      lensProfileId: target.lensProfileId,
      manualLensOverride: target.manualLensOverride,
    });
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));

export function selectedMask(state: EditorState): MaskInstance | null {
  if (state.selectedMaskId === null) return null;
  return findMask(state.masks, state.selectedMaskId) ?? null;
}
