/**
 * Undo/Redo-Snapshots für den Editor-State.
 *
 * Snapshots erfassen alle „bearbeitenden" Felder (Adjustments, Masken,
 * Crop, Straighten, Lens) — UI-Modi wie Bypass oder selectedMaskId
 * gehören NICHT dazu. Das hält Cmd+Z fokussiert auf das, was der User
 * sehen will: zurueck zu einem frueheren BILD-Zustand.
 *
 * Debouncing: ein Slider-Drag erzeugt 100 onChange-Events; ohne
 * Coalescing waeren das 100 History-Eintraege. Statt dessen wird die
 * BEFORE-Snapshot beim ersten Event in einem Burst gemerkt; nach 250 ms
 * Idle wird sie als ein einziger Eintrag in `past` geschoben.
 */
import type { Adjustments } from "./adjustments";
import type { LensCorrection } from "./lens";
import type { MaskInstance } from "./mask";
import type { CropRect } from "./transform";

export const MAX_HISTORY = 50;
const DEBOUNCE_MS = 250;

export interface HistorySnapshot {
  readonly adjustments: Adjustments;
  readonly masks: ReadonlyArray<MaskInstance>;
  readonly cropRect: CropRect;
  readonly straightenAngle: number;
  readonly lensCorrection: LensCorrection;
  readonly lensProfileId: string | null;
  readonly manualLensOverride: boolean;
}

export interface HistorySource {
  adjustments: Adjustments;
  masks: ReadonlyArray<MaskInstance>;
  cropRect: CropRect;
  straightenAngle: number;
  lensCorrection: LensCorrection;
  lensProfileId: string | null;
  manualLensOverride: boolean;
}

export function takeSnapshot(state: HistorySource): HistorySnapshot {
  // Strukturell flach kopieren — die nested adjustments/cropRect sind
  // bereits readonly bzw. werden vom Store immutabel ersetzt.
  return {
    adjustments: { ...state.adjustments },
    masks: state.masks.slice(),
    cropRect: { ...state.cropRect },
    straightenAngle: state.straightenAngle,
    lensCorrection: { ...state.lensCorrection },
    lensProfileId: state.lensProfileId,
    manualLensOverride: state.manualLensOverride,
  };
}

export interface DebounceContext {
  pendingBefore: HistorySnapshot | null;
  timer: ReturnType<typeof setTimeout> | null;
}

export function makeDebounce(): DebounceContext {
  return { pendingBefore: null, timer: null };
}

export interface HistoryHooks {
  /** Schiebt eine Snapshot in past, leert future. */
  pushPast: (snapshot: HistorySnapshot) => void;
}

/**
 * Vor einer Mutation aufrufen: erfasst die Pre-State-Snapshot beim
 * ersten Aufruf eines Bursts, schiebt sie nach DEBOUNCE_MS Idle in past.
 */
export function captureBeforeChange(
  ctx: DebounceContext,
  before: HistorySource,
  hooks: HistoryHooks,
): void {
  if (ctx.pendingBefore === null) {
    ctx.pendingBefore = takeSnapshot(before);
  }
  if (ctx.timer !== null) clearTimeout(ctx.timer);
  ctx.timer = setTimeout(() => {
    if (ctx.pendingBefore !== null) {
      hooks.pushPast(ctx.pendingBefore);
    }
    ctx.pendingBefore = null;
    ctx.timer = null;
  }, DEBOUNCE_MS);
}

/** Manueller Flush — nuetzlich fuer Tests, oder vor undo() um pendings nicht zu verlieren. */
export function flushPending(ctx: DebounceContext, hooks: HistoryHooks): void {
  if (ctx.timer !== null) {
    clearTimeout(ctx.timer);
    ctx.timer = null;
  }
  if (ctx.pendingBefore !== null) {
    hooks.pushPast(ctx.pendingBefore);
    ctx.pendingBefore = null;
  }
}
