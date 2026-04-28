# Sharpening + Noise-Reduction (E3) · Design

**Datum:** 2026-04-28
**Vorgaenger:** Phase-E-Roadmap (Item E3)
**Aufwand:** 0.5 + 1 Tag

## Motivation

Lightroom-Standard im RAW-Workflow. Bilder wirken ohne Detail-Stufe
weich. Phase E3 schliesst diese Luecke mit zwei Slidern, ohne
zusaetzliche Render-Pipelines.

## Scope

- **Sharpening**: 1 Slider 0..1, 4-Tap Unsharp-Mask im Pixel-Shader
- **Noise-Reduction**: 1 Slider 0..1, 3x3 Bilateral-Light direkt am
  Quell-Sample
- **Out-of-Scope**: Radius-/Threshold-Parameter, Schaerf-Maskierung,
  CNN-basierte Denoising — eigene Iteration

## Datenmodell

`Adjustments` (Backend + Frontend) bekommt zwei neue Scalar-Felder
(beide 0..1, default 0):

```python
sharpness: float = Field(default=0, ge=0, le=1)
noiseReduction: float = Field(default=0, ge=0, le=1)  # noqa: N815
```

Sie sind Pflicht — keine `None`-Optionalitaet, weil 0 = neutral keine
Speicherersparnis bringt (Floats sind klein gegenueber Hsl-Records).

`AdjustmentKey` Union waechst auf 12 Eintraege; neue Gruppe `"Detail"`
in `AdjustmentGroup` haelt beide. JSON-Schema wird um die zwei
Properties + Required-Liste erweitert; Sync-Test hat sie in
SCALAR_FIELDS.

## Shader

### Noise-Reduction (vor Pipeline)

Direkt nach dem ersten `texture(u_tex, src_uv)` werden 9 Samples
(3x3) gewichtet:

```glsl
if (u_noiseReduction > 0.001) {
  // Tonal-Sigma waechst mit Slider — kleine Werte = konservativ.
  float tonalSigma = 0.05 + (1.0 - u_noiseReduction) * 0.3;
  // Spatial: Mitte 1.0, Kanten 0.5, Diagonalen 0.25
  // Tonal:   Gauss ueber Luminanz-Differenz
  // Mix gewichtet das Endbild zwischen src und denoised mit Slider-Wert.
}
```

9 Texture-Reads sind perf-noch-akzeptabel (~9x mehr als ohne) — bei
1600x1200 sind das ~17 Mio Reads pro Frame, in der Praxis flueffig auf
Mobile-iGPU.

### Sharpening (nach Tonkurve, vor Vignette)

4-Tap Laplacian aus `u_tex` (nicht aus `c`!). Auf das aktuelle `c`
addieren skaliert mit Slider. Bewusst nicht auf der vollen Pipeline
gerechnet — fuer 1-Pass-Shader genuegt das.

```glsl
if (u_sharpness > 0.001) {
  vec3 cn/cs/cw/ce = texture(u_tex, src_uv + ±px).rgb;
  vec3 hf = src.rgb - (cn + cs + cw + ce) * 0.25;  // High-Frequency
  c = clamp(c + hf * u_sharpness * 1.5, 0.0, 1.0);
}
```

Gain `1.5` ergibt bei Slider 1 ein deutlich knackigeres Bild ohne
sofortiges Halo. Bei groesseren Bildern wird der Effekt natuerlich
schwaecher (4 Pixel Laplacian = small radius).

`px = 1.0 / vec2(textureSize(u_tex, 0))` einmal vor der Slice
berechnen.

## Renderer

Keine eigenen Uniform-Arrays — `sharpness` und `noiseReduction` sind
ueber den bestehenden `adjustmentLocs`-Mechanismus (Iteration ueber
`ADJUSTMENTS`) automatisch verdrahtet. Sobald sie in `ADJUSTMENTS`
stehen, hat der Renderer `u_sharpness`, `u_noiseReduction`-Locations.

## UI

Bestehende Sidebar-Sektion mit `adjustmentsByGroup`-Loop rendert die
neue Gruppe `"Detail"` automatisch — keine eigene Komponente noetig.
Slider erbt Range/Step/Default aus `ADJUSTMENTS`.

## Tests

- `adjustments.test.ts`: bumped count auf 12, Detail-Gruppe = 2,
  range-Test unterscheidet 0..1 vs -1..+1
- backend `test_schema_sync`: SCALAR_FIELDS um die neuen 2 erweitert,
  required-Array enthaelt beide
- backend `test_presets_crud`: deckt durch `Adjustments()`-Creation
  bereits ab — neue Felder werden mit default 0 angelegt

## Akzeptanzkriterien

- [ ] Backend Adjustments hat sharpness + noiseReduction (0..1)
- [ ] JSON-Schema synchron, Sync-Test gruen
- [ ] Frontend AdjustmentKey + ADJUSTMENTS bumped, Detail-Gruppe
- [ ] Shader rendert mit beiden Slidern ohne Compile-Error
- [ ] Sharpen 0.5: spuerbar mehr Detail, keine sichtbaren Halos
- [ ] Noise 0.5: feines Rauschen weicher, Kanten bleiben
- [ ] Bestehende Presets laden weiterhin (Default 0 fuer alte Felder)
- [ ] CI gruen (backend + frontend)
