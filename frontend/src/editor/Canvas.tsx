import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { useEditorStore } from "./store";
import { Renderer, WebGLRendererError, loadImageFromFile } from "./webgl";

export interface CanvasHandle {
  /** Laedt eine Datei und rendert das Bild. */
  loadFile(file: File): Promise<void>;
  /** Erzwingt einen Re-Render mit aktuellem Store-State. */
  render(): void;
}

interface Props {
  readonly onTick: () => void;
  readonly onError: (message: string) => void;
  /** Wird beim Mount mit dem Canvas-Element aufgerufen — fuer das
   *  Histogramm-Sampling, damit der Editor das Element nicht via
   *  ref aus dem Render lesen muss. */
  readonly onCanvasMount?: (canvas: HTMLCanvasElement) => void;
}

/**
 * Canvas-Komponente, die einen WebGL2-Renderer kapselt. Nimmt File-Loads
 * entgegen und re-rendert bei Adjustments-Aenderung. Tick-Callback wird
 * nach jedem Render gefeuert (fuer Histogramm-Update).
 */
const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { onTick, onError, onCanvasMount },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const adjustments = useEditorStore((s) => s.adjustments);
  const bypass = useEditorStore((s) => s.bypass);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      rendererRef.current = new Renderer(canvas);
      onCanvasMount?.(canvas);
    } catch (err) {
      onError(err instanceof WebGLRendererError ? err.message : String(err));
    }
  }, [onError, onCanvasMount]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !r.hasImage()) return;
    r.render(adjustments, bypass);
    onTick();
  }, [adjustments, bypass, onTick]);

  useImperativeHandle(
    ref,
    (): CanvasHandle => ({
      async loadFile(file: File) {
        const r = rendererRef.current;
        if (!r) throw new Error("Renderer nicht initialisiert");
        const { image, width, height } = await loadImageFromFile(file);
        r.loadImage(image, width, height);
        r.render(useEditorStore.getState().adjustments, useEditorStore.getState().bypass);
        onTick();
      },
      render: () => {
        const r = rendererRef.current;
        if (!r || !r.hasImage()) return;
        r.render(useEditorStore.getState().adjustments, useEditorStore.getState().bypass);
        onTick();
      },
    }),
    [onTick],
  );

  return (
    <canvas
      ref={canvasRef}
      data-testid="editor-canvas"
      className="max-w-full max-h-full shadow-2xl shadow-black"
    />
  );
});

export default Canvas;
