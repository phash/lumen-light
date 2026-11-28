# Lumen Desktop · native Rust-App (egui + wgpu)

Stand: 2026-11-27 · Roadmap: `docs/06-roadmap.md`, neue Phase **N** (Desktop).
Grundlage: Bestandsaufnahme Frontend/Backend, Rust-Ökosystem-Recherche und
Architekturvergleich vom 2026-11-27 (drei Ansätze, siehe „Ansätze“).

## Intent und Warum

Nach der Testphase ist klar: Der Web-Ansatz trägt nicht. Ein RAW (25–60 MB)
muss erst hochgeladen werden, bevor man es sieht. Das macht Sichten und
Bearbeiten eines Shootings zäh.

Lumen wird deshalb eine **Desktop-App für Linux und Windows, komplett in Rust**.
Bilder bleiben auf der eigenen Platte. Öffnen, Sichten und Bearbeiten
fühlen sich sofort an. Der Server schrumpft auf das, was wirklich geteilt
wird: Marketplace, Admin, Feedback und Download der App.

Vorgabe von Manuel: **Unter Linux muss die App sehr performant sein.** Das
war der Grund für den nativen Weg statt Tauri/WebView.

## Ziele

- **Lokale Bilderverwaltung**: Ordner importieren, Katalog in SQLite,
  Raster und Liste mit Vorschaubildern, Sterne 0–5, Farblabels, Markierung
  (pick/reject), Filter und Sortierung, Lupe, Vergleich, 1:1-Zoom,
  Lightroom-Tasten. Das ist Feature-Parität mit H2a–H2d, nur lokal.
- **Editor mit Feature-Parität** zum heutigen Web-Editor: alle Regler, PV1
  und PV2, HSL, Tonkurve, lokaler Kontrast, Lichterrettung, Schärfen,
  Rauschminderung, Crop und Begradigen (auch automatisch), Linse/TCA/Vignette,
  je 4 lineare und 4 radiale Masken, Undo/Redo, Bypass, Vergleichs-Split,
  Auto-Ton, Auto-WB, WB-Pipette, Histogramm.
- **Presets lokal**: 20 Default-Presets mitgeliefert, eigene Presets im
  Katalog, YAML-Import und -Export (`lumenProfile: 1`), Batch-Apply mit den
  8 Schritt-Gruppen aus `edit-groups.json`.
- **Export**: JPEG, PNG, 16-bit-TIFF in voller Auflösung, auch als Stapel.
  Läuft über dieselbe GPU-Pipeline wie die Vorschau.
- **Marketplace ohne Konto**: Presets in der App durchsuchen und herunterladen.
- **Teilen nur mit Konto**: Keycloak-Login über den System-Browser (PKCE),
  dann ein Preset mit Vorschau-JPEG veröffentlichen.
- **Feedback** aus der App ohne Konto.
- **Download-Seite** auf lumen.mr-development.de für Linux und Windows.

## Leistungsziele (Abnahmekriterien)

Referenz ist CachyTop (Radeon 680M, Wayland, NVMe) mit Manuels Kamera
**Nikon Z6III** (24,5 MP, NEF). Die testbox (UHD 630) darf etwa 2–3×
langsamer sein. Ein 45-MP-RAW ist nicht mehr nötig; die Zahlen unten gelten
für ein Z6III-NEF.

| Messpunkt | Ziel |
|---|---|
| Z6III-NEF öffnen, eingebettete Vorschau sichtbar | < 150 ms |
| Z6III-NEF öffnen, bearbeitbar (Stufe 2, `half_size`, Proxy steht) | < 1 s, Ziel < 0,5 s |
| Z6III-NEF, voller Decode fertig (Stufe 3, für 1:1 und Export) | < 1,5 s, im Hintergrund |
| Blättern in der Lupe (Nachbarbilder vorab dekodiert) | ohne sichtbare Wartezeit |
| Slider bewegen bis neues Bild auf dem Schirm | ≤ 1 Frame bei 60 Hz (GPU-Zeit < 8 ms auf dem Proxy) |
| Raster mit 5 000 Bildern öffnen (Cache warm) | < 200 ms, Scrollen 60 fps |
| Erstimport 5 000 RAWs (Vorschaubilder) | Hintergrund, Raster sofort bedienbar, ≤ 3 min |
| Export Z6III (24 MP) als JPEG | < 3 s |

Wenn ein Ziel verfehlt wird, ist das ein Fehler, kein Detail.

## Nicht-Ziele (v1)

- Kein Konto in der App außer zum Teilen. Keine Cloud-Synchronisation von
  Bildern, Edits oder Katalog.
- Keine macOS-Version.
- Keine Stichwörter, Alben, Sammlungen, EXIF-Suche, virtuellen Kopien
  (wie in H2 schon ausgeklammert).
- Kein Import eines Lightroom-Katalogs.
- Keine Gesichtserkennung in v1 (siehe „Entscheidungen des Builders“).
- Keine Web-Version des Editors mehr. Der Web-Editor wird abgelöst.
- Kein eigenes Demosaic und kein neuer „Look“ (PV3) in v1.

## Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Die App ist unter Linux spürbar träge (Slider ruckeln, Öffnen dauert
  Sekunden, Raster ruckelt).
- Bestehende Presets sehen in der Desktop-App anders aus als im Web-Editor.
- Die App ändert Original-RAWs auf der Platte. Originale werden nie
  geschrieben.
- Die App funkt ohne Zutun nach Hause. Netzwerk nur, wenn der Nutzer den
  Marketplace öffnet, teilt, Feedback schickt oder den Update-Check
  eingeschaltet hat.
- Man braucht ein Konto, um die App zu benutzen oder Presets herunterzuladen.

## Rahmenbedingungen

- **Plattformen**: Linux x86_64 (Wayland und X11; CachyOS ist Hauptsystem)
  und Windows 10/11 x86_64.
- **Tests und schwere Builds laufen auf testbox** über `tb-run` (globale
  CLAUDE.md). CI über `tb-ci` (GitHub Actions sind abgeschaltet).
  Windows-Funktionstests über `tb-win`. Die VM hat keine GPU, wgpu läuft
  dort über DX12-WARP: Das taugt für Funktion, nicht für Performance.
- **TDD und Clean Code** nach den MRD-Conventions.
- **Lizenzen**: LibRaw ist dual LGPL-2.1/CDDL-1.0. Wir nutzen es unter
  **LGPL-2.1** (Entscheidung Manuel 2026-11-27): CDDL ist laut FSF GPL-inkompatibel.
  Statisches Linken ist zulaessig, weil der komplette Quelltext offen ist und
  Nutzer neu linken koennen.
  darktable/RawTherapee/RapidRAW (GPL/AGPL): nur Ideen und veröffentlichte
  Algorithmen, kein Code.
- **Kamera und Format**: Nikon Z6III, NEF. Die Z6III kann NEF verlustfrei
  komprimiert, „High Efficiency“ (HE) und „High Efficiency★“ (HE★)
  schreiben. HE/HE★ basieren auf TicoRAW; ob LibRaw 0.22 sie dekodiert, ist
  ungeprüft und ein **Spike-Risiko (S3)**. Fällt es negativ aus, gilt v1 nur
  für verlustfrei komprimierte NEFs, und Manuel stellt die Kamera darauf um.
- **Nur ein Nutzer (Manuel).** Keine Migration von Server-Bildern oder
  -Edits in die App. Eigene Presets vorher als YAML exportieren.
- **Repo**: bleibt `lumen-light`. Die Desktop-App kommt als eigener
  Cargo-Workspace nach `desktop/`.

## Ansätze

Drei Wege wurden ausgearbeitet und von einem Gutachter bewertet.

| Ansatz | Kurz | Stärke | Schwäche |
|---|---|---|---|
| A · Tauri + React/WebGL | Bestehender Editor in einer WebView, Rust-Kern für Dateien, Decode, Katalog | ~85 % Code bleibt, Upload in 1–2 Wochen weg, gleicher Look | Linux hängt an WebGL in WebKitGTK (NVIDIA-DMABUF, Software-Fallback, kopierende IPC). Oberfläche bleibt TS |
| B · Tauri + Rust/wgpu-Pipeline | React-UI, Bild wird nativ gerendert | eine Rust-Pipeline | Jede Slider-Bewegung schickt ein Bild in die WebView. Unter Linux vermutlich träger als heute. 3–5 Monate |
| **C · Native Rust (egui + wgpu)** | Alles neu in Rust, kein WebView | beste Latenz, kein WebKitGTK, eine Pipeline für Vorschau und Export | UI komplett neu (~20 % Wiederverwendung, als Spezifikation). 4–6 Monate. Zwei UI-Stacks (Web bleibt React) |

**Gewählt: C.** Manuel: „es muss unter Linux sehr performant sein.“ A und B
hängen unter Linux an WebKitGTK. Das ist genau das Risiko, das der
Gutachter als Schwachstelle beider Tauri-Wege benannt hat. Den höheren
Aufwand von C nimmt Manuel dafür in Kauf.

## Architektur

### Workspace

```
desktop/
  Cargo.toml                 Workspace, Versionen exakt gepinnt
  crates/
    lumen-core/              rein, kein I/O, kein GPU
    lumen-raw/               RAW-Decode (LibRaw-FFI), eingebettete Vorschau, EXIF
    lumen-gpu/               wgpu-Pipeline (WGSL), Proxy, Histogramm, Export-Render
    lumen-catalog/           SQLite-Katalog, Import, Watcher, Thumbnail-Cache
    lumen-export/            Encoder (JPEG/PNG/TIFF16), ICC
    lumen-net/               Marketplace, Teilen (PKCE), Feedback, Update-Check
  app/lumen/                 eframe-App: Bibliothek, Editor, Dialoge
  tools/                     Referenz-Vektor-Import, Benchmarks
  Makefile                   Ziel `ci` für tb-ci
```

### lumen-core

Alle reinen Module aus `frontend/src/editor` und `frontend/src/library`
werden 1:1 nach Rust portiert. Das sind die Algorithmen, nicht der
TS-Code:

- Adjustments, Masken, Geometrie als serde-Typen, Wire-Format camelCase
  (gleich wie heute, damit Presets und YAML kompatibel bleiben).
- `tonemap` (PV1/PV2, CPU-Referenz von `toneStage`), `tone_curve`
  (monotone Hermite, LUT 256), `transform` (UV vorwärts/rückwärts),
  `lens` (Brown-Conrady, Vignette, TCA), `histogram`, `auto_adjust`,
  `auto_straighten`, `suggest_preset` (ohne Gesichter), `history`
  (Undo/Redo, entprellt 250 ms), `profile_groups` (Merge), `profile_yaml`,
  `library_keys` (Lightroom-Tasten als reiner Reducer), `meta`, `zoom`.
- Datenquellen per `include_str!`: `backend/schemas/adjustments.schema.json`,
  `backend/schemas/edit-groups.json`, `infra/lensfun/profiles.json`.
  Die Dateien wandern in einen gemeinsamen Ort `schemas/` im Repo-Root
  (Builder-Entscheidung, siehe unten), weil das Backend `edit-groups.json`
  nicht mehr braucht.
- `processVersion`-Semantik bleibt exakt: Edit ohne Version = 1, Preset
  ohne Version (`null`) lässt die Version des Bildes stehen, neue Bilder = 2.

### lumen-raw

- **LibRaw 0.22 per FFI**, vendored und statisch gebaut (`cc` + `bindgen`).
  Gleiche Einstellungen wie heute `RAW_DECODE_SETTINGS`: Kamera-WB, sRGB,
  Auto-Helligkeit mit `autoBrightThr` 0.005, 16 bit. Das hält den Look
  bestehender Presets gleich (Anti-Ziel).
- **Öffnen in drei Stufen**:
  1. Eingebettetes JPEG aus dem RAW (`unpack_thumb`), sofort als Textur.
  2. `half_size`-Decode für die bearbeitbare Vorschau. Der Proxy (max. 2560 px)
     ist ohnehin verkleinert; Look-Gleichheit wird gegen den vollen Decode
     gemessen, der Proxy darf nur innerhalb der Golden-Toleranz abweichen.
  3. Voller Decode im Hintergrund für 1:1-Zoom und Export.
- Magic-Byte-Erkennung aus `raw.ts` portiert. JPEG/PNG/TIFF als normale
  Quellen über das `image`-Crate.
- EXIF (Kamera, Objektiv, Brennweite, Orientierung, Aufnahmedatum) über
  LibRaw bzw. `kamadak-exif`.
- rawler bleibt als optionales Cargo-Feature für Vergleiche im Spike.

### lumen-gpu

- wgpu mit Vulkan (Linux) und DX12 (Windows). Adapter-Limits anfordern
  statt Default 8192, sonst kacheln.
- Quelle: 16-bit-RGB aus LibRaw als `Rgba16Float`-Textur (Vollbild) plus
  Proxy-Textur (lange Kante = Anzeigegröße × DPR, max. 2560).
- Der heutige Fragment-Shader aus `shaders.ts` wird nach WGSL portiert,
  **mit exakt der heutigen Rechenreihenfolge** (Look-Gleichheit ist ein
  Anti-Ziel-Kriterium). Heute gilt:
  - Verzeichnung, TCA und Rauschminderung (3×3 bilateral) wirken beim Lesen
    der Quelle, also vor dem Ton.
  - Schärfen (4-Tap) und lokaler Kontrast (5×5-Gauß) werden aus den
    unbearbeiteten Quellpixeln berechnet und auf das getonte Ergebnis gelegt.
  - Lichterrettung kommt nach der Tonkurve, die Vignette ganz am Ende.
  Der Port ist zuerst ein einzelner Pass, der 1:1 dem GLSL folgt. Eine
  Aufteilung in mehrere Passes oder ein Pass-Cache ist nur erlaubt, wo sie
  mathematisch identisch ist und die Goldens weiter treffen.
- **Auflösungsabhängigkeit bleibt wie heute**: Schärfen, Rauschminderung und
  lokaler Kontrast rechnen in Texeln der geladenen Textur. Vorschau-Proxy und
  Export sehen sich dadurch so ähnlich bzw. unähnlich wie heute im Web.
  Auflösungsunabhängige Effekte wären eine Look-Änderung und gehören in ein
  späteres PV3.
- Konstanten (Masken-Limits, HSL-Gains, Tonemap-Pivot/Knee/Tail,
  `DISTORTION_GAIN`, `VIGNETTE_GAIN`) leben einmal in Rust und werden per
  Codegen in das WGSL eingesetzt. Die heutige Klasse von Sync-Fehlern
  entfällt damit.
- Histogramm per Compute-Shader, asynchroner Readback (4 KB).
- egui zeigt die Ausgabetextur direkt (`egui-wgpu`, `register_native_texture`),
  ohne Kopie zur CPU.
- 1:1-Zoom rendert nur den sichtbaren Ausschnitt aus der Vollbild-Textur.
- Export: dieselben Passes in Kacheln auf voller Auflösung, Readback in
  16 bit, dann `lumen-export`.

### lumen-catalog

- **Ein zentraler Katalog** wie bei Lightroom Classic:
  `$XDG_DATA_HOME/lumen/catalog.sqlite` bzw. `%APPDATA%\Lumen\catalog.sqlite`.
  `rusqlite` (bundled), WAL-Modus, Migrationen versioniert.
- Tabellen (Entwurf): `folders`, `images` (Pfad, Größe, mtime, Inhalts-Hash,
  EXIF-Felder, rating, color_label, flag), `edits` (Edit-State als JSON,
  gleiches Format wie heute `image_edits`), `presets` (eigene +
  heruntergeladene, Herkunft), `thumbs` (Cache-Schlüssel).
- Import: Ordner wählen (rekursiv), Dateien werden nur referenziert, nie
  kopiert oder verändert.
- `notify`-Watcher plus Abgleich beim Fokus: neue Dateien erscheinen,
  gelöschte werden als „fehlt“ markiert, verschobene per Inhalts-Hash
  wiedergefunden.
- Thumbnail-Cache auf Platte: `$XDG_CACHE_HOME/lumen/thumbs/` (Windows
  `%LOCALAPPDATA%`), Schlüssel aus Inhalts-Hash + Hash des Edit-States,
  Größen 400 und 1600 px. Zuerst aus dem eingebetteten JPEG, nach einer
  Bearbeitung aus der GPU-Pipeline neu gerendert.
- Filter und Sortierung (minRating, colorLabel inkl. „ohne Label“, flag,
  Datum, Name) als SQL, Index auf `(folder, rating)` usw.
- Raster virtualisiert, Textur-LRU (~300 Kacheln).

### lumen-export

JPEG (mozjpeg oder libjpeg-turbo-Qualität, schneller Pfad als Option),
PNG, TIFF 16 bit. In v1 nur sRGB mit eingebettetem ICC-Profil. Die
Pipeline rechnet und klemmt in sRGB 0..1; Adobe RGB oder P3 brächten ohne
größeren Arbeitsfarbraum keinen Farbumfang. Wide-Gamut-Arbeitsfarbraum und
Monitor-Farbmanagement sind spätere Themen (PV3).
EXIF wahlweise mitkopieren oder entfernen (Standard: entfernen außer
Kamera/Objektiv, wie heute mit `exifStrip`). Stapel-Export parallel, mit
Fortschritt und Abbruch.

### lumen-net

- `reqwest` mit rustls. Keine Verbindung beim Start (außer Update-Check,
  falls eingeschaltet).
- **Marketplace lesen ohne Konto**: Liste, Detail, Vorschau,
  `GET /marketplace/presets/{id}/download`. Heruntergeladene Presets landen
  im lokalen Katalog mit Herkunftsvermerk.
- **Teilen mit Konto**: OAuth2 Authorization Code + PKCE über den
  System-Browser, Redirect auf Loopback `http://127.0.0.1:<port>/callback`
  (RFC 8252). Refresh-Token im OS-Schlüsselbund (`keyring`; Linux Secret
  Service, Windows Credential Manager). Fallback ohne Schlüsselbund: kein
  Speichern, beim nächsten Teilen neu anmelden.
- Vor dem Teilen: Hinweis, dass die Vorschau öffentlich wird (eventuell
  Personen darauf). Die App rendert das Vorschau-JPEG (max. 1600 px,
  ohne EXIF) lokal.
- **Feedback** ohne Konto (Text, optional Kontakt, App-Version, OS).
- **Update-Check**: Opt-in beim ersten Start. Fragt `latest.json` ab und
  zeigt einen Hinweis mit Link zur Download-Seite (Auffi-Muster, kein
  Selbst-Update in v1).

### app/lumen (eframe)

- Hauptbereiche wie heute: **Bibliothek** (Raster/Liste, Filterleiste,
  Meta-Steuerung, Lupe, Vergleich), **Editor** (Bild in der Mitte, Sidebar
  mit Sektionen, Toolbar unten, Overlays für Crop, Masken, Vergleichs-Split,
  Kurven-Editor, HSL), **Presets**, **Marketplace**, **Export-Dialog**,
  **Einstellungen**, **Onboarding-Tour**.
- Alle Tastenkürzel aus `libraryKeys.ts` und `useKeyboardShortcuts.ts`
  übernommen, inklusive der Sperrlogik (`isShortcutBlocked`: kein Kürzel
  in Eingabefeldern oder offenen Popups) und der Esc-Reihenfolge.
- UI-Texte deutsch mit echten Umlauten. Eigene Schrift eingebettet.
- Barrierefreiheit über AccessKit (egui), Screenreader-Ansagen für
  Bewertung/Markierung soweit AccessKit Live-Regions erlaubt.
- Edits werden automatisch gespeichert (entprellt, beim Bildwechsel und
  beim Beenden sofort). Es gibt keinen „Speichern“-Knopf, wie heute.
- Stabile Test-IDs über AccessKit-Labels/IDs statt `data-testid`.

### Paketierung und Verteilung

- Linux: AppImage und AUR-PKGBUILD (CachyOS), zusätzlich `.deb`.
  `cargo-packager` oder die Auffi-Skripte als Vorlage.
- Windows: NSIS-Installer, MSVC-Target. Cross-Build auf testbox per
  `cargo-xwin`, Funktionstest per `tb-win`. Unsigniert in v1
  (SmartScreen-Hinweis auf der Download-Seite erklären).
- Artefakte liegen auf dem VPS (`/srv/lumen/releases/<version>/`) und werden
  von Caddy statisch ausgeliefert, plus `latest.json`. Das Repo bleibt privat.

## Server-Umbau

Grundlage ist die Backend-Analyse. Wichtigster Befund: Heute liefert nur
`POST /presets/{id}/apply` den Inhalt eines Presets, und der braucht ein
Konto. Der Download ohne Konto ist neu.

**Bleibt**: `auth.py` (ohne JIT-Default-Presets), Marketplace Liste/Detail/
Report/Moderation, Admin (ohne Bild-Zähler), Feedback, `/me`,
`/me/profile`, `/me/published-presets`, Rate-Limit, Body-Limit,
Keycloak-Admin, Tombstones, Backup.

**Neu**:
- `GET /api/v1/marketplace/presets/{id}/download` ohne Konto, Rate-Limit
  pro IP. Zählt Downloads über `preset_downloads(preset_id, client_hash, day)`
  mit `client_hash = SHA-256(IP + Tagessalz)`, keine Roh-IP.
- `POST /api/v1/marketplace/presets` (multipart: Preset-JSON + Vorschau-JPEG
  ≤ 1 MB), `PUT` und `DELETE` für eigene Presets, nur mit Konto.
- Keycloak-Client `lumen-desktop` (public, PKCE S256, Loopback-Redirect,
  Audience-Mapper `included.custom.audience: lumen-api`, keine
  Direct-Access-Grants). In Dev- und Prod-Realm.
- Feedback ohne Konto: `user_id` optional, neue Felder `app_version`, `os`,
  `contact`, Rate-Limit 5/h pro IP plus Tagesobergrenze, Status `spam`.
- `GET /api/v1/meta` (`minClientVersion`, `presetSchemaVersion`,
  `latestVersion`) und `latest.json`.
- `schemaVersion` je Preset. Gemeinsames JSON-Schema für Rust und Python,
  damit `extra="forbid"` neue App-Versionen nicht aussperrt.
- Vorschaubilder der Presets in Postgres (`bytea`, Tabelle
  `preset_previews`), stabile öffentliche URL mit langem Cache.
- Website: Marketplace (lesen), Download-Seite, Account (Profil,
  veröffentlichte Presets, Konto löschen), Admin. React bleibt dafür.

**Fällt weg**: `images.py`, private Preset-Verwaltung und Batch-Apply in
`presets.py`, Fork/Apply im Marketplace, `storage.py`, `s3_presign.py`,
Upload-Janitor, Garage komplett (Container, Volumes, Caddy-/nginx-Pfad
`/lumen-images`), Kontingente für Bilder, Web-Editor und Web-Bibliothek
samt Onboarding im Frontend.

**Zeitpunkt**: Der Web-Editor wird abgeschaltet, sobald das erste nutzbare
Desktop-Produkt steht (nach etwa 8 Wochen, siehe Meilensteine). Es gibt
keinen Parallelbetrieb bis zur Parität. Deshalb reicht eine einzige
destruktive Migration; vorher Presets als YAML sichern.

**Migration `015_desktop_split`**: Tabellen `images`, `image_edits`,
`storage_purges` weg; `presets.preview_image_id` weg; private Presets weg;
`visibility` → `status` (`public`/`hidden`/`withdrawn`); `preset_downloads`
und `preset_previews` neu; Feedback-Spalten. Datenmigration nicht umkehrbar.
Vorher: eigene Presets als YAML exportieren, Vorschauen veröffentlichter
Presets aus Garage nach Postgres kopieren. Keine weiteren Nutzer zu
informieren.

**DSGVO**: Keine Fotos und Edits mehr auf dem Server. Datenschutzerklärung
für Update-Check, anonymen Download (Tagessalz-Hash) und anonymes Feedback
anpassen.

## Teststrategie

- **Referenzvektoren**: Ein Skript im Frontend (`frontend/scripts/
  export-reference-vectors.ts`) ruft die heutigen reinen Funktionen auf
  feste Eingaben auf und schreibt JSON nach
  `desktop/crates/lumen-core/tests/fixtures/`. Rust-Tests vergleichen mit
  Epsilon. Damit sind die ~3 900 LOC Logiktests als Orakel nutzbar.
- **Golden Images**, bevor der Web-Editor abgeschaltet wird: Ein
  Playwright-Harness auf testbox rendert die 7 Fixtures (vorher mit
  libraw-wasm dekodiert und als 16-bit-PNG eingefroren) mit etwa 30
  Adjustment-Sets durch den heutigen `webgl.ts`. Ablage
  `tests-fixtures/goldens/`. Die wgpu-Pipeline muss sie mit max. 2/255
  Abweichung bzw. ΔE2000 < 1 treffen. Rendern headless auf lavapipe.
- **Decode-Gleichheit**: LibRaw nativ gegen den libraw-wasm-Dump derselben
  Datei (Mittelwert, Histogramm, Pixel-Stichprobe).
- **PV1-Block**: eingefroren als `insta`-Snapshot des WGSL-Moduls.
- **Schema-Sync**: serde-Typen gegen das gemeinsame JSON-Schema.
- **Contract-Test**: `lumen-net` gegen echte Antworten des pytest-Stacks.
- **UI**: Lighttable- und Tasten-Verhalten (h2b/h2c/h2d) zuerst als
  Reducer-Tests in `lumen-core`, dann als `egui_kittest`-Szenarien.
- **Benchmarks** (`criterion`) für Decode, Raster-Abfrage und
  Slider-Frame. Die Leistungsziele oben laufen als Benchmark-Gate.
- **CI**: `desktop/Makefile` Ziel `ci` (fmt, clippy `-D warnings`, test),
  registriert über `tb-ci`. Windows-Smoke über `tb-win`.
- **Testdaten**: Manuel liefert Z6III-NEFs (verlustfrei komprimiert, dazu
  je eins mit HE und HE★, falls vorhanden) nach `tests-fixtures/raw-samples/`
  plus Eintrag in `manifest.json`. Die 7 vorhandenen Fixtures bleiben für die
  Format-Abdeckung. DNG ist kein Muss.

## Meilensteine

Jeder Meilenstein bekommt eine eigene Spec und ist einzeln mergebar.

| M | Inhalt | Schätzung |
|---|---|---|
| N0 | **Spike mit Go/No-Go** (unten), Golden-Generator, Workspace, `make ci` | 1 Wo |
| N1 | `lumen-core`: reine Module portiert, Referenzvektoren grün | 1,5 Wo |
| N2 | `lumen-raw` + `lumen-gpu`: Decode in drei Stufen, Proxy, PV1/PV2, 10 Grundregler, Histogramm, Goldens grün | 2 Wo |
| N3 | Editor-UI: Sidebar, HSL, Kurven-Editor, Undo/Redo, Bypass, Vergleichs-Split, Auto-Ton/WB, WB-Pipette | 2 Wo |
| N4 | Geometrie und Masken: Crop, Begradigen, Auto-Straighten, Linse/TCA/Vignette, 4+4 Masken mit Overlays | 2 Wo |
| N5 | Lichterrettung, lokaler Kontrast, Schärfen, Rauschminderung mit Pass-Cache | 1,5 Wo |
| N6 | `lumen-catalog`: Import, Watcher, Thumbnail-Cache, Raster und Liste, Meta, Filter/Sortierung | 2 Wo |
| N7 | Lupe, Vergleich, 1:1-Zoom, Tasten, lokale Presets + 20 Defaults, YAML, Batch-Apply | 1,5 Wo |
| N8 | `lumen-export`: JPEG/PNG/TIFF16, ICC, Stapel | 1 Wo |
| N9 | `lumen-net` + Server-Umbau (Migration 015, Download, PKCE, Feedback, Meta) | 2 Wo, Backend parallel |
| N10 | Paketierung Linux/Windows, Download-Seite, Onboarding | 1,5 Wo |

Summe etwa 18 Wochen bis Parität, eher 20–22. Ein erstes nutzbares
Produkt (Ordner öffnen, Raster, Grundregler, Export) entsteht nach N0–N2,
einer reduzierten N6 und N8, also nach etwa 8 Wochen. **Danach wird der
Web-Editor abgeschaltet**; der Server-Teil von N9 (Migration 015, Download,
Teilen, Feedback) wird dafür vorgezogen und parallel zu N2–N6 gebaut.

### N0 · Spike (Go/No-Go)

Läuft auf CachyTop (680M) und testbox (UHD 630, lavapipe), Windows über
`tb-win`. Ergebnis als Spec mit Zahlen.

| # | Prüfung | Abbruch, wenn |
|---|---|---|
| S1 | egui-Prototyp: Raster mit 5 000 Kacheln + Tasten, Sidebar mit 10 Slidern, Kurven-Editor mit Drag-Punkten, Crop-Overlay | mehr als 3 Tage oder sichtbar unbrauchbar |
| S2 | WGSL-Port von PV2-Ton, Belichtung, WB gegen erste Goldens | > 2/255 bzw. ΔE2000 > 1 |
| S3 | LibRaw nativ: 7 Fixtures + Z6III-NEFs (verlustfrei, HE, HE★), `half_size` und voll, Zeit und Gleichheit zu libraw-wasm | `half_size` > 1 s oder voller Decode > 1,5 s ohne Ausweg, Look weicht ab, oder verlustfreies NEF geht nicht. HE/HE★ nicht dekodierbar ist kein Abbruch, sondern Einschränkung (siehe Rahmenbedingungen) |
| S4 | wgpu auf radv (CachyTop), anv/lavapipe (testbox), DX12-WARP (tb-win) | Pipeline läuft auf einem Weg nicht |
| S5 | Slider-Frame auf dem Proxy (GPU-Zeit) | > 8 ms auf der 680M |

Bei No-Go nur wegen S1 bleiben alle Crates gültig. Dann wird mit Manuel neu
über die Oberfläche entschieden.

## Entscheidungen des Builders (zum Gegenlesen)

Diese Punkte hat Manuel nicht entschieden. Sie sind mein Vorschlag:

1. **egui/eframe** als UI-Toolkit. iced: API noch in Bewegung, wenig
   Editor-Bausteine. Slint: eigene DSL, GPLv3 bzw. kommerzielle Lizenz.
2. **LibRaw statt rawler** als Standard-Decoder, wegen gleichem Look.
3. **Ein zentraler Katalog** statt Katalog pro Ordner.
4. **Keine XMP-Sidecars in v1**. Bewertungen und Edits nur im Katalog.
5. **Keine Gesichtserkennung in v1**. Das TF.js-Modell kam bisher aus dem
   Netz (widerspricht „keine Cloud“). Später mit `ort`/`tract` und
   gebündeltem Modell.
6. **Kein Selbst-Update in v1**, nur Hinweis (Opt-in).
7. **Windows unsigniert in v1**.
8. **Gemeinsame Schemas** nach `schemas/` im Repo-Root.
9. **Vorschaubilder der Presets in Postgres** statt Garage. Garage fällt weg.
10. **Downloads ohne Konto zählen** für „Beliebt“, über den gesalzenen Tageshash.
11. **Pipeline-Reihenfolge und Auflösungsabhängigkeit 1:1 wie heute**
    (siehe lumen-gpu), auch wenn das den Pass-Cache einschränkt.
12. **Export v1 nur sRGB.**
13. **Leistungsziel „bearbeitbar“ gilt für Stufe 2**, voller Decode < 1,5 s (Z6III).

## Offen für den Builder

- Konkrete Crate-Versionen (exakt pinnen), Pass-Aufteilung im WGSL,
  Katalog-Schema im Detail, Thumbnail-Format, Theming der egui-Oberfläche,
  Port-Wahl beim Loopback, Struktur der Specs pro Meilenstein.
