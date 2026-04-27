import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import { useEditorStore } from "./store";
import { uvTransformMatrix } from "./transform";
import { Renderer, WebGLRendererError, loadImageFromFile } from "./webgl";

export interface CanvasHandle {
  /** Laedt JPEG/PNG via Browser-Decoder. */
  loadFile(file: File): Promise<void>;
  /** Laedt ein bereits dekodiertes Bild (z.B. aus RAW). */
  loadBitmap(bitmap: ImageBitmap, width: number, height: number): void;
  /** Erzwingt einen Re-Render mit aktuellem Store-State. */
  render(): void;
}

interface Props {
  readonly onTick: () => void;
  readonly onError: (message: string) => void;
  /** Wird beim Mount mit dem Canvas-Element aufgerufen. */
  readonly onCanvasMount?: (canvas: HTMLCanvasElement) => void;
}

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { onTick, onError, onCanvasMount },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);

  const adjustments = useEditorStore((s) => s.adjustments);
  const bypass = useEditorStore((s) => s.bypass);
  const cropRect = useEditorStore((s) => s.cropRect);
  const straightenAngle = useEditorStore((s) => s.straightenAngle);

  const transform = useMemo(
    () => uvTransformMatrix(cropRect, straightenAngle),
    [cropRect, straightenAngle],
  );

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
    r.render(adjustments, bypass, transform);
    onTick();
  }, [adjustments, bypass, transform, onTick]);

  useImperativeHandle(
    ref,
    (): CanvasHandle => ({
      async loadFile(file: File) {
        const r = rendererRef.current;
        if (!r) throw new Error("Renderer nicht initialisiert");
        const { image, width, height } = await loadImageFromFile(file);
        r.loadImage(image, width, height);
        const state = useEditorStore.getState();
        r.render(
          state.adjustments,
          state.bypass,
          uvTransformMatrix(state.cropRect, state.straightenAngle),
        );
        onTick();
      },
      loadBitmap(bitmap, width, height) {
        const r = rendererRef.current;
        if (!r) throw new Error("Renderer nicht initialisiert");
        const maxW = 1600;
        const scale = Math.min(1, maxW / width);
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        r.loadImage(bitmap, w, h);
        const state = useEditorStore.getState();
        r.render(
          state.adjustments,
          state.bypass,
          uvTransformMatrix(state.cropRect, state.straightenAngle),
        );
        onTick();
      },
      render: () => {
        const r = rendererRef.current;
        if (!r || !r.hasImage()) return;
        const state = useEditorStore.getState();
        r.render(
          state.adjustments,
          state.bypass,
          uvTransformMatrix(state.cropRect, state.straightenAngle),
        );
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
