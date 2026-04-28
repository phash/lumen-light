# Tonkurve (E2) · Design

**Datum:** 2026-04-28
**Vorgaenger:** Phase-E-Roadmap (Item E2)
**Aufwand:** 1-2 Tage

## Motivation

Punktbasierte Kurve liefert feinere Tonwertkontrolle als die 4
Tonwert-Slider (highlights/shadows/whites/blacks). S-Curve fuer
Mid-Kontrast, gehobene Schatten („crushed black lift"), Filmlook —
alles ueber Punkte machbar.

## Scope (MVP)

- 1 Luminanz-Kurve (kein per-Channel im MVP)
- 2 bis 8 Kontrollpunkte, sortiert nach x
- Default: Identitaet (2 Punkte (0,0), (1,1))
- Drag, Add (Klick auf Linie), Remove (Doppelklick auf Punkt), Reset

Out of Scope: Per-Channel-Kurven (R/G/B), Spline-Typ-Wahl,
Lock-Endpoints. Stretch Goals — eigene Iteration.

## Datenmodell

### Backend (`backend/app/schemas.py`)

```python
class ToneCurvePoint(BaseModel):
    model_config = ConfigDict(extra="forbid")
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)

class ToneCurve(BaseModel):
    model_config = ConfigDict(extra="forbid")
    points: list[ToneCurvePoint] = Field(min_length=2, max_length=8)

    @model_validator(mode="after")
    def _check_sorted(self) -> Self:
        xs = [p.x for p in self.points]
        if xs != sorted(xs):
            raise ValueError("Tonkurve-Punkte muessen nach x sortiert sein")
        return self
```

`Adjustments.toneCurve: ToneCurve | None = None` (camelCase wie
`localAdj` in den Masken — `# noqa: N815`). Default `None` heisst
Identitaet, spart 16 Floats im JSONB fuer Pre-E2-Presets.

JSON-Schema (`adjustments.schema.json`) bekommt:

```json
"toneCurve": {
  "oneOf": [{"type": "null"}, {"$ref": "#/$defs/ToneCurve"}],
  "default": null
}
```

Mit `$defs.ToneCurve.properties.points.minItems=2, maxItems=8`.

### Frontend (`frontend/src/editor/adjustments.ts`)

```ts
export interface ToneCurvePoint {
  readonly x: number;
  readonly y: number;
}
export interface ToneCurve {
  readonly points: ReadonlyArray<ToneCurvePoint>;
}
export type Adjustments = ScalarAdjustments & {
  readonly hsl: HslAdjustments | null;
  readonly toneCurve: ToneCurve | null;
};

export function defaultToneCurve(): ToneCurve
export function isToneCurveIdentity(curve: ToneCurve | null): boolean
```

## Curve Evaluation

Cubic Hermite („Monotone Cubic"-Variante, Fritsch-Carlson) — passt
durch alle Kontrollpunkte und vermeidet Overshoot:

```
für jedes Segment [x_i, x_{i+1}]:
  m_i, m_{i+1} = Tangenten (kalibriert für Monotonie)
  P(t) = h00*p_i + h10*(x_{i+1}-x_i)*m_i
       + h01*p_{i+1} + h11*(x_{i+1}-x_i)*m_{i+1}
```

**LUT-Berechnung** (`frontend/src/editor/toneCurve.ts`):

```ts
export function computeToneCurveLut(curve: ToneCurve): Uint8Array {
  const lut = new Uint8Array(256);
  // ... fuer jedes i in [0,255]: x=i/255, y = evaluateMonotoneHermite(curve, x)
  // y wird auf 0..255 gerundet
  return lut;
}
```

LUT wird im Worker-freien Thread berechnet — 256 Iterationen mit ein
paar Multiplikationen, < 1 ms.

## Shader

```glsl
uniform sampler2D u_toneCurveLut;
uniform float u_toneCurveActive; // 0 oder 1
```

Im `main()`, nach dem HSL-Block:

```glsl
if (u_toneCurveActive > 0.5) {
  float L = luminance(c);
  float newL = texture(u_toneCurveLut, vec2(L, 0.5)).r;
  if (L > 1e-4) {
    c *= newL / L;
    c = clamp(c, 0.0, 1.0);
  }
}
```

LUT-Texture ist 256x1, R8 (`gl.R8`). Texture-Unit 1.
`u_toneCurveActive=0` ueberspringt — wenn `Adjustments.toneCurve === null`.

## Renderer

- Zusaetzliche `WebGLTexture lutTexture` (256x1 R8)
- `uploadToneCurveLut(lut: Uint8Array)` setzt Texture-Daten neu
- `render()` bindet TEXTURE1 vor `drawArrays`
- Bei `adjustments.toneCurve === null` wird active=0 gesetzt; Lut-Texture
  bleibt initial (Identity), Inhalt egal

## Store

```ts
setToneCurvePoint(index: number, x: number, y: number): void
addToneCurvePoint(x: number, y: number): void  // sortiert in points ein
removeToneCurvePoint(index: number): void  // mind. 2 Punkte bleiben
resetToneCurve(): void  // setzt toneCurve = null
```

`isToneCurveIdentity` prueft: 2 Punkte, (0,0) und (1,1) -> wird zu
null kompaktiert (analog zu HSL-isNeutral).

## UI

`frontend/src/editor/ToneCurvePanel.tsx` — 200x200 SVG mit:
- Hintergrund-Grid (4x4)
- Identity-Diagonale als Hilfslinie (gestrichelt)
- Kurven-Pfad (Sample 50 Punkte aus LUT, als polyline)
- Kontrollpunkte als Kreise, draggable
- onClick auf leere Stelle: Punkt einfuegen
- onDoubleClick auf Punkt: entfernen (mind. 2)
- "Zuruecksetzen"-Button

Drag aktualisiert `setToneCurvePoint(index, ...)` mit clamp x in
(prev.x, next.x), y in [0,1]. Endpunkte (Index 0 und last) duerfen
nicht durch Drag verschoben werden — nur y-Wert (x bleibt 0 bzw. 1).

CollapsibleSection "Tonkurve" in der Sidebar, default collapsed.

## Tests

### Backend
- `test_tone_curve_min_2_points`, `test_tone_curve_max_8_points`
- `test_tone_curve_sorted_required`
- `test_tone_curve_extra_forbid`
- `test_adjustments_tone_curve_optional` (pre-E2-Payload weiterhin ok)
- Schema-Sync-Test erweitert um toneCurve-oneOf-Schema

### Frontend
- `toneCurve.test.ts`:
  - Identity-Curve liefert LUT[i] == i (mit Rundung-Toleranz)
  - S-Curve (3 Punkte) liefert LUT[64] < 64 und LUT[192] > 192
  - Monotone Hermite ueberschiesst nicht
- `adjustments.test.ts`: defaultToneCurve, isToneCurveIdentity
- `store.test.ts`: setToneCurvePoint clampt, addToneCurvePoint sortiert,
  removeToneCurvePoint behaelt min 2, resetToneCurve setzt null
- `shader-limits-sync.test.ts`: Tonkurve-Shader-Stelle erkennt Aktivierung

## Akzeptanzkriterien

- [ ] Backend Adjustments akzeptiert toneCurve (null oder Objekt)
- [ ] JSON-Schema synchron, Test gruen
- [ ] Frontend Adjustments-Typ erweitert, alle Stellen kompilieren
- [ ] LUT-Berechnung Monotone Hermite ohne Overshoot
- [ ] Shader rendert mit Tonkurve sichtbar S-foermig
- [ ] Tonkurven-Section in Sidebar, drag funktioniert
- [ ] Reset-Button stellt Identity wieder her
- [ ] Pre-E2-Presets laden weiter
- [ ] CI gruen (backend + frontend)
