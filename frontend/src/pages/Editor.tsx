import { useCallback, useRef, useState } from "react";

import {
  ADJUSTMENTS,
  type AdjustmentDefinition,
  adjustmentsByGroup,
} from "../editor/adjustments";
import Canvas, { type CanvasHandle } from "../editor/Canvas";
import Histogram from "../editor/Histogram";
import Slider from "../editor/Slider";
import { useEditorStore } from "../editor/store";

export default function Editor() {
  const canvasHandleRef = useRef<CanvasHandle>(null);
  const [canvasElement, setCanvasElement] = useState<HTMLCanvasElement | null>(null);
  const [hasImage, setHasImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const adjustments = useEditorStore((s) => s.adjustments);
  const setAdjustment = useEditorStore((s) => s.setAdjustment);
  const resetAll = useEditorStore((s) => s.resetAll);

  const groups = adjustmentsByGroup();

  const onTick = useCallback(() => setTick((t) => t + 1), []);
  const onCanvasError = useCallback((msg: string) => setError(msg), []);
  const onCanvasMount = useCallback((c: HTMLCanvasElement) => setCanvasElement(c), []);

  const onFile = async (file: File) => {
    setError(null);
    try {
      await canvasHandleRef.current?.loadFile(file);
      setHasImage(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bild konnte nicht geladen werden");
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

        {!hasImage && !error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-stone-500 pointer-events-none">
            <span className="text-xl">Bild hierhin ziehen</span>
            <label className="mt-3 cursor-pointer text-amber-200 hover:underline pointer-events-auto">
              oder Datei wählen
              <input
                data-testid="editor-file-input"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={onPick}
              />
            </label>
          </div>
        )}

        {error && (
          <p data-testid="editor-error" className="absolute top-4 left-1/2 -translate-x-1/2 text-red-400">
            {error}
          </p>
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
