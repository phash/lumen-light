import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import type { MaskInstance } from "./mask";
import { useEditorStore, type EditorState } from "./store";
import { uvTransformMatrix } from "./transform";
import {
  type LinearMaskParams,
  type MasksUniforms,
  type RadialMaskParams,
  Renderer,
  WebGLRendererError,
  loadImageFromFile,
} from "./webgl";

function buildMasksUniforms(
  masks: ReadonlyArray<MaskInstance>,
): MasksUniforms {
  const linear: LinearMaskParams[] = [];
  const radial: RadialMaskParams[] = [];
  for (const m of masks) {
    if (m.type === "linear") {
      linear.push({
        p1u: m.mask.p1.u,
        p1v: m.mask.p1.v,
        p2u: m.mask.p2.u,
        p2v: m.mask.p2.v,
        feather: m.mask.feather,
        exposure: m.localAdj.exposure,
        contrast: m.localAdj.contrast,
        saturation: m.localAdj.saturation,
        temperature: m.localAdj.temperature,
      });
    } else {
      radial.push({
        cu: m.mask.center.u,
        cv: m.mask.center.v,
        rx: m.mask.rx,
        ry: m.mask.ry,
        feather: m.mask.feather,
        exposure: m.localAdj.exposure,
        contrast: m.localAdj.contrast,
        saturation: m.localAdj.saturation,
        temperature: m.localAdj.temperature,
      });
    }
  }
  return { linear, radial };
}

function masksFromState(state: EditorState): MasksUniforms {
  return buildMasksUniforms(state.masks);
}

export interface CanvasHandle {
  /** Laedt JPEG/PNG via Browser-Decoder. */
  loadFile(file: File): Promise<void>;
  /** Laedt ein bereits dekodiertes Bild (z.B. aus RAW). */
  loadBitmap(bitmap: ImageBitmap, width: number, height: number): void;
  /** Erzwingt einen Re-Render mit aktuellem Store-State. */
  render(): void;
  /** Rendert das Bild kurz mit bypass=true, liefert es als DataURL,
   *  rendert direkt wieder normal. Fuer Vorher/Nachher-Snapshots. */
  takeBypassSnapshot(): string | null;
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
  const masks = useEditorStore((s) => s.masks);

  const transform = useMemo(
    () => uvTransformMatrix(cropRect, straightenAngle),
    [cropRect, straightenAngle],
  );

  const masksUniforms = useMemo<MasksUniforms>(
    () => buildMasksUniforms(masks),
    [masks],
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
      masksUniforms,
    );
    onTick();
  }, [adjustments, bypass, transform, lensCorrection, masksUniforms, onTick]);

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
          masksFromState(s),
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
          masksFromState(s),
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
          masksFromState(s),
        );
        onTick();
      },
      takeBypassSnapshot: () => {
        const r = rendererRef.current;
        const c = canvasRef.current;
        if (!r || !c || !r.hasImage()) return null;
        const s = useEditorStore.getState();
        // 1. Render Pass mit bypass=true -> die Canvas zeigt das Original.
        r.render(
          s.adjustments,
          true,
          uvTransformMatrix(s.cropRect, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
        );
        const url = c.toDataURL("image/png");
        // 2. Sofort wieder mit aktuellen bypass-Wert rendern, damit der
        //    User keinen Flash sieht.
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(s.cropRect, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
        );
        return url;
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
