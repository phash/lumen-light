# Spec · Radialfilter (Ellipse)

**Datum:** 2026-04-27
**Iteration:** 18
**Vorgänger:** Iteration 17 (Linearer Verlaufsfilter)

## Motivation

Phase 5 Woche 13. Zweite Maskenform: ein elliptischer Bereich, der lokale
Anpassungen innen anwendet und nach außen mit Feather ausläuft. Klassische
Anwendung: Gesicht aufhellen, Sonnenfleck eingrenzen.

## Ziel

- **Eine** radiale Maske pro Bild, parallel zur linearen Maske aktivierbar.
- Center + rx + ry + Feather-Slider — anisotrope Ellipse.
- 4 lokale Adjustments wie bei It 17 (`exposure`, `contrast`,
  `saturation`, `temperature`).
- Maskenberechnung im FRAG_SRC: `dist² = ((u-cu)/rx)² + ((v-cv)/ry)²`,
  dann `1 - smoothstep(1-feather/2, 1+feather/2, dist²)`.
- UI: Toggle-Button, RadialMaskOverlay mit 3 Drag-Handles
  (center / rx-east / ry-south), Sidebar-Sektion „Lokal · Radial".

## Nicht-Ziel

- Multi-Mask (Iteration 19a).
- Schräggestellte Ellipsen (Rotation) — Backlog.
- Persistenz im Preset (Iteration 19b).

## Datenmodell (Erweiterung von `mask.ts`)

```ts
export interface RadialMask {
  readonly type: "radial";
  readonly center: PointUv;
  readonly rx: number;          // 0.02..1
  readonly ry: number;          // 0.02..1
  readonly feather: number;     // 0..1, gleicher Sinn wie linear
}

export const defaultRadialMask = (): RadialMask => ({
  type: "radial",
  center: { u: 0.5, v: 0.5 },
  rx: 0.25,
  ry: 0.25,
  feather: 0.4,
});

export function clampRadius(r: number): number {
  return Math.max(0.02, Math.min(1, r));
}
```

Store-Slot analog zu linearMask: `radialMaskEnabled / radialMask /
radialLocalAdj` plus Setter und `resetRadialMask`.

## Shader

Zusätzliche Uniforms `u_radialEnabled`, `u_radialCenter`,
`u_radialRadii` (vec2), `u_radialFeather`, `u_radialLocalExposure` ...

```glsl
float computeRadialMask(vec2 uv) {
  vec2 r = max(u_radialRadii, vec2(0.001));
  vec2 d = (uv - u_radialCenter) / r;
  float dist2 = dot(d, d);
  float halfFeather = max(0.001, u_radialFeather * 0.5);
  return 1.0 - smoothstep(1.0 - halfFeather, 1.0 + halfFeather, dist2);
}
```

Anwendung: lineare und radiale Maskenfaktoren werden getrennt berechnet
und beide auf die globalen Adjustments addiert:

```glsl
float mLin = u_maskEnabled  > 0.5 ? computeLinearMask(v_uv) : 0.0;
float mRad = u_radialEnabled > 0.5 ? computeRadialMask(v_uv) : 0.0;
float effExposure = u_exposure
  + mLin * u_localExposure + mRad * u_radialLocalExposure;
// ... contrast / saturation / temperature analog
```

## UI

- **Toolbar-Button** „+ Radial" neben „+ Verlauf".
- **RadialMaskOverlay** mit drei Drag-Handles:
  - Center (groß, ml-2/-mt-2): verschiebt die ganze Ellipse.
  - rx-East (klein, ew-resize): ändert nur `rx`.
  - ry-South (klein, ns-resize): ändert nur `ry`.
- SVG-Ellipse mit `stroke-dasharray="4 4"` als visuelle Grenze.
- **Sidebar-Sektion** „Lokal · Radial" (testid `radial-mask-section`)
  mit den 4 lokalen Slidern + Feather + Reset.

## Tests

- `mask.test.ts`: `computeRadialMaskFactor` — Center=1, Außen=0, auf
  Kante≈0.5, anisotrop rx≠ry, Feather steuert Übergang.
- `store.test.ts`: `set*-Setter` + `resetRadialMask`.
- `e2e/editor.spec.ts`: Toggle, Overlay, Slider, Reset.

## Akzeptanzkriterien

1. Vitest 148 → 158 grün.
2. ESLint 0, TypeScript 0, Build sauber.
3. Browser-Smoke: Lineare und radiale Maske gleichzeitig aktiv —
   beide Effekte sichtbar, kein Render-Bug.

## Risiken

- **Uniform-Count:** +12 Uniforms gegenüber It 17. Weiterhin trivial.
- **Architektur-Lock-in:** Zwei feste Slots im Shader limitieren auf
  1×Linear + 1×Radial. Iteration 19a löst das mit Uniform-Arrays.
