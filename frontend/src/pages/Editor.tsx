import { useCallback, useRef, useState } from "react";

import OnboardingTour from "../onboarding/OnboardingTour";
import { getOnboardingState } from "../onboarding/state";

import { useApi } from "../api/use-api";
import { type CanvasHandle } from "../editor/Canvas";
import EditorBanners from "../editor/EditorBanners";
import EditorOverlayCanvas from "../editor/EditorOverlayCanvas";
import EditorSidebar from "../editor/EditorSidebar";
import EditorToolbar from "../editor/EditorToolbar";
import {
  type ExportFormat,
  downloadBlob,
  exportCanvas,
  suggestFilename,
} from "../editor/export";
import ExportDialog from "../editor/ExportDialog";
import { findLensProfile, profileToCorrection } from "../editor/lensProfile";
import {
  type LinearMaskInstance,
  MAX_LINEAR_MASKS,
  MAX_RADIAL_MASKS,
  type MaskInstance,
  type RadialMaskInstance,
} from "../editor/mask";
import PresetDialog from "../editor/PresetDialog";
import ShortcutCheatsheet from "../editor/ShortcutCheatsheet";
import { analyze, computeAutoTone, computeAutoWb } from "../editor/autoAdjust";
import { analyzeCanvasStraightenAngle } from "../editor/autoStraighten";
import { detectFacesSafe } from "../editor/faceDetector";
import { FILE_PICKER_ACCEPT, decodeRaw, isRawFile, rgbToImageBitmap } from "../editor/raw";
import { type Genre, suggestGenre } from "../editor/suggestPreset";
import { selectedMask, useEditorStore } from "../editor/store";
import { type AspectRatio } from "../editor/transform";
import { useKeyboardShortcuts } from "../editor/useKeyboardShortcuts";

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
  // Auto-Start der Tour, wenn der User noch nie eine Entscheidung
  // getroffen hat. Lazy-init: kein Effect, kein Re-Render-Cascade.
  // `dismissed` und `completed` blocken die Tour; der User kann sie aber
  // im Account-Bereich wieder anwerfen.
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => getOnboardingState() === "none",
  );
  const [imageDims, setImageDims] = useState<{ width: number; height: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const [aspect, setAspect] = useState<AspectRatio>("free");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [suggestedGenre, setSuggestedGenre] = useState<Genre | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [compareSnapshot, setCompareSnapshot] = useState<string | null>(null);
  const [splitX, setSplitX] = useState(0.5);
  const api = useApi();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null);
  // Multi-Touch: aktive Pointer mit aktueller Position. Sobald Map.size==2,
  // wechselt Pan in Pinch-Zoom-Modus. pinchRef speichert Start-Distanz +
  // Anker, sodass das Bild „unter den Fingern" bleibt.
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<
    | {
        baseDistance: number;
        baseZoom: number;
        anchorX: number; // Mittelpunkt der zwei Touches in Viewport-zentrierten Koordinaten
        anchorY: number;
        basePanX: number;
        basePanY: number;
      }
    | null
  >(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [wbPickerActive, setWbPickerActive] = useState(false);

  const adjustments = useEditorStore((s) => s.adjustments);
  const setAdjustment = useEditorStore((s) => s.setAdjustment);
  const resetAll = useEditorStore((s) => s.resetAll);
  const setHslChannel = useEditorStore((s) => s.setHslChannel);
  const resetHsl = useEditorStore((s) => s.resetHsl);
  const setToneCurvePoint = useEditorStore((s) => s.setToneCurvePoint);
  const addToneCurvePoint = useEditorStore((s) => s.addToneCurvePoint);
  const removeToneCurvePoint = useEditorStore((s) => s.removeToneCurvePoint);
  const resetToneCurve = useEditorStore((s) => s.resetToneCurve);
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

  const onTick = useCallback(() => setTick((t) => t + 1), []);
  const onCanvasError = useCallback((msg: string) => setError(msg), []);
  const onCanvasMount = useCallback(
    (c: HTMLCanvasElement) => setCanvasElement(c),
    [],
  );

  const runSuggestion = async (focal: number | null): Promise<void> => {
    const c = canvasElement;
    if (!c) return;
    const stats = analyze(c);
    if (!stats) return;
    // Face-Detection laeuft async und langsamer (lazy-load + Inference)
    // — schicken wir parallel los und warten kurz, bevor wir die
    // Heuristik kombinieren. Bei jedem Fehler liefert detectFacesSafe
    // eine leere Liste, sodass die Suggestion nicht blockiert.
    const faces = await detectFacesSafe(c);
    const genre = suggestGenre({
      focalLen: focal,
      meanR: stats.meanR,
      meanG: stats.meanG,
      meanB: stats.meanB,
      p500: stats.p500,
      faceCount: faces.length,
    });
    if (genre) setSuggestedGenre(genre);
  };

  const onFile = async (file: File) => {
    setError(null);
    setOriginalFilename(file.name);
    setCameraInfo(null);
    setImageDims(null);
    resetGeometry();
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setWbPickerActive(false);
    setSuggestedGenre(null);
    setSuggestionDismissed(false);
    setCompareSnapshot(null);
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

        // Smart-Preset-Suggestion fuer RAW-Bilder: nutzt EXIF-Brennweite
        // + Histogramm-Mittelwerte. Im Mainthread leichtgewichtig (40k Pixel
        // Analyse) — wird einen Render-Tick spaeter ausgeloest.
        const focal = decoded.focalLen;
        setTimeout(() => {
          void runSuggestion(focal);
        }, 100);
      } else {
        await canvasHandleRef.current?.loadFile(file);
        // Dimensions aus dem Canvas-Element lesen — wurde von loadFile gesetzt
        const c = canvasElement;
        if (c) setImageDims({ width: c.width, height: c.height });
        // JPEG/PNG-Pfad: keine EXIF-Brennweite, aber Face-Detection kann
        // Portraits trotzdem erkennen. Gleicher Render-Tick-Delay.
        setTimeout(() => {
          void runSuggestion(null);
        }, 100);
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

  const onApplySuggestion = useCallback(async (genre: Genre) => {
    setSuggestedGenre(null);
    setSuggestionDismissed(true);
    try {
      const list = await api.listPresets();
      const preset = list.find((p) => p.name === genre);
      if (!preset) return;
      useEditorStore.getState().applyAdjustments(preset.adjustments);
      setLoadedPresetId(preset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preset-Vorschlag laden fehlgeschlagen");
    }
  }, [api]);

  const onToggleCompare = useCallback(() => {
    if (compareSnapshot) {
      setCompareSnapshot(null);
      return;
    }
    const url = canvasHandleRef.current?.takeBypassSnapshot?.();
    if (url) {
      setCompareSnapshot(url);
      setSplitX(0.5);
    }
  }, [compareSnapshot]);

  const onAutoTone = useCallback(() => {
    if (!canvasElement) return;
    const stats = analyze(canvasElement);
    if (!stats) return;
    const cur = useEditorStore.getState().adjustments;
    const delta = computeAutoTone(stats, cur);
    useEditorStore.getState().applyAdjustments({ ...cur, ...delta });
  }, [canvasElement]);

  const onAutoWb = useCallback(() => {
    if (!canvasElement) return;
    const stats = analyze(canvasElement);
    if (!stats) return;
    const cur = useEditorStore.getState().adjustments;
    const delta = computeAutoWb(stats, cur);
    useEditorStore.getState().applyAdjustments({ ...cur, ...delta });
  }, [canvasElement]);

  const onAutoStraighten = useCallback(() => {
    if (!canvasElement) return;
    const result = analyzeCanvasStraightenAngle(canvasElement);
    if (!result) return;
    // Confidence-Schwelle vermeidet Noise-Snaps bei abstrakten Bildern.
    if (result.confidence < 0.15) return;
    setStraightenAngle(result.angleRad);
  }, [canvasElement, setStraightenAngle]);

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
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch {
        /* jsdom */
      }
      // Bei zwei Pointern: Pinch-Modus. Pan abbrechen.
      if (pointersRef.current.size === 2) {
        const [a, b] = Array.from(pointersRef.current.values());
        if (!a || !b) return;
        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const cx = (a.x + b.x) / 2 - rect.left - rect.width / 2;
        const cy = (a.y + b.y) / 2 - rect.top - rect.height / 2;
        pinchRef.current = {
          baseDistance: Math.max(1, Math.hypot(dx, dy)),
          baseZoom: zoom,
          anchorX: cx,
          anchorY: cy,
          basePanX: pan.x,
          basePanY: pan.y,
        };
        panDragRef.current = null;
        setIsPanning(false);
        return;
      }
      // Erster Pointer: Pan starten.
      panDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      };
      setIsPanning(true);
    },
    [hasImage, cropMode, wbPickerActive, pan, zoom],
  );

  const onViewportPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Pointer-Position in der Map updaten (auch wenn nicht im Capture).
      if (pointersRef.current.has(e.pointerId)) {
        pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const [a, b] = Array.from(pointersRef.current.values());
        if (!a || !b) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.max(1, Math.hypot(dx, dy));
        const ratio = dist / pinch.baseDistance;
        const next = Math.max(0.1, Math.min(10, pinch.baseZoom * ratio));
        const r = next / pinch.baseZoom;
        // Anker-Logik analog zum Wheel-Zoom: der Punkt unter dem
        // Pinch-Mittelpunkt soll an seiner Stelle bleiben.
        setPan({
          x: pinch.anchorX - (pinch.anchorX - pinch.basePanX) * r,
          y: pinch.anchorY - (pinch.anchorY - pinch.basePanY) * r,
        });
        setZoom(next);
        return;
      }
      const drag = panDragRef.current;
      if (!drag) return;
      setPan({
        x: drag.panX + (e.clientX - drag.startX),
        y: drag.panY + (e.clientY - drag.startY),
      });
    },
    [],
  );

  const onViewportPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      pointersRef.current.delete(e.pointerId);
      // Wenn Pinch-Modus laeuft und jetzt < 2 Pointer: Pinch beenden.
      if (pinchRef.current && pointersRef.current.size < 2) {
        pinchRef.current = null;
      }
      // Wenn jetzt noch genau 1 Pointer aktiv ist: Pan-Drag wieder
      // aufgreifen (User loest einen von zwei Fingern).
      if (pointersRef.current.size === 1 && !panDragRef.current) {
        const [remaining] = Array.from(pointersRef.current.values());
        if (remaining) {
          panDragRef.current = {
            startX: remaining.x,
            startY: remaining.y,
            panX: pan.x,
            panY: pan.y,
          };
          setIsPanning(true);
        }
      }
      if (pointersRef.current.size === 0) {
        panDragRef.current = null;
        setIsPanning(false);
      }
    },
    [pan],
  );

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
    onShowHelp: () => setHelpOpen(true),
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
          // Browser-Default-Touch-Gesten (Scroll, Pinch-zoom-Page) aus —
          // wir uebernehmen Pinch + Pan selbst via Pointer-Events.
          touchAction: hasImage ? "none" : "auto",
        }}
      >
        <EditorOverlayCanvas
          canvasHandleRef={canvasHandleRef}
          onTick={onTick}
          onError={onCanvasError}
          onCanvasMount={onCanvasMount}
          pan={pan}
          zoom={zoom}
          isPanning={isPanning}
          hasImage={hasImage}
          cropMode={cropMode}
          cropRect={cropRect}
          aspect={aspect}
          imageAspect={imageAspect}
          onCropChange={setCropRect}
          selectedLinear={selectedLinear}
          selectedRadial={selectedRadial}
          onLinearMaskPoint={setLinearMaskPoint}
          onRadialMaskCenter={setRadialMaskCenter}
          onRadialMaskRadii={setRadialMaskRadii}
          compareSnapshot={compareSnapshot}
          splitX={splitX}
          onSplitChange={setSplitX}
          straightenAngle={straightenAngle}
        />

        <input
          ref={fileInputRef}
          data-testid="editor-file-input"
          type="file"
          accept={FILE_PICKER_ACCEPT}
          className="hidden"
          onChange={onPick}
        />

        {!hasImage && !error && (
          <div className="absolute inset-8 flex flex-col items-center justify-center text-stone-500 pointer-events-none gap-4 border-2 border-dashed border-stone-800 rounded-lg">
            <svg
              className="w-12 h-12 text-stone-700"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span className="text-xl">Bild hierhin ziehen</span>
            <div className="flex gap-3 pointer-events-auto">
              <button
                type="button"
                data-testid="editor-load-sample"
                onClick={() => {
                  void (async () => {
                    try {
                      const resp = await fetch("/sample.jpg");
                      if (!resp.ok) throw new Error("Sample-Bild nicht erreichbar");
                      const blob = await resp.blob();
                      const file = new File([blob], "sample.jpg", { type: "image/jpeg" });
                      await onFile(file);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "Sample-Load fehlgeschlagen");
                    }
                  })();
                }}
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] bg-amber-200/15 border border-amber-300 text-amber-200 hover:bg-amber-200/25"
              >
                Beispielbild laden
              </button>
              <button
                type="button"
                onClick={triggerFileDialog}
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40"
              >
                Datei wählen
              </button>
            </div>
          </div>
        )}

        <EditorBanners
          error={error}
          onErrorDismiss={() => setError(null)}
          decoding={decoding}
          cameraInfo={cameraInfo}
          suggestedGenre={suggestedGenre}
          suggestionDismissed={suggestionDismissed}
          onApplySuggestion={(g) => void onApplySuggestion(g)}
          onDismissSuggestion={() => setSuggestionDismissed(true)}
        />

        {hasImage && (
          <EditorToolbar
            bypass={bypass}
            onBypassDown={() => setBypass(true)}
            onBypassUp={() => setBypass(false)}
            cropMode={cropMode}
            onToggleCrop={toggleCropMode}
            onAutoTone={onAutoTone}
            onAutoWb={onAutoWb}
            compareActive={compareSnapshot !== null}
            onToggleCompare={onToggleCompare}
            wbPickerActive={wbPickerActive}
            onToggleWbPicker={() => setWbPickerActive((v) => !v)}
            zoom={zoom}
            canResetView={!(zoom === 1 && pan.x === 0 && pan.y === 0)}
            onResetView={resetView}
            canUndo={canUndo}
            onUndo={undo}
            canRedo={canRedo}
            onRedo={redo}
            canAddLinear={canAddLinear}
            onAddLinear={() => addLinearMask()}
            canAddRadial={canAddRadial}
            onAddRadial={() => addRadialMask()}
            onShowHelp={() => setHelpOpen(true)}
            onShowPresets={() => setPresetDialogOpen(true)}
            onExport={triggerExport}
          />
        )}

        {presetDialogOpen && (
          <PresetDialog
            open={presetDialogOpen}
            onClose={() => setPresetDialogOpen(false)}
            loadedPresetId={loadedPresetId}
            onLoadedPresetIdChange={setLoadedPresetId}
          />
        )}

        <ShortcutCheatsheet open={helpOpen} onClose={() => setHelpOpen(false)} />

        {exportOpen && (
          <ExportDialog
            canvasWidth={canvasElement?.width ?? 0}
            format={exportFormat}
            onFormatChange={setExportFormat}
            quality={exportQuality}
            onQualityChange={setExportQuality}
            width={exportWidth}
            onWidthChange={setExportWidth}
            exporting={exporting}
            onConfirm={() => void doExport()}
            onCancel={() => setExportOpen(false)}
          />
        )}
      </main>

      <EditorSidebar
        canvasElement={canvasElement}
        tick={tick}
        aspect={aspect}
        onAspectChange={setAspect}
        straightenAngle={straightenAngle}
        onStraightenChange={setStraightenAngle}
        onAutoStraighten={onAutoStraighten}
        onResetGeometry={resetGeometry}
        masks={masks}
        selectedMaskId={selectedMaskId}
        selected={selected}
        onSelectMask={selectMask}
        onRemoveMask={removeMask}
        onLocalAdjust={setMaskLocalAdjustment}
        onMaskFeather={setMaskFeather}
        onRemoveSelectedMask={removeSelectedMask}
        lensCorrection={lensCorrection}
        lensProfileId={lensProfileId}
        manualLensOverride={manualLensOverride}
        onLensCorrectionChange={setLensCorrection}
        adjustments={adjustments}
        onAdjustment={setAdjustment}
        onHslChange={setHslChannel}
        onHslReset={resetHsl}
        onToneCurveSetPoint={setToneCurvePoint}
        onToneCurveAddPoint={addToneCurvePoint}
        onToneCurveRemovePoint={removeToneCurvePoint}
        onToneCurveReset={resetToneCurve}
        onResetAll={resetAll}
      />

      {onboardingOpen && (
        <OnboardingTour onClose={() => setOnboardingOpen(false)} />
      )}
    </section>
  );
}
