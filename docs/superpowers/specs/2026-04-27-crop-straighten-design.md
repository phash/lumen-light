# Spec · Crop + Straighten via UV-Transform

**Datum:** 2026-04-27
**Iteration:** 13
**Vorgänger:** Iteration 12 (Test-Korpus)

## Motivation

Phase 4 der Roadmap: Beschnitt und Begradigen. Die Spec aus dem Konzept-Doc (`docs/05-frontend-konzept.md` §"Pipeline-Erweiterung später"):
> Crop wird im Vertex-Shader via UV-Transformation umgesetzt — keine Re-Texture nötig.

Selbe Texture, andere UV-Koordinaten. Beschneiden und Drehen sind beides affine Transformationen im UV-Space — sie kommen mathematisch in einer 3×3-Matrix zusammen.

## Ziel

- Zustand: `cropRect` (x0, y0, x1, y1, normalisiert 0..1) und `straightenAngle` (Radians, Default 0).
- Vertex-Shader bekommt eine `mat3 u_uvTransform` und mappt jede UV-Koordinate vor dem Texture-Fetch.
- Renderer berechnet die Matrix aus `(cropRect, angle)` und setzt sie pro Frame.
- Canvas-Output-Aspect-Ratio passt sich an Crop-Width/Height an, damit nicht verzerrt wird.
- `CropOverlay`-Component zeigt den selektierten Rect über dem Canvas, mit:
  - 8 Drag-Handles (4 Ecken + 4 Edges)
  - Drittel-Raster
  - Aspect-Ratio-Snapping: frei, 1:1, 3:2, 4:3, 16:9
- Begradigen-Slider in der Sidebar (außerhalb der Adjustments-Liste, eigene Sektion „Geometrie").

## Nicht-Ziel

- Lensfun-Distortion + Vignette = Iteration 14
- Crop-Toolbar mit Tooltips/Animationen (Polish)
- Drag aus dem Bild heraus — Crop bleibt im 0..1-Range
- Rotation um beliebige Achse — nur "Begradigen" (Yaw um Bild-Mittelpunkt)

## Datenmodell-Erweiterung

```ts
// store.ts — bisheriger State + Geometry-Slot
export interface CropRect {
  readonly x0: number; // 0..1
  readonly y0: number; // 0..1
  readonly x1: number; // 0..1, > x0
  readonly y1: number; // 0..1, > y0
}

export interface EditorState {
  // ... bestehend
  cropRect: CropRect;
  straightenAngle: number; // radians, default 0
  setCropRect: (rect: CropRect) => void;
  setStraightenAngle: (angle: number) => void;
  resetGeometry: () => void;
}

export const defaultCropRect = (): CropRect => ({ x0: 0, y0: 0, x1: 1, y1: 1 });
```

Persistierung im Preset (Backend) ist *nicht* Teil dieser Iteration — Cropping ist bildspezifisch, gehört nicht in einen wiederverwendbaren Adjustment-Preset. Spätere Iteration kann ein eigenes „Edit"-Konzept mit per-Bild-Edits hinzufügen.

## UV-Transform-Mathematik

**Ziel:** für jeden Pixel (UV in 0..1 des **Output**-Bildes) die UV des **Source**-Bildes berechnen.

Reihenfolge:
1. Output-UV → Output-Center (uv − 0.5)
2. Rotation um Output-Center: R(−angle) (Bild rotiert um +angle = UV rotiert um −angle)
3. Skalierung auf Crop-Size (uv * (x1−x0, y1−y0))
4. Translation zum Crop-Center (uv + ((x0+x1)/2, (y0+y1)/2))

In Matrix-Form (3×3, Spalten-major für GLSL):

```
T = T_cropCenter · S_cropSize · R(-angle) · T_-0.5
```

`src/editor/transform.ts`:

```ts
export function uvTransformMatrix(crop: CropRect, angle: number): Float32Array {
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;
  const cx = (crop.x0 + crop.x1) / 2;
  const cy = (crop.y0 + crop.y1) / 2;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  // Equivalent zu:
  //   uv' = R * (uv - 0.5) * (cw, ch) + (cx, cy)
  // Aufgeloest in mat3-Form (Spalten-major):
  return new Float32Array([
    c * cw,        s * cw,        0,
    -s * ch,       c * ch,        0,
    cx - 0.5 * (c * cw - s * ch),
    cy - 0.5 * (s * cw + c * ch),
    1,
  ]);
}
```

Identität (kein Crop, kein Rotate) liefert `mat3` mit `(1,0,0, 0,1,0, 0,0,1)` — das wird im Test verifiziert.

## Shader-Anpassung

`shaders.ts`:

```glsl
// VERT_SRC
in vec2 a_pos;
in vec2 a_uv;
uniform mat3 u_uvTransform;
out vec2 v_uv;
void main() {
  vec3 transformed = u_uvTransform * vec3(a_uv, 1.0);
  v_uv = transformed.xy;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
```

Fragment-Shader unverändert — er sieht bereits die transformierten UVs.

## Renderer-Anpassung

`webgl.ts:Renderer`:
- Neuer Uniform-Lookup für `u_uvTransform`
- `render(adj, bypass, transform)` nimmt eine optionale `Float32Array(9)` und setzt sie via `uniformMatrix3fv`
- Default-Identität wenn nicht übergeben
- Canvas-Output-Aspect-Ratio passt sich dynamisch an Crop:
  - Wenn `cropRect = (0,0,1,1)`: Canvas wie Source-Image
  - Sonst: Canvas-Width = source-Width, Canvas-Height = source-Width × (cropHeight/cropWidth) × (sourceHeight/sourceWidth)

## CropOverlay-Component

`src/editor/CropOverlay.tsx`:
- absolute-positioned Overlay über dem Canvas
- 4 Edges + 4 Corners als Drag-Handles
- Drag updatet `cropRect` im Store
- Drittel-Raster als 9-Box-Grid mit subtle lines
- Aspect-Ratio-Snap-Helper: bei festem Ratio werden gegenüberliegende Edges proportional mitgezogen
- `data-testid="crop-overlay"` + `crop-handle-{nw,n,ne,e,se,s,sw,w}`

## Editor-Page

- Header bekommt einen Toggle „Beschneiden" — wenn aktiv, wird das Overlay sichtbar und Mouse-Events gehen ans Overlay statt ans Canvas-Drop
- Sidebar bekommt eine Sektion „Geometrie":
  - Aspect-Ratio-Dropdown (frei | 1:1 | 3:2 | 4:3 | 16:9)
  - Begradigen-Slider (−10°…+10° als Standard, später ggf. mehr)
  - Reset-Geometry-Button
- `Cmd+R` als Tastenkürzel für Crop-Toggle (über `useKeyboardShortcuts` ergänzen)

## Tests

`tests/transform.test.ts` (neu, ~6 Tests):
- `uvTransformMatrix` mit (kein Crop, 0°) → Identitäts-Matrix
- mit (cropRect 0.25..0.75 in beide Achsen, 0°) → mappt UV (0.5, 0.5) auf (0.5, 0.5)
- mit (kein Crop, 90°) → mappt UV (1, 0.5) auf (0.5, 0)
- mit (kein Crop, π/4) → spezifische Werte gegen Referenz

`tests/store.test.ts` (erweitern):
- `setCropRect` + Default
- `setStraightenAngle` + Clamp auf sinnvollen Bereich (z. B. ±π/4)
- `resetGeometry` setzt beides zurück

`tests/CropOverlay.test.tsx` (neu, ~4 Tests):
- Rendert 8 Handles mit `data-testid="crop-handle-..."`
- Drag-Handle aktualisiert via Callback
- Aspect-Ratio-Snap: bei `1:1` wird beim Korner-Drag das Square erhalten

## Akzeptanzkriterien

1. `uvTransformMatrix(default, 0)` = Identität (test).
2. Renderer akzeptiert die Matrix als Uniform; Render bricht nicht.
3. Editor mit Crop-Toggle aktiv zeigt Overlay; Drag verändert Store-State.
4. Aspect-Ratio-Snap funktioniert für 1:1, 3:2, 4:3, 16:9.
5. Begradigen-Slider sendet `straightenAngle` an den Store.
6. Build & Tests grün — bisherige 87 + ~10 neue.
7. Browser-Smoke (Iteration 13.x): Bild laden → croppen → exportieren → exportierte Datei zeigt nur den Crop.

## Risiken

- **Canvas-Aspect-Ratio bei dynamischer Crop-Width**: WebGL-Viewport muss bei Crop-Resize aktualisiert werden. Renderer muss `gl.canvas.width/height` neu setzen und `gl.viewport(...)` aufrufen.
- **Drag-UI-Komplexität**: 8 Handles + Aspect-Ratio-Snap + Bounds-Clamping ist eine Menge Logik. Pure-Function-Helper für die Drag-Updates (`updateCropOnDrag(rect, handle, delta, ratio)`) lassen sich gut testen.
- **Tastenkürzel-Konflikt**: `Cmd+R` ist im Browser „Reload". Alternative: nur `R` (ohne Modifier). Ich nehme `R` als Toggle.
