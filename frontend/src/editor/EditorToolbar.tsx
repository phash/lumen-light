/**
 * Editor-Toolbar: drei Button-Gruppen am unteren Bildrand.
 *
 *   Gruppe 1: View-Aktionen (Bypass, Crop, Auto-Tone, Auto-WB,
 *             Compare, WB-Picker, Reset-View, Undo/Redo)
 *   Gruppe 2: Mask-Aktionen (+Verlauf, +Radial)
 *   Gruppe 3: Hilfe/Presets/Export
 *
 * Stateless: alle Werte und Callbacks kommen vom Editor (Parent).
 * Reine UI-Aufteilung — keine Verhaltens-Aenderung gegenueber dem
 * inline-rendering vorher in Editor.tsx.
 */

interface Props {
  // View
  readonly bypass: boolean;
  readonly onBypassDown: () => void;
  readonly onBypassUp: () => void;
  readonly cropMode: boolean;
  readonly onToggleCrop: () => void;
  readonly onAutoTone: () => void;
  readonly onAutoWb: () => void;
  readonly compareActive: boolean;
  readonly onToggleCompare: () => void;
  readonly wbPickerActive: boolean;
  readonly onToggleWbPicker: () => void;
  readonly zoom: number;
  readonly canResetView: boolean;
  readonly onResetView: () => void;
  readonly canUndo: boolean;
  readonly onUndo: () => void;
  readonly canRedo: boolean;
  readonly onRedo: () => void;

  // Masken
  readonly canAddLinear: boolean;
  readonly onAddLinear: () => void;
  readonly canAddRadial: boolean;
  readonly onAddRadial: () => void;

  // Action
  readonly onShowHelp: () => void;
  readonly onShowPresets: () => void;
  readonly onExport: () => void;
}

export default function EditorToolbar({
  bypass,
  onBypassDown,
  onBypassUp,
  cropMode,
  onToggleCrop,
  onAutoTone,
  onAutoWb,
  compareActive,
  onToggleCompare,
  wbPickerActive,
  onToggleWbPicker,
  zoom,
  canResetView,
  onResetView,
  canUndo,
  onUndo,
  canRedo,
  onRedo,
  canAddLinear,
  onAddLinear,
  canAddRadial,
  onAddRadial,
  onShowHelp,
  onShowPresets,
  onExport,
}: Props) {
  return (
    <div className="absolute bottom-6 left-6 right-6 flex justify-between items-end gap-3 pointer-events-none">
      {/* Gruppe 1: View */}
      <div className="flex gap-1 pointer-events-auto bg-stone-900/80 backdrop-blur border border-stone-700 p-1 rounded">
        <button
          type="button"
          data-testid="editor-bypass"
          onPointerDown={onBypassDown}
          onPointerUp={onBypassUp}
          onPointerLeave={onBypassUp}
          className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
            bypass ? "bg-amber-200/20 text-amber-200" : "text-stone-300 hover:text-amber-200"
          }`}
          title="Druecken & halten zeigt Original (Shortcut: \\)"
          aria-label="Original anzeigen (halten)"
        >
          <svg className="w-4 h-4 inline-block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        <button
          type="button"
          data-testid="editor-crop-toggle"
          onClick={onToggleCrop}
          className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
            cropMode ? "bg-amber-200/20 text-amber-200" : "text-stone-300 hover:text-amber-200"
          }`}
          title="Beschneiden (R)"
        >
          {cropMode ? "Crop fertig" : "Beschneiden"}
        </button>
        <button
          type="button"
          data-testid="editor-auto-tone"
          onClick={onAutoTone}
          className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200"
          title="Automatisch Belichtung+Kontrast aus Histogramm setzen"
        >
          Auto-Ton
        </button>
        <button
          type="button"
          data-testid="editor-auto-wb"
          onClick={onAutoWb}
          className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200"
          title="Auto-Weissabgleich (Gray-World)"
        >
          Auto-WB
        </button>
        <button
          type="button"
          data-testid="editor-compare-toggle"
          onClick={onToggleCompare}
          className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
            compareActive ? "bg-amber-200/20 text-amber-200" : "text-stone-300 hover:text-amber-200"
          }`}
          title="Vorher/Nachher-Split-Compare ein/aus"
        >
          Vorher/Nachher
        </button>
        <button
          type="button"
          data-testid="editor-wb-picker"
          onClick={(e) => {
            e.stopPropagation();
            onToggleWbPicker();
          }}
          className={`px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] ${
            wbPickerActive ? "bg-amber-200/20 text-amber-200" : "text-stone-300 hover:text-amber-200"
          }`}
          title="Klick auf neutralen Bildbereich setzt Weissabgleich"
        >
          WB-Picker
        </button>
        <button
          type="button"
          data-testid="editor-reset-view"
          onClick={onResetView}
          disabled={!canResetView}
          className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Zoom + Pan zuruecksetzen"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          data-testid="editor-undo"
          onClick={onUndo}
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
          onClick={onRedo}
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
          onClick={onAddLinear}
          className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Linearen Verlaufsfilter hinzufuegen"
        >
          + Verlauf
        </button>
        <button
          type="button"
          data-testid="editor-radial-mask-toggle"
          disabled={!canAddRadial}
          onClick={onAddRadial}
          className="px-2.5 py-1 text-[10px] uppercase tracking-[0.18em] text-stone-300 hover:text-amber-200 disabled:opacity-40 disabled:cursor-not-allowed"
          title="Elliptische Radialmaske hinzufuegen"
        >
          + Radial
        </button>
      </div>

      {/* Gruppe 3: Action */}
      <div className="flex gap-1 pointer-events-auto">
        <button
          type="button"
          data-testid="editor-help"
          onClick={onShowHelp}
          className="w-9 h-9 text-base bg-stone-900/80 backdrop-blur border border-stone-700 hover:border-amber-300/40 text-stone-300"
          title="Tastenkuerzel anzeigen (?)"
          aria-label="Hilfe / Tastenkuerzel"
        >
          ?
        </button>
        <button
          type="button"
          data-testid="editor-presets"
          onClick={onShowPresets}
          className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] bg-stone-900/80 backdrop-blur border border-stone-700 hover:border-amber-300/40 text-stone-300"
          title="Presets verwalten (P)"
        >
          Presets
        </button>
        <button
          type="button"
          data-testid="editor-export"
          onClick={onExport}
          className="px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] bg-amber-200/15 backdrop-blur border border-amber-300/50 hover:border-amber-300 text-amber-200"
          title="Exportieren (Cmd+E)"
        >
          Exportieren
        </button>
      </div>
    </div>
  );
}
