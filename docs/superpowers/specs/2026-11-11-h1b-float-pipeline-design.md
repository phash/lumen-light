# H1b · 16-bit-RAW-Dekodierung in eine Half-Float-Textur

Stand: 2026-11-11 · Roadmap: `docs/06-roadmap.md`, Phase H, Item H1b.
Vorgänger: `2026-11-11-h1-scene-referred-tonemapping-design.md` (Abschnitt
„Ehrliche Grenze").

Auftrag ohne Rückfragen umgesetzt. Entscheidungen, die nicht offensichtlich
sind, sind als **(meine Entscheidung)** markiert.

## Intent

Die Quelltextur ist heute 8 bit: `raw.ts` dekodiert mit libraw-wasm in 8 bit,
`webgl.ts` lädt `RGBA/UNSIGNED_BYTE` und rechnet große Quellen über ein
2D-Canvas (8 bit) herunter. Wer Belichtung oder Tiefen stark anhebt, zieht
die 256 Stufen auseinander und sieht Banding in Himmeln und Schatten.

H1b bringt RAW-Pixel mit 16 bit bis in den Shader. JPEG/PNG bleiben auf dem
8-bit-Pfad (die Quelle hat ohnehin nur 8 bit).

## Ehrliche Grenze

libraw liefert auch in 16 bit ein **display-kodiertes, bei Weiß geklemmtes**
Bild (gleiche Gamma-Kurve wie in 8 bit, 8 bit = 16 bit >> 8, auf dem Korpus
nachgemessen). Der Gewinn ist **Präzision** (feinere Stufen, weniger
Banding), **kein Headroom** über Sensor-Weiß. Ausgefressene Lichter bleiben
ausgefressen. Echter Headroom bräuchte linearen Output ohne Klemmung
(`gamm`, `highlight`, eigene Weißpunkt-Logik) und ist nicht Teil von H1b.

## Befund beim Umsetzen: libraw-Optionen wurden nie angewandt

`raw.ts` übergab `use_camera_wb`, `output_color`, `output_bps`,
`no_auto_bright` (snake_case). libraw-wasm 1.6 liest ausschließlich
camelCase-Schlüssel (`useCameraWb`, `outputBps`, `noAutoBright`, …; im
`libraw.wasm` stehen nur diese Strings). Gemessen auf ARW und CR3: das
Ergebnis mit den snake_case-Optionen ist bitgleich zu `{}`, mit den
camelCase-Optionen deutlich anders. Effektiv lief also immer: kein
Kamera-Weißabgleich (Tageslicht-Multiplikatoren), **Auto-Helligkeit an**,
sRGB, 8 bit.

**(meine Entscheidung)** H1b ändert daran nichts außer `outputBps: 16`. Der
heutige Look bleibt, wie er ist; die toten snake_case-Schlüssel fliegen raus
und ein Kommentar dokumentiert den Ist-Zustand. Kamera-WB und Auto-Helligkeit
aus wären eine sichtbare Änderung jedes RAWs und brauchen eine eigene
Entscheidung (Kandidat: an eine neue Prozessversion koppeln, damit
bestehende Bearbeitungen gleich bleiben). Steht als offener Punkt in der
Roadmap.

## Goals

- RAW-Dateien dekodieren in 16 bit (`outputBps: 16`, `Uint16Array`,
  `width × height × 3` Elemente, native Byte-Reihenfolge — gemessen).
- Die Live-Vorschau, der Full-Res-Export und das Vorschaubild (nutzt die
  Live-Textur) bekommen die 16-bit-Daten als Half-Float-Textur (`RGB16F`,
  in WebGL2 ohne Erweiterung filterbar).
- Shader-Semantik bleibt: die Textur liefert weiter sRGB-kodiert 0..1
  (`v16 / 65535`). Kein Shader-Code ändert sich, der PV1-Snapshot bleibt.
- PV1 und PV2 bei Default-Reglern sehen gleich aus wie im 8-bit-Pfad:
  mittlere Abweichung < 0.02, max < 0.06 (sRGB 0..1), gemessen.
- Banding bei +3 EV in den Tiefen messbar geringer (synthetische Rampe,
  Unit-Test).
- Fallback auf den 8-bit-Pfad, wenn es eng wird (siehe unten).

## Non-Goals

- Headroom über Weiß / linearer libraw-Output.
- Kamera-WB / Auto-Helligkeit korrigieren (siehe Befund).
- 16 bit für JPEG/PNG/TIFF (Browser-Decoder liefern 8 bit).
- 16-bit-Export-Dateien (PNG16/TIFF). Export bleibt 8-bit-JPEG/PNG; der
  Gewinn steckt in der Verarbeitung vor der Quantisierung.
- Analyse-Funktionen umbauen: Histogramm, Auto-Ton, Auto-WB, WB-Pipette,
  Auto-Gerade, Smart-Suggestion und Face-Detection lesen schon heute das
  **gerenderte 8-bit-Canvas**, nicht die Quelle. Sie bleiben unverändert.

## Anti-Goals (Fehlschlag, auch wenn es technisch läuft)

- Ein RAW sieht nach dem Deploy anders aus (über die Kriterien oben hinaus).
- Ein Gerät, das heute RAWs öffnen kann, kann es danach nicht mehr
  (Speicher, fehlende Formate) — es muss still auf 8 bit zurückfallen.
- Ladezeit eines 24-MP-RAWs steigt spürbar (> 300 ms für Konvertierung und
  Verkleinerung zusammen auf einem Desktop).

## Entscheidungen

1. **Half-Float statt `UNSIGNED_SHORT`** **(meine Entscheidung)**. WebGL2
   hat für 16-bit-Integer nur `RGB16UI` (nicht filterbar, bräuchte
   `usampler2D` und Shader-Änderungen) oder `EXT_texture_norm16` (nicht
   überall). `RGB16F` ist Kern und filterbar. Die 11 bit Mantisse sind
   unterhalb ~0.016 feiner als 16-bit-Integer, darüber gröber, aber selbst
   knapp unter 1.0 noch 8× feiner als 8 bit (Stufe 2^-11 statt 1/255) —
   und die Tiefen, wo Banding entsteht, sind genau der feine Bereich. Konvertierung per 64k-LUT
   (`unorm16 → half`), korrekt gerundet (round-to-nearest-even).
2. **`RGB16F` statt `RGBA16F`** **(meine Entscheidung)**: ein Viertel weniger
   CPU-Puffer, Alpha liefert der Sampler als 1.0. Treiber legen intern ggf.
   RGBA an — die GPU-Rechnung unten nimmt deshalb RGBA an.
3. **Streifenweiser Upload** (`texStorage2D` + `texSubImage2D` in
   Streifen à 256 Zeilen): die Half-Konvertierung braucht nur einen
   Streifenpuffer statt einer zweiten Vollbild-Kopie.
4. **Quelle bleibt `Uint16Array` (unorm16)** im Canvas für Export und
   Kontext-Wiederherstellung; Half wird pro Upload erzeugt.
5. **Vorschau-Verkleinerung auf der CPU** per Flächen-Box-Filter (exakte
   Bruchteil-Gewichte, reine Funktion `boxDownscaleRgb16`), weil das
   2D-Canvas nur 8 bit kann.

## Speicher

| Posten (24 MP, 6000 × 4000) | 8 bit (heute) | 16 bit (H1b) |
|---|---|---|
| Dekodierter Puffer (CPU, gehalten für Export) | 72 MB RGB → 96 MB Bitmap | 144 MB `Uint16Array` |
| Live-Textur (1600 px breit) | ~7 MB RGBA8 | ~14 MB (RGBA16F-Annahme) |
| Export-Textur (temporär) | 96 MB RGBA8 | ~192 MB (RGBA16F-Annahme) |
| Streifenpuffer beim Upload | – | ~9 MB |

## Fallback-Regeln

- `navigator.deviceMemory` vorhanden und < 4 → RAW wird direkt in 8 bit
  dekodiert (alter Pfad, `ImageBitmap`).
- Half-Float-Upload schlägt fehl (`gl.getError()` ≠ `NO_ERROR` nach
  `texStorage2D`/Upload, z. B. `OUT_OF_MEMORY`, oder eine Exception) →
  dieselben 16-bit-Daten werden als `RGB8` (`v >> 8`) hochgeladen. Gilt für
  Live-Vorschau und Export getrennt. Scheitert auch das, bleibt der
  bisherige Fehlerweg.
- Welche Präzision aktiv ist, steht am Canvas als
  `data-source-precision="float16" | "8bit"` (für E2E/Debug, kein UI).

## Tests

- `float16.ts`: Half-Bits für Grenzwerte (0, 1, 65535 → 0x3C00, Subnormale,
  Rundung), Roundtrip-Fehler ≤ halbe Half-Stufe über alle 65536 Werte,
  Monotonie.
- `rawPixels.ts`: Box-Verkleinerung (Mittelwert, Bruchteil-Gewichte,
  Identität, konstante Fläche bleibt konstant), `>> 8`-Ableitung,
  Bit-Tiefen-Wahl nach `deviceMemory`.
- Banding: synthetische Rampe in den Tiefen, +3 EV durch `toneStage` (PV1
  und PV2), Zahl der unterscheidbaren 8-bit-Ausgangsstufen und größter
  Sprung zwischen Nachbarn, 8-bit- gegen Half-Quelle.
- Upload-Fallback mit einer Fake-GL: `OUT_OF_MEMORY` → `RGB8`.
- `decodeRaw`: 16-bit-Optionen, Längenprüfung, `dispose` bleibt.
- Canvas: `loadRgb16` lädt Vorschau, Export nutzt dieselbe Quelle.
- GPU-Gegenprobe einmalig in Headless-Chromium/SwiftShader auf dem
  RAW-Korpus (8-bit- gegen 16-bit-Pfad, PV1/PV2 Default).

## Messergebnisse (2026-11-11)

GPU-Gegenprobe mit dem echten `Renderer` in Headless-Chromium/SwiftShader
auf allen 7 Korpus-RAWs (ARW, CR3, CR2, NEF, RAF, ORF, RW2; Harness
temporär, nicht im Repo). Überall `float16` für Vorschau und Export.

- **libraw 16 bit**: `Uint16Array`, `w×h×3`; `8 bit == 16 bit >> 8` für
  100 % der Werte auf allen 7 Dateien. Dekodierzeit 16 bit ≈ 8 bit
  (Demosaicing dominiert).
- **Präzisionsänderung allein** (Export-Pfad volle Auflösung bzw. Vorschau
  mit gleichem Filter, PV1 und PV2 Default): mittlere Abweichung
  0.0005–0.0014, **max 0.0039 (= eine 8-bit-Stufe)**. Kriterium erfüllt.
- **Live-Vorschau gegen den alten Pfad**: mittlere Abweichung 0.002–0.0056
  (erfüllt), max 0.078–0.133 (**verfehlt das 0.06-Kriterium**), 99.9-
  Perzentil ≤ 0.051, Anteil der Kanalwerte ≥ 0.06: 2·10⁻⁶ bis 3·10⁻⁴.
  Ursache ist ausschließlich der Verkleinerungsfilter (Browser-`drawImage`
  „high" vs. Flächen-Box-Filter) an harten Kanten — mit gleichem Filter
  verschwindet die Abweichung (s. o.). **(meine Entscheidung)** akzeptiert:
  betrifft nur die 1600-px-Vorschau und das daraus gerenderte
  Vorschaubild, nicht den Export; der Box-Filter ist der korrektere
  (aliasfreie) Filter.
- **Banding** (Kamm-Lücken im G-Histogramm der Vorschau, +3 EV):
  PV1 109–152 → 0–3 Lücken, PV2 5–62 → 0–1. Synthetische Rampe
  (Unit-Test, `toneStage`): 21 → 69 Ausgangsstufen, größter Sprung
  8 → 1 Stufe.
- **Zeit**: Half-Konvertierung 24 MP ≈ 100 ms (Node, LUT, auch
  streifenweise); Box-Verkleinerung 6000×4000 → 1600×1067 ≈ 175–195 ms
  (Node), 144–504 ms in Chromium mit SwiftShader (CPU-GL, streut);
  Vorschau-Load gesamt 206–359 ms, Full-Res-Export-Upload 312–715 ms
  (SwiftShader). Dafür entfällt im 16-bit-Pfad die RGB→RGBA-Schleife
  (`rgbToImageBitmap`, 24 MP) des alten Pfads.
- **Nicht gelaufen**: Playwright-E2E (`raw-pipeline.spec.ts`,
  `editor.spec.ts`) — Keycloak, Backend und Vite liefen lokal nicht.
