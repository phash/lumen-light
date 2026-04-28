# Phase E · Tiefere Bearbeitung — Roadmap

**Datum:** 2026-04-28
**Vorgaenger:** Phase-5-Erweiterungs-Plan (Phasen A–D umgesetzt)

## Motivation

Phase E sammelt die „professionellen" Bearbeitungs-Features, die Lumen
zu einem ernsthaften Lightroom-Konkurrenten machen wuerden. Jedes Item
ist gross genug fuer eine eigene Spec + Iteration — diese Roadmap
priorisiert und beschreibt die Mindest-Anforderungen, damit die
Reihenfolge konsistent bleibt.

## Item E1: HSL-Farbmischer

**Wert:** Hauttoene anpassen, Himmel verstaerken, Gruen kuehlen — der
zentrale Color-Workflow in Lightroom.

**Scope:**
- 8 Farbtonbereiche: Rot, Orange, Gelb, Gruen, Aqua, Blau, Violett, Magenta
- 3 Achsen pro Farbe: Hue-Shift (-1..+1), Saturation (-1..+1), Luminance (-1..+1)
- UI: 3 Tabs (Hue / Sat / Lum) × 8 Farben oder 8 Subtabs × 3 Slider

**Datenmodell (Erweiterung):**
```ts
export type HslChannel = "red" | "orange" | "yellow" | "green" | "aqua" | "blue" | "violet" | "magenta";
export interface HslAdjustments {
  hue:        Record<HslChannel, number>;
  saturation: Record<HslChannel, number>;
  luminance:  Record<HslChannel, number>;
}
```

**Shader:** Per Pixel HSL berechnen, naechstes Farbband per Bell-Funktion
gewichten (Gauss um Hue-Center mit Halbwertsbreite ~30°), Hue/Sat/Lum-
Deltas anwenden. Pseudocode:
```glsl
vec3 hsl = rgbToHsl(c);
float w = 0.0;
float dHue = 0.0; float dSat = 0.0; float dLum = 0.0;
for (int i = 0; i < 8; i++) {
  float center = hueCenters[i]; // 0/0.083/0.166/...
  float dist = abs(hsl.x - center);
  dist = min(dist, 1.0 - dist); // wrap
  float weight = exp(-dist*dist / (0.05*0.05)); // Halbwertsbreite ~30°
  dHue += weight * u_hslHue[i];
  dSat += weight * u_hslSat[i];
  dLum += weight * u_hslLum[i];
  w += weight;
}
hsl.x = mod(hsl.x + dHue/w, 1.0);
hsl.y = clamp(hsl.y * (1.0 + dSat/w), 0.0, 1.0);
hsl.z = clamp(hsl.z + dLum/w * 0.3, 0.0, 1.0);
```

**Backend:** `backend/app/schemas.py` Adjustments wird um nested
`hsl: HslAdjustments | null = None` erweitert. JSON-Schema-Sync-Test
deckt die 24 neuen Felder. Migration 005: spaltenweise nicht noetig,
da hsl im JSONB von `presets.adjustments` lebt.

**Aufwand:** 1-2 Tage. Spec: `2026-04-XX-hsl-color-mixer-design.md`

## Item E2: Tonkurve (Spline)

**Wert:** Mid-Kontrast, Crushed-Black-Lifts, S-Curve — feine
Tonwertkontrolle jenseits der 4 Tonwertbereich-Slider.

**Scope:**
- Interaktiver Spline-Editor (Catmull-Rom oder Cubic Bezier)
- 2-8 Kontrollpunkte
- Per-Channel-Curves (RGB + Luminanz) als Stretch-Goal

**Datenmodell:**
```ts
export interface ToneCurvePoint {
  readonly x: number; // 0..1 input luminance
  readonly y: number; // 0..1 output luminance
}
export interface ToneCurve {
  readonly points: ReadonlyArray<ToneCurvePoint>; // sortiert nach x
}
```

**Shader:** Curve wird in eine 256-Eintraege-Lookup-Texture
(GL_LUMINANCE oder R8) verbacken; im Pixel-Shader:
```glsl
float lum = luminance(c);
float newLum = texture(u_tonecurve, vec2(lum, 0.5)).r;
c *= newLum / max(lum, 0.001);
```

**UI:** 200x200 px Canvas mit Drag-Punkten, Default Identity-Linie.
Keyboard-Shortcuts fuer Add/Remove/Reset.

**Aufwand:** 1-2 Tage. Spec: `2026-04-XX-tone-curve-design.md`

## Item E3: Sharpening + Noise-Reduction

**Wert:** RAW-Workflow-Standard. Aktuell hat die Pipeline keine
Detail-Stufe; Bilder wirken etwas weich.

**Scope (Sharpening):**
- 1 Slider „Schaerfen" 0..1
- Unsharp-Mask im Shader: 4-Nachbarn-Sample, Laplacian-Differenz, addiert
- Optional: Radius (1..3 Pixel) und Schwellenwert (Edge-Threshold)

**Scope (Noise-Reduction):**
- 1 Slider „Rauschen" 0..1
- Bilateral-Filter Light-Variante (3x3 Kernel, raumlich + tonal)
- Performance kritisch — 9 Sample-Reads pro Pixel

**Datenmodell-Erweiterung:**
```ts
sharpness: number;  // 0..1
noiseReduction: number; // 0..1
```

**Aufwand:** 0.5 + 1 Tag. Spec: `2026-04-XX-sharpness-noise-design.md`

## Item E4: Face-Detection fuer Smart-Preset

**Wert:** Treffsicheres Portrait-Erkennen unabhaengig von Brennweite —
heute heuristisch ueber EXIF + Hauttoene.

**Scope:**
- TensorFlow.js mediapipe-face-detector
- Beim Image-Load: faces detect → falls 1+ Faces → Smart-Preset
  „Portrait" empfehlen mit Confidence-Score
- Stretch: Center-Mask fuer Auto-Vignette um Gesicht

**Bundle-Impact:** TF.js + Modell-Weights ~5-10 MB. Lazy-loaded ueber
Code-Splitting; nur beim ersten Smart-Preset-Trigger geladen.

**Aufwand:** 1-2 Tage. Spec: `2026-04-XX-face-detection-design.md`

## Item E5: Auto-Straighten

**Vorhanden in Plan-D-Spec, hier nochmal:** Hough-Transform auf 256x256
Downsampled-Edges, dominanter Linienwinkel = Kippung. Kann selbst
geschrieben sein oder via opencv.js.

**Aufwand:** 1 Tag.

## Reihenfolge

1. **E1 HSL-Farbmischer** — hoechster sichtbarer Wert, Lightroom-Standard
2. **E3 Sharpening** — schliesst die RAW-Pipeline-Luecke
3. **E2 Tonkurve** — fortgeschrittenes Power-Tool
4. **E4 Face-Detection** — luxus, 5-10 MB Bundle-Cost
5. **E3 Noise-Reduction** — performance-kritisch, Stretch
6. **E5 Auto-Straighten** — niceties

## Was vorher abzuschliessen ist

- [ ] CI grun (eingerichtet, aber noch nicht gegen GitHub gelaufen)
- [ ] Editor-Refactor abschliessen: EditorViewport extrahieren
- [ ] Wireformat-Normalisierung (D4) — vor weiteren Schema-
      Erweiterungen sinnvoll
- [ ] User-Feedback aus laufender Selfhost-Instanz einsammeln, um die
      Reihenfolge zu validieren

## Aus Phase D noch offen

- D1 EditorViewport (Pan/Zoom/WB/Toolbar) als eigene Komponente
- D2 Linear/Radial-Renderer-Generic
- D4 Wireformat normalisieren (camelCase via Pydantic-Alias-Generator)
- D6 Editor-Komponenten-Tests (nach D1)

## Verfuegbar abgeschlossen aus Plan A-D

- A1-A7 vollstaendig
- B1-B9 vollstaendig
- C1+C2+C3+C4 vollstaendig (C5 Auto-Straighten = Item E5 hier)
- D1 partiell (LocalMaskPanel, ExportDialog, EditorSidebar extrahiert;
  EditorViewport ausstehend), D3, D5 vollstaendig, D2/D4/D6 offen
- Phase E: E.1 EXIF-Strip + E.2 Datenschutz/Impressum erledigt; E1-E5 wie oben

## Akzeptanzkriterien Phase E

- HSL aktiv → Hauttoene koennen unabhaengig von der globalen
  Saettigung waermer/kuehler werden
- Tonkurve aktiv → S-Curve mit 5 Punkten erzeugt sichtbar mehr
  Mid-Kontrast ohne globalen Kontrast-Slider zu bemuehen
- Sharpening aktiv → Detailgrad sichtbar steigt, ohne Halo-Artefakte
- Face-Detection → 90 % Hit-Rate auf Portrait-Korpus aus
  tests-fixtures, Confidence > 0.8
- Bundle-Size mit TF.js < 10 MB gz
