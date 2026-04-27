# Spec · Multi-Mask + Preset-Persistenz

**Datum:** 2026-04-27
**Iteration:** 19 (Sub-Iterationen 19a Refactor, 19b Backend, 19c UI)
**Vorgänger:** Iteration 18 (Radialfilter)

## Motivation

Phase 5 Woche 13. Schließt die Phase ab:
- **19a:** Mehrere Masken pro Bild (n×Linear + n×Radial), Liste in der
  Sidebar mit Selektion und Löschen.
- **19b:** Speichern/Laden der Masken zusammen mit den globalen
  Adjustments im Preset-Format.
- **19c:** UI-Dialog zum Speichern, Laden, Aktualisieren und Löschen
  von Presets.

## Architektur-Entscheidung: Single-Shader statt FBO-Pipeline

Die Roadmap (Phase 5 Woche 11) nennt einen Multi-Pass-Pipeline-Refactor
mit Framebuffer-Objekten. Wir machen das **bewusst nicht** und bleiben
beim Single-Fragment-Shader-Ansatz, jetzt mit Uniform-Arrays:

- **MAX_LINEAR_MASKS = 4**, **MAX_RADIAL_MASKS = 4**, beide Konstanten
  in `shaders.ts`, `mask.ts`, `schemas.py` symmetrisch gehalten.
- Im Fragment-Shader laufen zwei Schleifen mit konstantem Loop-Bound
  `MAX_*_MASKS` und einem `if (i >= u_num*) break;` als
  uniform-driven Early-Termination — GLSL ES 3.00-konform.

**Begründung:**
- Die lokalen Adjustments sind 4 Werte (Belichtung, Kontrast,
  Sättigung, Temperatur). Pro Maske 4× Float + Geometrie ergibt rund
  10 Float-Uniforms — bei 8 Masken 80 Floats, weit unterhalb des
  WebGL2-Uniform-Limits (mind. 1024 Komponenten).
- Pingpong-FBO würde Texture-Reads pro Stage nötig machen
  (Bandbreitenkosten) und die Pipeline-Verkettung deutlich
  komplizieren — ohne Funktionsgewinn für diesen Cap-Bereich.
- Wenn lokale Adjustments später auf alle 10 Slider erweitert werden
  oder pro-Maske-Kurven dazukommen, wird der FBO-Refactor
  unausweichlich. Bis dahin: pragmatisch.

## 19a · Multi-Mask Refactor

### Datenmodell

```ts
export interface LinearMaskInstance {
  readonly id: string;
  readonly type: "linear";
  readonly mask: LinearMask;
  readonly localAdj: LocalAdjustments;
}
export interface RadialMaskInstance { /* analog */ }
export type MaskInstance = LinearMaskInstance | RadialMaskInstance;
```

Store-Felder ersetzen die einzelnen Slots durch eine flache Liste plus
Selektion:

- `masks: ReadonlyArray<MaskInstance>`
- `selectedMaskId: string | null`

ID-Vergabe via `crypto.randomUUID()` (Fallback `Math.random`).

Actions:
- `addLinearMask()` / `addRadialMask()` — gibt neue ID zurück oder
  `null` bei Cap-Voll, selektiert die neue Maske automatisch.
- `removeMask(id)` / `removeSelectedMask()` / `clearMasks()`.
- `selectMask(id|null)` (ignoriert unbekannte IDs).
- `setLinearMaskPoint(id, which, uv)` / `setRadialMaskCenter(id, uv)` /
  `setRadialMaskRadii(id, rx, ry)` / `setMaskFeather(id, feather)` /
  `setMaskLocalAdjustment(id, key, value)`.
- `applyMasks(masks)` — atomarer Replace mit Cap-Truncation, für
  Preset-Load.

### Shader

Uniform-Arrays:
```glsl
const int MAX_LINEAR_MASKS = 4;
const int MAX_RADIAL_MASKS = 4;
uniform int u_numLinearMasks;
uniform vec2 u_linMaskP1[MAX_LINEAR_MASKS];
// ... vec2 P2, float Feather, float Local{Exposure,Contrast,
//     Saturation,Temperature}
uniform int u_numRadialMasks;
// ... vec2 Center, vec2 Radii, float Feather, float Local* analog
```

Aufsummieren in `main()`:
```glsl
for (int i = 0; i < MAX_LINEAR_MASKS; i++) {
  if (i >= u_numLinearMasks) break;
  float m = computeLinearMaskN(i, v_uv);
  effExposure += m * u_linLocalExposure[i];
  // ...
}
// gleicher Loop fuer Radial.
```

### Renderer

`Renderer.render()` nimmt jetzt `masks: MasksUniforms = {linear[],
radial[]}`. Pre-allocated `Float32Array`-Felder werden in
`packLinearMasks` / `packRadialMasks` befüllt — keine Per-Frame-Allocs.

### UI

- **Toolbar:** „+ Verlauf" / „+ Radial"-Buttons (disabled bei MAX
  erreicht).
- **Sidebar-Sektion `mask-list`**: nummerierte Liste „Verlauf 1",
  „Radial 1", „Verlauf 2", click-to-select, ✕-Delete pro Item.
- **Sidebar-Sektion `local-mask-section` / `radial-mask-section`:**
  zeigt die selektierte Maske; gleiche Slider wie in It 17/18.

## 19b · Backend Preset-Persistenz

### Migration 004

```python
op.add_column(
  "presets",
  sa.Column("masks", postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb")),
)
```

### Pydantic-Schemas

CamelCase-Felder bewusst, weil Wireformat 1:1 zur TS-Seite passt.

```python
MaskData = Annotated[
  LinearMaskData | RadialMaskData,
  Field(discriminator="type"),
]
class PresetIn(BaseModel):
  ...
  masks: list[MaskData] = Field(default_factory=list)

  @model_validator(mode="after")
  def _check_mask_caps(self) -> Self:
    n_lin = sum(1 for m in self.masks if m.type == "linear")
    n_rad = sum(1 for m in self.masks if m.type == "radial")
    if n_lin > MAX_LINEAR_MASKS: raise ValueError(...)
    if n_rad > MAX_RADIAL_MASKS: raise ValueError(...)
    return self
```

`extra="forbid"` auf allen Mask-Modellen.

### Roundtrip

Backend-Tests: 4+4 Masken Cap-Grenze ok, >4 → 422, ungültiger Type/UV/
Extra-Field → 422, GET-Liste persistiert die Masken inkl. localAdj.

## 19c · Preset-Dialog (UI)

`frontend/src/editor/PresetDialog.tsx` ist ein modaler Dialog mit:

- Liste aller Presets, pro Eintrag „Laden" + „Löschen", Mask-Anzahl
  als Sub-Label.
- Name-Input + „Speichern"-Button für neue Presets (HTTP 201 → ID
  wird als `loadedPresetId` aktiv).
- Bei `loadedPresetId !== null`: zusätzlicher Button „… überschreiben"
  für `updatePreset`.
- Backdrop-Klick und ✕-Button schließen.

State `loadedPresetId` wird im Editor-Page gehalten, nicht im Store —
Reload-übergreifend gibt es noch keine Persistenz dieses Werts; das
ist ein UX-Detail, nicht datenrelevant.

`maskSerializer.ts` konvertiert `MaskInstance[] ↔ PresetMask[]`
(Wire-Format ohne ID; beim Laden frische ID).

## Tests

- `mask.test.ts`: pure Funktionen unverändert + Default + Clamp.
- `store.test.ts`: ~16 neue Multi-Mask-Cases (Add/Remove/Select/Cap/
  Clamp, applyMasks Truncation).
- `maskSerializer.test.ts`: 6 Roundtrip-Cases.
- `PresetDialog.test.tsx`: 13 Component-Tests (Liste laden, Empty,
  Load-Flow inkl. Mask-Restore, Save mit echtem Store, 409, leerer
  Name disabled, Delete + Refresh, Delete-aktiv-cleart-id, Update-
  Sichtbarkeit, Backdrop+✕-Close, Mask-Anzahl-Singular/Plural).
- `test_presets_crud.py`: 9 neue Backend-Cases (Default leere Masken,
  Linear+Radial-Roundtrip, Update überschreibt, Cap 4+4 ok, >4 → 422,
  ungültiger Type/UV/Extra-Field → 422).

## Akzeptanzkriterien

1. vitest 158 → 187 grün.
2. backend pytest 20/20 grün (test_presets_crud.py erweitert).
3. ESLint 0, TypeScript 0, Build sauber.
4. Roundtrip: 1 Bild + 2 Verläufe + 1 Radial → speichern → reset → laden →
   alle drei Masken stehen wieder.

## Backlog (nicht in It 19)

- Drag&Drop-Reorder der Mask-Liste.
- Lokale Adjustments für die übrigen 6 globalen Slider (Highlights,
  Shadows, Whites, Blacks, Vibrance, Tint) — bedingt FBO-Refactor.
- Schräg gestellte Ellipsen (Rotation).
- Pinsel/Lasso/KI-Masken.
- Persistenter `loadedPresetId` über Page-Reload (LocalStorage o.ä.).
