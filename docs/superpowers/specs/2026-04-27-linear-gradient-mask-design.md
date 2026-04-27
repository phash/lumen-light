# Spec · Linearer Verlaufsfilter

**Datum:** 2026-04-27
**Iteration:** 17
**Vorgänger:** Iteration 16 (Lensfun)

## Motivation

Phase 5 der Roadmap. Linearer Verlaufsfilter ist die simplste Form lokaler
Anpassungen — eine Linie definiert die Grenze, mit Feather geht es weich
über. Im Bereich „aktiv" werden lokale Adjustments oben auf die globalen
gelegt.

Konzept-Doc empfiehlt **Multi-Pass-FBO-Pipeline**. Pragmatisch lasse ich
das weg und integriere die Maske direkt in den bestehenden FRAG_SRC. Limit:
nicht beliebig viele Masken (Anzahl Uniforms wird groß). Für 1–3 Masken
funktioniert es problemlos. Multi-Mask-Support kommt mit eigener Iteration,
falls nötig durch FBO-Pass-Refactor.

## Ziel

- **Eine** lineare Maske pro Bild, ein/aus-schaltbar.
- 2 Drag-Punkte auf dem Canvas (Linienendpunkte) + Feather-Slider.
- 4 lokale Adjustments: `exposure`, `contrast`, `saturation`, `temperature`.
- Maskenberechnung im FRAG_SRC: smoothstep zwischen den Linien-Endpunkten.
- UI: Mask-Toggle-Button, Drag-Overlay-Component analog `CropOverlay`,
  Sektion „Lokale Anpassung" mit lokalen Slidern.

## Nicht-Ziel

- Mehrere Masken (Iteration 19).
- Radialfilter (Iteration 18).
- Persistenz im Preset (Iteration 19).
- Pinsel/Lasso/KI-Masken — Backlog.

## Datenmodell

`src/editor/mask.ts`:

```ts
export interface PointUv { readonly u: number; readonly v: number; }

export interface LinearMask {
  readonly type: "linear";
  readonly p1: PointUv;        // 0..1, links/oben
  readonly p2: PointUv;        // 0..1, rechts/unten
  readonly feather: number;    // 0..1, Anteil der Linien-Strecke
}

export interface LocalAdjustments {
  readonly exposure: number;     // -3..+3
  readonly contrast: number;     // -1..+1
  readonly saturation: number;   // -1..+1
  readonly temperature: number;  // -1..+1
}

export const defaultLocalAdjustments = (): LocalAdjustments => ({
  exposure: 0, contrast: 0, saturation: 0, temperature: 0,
});

export const defaultLinearMask = (): LinearMask => ({
  type: "linear",
  p1: { u: 0.5, v: 0.0 },   // oben Mitte
  p2: { u: 0.5, v: 1.0 },   // unten Mitte → vertikaler Verlauf
  feather: 0.4,
});
```

Mask-Slot im Store (Erweiterung):

```ts
interface EditorState {
  // ... bestehend
  linearMaskEnabled: boolean;
  linearMask: LinearMask;
  linearLocalAdj: LocalAdjustments;
  setLinearMaskEnabled: (b: boolean) => void;
  setLinearMaskPoint: (which: "p1" | "p2", uv: PointUv) => void;
  setLinearMaskFeather: (f: number) => void;
  setLinearLocalAdjustment: (key: keyof LocalAdjustments, v: number) => void;
}
```

## Maskenberechnung (Mathematik)

Gegeben Punkt UV, p1, p2, feather:

1. Direction-Vektor: `d = p2 - p1`. Normalisiert: `dn = d / |d|`.
2. Projektion von `(uv - p1)` auf `dn`: `t = dot(uv - p1, dn) / |d|`. `t` ∈ ℝ, in [0,1] zwischen den Punkten.
3. Maskenfaktor: `m = smoothstep(0.5 - feather*0.5, 0.5 + feather*0.5, t)`.

`m=0`: außerhalb (vor p1) — keine lokale Anpassung.
`m=1`: innerhalb (nach p2) — volle lokale Anpassung.
Dazwischen: weicher Übergang.

Im Shader:

```glsl
uniform vec2 u_maskP1;
uniform vec2 u_maskP2;
uniform float u_maskFeather;
uniform float u_maskEnabled;
uniform float u_localExposure;
uniform float u_localContrast;
uniform float u_localSaturation;
uniform float u_localTemperature;

float computeLinearMask(vec2 uv) {
  vec2 d = u_maskP2 - u_maskP1;
  float len2 = dot(d, d);
  if (len2 < 1e-8) return 0.0;
  float t = dot(uv - u_maskP1, d) / len2;
  float halfFeather = max(0.001, u_maskFeather * 0.5);
  return smoothstep(0.5 - halfFeather, 0.5 + halfFeather, t);
}
```

Anwendung der lokalen Adjustments: addiert auf die globalen, multipliziert mit `m`. Die Pipeline-Reihenfolge bleibt identisch zum bestehenden Code, nur die Werte werden:

```glsl
float m = u_maskEnabled > 0.5 ? computeLinearMask(v_uv) : 0.0;
float effExposure    = u_exposure    + m * u_localExposure;
float effContrast    = u_contrast    + m * u_localContrast;
float effSaturation  = u_saturation  + m * u_localSaturation;
float effTemperature = u_temperature + m * u_localTemperature;
```

Diese vier `eff*`-Werte ersetzen die `u_*`-Werte in der Pipeline. Cap-Clamping bleibt wie gehabt.

## UI

**Toolbar-Button** neben „Beschneiden": „Verlauf" (Toggle, gleichartig).
Wenn aktiv, wird `<LinearMaskOverlay>` über dem Canvas angezeigt — zwei
große Drag-Punkte, eine Linie dazwischen, schraffierte Hilfslinien für
Feather-Range.

**Sidebar-Sektion** „Lokale Anpassung (Verlauf)" — nur sichtbar, wenn
`linearMaskEnabled`:
- 4 Slider (exposure, contrast, saturation, temperature) für lokale Werte
- Feather-Slider 0..1
- Reset-Button

## Tests

`tests/mask.test.ts` (~6 Tests):
- `computeLinearMaskFactor`-Helfer (Pure JS, identisch zum Shader-Code):
  - Punkt vor p1: 0
  - Punkt nach p2: 1
  - Punkt auf Mittellinie: 0.5
  - p1==p2 (degeneriert): 0
  - feather=0 ergibt sharp-step

`tests/store.test.ts` (erweitern):
- `setLinearMaskEnabled` / Default
- `setLinearMaskPoint` mit p1/p2
- `setLinearLocalAdjustment` setzt einen Wert
- `resetGeometry` setzt Mask zurück (oder nicht? — Mask gehört NICHT zur Geometrie. Eigener resetMasks-Helfer)

`e2e/editor.spec.ts` (1 neu): Mask-Toggle, Drag-Punkt sichtbar, lokale Slider erscheinen.

## Akzeptanzkriterien

1. Vitest 130+ → 140+ grün.
2. Playwright 15+ → 16+ grün.
3. ESLint 0, TypeScript 0.
4. Browser-Smoke: Mask aktiv, lokale Belichtung +1 → eine Hälfte des Bildes wird heller, andere unverändert; Drag der Linie verschiebt die Trennlinie.

## Risiken

- **Uniform-Limit:** WebGL2 garantiert mind. 256 Vertex-Uniform-Components, deutlich mehr Fragment. 8 zusätzliche `uniform float` + 2 `vec2` ist trivial.
- **Performance:** smoothstep + dot ist eine Handvoll Cycles pro Pixel — vernachlässigbar.
- **Pipeline-Komplexität:** Diese Iteration trägt einen Mask-Mechanismus, der für Iteration 18 (Radial) wiederverwendet wird. Die Effective-Adjustments-Stelle muss erweiterbar bleiben.
