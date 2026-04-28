# Face-Detection (E4) · Design

**Datum:** 2026-04-28
**Vorgaenger:** Phase-E-Roadmap (Item E4)
**Aufwand:** ~1 Tag

## Motivation

Die Smart-Preset-Suggestion ist heute eine reine Heuristik aus EXIF-
Brennweite + Histogramm-Mittelwerten. Bei JPEGs ohne EXIF wird kein
Vorschlag generiert; bei Tele-Fotos schlaegt die Heuristik immer
Sport/Tiere vor, auch wenn ein Portrait drin ist. Face-Detection
liefert ein robustes „Mensch im Bild"-Signal, das die Heuristik
ueberschreibt.

## Stack

- `@tensorflow-models/face-detection@^1.0` (Mediapipe-Modell mit TF.js-
  Runtime)
- `@tensorflow/tfjs-core` + `@tensorflow/tfjs-converter` +
  `@tensorflow/tfjs-backend-webgl`
- Modell-Weights via tfhub-CDN (lazy, beim ersten Detektor-Aufruf)

Bundle (Lazy-Chunks):
- `face-detection.esm`: ~143 KB / 30 KB gzip
- `tfjs-converter`: ~254 KB / 78 KB gzip
- `tfjs-core` + `webgl-backend`: ~351 KB / 82 KB gzip
- **Gesamt lazy: ~750 KB / ~190 KB gzip**

Initial-Bundle der App bleibt unveraendert (436 KB / 132 KB gzip).
Modell-Weights kommen erst beim Image-Load — typisch ~3 MB von tfhub.

## Architektur

`frontend/src/editor/faceDetector.ts`:

```ts
export interface DetectedFace { box, score }
export interface FaceDetector {
  detect(canvas|image|bitmap): Promise<DetectedFace[]>;
  dispose(): void;
}

// Direktinjektion fuer Tests:
export function setFaceDetector(detector: FaceDetector | null): void;

// Lazy-loadender Singleton (TF.js erst beim ersten Call):
export async function getFaceDetector(): Promise<FaceDetector>;

// Best-Effort: Fehler werden geschluckt, leere Liste zurueck.
export async function detectFacesSafe(
  canvas: HTMLCanvasElement,
): Promise<DetectedFace[]>;
```

Lazy-Init via `await import("@tensorflow/tfjs-core")` etc. — Vite/
Rolldown erkennt das als async-chunk-boundary.

## Mediapipe-ESM-Workaround

`@mediapipe/face_detection` ist UMD-only und exportiert seine
`FaceDetection`-Klasse nicht als ESM-named-export. Rolldown (Vite 8)
schlaegt beim Bundling von `@tensorflow-models/face-detection` fehl,
auch wenn der Code-Pfad ueber runtime: "tfjs" laeuft.

Workaround in `vite.config.ts`:

```ts
resolve: {
  alias: {
    "@mediapipe/face_detection": fileURLToPath(
      new URL("./src/editor/__shims__/mediapipe-face-detection-shim.ts",
              import.meta.url),
    ),
  },
}
```

Der Shim exportiert eine `FaceDetection`-Klasse, die beim Konstruktor
sofort wirft. Der Mediapipe-Runtime-Pfad in `@tensorflow-models/face-
detection` wird unter `runtime: "tfjs"` nie aktiviert, das Symbol
genuegt also rein zur Build-Zeit-Auflösung.

## Integration

`Editor.tsx` ruft `runSuggestion(focal)` nach Image-Load (RAW + JPEG):

```ts
const faces = await detectFacesSafe(canvas);
const genre = suggestGenre({ ..., faceCount: faces.length });
```

`suggestPreset.ts` bekommt einen frueh greifenden Branch:
```
if (faceCount >= 1) return "Portrait";
```

Damit ueberschreibt Face-Erkennung jede Brennweiten-Heuristik —
insbesondere wichtig fuer Telefotos mit Personen (Konzert, Sport-
Portrait) und JPEGs ohne EXIF.

## Privacy

- Detection laeuft lokal im Browser. Keine Bildaten werden an Server
  geschickt.
- Modell-Weights werden vom oeffentlichen tfhub-CDN geladen. Die
  Browser-Anfrage ist nicht authentifiziert, enthaelt aber natuerlich
  IP + User-Agent (DSGVO-Lehrbuch-„Drittland"-Hinweis im Datenschutz).
- Bounding-Boxes werden nicht persistiert. Der einzige Effekt nach
  aussen ist „Portrait"-Suggestion-Banner.

`Datenschutz.tsx` bekommt einen Absatz zu den CDN-geladenen Modellen
(Backlog).

## Tests

`faceDetector.test.ts`:
- `setFaceDetector(stub)` injiziert Mock-Detector → `detectFacesSafe`
  liefert die gestubbte Liste.
- Wirft der Detector, kommt eine leere Liste zurueck.
- Ohne Stub failt das echte loading in jsdom (kein WebGL) → leere
  Liste.

`suggestPreset.test.ts`:
- `faceCount >= 1` ueberschreibt Tele-Heuristik → "Portrait".
- `faceCount = 0` bzw. fehlend → alte Heuristik unveraendert.
- `faceCount` ohne `focalLen` → "Portrait" (JPEG-Pfad).

## Akzeptanzkriterien

- [x] Backend unveraendert
- [x] Frontend Bundle initial unveraendert; lazy-chunks ~750 KB / 190 KB gzip
- [x] suggestGenre nimmt optional faceCount und behandelt es vorrangig
- [x] Editor verkabelt detectFacesSafe in beiden Pfaden (RAW + JPEG)
- [x] Tests fuer suggestPreset (3 neue Faelle) + faceDetector (3 Faelle) gruen
- [ ] Datenschutz-Update mit CDN-Hinweis (Backlog, nicht in diesem Commit)
- [ ] Echtes Browser-Smoke-Testing am laufenden Stack (Backlog)

## Out of Scope (E4)

- Stretch: Center-Mask fuer Auto-Vignette um Gesicht.
- Mehrere Gesichter mit Confidence-Filter (heute reicht „>= 1 Face").
- Lokales Bundling der Modell-Weights (heute via CDN). Bei Offline-
  Installation muesste das Modell ins Image gepackt werden.
