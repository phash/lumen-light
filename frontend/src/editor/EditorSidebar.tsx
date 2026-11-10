import { useState } from "react";


import {
  ADJUSTMENTS,
  type AdjustmentDefinition,
  type AdjustmentKey,
  type Adjustments,
  type HslAxis,
  type HslChannel,
  adjustmentsByGroup,
} from "./adjustments";
import CollapsibleSection from "./CollapsibleSection";
import Histogram from "./Histogram";
import HslPanel from "./HslPanel";
import type { LensCorrection } from "./lens";
import LocalMaskPanel from "./LocalMaskPanel";
import {
  type LocalAdjustments,
  type MaskInstance,
} from "./mask";
import Slider from "./Slider";
import { MAX_STRAIGHTEN_RADIANS } from "./store";
import ToneCurvePanel from "./ToneCurvePanel";
import { type AspectRatio } from "./transform";

function maskTypeLabel(type: "linear" | "radial"): string {
  return type === "linear" ? "Verlauf" : "Radial";
}

interface Props {
  // Histogramm
  readonly canvasElement: HTMLCanvasElement | null;
  readonly tick: number;

  // Geometrie
  readonly aspect: AspectRatio;
  readonly onAspectChange: (a: AspectRatio) => void;
  readonly straightenAngle: number;
  readonly onStraightenChange: (a: number) => void;
  readonly onAutoStraighten: () => void;
  readonly onResetGeometry: () => void;

  // Masken
  readonly masks: ReadonlyArray<MaskInstance>;
  readonly selectedMaskId: string | null;
  readonly selected: MaskInstance | null;
  readonly onSelectMask: (id: string) => void;
  readonly onRemoveMask: (id: string) => void;
  readonly onLocalAdjust: (
    maskId: string,
    key: keyof LocalAdjustments,
    value: number,
  ) => void;
  readonly onMaskFeather: (maskId: string, feather: number) => void;
  readonly onRemoveSelectedMask: () => void;

  // Objektiv
  readonly lensCorrection: LensCorrection;
  readonly lensProfileId: string | null;
  readonly manualLensOverride: boolean;
  readonly onLensCorrectionChange: (next: Partial<LensCorrection>) => void;

  // Adjustments + Reset-All
  readonly adjustments: Adjustments;
  readonly onAdjustment: (key: AdjustmentKey, value: number) => void;
  readonly onHslChange: (axis: HslAxis, channel: HslChannel, value: number) => void;
  readonly onHslReset: () => void;
  readonly onToneCurveSetPoint: (index: number, x: number, y: number) => void;
  readonly onToneCurveAddPoint: (x: number, y: number) => number | null;
  readonly onToneCurveRemovePoint: (index: number) => void;
  readonly onToneCurveReset: () => void;
  readonly onResetAll: () => void;
}

/**
 * Sidebar-Aside des Editors. Stateless — alle Werte und Callbacks
 * kommen vom Editor (Parent). Histogramm + Geometrie (collapsable) +
 * Mask-List + LocalMaskPanel + Lens (collapsable) + Adjustment-Groups +
 * Reset-All.
 */
export default function EditorSidebar({
  canvasElement,
  tick,
  aspect,
  onAspectChange,
  straightenAngle,
  onStraightenChange,
  onAutoStraighten,
  onResetGeometry,
  masks,
  selectedMaskId,
  selected,
  onSelectMask,
  onRemoveMask,
  onLocalAdjust,
  onMaskFeather,
  onRemoveSelectedMask,
  lensCorrection,
  lensProfileId,
  manualLensOverride,
  onLensCorrectionChange,
  adjustments,
  onAdjustment,
  onHslChange,
  onHslReset,
  onToneCurveSetPoint,
  onToneCurveAddPoint,
  onToneCurveRemovePoint,
  onToneCurveReset,
  onResetAll,
}: Props) {
  // Seitentitel der Editor-Route: die Sidebar ist immer gemountet, solange
  // der Editor offen ist (Editor.tsx gehoert einem anderen Arbeitsstrang).
  const groups = adjustmentsByGroup();
  // Mobile (< md): Sidebar als Bottom-Sheet, per Button ein-/ausblendbar.
  // Desktop: immer sichtbar, Breite unveraendert 320px.
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
    <button
      type="button"
      data-testid="editor-sidebar-toggle"
      aria-expanded={mobileOpen}
      aria-controls="editor-sidebar"
      onClick={() => setMobileOpen((v) => !v)}
      className="md:hidden fixed right-3 top-16 z-40 px-3 py-2 text-[10px] uppercase tracking-[0.2em] bg-stone-900/90 border border-stone-700 text-stone-200 hover:border-amber-300/40 hover:text-amber-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
    >
      {mobileOpen ? "Regler schließen" : "Regler"}
    </button>
    <aside
      id="editor-sidebar"
      aria-label="Bearbeitungsregler"
      className={`${
        mobileOpen ? "flex" : "hidden"
      } fixed inset-x-0 bottom-0 z-30 max-h-[70vh] border-t border-stone-800/80 bg-stone-950/95 flex-col md:static md:z-auto md:flex md:max-h-none md:w-[320px] md:border-t-0 md:border-l md:bg-stone-950/60`}
      data-testid="editor-sidebar"
    >
      <div className="p-4 border-b border-stone-800/60">
        <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 mb-2">
          Histogramm
        </div>
        <Histogram canvas={canvasElement} tick={tick} />
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {/*
          Sektions-Reihenfolge folgt dem Wert-pro-Klick-Prinzip:
            1. Licht/Farbe/Detail (Adjustment-Groups) — Erstkontakt-
               Slider, Licht ist open-by-default.
            2. Masken — wenn vorhanden, sichtbar nahe an den Slidern.
            3. HSL + Tonkurve — Power-Tools, collapsed.
            4. Geometrie + Objektiv — eher Pro-Funktionen, collapsed
               und unten.
        */}
        {Array.from(groups.entries()).map(([group, items]) => (
          <CollapsibleSection
            key={group}
            id={`adjustments-${group}`}
            title={group}
            defaultOpen={group === "Licht"}
            testId={`editor-section-${group.toLowerCase()}`}
          >
            {items.map((a: AdjustmentDefinition) => (
              <Slider
                key={a.key}
                adjustmentKey={a.key}
                label={a.label}
                value={adjustments[a.key]}
                defaultValue={a.default}
                min={a.min}
                max={a.max}
                step={a.step}
                tooltip={a.tooltip}
                onChange={(v) => onAdjustment(a.key, v)}
              />
            ))}
          </CollapsibleSection>
        ))}

        {masks.length > 0 && (
          <div className="mb-5" data-testid="mask-list">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-stone-300 italic">
                Masken ({masks.length})
              </span>
              <div className="flex-1 h-px bg-stone-800" />
            </div>
            {masks.map((m, i) => {
              const isSelected = m.id === selectedMaskId;
              const sameTypeIndex =
                masks.slice(0, i).filter((x) => x.type === m.type).length + 1;
              return (
                <div
                  key={m.id}
                  data-testid={`mask-list-item-${i}`}
                  data-mask-type={m.type}
                  data-mask-selected={isSelected ? "true" : "false"}
                  className={`flex items-center gap-2 mb-1 text-xs ${
                    isSelected
                      ? "bg-amber-200/15 border-l-2 border-amber-300 text-amber-200"
                      : "border-l-2 border-stone-800 text-stone-400 hover:text-stone-200"
                  }`}
                >
                  <button
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => onSelectMask(m.id)}
                    className="flex-1 text-left px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                  >
                    {maskTypeLabel(m.type)} {sameTypeIndex}
                  </button>
                  <button
                    type="button"
                    data-testid={`mask-list-delete-${i}`}
                    onClick={() => onRemoveMask(m.id)}
                    className="text-stone-400 hover:text-red-400 px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
                    aria-label={`${maskTypeLabel(m.type)} ${sameTypeIndex} löschen`}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {selected && (
          <LocalMaskPanel
            mask={selected}
            onLocalAdjust={(key, value) => onLocalAdjust(selected.id, key, value)}
            onFeather={(f) => onMaskFeather(selected.id, f)}
            onRemove={onRemoveSelectedMask}
          />
        )}

        <CollapsibleSection
          id="hsl"
          title="Farben (HSL)"
          defaultOpen={false}
          testId="editor-section-hsl"
        >
          <HslPanel
            hsl={adjustments.hsl}
            onChange={onHslChange}
            onReset={onHslReset}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="tone-curve"
          title="Tonkurve"
          defaultOpen={false}
          testId="editor-section-tone-curve"
        >
          <ToneCurvePanel
            curve={adjustments.toneCurve}
            onSetPoint={onToneCurveSetPoint}
            onAddPoint={onToneCurveAddPoint}
            onRemovePoint={onToneCurveRemovePoint}
            onReset={onToneCurveReset}
          />
        </CollapsibleSection>

        <CollapsibleSection
          id="geometry"
          title="Geometrie"
          defaultOpen={false}
          testId="geometry-section"
        >
          <label className="block py-1.5">
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              Aspect-Ratio
            </span>
            <select
              value={aspect}
              onChange={(e) => onAspectChange(e.target.value as AspectRatio)}
              data-testid="aspect-select"
              className="mt-1 w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200 text-sm"
            >
              <option value="free">Frei</option>
              <option value="1:1">1:1</option>
              <option value="3:2">3:2</option>
              <option value="4:3">4:3</option>
              <option value="16:9">16:9</option>
            </select>
          </label>
          <label className="block py-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-stone-400">
                Begradigen ({Math.round((straightenAngle * 180) / Math.PI * 10) / 10}°)
              </span>
              <button
                type="button"
                onClick={onAutoStraighten}
                data-testid="auto-straighten"
                className="px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] border border-stone-700 text-stone-400 hover:border-amber-300/40 hover:text-amber-200"
              >
                Auto
              </button>
            </div>
            <input
              type="range"
              min={-MAX_STRAIGHTEN_RADIANS}
              max={MAX_STRAIGHTEN_RADIANS}
              step={0.001}
              value={straightenAngle}
              onChange={(e) => onStraightenChange(Number(e.target.value))}
              onDoubleClick={() => onStraightenChange(0)}
              data-testid="straighten-slider"
              className="mt-1 w-full"
            />
          </label>
          <button
            type="button"
            onClick={onResetGeometry}
            data-testid="editor-reset-geometry"
            className="w-full mt-2 py-1.5 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40"
          >
            Geometrie zurücksetzen
          </button>
        </CollapsibleSection>

        <CollapsibleSection
          id="lens"
          title="Objektiv"
          defaultOpen={false}
          testId="lens-section"
        >
          <div
            className="text-[10px] uppercase tracking-[0.18em] text-stone-500 mb-2"
            data-testid="lens-profile-status"
          >
            {lensProfileId == null
              ? "Kein Profil"
              : manualLensOverride
                ? `${lensProfileId} (manuell überschrieben)`
                : `${lensProfileId} (auto)`}
          </div>
          <label className="block py-1.5">
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              Verzeichnung ({Math.round(lensCorrection.distortion * 100)})
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={lensCorrection.distortion}
              onChange={(e) =>
                onLensCorrectionChange({ distortion: Number(e.target.value) })
              }
              onDoubleClick={() => onLensCorrectionChange({ distortion: 0 })}
              data-testid="lens-distortion-slider"
              className="mt-1 w-full"
            />
          </label>
          <label className="block py-1.5">
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              Vignettierung ({Math.round(lensCorrection.vignette * 100)})
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={lensCorrection.vignette}
              onChange={(e) =>
                onLensCorrectionChange({ vignette: Number(e.target.value) })
              }
              onDoubleClick={() => onLensCorrectionChange({ vignette: 0 })}
              data-testid="lens-vignette-slider"
              className="mt-1 w-full"
            />
          </label>
          <label
            className="block py-1.5"
            title="Transverse Chromatic Aberration: roter Saum an Hochkontrastkanten korrigieren (Weitwinkel-Offen)."
          >
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              CA Rot ({Math.round(lensCorrection.tcaR * 100)})
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={lensCorrection.tcaR}
              onChange={(e) =>
                onLensCorrectionChange({ tcaR: Number(e.target.value) })
              }
              onDoubleClick={() => onLensCorrectionChange({ tcaR: 0 })}
              data-testid="lens-tca-r-slider"
              className="mt-1 w-full"
            />
          </label>
          <label
            className="block py-1.5"
            title="Transverse Chromatic Aberration: blauer Saum an Hochkontrastkanten korrigieren."
          >
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              CA Blau ({Math.round(lensCorrection.tcaB * 100)})
            </span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={lensCorrection.tcaB}
              onChange={(e) =>
                onLensCorrectionChange({ tcaB: Number(e.target.value) })
              }
              onDoubleClick={() => onLensCorrectionChange({ tcaB: 0 })}
              data-testid="lens-tca-b-slider"
              className="mt-1 w-full"
            />
          </label>
        </CollapsibleSection>

        <button
          type="button"
          onClick={onResetAll}
          data-testid="editor-reset-all"
          className="w-full mt-2 py-2 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40 transition-colors"
        >
          Alles zurücksetzen ({ADJUSTMENTS.length} Slider)
        </button>
      </div>
    </aside>
    </>
  );
}
