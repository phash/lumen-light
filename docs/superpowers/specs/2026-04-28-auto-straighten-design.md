# Auto-Straighten (E5) · Design

**Datum:** 2026-04-28
**Vorgaenger:** Phase-E-Roadmap (Item E5)
**Aufwand:** 1 Tag

## Motivation

Schiefer Horizont in Landschafts- und Strassenfotos manuell gerade zu
ziehen ist nervig. Phase E5 schlaegt einen Korrektur-Winkel vor,
sobald der User „Auto" in der Geometrie-Sektion klickt. Funktioniert
bei Bildern mit klarer dominanter Horizontale oder Vertikale (Horizont,
Hauswand, Tisch). Bei abstrakten Motiven schweigt der Algorithmus
lieber.

## Algorithmus

1. Bild vom Canvas auf 256x256 herunterzeichnen (`drawImage` auf
   `OffscreenCanvas`).
2. RGBA → Luminanz-Buffer (Float32, BT.709).
3. Sobel-Gradient pro Pixel: `gx`, `gy`, `mag = sqrt(gx² + gy²)`.
4. Pixel mit `mag < 0.04` ueberspringen (Rauschschwelle).
5. Linien-Richtung = Gradient-Richtung + 90°, modulo 180° auf [-90°,
   +90°] normieren.
6. Tilt zur naechsten Achse: 0° = horizontal, ±90° = vertikal. Wenn
   `aDeg > 45°`: tilt = aDeg - 90, wenn `aDeg < -45°`: tilt = aDeg + 90,
   sonst tilt = aDeg. Ergebnis liegt in [-45°, +45°].
7. Nur Tilt im Bereich [-10°, +10°] (Slider-Limit) zaehlen, mit
   Magnitude gewichtet in 0.5°-Bins eintragen → 40 Bins.
8. Peak-Bin mit Glaettung [0.5, 1.0, 0.5] finden.
9. Korrektur-Winkel = -peakTiltDeg × π/180.

Confidence:
```
peakNeighbor = bins[peak] + bins[peak±1]
confidence = min(1, peakNeighbor / total * binCount/6)
```

Schwellen:
- `edgePixels < 200` ⇒ kein Result (zu wenige Kanten)
- `confidence < 0.15` im Editor ⇒ Slider wird NICHT angefasst
  (Anti-Snap auf Rauschen)

## Datenmodell

Keine Aenderung am Backend-Schema — nur ein neuer JS-Pfad. Der
existierende `straightenAngle` (Float, ±10°) wird weiterhin via
`setStraightenAngle` gesetzt.

## API (Frontend-intern)

```ts
// frontend/src/editor/autoStraighten.ts
export const ANALYSIS_SIZE = 256;
export const MAX_TILT_DEG = 10;

export interface StraightenResult {
  readonly angleRad: number;
  readonly confidence: number;
  readonly edgePixels: number;
}

// Pure: arbeitet auf einem RGBA-Buffer (256×256).
export function analyzeStraightenAngle(
  rgba: Uint8ClampedArray | Uint8Array,
): StraightenResult | null;

// Convenience: liest vom Canvas, wenn OffscreenCanvas verfuegbar.
export function analyzeCanvasStraightenAngle(
  canvas: HTMLCanvasElement,
): StraightenResult | null;
```

Pure-Variante → testbar in jsdom ohne OffscreenCanvas.

## UI

In der Sidebar-Sektion „Geometrie" rechts neben dem Begradigen-Label
ein „Auto"-Button (`data-testid="auto-straighten"`). Klick ruft
`onAutoStraighten` (Editor-Callback) auf. Bei Confidence < 0.15
passiert visuell nichts — der Slider bleibt, wo er ist.

## Tests

`autoStraighten.test.ts`:
- Uniformes Grau ⇒ null
- 0°-Edge ⇒ Korrektur-Winkel ≈ 0
- +3°-Edge ⇒ Korrektur ≈ -3°
- -5°-Edge ⇒ Korrektur ≈ +5°
- 30°-Edge ⇒ entweder null oder Confidence < 0.3 (außerhalb Slider-
  Bereich, Linie wird ignoriert)

Test-Fixture: anti-aliased Edge (helle obere Haelfte, dunkle untere)
mit per-pixel-Tilt — keine 1-px-Linie, weil deren Aliasing-Stufen den
Sobel falsch anregen.

## Akzeptanzkriterien

- [ ] Auto-Button in Geometrie-Sidebar sichtbar
- [ ] Klick auf abstraktes Bild macht nichts (Confidence-Schwelle)
- [ ] Klick auf gekipptes Foto setzt Slider auf negierten Tilt-Wert
- [ ] Pure Analyse-Funktion testbar in jsdom
- [ ] CI gruen (Vitest + Lint + Build + tsc)

## Out of Scope

- Per-Linien Hough (mit rho-Achse) — wir voten nur ueber den Winkel.
- Ueber den Slider-Bereich hinausgehende Korrekturen (>10°). Wer mehr
  braucht, dreht das Bild manuell vorher.
- Confidence-Indikator im UI (Warnung „kein Horizont gefunden") — der
  „Auto"-Button macht stillschweigend nichts. Spaeter ggf. Tooltip.
