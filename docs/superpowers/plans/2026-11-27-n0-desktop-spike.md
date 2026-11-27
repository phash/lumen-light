# N0 · Desktop-Spike (Go/No-Go) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mit Zahlen klären, ob der native Weg (egui + wgpu + LibRaw) die
Leistungs- und Look-Ziele trifft. Nebenbei entstehen die dauerhaften
Grundlagen: Golden Images, Cargo-Workspace, `lumen-raw`, ein erster
`lumen-gpu`-Pass und `make ci`.

**Architecture:** Ein Playwright-Harness rendert mit dem heutigen
`webgl.ts`/libraw-wasm Golden Images und friert die dekodierte Quelle ein.
Rust-Seite: `libraw-sys` (vendored, bindgen) → `lumen-raw` (Decode in drei
Stufen) → `lumen-gpu` (wgpu, WGSL-Port der Ton-Grundregler) wird headless
gegen die Goldens getestet. Ein Bench-Binary misst Decode und Frame-Zeit,
ein Wegwerf-egui-Prototyp misst UI-Aufwand und Slider-Latenz im echten
Fenster.

**Tech Stack:** Rust 1.100.0 (testbox-Stand), wgpu, egui/eframe + egui-wgpu,
bindgen + cc, LibRaw (neuester stabiler Tag, laut Recherche 0.22.x), serde,
image (PNG), criterion. TS-Seite: Vite 8, Playwright (Chromium mit SwiftShader).

**Spec:** `docs/superpowers/specs/2026-11-27-desktop-native-rust-design.md`
(Abschnitte „Leistungsziele“, „Architektur“, „Teststrategie“, „N0 · Spike“).

## Global Constraints

- Plattformen: Linux x86_64 (Wayland + X11) und Windows 10/11 x86_64. Kein macOS.
- Testläufe und schwere Builds auf testbox über `tb-run` (rsync nach `~/work/lumen`, Label `lumen:<was> (cachytop)`). Lokal nur Einzelchecks < 30 s. Ausnahme: Messungen auf der 680M (CachyTop) für S1/S5.
- Workspace liegt in `desktop/`, Versionen in `Cargo.toml` exakt gepinnt (`=x.y.z`), `rust-toolchain.toml` pinnt `1.100.0`.
- LibRaw unter CDDL-1.0 nutzen, statisch gelinkt. Kein Code aus darktable/RawTherapee/RapidRAW.
- Decode-Einstellungen = heute `RAW_DECODE_SETTINGS` (`frontend/src/editor/raw.ts:123`): `use_camera_wb=1`, `output_color=1` (sRGB), `output_bps=16`, `auto_bright_thr=0.005`, Auto-Helligkeit an (`no_auto_bright=0`).
- Look-Toleranz gegen Goldens: max. Kanalabweichung ≤ 2/255. ΔE2000 wird zusätzlich berichtet, Ziel < 1,0.
- Leistungsziele (Z6III-NEF, 680M): eingebettete Vorschau < 150 ms; `half_size` bearbeitbar < 1 s; voller Decode < 1,5 s; Slider-Frame GPU < 8 ms auf Proxy 2560.
- Shader-Rechenreihenfolge exakt wie `frontend/src/editor/shaders.ts`.
- Kommentare deutsch ohne Umlaute, Testnamen deutsch ohne Umlaute, UI-Texte mit echten Umlauten.
- Commits Conventional (`feat(desktop): …`), Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- RAW-Fixtures sind nicht im Repo (`scripts/fetch-test-images.sh`). Z6III-NEFs liefert Manuel nach `tests-fixtures/raw-samples/` (`Nikon_Z6III_lossless.NEF`, `Nikon_Z6III_HE.NEF`, `Nikon_Z6III_HEstar.NEF`). Tests überspringen fehlende Dateien mit klarer Meldung, Benchmarks melden sie als „fehlt“.

## Review Focus

1. **Nicht unterstütztes NEF (Z6III HE/HE★)**: LibRaw lehnt die Datei ab. Erwartet: `RawError::Unsupported` mit Formatname, kein Panic, kein Segfault. Test in Task 2.
2. **Kaputte oder abgeschnittene RAW-Datei**: Erwartet: `RawError`, kein Absturz über FFI. Test in Task 2 (erste 64 KB einer echten Datei).
3. **Hochformat (EXIF-Orientierung)**: Bild steht richtig, Breite/Höhe vertauscht. Golden-Set enthält ein Hochformat-Fixture, Test in Task 2 und Task 3.
4. **Kein passender GPU-Adapter**: Erwartet: `GpuError::NoAdapter` mit lesbarer Meldung, kein Panic. Test in Task 3.
5. **Bild größer als Adapter-Texturlimit**: Erwartet: `GpuError::TextureTooLarge { width, height, max }` statt wgpu-Validation-Panic. Test in Task 3.

---

## Dateistruktur

```
frontend/golden/index.html              Harness-Seite (nur fuer Goldens)
frontend/golden/harness.ts              decode -> box-downscale -> Renderer -> readPixels
frontend/golden/sets.ts                 Adjustment-Sets (Single Source, exportiert sets.json)
frontend/vite.golden.config.ts          Vite-Config fuer Harness
frontend/playwright.golden.config.ts    Playwright mit webServer + SwiftShader
frontend/golden-e2e/goldens.spec.ts     erzeugt Dateien in tests-fixtures/goldens/
tests-fixtures/goldens/                 sets.json, <fixture>/source.rgb16, source.json, <set>.png (committed)
desktop/Cargo.toml                      Workspace
desktop/rust-toolchain.toml
desktop/Makefile                        ci: fmt-check clippy test
desktop/crates/libraw-sys/              build.rs (cc + bindgen), vendor/LibRaw (git submodule)
desktop/crates/lumen-raw/src/{lib,decode,thumb,downscale,error}.rs
desktop/crates/lumen-raw/tests/{corpus,source_parity,errors}.rs
desktop/crates/lumen-gpu/src/{lib,device,pipeline,error}.rs
desktop/crates/lumen-gpu/src/shaders/develop.wgsl
desktop/crates/lumen-gpu/tests/goldens.rs
desktop/tools/bench/src/main.rs         Decode- und Frame-Messung -> JSON
desktop/spikes/ui-proto/                Wegwerf-egui-Prototyp (nicht im Workspace-Default)
docs/superpowers/specs/2026-11-xx-n0-spike-results.md
```

---

### Task 1: Golden-Harness (heutiger Renderer als Orakel)

**Files:**
- Create: `frontend/golden/index.html`, `frontend/golden/harness.ts`, `frontend/golden/sets.ts`, `frontend/vite.golden.config.ts`, `frontend/playwright.golden.config.ts`, `frontend/golden-e2e/goldens.spec.ts`
- Create (Ausgabe, committed): `tests-fixtures/goldens/**`
- Modify: `frontend/package.json` (Script `golden`), `.gitignore` (Goldens NICHT ignorieren, Quellen-RAWs weiter ignoriert)

**Interfaces:**
- Produces (Dateiformat, von Task 2 und 3 gelesen):
  - `tests-fixtures/goldens/sets.json`: `[{ "id": string, "spike": boolean, "adjustments": Adjustments }]` (Wire-Format camelCase, wie `defaultAdjustments()`).
  - `tests-fixtures/goldens/<fixture-stem>/source.json`: `{ "width": u32, "height": u32, "srcWidth": u32, "srcHeight": u32, "make": string, "model": string }`.
  - `tests-fixtures/goldens/<fixture-stem>/source.rgb16`: little-endian `u16`, `width*height*3`, Ausgabe von libraw-wasm nach `boxDownscaleRgb16` auf lange Kante **512**.
  - `tests-fixtures/goldens/<fixture-stem>/<set-id>.png`: RGBA8, `width×height`, ohne Crop/Masken.

- [ ] **Step 1: Sets definieren** in `frontend/golden/sets.ts`, Funktion `goldenSets(): GoldenSet[]`, jeweils `{...defaultAdjustments(), …}`:
  - `spike: true` (Ton-Grundregler, für S2): `neutral-pv2`, `neutral-pv1` (`processVersion: 1`), `exposure-p2`, `exposure-m2`, `contrast-p100`, `contrast-m100`, `highlights-m100`, `shadows-p100`, `whites-p100`, `blacks-m100`, `temperature-p100`, `temperature-m100`, `tint-p100`, `combo-pv2` (exposure 0.7, contrast 30, highlights -60, shadows 40, temperature 20), `combo-pv1` (gleich, `processVersion: 1`).
  - `spike: false` (für N2/N5): `vibrance-p100`, `saturation-m100`, `sharpness-max`, `noise-max`, `local-contrast-max`, `highlight-recovery-max`, `hsl-mix` (red hue +50, blue sat -80, green lum +40), `curve-s` (Punkte (0,0),(0.25,0.18),(0.75,0.85),(1,1)).
  - Grenzwerte aus `ADJUSTMENTS` (`min`/`max`) lesen, nicht hart codieren.
- [ ] **Step 2: Harness schreiben** (`harness.ts`): `window.renderGoldens(fixtureUrl: string, sets: GoldenSet[]): Promise<{ source: { width, height, srcWidth, srcHeight, make, model, rgb16Base64 }, pngs: Record<string, string /* dataURL */> }>`. Ablauf: `fetch` → `File` → `decodeRaw(file, { bits: 16 })` → `boxDownscaleRgb16` auf lange Kante 512 → `new Renderer(canvas)` (Canvas im DOM, `preserveDrawingBuffer` wie im Editor) → je Set `renderer.render(adjustments, false)` mit `outputSize` = Quellgröße → `canvas.toDataURL("image/png")`.
- [ ] **Step 3: Playwright-Config** mit `webServer: { command: "pnpm exec vite --config vite.golden.config.ts --port 5199", port: 5199 }`, Chromium-Launch-Args `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`, `workers: 1`. Fixtures werden per Vite `server.fs.allow` aus `../tests-fixtures/raw-samples` geladen.
- [ ] **Step 4: Spec `goldens.spec.ts` schreiben**: Für jedes Fixture aus `tests-fixtures/manifest.json`, das auf der Platte liegt: Harness aufrufen, Dateien schreiben. Test `goldens sind deterministisch`: zweiter Lauf für `Nikon_D7100` erzeugt byte-gleiche PNGs. Test `hochformat fixture hat hoehe groesser breite` für mindestens ein Fixture mit EXIF-Rotation. Gibt es keins im Korpus, ein Hochformat-Fixture von raw.pixls.us in `manifest.json` ergänzen (`format`, `expectedMake`, Datei `*_portrait.*`).
- [ ] **Step 5: Auf testbox laufen lassen**
  Run: `ssh testbox "tb-run 'lumen:goldens (cachytop)' -- bash -lc 'cd ~/work/lumen && ./scripts/fetch-test-images.sh && cd frontend && pnpm i --frozen-lockfile && pnpm exec playwright test -c playwright.golden.config.ts'"`, danach `rsync testbox:work/lumen/tests-fixtures/goldens/ tests-fixtures/goldens/`
  Expected: alle Tests PASS; `tests-fixtures/goldens/` hat `sets.json` + je Fixture `source.*` + 23 PNGs; Gesamtgröße < 15 MB (`du -sh`).
- [ ] **Step 6: Commit** `feat(golden): Golden-Images aus dem WebGL-Renderer als Look-Referenz`

### Task 2: Workspace, `libraw-sys` und `lumen-raw`

**Files:**
- Create: `desktop/Cargo.toml`, `desktop/rust-toolchain.toml`, `desktop/Makefile`, `desktop/.gitignore` (`target/`)
- Create: `desktop/crates/libraw-sys/{Cargo.toml,build.rs,src/lib.rs,wrapper.h}`, Submodule `desktop/crates/libraw-sys/vendor/LibRaw` (github.com/LibRaw/LibRaw, neuester stabiler Tag, im Commit nennen)
- Create: `desktop/crates/lumen-raw/src/{lib.rs,decode.rs,thumb.rs,downscale.rs,error.rs}`
- Test: `desktop/crates/lumen-raw/tests/{corpus.rs,source_parity.rs,errors.rs}`

**Interfaces:**
- Produces:
  - `pub struct Rgb16Image { pub width: u32, pub height: u32, pub data: Vec<u16> /* RGB interleaved */ }`
  - `pub struct RawMeta { pub make: String, pub model: String, pub focal_len: Option<f32>, pub orientation_applied: bool }`
  - `pub enum DecodeMode { Half, Full }`
  - `pub fn decode(path: &Path, mode: DecodeMode) -> Result<(Rgb16Image, RawMeta), RawError>`
  - `pub fn decode_bytes(bytes: &[u8], mode: DecodeMode) -> Result<(Rgb16Image, RawMeta), RawError>`
  - `pub fn embedded_preview(path: &Path) -> Result<Option<EmbeddedPreview>, RawError>`; `pub struct EmbeddedPreview { pub width: u32, pub height: u32, pub jpeg: Vec<u8> }` (nur JPEG-Thumbs, Bitmap-Thumbs → `None`)
  - `pub fn box_downscale(img: &Rgb16Image, max_long_edge: u32) -> Rgb16Image` — gleiche Gewichtung wie `boxDownscaleRgb16` in `frontend/src/editor/rawPixels.ts:86`
  - `pub enum RawError { Io(std::io::Error), Unsupported { detail: String }, Corrupt { code: i32, detail: String }, OutOfMemory }` (thiserror)
  - Test-Helfer: `pub mod testutil { pub fn fixture(name: &str) -> Option<PathBuf> }` (Pfad `../../tests-fixtures/raw-samples/`, `None` + `eprintln!("SKIP …")` wenn fehlt)

- [ ] **Step 1: Workspace anlegen** (members `crates/*`, `tools/*`; `spikes/*` ausgeschlossen), `Makefile` mit `ci: ; cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`. `libraw-sys/build.rs`: LibRaw-Quellen mit `cc` (C++, `-DLIBRAW_NOTHREADS` nicht setzen, `-DUSE_X3FTOOLS` aus, keine zlib/jpeg-Features außer was der Thumb-Pfad braucht) statisch bauen, `bindgen` auf `wrapper.h` (`libraw/libraw.h`), Allowlist `libraw_.*`. Windows: MSVC-Target.
- [ ] **Step 2: Fehlertests schreiben** (`errors.rs`): `leere_datei_gibt_fehler` (0 Bytes → `Err`), `abgeschnittene_datei_gibt_fehler_ohne_absturz` (erste 64 KiB von `Nikon_D7100.NEF` → `Err(Corrupt|Unsupported)`), `jpeg_ist_kein_raw` (`tests-fixtures/test-samples/*.jpg` → `Err(Unsupported)`), `z6iii_he_klar_gemeldet` (falls `Nikon_Z6III_HE.NEF` vorhanden: `Ok` ODER `Err(Unsupported{detail})` mit `detail` nicht leer — beides erlaubt, Ergebnis wird im Spike-Bericht festgehalten; kein Panic).
- [ ] **Step 3: Korpus-Test schreiben** (`corpus.rs`): `jedes_fixture_dekodiert_mit_hersteller_und_modell` liest `tests-fixtures/manifest.json`, je vorhandener Datei `decode(Full)` → `make == expectedMake`, `model.contains(expectedModelContains)`, `data.len() == w*h*3`. `half_size_halbiert_kanten`: `Half` liefert `w,h` = ⌈Full/2⌉ ±1. `hochformat_ist_gedreht`: Hochformat-Fixture aus Task 1 hat `height > width`. `eingebettete_vorschau_ist_jpeg`: für NEF/ARW/CR2 `embedded_preview` → `Some`, beginnt mit `FF D8`.
- [ ] **Step 4: Tests laufen lassen, Fehlschlag sehen**
  Run: `ssh testbox "tb-run 'lumen:raw-test (cachytop)' -- bash -lc 'cd ~/work/lumen/desktop && cargo test -p lumen-raw'"`
  Expected: FAIL (Funktionen fehlen)
- [ ] **Step 5: `decode`, `decode_bytes`, `embedded_preview`, `box_downscale` implementieren.** `libraw_init(0)` → Parameter setzen (Global Constraints) → `libraw_open_buffer` → `libraw_unpack` → `libraw_dcraw_process` → `libraw_dcraw_make_mem_image`; `half_size=1` bei `DecodeMode::Half`; jede Rückgabe ≠ `LIBRAW_SUCCESS` auf `RawError` mappen (`LIBRAW_FILE_UNSUPPORTED` → `Unsupported`, `LIBRAW_UNSUFFICIENT_MEMORY` → `OutOfMemory`, Rest `Corrupt`); `libraw_close` in `Drop` eines RAII-Wrappers. FFI-Aufrufe in `std::panic::catch_unwind`-freier, aber `unsafe`-gekapselter Schicht; keine `unwrap()` auf FFI-Ergebnissen.
- [ ] **Step 6: Paritätstest schreiben** (`source_parity.rs`): `nativer_decode_trifft_libraw_wasm_quelle` — je Fixture mit `tests-fixtures/goldens/<stem>/source.rgb16`: `box_downscale(decode(Full), 512)` gegen die eingefrorene Quelle: gleiche Maße, mittlere absolute Abweichung ≤ 256 (= 1/255 in 16 bit), Abweichung im Mittelwert je Kanal ≤ 0,5 %. Ergebnis je Fixture per `eprintln!` ausgeben (geht in den Spike-Bericht).
- [ ] **Step 7: Alle `lumen-raw`-Tests grün**
  Run: wie Step 4 + `make -C ~/work/lumen/desktop ci`
  Expected: PASS (fehlende Fixtures als SKIP gemeldet)
- [ ] **Step 8: Commit** `feat(desktop): Workspace, libraw-sys und lumen-raw (Decode in Stufen)`

### Task 3: `lumen-gpu` mit WGSL-Port der Ton-Grundregler

**Files:**
- Create: `desktop/crates/lumen-gpu/src/{lib.rs,device.rs,pipeline.rs,error.rs,params.rs}`, `desktop/crates/lumen-gpu/src/shaders/develop.wgsl`
- Test: `desktop/crates/lumen-gpu/tests/goldens.rs`, `desktop/crates/lumen-gpu/tests/errors.rs`

**Interfaces:**
- Consumes: `lumen_raw::Rgb16Image` (Task 2); Golden-Dateiformat (Task 1).
- Produces:
  - `pub struct Gpu { pub device: wgpu::Device, pub queue: wgpu::Queue, pub adapter_info: wgpu::AdapterInfo, pub limits: wgpu::Limits }`
  - `pub fn Gpu::headless() -> Result<Gpu, GpuError>` (fordert `adapter.limits()` an, nicht Default)
  - `pub fn Gpu::from_parts(device, queue, adapter: &wgpu::Adapter) -> Gpu` (für egui-wgpu in Task 5)
  - `pub struct SourceTexture` ; `pub fn SourceTexture::upload(gpu: &Gpu, img: &Rgb16Image) -> Result<SourceTexture, GpuError>` (u16 → `Rgba16Float` auf der CPU umgerechnet, wie `float16.ts`)
  - `pub struct ToneParams { pub process_version: u32, pub exposure: f32, pub contrast: f32, pub highlights: f32, pub shadows: f32, pub whites: f32, pub blacks: f32, pub temperature: f32, pub tint: f32 }` + `impl ToneParams { pub fn from_adjustments_json(v: &serde_json::Value) -> Self }` (übrige Regler bleiben im Spike unberücksichtigt)
  - `pub struct Developer` ; `pub fn Developer::new(gpu: &Gpu, out_format: wgpu::TextureFormat) -> Developer`; `pub fn render(&self, gpu: &Gpu, src: &SourceTexture, p: &ToneParams, target: &wgpu::TextureView, size: (u32, u32))`; `pub fn render_to_rgba8(&self, gpu: &Gpu, src: &SourceTexture, p: &ToneParams) -> Vec<u8>`
  - `pub enum GpuError { NoAdapter, RequestDevice(String), TextureTooLarge { width: u32, height: u32, max: u32 } }`

- [ ] **Step 1: Fehlertests schreiben** (`errors.rs`): `zu_grosse_textur_gibt_fehler` — `SourceTexture::upload` mit `width = limits.max_texture_dimension_2d + 1`, `height = 1` → `Err(TextureTooLarge{..})`. `ohne_adapter_lesbarer_fehler` — `Gpu::headless_with(backends: wgpu::Backends::empty())` → `Err(NoAdapter)`, `to_string()` deutsch und nicht leer.
- [ ] **Step 2: Golden-Test schreiben** (`goldens.rs`): `spike_sets_treffen_goldens` — je Fixture-Ordner in `tests-fixtures/goldens/` und je Set mit `spike: true`: `source.rgb16` laden → `upload` → `render_to_rgba8` → gegen `<set>.png` vergleichen. Assert: `max_kanal_abweichung <= 2`. Zusätzlich je Set Max-Abweichung und mittleres ΔE2000 per `eprintln!`. Hochformat-Fixture ist dabei (Review Focus 3).
- [ ] **Step 3: Tests laufen lassen, Fehlschlag sehen**
  Run: `ssh testbox "tb-run 'lumen:gpu-test (cachytop)' -- bash -lc 'cd ~/work/lumen/desktop && WGPU_BACKEND=vulkan cargo test -p lumen-gpu'"` (testbox: anv; lavapipe zusätzlich mit `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.x86_64.json`)
  Expected: FAIL
- [ ] **Step 4: `develop.wgsl` portieren**: Fullscreen-Triangle + Fragment-Shader. Aus `frontend/src/editor/shaders.ts` genau den Pfad übernehmen, den die Spike-Regler durchlaufen: Quelle lesen → Weißabgleich (`u_temperature`, `u_tint`, Zeile ~286–320) → `toneProcessV1` bzw. PV2-Tonstufe (Konstanten aus `tonemap.ts`, `TONEMAP_GLSL_CONSTANTS`) → Ausgabe sRGB. Reihenfolge, Klemmungen und Konstanten 1:1; alle anderen Stufen (HSL, Kurve, Masken, Linse, Detail) im Spike weglassen und im WGSL als `// N2: …` markieren. Uniforms als ein `#[repr(C)]`-Buffer (bytemuck), Offsets per Test gegen `std140`-Regeln prüfen. Ausgabetextur `Rgba8Unorm` mit derselben sRGB-Kodierung wie WebGL (Shader schreibt sRGB-kodierte Werte, kein `*Srgb`-Format — prüfen gegen Golden `neutral-pv2`).
- [ ] **Step 5: Tests grün auf allen drei Linux-Wegen**
  Run: Step 3 mit anv, mit lavapipe; lokal auf CachyTop `WGPU_BACKEND=vulkan cargo test -p lumen-gpu --release` (radv, < 30 s)
  Expected: PASS; Abweichungstabelle aus der Ausgabe für den Spike-Bericht sichern.
- [ ] **Step 6: Commit** `feat(desktop): lumen-gpu mit WGSL-Port der Ton-Grundregler (gegen Goldens)`

### Task 4: Bench-Binary (S3 + S5 headless)

**Files:**
- Create: `desktop/tools/bench/{Cargo.toml,src/main.rs}`

**Interfaces:**
- Consumes: `lumen_raw::{decode, embedded_preview, DecodeMode}`, `lumen_gpu::{Gpu, SourceTexture, Developer, ToneParams}`.
- Produces: CLI `lumen-bench [--runs N] [--out bench.json] <dateien…>`; JSON `{ host, adapter, files: [{ name, bytes, megapixels, preview_ms, half_ms, full_ms, error? }], frame: { proxy: [w,h], gpu_ms_p50, gpu_ms_p95 } }`.

- [ ] **Step 1: Implementieren.** Je Datei `--runs` (Default 5) Läufe, Median; Datei vorher einmal lesen (Page-Cache warm, wie im echten Blättern). Frame-Messung: Quelle mit `box_downscale` auf lange Kante 2560, 200 Renders mit wechselnder Belichtung, GPU-Zeit per Timestamp-Query (`wgpu::Features::TIMESTAMP_QUERY`, Fallback Wandzeit mit `device.poll(Wait)` und Hinweis im JSON). Fehler einer Datei landen als `error` im JSON, der Lauf geht weiter (Review Focus 1).
- [ ] **Step 2: Laufen lassen** auf CachyTop (`cargo run -p lumen-bench --release -- tests-fixtures/raw-samples/*`, < 30 s pro Lauf, sonst testbox) und testbox (über `tb-run`).
  Expected: JSON für beide Rechner; Z6III-Dateien enthalten, falls geliefert, sonst `error: "fehlt"`.
- [ ] **Step 3: Commit** `feat(desktop): Bench-Binary fuer Decode- und Frame-Zeiten`

### Task 5: egui-Prototyp (S1 + S5 im Fenster) — Wegwerf-Spike

Keine Tests, kein Review-Gate außer „läuft und misst“. Zeitbox **3 Arbeitstage**, Arbeitszeit im Bericht notieren. Code bleibt in `desktop/spikes/ui-proto/` als Referenz, wird nicht weiterentwickelt.

**Files:**
- Create: `desktop/spikes/ui-proto/{Cargo.toml,src/main.rs,…}`

**Interfaces:**
- Consumes: `lumen_gpu::{Gpu::from_parts, SourceTexture, Developer, ToneParams}`, `lumen_raw::decode`.

- [ ] **Step 1: Raster**: 5 000 Fake-Kacheln (farbige Texturen, 400 px), virtualisiert (`ScrollArea::show_rows`), Fokus per Pfeiltasten, `P`/`X`/`U`/`1`–`5` setzen Markierung/Sterne auf der fokussierten Kachel, Anzeige als Overlay.
- [ ] **Step 2: Editor**: Bild aus `decode(Half)` einer echten Datei (CLI-Argument), `Developer` rendert in eine Textur, die egui über `egui_wgpu::Renderer::register_native_texture` zeigt. Sidebar mit 10 Slidern (Belichtung … Tönung), jede Änderung rendert neu.
- [ ] **Step 3: Kurven-Editor** (200×200, Punkte ziehen, hinzufügen per Klick, entfernen per Doppelklick; Kurve als Polyline, Mathematik darf grob sein) und **Crop-Overlay** (Rahmen mit 8 Griffen, Seitenverhältnis frei).
- [ ] **Step 4: Messen**: Slider-zu-Frame-Latenz (Zeitstempel Input-Event → `present`), FPS beim Scrollen des Rasters, auf CachyTop (680M, Wayland und X11) und einmal auf testbox. UI-Texte mit Umlauten prüfen (eingebettete Schrift). Screenshot pro Ansicht nach `docs/screenshots/n0-*.png`.
- [ ] **Step 5: Commit** `chore(desktop): egui-UI-Prototyp fuer Spike N0 (Wegwerf)`

### Task 6: Windows-Check (S4 Windows)

**Files:**
- Create: `desktop/scripts/build-windows.sh` (cargo-xwin, Target `x86_64-pc-windows-msvc`)
- Create: `desktop/.win-test/oem/install.bat`, `desktop/.win-test/share/` (Konvention von `tb-win`)

**Interfaces:**
- Consumes: Testbinärdateien von `lumen-raw` und `lumen-gpu`, `lumen-bench`.

- [ ] **Step 1: Cross-Build** auf testbox: `cargo xwin build --release --target x86_64-pc-windows-msvc -p lumen-bench` und `cargo xwin test --no-run …` für `lumen-raw`/`lumen-gpu`; Binaries + Fixtures (D7100, Sony, goldens) nach `.win-test/share/`. LibRaw muss mit clang-cl bauen; Fehler hier sind ein Spike-Ergebnis, kein Workaround mit MinGW ohne Rücksprache.
- [ ] **Step 2: `install.bat`** führt die Testbinaries und `lumen-bench` aus und schreibt `share/install-result.txt` (Exit-Codes + Ausgaben).
- [ ] **Step 3: Laufen lassen**
  Run: `rsync … && ssh testbox "tb-win run lumen ~/work/lumen/desktop/.win-test --until install-result.txt --timeout 30"`
  Expected: Golden-Test PASS auf DX12 (WARP) bzw. dokumentierter Fehler; Bench-JSON (Zeiten nur informativ, keine GPU in der VM).
- [ ] **Step 4: Commit** `chore(desktop): Windows-Cross-Build und tb-win-Check`

### Task 7: Spike-Bericht, Go/No-Go, CI, Doku

**Files:**
- Create: `docs/superpowers/specs/2026-11-xx-n0-spike-results.md` (Datum = Tag der Fertigstellung)
- Modify: `docs/06-roadmap.md` (neue Phase N mit N0–N10, Status), `CLAUDE.md` (Abschnitt „Desktop (Phase N)“: Workspace, `make -C desktop ci`, Goldens, LibRaw-Submodule `git submodule update --init`, tb-win-Check), `scripts/fetch-test-images.sh` falls Hochformat-Fixture ergänzt

- [ ] **Step 1: Bericht schreiben** mit Tabelle S1–S5 (Messwert, Ziel, grün/rot), Rechnern und Adaptern, Golden-Abweichungen je Set, Decode-Zeiten je Datei, HE/HE★-Ergebnis, UI-Arbeitszeit, Screenshots. Entscheidung nach Spec-Regel: Go, wenn S2–S5 grün und S1 ≤ 3 Tage; No-Go nur wegen S1 → Manuel entscheidet über die Oberfläche neu; jedes andere Rot → mit Messwert und Vorschlag an Manuel.
- [ ] **Step 2: CI registrieren**: `ssh testbox tb-ci add phash/lumen-light` (falls noch nicht), Prüfschritt über Root-`ci.sh`, das `make -C desktop ci` und die bestehenden Frontend/Backend-Gates aufruft. Prüfen: `ssh testbox tb-ci status` zeigt den Branch grün.
- [ ] **Step 3: Commit** `docs(desktop): Ergebnis Spike N0 und Phase N in der Roadmap`
- [ ] **Step 4: Manuel das Ergebnis vorlegen**, nicht selbst über Go/No-Go hinaus weiterbauen.
