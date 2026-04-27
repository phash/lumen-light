import { useCallback, useRef, useState } from "react";

import {
  ADJUSTMENTS,
  type AdjustmentDefinition,
  adjustmentsByGroup,
} from "../editor/adjustments";
import Canvas, { type CanvasHandle } from "../editor/Canvas";
import CropOverlay from "../editor/CropOverlay";
import {
  type ExportFormat,
  downloadBlob,
  exportCanvas,
  suggestFilename,
} from "../editor/export";
import Histogram from "../editor/Histogram";
import { findLensProfile, profileToCorrection } from "../editor/lensProfile";
import LinearMaskOverlay from "../editor/LinearMaskOverlay";
import {
  LOCAL_ADJUSTMENT_LIMITS,
  type LinearMaskInstance,
  type LocalAdjustments,
  MAX_LINEAR_MASKS,
  MAX_RADIAL_MASKS,
  type MaskInstance,
  type RadialMaskInstance,
} from "../editor/mask";
import PresetDialog from "../editor/PresetDialog";
import RadialMaskOverlay from "../editor/RadialMaskOverlay";
import { FILE_PICKER_ACCEPT, decodeRaw, isRawFile, rgbToImageBitmap } from "../editor/raw";
import Slider from "../editor/Slider";
import {
  MAX_STRAIGHTEN_RADIANS,
  selectedMask,
  useEditorStore,
} from "../editor/store";
import { type AspectRatio } from "../editor/transform";
import { useKeyboardShortcuts } from "../editor/useKeyboardShortcuts";

const LOCAL_ADJ_LABELS: Record<keyof LocalAdjustments, string> = {
  exposure: "Belichtung",
  contrast: "Kontrast",
  saturation: "Sättigung",
  temperature: "Temperatur",
};

function maskTypeLabel(type: "linear" | "radial"): string {
  return type === "linear" ? "Verlauf" : "Radial";
}

function countByType(
  masks: ReadonlyArray<MaskInstance>,
  type: "linear" | "radial",
): number {
  let n = 0;
  for (const m of masks) if (m.type === type) n++;
  return n;
}

export default function Editor() {
  const canvasHandleRef = useRef<CanvasHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [originalFilename, setOriginalFilename] = useState("lumen-export");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("jpeg");
  const [exportQuality, setExportQuality] = useState(0.92);
  const [exportWidth, setExportWidth] = useState<number | "native">("native");
  const [exporting, setExporting] = useState(false);
  const [decoding, setDecoding] = useState(false);
  const [cameraInfo, setCameraInfo] = useState<string | null>(null);
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>("free");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [wbPickerActive, setWbPickerActive] = useState(false);

  const adjustments = useEditorStore((s) => s.adjustments);
  const setAdjustment = useEditorStore((s) => s.setAdjustment);
  const resetAll = useEditorStore((s) => s.resetAll);
  const bypass = useEditorStore((s) => s.bypass);
  const setBypass = useEditorStore((s) => s.setBypass);
  const cropRect = useEditorStore((s) => s.cropRect);
  const setCropRect = useEditorStore((s) => s.setCropRect);
  const straightenAngle = useEditorStore((s) => s.straightenAngle);
  const setStraightenAngle = useEditorStore((s) => s.setStraightenAngle);
  const resetGeometry = useEditorStore((s) => s.resetGeometry);
  const lensCorrection = useEditorStore((s) => s.lensCorrection);
  const setLensCorrection = useEditorStore((s) => s.setLensCorrection);
  const lensProfileId = useEditorStore((s) => s.lensProfileId);
  const manualLensOverride = useEditorStore((s) => s.manualLensOverride);
  const setLensProfile = useEditorStore((s) => s.setLensProfile);

  const masks = useEditorStore((s) => s.masks);
  const selectedMaskId = useEditorStore((s) => s.selectedMaskId);
  const addLinearMask = useEditorStore((s) => s.addLinearMask);
  const addRadialMask = useEditorStore((s) => s.addRadialMask);
  const removeMask = useEditorStore((s) => s.removeMask);
  const selectMask = useEditorStore((s) => s.selectMask);
  const setLinearMaskPoint = useEditorStore((s) => s.setLinearMaskPoint);
  const setRadialMaskCenter = useEditorStore((s) => s.setRadialMaskCenter);
  const setRadialMaskRadii = useEditorStore((s) => s.setRadialMaskRadii);
  const setMaskFeather = useEditorStore((s) => s.setMaskFeather);
  const setMaskLocalAdjustment = useEditorStore((s) => s.setMaskLocalAdjustment);
  const removeSelectedMask = useEditorStore((s) => s.removeSelectedMask);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);

  const selected = useEditorStore(selectedMask);
  const linearCount = countByType(masks, "linear");
  const radialCount = countByType(masks, "radial");
  const canAddLinear = linearCount < MAX_LINEAR_MASKS;
  const canAddRadial = radialCount < MAX_RADIAL_MASKS;

  const imageAspect = imageDims ? imageDims.width / imageDims.height : 1;

  const groups = adjustmentsByGroup();

  const onTick = useCallback(() => setTick((t) => t + 1), []);
  const onCanvasError = useCallback((msg: string) => setError(msg), []);
  const onCanvasMount = useCallback(
    (c: HTMLCanvasElement) => setCanvasElement(c),
    [],
  );

  const onFile = async (file: File) => {
    setError(null);
    setOriginalFilename(file.name);
    setCameraInfo(null);
    setImageDims(null);
    resetGeometry();
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setWbPickerActive(false);
    try {
      const isRaw = await isRawFile(file);
      if (isRaw) {
        setDecoding(true);
        const decoded = await decodeRaw(file);
        const bitmap = await rgbToImageBitmap(decoded.rgb, decoded.width, decoded.height);
        canvasHandleRef.current?.loadBitmap(bitmap, decoded.width, decoded.height);
        setImageDims({ width: decoded.width, height: decoded.height });
        if (decoded.cameraMake || decoded.cameraModel) {
          setCameraInfo(
            [decoded.cameraMake, decoded.cameraModel].filter(Boolean).join(" "),
          );
        }

        // Lens-Profil-Auto-Detection: matches setzen die Slider und
        // markieren das Profil als 'auto'.
        const lookup = findLensProfile(
          decoded.cameraMake,
          decoded.cameraModel,
          decoded.focalLen,
        );
        if (lookup.profile) {
          setLensCorrection(profileToCorrection(lookup.profile), "auto");
          setLensProfile(lookup.profile.id);
        }
      } else {
        await canvasHandleRef.current?.loadFile(file);
        // Dimensions aus dem Canvas-Element lesen — wurde von loadFile gesetzt
        const c = canvasElement;
        if (c) setImageDims({ width: c.width, height: c.height });
      }
      setHasImage(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bild konnte nicht geladen werden");
    } finally {
      setDecoding(false);
    }
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void onFile(file);
    event.target.value = "";
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void onFile(file);
  };

  const triggerFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const triggerExport = useCallback(() => {
    if (hasImage) setExportOpen(true);
  }, [hasImage]);

  const doExport = async () => {
    if (!canvasElement) return;
    setExporting(true);
    try {
      const blob = await exportCanvas(canvasElement, {
        format: exportFormat,
        quality: exportQuality,
        width: exportWidth === "native" ? undefined : exportWidth,
      });
      downloadBlob(blob, suggestFilename(originalFilename, exportFormat));
      setExportOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export fehlgeschlagen");
    } finally {
      setExporting(false);
    }
  };

  const toggleCropMode = useCallback(() => {
    if (hasImage) setCropMode((m) => !m);
  }, [hasImage]);

  const togglePresetDialog = useCallback(() => {
    if (hasImage) setPresetDialogOpen((v) => !v);
  }, [hasImage]);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLElement>) => {
      if (!hasImage) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.max(0.1, Math.min(10, zoom * factor));
      // Anker am Mauszeiger: pan so anpassen, dass der Punkt unter dem
      // Cursor an seiner Stelle bleibt.
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = e.clientX - rect.left - rect.width / 2;
        const cy = e.clientY - rect.top - rect.height / 2;
        const ratio = next / zoom;
        setPan({
          x: cx - (cx - pan.x) * ratio,
          y: cy - (cy - pan.y) * ratio,
        });
      }
      setZoom(next);
    },
    [hasImage, zoom, pan],
  );

  const onViewportPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!hasImage) return;
      if (cropMode) return;
      if (wbPickerActive) return;
      // Buttons / Inputs / Selects: keine Pan-Aktion (Klick darf
      // weiterlaufen). Mask-Handles haben bereits stopPropagation.
      const target = e.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, label, a")) return;
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* jsdom */
      }
    },
    [hasImage, cropMode, wbPickerActive, pan],
  );

  const onViewportPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = panDragRef.current;
      if (!drag) return;
      setPan({
        x: drag.panX + (e.clientX - drag.startX),
        y: drag.panY + (e.clientY - drag.startY),
      });
    },
    [],
  );

  const onViewportPointerUp = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
  }, []);

  const onCanvasClickForWb = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!wbPickerActive || !canvasElement) return;
      const rect = canvasElement.getBoundingClientRect();
      const xs = (e.clientX - rect.left) / rect.width;
      const ys = (e.clientY - rect.top) / rect.height;
      if (xs < 0 || xs > 1 || ys < 0 || ys > 1) return;
      const px = Math.max(0, Math.min(canvasElement.width - 1, Math.floor(xs * canvasElement.width)));
      const py = Math.max(0, Math.min(canvasElement.height - 1, Math.floor(ys * canvasElement.height)));
      try {
        const off = new OffscreenCanvas(1, 1);
        const ctx = off.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(canvasElement, px, py, 1, 1, 0, 0, 1, 1);
        const data = ctx.getImageData(0, 0, 1, 1).data;
        const r = data[0]! / 255;
        const g = data[1]! / 255;
        const b = data[2]! / 255;
        // Korrektur in zwei Schritten:
        //   ΔtempK = (B - R) / (B + R)  (gleicht R/B aus)
        //   ΔtintK = ((R+B)/2 / G) - 1  (gleicht G gegen mean an)
        // Werte werden zu den aktuellen Slidern addiert und geklemmt.
        const sumRb = Math.max(0.001, r + b);
        const dTempK = (b - r) / sumRb;
        const rEff = r * (1 + dTempK);
        const bEff = b * (1 - dTempK);
        const meanRb = (rEff + bEff) / 2;
        const dTintK = meanRb / Math.max(0.001, g) - 1;
        const dTempSlider = dTempK / 0.4;
        const dTintSlider = dTintK / 0.3;
        const cur = useEditorStore.getState().adjustments;
        useEditorStore.getState().setAdjustment("temperature", cur.temperature + dTempSlider);
        useEditorStore.getState().setAdjustment("tint", cur.tint + dTintSlider);
      } catch {
        /* readback failed — no-op */
      }
      setWbPickerActive(false);
    },
    [wbPickerActive, canvasElement],
  );

  useKeyboardShortcuts({
    onResetAll: resetAll,
    onExport: triggerExport,
    onOpenFile: triggerFileDialog,
    onToggleCrop: toggleCropMode,
    onTogglePresets: togglePresetDialog,
    onUndo: undo,
    onRedo: redo,
    setBypass,
  });

  const selectedLinear: LinearMaskInstance | null =
    selected && selected.type === "linear" ? selected : null;
  const selectedRadial: RadialMaskInstance | null =
    selected && selected.type === "radial" ? selected : null;

  return (
    <section data-testid="page-editor" className="flex h-[calc(100vh-3rem)]">
      <main
        ref={viewportRef}
        className="flex-1 relative flex items-center justify-center bg-stone-950 overflow-hidden p-8"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onWheel={onWheel}
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerUp}
        onClick={onCanvasClickForWb}
        style={{
          cursor: wbPickerActive
            ? "crosshair"
            : isPanning
              ? "grabbing"
              : hasImage && !cropMode
                ? "grab"
                : "default",
        }}
      >
        <div
          className="relative max-w-full max-h-full"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isPanning ? "none" : "transform 0.05s linear",
          }}
        >
          <Canvas
            ref={canvasHandleRef}
            onTick={onTick}
            onError={onCanvasError}
            onCanvasMount={onCanvasMount}
          />
          {hasImage && cropMode && (
            <CropOverlay
              cropRect={cropRect}
              aspect={aspect}
              imageAspect={imageAspect}
              onChange={setCropRect}
            />
          )}
          {hasImage && selectedLinear && (
            <LinearMaskOverlay
              mask={selectedLinear.mask}
              onChangePoint={(which, uv) =>
                setLinearMaskPoint(selectedLinear.id, which, uv)
              }
            />
          )}
          {hasImage && selectedRadial && (
            <RadialMaskOverlay
              mask={selectedRadial.mask}
              onChangeCenter={(uv) => setRadialMaskCenter(selectedRadial.id, uv)}
              onChangeRadii={(rx, ry) =>
                setRadialMaskRadii(selectedRadial.id, rx, ry)
              }
            />
          )}
        </div>

        <input
          ref={fileInputRef}
          data-testid="editor-file-input"
          type="file"
          accept={FILE_PICKER_ACCEPT}
          className="hidden"
          onChange={onPick}
        />

        {!hasImage && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-500 pointer-events-none">
            <span className="text-xl">Bild hierhin ziehen</span>
            <button
              type="button"
              onClick={triggerFileDialog}
              className="mt-3 cursor-pointer text-amber-200 hover:underline pointer-events-auto"
            >
              oder Datei wählen
            </button>
          </div>
        )}

        {error && (
          <div
            data-testid="editor-error"
            className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 bg-red-950/80 border border-red-500/60 backdrop-blur"
          >
            <span className="text-red-300 text-sm">{error}</span>
            <button
              type="button"
              data-testid="editor-error-dismiss"
              onClick={() => setError(null)}
              aria-label="Fehler schliessen"
              className="text-red-400 hover:text-red-200"
            >
              ✕
            </button>
          </div>
        )}

        {decoding && (
          <div
            data-testid="editor-decoding"
            className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-stone-900/80 border border-amber-300/30 backdrop-blur text-amber-200 text-sm"
            role="status"
            aria-live="polite"
          >
            <svg
              className="w-4 h-4 animate-spin"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
              <path d="M12 2 a 10 10 0 0 1 10 10" strokeLinecap="round" />
            </svg>
            RAW wird dekodiert …
          </div>
        )}

        {cameraInfo && (
          <p
            data-testid="editor-camera-info"
            className="absolute top-6 right-6 text-xs uppercase tracking-[0.2em] text-stone-500"
          >
            {cameraInfo}
          </p>
        )}

        {hasImage && (
          <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end gap-3 pointer-events-none">
            {/* Gruppe 1: View — Bypass, Crop, WB, Zoom */}
            <div className="flex gap-1 pointer-events-auto bg-stone-900/80 backdrop-blur border border-stone-700 p-1 rounded">
              <button
                type="button"
                data-testid="editor-bypass"
                onPointerDown={() => setBypass(true)}
                onPointerUp={() => setBypass(false)}
                onPointerLeave={() => setBypass(false)}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                  bypass ? "bg-amber-200/20 text-amber-200" : "text-stone-300 hover:text-amber-200"
                }`}
                title="Druecken & halten zeigt Original (Shortcut: \\)"
                aria-label="Original anzeigen (halten)"
              >
                {/* Augen-Icon: Original anzeigen waehrend gedrueckt */}
                <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
              <button
                type="button"
                data-testid="editor-crop-toggle"
                onClick={toggleCropMode}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                  cropMode ? "bg-amber-200/20 text-amber-200" : "text-stone-300 hover:text-amber-200"
                }`}
                title="Beschneiden (R)"
              >
                {cropMode ? "Crop fertig" : "Beschneiden"}
              </button>
              <button
                type="button"
                data-testid="editor-wb-picker"
                onClick={(e) => {
                  e.stopPropagation();
                  setWbPickerActive((v) => !v);
                }}
                className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
                  wbPickerActive ? "bg-amber-200/20 text-amber-200" : "text-stone-300 hover:text-amber-200"
                }`}
                title="Klick auf neutralen Bildbereich setzt Weissabgleich"
              >
                Weissabgleich
              </button>
              <button
                type="button"
                data-testid="editor-reset-view"
                onClick={resetView}
                disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Zoom + Pan zuruecksetzen"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                data-testid="editor-undo"
                onClick={undo}
                disabled={!canUndo}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Rueckgaengig (Cmd+Z)"
                aria-label="Rueckgaengig"
              >
                ↶
              </button>
              <button
                type="button"
                data-testid="editor-redo"
                onClick={redo}
                disabled={!canRedo}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Wiederherstellen (Cmd+Shift+Z)"
                aria-label="Wiederherstellen"
              >
                ↷
              </button>
            </div>

            {/* Gruppe 2: Masken */}
            <div className="flex gap-1 pointer-events-auto bg-stone-900/80 backdrop-blur border border-stone-700 p-1 rounded">
              <button
                type="button"
                data-testid="editor-linear-mask-toggle"
                disabled={!canAddLinear}
                onClick={() => addLinearMask()}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Linearen Verlaufsfilter hinzufuegen"
              >
                + Verlauf
              </button>
              <button
                type="button"
                data-testid="editor-radial-mask-toggle"
                disabled={!canAddRadial}
                onClick={() => addRadialMask()}
                className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Elliptische Radialmaske hinzufuegen"
              >
                + Radial
              </button>
            </div>

            {/* Gruppe 3: Action — Presets, Export */}
            <div className="flex gap-1 pointer-events-auto">
              <button
                type="button"
                data-testid="editor-presets"
                onClick={() => setPresetDialogOpen(true)}
                className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] bg-stone-900/80 backdrop-blur border border-stone-700 hover:border-amber-300/40 text-stone-300"
                title="Presets verwalten (P)"
              >
                Presets
              </button>
              <button
                type="button"
                data-testid="editor-export"
                onClick={triggerExport}
                className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] bg-amber-200/15 backdrop-blur border border-amber-300/50 hover:border-amber-300 text-amber-200"
                title="Exportieren (Cmd+E)"
              >
                Exportieren
              </button>
            </div>
          </div>
        )}

        {presetDialogOpen && (
          <PresetDialog
            open={presetDialogOpen}
            onClose={() => setPresetDialogOpen(false)}
            loadedPresetId={loadedPresetId}
            onLoadedPresetIdChange={setLoadedPresetId}
          />
        )}

        {exportOpen && (
          <div
            data-testid="export-dialog"
            className="absolute bottom-20 left-6 w-72 bg-stone-900/95 backdrop-blur border border-stone-700 p-4 text-sm space-y-3"
          >
            <h2 className="text-stone-200">Export</h2>

            <label className="block">
              <span className="text-stone-400 text-xs">Format</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                data-testid="export-format"
                className="mt-1 w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
              >
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
                <option value="webp">WebP</option>
              </select>
            </label>

            {exportFormat !== "png" && (
              <label className="block">
                <span className="text-stone-400 text-xs">
                  Qualität: {Math.round(exportQuality * 100)}
                </span>
                <input
                  type="range"
                  min={0.5}
                  max={1}
                  step={0.01}
                  value={exportQuality}
                  onChange={(e) => setExportQuality(Number(e.target.value))}
                  data-testid="export-quality"
                  className="mt-1 w-full"
                />
              </label>
            )}

            <label className="block">
              <span className="text-stone-400 text-xs">Breite</span>
              <select
                value={exportWidth === "native" ? "native" : String(exportWidth)}
                onChange={(e) =>
                  setExportWidth(
                    e.target.value === "native" ? "native" : Number(e.target.value),
                  )
                }
                data-testid="export-width"
                className="mt-1 w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
              >
                <option value="native">
                  Original-Vorschau ({canvasElement?.width ?? 0}px)
                </option>
                <option value="2048">2048 px</option>
                <option value="1024">1024 px</option>
                <option value="512">512 px (Web)</option>
              </select>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setExportOpen(false)}
                className="text-xs uppercase tracking-wider text-stone-500"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={() => void doExport()}
                disabled={exporting}
                data-testid="export-confirm"
                className="text-xs uppercase tracking-wider text-amber-200 hover:text-amber-100 disabled:opacity-50"
              >
                {exporting ? "Exportiere…" : "Speichern"}
              </button>
            </div>
          </div>
        )}
      </main>

      <aside
        className="w-[320px] border-l border-stone-800/80 bg-stone-950/60 flex flex-col"
        data-testid="editor-sidebar"
      >
        <div className="p-4 border-b border-stone-800/60">
          <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 mb-2">
            Histogramm
          </div>
          <Histogram canvas={canvasElement} tick={tick} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-5" data-testid="geometry-section">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-stone-300 italic">Geometrie</span>
              <div className="flex-1 h-px bg-stone-800" />
            </div>
            <label className="block py-1.5">
              <span className="text-[11px] uppercase tracking-wider text-stone-400">
                Aspect-Ratio
              </span>
              <select
                value={aspect}
                onChange={(e) => setAspect(e.target.value as AspectRatio)}
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
              <span className="text-[11px] uppercase tracking-wider text-stone-400">
                Begradigen ({Math.round((straightenAngle * 180) / Math.PI * 10) / 10}°)
              </span>
              <input
                type="range"
                min={-MAX_STRAIGHTEN_RADIANS}
                max={MAX_STRAIGHTEN_RADIANS}
                step={0.001}
                value={straightenAngle}
                onChange={(e) => setStraightenAngle(Number(e.target.value))}
                onDoubleClick={() => setStraightenAngle(0)}
                data-testid="straighten-slider"
                className="mt-1 w-full"
              />
            </label>
            <button
              type="button"
              onClick={resetGeometry}
              data-testid="editor-reset-geometry"
              className="w-full mt-2 py-1.5 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40"
            >
              Geometrie zurücksetzen
            </button>
          </div>

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
                const sameTypeIndex = masks
                  .slice(0, i)
                  .filter((x) => x.type === m.type).length + 1;
                return (
                  <div
                    key={m.id}
                    data-testid={`mask-list-item-${i}`}
                    data-mask-type={m.type}
                    data-mask-selected={isSelected ? "true" : "false"}
                    className={`flex items-center gap-2 px-2 py-1.5 mb-1 cursor-pointer text-xs ${
                      isSelected
                        ? "bg-amber-200/15 border-l-2 border-amber-300 text-amber-200"
                        : "border-l-2 border-stone-800 text-stone-400 hover:text-stone-200"
                    }`}
                    onClick={() => selectMask(m.id)}
                  >
                    <span className="flex-1">
                      {maskTypeLabel(m.type)} {sameTypeIndex}
                    </span>
                    <button
                      type="button"
                      data-testid={`mask-list-delete-${i}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeMask(m.id);
                      }}
                      className="text-stone-500 hover:text-red-400 px-1"
                      aria-label="Maske loeschen"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {selectedLinear && (
            <div className="mb-5" data-testid="local-mask-section">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-stone-300 italic">Lokal · Verlauf</span>
                <div className="flex-1 h-px bg-stone-800" />
              </div>
              {(["exposure", "contrast", "saturation", "temperature"] as const).map(
                (key) => {
                  const [min, max] = LOCAL_ADJUSTMENT_LIMITS[key];
                  const value = selectedLinear.localAdj[key];
                  return (
                    <label key={key} className="block py-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-stone-400">
                        {LOCAL_ADJ_LABELS[key]} ({key === "exposure" ? value.toFixed(2) : Math.round(value * 100)})
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={key === "exposure" ? 0.05 : 0.01}
                        value={value}
                        onChange={(e) =>
                          setMaskLocalAdjustment(
                            selectedLinear.id,
                            key,
                            Number(e.target.value),
                          )
                        }
                        onDoubleClick={() =>
                          setMaskLocalAdjustment(selectedLinear.id, key, 0)
                        }
                        data-testid={`local-${key}-slider`}
                        className="mt-1 w-full"
                      />
                    </label>
                  );
                },
              )}
              <label className="block py-1.5">
                <span className="text-[11px] uppercase tracking-wider text-stone-400">
                  Übergang ({Math.round(selectedLinear.mask.feather * 100)})
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedLinear.mask.feather}
                  onChange={(e) =>
                    setMaskFeather(selectedLinear.id, Number(e.target.value))
                  }
                  onDoubleClick={() => setMaskFeather(selectedLinear.id, 0)}
                  data-testid="local-feather-slider"
                  className="mt-1 w-full"
                />
              </label>
              <button
                type="button"
                onClick={removeSelectedMask}
                data-testid="editor-reset-mask"
                className="w-full mt-2 py-1.5 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40"
              >
                Verlauf entfernen
              </button>
            </div>
          )}

          {selectedRadial && (
            <div className="mb-5" data-testid="radial-mask-section">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-stone-300 italic">Lokal · Radial</span>
                <div className="flex-1 h-px bg-stone-800" />
              </div>
              {(["exposure", "contrast", "saturation", "temperature"] as const).map(
                (key) => {
                  const [min, max] = LOCAL_ADJUSTMENT_LIMITS[key];
                  const value = selectedRadial.localAdj[key];
                  return (
                    <label key={key} className="block py-1.5">
                      <span className="text-[11px] uppercase tracking-wider text-stone-400">
                        {LOCAL_ADJ_LABELS[key]} ({key === "exposure" ? value.toFixed(2) : Math.round(value * 100)})
                      </span>
                      <input
                        type="range"
                        min={min}
                        max={max}
                        step={key === "exposure" ? 0.05 : 0.01}
                        value={value}
                        onChange={(e) =>
                          setMaskLocalAdjustment(
                            selectedRadial.id,
                            key,
                            Number(e.target.value),
                          )
                        }
                        onDoubleClick={() =>
                          setMaskLocalAdjustment(selectedRadial.id, key, 0)
                        }
                        data-testid={`radial-${key}-slider`}
                        className="mt-1 w-full"
                      />
                    </label>
                  );
                },
              )}
              <label className="block py-1.5">
                <span className="text-[11px] uppercase tracking-wider text-stone-400">
                  Übergang ({Math.round(selectedRadial.mask.feather * 100)})
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selectedRadial.mask.feather}
                  onChange={(e) =>
                    setMaskFeather(selectedRadial.id, Number(e.target.value))
                  }
                  onDoubleClick={() => setMaskFeather(selectedRadial.id, 0)}
                  data-testid="radial-feather-slider"
                  className="mt-1 w-full"
                />
              </label>
              <button
                type="button"
                onClick={removeSelectedMask}
                data-testid="editor-reset-radial"
                className="w-full mt-2 py-1.5 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40"
              >
                Radial entfernen
              </button>
            </div>
          )}

          <div className="mb-5" data-testid="lens-section">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-stone-300 italic">Objektiv</span>
              <div className="flex-1 h-px bg-stone-800" />
            </div>
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
                  setLensCorrection({ distortion: Number(e.target.value) })
                }
                onDoubleClick={() => setLensCorrection({ distortion: 0 })}
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
                  setLensCorrection({ vignette: Number(e.target.value) })
                }
                onDoubleClick={() => setLensCorrection({ vignette: 0 })}
                data-testid="lens-vignette-slider"
                className="mt-1 w-full"
              />
            </label>
          </div>

          {Array.from(groups.entries()).map(([group, items]) => (
            <div key={group} className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-stone-300 italic">{group}</span>
                <div className="flex-1 h-px bg-stone-800" />
              </div>
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
                  onChange={(v) => setAdjustment(a.key, v)}
                />
              ))}
            </div>
          ))}

          <button
            type="button"
            onClick={resetAll}
            data-testid="editor-reset-all"
            className="w-full mt-2 py-2 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40 transition-colors"
          >
            Alles zurücksetzen ({ADJUSTMENTS.length} Slider)
          </button>
        </div>
      </aside>
    </section>
  );
}
