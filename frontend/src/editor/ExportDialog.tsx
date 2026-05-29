import type { ExportFormat } from "./export";

interface Props {
  readonly canvasWidth: number;
  readonly format: ExportFormat;
  readonly onFormatChange: (f: ExportFormat) => void;
  readonly quality: number;
  readonly onQualityChange: (q: number) => void;
  readonly width: number | "native";
  readonly onWidthChange: (w: number | "native") => void;
  readonly exporting: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Export-Dialog (Format/Qualitaet/Breite). State wird vom Editor gehalten,
 * der Dialog ist rein praesentationell.
 */
export default function ExportDialog({
  canvasWidth,
  format,
  onFormatChange,
  quality,
  onQualityChange,
  width,
  onWidthChange,
  exporting,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <div
      data-testid="export-dialog"
      className="absolute bottom-20 left-6 w-72 bg-stone-900/95 backdrop-blur border border-stone-700 p-4 text-sm space-y-3"
    >
      <h2 className="text-stone-200">Export</h2>

      <label className="block">
        <span className="text-stone-400 text-xs">Format</span>
        <select
          value={format}
          onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
          data-testid="export-format"
          className="mt-1 w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
        >
          <option value="jpeg">JPEG</option>
          <option value="png">PNG</option>
          <option value="webp">WebP</option>
        </select>
      </label>

      {format !== "png" && (
        <label className="block">
          <span className="text-stone-400 text-xs">
            Qualität: {Math.round(quality * 100)}
          </span>
          <input
            type="range"
            min={0.5}
            max={1}
            step={0.01}
            value={quality}
            onChange={(e) => onQualityChange(Number(e.target.value))}
            data-testid="export-quality"
            className="mt-1 w-full"
          />
        </label>
      )}

      <label className="block">
        <span className="text-stone-400 text-xs">Breite</span>
        <select
          value={width === "native" ? "native" : String(width)}
          onChange={(e) =>
            onWidthChange(
              e.target.value === "native" ? "native" : Number(e.target.value),
            )
          }
          data-testid="export-width"
          className="mt-1 w-full bg-stone-950 border border-stone-700 px-2 py-1 text-stone-200"
        >
          <option value="native">Original ({canvasWidth}px)</option>
          <option value="2048">2048 px</option>
          <option value="1024">1024 px</option>
          <option value="512">512 px (Web)</option>
        </select>
      </label>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs uppercase tracking-wider text-stone-500"
        >
          Abbrechen
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={exporting}
          data-testid="export-confirm"
          className="text-xs uppercase tracking-wider text-amber-200 hover:text-amber-100 disabled:opacity-50"
        >
          {exporting ? "Exportiere…" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
