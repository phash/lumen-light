import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";


import type { MaskInstance } from "./mask";
import { useEditorStore, type EditorState } from "./store";
import { fitLongEdge } from "./thumbnail";
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
  fitWithin,
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

/** Seitenverhaeltnis der geladenen Quelle — fuer die Rotation im Pixelraum. */
function aspectOf(r: Renderer): number {
  return r.imageHeight > 0 ? r.imageWidth / r.imageHeight : 1;
}

/** Ein Render-Pass mit dem aktuellen Store-Stand. */
function renderState(
  r: Renderer,
  s: EditorState,
  crop: CropRect,
  bypass: boolean = s.bypass,
  outputSize: { width: number; height: number } = outputSizeFor(r, crop),
): void {
  r.render(
    s.adjustments,
    bypass,
    uvTransformMatrix(crop, s.straightenAngle, aspectOf(r)),
    s.lensCorrection.distortion,
    s.lensCorrection.vignette,
    masksFromState(s),
    outputSize,
    s.lensCorrection.tcaR,
    s.lensCorrection.tcaB,
  );
}

function closeIfBitmap(source: TexImageSource | undefined): void {
  if (typeof ImageBitmap !== "undefined" && source instanceof ImageBitmap) {
    source.close();
  }
}

/** Ergebnis des Full-Res-Exports. `downscaledFrom` ist gesetzt, wenn die
 *  Quelle die GPU-Grenzen ueberschreitet und verkleinert werden musste. */
export interface FullResExport {
  readonly canvas: HTMLCanvasElement;
  readonly dispose: () => void;
  readonly downscaledFrom: { width: number; height: number } | null;
}

export interface CanvasHandle {
  /** Laedt JPEG/PNG via Browser-Decoder. Liefert die Natural-Dimensionen —
   *  Aufrufer muss nicht mehr das Canvas-Element auslesen. `isCurrent` wird
   *  nach dem (async) Decode gefragt: false -> nichts hochladen, null zurueck
   *  (ein neuerer Ladevorgang hat uebernommen). */
  loadFile(
    file: File,
    isCurrent?: () => boolean,
  ): Promise<{ width: number; height: number } | null>;
  /** Laedt ein bereits dekodiertes Bild (z.B. aus RAW). Das Canvas
   *  uebernimmt die Bitmap (close() beim naechsten Bild bzw. Unmount). */
  loadBitmap(bitmap: ImageBitmap, width: number, height: number): void;
  /** Erzwingt einen Re-Render mit aktuellem Store-State. */
  render(): void;
  /** Rendert das Bild kurz mit bypass=true, liefert es als DataURL,
   *  rendert direkt wieder normal. Fuer Vorher/Nachher-Snapshots. */
  takeBypassSnapshot(): string | null;
  /** Rendert das Bild in voller Original-Aufloesung offscreen durch dieselbe
   *  Pipeline (die Live-Vorschau bleibt aus Performance-Gruenden gedeckelt).
   *  Liefert das Canvas + eine dispose()-Funktion (WebGL-Context freigeben).
   *  null, wenn kein Bild geladen ist oder kein WebGL-Context verfuegbar.
   *  Wirft, wenn der Render selbst scheitert (Renderer ist dann bereits
   *  freigegeben). */
  exportFullResCanvas(): FullResExport | null;
  /** H2a: rendert das Bild MIT Bearbeitung (Crop angewendet, kein Bypass)
   *  synchron in ein 2D-Canvas mit hoechstens maxEdge langer Kante und
   *  stellt die Live-Ansicht sofort wieder her. Nutzt die Live-Textur
   *  (max. 1600 px breit) — kein zweiter WebGL-Context. null ohne Bild. */
  renderThumbnail(maxEdge: number): HTMLCanvasElement | null;
}

/** Meldung bei webglcontextlost — exportiert, damit der Editor genau diese
 *  Meldung nach erfolgreicher Wiederherstellung wieder entfernen kann. */
export const CONTEXT_LOST_MESSAGE =
  "Grafikkontext verloren — die Vorschau wird wiederhergestellt, sobald der Browser es erlaubt. Falls nicht, Bild erneut öffnen.";

interface Props {
  readonly onTick: () => void;
  readonly onError: (message: string) => void;
  /** Grafikkontext nach Verlust erfolgreich wiederhergestellt — Aufrufer
   *  entfernt den Kontextverlust-Hinweis. */
  readonly onRecovered?: () => void;
  /** Wird beim Mount mit dem Canvas-Element aufgerufen. */
  readonly onCanvasMount?: (canvas: HTMLCanvasElement) => void;
  /** Wenn aktiv, wird das volle Bild angezeigt — der Crop-Overlay
   *  visualisiert das Rechteck nur, das eigentliche Beschneiden findet
   *  erst nach Verlassen des Crop-Modus statt. */
  readonly cropMode: boolean;
}

const PREVIEW_MAX_WIDTH = 1600;

const Canvas = forwardRef<CanvasHandle, Props>(function Canvas(
  { onTick, onError, onRecovered, onCanvasMount, cropMode },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // Original-Vollaufloesungs-Quelle fuer den Full-Res-Export; die
  // Live-Textur ist auf PREVIEW_MAX_WIDTH heruntergerechnet.
  const fullSourceRef = useRef<{
    source: TexImageSource;
    width: number;
    height: number;
  } | null>(null);
  // Zuletzt geladene Vorschau-Groesse — zum Wiederherstellen nach
  // webglcontextrestored.
  const previewSizeRef = useRef<{ width: number; height: number } | null>(null);

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
  const cropModeRef = useRef(cropMode);
  useEffect(() => {
    cropModeRef.current = cropMode;
  }, [cropMode]);

  // Ref statt Effect-Dependency: ein neuer Callback soll den Renderer
  // nicht neu aufbauen.
  const onRecoveredRef = useRef(onRecovered);
  useEffect(() => {
    onRecoveredRef.current = onRecovered;
  }, [onRecovered]);

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

    const onLost = (e: Event) => {
      // preventDefault signalisiert, dass wir eine Wiederherstellung wollen.
      e.preventDefault();
      rendererRef.current = null;
      onError(CONTEXT_LOST_MESSAGE);
    };
    const onRestored = () => {
      try {
        const r = new Renderer(canvas);
        rendererRef.current = r;
        const full = fullSourceRef.current;
        const preview = previewSizeRef.current;
        if (full && preview) {
          r.loadImage(full.source, preview.width, preview.height);
          const st = useEditorStore.getState();
          renderState(r, st, cropModeRef.current ? IDENTITY_CROP : st.cropRect);
          onTick();
        }
        onRecoveredRef.current?.();
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err));
      }
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      rendererRef.current?.release();
      rendererRef.current = null;
    };
  }, [onError, onCanvasMount, onTick]);

  // Beim echten Unmount die gehaltene Bitmap freigeben.
  useEffect(
    () => () => {
      closeIfBitmap(fullSourceRef.current?.source);
      fullSourceRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !r.hasImage()) return;
    r.render(
      adjustments,
      bypass,
      uvTransformMatrix(cropRect, straightenAngle, aspectOf(r)),
      lensCorrection.distortion,
      lensCorrection.vignette,
      masksUniforms,
      outputSizeFor(r, cropRect),
      lensCorrection.tcaR,
      lensCorrection.tcaB,
    );
    onTick();
  }, [adjustments, bypass, straightenAngle, lensCorrection, masksUniforms, cropRect, onTick]);

  useImperativeHandle(
    ref,
    (): CanvasHandle => {
      const setSource = (source: TexImageSource, width: number, height: number) => {
        const prev = fullSourceRef.current?.source;
        if (prev !== source) closeIfBitmap(prev);
        fullSourceRef.current = { source, width, height };
      };
      return {
        async loadFile(file: File, isCurrent?: () => boolean) {
          if (!rendererRef.current) throw new Error("Renderer nicht initialisiert");
          const { image, width, height } = await loadImageFromFile(file, PREVIEW_MAX_WIDTH);
          if (isCurrent && !isCurrent()) return null;
          // Renderer kann waehrend des Decodes ersetzt worden sein (Context-Restore).
          const r = rendererRef.current;
          if (!r) throw new Error("Renderer nicht initialisiert");
          r.loadImage(image, width, height);
          previewSizeRef.current = { width, height };
          // Original-Aufloesung fuer den Export merken (image ist die volle
          // Datei; width/height sind die Preview-Skalierung).
          setSource(image, image.naturalWidth, image.naturalHeight);
          const effCrop = cropMode ? IDENTITY_CROP : useEditorStore.getState().cropRect;
          renderState(r, useEditorStore.getState(), effCrop);
          onTick();
          // Volle Natural-Dimensionen zurueck — der Aufrufer nutzt sie fuer
          // Aspect + Export-Dialog (nicht den heruntergerechneten Preview-Wert).
          return { width: image.naturalWidth, height: image.naturalHeight };
        },
        loadBitmap(bitmap, width, height) {
          const r = rendererRef.current;
          if (!r) {
            bitmap.close();
            throw new Error("Renderer nicht initialisiert");
          }
          const scale = Math.min(1, PREVIEW_MAX_WIDTH / width);
          const w = Math.round(width * scale);
          const h = Math.round(height * scale);
          r.loadImage(bitmap, w, h);
          previewSizeRef.current = { width: w, height: h };
          // bitmap ist die volle RAW-Aufloesung; width/height sind die echten
          // Decoder-Dimensionen -> fuer den Export merken.
          setSource(bitmap, width, height);
          const effCrop = cropMode ? IDENTITY_CROP : useEditorStore.getState().cropRect;
          renderState(r, useEditorStore.getState(), effCrop);
          onTick();
        },
        render: () => {
          const r = rendererRef.current;
          if (!r || !r.hasImage()) return;
          const s = useEditorStore.getState();
          renderState(r, s, cropMode ? IDENTITY_CROP : s.cropRect);
          onTick();
        },
        takeBypassSnapshot: () => {
          const r = rendererRef.current;
          const c = canvasRef.current;
          if (!r || !c || !r.hasImage()) return null;
          const s = useEditorStore.getState();
          const effCrop = cropMode ? IDENTITY_CROP : s.cropRect;
          // 1. Render Pass mit bypass=true -> die Canvas zeigt das Original.
          renderState(r, s, effCrop, true);
          const url = c.toDataURL("image/png");
          // 2. Sofort wieder mit aktuellen bypass-Wert rendern, damit der
          //    User keinen Flash sieht.
          renderState(r, s, effCrop);
          return url;
        },
        renderThumbnail: (maxEdge: number) => {
          const r = rendererRef.current;
          const c = canvasRef.current;
          if (!r || !c || !r.hasImage()) return null;
          const s = useEditorStore.getState();
          const full = cropOutputSize(r.imageWidth, r.imageHeight, s.cropRect);
          const size = fitLongEdge(full.width, full.height, maxEdge);
          // Wie takeBypassSnapshot: Render + Auslesen + Wiederherstellen im
          // selben Task -> der User sieht keinen Zwischenstand.
          renderState(r, s, s.cropRect, false, size);
          const out = document.createElement("canvas");
          out.width = c.width;
          out.height = c.height;
          const ctx = out.getContext("2d");
          ctx?.drawImage(c, 0, 0);
          renderState(r, s, cropMode ? IDENTITY_CROP : s.cropRect);
          return ctx ? out : null;
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
          try {
            // GPU-Grenzen (Textur/Renderbuffer/Viewport): groessere Quellen
            // werden proportional verkleinert, der Aufrufer zeigt einen Hinweis.
            const fit = fitWithin(full.width, full.height, renderer.maxDimension);
            renderer.loadImage(full.source, fit.width, fit.height);
            const s = useEditorStore.getState();
            // Export ist der finale Output: volles Crop angewendet (kein
            // cropMode-Vollbild), kein Bypass. Output-Format = Quelle × Crop.
            const crop = s.cropRect;
            renderState(
              renderer,
              s,
              crop,
              false,
              cropOutputSize(renderer.imageWidth, renderer.imageHeight, crop),
            );
            return {
              canvas: off,
              dispose: () => renderer.dispose(),
              downscaledFrom: fit.scaled ? { width: full.width, height: full.height } : null,
            };
          } catch (err) {
            renderer.dispose();
            throw err;
          }
        },
      };
    },
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
