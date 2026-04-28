/**
 * Face-Detection (E4) — duenne Hülle um @tensorflow-models/face-detection.
 *
 * Lazy-Initialisierung: TF.js + Mediapipe-Runtime werden erst beim
 * ersten `getFaceDetector()`-Call geladen (dynamic import). Das hält
 * den Initial-Bundle klein; Modell-Weights kommen vom CDN beim
 * naechsten Aufruf.
 *
 * DSGVO: `detectFacesSafe` prueft den Consent-Toggle aus
 * `consent.ts` — ohne Einwilligung kein CDN-Fetch (Drittlandtransfer
 * an Google US) und keine Detection.
 *
 * Tests umgehen die Lazy-Loading-Maschinerie ueber `setFaceDetector`
 * — eine Stub-Implementation mit deterministischen Detection-Daten
 * laesst sich so direkt einspeisen.
 */
import { isFaceDetectionConsented } from "./consent";

export interface DetectedFace {
  /** Bounding-Box in Pixeln des untersuchten Bildes. */
  readonly box: { x: number; y: number; width: number; height: number };
  /** Detector-eigene Confidence (0..1) — Mediapipe gibt 0..1. */
  readonly score: number;
}

export interface FaceDetector {
  detect(input: HTMLCanvasElement | HTMLImageElement | ImageBitmap): Promise<DetectedFace[]>;
  dispose(): void;
}

let cached: FaceDetector | null = null;
let loading: Promise<FaceDetector> | null = null;
let stub: FaceDetector | null = null;

/** Direkt einen FaceDetector setzen (z.B. fuer Tests). null cleart. */
export function setFaceDetector(detector: FaceDetector | null): void {
  stub = detector;
}

export async function getFaceDetector(): Promise<FaceDetector> {
  if (stub) return stub;
  if (cached) return cached;
  if (loading) return loading;
  loading = (async () => {
    // Backend muss vor dem Modell registriert werden — sonst meckert TF
    // beim ersten estimateFaces.
    await import("@tensorflow/tfjs-backend-webgl");
    const tf = await import("@tensorflow/tfjs-core");
    await tf.setBackend("webgl");
    await tf.ready();
    const facedetect = await import("@tensorflow-models/face-detection");
    const SupportedModels = facedetect.SupportedModels;
    // TF.js-Runtime statt Mediapipe — Mediapipe-Package ist UMD-only und
    // bricht beim ESM-Bundling unter Rolldown/Vite. TF.js-Runtime laedt
    // die gleichen Modell-Weights via tfhub und braucht kein extra Import.
    const model = await facedetect.createDetector(
      SupportedModels.MediaPipeFaceDetector,
      {
        runtime: "tfjs",
        modelType: "short",
        maxFaces: 5,
      },
    );
    const detector: FaceDetector = {
      async detect(input) {
        const faces = await model.estimateFaces(input, { flipHorizontal: false });
        return faces.map((f) => {
          // Mediapipe-Runtime liefert 'score' optional — TF-Models-Type
          // deklariert das Feld nicht, daher Cast mit Default.
          const score = (f as unknown as { score?: number }).score;
          return {
            box: {
              x: f.box.xMin,
              y: f.box.yMin,
              width: f.box.width,
              height: f.box.height,
            },
            score: typeof score === "number" ? score : 1,
          };
        });
      },
      dispose() {
        model.dispose?.();
      },
    };
    cached = detector;
    return detector;
  })().catch((err) => {
    // Fehlschlag (kein WebGL? Netz weg?) macht Detection still — der
    // Smart-Preset-Fallback laeuft dann ohne Face-Hinweis weiter.
    loading = null;
    throw err;
  });
  return loading;
}

/** Best-Effort Detection: liefert leere Liste bei jedem Fehler.
 *  Beachtet den Consent-Toggle — ohne Einwilligung kein CDN-Fetch
 *  und keine Detection. */
export async function detectFacesSafe(
  canvas: HTMLCanvasElement,
): Promise<DetectedFace[]> {
  if (!isFaceDetectionConsented()) return [];
  try {
    const detector = await getFaceDetector();
    return await detector.detect(canvas);
  } catch {
    return [];
  }
}
