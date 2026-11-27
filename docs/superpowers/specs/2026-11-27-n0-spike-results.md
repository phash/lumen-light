# N0 · Spike-Ergebnis (Go/No-Go)

Stand: 2026-11-27 · Branch `feat/desktop-native` (nicht gepusht).
Spec: `docs/superpowers/specs/2026-11-27-desktop-native-rust-design.md`, Abschnitt „N0 · Spike“.
Plan: `docs/superpowers/plans/2026-11-27-n0-desktop-spike.md`.

## Ergebnis in Kürze

| # | Prüfung | Messwert | Ziel / Abbruch | Urteil |
|---|---|---|---|---|
| S1 | egui-Prototyp: Raster 5 000 Kacheln + Tasten, 10 Slider, Kurve, Crop | gebaut in ~30 min Agenten-Wandzeit (Schätzung Mensch ½–1 Tag); Raster 60 fps, UI ~1 ms CPU/Frame | > 3 Tage oder unbrauchbar | **grün** (Handtest offen) |
| S2 | WGSL-Port PV1/PV2-Ton, Belichtung, WB gegen Goldens | max. Kanalabweichung **1/255** (48 Sets, 4 Wege); ΔE2000 mittel ≤ 0,08, Einzelpixel-Maximum 1,25 | > 2/255 bzw. ΔE2000 > 1 | **grün\*** (mittleres ΔE ≤ 0,08; per Pixel max 1,25 > 1, Lesart offen für Manuel) |
| S3 | LibRaw nativ: Zeit und Gleichheit zu libraw-wasm | Z6III-NEF: Vorschau 4 ms, `half_size` **433 ms**, voll **1 757 ms**; Parität MAE ≤ 6/65535; HE/HE★ ungetestet | `half_size` > 1 s, voll > 1,5 s ohne Ausweg, Look weicht ab, verlustfreies NEF geht nicht | **gelb** (voller Decode verfehlt das Ziel um 17 %, Ausweg plausibel, ungemessen) |
| S4 | wgpu auf radv, anv, lavapipe, DX12-WARP | alle vier Wege 48/48 Sets, max 1/255 | Pipeline läuft auf einem Weg nicht | **grün** |
| S5 | Slider-Frame auf dem Proxy (680M) | 1,15 ms p50 / 1,28 ms p95 (Wandzeit inkl. Submit); im Fenster 1 Refresh (16,7 ms @ 60 Hz), Arbeit 0,3–0,7 ms | > 8 ms | **grün** |

**Empfehlung: Go für N1, unter der Bedingung, dass N2 als ersten Schritt
LibRaw mit OpenMP baut und den vollen Decode des Z6III-NEF neu misst.**
Bei der engen Lesart von S2 (ΔE2000 je Pixel ≤ 1, Maximum 1,25) wäre S2 rot, nicht
grün; die Empfehlung gilt mit der Lesart „mittleres ΔE je Set“.
Nach der Spec-Regel ist das kein automatisches Go: S3 ist nicht grün. Die
Entscheidung liegt bei Manuel (siehe „Was Manuel entscheiden muss“).

## Rechner und Adapter

| Rechner | CPU | GPU / Adapter | Treiber |
|---|---|---|---|
| CachyTop (Referenz) | AMD Ryzen 7 7735HS (8C/16T) | Radeon 680M, Vulkan (radv REMBRANDT) | Mesa 26.3.1 |
| testbox | Intel i5-9400 (6C) | UHD 630, Vulkan (anv) | Mesa 26.0.8 |
| testbox | – | llvmpipe, Vulkan (lavapipe, LLVM 21.1.8) | Mesa 26.0.8 |
| Win11-VM (tb-win, 25H2) | 4 GB VM | DX12, Microsoft Basic Render Driver (WARP, CPU) | 10.0.26100.5074 |

Builds liefen auf testbox (tb-run). Die radv-Läufe nutzen dort gebaute
Release-Binaries (glibc 2.43 → 2.44 auf CachyTop läuft). Windows: Cross-Build
mit cargo-xwin (`x86_64-pc-windows-msvc`), LibRaw per clang-cl.

## S1 · egui-Prototyp

Code: `desktop/spikes/ui-proto/` (eigener Workspace, Wegwerf, nicht in `make ci`),
eframe 0.37.0 auf wgpu 30.0.2.

- **Raster**: 5 000 Kacheln, virtualisiert; Pfeile, P/X/U, 0–5, G/D. Fake-Thumbnails aus 3 Worker-Threads.
- **Editor**: Half-Decode → Proxy 2560 → `Developer::render` in eine native Textur, die egui direkt anzeigt (`register_native_texture`, keine CPU-Kopie).
- **Kurve** (Drag-Punkte) und **Crop** (8 Griffe, Drittel-Linien) sind nur UI ohne Bildwirkung, so war es für den Spike vorgesehen.
- Screenshots: `docs/screenshots/n0-grid.png`, `docs/screenshots/n0-editor.png`, `docs/screenshots/n0-curve-crop.png` (auf 256 Farben quantisiert).

| Lauf (CachyTop) | Slider→present p50 / p95 | davon Event→Submit p50 | Raster schnell FPS p50 / min |
|---|---|---|---|
| Wayland vsync | 16,70 / 17,25 ms | 0,67 ms | 60 / 56 |
| Wayland lowlat | 16,70 / 17,29 ms | 0,74 ms | 60 / 58 |
| X11 vsync | 16,71 / 17,72 ms | 0,30 ms | 60 / 57 |
| X11 novsync | 1,92 / 2,19 ms | 0,52 ms | 1 026 / 585 |
| testbox Xvfb (llvmpipe) | 43,4 / 51,9 ms | 30,8 ms | 50 / 32 |

Gemessen wird vom simulierten Input-Event bis nach `present`, nicht bis zum
Photon. Mit vsync ist das genau ein Refresh, kein Slider-Frame lag über 33 ms.
Das Fenster lief auf dem eingebauten 60-Hz-Panel, der 120-Hz-Monitor ist
ungemessen.

**Farbprüfung im Fenster**: `Nikon_D7100/neutral-pv2` 1:1 angezeigt, per Screenshot
gegen das Golden verglichen: max 1/255, 0 Pixel > 2 (Wayland und X11, `Rgba8Unorm`
bzw. `Bgra8Unorm`-Surface). Das gilt nur mit nicht-sRGB-Textur und abgeschaltetem Dithering.

**AccessKit**: 10 `Role::Slider` mit `labelled_by` auf die deutschen Labels
(„Belichtung“, „Weiß“, „Tönung“ …). Was Orca vorliest, ist nicht geprüft.

**Aufwand**: etwa 30 min Agenten-Wandzeit, ~1 900 Zeilen. Kein Kampf mit egui.
Was es kostet:

- Jedes Spezial-Widget (Crop-Griffe, Kurve) ist Eigenbau aus `interact`-Rechtecken.
- Das Raster-Fokusmodell liegt neben dem egui-eigenen.
- Eigene Widgets brauchen `widget_info` für AccessKit.
- Die API bricht pro Minor (0.37: `App::ui`, `Panel::left`).
- Unter Wayland läuft `ui()` nicht, solange der Compositor keine Frame-Callbacks schickt (z. B. Bildschirm aus).
- ★ ⚑ ✖ erscheinen ohne eingebettete Symbolschrift als Tofu.

Kurve, Crop-Griffe und Tasten hat noch kein Mensch von Hand bedient.

## S2 · WGSL gegen Goldens

Goldens: Playwright rendert sie aus dem heutigen WebGL-Renderer (`frontend/golden`,
`pnpm golden`) nach `tests-fixtures/goldens/`. Sie sind deterministisch
(zwei Läufe byte-gleich). Nach Ruling R7 gibt es für Nikon_D7100 und
Nikon_1_S2_portrait (Hochformat) alle 23 Sets, für die übrigen 6 Fixtures
`neutral-pv2`, `neutral-pv1` und `combo-pv2`. Das sind 48 Spike-Sets, ~34 MB.

Port: `desktop/crates/lumen-gpu/src/shaders/develop.wgsl`, folgt 1:1 `shaders.ts` für
sRGB→linear, WB, Belichtung, `toneProcessV1`/`toneProcessV2` und den Abschluss-Clamp.
Die übrigen Stufen sind als `// N2:` markiert. Die HSL-Rundreise bei Sättigung/Dynamik 0
ist ausgelassen, weil sie auf [0,1] die Identität ist.

| Weg | Sets | max \|Δ\| (8 bit) | Pixel > 2 | ΔE2000 mittel (max über Sets) | ΔE2000 Einzelpixel max |
|---|---|---|---|---|---|
| anv (UHD 630) | 48/48 | 1 | 0 | 0,0054 | 1,22 |
| lavapipe | 48/48 | 1 | 0 | 0,0005 | 1,18 |
| radv (680M) | 48/48 | 1 | 0 | 0,081 | 1,25 |
| DX12-WARP | 48/48 | 1 | 0 | ≤ 0,0015 | 1,18 |

Die Werte je Fixture und Set stehen im Task-3-Bericht. Lesart des Abbruchkriteriums: Das
Kriterium „ΔE2000 > 1“ lese ich als **mittleres** ΔE je Set (die Global Constraints
nennen „Ziel < 1,0“ zusätzlich zur Kanal-Toleranz). Das Einzelpixel-Maximum von
bis zu 1,25 kommt von einzelnen Pixeln mit genau 1 Stufe Abstand in dunklen,
gesättigten Tönen. Dort entspricht 1/255 schon ΔE ≈ 1, das ist
Quantisierung, kein Rechenfehler. Wer das Kriterium pro Pixel liest, müsste S2
rot nennen, obwohl kein Pixel um mehr als eine 8-bit-Stufe abweicht.

## S3 · LibRaw nativ

LibRaw 0.22.3 (Submodule, CDDL), statisch per `cc`, ohne zlib/libjpeg/LCMS.
Einstellungen wie `RAW_DECODE_SETTINGS`. libraw-wasm im Web ist 0.22.1.

**Parität zu libraw-wasm** (`box_downscale(decode(Full), 512)` gegen `source.rgb16` der Goldens):

| Fixture | MAE (16 bit) | max \|Δ\| | Kanalmittel rel. |
|---|---|---|---|
| Canon_EOS_600D.CR2 | 0,1 | 1 270 | 0,000 % |
| Canon_EOS_R.CR3 | 6,0 | 32 | 0,017 % |
| Sony_A7M3.ARW | 0,0 | 111 | 0,000 % |
| Nikon_D7100.NEF | 0,0 | 25 | 0,000 % |
| Fujifilm_X-Pro1.RAF | 0,6 | 254 | ≤ 0,001 % |
| Olympus_E-M5.ORF | 0,0 | 93 | 0,000 % |
| Panasonic_DC-G9.RW2 | 0,0 | 67 | 0,000 % |
| Nikon_1_S2_portrait.NEF | 0,0 | 82 | 0,000 % (Hochformat, nativ gedreht) |

Grenzen: MAE ≤ 256 und Kanalmittel ≤ 0,5 %, alle weit drin. Unter Windows (MSVC)
ist die MAE für alle 3 kopierten Fixtures 0,0. Der Look weicht also nicht ab.

**Decode-Zeiten** (Median, `lumen-bench`, Datei im Cache):

| Datei | MP | 680M: Vorschau / half / voll (ms) | UHD 630: Vorschau / half / voll (ms) |
|---|---|---|---|
| **_DSC8548.NEF (Z6III)** | 24,5 | **4,2 / 433 / 1 757** | 3,9 / 701 / 2 405 |
| _DSC8549.NEF (Z6III) | 24,5 | 4,8 / 442 / 1 700 | 3,8 / 693 / 2 408 |
| Nikon_D7100.NEF | 24,3 | 3,9 / 409 / 1 769 | 4,9 / 657 / 2 375 |
| N72_0450_3961.NEF | 24,2 | 5,3 / 414 / 1 581 | 3,6 / 596 / 2 335 |
| N72_0451_3962.NEF | 24,2 | 4,5 / 536 / 1 688 | 3,9 / 649 / 2 357 |
| Sony_A7M3.ARW | 24,2 | 3,2 / 216 / 1 408 | 3,2 / 353 / 2 064 |
| Panasonic_DC-G9.RW2 | 20,4 | 10,7 / 281 / 1 266 | 3,0 / 435 / 1 911 |
| 20130127_0383.CR2 | 18,0 | 6,1 / 503 / 1 297 | 3,3 / 621 / 2 119 |
| 20130127_0417.CR2 | 18,0 | 3,6 / 341 / 1 226 | 3,1 / 536 / 1 932 |
| Canon_EOS_600D.CR2 | 18,0 | 3,2 / 353 / 1 226 | 3,1 / 522 / 1 954 |
| Fujifilm_X-Pro1.RAF | 16,3 | 3,7 / 168 / **8 670** | 3,2 / 210 / 8 648 |
| Olympus_E-M5.ORF | 16,1 | 2,9 / 374 / 1 159 | 2,1 / 540 / 1 693 |
| Nikon_1_S2_portrait.NEF | 14,2 | 3,3 / 274 / 936 | 2,5 / 366 / 1 521 |
| Canon_EOS_R.CR3 | 11,8 | 1,8 / 169 / 687 | 1,1 / 218 / 1 069 |

680M: 3 Läufe, UHD 630: 5 Läufe. testbox ist 1,3–1,6× langsamer als CachyTop,
also innerhalb der erlaubten 2–3×.

**Z6III**: `_DSC8548.NEF` und `_DSC8549.NEF` sind Manuels Dateien (NIKON Z6_3,
Firmware 02.00, 31 MB, 14 bit, Kompression „Nikon NEF komprimiert“). Größe und
Bittiefe sprechen für **verlustfrei komprimiert**, HE wäre etwa halb so groß. Belegt
ist das nicht, Manuel sollte es an der Kamera bestätigen. Sie laufen unter
Originalnamen und stehen nicht im Manifest (Ruling R8). Die Dateien
`Nikon_Z6III_lossless.NEF`, `Nikon_Z6III_HE.NEF` und `Nikon_Z6III_HEstar.NEF`
fehlen noch.

**HE/HE★**: ungetestet, es gibt keine Datei. Der Fehlerpfad ist abgesichert:
Abgeschnittene Dateien und JPEGs ergeben `RawError::Unsupported`, nicht
unterstützte Formate laufen auf denselben Pfad. Laut Spec ist ein Fehlschlag
hier kein Abbruch, sondern eine Einschränkung auf verlustfreie NEFs.

### Bewertung des vollen Decodes (1 757 ms statt < 1,5 s)

Das Ziel ist um 257 ms (17 %) verfehlt, bei allen 24-MP-Dateien (1,4–1,8 s).
Das Abbruchkriterium lautet „> 1,5 s **ohne Ausweg**“. Die Auswege im Einzelnen:

1. **Hintergrund nach `half_size`** (so steht es schon im Spec-Design): Nach
   433 ms ist das Bild bearbeitbar, der volle Decode braucht man erst für 1:1-Zoom
   und Export. Für Sichten und Regeln merkt der Nutzer die 1,76 s nicht. Spürbar
   bleibt es bei sofortigem 1:1-Zoom nach dem Öffnen und beim Export: Das Ziel „Export
   Z6III < 3 s“ hätte mit 1,76 s Decode nur noch ~1,2 s für Rendern und JPEG.
   Das allein ist ein Ausweg für das Bedienen, nicht für das Ziel.
2. **LibRaw mit OpenMP** (Spike-Build hat es **nicht** an): `build.rs` setzt
   kein `-fopenmp`. Ohne `_OPENMP` definiert `libraw_types.h` kein
   `LIBRAW_USE_OPENMP`, alles läuft auf einem Kern. LibRaw hat OpenMP-Pragmas
   genau in den teuren Stufen:
   - AHD-Demosaic: `ahd_demosaic.cpp:309`, parallel über Kachelstreifen. AHD ist die Standard-Qualität 3 und das, was libraw-wasm heute macht.
   - X-Trans-Demosaic: `xtrans_demosaic.cpp:182`.
   - `raw2image.cpp:223/278`, `postprocessing_aux.cpp:155ff`.
   - Die Decoder `crx.cpp`, `fuji_compressed.cpp`, `pana8.cpp`.

   Die 7735HS hat 8 Kerne. Selbst wenn nur der Demosaic-Anteil skaliert, liegt
   < 1,5 s nahe. Wie viel der 1,76 s auf AHD entfällt, ist **nicht gemessen**.
   AHD rechnet Kacheln unabhängig, das Ergebnis sollte bit-gleich sein. Das
   bestätigt der Paritätstest, nicht diese Annahme.

   Zu klären sind:
   - libgomp (Linux, statisch oder als Systembibliothek).
   - Unter Windows `/openmp` mit clang-cl, braucht die libomp-Laufzeit; `_MSC_VER` ist bei clang-cl gesetzt, LibRaw schaltet OpenMP dann ein.
   - Thread-Konkurrenz mit Thumbnail-Workern beim Import.
3. **X-Trans (Fuji RAF 8,7 s)**: LibRaws 3-Pass-X-Trans ist teuer. Das betrifft
   Manuel nicht (Z6III). OpenMP hilft auch hier. Ein 1-Pass-Demosaic wäre
   schneller, ändert aber den Look (Anti-Ziel). Vorschlag: Fuji als bekannte
   Einschränkung führen; `half_size` (168 ms) bleibt sofort bearbeitbar.
4. **GPU-Demosaic**: wäre ein eigenes Demosaic, laut Spec Nicht-Ziel in v1 und
   ein Look-Risiko. Nur als späte Option (PV3).

**Urteil S3: gelb.** `half_size` ist grün (433 ms, unter dem Wunschziel 0,5 s),
die Vorschau ist grün (4 ms), der Look stimmt, das (vermutlich) verlustfreie Z6III-NEF geht.
Der volle Decode verfehlt das Ziel. Der Ausweg (Hintergrund + OpenMP) ist
plausibel, aber gemessen ist nur der Hintergrund-Teil.

## S4 · Backends

| Weg | Rechner | Goldens | Sonstiges |
|---|---|---|---|
| radv | CachyTop 680M | 48/48, max 1, 3,0 s | Fenster unter Wayland + X11 |
| anv | testbox UHD 630 | 48/48, max 1 | braucht Nutzer in `render`/`video`, sonst still lavapipe |
| lavapipe | testbox | 48/48, max 1 | ICD `lvp_icd.json` |
| DX12-WARP | Win11-VM | 48/48, max 1, 17,7 s | 8 Testbinaries + Bench Exit 0 |

Windows-Build: LibRaw baut mit clang-cl ohne Änderung. Ein Fix war nötig: Unter
MSVC erzeugt bindgen C-Enums als `i32`, unter Linux als `u32`, deshalb nutzt der
Code den Alias `LibRaw_image_formats`. Ungetestet sind DX12 auf echter GPU,
Vulkan unter Windows und ein Windows-Fenster (egui).

## S5 · Slider-Frame

`lumen-bench`, Proxy 2560 lange Kante, 200 Renders mit wechselnder Belichtung.
Gemessen ist die **Wandzeit** von render + submit + `poll(Wait)`, also eine obere
Schranke. TIMESTAMP_QUERY ist nicht eingebaut.

| Adapter | Proxy | p50 | p95 |
|---|---|---|---|
| 680M (radv) | 1705×2560 | 1,15 ms | 1,28 ms (Einzellauf; 5,96 ms im Gruppenlauf = Ausreißer unter Last) |
| UHD 630 (anv) | 2560×1706 | 5,12 ms | 5,44 ms |
| WARP (VM, CPU) | 2560×1705 | 141 ms | 193 ms (nur Funktion) |

Im egui-Fenster: Event bis Submit 0,3–0,7 ms, bis present ein Refresh (16,7 ms bei 60 Hz).
Der Spike-Shader hat nur die Ton-Grundregler. Mit HSL, Kurve, Masken, Schärfen
und lokalem Kontrast (N2–N5) wird die Zeit wachsen. Bei 1,15 ms ist dafür Faktor 7
Luft bis 8 ms.

## Was Manuel entscheiden muss

1. **Go trotz S3 gelb?** Vorschlag: Go für N1/N2. Erster Schritt in N2: LibRaw mit
   OpenMP (Linux + Windows) bauen, Parität prüfen, Z6III voll neu messen.
   Bleibt es über 1,5 s, entscheidet Manuel neu: Ziel auf „voller Decode < 2 s im
   Hintergrund“ lockern oder Profiling/andere Maßnahmen. Alternative: vor dem Go
   die OpenMP-Messung als kurzen Nachtrag zu N0 (geschätzt 1–2 h).
2. **ΔE-Lesart (S2, offene Frage)**: Wörtlich pro Pixel gelesen ist S2 rot (max 1,25 > 1), als Mittelwert je Set grün (≤ 0,08). Vorschlag: mittleres ΔE je Set < 1 als Kriterium bestätigen. Die Kanal-Toleranz ≤ 2/255 bleibt die harte Grenze.
3. **Z6III-Dateien**: Bestätigen, dass `_DSC8548/8549` verlustfrei sind, und
   je ein HE- und HE★-NEF liefern. Bis dahin ist S3 für HE/HE★ offen.
4. **Fuji/X-Trans** als bekannte Einschränkung (8,7 s voll) akzeptieren?
5. **CI (Ruling R5)**: `ci.sh` liegt im Repo-Root. Branch pushen und
   `tb-ci add phash/lumen-light` erst nach Manuels Freigabe.
6. **Lizenz LibRaw (bis N10 entscheiden)**: CDDL-1.0 oder LGPL-2.1 für das statisch
   gelinkte LibRaw in einem AGPL-3.0-Binary? Laut FSF ist die CDDL GPL-inkompatibel;
   `libraw-sys` deklariert deshalb `LGPL-2.1-only OR CDDL-1.0`, der Rest des Workspace
   `AGPL-3.0-or-later`.
7. Optional: 2 Minuten Kurve, Crop-Griffe und Tasten im Prototyp von Hand
   bedienen (`desktop/spikes/ui-proto`, ohne `--bench`).

## Offene Punkte

### testbox-Umgebung (nachziehen in `~/claude/meinPC/testbox-setup.sh`)

- `libclang-common-21-dev` (bindgen findet sonst `limits.h` nicht).
- `clang-21`, `lld-21`, `llvm-21` (clang-cl, lld-link, llvm-lib unter `/usr/lib/llvm-21/bin`).
- `cargo binstall cargo-xwin` (0.24.2) und `rustup target add x86_64-pc-windows-msvc --toolchain 1.100.0`.
  Der MSVC-CRT/SDK-Cache `~/.cache/cargo-xwin` (1,1 GB) bleibt liegen.
- `usermod -aG render,video manuel`. Danach den `tb-ci`-Dienst (systemd --user) neu starten, sonst sehen CI-Läufe nur lavapipe.
- pnpm 12.23.0 per `npm i -g --prefix ~/.local`. tb-run braucht `~/.local/bin` im PATH, `ci.sh` setzt das selbst.
- Lavapipe-ICD heißt `/usr/share/vulkan/icd.d/lvp_icd.json`.
- Platte zuletzt 82–87 % belegt, nahe der tb-cleanup-Schwelle.

### Aufgeschobene Kleinigkeiten (für N1/N2)

- `lumen-raw`:
  - ENOMEM aus `make_mem_image` wird `Corrupt` statt `OutOfMemory`.
  - `error_for` ohne `debug_assert` gegen SUCCESS.
  - `embedded_preview` liest die ganze Datei. Gemessen 4 ms, also unkritisch.
- Kein libjpeg/zlib nativ: lossy DNG und deflate DNG sind nativ nicht unterstützt (keine im Korpus).
- Tests sind auch ohne Fixtures grün. In CI per Env-Flag „mindestens 1 Fixture geprüft“ erzwingen.
- `lumen-gpu`:
  - `SourceTexture::upload` nutzt `assert!` bei 0×0/Längenfehler → `GpuError`.
  - `render_to_rgba8` nutzt `expect` bei map/poll.
  - Fehlende Golden-PNGs werden still übersprungen (Zähler/Meldung).
  - Layout-Test parst WGSL-Text statt naga-Reflection.
  - Der `ohne_adapter`-Test trifft nur den Early-Return.
- Bench:
  - `megapixels` kommt nur aus Full.
  - `gpu_ms_*` ist Wandzeit statt TIMESTAMP_QUERY.
  - Der Frame-Proxy hängt von der Dateiliste ab.
  - `host.cpu`/`hostname` sind unter Windows leer.
- `install.bat`:
  - Fehlende Golden-Ordner werden nur gelistet.
  - Ein Testbinary mit 0 Tests zählt als gelaufen.
  - Die Existenz der Bench-JSON wird nicht geprüft.
- Ein `rsync --delete` von CachyTop leert `desktop/.win-test/share/` auf testbox. Immer erst rsync, dann `build-windows.sh`.
- Goldens: Der Portrait-Test liest die committete `source.json`.
- UI (für N3/N6):
  - Symbolschrift einbetten (Tofu bei ★ ⚑ ✖).
  - Raster-Kacheln für AccessKit fokussierbar machen.
  - Hintergrundarbeit von `ui()` entkoppeln (Wayland-Pacing).
  - Orca-Lauf.
  - 120-Hz-Messung.
- Ungetestet: DX12 auf echter GPU, Vulkan unter Windows, egui-Fenster unter Windows.
