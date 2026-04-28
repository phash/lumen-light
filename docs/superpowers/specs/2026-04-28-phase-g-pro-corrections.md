# Phase G · Pro-Korrekturen (RawTherapee-inspiriert)

**Datum:** 2026-04-28
**Vorgaenger:** RawTherapee-Recherche (separater Background-Agent-Run)

## Motivation

Die heutigen 12 globalen Slider plus HSL und Tonkurve decken die
„offensichtlichen" Korrekturen ab. Was Lumen-Bearbeitungen sichtbar
unterscheidet von einem voll ausgereiften Tool wie RawTherapee:

- ausgebrannte Lichter sehen bei uns weiterhin magenta-tinted aus,
  weil wir nur einen Lichter-Slider haben (der pullt das ganze Pixel
  runter, nicht selektiv die clipped Channels).
- Mid-Frequenz-Detail (Hauttextur, Wolkenstruktur, Wasser-Reflexe)
  fehlt der „Pop", den ein Local-Contrast / Clarity-Slider bringt.
- Bei Weitwinkel offenblendigen Aufnahmen sieht man die
  Transverse-Chromatic-Aberration (rote/blaue Saeume an
  Hochkontrast-Kanten). Wir korrigieren heute nur Distortion, kein
  TCA.

## Items

### G1 · Highlight Recovery (Blend-Modus) — 1.5 Tage, single-pass-konform

Geclippte Kanaele durch das Mittel der nicht-clipped Kanaele
ersetzen. Wenn nur Gruen geclipped ist (typisch fuer warme Sonnen-
Highlights), pull-down auf den R/B-Pegel — Magenta-Cast verschwindet.
Wenn alle drei Kanaele clipped sind, bleibt es weiss (nicht
recoverbar).

**Algorithmus (GLSL, single-pass):**

```glsl
if (u_highlightRecovery > 0.001) {
  float thr = 0.94;
  vec3 isClipped = step(thr, c);
  float n = isClipped.r + isClipped.g + isClipped.b;
  if (n > 0.0 && n < 3.0) {
    float refValue = dot(c * (1.0 - isClipped), vec3(1.0)) / (3.0 - n);
    vec3 recovered = mix(c, vec3(refValue), isClipped);
    c = mix(c, recovered, u_highlightRecovery);
  }
}
```

Threshold 0.94 statt 1.0, damit Hochlichter graduell uebergehen statt
hart kippen. Recovery-Amount-Slider (0..1) blendet zwischen Original
und reconstructed.

Position in der Pipeline: zwischen Tonkurve und Vignette — die
clip-detection braucht das post-tonal-mapped Bild.

**Backend:** `Adjustments.highlightRecovery: float = Field(ge=0, le=1, default=0)`. JSON-Schema-Sync, populate_by_name backwards-compat.

**Frontend:** neuer Slider in der Licht-Gruppe (zwischen Lichter und
Tiefen), Tooltip „Rettet ausgebrannte Bereiche durch Pull-Down auf
unclipped-Channel-Mittel".

**RT-Quelle:** `rtengine/hilite_recon.cc:HLRecovery_blend` (Zeile
~979-1052).

### G2 · Local Contrast / Clarity — 1 Tag, einfacher Multi-Sample-Approach

Unsharp-Mask im Luminanz-Kanal mit asymmetrischem Gain
(dark-side / light-side separat). RawTherapees `iplocalcontrast.cc`
ist nur 75 Zeilen.

**Algorithmus (vereinfacht):**

```
blurred_Y = gaussian-blur(Y, sigma=radius)
delta = Y - blurred_Y
delta *= (delta > 0) ? amount * lightness_gain : amount * darkness_gain
Y' = clamp(Y + delta, 0, 1)
c *= Y' / max(Y, eps)
```

**Single-Pass-Approximation:** 5x5-Gauss in einem Pass (25 Reads pro
Pixel, akzeptabel) statt separabler 2-Pass. Bei 1600x1200-Bild sind
das ~48M Reads/Frame — sollte fluessig laufen wenn nur bei
`u_localContrast > 0.001` aktiviert.

**Backend:** `Adjustments.localContrast: float = Field(ge=-1, le=1)`.
Negative Werte = soften (RT erlaubt das auch).

**Frontend:** Slider in der Detail-Gruppe (neben Schaerfen).

**RT-Quelle:** `rtengine/iplocalcontrast.cc`.

### G3 · TCA-Korrektur (Transverse Chromatic Aberration) — 0.5-1 Tag

Pro Channel eigener Distortion-Faktor. R und B mit ihrem jeweiligen
`k1_R`, `k1_B` sampeln, G unveraendert. Lensfun-DB hat `tca`-Eintraege
pro Lens.

**Shader-Aenderung** (in `main()`, vor dem texture-fetch):

```glsl
vec2 dc = v_uv - 0.5;
float dr2 = dot(dc, dc);
float kg = u_lensDistortion * DISTORTION_GAIN;
float kr = kg + u_tcaR * TCA_GAIN;
float kb = kg + u_tcaB * TCA_GAIN;

vec2 src_uv_g = dc * (1.0 + kg * dr2) + 0.5;
vec2 src_uv_r = dc * (1.0 + kr * dr2) + 0.5;
vec2 src_uv_b = dc * (1.0 + kb * dr2) + 0.5;

vec3 src = vec3(
  texture(u_tex, src_uv_r).r,
  texture(u_tex, src_uv_g).g,
  texture(u_tex, src_uv_b).b
);
```

3x Texture-Sample statt 1x — minimaler Perf-Impact.

**Backend:** Adjustments wird NICHT erweitert — TCA gehoert zur Lens-
Korrektur, nicht zur globalen Anpassung. Stattdessen:
`LensCorrection.tcaR/tcaB` als zwei zusaetzliche Felder, neben
`distortion`/`vignette`.

**Frontend:** zwei neue Slider in der Objektiv-Sektion. Lensfun-
Profile bekommen `tcaR`/`tcaB`-Felder. Bei automatischer
Profil-Erkennung werden sie mitgesetzt; manueller Override bleibt
moeglich.

**Lensfun-DB:** unsere bestehende `infra/lensfun/profiles.json` hat
diese Werte heute nicht — fuer Phase G3 reicht ein flacher Default
(0/0), der User stellt die Slider manuell ein. Migration auf die volle
Lensfun-DB inkl. Stuetzstellen-Interpolation ist eigene Iteration
(Phase G4, deutlich groesser, 2-3 Tage).

**RT-Quelle:** `rtengine/rtlensfun.cc:ApplySubpixelDistortion`.

## Reihenfolge

1. **G1 Highlight Recovery** — am sichtbarsten fuer Hobby-Fotografen,
   single-pass-clean. Zuerst.
2. **G2 Local Contrast** — kleinster Kosten-Nutzen-Cliff, sichtbar bei
   dunstigen Aussenaufnahmen.
3. **G3 TCA** — niedrigster Aufwand, zielgruppen-spezifisch
   (Weitwinkel-Offen-Aufnahmen).

Phase G4 (Lensfun-DB-Migration mit Stuetzstellen-Interpolation) bleibt
Backlog — wenn G3 TCA da ist, faehrt Phase G erstmal komplett.

## Out of Scope (eigene spaetere Iterationen)

- Highlight Recovery Color-Propagation (RT-Inpaint-Variante) — braucht
  Pyramid-Box-Blur und Multi-Pass, einige Tage Arbeit.
- Defringe / Purple-Fringe-Removal — braucht Lab-Konversion in einem
  zweiten Pass.
- Dehaze (Dark-Channel-Prior + Guided Filter) — komplexester der
  Posten, 4-5 Tage.
- Camera-Constants-Import (RT `camconst.json`) — bestaetigt: nicht
  uebernehmen, gehoert in den libraw-Pfad.
