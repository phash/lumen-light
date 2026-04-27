# Spec · Manuelle Distortion + Vignette

**Datum:** 2026-04-27
**Iteration:** 15
**Vorgänger:** Iteration 14 (Playwright + Camera-Info-Fix)

## Motivation

Phase 4 der Roadmap nennt „Objektivkorrektur via Lensfun-Profil-DB" als Wochen-10-Aufgabe. Saubere Aufteilung:
- Iteration 15 (jetzt): manuelle Slider + Shader-Pass — sofort sichtbarer Wert, vollständig getestet, kein DB-Aufwand.
- Iteration 16: Lensfun-Auto-Detection per EXIF, setzt die Slider basierend auf Kamera+Linse beim Öffnen.

Distortion und Vignette sind **objektiv-spezifisch**, nicht look-spezifisch. Sie gehören NICHT in `adjustments` (Single Source of Truth für Presets), sondern in einen eigenen Geometrie-/Objektiv-Slot wie `cropRect` und `straightenAngle`.

## Ziel

- Zustand: `lensCorrection: { distortion: number; vignette: number }` (beide −1..+1, Default 0).
- Vertex-/Fragment-Shader-Erweiterung:
  - Distortion: Brown-Conrady 1-Term `r' = r * (1 + k1 * r²)` im UV-Space.
  - Vignette: radiale Helligkeit-Korrektur `brightness *= 1 + v * r²`.
- UI-Slider in neuer Sidebar-Sektion „Objektiv".
- Tests: Math (pure), Store-Erweiterung, E2E-Smoke.

## Nicht-Ziel

- Keine Lensfun-DB / Auto-Detection (Iteration 16).
- Keine 2-Term-Brown-Conrady (k1+k2). Reicht für die Mehrheit; bei Bedarf später.
- Kein Chromatic-Aberration-Pass.
- Kein Profil-Persist im Preset (lens-correction ist bildspezifisch).

## Distortion-Mathematik

Brown-Conrady im UV-Space:

```glsl
vec2 c = v_uv - 0.5;             // zentriert um Bildmitte
float r2 = dot(c, c);            // r²
float k1 = u_distortion * 0.4;   // -0.4 .. +0.4 — sinnvoller Bereich
vec2 corrected = c * (1.0 + k1 * r2);
vec2 src_uv = corrected + 0.5;
```

**Wirkung:**
- `k1 > 0` (positive distortion-Slider): Bild **streckt sich nach außen** → Pincushion-Korrektur entfernt Pincushion-Verzerrung des Objektivs.
- `k1 < 0`: Bild **wölbt sich zur Mitte** → Barrel-Korrektur (Tonnenverzerrung weg).

Werte außerhalb von [0,1] der UV werden geclampt (CLAMP_TO_EDGE). Zoom-out-Effekt am Rand bei `k1 > 0` ist der erwartete „Gummiband"-Effekt — User kann das per Crop maskieren.

## Vignette-Mathematik

Nach allen Adjustments (am Ende der Pipeline):

```glsl
vec2 vc = v_uv - 0.5;
float vr2 = dot(vc, vc);            // 0 in der Mitte, ~0.5 in den Ecken
float vignetteFactor = 1.0 + u_vignette * vr2 * 2.0;
c.rgb *= vignetteFactor;
```

**Wirkung:**
- `u_vignette > 0`: Ecken werden heller (positive Vignette-Korrektur entfernt natürliche Lens-Vignette).
- `u_vignette < 0`: Ecken werden dunkler (kreativer Look, Vignette hinzufügen).

## Pipeline-Reihenfolge

Distortion gehört **vor** den Texture-Fetch (UV-Transformation). Vignette gehört **nach** den Adjustments (Helligkeits-Modulation). Update der GLSL-`main()`:

1. Bestehende UV-Transform (Crop + Straighten) — wirkt auf v_uv.
2. **NEU:** auf das Ergebnis Distortion angewendet → finale src_uv.
3. Texture-Fetch wie gehabt.
4. Bestehende Adjustments-Pipeline.
5. **NEU:** Vignette-Multiplikation kurz vor outColor.

Der Vertex-Shader bleibt unverändert (Distortion läuft im Fragment-Shader, weil per-Pixel und nichtlinear).

## Settings & Datenmodell

Frontend-Store (Erweiterung):

```ts
export interface LensCorrection {
  readonly distortion: number; // -1..+1, default 0
  readonly vignette: number;   // -1..+1, default 0
}

interface EditorState {
  // ... bestehend
  lensCorrection: LensCorrection;
  setLensCorrection: (next: Partial<LensCorrection>) => void;
}

const defaultLensCorrection = (): LensCorrection => ({ distortion: 0, vignette: 0 });
```

`resetGeometry` setzt **auch** lensCorrection zurück, weil es konzeptuell Teil der Geometrie/Objektiv-Sektion ist.

Backend: **kein Schema-Update**. Distortion/Vignette werden nicht in Presets persistiert (bildspezifisch).

## UI

Neue Sektion in der Sidebar zwischen „Geometrie" und der ersten Adjustment-Gruppe:

```
Objektiv
─────────
Verzeichnung    [-1 ... 0 ... +1]   ⌫
Vignettierung   [-1 ... 0 ... +1]   ⌫
```

Generischer `Slider`-Component nutzbar — aber mit Step `0.01`, Default `0`. Für die Objektiv-Slider verwende ich nicht `adjustments[]`, sondern direkt-State-Verbindungen, weil der Slider-Component generisch ist (akzeptiert `min/max/step/default/onChange/value`).

## Tests

`tests/lens.test.ts` (neu, ~3 Tests):
- Brown-Conrady Math: r=0 → unverändert, r=0.5 mit k1=0.4 → bekannter Wert.
- Vignette-Faktor bei r=0 → 1.0, in den Ecken → bekannter Wert.

`tests/store.test.ts` (erweitern, ~3 Tests):
- `setLensCorrection({distortion: 0.5})` setzt nur distortion, lässt vignette
- Clamping auf [-1, 1]
- `resetGeometry` setzt lens-correction zurück

`tests/Editor.test.tsx` oder `e2e/editor.spec.ts`: Slider in der Objektiv-Sektion sichtbar, bewegt sich.

## Akzeptanzkriterien

1. 107+ Vitest grün, 14+ Playwright grün.
2. Lint + TypeScript 0.
3. Build durchläuft.
4. Browser-Smoke: bei `distortion = +0.5` Bild „dehnt sich" sichtbar; bei `vignette = -0.5` werden Ecken dunkler.

## Risiken

- **Performance:** Distortion ist eine pro-Pixel sin/cos-freie Operation, vernachlässigbar (~0.5 ms zusätzlich auf 24 MP).
- **Range-Wahl:** `0.4` als Skalierungsfaktor für `k1` ist heuristisch — passt für übliche Weitwinkel-Tonne. Bei Bedarf in Iteration 16 (Lensfun-Profile) durch echte Koeffizienten ersetzt.
