# HSL-Farbmischer (E1) · Design

**Datum:** 2026-04-28
**Vorgaenger:** Phase-E-Roadmap (Item E1)
**Aufwand:** 1-2 Tage

## Motivation

HSL-Mischer ist Lightrooms zentraler Color-Workflow: Hauttoene
unabhaengig vom globalen Saturation-Slider waermer/kuehler, Himmel
verstaerken, Gruen kuehlen. Ohne HSL bleibt Lumen bei groben
„Sattigung global"-Eingriffen.

## Datenmodell

8 Farbtonbereiche × 3 Achsen = 24 Werte. Drei Channel-Mappings auf
Hue-Center (Anteil von 0..1):

| Channel    | Center | Hue-Bereich (Hue 0..1) |
|------------|--------|------------------------|
| `red`      | 0.000  | 0.000 |
| `orange`   | 0.083  | ~30°  |
| `yellow`   | 0.166  | ~60°  |
| `green`    | 0.333  | ~120° |
| `aqua`     | 0.500  | ~180° |
| `blue`     | 0.666  | ~240° |
| `violet`   | 0.750  | ~270° |
| `magenta`  | 0.833  | ~300° |

Jede Achse `hue/saturation/luminance` haelt 8 Floats `-1..+1`. Default 0.

### Backend (`backend/app/schemas.py`)

```python
HslChannel = Literal[
    "red","orange","yellow","green","aqua","blue","violet","magenta",
]
class HslAxis(BaseModel):
    model_config = ConfigDict(extra="forbid")
    red: float = Field(default=0, ge=-1, le=1)
    orange: float = Field(default=0, ge=-1, le=1)
    yellow: float = Field(default=0, ge=-1, le=1)
    green: float = Field(default=0, ge=-1, le=1)
    aqua: float = Field(default=0, ge=-1, le=1)
    blue: float = Field(default=0, ge=-1, le=1)
    violet: float = Field(default=0, ge=-1, le=1)
    magenta: float = Field(default=0, ge=-1, le=1)

class HslAdjustments(BaseModel):
    model_config = ConfigDict(extra="forbid")
    hue: HslAxis = Field(default_factory=HslAxis)
    saturation: HslAxis = Field(default_factory=HslAxis)
    luminance: HslAxis = Field(default_factory=HslAxis)
```

`Adjustments.hsl: HslAdjustments | None = None` — Default `None` heisst
„HSL inaktiv", spart 24 Felder im JSONB fuer Presets ohne HSL.

JSON-Schema (`adjustments.schema.json`) bekommt ein zusaetzliches
optionales `hsl` Property mit `oneOf: [null, HslAdjustments]`. Schema-
Sync-Test prueft Pendant in Pydantic.

Keine DB-Migration noetig — `presets.adjustments` ist JSONB.

### Frontend

`frontend/src/editor/adjustments.ts` bekommt:

```ts
export const HSL_CHANNELS = ["red","orange","yellow","green","aqua",
  "blue","violet","magenta"] as const;
export type HslChannel = typeof HSL_CHANNELS[number];

export interface HslAdjustments {
  readonly hue:        Record<HslChannel, number>;
  readonly saturation: Record<HslChannel, number>;
  readonly luminance:  Record<HslChannel, number>;
}

export type HslAxis = "hue" | "saturation" | "luminance";

export interface Adjustments {
  // bisherige 10 Felder als explizite Properties
  readonly exposure: number;
  // ...
  readonly hsl: HslAdjustments | null;
}

export function defaultHslAdjustments(): HslAdjustments
export function isHslNeutral(hsl: HslAdjustments | null): boolean
```

`Record<AdjustmentKey, number>`-Definition wird zu einer expliziten
Interface-Form, damit `hsl` als Sondertyp dazukommt.

## Shader

24 floats als 3 `uniform float[8]` Arrays. Hue-Center als `const float[8]`
im Shader. Bell-Funktion: Gauss um Hue-Center mit `sigma = 0.05` (~30°
Halbwertsbreite). Wrap am Hue-Kreis.

```glsl
const int HSL_CHANNELS = 8;
const float HSL_CENTERS[HSL_CHANNELS] = float[](
  0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.8333
);
const float HSL_SIGMA = 0.05;

uniform float u_hslHue[HSL_CHANNELS];
uniform float u_hslSat[HSL_CHANNELS];
uniform float u_hslLum[HSL_CHANNELS];

// in main(), nach Saettigung-Block:
vec3 hsl2 = rgbToHsl(c);
float wSum = 0.0;
float dHue = 0.0, dSat = 0.0, dLum = 0.0;
for (int i = 0; i < HSL_CHANNELS; i++) {
  float dx = abs(hsl2.x - HSL_CENTERS[i]);
  dx = min(dx, 1.0 - dx);
  float w = exp(-(dx*dx) / (HSL_SIGMA*HSL_SIGMA));
  dHue += w * u_hslHue[i];
  dSat += w * u_hslSat[i];
  dLum += w * u_hslLum[i];
  wSum += w;
}
if (wSum > 1e-4) {
  hsl2.x = mod(hsl2.x + dHue / wSum * 0.1, 1.0);   // Hue-Shift max ±36°
  hsl2.y = clamp(hsl2.y * (1.0 + dSat / wSum), 0.0, 1.0);
  hsl2.z = clamp(hsl2.z + dLum / wSum * 0.3, 0.0, 1.0);
  c = hslToRgb(hsl2);
}
```

Gain-Faktoren (`0.1` Hue, `0.3` Lum) konservativ — Slider von -1..+1
soll spuerbar wirken, aber nicht clipping-uebersteuert. `0.1` heisst:
Slider auf +1 verschiebt Hue um max 36° (1/10 des Hue-Kreises).

Schalter im Shader: wenn `Adjustments.hsl === null`, werden alle
24 Uniforms auf 0 gesetzt → wSum > 0 aber dHue/dSat/dLum = 0 →
keine Aenderung. Kein Branch noetig.

## Renderer

`Renderer` bekommt 3 zusaetzliche `Float32Array(8)` und 3
`WebGLUniformLocation`. `pack(hsl)` befuellt Arrays aus
`HslAdjustments | null` (null → fill(0)).

## UI

Neue Sidebar-Section "Farben" mit zwei Tab-Reihen:

```
[Hue] [Sat] [Lum]   <- Achsen-Tabs
[●●●●●●●●]          <- 8 farbige Channel-Buttons (Rot bis Magenta)
[Slider -1..+1]     <- aktive Achse × aktiver Channel
```

Alternativ: 8 Tabs (eine pro Channel) × 3 Slider (Hue/Sat/Lum).

**Entscheidung:** Achsen-Tabs sind kompakter (3 Slider sichtbar pro
Achse waeren zu viel Vertikal-Estate); 8 Channel-Buttons farbig + ein
Slider unten ist aber unintuitiv. Kompromiss: 3 Achsen-Tabs, darunter
8 Mini-Slider mit farbigem Label-Punkt links.

```
Farben
─────────────────────
[Hue] [Sat] [Lum]
●Rot         [-1..+1]
●Orange      [-1..+1]
●Gelb        [-1..+1]
●Gruen       [-1..+1]
●Aqua        [-1..+1]
●Blau        [-1..+1]
●Violett     [-1..+1]
●Magenta     [-1..+1]
[Reset HSL]
```

Section-State persistiert via `lumen.section.hsl` (existing
CollapsibleSection-Mechanik). Default: collapsed (HSL ist Power-Tool,
nicht Erstkontakt).

## Store

`Adjustments` enthaelt jetzt `hsl: HslAdjustments | null`.

```ts
setHslChannel(axis: HslAxis, channel: HslChannel, value: number): void
resetHsl(): void  // setzt hsl auf null (deaktiviert)
```

`applyAdjustments` muss mit `hsl` umgehen koennen — Merge-Logik:
incoming.hsl ueberschreibt komplett (kein deep-merge), `null` setzt
zurueck.

`Reset all` setzt `hsl: null`.

## Tests

### Backend
- `test_adjustments_hsl_optional`: Adjustments ohne hsl-Feld bleibt
  valide (Backwards-Compat); hsl=null erlaubt; hsl mit Wert valide
- `test_hsl_axis_bounds`: Werte ausserhalb [-1, 1] werden 422
- `test_schema_sync` erweitern: `hsl` als optional in JSON-Schema
- `test_hsl_extra_forbid`: zusaetzliches Feld in HslAxis wirft 422

### Frontend
- `adjustments.test.ts`: `defaultAdjustments().hsl === null`,
  `defaultHslAdjustments()` hat alle 24 Felder = 0,
  `isHslNeutral(null)` und `isHslNeutral(default)` true
- `store.test.ts`: `setHslChannel` setzt Wert, erzeugt nicht-null hsl;
  `resetHsl` setzt auf null
- `shader-limits-sync.test.ts` erweitern: `HSL_CHANNELS = 8` in
  FRAG_SRC, `HSL_SIGMA = 0.05`
- `webgl.test.ts` (falls existiert) — sonst smoke-test in vitest:
  Renderer-Konstruktor wirft nicht bei neuen Uniforms

### E2E
- Optional: HSL-Slider in der Sidebar bewegt sich, Histogramm-Canvas
  rerendert (eher Smoke)

## Akzeptanzkriterien

- [ ] Backend Adjustments akzeptiert `hsl: HslAdjustments | null = None`
- [ ] JSON-Schema synchron, Test gruen
- [ ] Frontend Adjustments-Typ erweitert, alle Stellen kompilieren
- [ ] Shader rendert mit 24 zusaetzlichen Uniforms ohne Fehler
- [ ] HSL-Sektion in Sidebar, 3 Tabs × 8 Slider funktional
- [ ] Slider „Saettigung Rot -1" entfaerbt rote Bereiche, ohne andere
      Farben zu treffen (visuell pruefbar)
- [ ] Slider „Hue Orange +1" verschiebt Orange Richtung Gelb
- [ ] Reset-HSL-Button setzt alle 24 zurueck
- [ ] Bestehende Presets (ohne hsl) laden weiterhin sauber
- [ ] CI gruen: backend pytest, frontend vitest + tsc + lint

## Out of Scope (E1)

- Per-Channel-Curves (RGB-Splines) — kommt in E2 (Tonkurve)
- HSL-Range-Editor (eigene Hue-Bereiche definieren) — Power-User-Feature
- HSL als lokale Maskenanpassung — Aufwand, Nutzen unklar
- HSL-Smart-Preset-Suggestion (z.B. „Skin-Tone-Boost") — eigene Iteration
