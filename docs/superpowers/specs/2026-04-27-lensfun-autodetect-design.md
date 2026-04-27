# Spec · Lensfun-Auto-Detection (vereinfacht: Body+Focal-Heuristik)

**Update 2026-04-27:** Diagnostic-Test gegen libraw-wasm hat gezeigt,
dass die Bibliothek **keinen Lens-Namen-String** zurückliefert — nur
`camera_make`, `camera_model`, `focal_len`. Lens-Profile-Lookup wird
daher auf (Make, Model, optional Focal-Range) reduziert. Das ist pragmatisch
und liefert Default-Werte für die häufigsten Body+Brennweite-Kombinationen,
ohne perfekt zu sein. Lensfun ist „Lens" nur dem Namen nach — in dieser
Iteration ist es eigentlich „Camera-Body-Heuristik".

---

# Spec · Lensfun-Auto-Detection

**Datum:** 2026-04-27
**Iteration:** 16
**Vorgänger:** Iteration 15 (manuelle Distortion + Vignette)

## Motivation

Distortion und Vignette werden nun manuell gesetzt — wertvoll, aber nicht automatisch. Lensfun-Datenbank-Lookup beim Bild-Open setzt die Slider basierend auf der erkannten Kamera + Linse.

Vollständige Lensfun-DB ist groß (mehrere MB XML). Pragmatisch: handgepflegtes JSON mit ~30 häufigen Linsen, Polynomial-Modell mit nur k1 (kompatibel zu unserem Brown-Conrady 1-Term Shader). Profile-Erweiterung kann später per Cron-Sync aus der echten Lensfun-DB kommen.

## Ziel

- `infra/lensfun/profiles.json` mit Lens-Profilen (Make, Model, lensRegex, k1, vignette).
- `src/editor/lensProfile.ts`: `findLensProfile(make, model, lensName)` lookup.
- `decodeRaw` extrahiert zusätzlich `lensName` aus libraw-Metadata.
- Editor wendet bei Bild-Open ein gefundenes Profil an, setzt `lensCorrection`.
- Profile-Status in der UI sichtbar: „Profil: Sony FE 24-70 (auto)" oder „Kein Profil — manuell".
- Override-Button: bei manueller Slider-Änderung wird auf "manuell" umgeschaltet.
- Tests: Profile-Lookup, Integration in `decodeRaw`, E2E mit echtem RAW.

## Nicht-Ziel

- Keine vollständige Lensfun-DB — handkurierte Profile reichen für die häufigsten ~10 Marken.
- Kein automatischer Profil-Sync aus Lensfun-XML.
- Kein 2-Term Brown-Conrady (k1 + k2). Reicht.
- Kein TCA (chromatische Aberration). Eigene Iteration.

## Datenmodell

`infra/lensfun/profiles.json`:

```json
{
  "$schema": "https://lumen.example/schemas/lensfun-profiles.schema.json",
  "version": 1,
  "profiles": [
    {
      "id": "sony-fe-24-70-gm",
      "make": "Sony",
      "modelMatch": "ILCE-7",
      "lensMatch": "FE 24-70",
      "k1": -0.18,
      "vignette": 0.4,
      "comment": "Sony FE 24-70mm F2.8 GM @ 24mm Wide-Angle, mässige Tonne + Vignette"
    },
    {
      "id": "canon-ef-s-18-55-stm",
      "make": "Canon",
      "modelMatch": "EOS",
      "lensMatch": "EF-S 18-55",
      "k1": -0.22,
      "vignette": 0.3
    }
    // … weitere
  ]
}
```

`make`/`modelMatch`/`lensMatch` sind case-insensitive Substring-Matches. Kein voller Regex (kann später ergänzt werden).

## TypeScript

```ts
// src/editor/lensProfile.ts
export interface LensProfile {
  id: string;
  make: string;
  modelMatch: string;
  lensMatch: string;
  k1: number;
  vignette: number;
  comment?: string;
}

export interface LensProfileLookupResult {
  profile: LensProfile | null;
  reason: "matched" | "no-make" | "no-model" | "no-lens" | "no-match";
}

export function findLensProfile(
  make: string | null,
  model: string | null,
  lensName: string | null,
  profiles: ReadonlyArray<LensProfile>,
): LensProfileLookupResult;
```

`decodeRaw` wird erweitert:

```ts
export interface DecodedRaw {
  // ... bestehend
  lensName: string | null;
}
```

Im libraw-meta-Dump habe ich gesehen, dass `lens` und `LensModel` mögliche Felder sind. Defensive Multi-Path-Lookup analog zu `cameraMake`/`cameraModel`.

## Editor-Integration

Neuer Store-Slot:

```ts
interface EditorState {
  // ... bestehend
  lensProfileId: string | null;     // 'auto:<id>' oder null
  manualLensOverride: boolean;       // true wenn User Slider angefasst hat
  setLensProfile: (profileId: string | null) => void;
}
```

Beim `decodeRaw`-Erfolg im Editor:

1. `lensName` aus dekodiertem RAW
2. `findLensProfile(make, model, lensName, profiles)` → `result`
3. Wenn `result.profile`: `setLensCorrection({ distortion: profile.k1 / DISTORTION_GAIN, vignette: profile.vignette })` und `setLensProfile(profile.id)`
4. Sonst: `setLensProfile(null)`, manuelle Slider auf 0

Bei manueller Slider-Änderung wird `manualLensOverride` auf `true` gesetzt — Profil-Anzeige zeigt dann „manuell". Reset-Button „Profil erneut anwenden" setzt zurück.

## UI

In der „Objektiv"-Sektion oben einen kleinen Status-Indikator:

```
Objektiv  · Sony FE 24-70 GM (auto)            [⌫ Profil neu anwenden]
─────────
Verzeichnung    [Slider]
Vignettierung   [Slider]
```

oder:

```
Objektiv  · kein Profil — manuell
```

## Profile-Korpus (initial, ~10 Linsen)

Aus dem Test-Korpus sind diese Linsen relevant:

| Sample | Make | Model | Lens (aus EXIF) | k1 | vignette |
|---|---|---|---|---|---|
| Canon EOS 600D | Canon | EOS 600D | unbekannt | — | — |
| Canon EOS R | Canon | EOS R | unbekannt | — | — |
| Sony A7M3 | Sony | ILCE-7M3 | unbekannt | — | — |
| Nikon D7100 | Nikon | D7100 | unbekannt | — | — |
| Fuji X-Pro1 | Fujifilm | X-Pro1 | unbekannt | — | — |
| Olympus E-M5 | Olympus | E-M5 | unbekannt | — | — |
| Panasonic G9 | Panasonic | DC-G9 | unbekannt | — | — |

**Ich werde im Setup-Step der Iteration die Lens-Werte aus libraw-Metadata extrahieren** und passende Profile auf Basis von realistischen Lensfun-Werten in das JSON eintragen. Tests verifizieren, dass das Lookup für die Korpus-Files matcht.

## Tests

`tests/lensProfile.test.ts` (neu, ~6 Tests):
- exakter Match (case-insensitive)
- Substring in modelMatch (Sony A7M3 → "ILCE-7" matcht)
- kein make/model/lens → entsprechender reason
- mehrere Profile mit gleichem Make → erstes Match gewinnt
- leere Profile-Liste → null

`tests/store.test.ts` (erweitern):
- `setLensProfile`, `manualLensOverride`-flag
- `setLensCorrection` setzt `manualLensOverride=true`
- `resetGeometry` setzt `manualLensOverride=false` und `lensProfileId=null`

`e2e/raw-pipeline.spec.ts` (erweitern):
- pro Format: Lens-Profil-Status angezeigt (entweder "auto:<id>" oder "manuell")

## Akzeptanzkriterien

1. `findLensProfile` funktioniert deterministisch.
2. Beim Bild-Open mit erkanntem Lens werden Slider automatisch gesetzt.
3. User-Override schaltet auf manuell.
4. Tests grün (~125 Vitest, ~16 E2E).

## Risiken

- **Lens-Namen-Variabilität:** EXIF-Lens-Strings sind nicht standardisiert (Canon: "EF-S18-55mm f/3.5-5.6 IS STM", Sony: "FE 24-70mm F2.8 GM"). Substring-Match ist defensiv, aber nicht perfekt. Bei False-Positive: User override.
- **k1-Genauigkeit:** Echte Lensfun-Profile haben pro Brennweite + Blende eigene Werte. Wir nehmen einen typischen Wert für die Wide-Angle-Stellung (worst-case Distortion). Genauer geht später.
