import { useCallback, useRef, useState } from "react";

import {
  ADJUSTMENTS,
  type AdjustmentDefinition,
  adjustmentsByGroup,
} from "../editor/adjustments";
import Canvas, { type CanvasHandle } from "../editor/Canvas";
import {
  type ExportFormat,
  downloadBlob,
  exportCanvas,
  suggestFilename,
} from "../editor/export";
import Histogram from "../editor/Histogram";
import { decodeRaw, isRawFile, rgbToImageBitmap } from "../editor/raw";
import Slider from "../editor/Slider";
import { useEditorStore } from "../editor/store";
import { useKeyboardShortcuts } from "../editor/useKeyboardShortcuts";

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

  const adjustments = useEditorStore((s) => s.adjustments);
  const setAdjustment = useEditorStore((s) => s.setAdjustment);
  const resetAll = useEditorStore((s) => s.resetAll);
  const bypass = useEditorStore((s) => s.bypass);
  const setBypass = useEditorStore((s) => s.setBypass);

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
    try {
      const isRaw = await isRawFile(file);
      if (isRaw) {
        setDecoding(true);
        const decoded = await decodeRaw(file);
        const bitmap = await rgbToImageBitmap(decoded.rgb, decoded.width, decoded.height);
        canvasHandleRef.current?.loadBitmap(bitmap, decoded.width, decoded.height);
        if (decoded.cameraMake || decoded.cameraModel) {
          setCameraInfo(
            [decoded.cameraMake, decoded.cameraModel].filter(Boolean).join(" "),
          );
        }
      } else {
        await canvasHandleRef.current?.loadFile(file);
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

  useKeyboardShortcuts({
    onResetAll: resetAll,
    onExport: triggerExport,
    onOpenFile: triggerFileDialog,
    setBypass,
  });

  return (
    <section data-testid="page-editor" className="flex h-[calc(100vh-3rem)]">
      <main
        className="flex-1 relative flex items-center justify-center bg-stone-950 overflow-hidden p-8"
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <Canvas
          ref={canvasHandleRef}
          onTick={onTick}
          onError={onCanvasError}
          onCanvasMount={onCanvasMount}
        />

        <input
          ref={fileInputRef}
          data-testid="editor-file-input"
          type="file"
          accept="image/*"
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
          <p
            data-testid="editor-error"
            className="absolute top-4 left-1/2 -translate-x-1/2 text-red-400"
          >
            {error}
          </p>
        )}

        {decoding && (
          <p
            data-testid="editor-decoding"
            className="absolute top-4 left-1/2 -translate-x-1/2 text-amber-200"
          >
            RAW wird dekodiert …
          </p>
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
          <div className="absolute bottom-6 left-6 flex gap-2">
            <button
              type="button"
              data-testid="editor-bypass"
              onPointerDown={() => setBypass(true)}
              onPointerUp={() => setBypass(false)}
              onPointerLeave={() => setBypass(false)}
              className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] bg-stone-900/80 backdrop-blur border border-stone-700 hover:border-amber-300/40 text-stone-300"
            >
              {bypass ? "Original" : "Halten für Original"}
            </button>
            <button
              type="button"
              data-testid="editor-export"
              onClick={triggerExport}
              className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] bg-stone-900/80 backdrop-blur border border-stone-700 hover:border-amber-300/40 text-stone-300"
            >
              Exportieren
            </button>
          </div>
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
