/**
 * ESM-Shim fuer @mediapipe/face_detection (E4).
 *
 * Das Mediapipe-Package ist UMD-only und exportiert seine `FaceDetection`-
 * Klasse nicht als ESM-named-export. Rolldown (Vite 8) bricht beim
 * statischen Bundling von @tensorflow-models/face-detection ab, weil
 * dort `import { FaceDetection } from "@mediapipe/face_detection"`
 * steht — auch wenn wir den runtime: "tfjs"-Pfad nutzen, der diese
 * Klasse nie referenziert.
 *
 * Dieses Shim liefert ein FaceDetection-Konstrukt, das beim Aufruf
 * sofort wirft. Wuerde der mediapipe-Runtime-Pfad jemals aktiviert,
 * faellt der Stack-Trace auf diesen Hinweis zurueck — sicher gegen
 * Silent-Failure, weil unser detectFacesSafe den Wurf abfaengt.
 */

export class FaceDetection {
  constructor() {
    throw new Error(
      "Mediapipe-Runtime nicht verfuegbar — bitte runtime: 'tfjs' verwenden.",
    );
  }
}

export default FaceDetection;
