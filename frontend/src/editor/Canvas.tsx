import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";

import type { MaskInstance } from "./mask";
import { useEditorStore, type EditorState } from "./store";
import {
  type CropRect,
  cropOutputSize,
  defaultCropRect,
  uvTransformMatrix,
} from "./transform";

const IDENTITY_CROP: CropRect = defaultCropRect();
import {
  type LinearMaskParams,
  type MasksUniforms,
  type RadialMaskParams,
  Renderer,
  WebGLRendererError,
  loadImageFromFile,
} from "./webgl";

/** Berechnet das Output-Pixel-Format aus Original-Bildgroesse und Crop —
 *  damit das gecropte Rechteck pixelgenau auf den Drawingbuffer gemapt
 *  wird, statt gestreckt zu werden. */
function outputSizeFor(
  r: Renderer,
  crop: CropRect,
): { width: number; height: number } {
  return cropOutputSize(r.imageWidth, r.imageHeight, crop);
}

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
  /** Laedt JPEG/PNG via Browser-Decoder. Liefert die (ggf. herunterskalierten)
   *  Bild-Dimensionen — Aufrufer muss nicht mehr das Canvas-Element auslesen. */
  loadFile(file: File): Promise<{ width: number; height: number }>;
  /** Laedt ein bereits dekodiertes Bild (z.B. aus RAW). */
  loadBitmap(bitmap: ImageBitmap, width: number, height: number): void;
  /** Erzwingt einen Re-Render mit aktuellem Store-State. */
  render(): void;
  /** Rendert das Bild kurz mit bypass=true, liefert es als DataURL,
   *  rendert direkt wieder normal. Fuer Vorher/Nachher-Snapshots. */
  takeBypassSnapshot(): string | null;
  /** Rendert das Bild in voller Original-Aufloesung offscreen durch dieselbe
   *  Pipeline (die Live-Vorschau bleibt aus Performance-Gruenden gedeckelt).
   *  Liefert das Canvas + eine dispose()-Funktion (WebGL-Context freigeben).
   *  null, wenn kein Bild geladen ist oder kein WebGL-Context verfuegbar. */
  exportFullResCanvas(): { canvas: HTMLCanvasElement; dispose: () => void } | null;
}

interface Props {
  readonly onTick: () => void;
  readonly onError: (message: string) => void;
  /** Wird beim Mount mit dem Canvas-Element aufgerufen. */
  readonly onCanvasMount?: (canvas: HTMLCanvasElement) => void;
  /** Wenn aktiv, wird das volle Bild angezeigt — der Crop-Overlay
   *  visualisiert das Rechteck nur, das eigentliche Beschneiden findet
   *  erst nach Verlassen des Crop-Modus statt. */
  readonly cropMode: boolean;
}

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { onTick, onError, onCanvasMount, cropMode },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // Original-Vollaufloesungs-Quelle (vor Preview-Downscale) fuer den
  // Full-Res-Export. Die Live-Textur ist zwar bereits voll, aber der
  // Export-Renderer braucht die Quelle + echten Dimensionen separat.
  const fullSourceRef = useRef<{
    source: TexImageSource;
    width: number;
    height: number;
  } | null>(null);

  const adjustments = useEditorStore((s) => s.adjustments);
  const bypass = useEditorStore((s) => s.bypass);
  const storeCropRect = useEditorStore((s) => s.cropRect);
  const straightenAngle = useEditorStore((s) => s.straightenAngle);
  const lensCorrection = useEditorStore((s) => s.lensCorrection);
  const masks = useEditorStore((s) => s.masks);

  // Im Crop-Modus zeigt das Canvas das volle Bild — Crop-Rechteck wird
  // als Overlay visualisiert, nicht als Renderer-Output. Erst nach
  // Verlassen des Crop-Modus wird der Output verkleinert.
  const cropRect = cropMode ? IDENTITY_CROP : storeCropRect;

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
      outputSizeFor(r, cropRect),
      lensCorrection.tcaR,
      lensCorrection.tcaB,
    );
    onTick();
  }, [adjustments, bypass, transform, lensCorrection, masksUniforms, cropRect, onTick]);

  useImperativeHandle(
    ref,
    (): CanvasHandle => ({
      async loadFile(file: File) {
        const r = rendererRef.current;
        if (!r) throw new Error("Renderer nicht initialisiert");
        const { image, width, height } = await loadImageFromFile(file);
        r.loadImage(image, width, height);
        // Original-Aufloesung fuer den Export merken (image ist die volle
        // Datei; width/height sind die Preview-Skalierung).
        fullSourceRef.current = {
          source: image,
          width: image.naturalWidth,
          height: image.naturalHeight,
        };
        const s = useEditorStore.getState();
        const effCrop = cropMode ? IDENTITY_CROP : s.cropRect;
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(effCrop, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
          outputSizeFor(r, effCrop),
          s.lensCorrection.tcaR,
          s.lensCorrection.tcaB,
        );
        onTick();
        // Volle Natural-Dimensionen zurueck — der Aufrufer nutzt sie fuer
        // Aspect + Export-Dialog (nicht den heruntergerechneten Preview-Wert).
        return { width: image.naturalWidth, height: image.naturalHeight };
      },
      loadBitmap(bitmap, width, height) {
        const r = rendererRef.current;
        if (!r) throw new Error("Renderer nicht initialisiert");
        const maxW = 1600;
        const scale = Math.min(1, maxW / width);
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        r.loadImage(bitmap, w, h);
        // bitmap ist die volle RAW-Aufloesung; width/height sind die echten
        // Decoder-Dimensionen -> fuer den Export merken.
        fullSourceRef.current = { source: bitmap, width, height };
        const s = useEditorStore.getState();
        const effCrop = cropMode ? IDENTITY_CROP : s.cropRect;
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(effCrop, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
          outputSizeFor(r, effCrop),
          s.lensCorrection.tcaR,
          s.lensCorrection.tcaB,
        );
        onTick();
      },
      render: () => {
        const r = rendererRef.current;
        if (!r || !r.hasImage()) return;
        const s = useEditorStore.getState();
        const effCrop = cropMode ? IDENTITY_CROP : s.cropRect;
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(effCrop, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
          outputSizeFor(r, effCrop),
          s.lensCorrection.tcaR,
          s.lensCorrection.tcaB,
        );
        onTick();
      },
      takeBypassSnapshot: () => {
        const r = rendererRef.current;
        const c = canvasRef.current;
        if (!r || !c || !r.hasImage()) return null;
        const s = useEditorStore.getState();
        const effCrop = cropMode ? IDENTITY_CROP : s.cropRect;
        // 1. Render Pass mit bypass=true -> die Canvas zeigt das Original.
        r.render(
          s.adjustments,
          true,
          uvTransformMatrix(effCrop, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
          outputSizeFor(r, effCrop),
          s.lensCorrection.tcaR,
          s.lensCorrection.tcaB,
        );
        const url = c.toDataURL("image/png");
        // 2. Sofort wieder mit aktuellen bypass-Wert rendern, damit der
        //    User keinen Flash sieht.
        r.render(
          s.adjustments,
          s.bypass,
          uvTransformMatrix(effCrop, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
          outputSizeFor(r, effCrop),
          s.lensCorrection.tcaR,
          s.lensCorrection.tcaB,
        );
        return url;
      },
      exportFullResCanvas: () => {
        const full = fullSourceRef.current;
        if (!full) return null;
        const off = document.createElement("canvas");
        let renderer: Renderer;
        try {
          renderer = new Renderer(off);
        } catch {
          // Kein WebGL2 (z.B. jsdom) -> Aufrufer faellt auf die Live-Canvas zurueck.
          return null;
        }
        renderer.loadImage(full.source, full.width, full.height);
        const s = useEditorStore.getState();
        // Export ist der finale Output: volles Crop angewendet (kein
        // cropMode-Vollbild), kein Bypass. Output-Format = Original × Crop.
        const crop = s.cropRect;
        renderer.render(
          s.adjustments,
          false,
          uvTransformMatrix(crop, s.straightenAngle),
          s.lensCorrection.distortion,
          s.lensCorrection.vignette,
          masksFromState(s),
          cropOutputSize(full.width, full.height, crop),
          s.lensCorrection.tcaR,
          s.lensCorrection.tcaB,
        );
        return { canvas: off, dispose: () => renderer.dispose() };
      },
    }),
    [onTick, cropMode],
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
