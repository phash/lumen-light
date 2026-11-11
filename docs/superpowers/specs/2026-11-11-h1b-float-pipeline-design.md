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
und ein Kommentar dokumentiert den Ist-Zustand. Kamera-WB ist eine sichtbare
Änderung jedes RAWs und wurde getrennt entschieden — siehe „Nachtrag
Kamera-WB" unten.

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
- Kamera-WB / Auto-Helligkeit korrigieren (siehe Befund; nachgezogen im
  „Nachtrag Kamera-WB").
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

## Nachtrag Kamera-WB (2026-11-11, `fix/raw-camera-wb`)

Entscheidung des Owners: sofort und ohne Kompatibilitätspfad korrigieren —
Produktion hatte 0 Bilder und 0 Bearbeitungen, also keine neue
Prozessversion.

`raw.ts` setzt jetzt `RAW_DECODE_SETTINGS` = `{ useCameraWb: true,
outputColor: 1, autoBrightThr: 0.005 }` plus `outputBps` (8 oder 16 — beide
Pfade identisch). Namen geprüft gegen `libraw-wasm` 1.6
(`dist/index.d.ts` und die Embind-Strings in `libraw.wasm`). `useAutoWb`
bleibt aus: fehlt der Kamera-WB in der Datei, rechnet libraw bei
`useCameraWb` selbst einen Auto-WB.

Gemessen auf den 7 Korpus-RAWs, 16 bit, Vergleich mit dem eingebetteten
Kamera-JPEG (`thumbnailData()`), Grey-World-Verhältnisse R/G, B/G und
mittlere Luma (sRGB-kodiert, 0..255), Clipping = Anteil Pixel mit einem
Kanal ≥ 254.5/255:

| RAW | Abstand ΔR/G, ΔB/G alt (Tageslicht) | neu (Kamera-WB) | Luma JPEG / alt / neu | Clipping alt → neu |
|-----|------|------|------|------|
| Canon 600D CR2 | 0.160, 0.091 | 0.003, 0.052 | 109 / 132 / 125 | 1.07 % → 0.77 % |
| Canon R CR3 | 0.081, 0.154 | 0.025, 0.018 | 153 / 140 / 142 | 1.07 % → 0.58 % |
| Fuji X-Pro1 RAF | 0.138, 0.038 | 0.011, 0.134¹ | 131 / 97 / 90 | 1.03 % → 0.87 % |
| Nikon D7100 NEF | 0.166, 0.071 | 0.013, 0.084 | 87 / 78 / 88 | 1.06 % → 0.74 % |
| Olympus E-M5 ORF | 0.082, 0.119 | 0.029, 0.040 | 122 / 124 / 112 | 1.11 % → 0.52 % |
| Panasonic G9 RW2 | 0.485, 0.444 | 0.020, 0.004 | 80 / 45 / 42 | 3.00 % → 1.53 % |
| Sony A7M3 ARW | 0.149, 0.217 | 0.007, 0.015 | 145 / 91 / 85 | 1.07 % → 1.17 % |

¹ Das RAF-JPEG ist zu 36 % ausgefressen, seine Grey-World-Werte sind
verzerrt.

Auto-Helligkeit, verglichene Varianten (alle mit Kamera-WB):

- `noAutoBright`: 600D 63, CR3 83, NEF 50, ORF 64 Luma — rund 1 EV dunkler
  als das JPEG (109/153/87/122). Verworfen.
- `noAutoBright` + `bright: 1.8`: RAF 27.6 % und ARW 3.8 % Clipping,
  CR3/ORF trotzdem 20–25 % dunkler. Ein fester Faktor passt nicht zu allen
  Kameras. Verworfen.
- Auto-Helligkeit mit libraw-Default `autoBrightThr` 0.01: Helligkeit nahe
  am JPEG (600D 139, CR3 146, NEF 90, ORF 118), aber 1.0–1.6 % Clipping
  gegenüber 0–0.07 % im JPEG.
- `autoBrightThr` 0.002: Clipping 0.2–0.3 %, aber ORF fällt auf 95 (−23 %).
- **`autoBrightThr` 0.005 (gewählt)**: Clipping halbiert (0.5–0.8 %),
  Helligkeit −9 % … +15 % gegenüber dem JPEG. libraw klemmt bei Weiß, was
  die Auto-Helligkeit ins Weiß schiebt, holt kein Regler zurück — dunkler
  lässt sich dagegen per Belichtung/Auto-Ton ausgleichen.

Grenze: ARW, RW2 und RAF haben schon ≥ 1 % Sensor-Sättigung, dort greift die
Auto-Helligkeit nicht (alle Varianten ohne `bright` gleich). Diese drei
bleiben 30–50 % dunkler als das Kamera-JPEG, das Belichtungs-Offsets bzw.
DR-Modi der Kamera enthält. Auto-Ton (Belichtung aus dem Median, bis
±1.5 EV) gleicht das auf Knopfdruck aus; Auto-Ton, Auto-WB und Vorschlag
lesen das gerenderte Bild und brauchen keine Anpassung.
