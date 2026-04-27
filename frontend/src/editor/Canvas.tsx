import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import { useEditorStore, type EditorState } from "./store";
import { uvTransformMatrix } from "./transform";
import {
  type LinearMaskUniforms,
  type RadialMaskUniforms,
  Renderer,
  WebGLRendererError,
  loadImageFromFile,
} from "./webgl";

function buildMaskUniforms(state: EditorState): LinearMaskUniforms {
  return {
    enabled: state.linearMaskEnabled,
    p1u: state.linearMask.p1.u,
    p1v: state.linearMask.p1.v,
    p2u: state.linearMask.p2.u,
    p2v: state.linearMask.p2.v,
    feather: state.linearMask.feather,
    exposure: state.linearLocalAdj.exposure,
    contrast: state.linearLocalAdj.contrast,
    saturation: state.linearLocalAdj.saturation,
    temperature: state.linearLocalAdj.temperature,
  };
}

function buildRadialUniforms(state: EditorState): RadialMaskUniforms {
  return {
    enabled: state.radialMaskEnabled,
    cu: state.radialMask.center.u,
    cv: state.radialMask.center.v,
    rx: state.radialMask.rx,
    ry: state.radialMask.ry,
    feather: state.radialMask.feather,
    exposure: state.radialLocalAdj.exposure,
    contrast: state.radialLocalAdj.contrast,
    saturation: state.radialLocalAdj.saturation,
    temperature: state.radialLocalAdj.temperature,
  };
}

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
  const lensCorrection = useEditorStore((s) => s.lensCorrection);
  const linearMaskEnabled = useEditorStore((s) => s.linearMaskEnabled);
  const linearMask = useEditorStore((s) => s.linearMask);
  const linearLocalAdj = useEditorStore((s) => s.linearLocalAdj);
  const radialMaskEnabled = useEditorStore((s) => s.radialMaskEnabled);
  const radialMask = useEditorStore((s) => s.radialMask);
  const radialLocalAdj = useEditorStore((s) => s.radialLocalAdj);

  const transform = useMemo(
    () => uvTransformMatrix(cropRect, straightenAngle),
    [cropRect, straightenAngle],
  );

  const mask = useMemo<LinearMaskUniforms>(
    () => ({
      enabled: linearMaskEnabled,
      p1u: linearMask.p1.u,
      p1v: linearMask.p1.v,
      p2u: linearMask.p2.u,
      p2v: linearMask.p2.v,
      feather: linearMask.feather,
      exposure: linearLocalAdj.exposure,
      contrast: linearLocalAdj.contrast,
      saturation: linearLocalAdj.saturation,
      temperature: linearLocalAdj.temperature,
    }),
    [linearMaskEnabled, linearMask, linearLocalAdj],
  );

  const radial = useMemo<RadialMaskUniforms>(
    () => ({
      enabled: radialMaskEnabled,
      cu: radialMask.center.u,
      cv: radialMask.center.v,
      rx: radialMask.rx,
      ry: radialMask.ry,
      feather: radialMask.feather,
      exposure: radialLocalAdj.exposure,
      contrast: radialLocalAdj.contrast,
      saturation: radialLocalAdj.saturation,
      temperature: radialLocalAdj.temperature,
    }),
    [radialMaskEnabled, radialMask, radialLocalAdj],
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
    r.render(
      adjustments,
      bypass,
      transform,
      lensCorrection.distortion,
      lensCorrection.vignette,
      mask,
      radial,
    );
    onTick();
  }, [adjustments, bypass, transform, lensCorrection, mask, radial, onTick]);

  useImperativeHandle(
    ref,
    (): CanvasHandle => ({
      async loadFile(file: File) {
        const r = rendererRef.current;
        if (!r) throw new Error("Renderer nicht initialisiert");
        const { image, width, height } = await loadImageFromFile(file);
        r.loadImage(image, width, height);
        const s = useEditorStore.getState();
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(s.cropRect, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          buildMaskUniforms(s),
          buildRadialUniforms(s),
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
        const s = useEditorStore.getState();
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(s.cropRect, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          buildMaskUniforms(s),
          buildRadialUniforms(s),
        );
        onTick();
      },
      render: () => {
        const r = rendererRef.current;
        if (!r || !r.hasImage()) return;
        const s = useEditorStore.getState();
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(s.cropRect, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          buildMaskUniforms(s),
          buildRadialUniforms(s),
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
