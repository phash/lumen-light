# Lumen Desktop · Plugin-System

Stand: 2026-11-28 · Status: **Entwurf mit Entscheidungen Manuels und eingearbeiteten Prüfungen**
(Builder-, Security-, Performance-Check). Kein Plugin-Host in N0–N10, nur Nähte.
Gehört zu Phase N, Hauptspec `docs/superpowers/specs/2026-11-27-desktop-native-rust-design.md`
(im Folgenden **DS**), Spike-Ergebnis `docs/superpowers/specs/2026-11-27-n0-spike-results.md`
(**SR**). Grundlage: Recherche (Prior Art, WASM-Laufzeit, native ABI, GPU-Shader, Passung
zum Code) und drei Entwürfe (Sicherheit zuerst, Autoren zuerst, Leistung zuerst), von drei
Gutachtern bewertet. Diese Spec setzt auf dem Sicherheits-Entwurf auf, stark entschlackt,
mit der Rollout-Reihenfolge und den Leistungs-Mechanismen aus dem Leistungs-Entwurf und
einer kleinen Auswahl der Werkzeuge aus dem Autoren-Entwurf.

## Zweck und Warum

Lumen soll erweiterbar sein wie VS Code oder Notepad++: Nutzer und Community schreiben
Plugins, die das Programm verändern. Manuels Beispiele:

- ein **eigener RAW-Decoder** auf Basis einer anderen Bibliothek,
- eine **eigene Rauschminderung** mit eigenen Reglern im rechten Panel.

Dafür braucht ein Plugin Schnittstellen für Menü, Oberfläche (Panels mit Reglern),
Arbeitsabläufe (Bibliothek, Stapel, Import, Export) und die Bild-Pipeline.

Die Plugins kommen später **von Fremden**. Jede Desktop-Plattform, deren Plugins vollen
OS-Zugriff haben, hat schon Schadcode ausgeliefert: VS Code/Open VSX (GlassWorm, 2025/26,
mit gekaperten Publisher-Konten und „Schläfer“-Updates), Obsidian (Phantom Pulse),
Notepad++ (trojanisierte DLLs), Blender (Auto-Run in `.blend`). Fotoordner enthalten
private Bilder mit GPS-Daten. Deshalb ist Sicherheit hier kein Zusatz, sondern die
Grundform des Systems.

Gleichzeitig zeigen Lightroom Classic und darktable, was passiert, wenn Plugins keine
Pixel anfassen dürfen: Nutzer exportieren TIFFs und importieren sie wieder. Decoder,
Rauschminderung und Pipeline-Schritte müssen deshalb echte Erweiterungspunkte sein.

**Jetzt** wird das System nur **vorbereitet**: Design und Schnittstellen, dazu kleine
Nähte in N1–N10, die später teure Formatbrüche verhindern. Gebaut wird der Host nach der
Parität (N11). Eigene Beispiel-Plugins sind die Abnahmetests.

## Umfang v1

Heute ist Manuel der einzige Nutzer und Autor. v1 baut deshalb nur, was er selbst nutzt,
und legt die Formate für die Community-Teile jetzt fest, damit sie später ohne Bruch dazukommen.

| Teil | v1 gebaut (N11a–c) | Format festgelegt, später gebaut | Zurückgestellt |
|---|---|---|---|
| **S1** WGSL-Passes | ✓ | | |
| **S2** WASM-Komponenten | ✓ | | |
| **S4** Entwickler-Modus (nativ im Prozess) + C-ABI (eingefroren) + Beispiel `lumen.libraw-runner` | ✓ | | |
| **S3** nativer Runner-Prozess, Linux | | ✓ (Abschnitt „lumen-plugin-runner“) | bis ein echter nativer Kandidat existiert |
| **S3** unter Windows | | ✓ | bis der AppContainer-Fluchttest besteht; bis dahin unter Windows nur S4 |
| Installation per Datei (S1, S2) | ✓ | | |
| Native Pakete laden | ✓ nur über `--dev-plugins <dir>` (S4, Abschnitt „Dev-Ladeweg“) | | |
| Datei-Installation nativer Pakete (`.lumenplugin` mit `[artifacts] native`) | in v1 abgelehnt („Native Plugins gibt es in dieser Version nur im Entwicklermodus“) | ✓ (kommt mit S3 Linux; nativ dann nur so) | mit S3 |
| Marketplace für S1/S2 mit Autor-Signatur + Server-Gegensignatur (inkl. Zertifikat in `SIGNATURES`) | ✓ | | |
| Publisher-Schlüssel registrieren/widerrufen am Konto (TOTP-Step-up) | ✓ | | |
| Native Pakete im Marketplace | | | entfällt, solange es wenige gibt (Entscheidung 4) |
| Schlüsselkette (Root offline, rotierender Gegensignatur-Schlüssel, Sperr-Schlüssel), TOFU-Publisher-Bindung, signierter Index, Sperrliste, Staging/Wartezeit | | ✓ | gebaut, wenn der erste fremde Autor kommt |
| Handprüfung/reproduzierbarer Build nativer Plugins | | | entfällt mit Entscheidung 4 |
| Server-Tabellen für Plugins | ✓ (additive Migration in N11) | | |

In v1 schon enthalten, weil billig und nicht nachrüstbar: Root-Public-Key einkompiliert
(N10) und Prüfung des Gegensignatur-Zertifikats aus `SIGNATURES` gegen ihn (ein
einkompiliertes Zertifikat ist nur Vorbelegung), Downgrade-Schutz im Client, Abgesicherter
Modus, Hash-Pinning.

## Ziele, Nicht-Ziele, Anti-Ziele

### Ziele

- **Drei Ausführungswege, ein Manifest**: WGSL-Passes (Live-Bildschritte auf der GPU),
  WebAssembly-Komponenten (Logik, Oberfläche, Abläufe, CPU-Schritte, langsame Decoder)
  und native Bibliotheken (volle Geschwindigkeit, z. B. ein nativer RAW-Decoder) als
  eigene Vertrauensstufe. Entscheidung Manuel 2026-11-28. Nativ läuft in v1 nur im
  Entwickler-Modus (S4); der abgeschottete Runner (S3) ist spezifiziert.
- **Erweiterungspunkte**: Befehle und Menüs, Tastenkürzel, Panels mit Reglern,
  Bibliotheks- und Stapel-Aktionen, Import-Hooks, RAW-Decoder, GPU-Passes,
  CPU-Schritte (Export/„Backen“), Export-Formate, Metadaten, Ereignisse.
- **Parameter sind Daten**: Plugin-Regler landen im Edit-State, in Presets, im
  YAML-Profil und im Marketplace, mit Namensraum und Version. Ein fehlendes Plugin
  zerstört nie einen Edit.
- **Verteilung über den bestehenden Marketplace-Server** für S1/S2 (anonymer Download,
  Veröffentlichen mit Konto, Meldungen und Auto-Hide wiederverwendet). Native Pakete nur
  per Datei.
- **Stabile, versionierte Schnittstellen** unabhängig von der App-Version.
- **Ein Plugin-Autor schafft eine Rauschminderung mit zwei Reglern an einem Nachmittag**,
  einen Decoder an einem Wochenende.

### Nicht-Ziele (v1 des Plugin-Systems)

- Kein freies Zeichnen mit egui durch Plugins. Die Oberfläche ist deklarativ und wird
  vom Host gezeichnet.
- Keine Plugin-Passes zwischen den Stufen des Kern-Shaders (nach Linse/Rauschminderung,
  vor Vignette). In v1 gibt es nur die Einhängepunkte `source` und `output`.
- Keine CPU-Plugins im Live-Pfad (Slider → Frame). Live heißt WGSL.
- Kein Python/JS/C als „erste Klasse“. Unterstützt sind WGSL und Rust; C/C++ geht über
  Header und WIT, Python/JS sind möglich, aber ohne Vorlagen und Zusagen.
- Keine automatischen Plugin-Updates.
- Kein Plugin-Code auf dem Server (der Server prüft nur Form und Signaturen).
- Kein Shader-Fusing in den Kern-Shader und keines zwischen Plugin-Passes in v1 (später,
  nur mit Messdaten).
- Kein S3-Runner, keine nativen Pakete im Marketplace (siehe Umfang v1).
- Kein macOS.

### Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)

Die Anti-Ziele aus DS gelten unverändert und schließen Plugins ein:

- **Die App fühlt sich träge an**, weil ein Plugin oder Hintergrundarbeit läuft: Slider →
  Frame mehr als 1 Frame bei 60 Hz, GPU-Zeit auf dem Proxy über 8 ms **auf irgendeiner
  unterstützten GPU**, die Oberfläche wartet auf ein Plugin, ein Export oder Vorschaubilder
  drücken Regler unter 60 Hz, oder der Start wird mit vielen Plugins langsamer.
- **Ein Plugin ändert Original-RAWs.** Plugins bekommen nur Lese-Handles.
- **Ein Plugin funkt ohne Zutun nach Hause.** Netzwerk nur innerhalb einer Nutzeraktion.
- **Man braucht ein Konto**, um Plugins zu installieren oder zu nutzen.
- **Das Öffnen einer Datei führt Code aus** (Preset, YAML, Edit, Katalog).
- **Ein Plugin-Update tauscht still Code aus**, dem der Nutzer nicht zugestimmt hat.
- **Bestehende Presets sehen anders aus**, weil das Plugin-System den Kern-Shader verändert.

## Rahmenbedingungen

- Desktop: Rust 1.100.0, egui/eframe 0.37, wgpu 30.0.2 (naga 30.0.2), LibRaw 0.22.3
  statisch (LGPL-2.1), optional OpenMP (unter Windows LLVM-libomp, Commit 291ad06).
  App-Lizenz `AGPL-3.0-or-later` (`desktop/Cargo.toml:9`). Abhängigkeiten exakt gepinnt (`=x.y.z`).
- Ein Entwickler (Manuel), der auch Hauptnutzer ist. Prüfaufwand für fremden Code muss
  klein bleiben; automatische Prüfungen tragen die Last.
- Der Web-Editor fällt weg. Der FastAPI-Server bleibt (Marketplace, Teilen, Admin,
  Feedback) und ist für Downloads anonym erreichbar. **Migration 015** (N9, laut DS
  vorgezogen) bekommt nur `PresetIn.plugins`/`requiresPlugins` (Formatstabilität der
  Presets). Plugin-Tabellen kommen in einer späteren, rein additiven Migration in N11.
- Tests und schwere Builds auf testbox über `tb-run`, CI über `tb-ci`, Windows über `tb-win`
  (VM ohne GPU, DX12-WARP).
- Gemessene Eckwerte (SR): Slider-Frame 1,15 ms p50 auf der 680M (S5) und **5,12 ms p50 /
  5,44 ms p95 auf der UHD 630** (testbox, 2560×1706, SR Z. 227), jeweils mit dem Spike-Shader,
  der nur die Grundregler enthält (`develop.wgsl`, N2–N5-Stufen sind noch TODO). Auf der
  UHD 630 bleibt damit schon heute nur ≈ 1,5 ms für Plugins, mit den N2–N5-Stufen ≤ 0. Der
  Spielraum für Plugins ist deshalb **kein fester Wert**, sondern wird je Gerät und Edit
  gemessen (Abschnitt „Laufzeit-Budget“). Z6III lossless mit OpenMP: `half_size` 416 ms,
  voll 810 ms (680M); ohne OpenMP voll 1 757 ms. LibRaw dekodiert Z6III HE/HE★ nicht.
- **Farbraum der Quelle**: `lumen-raw` dekodiert mit `output_color = 1` (sRGB),
  Kamera-WB, `auto_bright_thr = 0.005` und LibRaw-Standard-Gamma
  (`desktop/crates/lumen-raw/src/handle.rs:42-47`, gleich `RAW_DECODE_SETTINGS`; `gamm` wird
  nicht gesetzt, also LibRaw-Vorgabe `gamm[0] = 0.45`, `gamm[1] = 4.5`, eine BT.709-artige
  Kurve, **nicht** die sRGB-Kurve). Die `Rgba16Float`-Quelltextur ist also
  **display-kodiert** (Primärfarben sRGB, Kamera-WB angewendet, LibRaw-Kurve), nicht
  szenen-linear. In dieser Spec heißt das kurz „sRGB-kodiert“. `develop.wgsl` linearisiert
  selbst mit der sRGB-Formel (`srgb_to_linear`, `develop.wgsl:48,169`); das ist eine bewusste
  Näherung des Kerns, die die Goldens festschreiben. Diese Spec definiert die Einhängepunkte
  und den Decoder-Ausgabevertrag danach.

## Ansätze

Vier Grundformen wurden untersucht (Prior Art: VS Code, Zed, Lapce, Notepad++, OBS,
darktable, Lightroom SDK, Photoshop UXP/C++, GIMP 3, Blender, Figma, Obsidian).

| Ansatz | Kurz | Stärke | Schwäche |
|---|---|---|---|
| A · Native DLL im Prozess | `.so`/`.dll` mit C-ABI, wie Notepad++ und OBS | volle Geschwindigkeit, einfach, jede Sprache | kein Schutz: Absturz reißt Lumen mit, Schadcode hat Nutzerrechte; OpenMP-/Allocator-Konflikte; kein sicheres Entladen |
| B · WASM-Komponenten | wasmtime + WIT, wie Zed | echte Sandbox, Rechte erzwingbar, typisierte Schnittstellen, versionierbar | CPU 1,3–2,5× langsamer, nur 128-bit-SIMD, keine Threads, Puffer werden kopiert |
| C · Eingebettete Skriptsprache | Lua/Rhai/Python im Prozess, wie darktable, Lightroom, Blender | schnell zu schreiben, kleine Plugins | keine Pixelarbeit (zu langsam), Sandbox über Sprachtricks (Figma ist damit 2019 gescheitert), eine weitere Laufzeit |
| D · Eigener Prozess | Plugin als separates Programm mit IPC und Shared Memory, wie GIMP | Absturz isoliert, OS-Sandbox möglich, kein OpenMP-Konflikt | IPC-Aufwand, Startzeit, unter Windows fummelig |

**Gewählt (Manuel, 2026-11-28): B + WGSL-Passes + native Stufe.**

- **B** ist der Standard für Logik, Oberfläche, Abläufe, CPU-Schritte und langsame Decoder.
- **WGSL-Passes** sind der einzige Weg in den Live-Pfad. Der Host validiert, umhüllt und
  misst sie. Das ist das OBS-/libplacebo-Muster.
- **Native** hat eine eingefrorene C-ABI. In v1 läuft sie nur als **A im Entwickler-Modus**
  (S4, lokal gebaut und lokal signiert). Das Ziel für fremden nativen Code ist **D**
  (`lumen-plugin-runner`, S3); es ist spezifiziert und zurückgestellt.
- **C** fällt weg: Für Pixel zu langsam, für Abläufe deckt B dasselbe sicherer ab.

## Vertrauensstufen und Rechte-Modell

### Stufen

| Stufe | Inhalt | Läuft wo | Kann | Verteilung | Standard | v1 |
|---|---|---|---|---|---|---|
| **S0 Daten** | Presets, YAML-Profile, Plugin-Parameter | nirgends | nichts | Marketplace, Datei | an | ✓ |
| **S1 Shader** | Manifest + WGSL-Funktionen + Parameter | GPU, im Frame des Hosts, vom Host umhüllt | Pixel-Mathematik auf Host-Texturen | Marketplace (automatische Prüfung + Gegensignatur), Datei | an nach Installations-Zustimmung | ✓ |
| **S2 Sandbox** | WASM-Komponente (`wasm32-wasip2`), optional mit S1-Passes | wasmtime im Prozess, Worker-Pool | nur die gewährten Rechte (Tabelle unten) | Marketplace (automatische Prüfung + Gegensignatur), Datei | an nach Installations-Zustimmung | ✓ |
| **S3 Nativ** | C-ABI-Bibliothek, optional mit S1-Passes | `lumen-plugin-runner`, ein Prozess je Plugin, OS-Zaun | volle CPU-Geschwindigkeit (AVX2, Threads, OpenMP), Decoder, CPU-Schritte, Encoder | **nur Datei** | **global aus**; Schalter „Native Plugins erlauben“ + Zustimmung je Plugin; unter Windows nicht verfügbar bis AppContainer | zurückgestellt |
| **S4 Entwickler** | dieselbe Bibliothek im Lumen-Prozess | Lumen-Prozess | alles, was der Nutzer darf | **nie** verteilt, keine Datei-Installation; nur mit lokalem Dev-Schlüssel signiert | nur mit `--dev-plugins <dir>` beim Start (Abschnitt „Dev-Ladeweg“) | ✓ (Linux und Windows) |

Ein Paket kann Stufen mischen (z. B. S1-Vorschau-Pass + S2-„Backen“ in voller Auflösung).
Die **Paketstufe** ist die höchste enthaltene; Zustimmung und Prüfung folgen ihr.

**Ausleitungs-Regel für gemischte Pakete** (Entscheidung des Builders): Pakete mit nativem
Code dürfen `net`, `clipboard.write`, `fs.pick` mit `write` und `export.post` nicht
anfordern; der Manifest-Validator lehnt sie ab. S2-Pakete, die Dateibytes oder Bildinhalte
vollständig sehen (`raw.decode`, `metadata`, `originals.read`, `export.encoder` mit allen
exportierten Pixeln und dem EXIF-Block, `image.process` mit `cpu-op` inkl. `bake` mit jedem
gebackenen Bild in voller Auflösung), dürfen kein `net` und kein `clipboard.write`
anfordern. Hochladen geht allein über ein `export.post`-Paket ohne diese Rollen; es sieht nur
die Dateien, die der Nutzer gerade exportiert hat. Jede Stufe hat ihren eigenen Datenordner
(`plugin-data/<id>/wasm/`, `plugin-data/<id>/native/`); ein S3-Teil kann keine Datei für
einen S2-Teil mit Netz ablegen. (S1-`gpu-pass` hat ohnehin keinen Ausleitungsweg.)

Feste Texte (Plugins können sie nicht ändern):

- S1/S2: „Läuft in einer Sandbox. Kann nur die unten aufgeführten Rechte nutzen.“
- S3 (später): „Nativer Code von *Publisher*. Läuft in einem eigenen Hilfsprozess mit voller
  Geschwindigkeit. Schutz auf diesem Rechner: *Liste aus dem FenceReport* (z. B. „kein Netz,
  Schreiben nur im eigenen Datenordner, Lesen nur Plugin-Ordner und Systembibliotheken“).“
  Der Text nennt nur, was der `FenceReport` tatsächlich bestätigt.
- S4: „Läuft mit deinen Benutzerrechten und kann alle deine Dateien lesen und ändern.“

Abzeichen erscheinen im Plugin-Manager, in jedem Panel-Kopf und an jedem Menüeintrag:
Shader/Sandbox neutral, Nativ bernsteinfarben, Entwickler rot (zusätzlich in der Titelleiste).

### Grundregeln

1. **Minimale Rechte durch Konstruktion.** Ein S2-Plugin kann nur aufrufen, wogegen es
   gelinkt wurde. Gelinkt wird nur, was der Nutzer gewährt hat (plus die feste Basis-WASI,
   siehe „Statische Durchsetzung“).
2. **Daten sind nie Code.** Presets, Edits, YAML und Katalogzeilen lösen nie eine
   Installation oder Aktivierung aus. `requires` in einem Preset zeigt nur einen Hinweis.
3. **Die Vertrauensentscheidung fällt vor dem ersten Code.** Manifest lesen, Hashes und
   Signaturen prüfen, dann erst instanziieren oder `dlopen` (das führt Konstruktoren aus).
4. **Notbremsen auf jeder Ebene**: ein Plugin, eine Version, ein GPU-Pass, eine Stufe,
   alles (abgesicherter Modus). Aus der Ferne über eine signierte Sperrliste, die nur bei
   Nutzeraktion geladen wird (Format festgelegt, gebaut mit dem ersten fremden Autor).
5. **Keine Pfade an Plugins.** Plugins sehen Dateinamen (Basename) und Lese-Handles, nie
   absolute Pfade. Ordnerstrukturen verraten Privates.

### Rechte (Capabilities)

Jedes Recht ist benannt, hat einen Geltungsbereich und wird erzwungen. Im Manifest
angefragt (als **gequoteter TOML-Schlüssel**, z. B. `"catalog.read" = …`, siehe Manifest),
durch Zustimmung gewährt.

| Recht | Bereich | Stufe | Durchsetzung | Zustimmung |
|---|---|---|---|---|
| `log` | – | alle | immer gelinkt, 100 Zeilen/s, 64-KiB-Ring | implizit |
| `storage.private` | Quote MiB (max. 256) | S2 | WASI-Preopen `/data` = `~/.local/share/lumen/plugin-data/<id>/wasm/` (Windows `%LOCALAPPDATA%\Lumen\plugin-data\<id>\wasm\`), Quote vom Host | implizit, angezeigt |
| `settings` | – | S2 | `lumen:plugin/settings`, KV im Katalog, Namensraum je Plugin | implizit |
| `ui.panel`, `ui.menu`, `ui.shortcut` | Panel-IDs, Menüpfade | S1 (Auto-Panel), S2 | Beiträge aus dem Manifest, Host zeichnet | angezeigt |
| `image.process` | `gpu-pass`, `cpu-op` | S1, S2, S3/S4 | Eintrag in PassGraph bzw. CPU-Op-Registry | angezeigt |
| `raw.decode` | `magic`, `ext`, `role = fallback\|primary` | S2, S3/S4 | Decoder-Registry; `primary` nur für die angegebenen Magics; Ausleitungs-Regel | **ausdrücklich**: „kann bestimmen, wie deine RAWs aussehen, und sieht die ganze Datei inklusive Ort, Seriennummer und Besitzername“ |
| `metadata` | Schlüssel | S2, S3/S4 | eigene Welt ohne Ausleitungsweg; Werte ≤ 4 KiB, ≤ 64 Schlüssel | angezeigt |
| `originals.read` | – | S2 | `lumen:plugin/originals` liefert `bytes-source` eines Originals, nur mit Nutzeraktions-Token; Ausleitungs-Regel | ausdrücklich |
| `catalog.read` | `fields = [rating, label, flag, camera, lens, capture-time, file-name]` | S2 | `lumen:plugin/catalog` liefert nur diese Felder (nicht gewährte = `none`) | ausdrücklich |
| `catalog.read.location` | – | S2 | GPS/Ort eigenes Recht (DSGVO), siehe „Ortsdaten“ | ausdrücklich, Warnung |
| `catalog.write` | `fields = [rating, label, flag, plugin-meta]` | S2 | rückgängig machbare Host-Befehle, nie SQL | ausdrücklich |
| `edit.write` | `own` (Standard), `adjustments` | S2 | getrennte Schnittstellen `edit-own`/`edit-adjustments`; `own` = nur `plugins.<id>`, gegen die Param-Deklaration geprüft; `adjustments` = Host-Setter, rückgängig machbar | `adjustments` ausdrücklich |
| `fs.pick` | `read\|write`, `filter` | S2 | Host-Dateidialog liefert einmaliges Handle; braucht Nutzeraktions-Token; siehe „Schreib-Handles“ | Dialog ist die Zustimmung |
| `export.encoder`, `export.post` | Format-IDs | S2, S3/S4 (`post` nicht nativ) | Encoder-Registry; `post` bekommt Lese-Handles der gerade geschriebenen Dateien | angezeigt |
| `import.hook` | – | S2 | bekommt die ersten 64 Byte + Endung + Basename, gebündelt, nie den Pfad | angezeigt |
| `net` | `hosts`, `methods`, `max-bytes` | nur S2 | `lumen:plugin/http`, **nur mit Nutzeraktions-Token**, siehe „Netz“ | **ausdrücklich** + Rückfrage beim ersten Mal je Befehl und Host; Text: „kann Daten an *host* senden“ |
| `clipboard.write` | – | S2 | nur mit Nutzeraktions-Token, Text ≤ 64 KiB | angezeigt |
| `process.exec` | – | **keine** | in keiner Sandbox-Stufe angeboten | – |

Bei S3 sind die Rechte **Auskunft plus OS-Zaun**, nicht feingranular erzwingbar: Ein
nativer Prozess hat weder Netz noch Schreibzugriff außer seinem `native/`-Datenordner, wenn
der Zaun steht; mehr lässt sich nativ nicht verlässlich beschränken. Bei S4 gilt gar nichts.

**Nutzeraktions-Token (Regel „funkt nie ohne Zutun“).** Klickt der Nutzer einen Befehl,
drückt dessen Kürzel, startet einen Export oder einen Panel-Knopf, prägt der Host ein
`UserActionToken`, gebunden an Plugin und Aufruf, und gibt es in den Aufruf. Es gilt, bis
der Aufruf bzw. der daraus entstandene Job endet oder abgebrochen wird (keine feste TTL;
ein Export über Hunderte Dateien mit anschließendem Hochladen bleibt gültig, ein
abgeschlossener Job nicht). Host-Funktionen mit `#[needs_user_action]` (`net`,
`clipboard.write`, `fs.pick`, `originals.read`) prüfen es. Ereignis-Handler, Timer und
`activate()` bekommen kein Token. Ein Plugin mit `net` kann also nicht im Hintergrund senden.

Gegen Klick-Täuschung: Widgets, die in den letzten 500 ms neu erschienen, verschoben oder
den Typ gewechselt haben (dynamisches `describe`), ignorieren Eingaben (Muster der
Browser-Rechteabfragen). Die erste `net`-Nutzung je (Befehl/Knopf, Host) geht über eine
vom Host gezeichnete Bestätigung. `on-export-done` bekommt ein Token nur für den Export-Job,
den der Nutzer selbst gestartet hat.

**Netz.** Die Host-Liste allein reicht nicht. Der Host
- normalisiert `hosts` bei der Installation auf ASCII-Kleinschreibung (IDN als Punycode,
  im Zustimmungsblatt Unicode und Punycode nebeneinander), lehnt IP-Literale, Wildcards
  und Ports außer 443 ab,
- löst je Anfrage selbst auf, pinnt die IP für diese Anfrage und prüft sie per **Allowlist**,
  nicht per Blockliste: Die Adresse wird zuerst kanonisiert (`Ipv6Addr::to_canonical` für
  IPv4-mapped/-compatible wie `::ffff:10.0.0.1`; eingebettete IPv4 aus NAT64 `64:ff9b::/96`
  und `64:ff9b:1::/48`, 6to4 `2002::/16` und Teredo `2001::/32` ausgewertet und erneut
  geprüft), dann ist nur **global routbares Unicast** nach der IANA-Special-Purpose-Registry
  (IPv4 und IPv6) erlaubt. Damit fallen u. a. loopback, `0.0.0.0/8`, RFC 1918, link-local,
  ULA, CGNAT (100.64/10), `192.0.0.0/24`, `198.18.0.0/15`, Doku-Netze, Multicast und
  Broadcast heraus (schützt Router, testbox, lokale Dienste; DNS-Rebinding greift nicht,
  weil die geprüfte IP benutzt wird). Unit- und Fuzz-Test mit genau diesen Formen in N11b,

- nimmt nur TLS mit Zertifikatsprüfung, setzt `Host` selbst (Plugin-Header `Host`, `Cookie`,
  `Proxy-*` werden verworfen), ignoriert Proxy-Umgebungsvariablen,
- folgt Weiterleitungen nur zu gelisteten Hosts und prüft dabei erneut,
- begrenzt Antwort und Anfrage auf `max-bytes` und loggt jede Anfrage im Plugin-Inspektor.

**Ortsdaten.** Ohne `catalog.read.location` gilt: GPS fehlt in `catalog`-Antworten, in
`raw-meta.extra` (Host-Filter mit Schlüssel-Allowlist, ohne GPS, Seriennummern,
Besitzername) und in Ereignissen. Der EXIF-Block an Encoder läuft durch **dieselbe
Schlüssel-Allowlist** wie `raw-meta.extra`: GPS nur, wenn der Nutzer im Export „Ort
mitschreiben“ gewählt hat; Seriennummern und Besitzer (`BodySerialNumber`,
`LensSerialNumber`, `CameraOwnerName`, `Artist`, Nikon-/Canon-Makernote-Seriennummern) nur
mit dem eigenen Export-Schalter „Seriennummer und Besitzer mitschreiben“ (Standard aus).
Hängt an einem Export ein `export.post`-Plugin ohne
Ortsrecht, schreibt der Host die Dateien ohne GPS und sagt das im Export-Dialog. Import-Hooks
bekommen nur 64 Byte (Formaterkennung), nicht die IFDs. Rollen mit Vollzugriff auf
Dateibytes oder Bildinhalte (Decoder, Metadaten, Originale, Encoder, CPU-Schritt/Bake) haben
nach der Ausleitungs-Regel keinen Netzweg.

**Schreib-Handles (`fs.pick write`).** Der Host gibt keine Schreib-Handles auf Dateien mit
RAW-Endung oder RAW-Magic und auf vorhandene Dateien innerhalb von Katalogordnern. Er
gibt Handles nur für neue Dateien oder nach einer Host-Bestätigung „*Datei* überschreiben?“,
die den Namen zeigt.

**Statische Durchsetzung.** Bei der Installation liest `lumen-plugin-host` die
Import-Liste der Komponente (`Component::component_type().imports()`). Das ist die
**tatsächlich verbliebene** Liste: Die WIT-Welten deklarieren alle optionalen Schnittstellen
als `import`, `wit-component` entfernt beim Bau der Komponente Importe, die das Kernmodul nie
referenziert (im Import-Golden in N11b bestätigt). Importiert sie mehr, als die gewährten
Rechte plus die **Basis-WASI** plus die feste Basis ihrer Rollen-Welt abdecken, wird sie
abgelehnt. Bei der
Instanziierung enthält der `Linker` nur gewährte Schnittstellen und die Basis-WASI. Ein
nicht gewährter Import ist ein Link-Fehler, keine Laufzeitprüfung.

Die **Basis-WASI** ist die Fläche, die ein normales Rust-`std`-Programm auf
`wasm32-wasip2` importiert (Panics schreiben auf stderr). Sie wird in jeder Welt vom Host
mit harmlosen Implementierungen gelinkt und zählt nicht gegen die Rechte:

| Schnittstelle | Host-Implementierung |
|---|---|
| `wasi:cli/environment` | leer (keine Variablen, keine Argumente) |
| `wasi:cli/exit` | beendet die Instanz (Trap, zählt als Strike) |
| `wasi:cli/stdin`, `stdout`, `stderr`, `wasi:io/*` | stdin leer; stdout/stderr → `log`-Ring mit Rate-Limit |
| `wasi:cli/terminal-input`, `terminal-output`, `terminal-stdin`, `terminal-stdout`, `terminal-stderr` | kein Terminal (`get-terminal-*` liefert `none`) |
| `wasi:clocks/*` | auf 1 ms vergröbert |
| `wasi:random/*` | in `decoder`, `image-op`, `encoder` je Aufruf fest gesät (Determinismus für Goldens), sonst echt |
| `wasi:filesystem/*` | ohne Preopens; nur mit `storage.private` ein Preopen `/data` |

`wasi:sockets/*` und `wasi:http/*` werden nie angeboten. Importiert eine Komponente sie
(z. B. durch `std::net`), lehnt die Installation sie mit genau dieser Meldung ab. Prüfpunkt in
N11b: Die Import-Liste eines leeren SDK-Plugins (Rust `std`, `wasm32-wasip2`) wird als
Golden eingecheckt. Weicht sie von der Tabelle ab, wird die Tabelle angepasst oder das SDK
für reine Bildrollen auf `wasm32-unknown-unknown` + `wasm-tools component new` (ganz ohne
WASI) umgestellt.

## Plugin-Paket und Manifest

### Paket `.lumenplugin`

Zip im Store-Modus (keine Kompression, einfache Review-Diffs):

```
lumen-plugin.toml          Manifest (nie ausgeführt), enthält [files] mit dem Hash jeder Datei
plugin.wasm                S2 (nie .cwasm – vorkompiliert wird nur lokal)
lib/linux-x86_64/…so       nativ; v1 nur entpackt über --dev-plugins (S4), Datei-Installation erst mit S3
lib/windows-x86_64/…dll    nativ
shaders/*.wgsl             S1
LICENSE  README.md  icon.png (256², vom Host neu kodiert)
tests/                     optional: Golden-Vektoren für `lumen-plugin test`
SIGNATURES                 Signaturen (Format unten)
```

- Texte stehen lokalisiert direkt im Manifest (`{ en, de }`, `en` Pflicht); es gibt keine
  getrennten i18n-Dateien (eine Quelle, mit dem Manifest signiert).
- **`[files]` im Manifest** listet jede Datei des Pakets außer `lumen-plugin.toml` und
  `SIGNATURES` mit SHA-256. Nicht gelistete Dateien → Paket abgelehnt. Damit decken die
  Signaturen das ganze Paket, auch README, Icon, Tests und mitgelieferte Bibliotheken.
- Grenzen: S1 ≤ 1 MiB, S2 ≤ 64 MiB, nativ ≤ 128 MiB; ≤ 64 Dateien; Namen ≤ 128 Zeichen,
  Tiefe ≤ 4.
- **Pfad- und Zip-Regeln.** Abgelehnt werden: Symlinks, absolute Pfade, `..`, leere oder
  `.`-Segmente, Zeichen außerhalb `[A-Za-z0-9._/-]`, führendes `-`, Segment mit Punkt oder
  Leerzeichen am Ende (`x.dll.`), Windows-Gerätenamen in irgendeinem Segment (`CON`, `PRN`,
  `AUX`, `NUL`, `COM0-9`, `LPT0-9`, auch mit Endung wie `NUL.toml`), Dubletten ohne
  Groß-/Kleinschreibung (`a.wgsl`/`A.wgsl`), doppelte Einträge, lokaler Header ≠ zentrales
  Verzeichnis, Kompression ≠ stored, Verschlüsselungs-Flag, Zip64-Felder bei kleinen
  Einträgen. Entpackt wird nach Prüfung in ein frisches Verzeichnis.

### Signaturen (`SIGNATURES`)

Ein Algorithmus durchgängig: Ed25519 (rohe Schlüssel, kein minisign), Hash SHA-256.
Signiert werden die **exakten Bytes** von `lumen-plugin.toml`, wie sie im Zip liegen
(TOML hat keine kanonische Form). `SIGNATURES` ist TOML:

```toml
[publisher]
pubkey = "base64…"                     # 32 Byte roher Ed25519-Schlüssel, Pflicht
key-id = "ed25519:3f9a1c0d…(64 hex)"   # voller sha256(pubkey), hex; muss zu pubkey passen
sig    = "base64…"                     # 64 Byte

[marketplace]                          # nur bei Marketplace-Paketen
key-id       = "ed25519:9c01ab77…(64 hex)"
sig          = "base64…"
review-id    = "rv-2026-000123"
published-at = "2026-12-01T10:00:00Z"  # TOML-String, genau ^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$

[marketplace.cert]                     # Zertifikat des Gegensignatur-Schlüssels, vom Root signiert
role       = "countersign"
key        = "base64…"                 # 32 Byte; key-id oben = sha256(key)
not-before = "2026-01-01T00:00:00Z"
not-after  = "2027-03-01T00:00:00Z"
root-sig   = "base64…"

[dev]                                  # nur im Dev-Ordner (S4 und Dev-S1/S2), nie in Paketen
key-id = "ed25519:…(64 hex)"           # sha256 des lokalen Dev-Public-Keys
sig    = "base64…"
```

Signierte Nachrichten (domänengetrennt, `‖` = Verkettung, Zeichenketten UTF-8 mit `\0`
dahinter, Schlüssel als 32 rohe Bytes, **Zeiten als u64 Unix-Sekunden big-endian**; in TOML
stehen Zeiten nur als String im festen Format oben, der Prüfer wandelt ihn um und lehnt
jede andere Schreibweise ab):

- Publisher: `"lumen-plugin-v1\0" ‖ sha256(manifest) ‖ id\0 ‖ version\0`
- Marketplace: `"lumen-marketplace-v1\0" ‖ sha256(manifest) ‖ id\0 ‖ version\0 ‖ tier\0 ‖
  review-id\0 ‖ u64be(published-at) ‖ sha256(publisher.sig)`
- Zertifikat (vom Root signiert): `"lumen-cert-v1\0" ‖ role\0 ‖ key(32 B) ‖ u64be(not-before) ‖
  u64be(not-after)`; `role` = `countersign` | `revocation`
- Dev: `"lumen-dev-v1\0" ‖ sha256(manifest) ‖ id\0 ‖ version\0 ‖ sha256(dev-pubkey)`

`key-id` ist überall der **volle** `sha256(pubkey)` (kein 8-Byte-Kürzel); der Prüfer
berechnet ihn aus `pubkey` bzw. `cert.key` neu und lehnt Abweichungen ab.

**Prüfregeln Gegensignatur.** `[marketplace.cert].root-sig` wird gegen den einkompilierten Root-Key
geprüft (ein mit der App ausgeliefertes Zertifikat ist nur Vorbelegung; so prüft eine alte
App auch Pakete eines nach der jährlichen Rotation neuen Schlüssels). Gültig ist die
Gegensignatur, wenn `published-at` im Fenster `[not-before, not-after]` liegt; installierte
Pakete bleiben danach gültig. Eine **neue** Marketplace-Installation lehnt der Client ab,
wenn jetzt > `not-after`; der Server signiert bei der Rotation seinen Bestand mit dem neuen
Schlüssel nach.

**Anzeige bei der Datei-Installation** (offline, ohne Server): S1/S2 ohne Signaturen möglich
(Warnung „nicht geprüft“). Mit Publisher-Signatur prüft der Client `sig` gegen das
mitgelieferte `pubkey`. Ist dieser Schlüssel schon in der Zustimmungsdatei bekannt
(`publisher_key` einer installierten Version), steht dort „signiert von *Publisher wie
installierte Version*“; sonst „signiert mit unbekanntem Schlüssel *voller Fingerprint*“, nie
„signiert von“ mit einem Namen. Marketplace-Installation braucht beide Signaturen.

### Manifest `lumen-plugin.toml`

Geparst mit `toml` in `lumen-plugin-manifest::Manifest` mit `#[serde(deny_unknown_fields)]`
(unbekannte Schlüssel sind ein Fehler, keine Warnung: vertippte Rechte dürfen nicht still
verschwinden). Rechte-Namen enthalten Punkte und stehen deshalb **gequotet** (`"image.process"`);
ungequotet würde TOML daraus Untertabellen machen, was `deny_unknown_fields` mit einem
Hinweis „Rechte-Namen in Anführungszeichen“ ablehnt. JSON-Schema
`schemas/lumen-plugin.schema.json` wird per `schemars` erzeugt, eingecheckt, in CI
diff-geprüft, vom Server und von Taplo (Autovervollständigung im Editor) genutzt. Ein Test
parst das Beispiel unten und prüft es mit dem Validator (gültig). Ein zweiter Test
deserialisiert es mit allen auskommentierten Zeilen nur per serde und Schema (ohne
Validator) und prüft als **Negativtest**, dass der Validator genau diese Fassung ablehnt
(Paketstufe `shader` mit `wasm`/`native`-Artefakt, nativ + `net` verletzt die
Ausleitungs-Regel).

Alle Zeichenketten werden auf unsichtbare und Bidi-Zeichen geprüft (U+200B–U+200F,
U+202A–U+202E, U+2066–U+2069, Tag-Block U+E0000) und dann abgelehnt (GlassWorm-Lehre).
`name` und Publisher-Anzeigename bekommen zusätzlich eine UTS-#39-Skeleton-Prüfung gegen
eingebaute Namen und reservierte Wörter („Lumen“, „Offiziell“, „Official“, „Update“,
„System“).

Beispiel: die Rauschminderung aus Manuels Wunsch, als S1.

```toml
#:schema https://lumen.mr-development.de/schemas/lumen-plugin-1.json
schema  = 1
id      = "mrd.guided-denoise"        # ^[a-z0-9-]{2,32}\.[a-z0-9-]{2,48}$, Präfix an Publisher gebunden
version = "0.3.1"                     # semver des Plugins
tier    = "shader"                    # "shader" | "wasm" | "native"
api     = "0.1"                       # Plugin-API (major.minor), NICHT die App-Version
lumen   = ">=1.0, <2.0"               # App-Bereich, vor Installation geprüft
license = "MIT"                       # SPDX, OSI-Lizenz Pflicht im Marketplace
source  = "https://codeberg.org/mrd/guided-denoise"   # Pflicht im Marketplace
name        = { en = "Guided Denoise", de = "Geführte Rauschminderung" }
description = { en = "Edge-aware luma and chroma denoise", de = "Kantenerhaltende Rauschminderung" }

[files]                               # jede Datei außer Manifest und SIGNATURES
"shaders/denoise_h.wgsl" = "41aa0c3e0000000000000000000000000000000000000000000000000000d107"
"shaders/denoise_v.wgsl" = "7c02e91b0000000000000000000000000000000000000000000000000000aa31"
"LICENSE"                = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

[artifacts]
# S2 (tier = "wasm"):    wasm = "plugin.wasm"
# nativ (tier = "native"): native = { linux-x86_64 = "lib/linux-x86_64/libx.so", windows-x86_64 = "lib/windows-x86_64/x.dll" }

[capabilities]
"image.process" = ["gpu-pass"]
"ui.panel"      = ["main"]
# S2: "storage.private" = { quota-mib = 16 }
# S2: "catalog.read" = { fields = ["rating", "camera"] }
# S2: "catalog.read.location" = true
# S2 ohne Dateibyte-/Bildinhalts-Rollen, nie nativ: net = { hosts = ["models.example.org"], methods = ["GET"], max-bytes = 52428800 }

# ---------- Parameter: einmal deklariert, treiben Uniforms, Panel, Undo, Presets, Stapel-Gruppe ----------
# Param-ID ^[a-z][a-z0-9]*(-[a-z0-9]+)*$, im Edit-State genau so; im WGSL kebab -> snake

[params.strength]
kind    = "float"
min     = 0.0
max     = 100.0
default = 0.0
step    = 1.0
label   = { en = "Strength", de = "Stärke" }

[params.radius]
kind       = "int"
min        = 1
max        = 8
default    = 3
loop-bound = true                     # darf Shader-Schleifen begrenzen (Kostenregel)
label      = { en = "Radius (full-res px)", de = "Radius (Pixel im Original)" }

[params.chroma-only]
kind    = "bool"
default = false
label   = { en = "Colour noise only", de = "Nur Farbrauschen" }

# ---------- Beiträge (sichtbar, bevor Plugin-Code läuft) ----------
[[contributes.panel]]
id     = "main"
location = "editor.right"
after  = "builtin.detail"
title  = { en = "Guided Denoise", de = "Geführte Rauschminderung" }
layout = ["strength", "radius", { section = "advanced", collapsed = true, items = ["chroma-only"] }]

[[contributes.gpu-chain]]             # eine Kette je Hook; Passes in Reihenfolge
hook      = "source"
skip-when = "strength == 0"           # dann fällt die Kette aus dem Graphen (0 GPU-Kosten)

[[contributes.gpu-chain.pass]]
name      = "denoise-h"
kind      = "fragment"
shader    = "shaders/denoise_h.wgsl"
entry     = "lumen_pixel"
inputs    = ["hooked"]
save-as   = "h"
radius-px = "radius"                  # Halo für Kacheln: Konstante oder Param-ID (max. 64)

[[contributes.gpu-chain.pass]]
name      = "denoise-v"
kind      = "fragment"
shader    = "shaders/denoise_v.wgsl"
entry     = "lumen_pixel"
inputs    = ["saved:h", "hooked"]
radius-px = "radius"

[[contributes.command]]
id      = "mrd.guided-denoise.reset"  # muss mit "<plugin-id>." beginnen
menu    = []                          # Untermenüs unterhalb "Plugins → <name>"; leer = direkt dort
context = "editor"                    # "library" | "editor" | "both"
title   = { en = "Reset", de = "Zurücksetzen" }
key     = "ctrl+alt+g"                # nur Vorschlag, standardmäßig aus
enabled-when = "strength > 0"         # Minisprache, siehe unten

[edit-state]
param-version = 2
default-enabled-in-batch = true       # Schritt-Gruppe "plugin:mrd.guided-denoise"

[[migrate]]                           # codefreie Migration für S1 (S2/nativ: exportiertes migrate())
from   = 1
rename = { sigma = "strength" }
scale  = { strength = 100.0 }

[activation]                          # optional; sonst aus `contributes` abgeleitet
on = ["panel:main", "command:mrd.guided-denoise.reset"]
```

Weitere Beitragsarten, alle deklarativ und alle lazy aktiviert:

- `[[contributes.decoder]]` `magic = ["49492a00", "4d4d002a"]`, `extensions = ["nef"]`,
  `role = "fallback"|"primary"`, `priority`, `modes = ["half","full"]`,
  `embedded-preview = true|false`, optional `maker = "Nikon"`
- `[[contributes.cpu-op]]` `slot = "bake"|"export-pre-encode"` (siehe Erweiterungspunkt 8)
- `[[contributes.encoder]]` `id`, `extensions`, Optionen als `params`
- `[[contributes.library-action]]` `selection = { min = 1, max = 10000 }`, `command = …`
- `[[contributes.import-hook]]`, `[[contributes.export-hook]]`
- `[[contributes.metadata]]` `keys = ["x.foo"]`, `badge = "{x.foo}"` (Raster-Abzeichen, Filterfeld)
- `[[contributes.event]]` `names = ["edit-changed", "export-done"]`

**Manifest-Felder (Referenz, vollständig, alle im Schema; alles andere ist wegen
`deny_unknown_fields` ein Fehler):**

| Tabelle | Felder |
|---|---|
| oben | `schema id version tier api lumen license source name description api-experimental` |
| `[files]` | `"<pfad>" = "<sha256 hex>"` |
| `[artifacts]` | `wasm`, `native = { linux-x86_64, windows-x86_64 }` |
| `[capabilities]` | gequotete Rechte-Namen aus der Rechte-Tabelle mit ihrem Bereich |
| `[params.<id>]` | `kind min max default step label loop-bound`, `choices` (`choice`: Liste `{ id, label }`), `points-max` (`curve`, ≤ 16), `log` (Slider logarithmisch) |
| `[[contributes.panel]]` | `id location after title layout notify-on-change describe-affects` |
| `[[contributes.gpu-chain]]` | `hook skip-when`; `[[…pass]]` `name kind shader entry inputs save-as scale radius-px workgroup-cache-radius` |
| `[[contributes.command]]` | `id` (Präfix `<plugin-id>.`), `title`, `menu` (Liste von `LocalizedStr`, Untermenüs **unterhalb** „Plugins → *name*“, den Anfang setzt der Host), `context = "library"\|"editor"\|"both"`, `key` (Vorschlag), `enabled-when` |
| `[[contributes.decoder]]` | `magic` (Hex, ≤ 16 Byte, ≤ 8 Einträge), `extensions`, `role`, `priority` (0–100, Standard 50), `modes` (`half`, `full`), `embedded-preview`, `maker` |
| `[[contributes.cpu-op]]` | `id`, `slot`, `title` |
| `[[contributes.encoder]]` | `id`, `extensions`, `title`, `mime`, `params` (Liste von Param-IDs aus `[params]`) |
| `[[contributes.library-action]]` | `command` (eine eigene Befehls-ID), `selection = { min, max }` |
| `[[contributes.import-hook]]` | `extensions` (optional, Vorfilter) |
| `[[contributes.export-hook]]` | `formats` (Encoder-IDs, leer = alle), `title` |
| `[[contributes.metadata]]` | `keys` (Präfix `x.`), `badge`, `filterable` |
| `[[contributes.event]]` | `names` |
| `[native]` | `memory-mib uses-openmp` (S3) |
| `[edit-state]` | `param-version default-enabled-in-batch` |
| `[[migrate]]` | `from rename scale` |
| `[activation]` | `on` (Liste aus `panel:<id>`, `command:<id>`, `decoder`, `import`, `export`, `event:<name>`) |

**Ausdrucks-Minisprache** (`skip-when`, `enabled-when`), vom Host ausgewertet, ohne
Seiteneffekte:

```ebnf
expr    = or ;
or      = and { "||" and } ;
and     = unary { "&&" unary } ;
unary   = "!" unary | cmp ;
cmp     = atom [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) atom ] ;
atom    = number | "true" | "false" | string | ident | "(" expr ")" ;
ident   = param-id | "selection" | "editor" | "library" ;
number  = [ "-" ] digit { digit } [ "." digit { digit } ] ;
string  = '"' { char ohne '"' und '\' } '"' ;      (* nur gegen choice-IDs *)
```

`param-id` meint die eigenen Params im Edit-State des offenen Bildes; `selection` ist die
Zahl der ausgewählten Bilder; `editor`/`library` sind wahr, wenn diese Ansicht aktiv ist.
`skip-when` darf nur Param-IDs und Literale nutzen. Länge ≤ 256 Zeichen, Tiefe ≤ 8;
Typfehler sind Manifest-Fehler.

**Reservierte Publisher-Präfixe** (Entscheidung des Builders): `lumen`, `builtin`, `core`,
`plugin`, `system`, `mrd` (Manuel). Sonst vergibt der Server ein Präfix beim ersten
Schlüssel-Registrieren je Keycloak-Konto (wer zuerst kommt). Der gemeinsame
Client-Validator (`lumen-plugin-manifest`) lehnt reservierte Präfixe **auch bei der
Datei-Installation** ab, außer das Manifest ist mit einem einkompilierten, Root-zertifizierten
Schlüssel signiert (in v1 Manuels `mrd`-Schlüssel) oder kommt über `--dev-plugins` mit
Dev-Signatur. **Befehls-IDs** müssen mit `<plugin-id>.` beginnen; `CommandBus::register`
erzwingt das, sodass `builtin.*` nur eingebauten Befehlen gehört. **Gleiche ID, anderer
Herausgeber:** Bringt eine Datei-Installation eine schon installierte ID mit abweichendem oder
fehlendem Publisher-Schlüssel (`publisher_key` in der Zustimmungsdatei), gilt sie als
Neuinstallation mit der Warnung „anderer Herausgeber als die installierte Version“; sie
ersetzt nie still, und die Edit-State-Einträge gehen erst nach dieser Zustimmung an sie.

## Erweiterungspunkte

Grundsatz: **Die App spricht mit Registries, nicht mit Plugins.** Jeder Erweiterungspunkt
ist ein Trait mit Registry im zuständigen Crate. Die eingebauten Funktionen registrieren
sich über dieselben Traits. Dadurch ist „keine Plugins“ der normale, von den Goldens
abgedeckte Codepfad, und die Crates bleiben ohne Plugin-Host testbar. Die UI ruft nie
selbst Plugin-Code auf; alle Plugin-Aufrufe laufen auf einem eigenen Worker-Pool
(`lumen-plugin-host::exec`), dessen Größe das globale `CpuBudget` vorgibt (Abschnitt
„CPU-Budget“), getrennt von Decode und Export.

Für jede Rolle gibt es **eine kanonische Schnittstelle** (die Rust-Traits unten). WIT und
C-ABI sind daraus abgeleitet und haben dieselben Funktionen und dieselbe Allokationsregel:
**Ausgaben nur in Puffer, die der Host bereitstellt** (`ImageSink`/`image-sink`/`alloc_image`
für Bilder, `Write`/`byte-sink`/`emit_bytes` für Bytes).

| Rolle | Rust (kanonisch) | WIT | C |
|---|---|---|---|
| Decoder | `probe`, `embedded_preview`, `decode(src, mode, sink, cx) -> RawMeta` | `decoder.probe/embedded-preview/decode` | `LumenDecoderVtableV1` |
| Metadaten | `read_meta(src) -> Vec<(Key, Value)>` | `metadata.read-meta` | `LumenMetadataVtableV1` |
| CPU-Schritt | `plan(p) -> TilePlan`, `process_tile(src, dst, tile, p, cx)` | `cpu-op.plan/process-tile` | `LumenCpuOpVtableV1` |
| Encoder | `encode(rows, icc, exif, opts, out, cx)`; Optionen aus Manifest-`params` | `encoder.encode` | `LumenEncoderVtableV1` |
| Param-Migration | `migrate(from_v, params) -> params` | `params-migrate.migrate` | `LumenPluginDescV1.migrate` |
| Befehle/Panels/Hooks | `LibraryAction`, `ImportHook` (`on_candidates`, `on_imported`), `ExportHook`, Ereignisse, `Widget` | `workflow-plugin` (`on-import-candidates`, `on-imported`, `widget` mit `log`/`style`/`collapsible`/`collapsed`, Texte als `localized`) | – (nativ nicht vorgesehen) |

Abgleich der Einzelheiten (normativ, gilt vor dem Einfrieren der ABI in N11c):

| Punkt | Regel |
|---|---|
| Decoder-Priorität | kommt aus dem Manifest (`priority`), nicht aus `probe`. `Claim` ist in Rust, WIT und C nur `No`/`Fallback`/`Primary`; die Registry ordnet Primary-Decoder je Dateityp nach Nutzerwahl (Einstellungen → Decoder), dann `priority`, dann Plugin-ID; Fallback-Decoder ebenso nach `priority`, dann ID. Eingebautes LibRaw = `Primary`, Priorität 0 |
| Decode-Modus | nur `Half`/`Full` (Rust `DecodeMode`, WIT `mode`, C `LUMEN_MODE_HALF = 1`, `LUMEN_MODE_FULL = 2`; 0 bleibt frei). Die eingebettete Vorschau ist ausschließlich die eigene Methode `embedded_preview` |
| Import-Abschluss | `on_imported(ids)` gibt es in allen drei Fassungen (WIT `on-imported`, nativ ohnehin nicht vorgesehen) |
| Param-Zahlentypen | überall `f32` und `i32` (Rust `ParamValue`, WIT `float(f32)`/`int(s32)`, C `float f; int32_t i;`); im JSON des Edit-State als JSON-Zahl, beim Laden auf `f32`/`i32` gerundet und geklemmt; `choice` im JSON als Choice-ID, in WIT/C/WGSL als Index in `choices` |
| JSON über die C-ABI | normativ, UTF-8, Schlüssel genau wie unten; unbekannte Schlüssel → `INVALID` |

`LUMEN_BYTES_RAW_META_JSON` (Schlüssel wie die WIT-Felder, kebab-case):

```json
{ "make": "Nikon", "model": "Z 6_3", "iso": 400, "exposure": 0.004, "orientation": 1,
  "wb": [2.01, 1.0, 1.43],
  "compression": { "kind": "lossless" },
  "extra": [["Exif.Photo.LensModel", "NIKKOR Z 24-120mm f/4 S"]] }
```

`compression` ist `null` oder `{ "kind": "lossless"|"lossy"|"uncompressed"|"high-efficiency"|
"high-efficiency-star" }` bzw. `{ "kind": "unknown", "code": 7 }`; `wb` = drei Multiplikatoren
R, G, B (G = 1). `iso`/`exposure` dürfen `null` sein.

`LUMEN_BYTES_PARAMS_JSON` (Eingang und Ausgabe von `migrate`): ein **Objekt** wie
`params` im Edit-State, z. B. `{ "strength": 35, "radius": 3, "chroma-only": false }`;
`color` als `[r, g, b]`, `curve` als `[[x, y], …]`, `choice` als Choice-ID-String.
`LUMEN_BYTES_META_JSON`: Liste `[["x.foo", "wert"], …]`.

### 1. Befehle und Menüs (app)

```rust
pub struct Command {
    pub id: CommandId,                 // "builtin.flag.pick" | "mrd.guided-denoise.reset" (Präfix = Plugin-ID, erzwungen)
    pub title: LocalizedStr,
    pub menu_path: Vec<LocalizedStr>,  // Untermenüs aus dem Manifest; der Host setzt "Plugins → <Name>" davor
    pub context: Context,              // Library | Editor | Both
    pub enabled_when: Option<Expr>,    // vom Host ausgewertet: "selection > 0", "editor"
    pub source: CommandSource,         // Builtin | Plugin { id, tier }
}
pub trait CommandBus {
    fn register(&mut self, c: Command) -> Result<(), CommandError>;
    fn dispatch(&self, id: &CommandId, cx: &InvokeCx) -> JobHandle; // prägt UserActionToken bei Nutzeraktion
}
```

- `egui::MenuBar` in `Panel::top`. Plugin-Befehle stehen nur unter **Plugins → <Name> → …**
  und im Untermenü „Plugins“ von Kontextmenüs (Raster-Kachel, Editor). Plugins können
  nicht in eingebaute Menüs einfügen (kein gefälschtes „Exportieren“ oder „Konto“).
- Menüeinträge kommen aus dem Manifest. Um ein Menü zu zeigen, wird nichts aktiviert.
- Jeder Befehl läuft als Job (derselbe Mechanismus wie Stapel-Export). Nach **300 ms** zeigt
  die UI Fortschritt und Abbrechen (reine Anzeige-Schwelle); nach **2 s** greift die erste
  weiche Deadline-Prüfung aus „Grenzen je Aufruf“ (verlängert nur bei steigendem `done`).

### 2. Tastenkürzel (lumen-core `library_keys` + app)

- `library_keys` (Port von `libraryKeys.ts`) liefert **Befehls-IDs** statt direkt Aktionen.
- Plugins **schlagen** nur eine Belegung für eine Befehls-ID vor. Eingebaute Tasten
  gewinnen; vorgeschlagene Belegungen sind aus, bis der Nutzer sie unter
  Einstellungen → Tastenkürzel annimmt. Konflikte werden dort gelistet.
- Die Sperrregeln (`isShortcutBlocked`: Eingabefeld fokussiert,
  `ctx.egui_wants_keyboard_input()`, offenes Popup, Esc-Reihenfolge) gelten ohne Ausnahme.

### 3. Panels mit Reglern (app, deklarativ)

Der Host zeichnet alles. Plugins bekommen nie ein `egui::Ui`, das `wgpu::Device` oder
SQLite-Handles. Das hält den Frame unter Host-Kontrolle (UI-CPU ~1 ms/Frame, SR:11),
schützt Plugins vor egui-Brüchen je Minor-Version (SR:72) und liefert Undo, Presets,
Bypass je Plugin, Doppelklick-auf-Standard, Tastatur-Schritte, AccessKit-Labels und
Theme gratis.

**Dogfooding (N3):** Die eingebauten Sidebar-Sektionen (Ton, Farbe, HSL, Detail, …) werden
als dieselben `PanelDesc`-Daten beschrieben und vom selben `DeclarativePanel`-Renderer
gezeichnet. Was die eingebauten brauchen (Kurve, HSL-Tabs), bekommen Plugins auch.

```rust
pub enum Widget {
    Slider { param: ParamId, log: bool },
    Stepper { param: ParamId },
    Checkbox { param: ParamId },
    Choice { param: ParamId, style: ChoiceStyle },   // Combo | Segmented
    Color { param: ParamId },
    Curve { param: ParamId },                         // gleicher Editor wie die Tonkurve, ≤ 16 Punkte
    Button { label: LocalizedStr, command: CommandId },
    Label { text: LocalizedStr },                     // Klartext, nie Markup
    Separator,
    Section { title: LocalizedStr, collapsible: bool, collapsed: bool },
}
pub struct PanelDesc { pub id: PanelId, pub title: LocalizedStr, pub location: PanelLocation,
                       pub after: Option<PanelId>, pub nodes: Vec<Node> }   // flach, Index-Baum
pub struct Node { pub parent: Option<u32>, pub widget: Widget, pub visible: bool, pub enabled: bool }
```

- v1 **ohne** Texteingabe, ohne von Plugins gelieferte Bilder, ohne Toasts. Das schließt
  Phishing-Panels („Passwort eingeben“) aus. Kommt Texteingabe später, dann nur in einem
  vom Host gezeichneten Rahmen „Plugin X fragt“.
- Max. 64 Knoten je Panel, Labels max. 64 Zeichen, Panel-Kopf zeigt immer Plugin-Name +
  Stufen-Abzeichen (nicht überschreibbar).
- S1-Panels entstehen automatisch aus `params` + `layout`. S2 darf zusätzlich
  `describe(panel, params) -> list<node>` exportieren (Sichtbarkeit/Aktivierung dynamisch).
  Aufruf off-thread mit 50 ms Deadline, **höchstens ein laufender Aufruf je Panel**; neuere
  Param-Stände ersetzen wartende (latest wins). Während eines Zieh-Vorgangs wird nur
  aufgerufen, wenn der gezogene Param in `describe-affects` steht. Bis zur Antwort bleibt
  der alte Baum stehen. Die UI wartet nie.
- **Ein Reglerwert ändert nur Daten:** Er schreibt `EditState.plugins[id].params[p]`,
  markiert den Frame schmutzig und aktualisiert die Pass-Uniforms im selben Frame. Kein
  Plugin-Aufruf im Live-Pfad. S2 wird nur asynchron benachrichtigt, wenn das Panel
  `notify-on-change = true` setzt (gleiche Bündelung wie `describe`).

### 4. Bibliotheks- und Stapel-Aktionen (lumen-catalog + app)

```rust
pub trait LibraryAction: Send + Sync {
    fn run(&self, selection: &[ImageId], cx: &TaskCx) -> Result<BatchReport, PluginError>;
}
pub struct BatchReport { pub ok: u32, pub failed: u32, pub message: Option<String> }
```

- Kontextmenü der Raster-Kachel und Auswahlleiste; läuft als Hintergrundjob mit
  Fortschritt und Abbrechen.
- Lesen über `catalog.read` (gefilterte Felder), Schreiben (Sterne, Label, Markierung,
  Plugin-Meta, eigene Edit-Parameter) über rückgängig machbare Host-Befehle. Nie SQLite direkt.
- Batch-Apply von Presets behandelt jedes Plugin als dynamische Schritt-Gruppe
  `plugin:<id>` (siehe Edit-State).

### 5. Import-Hooks (lumen-catalog)

```rust
pub struct ImportCandidate<'a> { pub head: &'a [u8], pub ext: &'a str, pub file_name: &'a str } // head ≤ 64 B
pub trait ImportHook: Send + Sync {
    fn on_candidates(&self, c: &[ImportCandidate]) -> Vec<ImportVerdict>; // Accept | Skip, je Kandidat
    fn on_imported(&self, ids: &[ImageId]);                               // fire-and-forget
}
```

- Sitzt im Import-Walker und im `notify`-Watcher. Bündel zu 256 Kandidaten, Deadline je
  Bündel 256 × 5 ms = 1,28 s (mit 1-ms-Epochen durchsetzbar); bei Zeitüberschreitung gilt
  `Accept` für das Bündel, Strike. Liegt ein Hook im Mittel über 1 ms je Kandidat, wird er
  für den Rest des Imports übersprungen (Hinweis). Schlimmster Fall 5 000 Dateien ×
  2 Hooks × 5 ms = 50 s, parallel im Pool weniger; der Erstimport bleibt ≤ 3 min (DS).
- Nur die ersten 64 Byte (Magic) + Endung + Basename, nie der Pfad. Originale nur lesend.

### 6. RAW-Decoder (lumen-raw)

```rust
pub enum Claim { No, Fallback, Primary }   // Priorität aus dem Manifest; eingebautes LibRaw = Primary, priority 0
pub enum DecodeMode { Half, Full }         // eingebettete Vorschau nur über embedded_preview

pub trait Decoder: Send + Sync {
    fn id(&self) -> &str;
    fn probe(&self, head: &[u8], ext: &str) -> Claim;                  // head = erste 4 KiB
    fn embedded_preview(&self, src: &RawSource) -> Result<Option<Vec<u8>>, RawError>; // JPEG, vom Host neu dekodiert
    fn decode(&self, src: &RawSource, mode: DecodeMode, cx: &TaskCx, out: &mut dyn ImageSink)
        -> Result<RawMeta, RawError>;
}
pub trait MetadataReader: Send + Sync {
    fn read_meta(&self, src: &RawSource, cx: &TaskCx) -> Result<Vec<(MetaKey, MetaValue)>, RawError>;
}
pub struct RawSource { /* memmap2::Mmap (read-only) + Basename; nativ: Datei-Handle */ }
pub trait ImageSink { fn alloc(&mut self, w: u32, h: u32, f: PixelFormat) -> Result<&mut [u16], RawError>; }
pub struct DecoderRegistry { /* geordnet nach Claim; LibRawDecoder eingebaut */ }
```

- `lumen-raw::decode()` bleibt und wird zum eingebauten `LibRawDecoder`. Die
  Magic-Byte-Erkennung aus `raw.ts` wird zu dessen `probe`.
- **Ausgabe-Normalisierungsvertrag** (normativ, Entscheidung des Builders): Jeder Decoder
  liefert RGB16 mit sRGB-Primärfarben, angewendetem Kamera-WB und dieser Kodierung:
  - **Kurve** = LibRaw-Standard `gamm[0] = 0.45`, `gamm[1] = 4.5` (BT.709-artig, linearer
    Abschnitt mit Steigung 4,5 nahe Schwarz, darüber Potenz 0,45; LibRaw `gamma_curve(0.45,
    4.5, …)`), nicht die sRGB-Formel.
  - **Weißpunkt (Auto-Bright)**: Je Kanal ein Histogramm der linearen 16-bit-Werte nach
    WB-Skalierung und Farbmatrix (also linear im sRGB-Ausgaberaum) in 8192 Klassen (`v >> 3`). Von oben werden Pixel aufsummiert, bis die
    Summe `thr · W · H` übersteigt (`thr = 0.005`, `W·H` = Ausgabemaße, bei `Half` also halbiert);
    die erreichte Klasse ist `val_c`. `white = max_c(val_c) · 8`; Ausgabe =
    `kurve(min(1, linear / white)) · 65535`. Das entspricht LibRaw `convert_to_rgb` +
    `gamma_curve(…, (white << 3) / bright)` mit `bright = 1`.
  Damit sehen
  Presets mit jedem Decoder gleich aus. Konformanztest gegen LibRaw an den lossless-Fixtures
  in `tests-fixtures/raw-samples` (Startwert Toleranz 2/255 wie die Goldens, am
  `libraw-runner` in N11c festgelegt); für Dateien, die LibRaw nicht öffnet, nur
  Strukturprüfung (Maße, Wertebereich, Orientierung).
- **Kein stilles Überschreiben von LibRaw.** `Fallback` läuft nur, wenn LibRaw scheitert
  (genau der HE/HE★-Fall: `Unsupported file format`, SR). `Primary` über LibRaw braucht
  die Bestätigung des Nutzers **je Dateityp** (Einstellungen → Decoder).
- **Herabstufung relativ, nicht absolut:** Ein `Primary`-Decoder wird gegen den eingebauten
  `LibRawDecoder` auf demselben Gerät und derselben Dateiklasse (Kamera, Kompression) in
  ns je Megapixel gemessen. Ist er bei 5 Vordergrund-Decodes in Folge (nicht während
  Import oder Vorschaubild-Erzeugung) mehr als 1,5× langsamer, wird er auf „nur Fallback“
  herabgestuft (Banner mit Grund). `Fallback`-Decoder werden nicht herabgestuft (es gibt
  keine Alternative), nur mit Zeitangabe gekennzeichnet.
- S2-Decoder bekommen Bytes über `bytes-source.read` (kopiert, ≤ 16 MiB je Aufruf) und
  schreiben Zeilen per `write-rows-u16` (kein f32-Umweg). Erwartbar 2,5–3,5 s für einen
  vollen Z6III-Decode (Schätzung, nicht gemessen). Sie dürfen die Stufe „bearbeitbar < 1 s“
  nicht beanspruchen; die eingebettete Vorschau bleibt sichtbar, Abzeichen
  „Plugin-Decoder (Sandbox)“.
- Native Decoder (S4 jetzt, S3 später) bekommen ein **Lese-Handle** auf das Original, das der
  Host öffnet (`file_map`), und schreiben über `alloc_image` direkt in Host-Speicher (S4)
  bzw. den Shared-Memory-Ring (S3).
- Die Host-Seite prüft jede Antwort: Maße ≤ 16384², Länge = `w·h·3`, Meta ≤ 64 KiB.

### 7. GPU-Pass (lumen-gpu) → eigener Abschnitt „GPU-Pass-API und Budget“

### 8. CPU-Schritt (lumen-export, „Backen“)

```rust
pub struct TilePlan { pub tile_size: u32, pub halo: u32, pub parallel_safe: bool }
pub trait CpuOp: Send + Sync {
    fn plan(&self, p: &ParamValues) -> TilePlan;
    fn process_tile(&self, src: &ImageView, dst: &mut ImageViewMut, tile: Rect,
                    p: &ParamValues, cx: &TaskCx) -> Result<(), PluginError>;
}
```

**Semantik von `src`, `dst`, `tile`** (normativ, alle drei Fassungen):

- `tile` steht in **Bildkoordinaten** des ganzen Bildes; Kacheln überdecken das Bild lückenlos
  ohne Überlappung, Randkacheln sind kleiner.
- `dst` ist **genau die Kachel** (`tile.w × tile.h`, Ursprung = `tile.x, tile.y`).
- C: `src` ist **Kachel + Halo** als eine `LumenImageView` der Größe
  `(tile.w + 2·halo) × (tile.h + 2·halo)`; Pixel (0, 0) von `src` = Bildpixel
  `(tile.x − halo, tile.y − halo)`; außerhalb des Bildes randwiederholt (clamp-to-edge).
- WIT: `image-src.dims` ist das ganze Bild, `read-tile` nimmt Bildkoordinaten, aber nur
  innerhalb von `tile` ± `halo` (geklemmt aufs Bild); alles andere → `invalid-input`. So
  bleibt das Ergebnis von der Kachelung unabhängig (Konformanztest „ohne Kachelnähte“).
- Pixelformate je Slot: `bake` **RGB16 rein** (Decoder-Ausgabe nach Ausgabevertrag),
  **RGBA16F raus**; `export-pre-encode` **RGBA16F rein und raus** (sRGB-kodiert, nach dem
  `output`-Hook).

Zwei Slots, nie im Live-Pfad:

- **`bake`** (Entscheidung des Builders): Das Ergebnis **ersetzt die dekodierte Quelle** und
  liegt damit vor dem S1-Hook `source` und vor dem Kern-Shader. Gespeichert als
  `RGBA16F`-Datei in `~/.cache/lumen/bake/` (Windows `%LOCALAPPDATA%\Lumen\cache\bake\`),
  Schlüssel `(Inhalts-Hash des Originals, Decoder-ID, Decoder-Version bzw. Artefakt-Hash,
  Decode-Modus, plugin_id, Artefakt-Hash, params_hash)`, LRU mit 4 GiB Obergrenze. Wechselt
  der Decoder (anderes Plugin, Primary ↔ Fallback, LibRaw-Update), ist der Eintrag damit
  ungültig. Ändert sich ein Bake-Param, wird beim Loslassen im Hintergrund neu
  gebacken; bis dahin zeigt der Editor das alte Ergebnis mit Abzeichen „wird berechnet“.
  **Höchstens ein aktives Bake-Plugin je Bild** (v1): Aktiviert der Nutzer ein zweites, fragt
  der Host, welches gelten soll, und schaltet das andere für dieses Bild ab (Werte bleiben).
  Ein Bake hängt damit nur vom dekodierten Original und den eigenen Params ab. Eine Kette
  mehrerer Bake-Schritte (mit Vorgänger-Hashes im Schlüssel) ist eine spätere API-Version.
- **`export-pre-encode`**: läuft im Export auf dem fertigen Bild vor dem Encoder; mehrere
  Plugins in der Reihenfolge aus „Reihenfolge mehrerer Plugins“ (Edit-State).

- S2: der Host kachelt nach `plan` (≈ 512² + Halo) und betreibt N Instanzen derselben
  Komponente parallel, je eine `Store` (Pooling-Allocator). Das ersetzt die fehlenden
  WASM-Threads. N kommt aus dem `CpuBudget` (Export-Anteil) und der Speichergrenze
  (Abschnitt „Grenzen je Aufruf“).
- Nativ: das Plugin darf Threads/OpenMP nutzen, `worker_threads()` gibt das Budget vor.

### 9. Export-Formate und Nach-Export (lumen-export)

```rust
pub trait Encoder: Send + Sync {
    fn id(&self) -> &str;
    fn extensions(&self) -> &[&str];
    fn encode(&self, rows: &mut dyn RowSource, icc: &[u8], exif: &[u8], opts: &ParamValues,
              out: &mut dyn Write, cx: &TaskCx) -> Result<(), PluginError>;
}
pub trait ExportHook: Send + Sync {
    fn on_export_done(&self, files: &[ReadHandle], token: &UserActionToken, cx: &TaskCx);
}
```

- Optionen des Encoders sind Manifest-`params` (deklaratives Optionen-Panel), keine Funktion.
- Der Host schreibt die Datei; der Encoder bekommt nur einen Schreibstrom. Kein FS-Recht nötig.
- `on_export_done` bekommt Lese-Handles + Basenames der gerade geschriebenen Dateien und
  das Token des Export-Jobs (für ein `net`-Plugin „hochladen nach X“). Ortsdaten siehe
  „Ortsdaten“.

### 10. Metadaten (lumen-raw + lumen-catalog)

- `MetadataReader::read_meta` läuft in einer eigenen Welt ohne Ausleitungsweg. Ablage in
  `plugin_meta(image_id, plugin_id, key, value)`, Wert ≤ 4 KiB, ≤ 64 Schlüssel je Plugin
  und Bild, Budget 20 ms je Datei (1-ms-Epochen).
- Läuft **nach** dem Import als Hintergrundjob niedriger Priorität, nicht im Import selbst;
  der Import ist ohne sie fertig (Abzeichen „Metadaten folgen“). Schreiben gebündelt je
  256 Dateien in einer Transaktion.
- Raster-Abzeichen und Filterfelder kommen aus dem Manifest (`badge = "{key}"`).

### 11. Ereignisse (app EventBus)

Ereignisse sind typisierte Records (WIT `event`), kein freies JSON:

| Ereignis | Nutzlast | Zusatz nur mit Recht |
|---|---|---|
| `image-opened` | `image-id` | – |
| `selection-changed` (100 ms entprellt) | Anzahl | IDs nur mit `catalog.read` |
| `edit-changed` (250 ms wie die History) | `image-id` | eigene Params über `edit-own.get` |
| `import-done`, `export-done` | Anzahl | – |
| `app-start`, `app-stop` | – | – |

Asynchron, fire-and-forget, Warteschlange 32 je Plugin, älteste fallen raus (Zähler im
Inspektor). Ereignisse tragen nie ein Nutzeraktions-Token.

## WIT-World-Skizze

Ablage `desktop/crates/lumen-plugin-api/wit/since_v0.1.0/*.wit`, Paket `lumen:plugin@0.1.0`.
Wie bei Zed bekommt jede Minor-Version einen eigenen Ordner; der Host hält je unterstützter
Version ein `wasmtime::component::bindgen!`-Modul und wählt anhand von `api` im Manifest.
WASI 0.2 mit **synchronen Exporten**, Aufrufe vom Worker-Pool. WASI 0.3 (`stream<T>`,
`async func`) erst in einer späteren API-Version, wenn `wasm32-wasip3` Tier 2 ist.

**Getrennte Welten je Rolle** halten die Import-Fläche klein: Ein Decoder kann `catalog`
oder `http` nicht einmal benennen. Ein Paket mit mehreren Rollen bekommt eine Welt, die die
Rollen-Welten per `include` vereint; die Ausleitungs-Regel verhindert, dass Dateibytes oder
Bildinhalte (Decoder, Metadaten, Originale, Encoder, CPU-Schritt) und Netz bzw. Zwischenablage
in einer Komponente zusammentreffen. Die feste Basis jeder Welt sind ihre Importe
ohne Rechte-Bezug (`types`, `log`, `task`, `image`/`files` je Rolle,
in `workflow-plugin` zusätzlich `settings`, `user-action`, `events`, `ui-types`, `files`);
`files` und `image` enthalten nur Ressourcentypen, ein Handle gibt es nur aus einem
Host-Aufruf, für den das passende Recht gewährt ist. Das SDK-Makro wählt die Welt aus den
implementierten Rollen; `lumen-plugin check` gleicht sie mit `contributes` ab. Alle Welten
bekommen zusätzlich die Basis-WASI (oben).

```wit
package lumen:plugin@0.1.0;

interface types {
  type image-id = u64;
  record dims { width: u32, height: u32 }
  record rect { x: u32, y: u32, width: u32, height: u32 }
  enum pixel-format { rgb16, rgba16f, rgba32f, bayer16 }
  variant param-value { float(f32), int(s32), boolean(bool), color(tuple<f32, f32, f32>),
                        choice(u32), curve(list<tuple<f32, f32>>) }
  record param { id: string, value: param-value }
  variant plugin-error { invalid-input(string), unsupported(string), cancelled, internal(string) } // Text ≤ 1 KiB
  record localized { en: string, de: option<string> }   // = LocalizedStr
}

interface log { enum level { debug, info, warn, error } emit: func(l: level, msg: string); }

interface task {                                  // in jeden langen Aufruf gereicht
  resource ctx {
    progress: func(done: u64, total: u64);        // total konstant je Aufruf, done steigend
    is-cancelled: func() -> bool;
  }
}

interface image {                                 // Host-eigen; alle Handles enden mit dem Aufruf
  use types.{dims, rect, pixel-format, plugin-error};
  resource image-src {                            // nur lesen
    dims: func() -> dims;
    format: func() -> pixel-format;
    read-tile: func(r: rect) -> result<list<f32>, plugin-error>;      // r ≤ 2048² und ≤ 64 MiB
    read-tile-u16: func(r: rect) -> result<list<u16>, plugin-error>;  // rgb16/bayer16; rgba16f als Halbfloat-Bits
  }
  resource image-dst {                            // nur schreiben
    dims: func() -> dims;
    format: func() -> pixel-format;
    write-tile: func(r: rect, px: list<f32>) -> result<_, plugin-error>;
    write-tile-u16: func(r: rect, px: list<u16>) -> result<_, plugin-error>;
    write-rows-u16: func(y: u32, px: list<u16>) -> result<_, plugin-error>; // Zeilenstrom, ≤ 64 MiB je Aufruf
  }
  resource image-sink {                           // einmal je Aufruf
    alloc: func(d: dims, f: pixel-format) -> result<image-dst, plugin-error>;
  }
  resource row-source {                           // Encoder-Eingang
    dims: func() -> dims;
    format: func() -> pixel-format;
    next-rows: func(max-rows: u32) -> list<u16>;  // leer = Ende
  }
}

interface files {                                 // nur Ressourcentypen, keine Funktion liefert ein Handle;
  use types.{plugin-error};                       // Handles kommen nur aus Host-Aufrufen (Basis jeder Welt)
  resource bytes-source {                         // Lesesicht auf Dateibytes, nie ein Pfad
    len: func() -> u64;
    read: func(offset: u64, len: u32) -> list<u8>; // len ≤ 16 MiB
    file-name: func() -> string;                  // nur Basename
  }
  resource byte-sink { write: func(b: list<u8>) -> result<_, plugin-error>; } // ≤ 16 MiB je Aufruf
}

interface params-migrate {
  use types.{param, plugin-error};
  migrate: func(from-v: u32, p: list<param>) -> result<list<param>, plugin-error>;
}

interface user-action { resource token; }         // undurchsichtig, nur vom Host geprägt

interface settings { get: func(key: string) -> option<string>; set: func(key: string, v: string); }

interface catalog {                               // nur mit catalog.*; nicht gewährte Felder = none
  use types.{image-id, plugin-error};
  enum flag { none, pick, reject }
  record image-info { id: image-id, file-name: option<string>, rating: option<u8>,
                      color-label: option<string>, flag: option<flag>, camera: option<string>,
                      lens: option<string>, capture-time: option<string>,
                      location: option<tuple<f64, f64>> }   // nur mit catalog.read.location
  get: func(ids: list<image-id>) -> list<image-info>;
  set-rating: func(id: image-id, r: u8) -> result<_, plugin-error>;            // rückgängig machbar
  set-label: func(id: image-id, l: option<string>) -> result<_, plugin-error>;
  set-flag: func(id: image-id, f: flag) -> result<_, plugin-error>;
  get-plugin-meta: func(id: image-id, key: string) -> option<string>;          // nur eigene Schlüssel
  set-plugin-meta: func(id: image-id, key: string, v: string) -> result<_, plugin-error>;
}

interface edit-own {                              // edit.write own
  use types.{image-id, param, plugin-error};
  get: func(id: image-id) -> list<param>;
  set: func(id: image-id, p: list<param>) -> result<_, plugin-error>;  // gegen Deklaration geprüft
}

interface edit-adjustments {                      // edit.write adjustments
  use types.{image-id, plugin-error};
  set-adjustment: func(id: image-id, key: string, v: f32) -> result<_, plugin-error>;
}

interface originals {                             // originals.read
  use types.{image-id, plugin-error}; use files.{bytes-source}; use user-action.{token};
  open: func(t: borrow<token>, id: image-id) -> result<bytes-source, plugin-error>;
}

interface fs-pick {                               // fs.pick
  use types.{plugin-error}; use files.{bytes-source, byte-sink}; use user-action.{token};
  resource dir-handle { create: func(file-name: string) -> result<byte-sink, plugin-error>; } // nur neue Dateien
  pick-read: func(t: borrow<token>, filter: list<string>) -> option<bytes-source>;
  pick-write: func(t: borrow<token>, suggested-name: string, filter: list<string>) -> option<byte-sink>;
  pick-dir: func(t: borrow<token>) -> option<dir-handle>;
}

interface clipboard {                             // clipboard.write
  use user-action.{token};
  write-text: func(t: borrow<token>, s: string) -> result<_, string>;  // ≤ 64 KiB
}

interface http {                                  // nur mit `net`
  use user-action.{token};
  record request { method: string, url: string, headers: list<tuple<string, string>>, body: option<list<u8>> }
  record response { status: u16, headers: list<tuple<string, string>>, body: list<u8> }
  fetch: func(t: borrow<token>, r: request) -> result<response, string>;
}

interface ui-types {                              // = Rust Widget/Node
  use types.{localized};
  enum choice-style { combo, segmented }
  record slider-w { param: string, log: bool }
  record choice-w { param: string, style: choice-style }
  record button-w { label: localized, command: string }
  record section-w { title: localized, collapsible: bool, collapsed: bool }
  variant widget { slider(slider-w), stepper(string), checkbox(string), choice(choice-w),
                   color(string), curve(string), button(button-w), label(localized), separator,
                   section(section-w) }
  record node { parent: option<u32>, w: widget, visible: bool, enabled: bool }
}

interface events {
  use types.{image-id};
  variant event { image-opened(image-id), selection-changed(tuple<u32, option<list<image-id>>>),
                  edit-changed(image-id), import-done(u32), export-done(u32), app-start, app-stop }
}

world decoder-plugin {                            // raw.decode
  import log; import task; import image; import files;
  export params-migrate;
  export decoder: interface {
    use types.{plugin-error}; use image.{image-sink}; use files.{bytes-source}; use task.{ctx};
    enum mode { half, full }                      // eingebettete Vorschau nur über embedded-preview
    enum claim { no, fallback, primary }
    variant compression { lossless, lossy, uncompressed, high-efficiency, high-efficiency-star, unknown(u16) }
    record raw-meta { make: string, model: string, iso: option<u32>, exposure: option<f32>,
                      orientation: u8, wb: tuple<f32, f32, f32>, compression: option<compression>,
                      extra: list<tuple<string, string>> }          // vom Host gefiltert
    probe: func(head: list<u8>, ext: string) -> claim;
    embedded-preview: func(src: borrow<bytes-source>) -> result<option<list<u8>>, plugin-error>;
    decode: func(src: borrow<bytes-source>, m: mode, out: borrow<image-sink>, c: borrow<ctx>)
            -> result<raw-meta, plugin-error>;   // RGB16 nach Ausgabevertrag
  }
}

world metadata-plugin {                           // metadata
  import log; import task; import files;
  export metadata: interface {
    use types.{plugin-error}; use files.{bytes-source}; use task.{ctx};
    read-meta: func(src: borrow<bytes-source>, c: borrow<ctx>) -> result<list<tuple<string, string>>, plugin-error>;
  }
}

world image-op-plugin {                           // image.process cpu-op
  import log; import task; import image;
  export params-migrate;
  export cpu-op: interface {
    use types.{param, rect, plugin-error}; use image.{image-src, image-dst}; use task.{ctx};
    record tile-plan { tile-size: u32, halo: u32, parallel-safe: bool }
    plan: func(p: list<param>) -> tile-plan;
    process-tile: func(src: borrow<image-src>, dst: borrow<image-dst>, tile: rect,
                       p: list<param>, c: borrow<ctx>) -> result<_, plugin-error>;
  }
}

world encoder-plugin {                            // export.encoder
  import log; import task; import image; import files;
  export encoder: interface {
    use types.{param, plugin-error}; use image.{row-source}; use files.{byte-sink}; use task.{ctx};
    encode: func(rows: borrow<row-source>, icc: list<u8>, exif: list<u8>, opts: list<param>,
                 out: borrow<byte-sink>, c: borrow<ctx>) -> result<_, plugin-error>;
  }
}

world workflow-plugin {                           // Befehle, Panels, Hooks
  // Basis (immer gelinkt): types, log, task, settings, user-action, events, ui-types, files
  import log; import task; import settings; import user-action; import events; import ui-types;
  import files;
  // optional: als import deklariert, damit der Gast Bindings erzeugen kann; gelinkt nur bei
  // Grant. wit-component entfernt nicht genutzte Importe, die Prüfung läuft gegen die
  // verbliebene Import-Liste (siehe „Statische Durchsetzung“).
  import catalog; import edit-own; import edit-adjustments; import originals;
  import fs-pick; import clipboard; import http;
  export params-migrate;
  export plugin: interface {
    use types.{param, image-id, plugin-error}; use ui-types.{node}; use events.{event};
    use task.{ctx}; use user-action.{token}; use files.{bytes-source};
    record report { ok: u32, failed: u32, message: option<string> }
    record candidate { head: list<u8>, ext: string, file-name: string }   // head ≤ 64 B
    activate: func(api-minor: u16) -> result<_, plugin-error>;
    run-command: func(id: string, selection: list<image-id>, t: borrow<token>, c: borrow<ctx>)
                 -> result<report, plugin-error>;
    on-event: func(e: event);                                      // kein Token
    on-import-candidates: func(c: list<candidate>) -> list<bool>;  // Bündel ≤ 256
    on-imported: func(ids: list<image-id>);                        // fire-and-forget, kein Token
    on-export-done: func(files: list<bytes-source>, t: borrow<token>, c: borrow<ctx>);
    describe: func(panel: string, p: list<param>) -> list<node>;   // optional dynamisches Panel
  }
}
```

Ressourcen-Regeln: `image-src`/`image-dst` sind getrennte Typen (kein Laufzeit-Flag). Alle
Handles eines Aufrufs (auch eigene aus `image-sink.alloc`) werden am Aufrufende ungültig
(Generationszähler im Host). `read-tile`/`write-tile` mit einem Rechteck über 2048² oder
64 MiB liefern `invalid-input`; die Host-Allokation folgt der geklemmten Größe.

### Grenzen je Aufruf

wasmtime `=48.0.10` und wasmtime-wasi `=48.0.10` (LTS):

- `Config`: `epoch_interruption(true)` mit einem Ticker-Thread (`increment_epoch` **jede
  1 ms**; Epochen statt Fuel, laut wasmtime-Doku deutlich günstiger), `max_wasm_stack(512 KiB)`,
  Pooling-Allocator (CoW-Speicher, `max_memory_size 1 GiB`, `total_core_instances` aus dem
  `CpuBudget`), `consume_fuel(false)`, `wasm_threads(false)`,
  `cranelift_nan_canonicalization(true)` (deterministische CPU-Schritte für Goldens),
  `parallel_compilation(false)` (Erstkompilierung auf einem Hintergrund-Worker, belegt nicht
  alle Kerne).
- Deadlines, weich (verlängerbar, solange `done` steigt) / **hart** (Wanduhr, unabhängig vom
  Fortschritt):

  | Aufruf | weich | hart |
  |---|---|---|
  | `describe`, `on-event` | – | 50 ms |
  | `on-import-candidates` (256er-Bündel) | – | 1,28 s |
  | `read-meta` | – | 20 ms je Datei |
  | `activate` | – | 2 s |
  | `run-command` | 2 s (Fortschritt/Abbrechen schon ab 300 ms sichtbar) | 10 min |
  | `process-tile` | 5 s | 20 s |
  | `decode` | 30 s | 120 s |

  `progress` muss innerhalb eines Aufrufs dasselbe `total` behalten und `done` echt
  steigern; sonst zählt es nicht als Fortschritt. Eine Verlängerung gilt höchstens eine
  weiche Deadline lang.
- `StoreLimitsBuilder`: Speicher 1 GiB für Decoder/CPU-Schritte/Encoder, 128 MiB für
  Workflow, 4 Tabellen à 100 k, `trap_on_grow_failure(true)`. **Summe** aller lebenden
  Stores ≤ min(4 GiB, 25 % des RAM), über einen gemeinsamen `ResourceLimiter`-Zähler;
  daraus und aus dem `CpuBudget` folgt die Zahl paralleler CPU-Schritt-Instanzen.
- **Strikes**: Trap, harte Deadline oder Wachstumsfehler = Strike. 3 Strikes in einer
  Sitzung → bis zum Neustart aus („Plugin X wurde wegen wiederholter Fehler deaktiviert“).
  5 Sitzungen in Folge mit Strikes → Quarantäne, Freigabe im Plugin-Manager.
- **Kompilier-Cache**: bei Installation im Hintergrund `Engine::precompile_component` nach
  `~/.cache/lumen/plugins/<sha256(wasm)>-<precompile_compatibility_hash>.cwasm` (Ordner 0700,
  Eigentümer = Nutzer, sonst abgelehnt). Laden: Datei **einmal** öffnen (`O_NOFOLLOW`),
  über denselben Deskriptor hashen und die gelesenen Bytes an `Component::deserialize`
  geben (kein zweites Öffnen per Pfad, kein TOCTOU-Fenster). `deserialize` ist `unsafe`: nur
  selbst erzeugte Dateien, deren Hash in der Zustimmungsdatei steht. `.cwasm` in Paketen
  wird abgelehnt. Nach jedem wasmtime-Bump im Hintergrund neu kompilieren; S1-Teile des
  Plugins laufen derweil weiter.

## Native-ABI

### C-ABI (`lumen-plugin-abi`), eingefroren

`#![no_std]`, nur `#[repr(C)]`, Lizenz MIT OR Apache-2.0. `build.rs` erzeugt mit `cbindgen`
(beim Hinzufügen pinnen) `desktop/sdk/c/include/lumen_plugin.h` (eingecheckt, `make ci`
prüft per `git diff --exit-code`). Kein Rust-ABI-Dylib, kein `abi_stable`, kein `stabby`
als Basisvertrag. **Die ABI 1.0 wird mit N11c eingefroren** (Entscheidung Manuel 2); danach
nur Anhängen (Minor) oder ein neues `_v2`-Symbol.

Konstanten sind `#define`s mit `uint32_t`-Feldern, keine C-`enum`s (bindgen macht daraus
unter Windows `i32`, unter Linux `u32`).

```c
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define LUMEN_MAGIC      0x4E4D554Cu      /* 'LUMN' */
#define LUMEN_ABI_MAJOR  1u
#define LUMEN_ABI_MINOR  0u

typedef int32_t  lumen_status;            /* 0 OK, 1 PANIC, 2 CANCELLED, 3 INVALID, 4 UNSUPPORTED, 5 OOM, 6 INTERNAL */
typedef uint64_t lumen_call;              /* Aufruf-Kennung: Abbruch, Fortschritt, Allokation */
typedef uint64_t lumen_file;              /* Lese-Handle auf ein Original, vom Host vergeben */

#define LUMEN_FMT_RGB16     1u
#define LUMEN_FMT_RGBA16F   2u
#define LUMEN_FMT_RGBA32F   3u
#define LUMEN_FMT_BAYER16   4u
#define LUMEN_CLAIM_NO        0u
#define LUMEN_CLAIM_FALLBACK  1u
#define LUMEN_CLAIM_PRIMARY   2u
#define LUMEN_MODE_HALF     1u      /* 0 frei; Vorschau nur über embedded_preview */
#define LUMEN_MODE_FULL     2u
#define LUMEN_PARAM_FLOAT 1u
#define LUMEN_PARAM_INT   2u
#define LUMEN_PARAM_BOOL  3u
#define LUMEN_PARAM_CHOICE 4u
#define LUMEN_PARAM_COLOR 5u
#define LUMEN_PARAM_CURVE 6u
#define LUMEN_BYTES_PREVIEW_JPEG  1u      /* embedded_preview */
#define LUMEN_BYTES_RAW_META_JSON 2u      /* decode; JSON-Schema normativ (Erweiterungspunkte), ≤ 64 KiB */
#define LUMEN_BYTES_META_JSON     3u      /* read_meta; [[key, value], …] */
#define LUMEN_BYTES_ENCODED       4u      /* encode; Strom, beliebig oft */
#define LUMEN_BYTES_PARAMS_JSON   5u      /* migrate; JSON-Objekt wie Edit-State params */

typedef struct { const void *ptr; uint32_t width, height, stride_bytes, format; } LumenImageView; /* geliehen, je Aufruf */
typedef struct { void *ptr;       uint32_t width, height, stride_bytes, format; } LumenImageMut;
typedef struct { uint32_t x, y, w, h; } LumenRect;
typedef struct { const uint8_t *ptr; size_t len; } LumenBytes;
typedef struct {
  const char  *id;                        /* Param-ID wie im Manifest */
  uint32_t     kind;                      /* LUMEN_PARAM_* */
  uint32_t     curve_len;                 /* Punkte, ≤ 16 */
  float        f;                         /* float (f32 wie WIT/WGSL) */
  int32_t      i;                         /* int, bool (0/1), choice-Index (i32 wie WIT) */
  float        rgb[3];                    /* color */
  const float *curve_xy;                  /* curve: x0,y0,x1,y1,… */
} LumenParamV1;
typedef struct { uint32_t tile_size, halo, flags; } LumenTilePlanV1;   /* flags: 1 = PARALLEL_SAFE */

typedef struct LumenHostApiV1 {
  uint32_t struct_size; uint16_t abi_major, abi_minor;
  void *host;
  void         (*log)(void *host, uint32_t level, const char *utf8, size_t len);
  bool         (*is_cancelled)(void *host, lumen_call call);
  void         (*progress)(void *host, lumen_call call, uint64_t done, uint64_t total);
  lumen_status (*alloc_image)(void *host, lumen_call call, uint32_t w, uint32_t h, uint32_t fmt, LumenImageMut *out);
  lumen_status (*emit_bytes)(void *host, lumen_call call, uint32_t kind, const uint8_t *p, size_t len); /* Host kopiert */
  lumen_status (*file_map)(void *host, lumen_call call, lumen_file f, LumenBytes *out);  /* nur lesend, bis Aufrufende */
  lumen_status (*read_rows)(void *host, lumen_call call, uint32_t max_rows, LumenImageView *out); /* Encoder; h = 0: Ende */
  uint32_t     (*worker_threads)(void *host, lumen_call call);                       /* Thread-Budget aus CpuBudget */
} LumenHostApiV1;

typedef struct LumenDecoderVtableV1 {
  uint32_t struct_size;
  uint32_t     (*probe)(const uint8_t *head, size_t len, const char *ext);   /* LUMEN_CLAIM_*; head = 4 KiB */
  lumen_status (*embedded_preview)(lumen_call call, lumen_file f);           /* emit_bytes(PREVIEW_JPEG) oder UNSUPPORTED */
  lumen_status (*decode)(lumen_call call, lumen_file f, uint32_t mode);      /* alloc_image(RGB16) + emit_bytes(RAW_META_JSON) */
} LumenDecoderVtableV1;

typedef struct LumenMetadataVtableV1 {
  uint32_t struct_size;
  lumen_status (*read_meta)(lumen_call call, lumen_file f);                  /* emit_bytes(META_JSON) */
} LumenMetadataVtableV1;

typedef struct LumenCpuOpVtableV1 {
  uint32_t struct_size;
  lumen_status (*plan)(const LumenParamV1 *p, size_t n, LumenTilePlanV1 *out);
  lumen_status (*process_tile)(lumen_call call, const LumenImageView *src, const LumenImageMut *dst,
                               LumenRect tile, const LumenParamV1 *p, size_t n);
      /* tile in Bildkoordinaten; src = Kachel + Halo (Ursprung tile.x-halo, tile.y-halo,
         randwiederholt); dst = genau die Kachel, vom Host; Formate je Slot siehe Punkt 8 */
} LumenCpuOpVtableV1;

typedef struct LumenEncoderVtableV1 {
  uint32_t struct_size;
  lumen_status (*encode)(lumen_call call, uint32_t width, uint32_t height, uint32_t fmt,
                         const uint8_t *icc, size_t icc_len, const uint8_t *exif, size_t exif_len,
                         const LumenParamV1 *opts, size_t n);              /* read_rows + emit_bytes(ENCODED) */
} LumenEncoderVtableV1;

typedef struct LumenPluginDescV1 {
  uint32_t magic; uint16_t abi_major, abi_minor; uint32_t struct_size;
  const char *id, *version;               /* müssen dem Manifest entsprechen */
  uint64_t flags;                         /* 1 = THREAD_SAFE, 2 = USES_OPENMP */
  const LumenDecoderVtableV1  *decoder;   /* NULL, wenn nicht vorhanden */
  const LumenMetadataVtableV1 *metadata;
  const LumenCpuOpVtableV1    *cpu_op;
  const LumenEncoderVtableV1  *encoder;
  lumen_status (*migrate)(lumen_call call, uint32_t from_v, const uint8_t *params_json, size_t len); /* emit_bytes(PARAMS_JSON) */
} LumenPluginDescV1;

/* das einzige exportierte Symbol */
const LumenPluginDescV1 *lumen_plugin_entry_v1(const LumenHostApiV1 *host);
```

Regeln (gelten auch für die SDK-Doku):

- `abi_major` muss gleich sein, `abi_minor` ≤ Host. Vor jedem Feldzugriff `struct_size`
  prüfen; Felder nur anhängen; Bruch = neues Symbol `_v2`, der Host hält einen v1-Adapter
  für eine Major-Version.
- Wer allokiert, gibt frei. Views und gemappte Bytes gelten für einen Aufruf. Ausgaben nur
  über `alloc_image`, vom Host übergebene `LumenImageMut` und `emit_bytes`.
- Kein Unwinding über die Grenze (kein `C-unwind`). Das Rust-SDK umhüllt jeden Export mit
  `catch_unwind` und liefert `PANIC`; C++ fängt selbst alles.
- `id`/`version` im Deskriptor ≠ Manifest → Plugin wird nicht benutzt, Quarantäne.
- Native Plugins fassen nie egui, wgpu oder das GPU-Device an. GPU-Arbeit liefern sie als
  S1-Passes im selben Paket (vom gleichen Validator geprüft). Es gibt **keinen**
  `create_shader_module_trusted`-Pfad für Plugins.
- Kein Entladen. In S4: `RTLD_NOW|RTLD_LOCAL|RTLD_NODELETE`, `mem::forget`, Änderungen nach
  Neustart. In S3 (später): Deaktivieren oder Update = Runner beenden, beim nächsten Gebrauch
  neu starten.
- Ausleitungs-Regel: Pakete mit nativem Code fordern kein `net`, `clipboard.write`,
  `fs.pick write`, `export.post` an.

### S4 Entwickler-Modus und Dev-Ladeweg (v1)

`lumen --dev-plugins <dir>` lädt `.so`/`.dll` im Lumen-Prozess mit derselben ABI
(Debugger, kein IPC). Läuft unter Linux und Windows. In v1 ist das **der einzige Weg**, native
Pakete zu laden; die Datei-Installation lehnt `.lumenplugin` mit `[artifacts] native` ab
(„Native Plugins gibt es in dieser Version nur im Entwicklermodus“).

**Dev-Ladeweg** (gilt für nativ, S1 und S2 im Dev-Ordner):

- **Ordnerlayout**: `<dir>/<beliebiger-name>/` je ein **entpacktes Paket** mit
  `lumen-plugin.toml`, `SIGNATURES` und den Dateien wie im `.lumenplugin`. Lose
  `.so`/`.dll` oder `.lumenplugin`-Zips in `<dir>` werden ignoriert (Hinweis im Startdialog).
  Das Manifest ist Pflicht (Abgleich `id`/`version` mit dem Deskriptor, Params, S1-Passes).
- **`[files]` ist auch hier Pflicht.** Vor `dlopen` bzw. vor dem Kompilieren hasht der Lader
  jede Datei über einen geöffneten Deskriptor gegen `[files]` und lädt genau diese Bytes
  (Linux: `dlopen` über `/proc/self/fd/<n>`; Windows: Datei mit `FILE_SHARE_READ` ohne
  Schreibfreigabe offen halten, bis `LoadLibraryExW` zurück ist).
- **Dev-Signatur**: Abschnitt `[dev]` in `SIGNATURES` mit der Nachricht
  `"lumen-dev-v1\0" ‖ sha256(manifest) ‖ id\0 ‖ version\0 ‖ sha256(dev-pubkey)` (Format oben).
  Weil `[files]` im Manifest steht, deckt sie jede Bibliothek ab. Geprüft wird gegen den
  Public Key des **lokalen Dev-Schlüssels**: `lumen-plugin keygen --dev` erzeugt ihn auf
  diesem Rechner (`~/.config/lumen/dev.key` + `dev.pub`, Windows `%APPDATA%\Lumen\`, Rechte
  nur Nutzer, nie exportiert), `lumen-plugin sign --dev` signiert. Eine fremde Datei braucht
  also einen bewussten Signierschritt mit Warntext; „starte einfach `lumen --dev-plugins
  ~/Downloads/x`“ oder ein vorbereiteter `.desktop`/`.lnk`-Starter reicht nicht. Ohne
  gültige Dev-Signatur lädt nichts.
- **Zustimmung**: Jeder Start zeigt einen modalen Dialog mit Ordner, Paketen, Stufe,
  angefragten Rechten und Hash-Liste; er ersetzt für diese Sitzung das Zustimmungsblatt.
  Rote Titelleiste; das Flag ist bei jedem Start nötig, nichts davon wird in die
  Zustimmungsdatei geschrieben.
- **Neu laden** (`lumen-plugin dev`): Lumen beobachtet `<dir>` selbst (Crate `notify`), kein
  IPC. `lumen-plugin dev` baut, schreibt `[files]` und die Dev-Signatur neu und ersetzt
  `SIGNATURES` zuletzt per atomarem Umbenennen; das ist das Auslöse-Ereignis. Lumen prüft
  Hashes und Signatur erneut und tauscht dann S1-Ketten über `GpuPassHost::swap` an der
  Frame-Grenze (< 150 ms) bzw. instanziiert die S2-Komponente neu (< 300 ms + Build).
  Ändern sich `tier`, `[capabilities]` oder `[artifacts] native`, lädt Lumen nicht neu und
  verlangt einen Neustart (neuer Startdialog). Native Bibliotheken: `lumen-plugin dev` baut
  neu und startet Lumen neu (kein Entladen); Params, Bild und Zoom werden über den normalen
  Sitzungsstand wiederhergestellt. Ein fehlgeschlagener Reload lässt die letzte gute Version
  laufen.

### `lumen-plugin-runner` (S3, spezifiziert, zurückgestellt)

Gebaut erst, wenn ein echter nativer Kandidat existiert (Entscheidung Manuel 2). Unter
Windows erst, wenn der AppContainer-Fluchttest besteht (Entscheidung 3). Native Pakete
kommen auch dann nur per Datei (Entscheidung 4). Dieser Abschnitt legt das Format fest.

Ein Prozess je nativem Plugin, gestartet bei der ersten Aktivierung (bzw. vorgewärmt, wenn
die Bibliothek einen Ordner öffnet, dessen Dateitypen ein **schon aktiviertes** Decoder-Plugin
beansprucht), leere Umgebung (außer `OMP_NUM_THREADS`), keine geerbten Handles außer
Kontrollkanal und Ring, Arbeitsverzeichnis = Installationsordner.

**Reihenfolge im Runner vor `dlopen`:**

1. `sha256(binary)` = gepinnter Hash aus der Zustimmungsdatei (der Elternprozess prüft
   zusätzlich selbst).
2. **Linux**: `prctl(PR_SET_NO_NEW_PRIVS)`. **Pfadregeln nur in Landlock** (seccomp sieht
   keine Pfade): Lesen+Ausführen nur Plugin-Ordner, `/usr/lib*`, `/lib*`, Lesen
   `/etc/ld.so.cache`, Schreiben nur `plugin-data/<id>/native/`; ab Landlock-ABI 4 zusätzlich
   TCP bind/connect verboten. Netz-Namespace (`unshare(CLONE_NEWNET)`) nur, wenn
   unprivilegierte User-Namespaces verfügbar sind; „kein Netz“ hängt nicht davon ab, weil
   seccomp `socket` ganz verbietet (der Kontrollkanal ist geerbt). **Dann seccomp-bpf**
   (Crate `seccompiler`) mit ladetauglicher Allow-List schon vor `dlopen`: `openat` (Pfade
   prüft Landlock), mmap/mprotect, futex, `clone` nur mit `CLONE_THREAD` (Argumentprüfung
   geht bei `clone`), Threads; `ENOSYS` für `clone3` (Flags in einer Struktur, glibc fällt
   dann auf `clone` zurück), `openat2`, `io_uring_*` (der Ring würde openat/connect an
   seccomp vorbei ausführen), `open_by_handle_at`; verboten: `execve`/`execveat`, `fork`,
   `socket`/`socketpair`, `ptrace`, `process_vm_readv/writev`, `pidfd_*`,
   `kill`/`tkill`/`tgkill` außer an die eigene PID, `keyctl`, `bpf`, `perf_event_open`,
   `userfaultfd`, `mount`. Damit laufen auch ELF-Konstruktoren schon unter dem Zaun. Nach
   `lumen_plugin_entry_v1` wird ein zweiter Landlock-Regelsatz gestapelt (nur noch Lesen
   der gemappten Bibliotheken und Schreiben in den Datenordner). Laden: `libloading`
   (beim Hinzufügen pinnen) `os::unix::Library::open(abs, RTLD_NOW|RTLD_LOCAL)`.
3. **Speicher Linux**: echte Speichergrenze statt Adressraum (`RLIMIT_AS` scheitert an
   OpenMP-Arenen, Thread-Stacks und dem Ring): Runner in ein cgroup-v2-Kind mit
   `MemoryMax=<memory-mib>M` (max. 8192), über `systemd-run --user --scope` oder die
   delegierte Nutzer-cgroup; Rückfall `RLIMIT_DATA`, im FenceReport vermerkt.
4. **Windows** (erst nach AppContainer-Fluchttest): Job-Objekt mit
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, `ACTIVE_PROCESS_LIMIT=1` (keine Kindprozesse),
   `JOB_OBJECT_LIMIT_PROCESS_MEMORY`, UI-Beschränkungen; **AppContainer** (Profil
   `Lumen.Plugin.<id>`, ohne `internetClient`, ACL nur für Plugin-Ordner und Datenordner);
   `SetDefaultDllDirectories(LOAD_LIBRARY_SEARCH_DEFAULT_DIRS)`, `SetDllDirectoryW("")`, dann
   `LoadLibraryExW(abs, LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32)`
   (`windows-sys =0.61.2`). Ohne AppContainer könnte der Runner (gleicher Nutzer) per
   `OpenProcess` in `lumen.exe` schreiben; Windows-S3 ohne AppContainer wäre S4-gleichwertig
   und wird deshalb nicht angeboten. Zwischenschritt für den Spike: Restricted Token mit
   niedriger Integrität (`CreateRestrictedToken` + `SetTokenInformation(TokenIntegrityLevel)`).
5. **FenceReport** `{ landlock, landlock_net, seccomp, netns, memcg, job, appcontainer }`.
   Fehlt etwas (alter Kernel, kein userns), bleibt das Plugin aus, bis der Nutzer es unter
   der Warnung „Schutz eingeschränkt: …“ mit der Liste der fehlenden Teile erneut freigibt.
   **Nie stilles Herabstufen.**

**IPC:**

- Nur **anonyme, vererbte Kanäle**, keine benannten Pipes oder Pfad-Sockets (die könnten
  andere Prozesse des Nutzers vorab belegen oder sich verbinden): Linux
  `socketpair(AF_UNIX, SOCK_SEQPACKET)` auf festem fd 3; Windows anonyme Pipe, vererbt nur
  über `PROC_THREAD_ATTRIBUTE_HANDLE_LIST`. Längenpräfixierte Frames ≤ 64 KiB, `postcard`
  (beim Hinzufügen pinnen) in feste Rust-Typen mit `deny_unknown_fields`; jedes Feld prüft
  der Elternprozess auf Grenzen.
- Pixel über einen Ring aus 3 wiederverwendeten Shared-Memory-Puffern: Linux `memfd_create`
  + `F_SEAL_SHRINK|F_SEAL_GROW`, per SCM_RIGHTS übergeben; Windows `CreateFileMapping`,
  Handle explizit vererbt. Gemappt mit `memmap2` (beim Hinzufügen pinnen). Größe nach dem
  größten gesehenen Bild (Z6III RGB16 ≈ 146 MB), lazy angelegt und wiederverwendet; über
  512 MB nach 60 s Leerlauf durch ein neues, kleineres memfd ersetzt (versiegelte Puffer
  schrumpfen nicht). `iceoryx2` ist die Alternative für einen Vergleich beim Bau.
- Original-RAW: Der Elternprozess öffnet die Datei lesend und übergibt das Handle; der
  Runner bekommt nie einen Pfad.
- **Jede Antwort gilt als feindlich**: Maße ≤ 16384², Byte-Länge = `w·h·Kanäle·bpp`, Meta
  ≤ 64 KiB strikt geparst. Dekodierte Pixel liest der Host **genau einmal** aus dem Ring und
  schreibt sie dabei gleich als Halbfloat in einen gemappten Staging-Puffer
  (`queue.write_buffer_with`, mehrere Threads, Zeilenstreifen): TOCTOU-Schutz und
  u16→Half-Wandlung in einem Durchgang, keine zusätzliche Vollbild-Kopie gegenüber dem
  eingebauten Pfad.

**Aufsicht:** Herzschlag jede Sekunde während eines Aufrufs, Deadline = S2-Deadline × 4.
Absturz, Zeitüberschreitung oder Protokollfehler → Prozess (bzw. Job/Prozessgruppe) beenden
→ Banner „Nativer Plugin-Prozess X abgestürzt; Bild ohne Plugin geladen“ → Rückfall auf den
eingebauten Decoder. Neustart mit Backoff 1 s / 5 s / 30 s; 3 Abstürze in 10 min →
Quarantäne. OpenMP im Plugin ist erlaubt, weil es im eigenen Prozess läuft
(`OMP_NUM_THREADS` = `worker_threads`, sonst 1).

## GPU-Pass-API und Budget

Modul `lumen-gpu::plugin`, naga `=30.0.2` direkt (dieselbe Version wie wgpu `=30.0.2`).

### Vertrag: Plugins schreiben Funktionen, keine Module

Die WGSL-Datei enthält nur Funktionen und `const`. Der Host baut
`Prelude + Plugin-Body + Epilog` zusammen (libplacebo-`hook()`-Muster). Ein Pass ist eine
**reine Funktion von (Eingängen, Params, Größe)**; es gibt keinen Frame-Zähler.

```wgsl
// ---- Prelude (vom Host erzeugt, nie vom Plugin) ----
struct LumenFrame { size: vec2<u32>, full_size: vec2<u32>, texel_scale: f32 }
struct PluginParams { strength: f32, radius: i32, chroma_only: u32 }   // aus [params], Host-Layout
@group(0) @binding(0) var<uniform> lumen: LumenFrame;
@group(0) @binding(1) var<uniform> params: PluginParams;
@group(0) @binding(2) var _lumen_in0: texture_2d<f32>;   // bis _lumen_in3; ungenutzte Slots: 1×1-Dummy
@group(0) @binding(6) var _lumen_smp: sampler;           // ClampToEdge, linear
@group(0) @binding(7) var _lumen_curves: texture_2d<f32>; // 256×N R16F, eine Zeile je curve-Param
fn lumen_load(i: u32, p: vec2<i32>) -> vec4<f32>         // geklemmtes textureLoad; i muss Konstante sein
fn lumen_sample(i: u32, uv: vec2<f32>) -> vec4<f32>      // textureSampleLevel, LOD 0
fn lumen_curve(i: u32, x: f32) -> f32                    // LUT-Lookup des i-ten curve-Params
fn lumen_srgb_to_linear(c: vec3<f32>) -> vec3<f32>       // identisch zu develop.wgsl
fn lumen_linear_to_srgb(c: vec3<f32>) -> vec3<f32>
fn lumen_luma(c: vec3<f32>) -> f32
// ---- Plugin-Body (alles, was der Autor schreibt) ----
// ---- Epilog: Vollbild-Vertex + @fragment fn _lumen_fs(...) { return lumen_pixel(...); } ----
```

- **`texel_scale`** (normativ) = Kantenlänge des Bildes, in das der Pass schreibt /
  Original-Kantenlänge, also ≤ 1; `1.0` bei Export und 1:1-Ansicht, Proxy/Original im
  Editor, im Zustand `Reduced` **0,5 × Proxy/Original** (ebenso bei `scale = 0.5` in einer
  Pyramide: je Stufe halbiert). Pixel-Radien in Params meinen **Original-Pixel**; ein
  auflösungsunabhängiger Pass rechnet `r_eff = max(1, i32(ceil(f32(r) * lumen.texel_scale)))`
  und verkleinert so den Radius statt Texel zu überspringen.
- Param-Namen: kebab-case im Manifest und Edit-State, im WGSL mechanisch snake_case
  (`chroma-only` → `chroma_only`). Weil `_` in Param-IDs verboten ist, kann es keine
  Kollision geben; IDs, die WGSL-Schlüsselwörter oder reservierte Wörter sind, lehnt der
  Validator ab. `bool` → `u32`; `choice` → `u32` mit erzeugten Konstanten (`MODE_FAST = 0u`);
  `color` → `vec3<f32>` (vec4-ausgerichtet); `curve` → LUT-Zeile in `_lumen_curves`, gelesen
  über `lumen_curve(i, x)`. Je Plugin ≤ 32 Params, ≤ 4 curve-Params.
- `kind = "compute"` nimmt `fn lumen_tile(px: vec2<i32>, lid: vec2<u32>)` mit Host-festem
  `@workgroup_size(16,16)` und `lumen_store(px, c)` (bounds-geprüft). Das Host-Gerüst besitzt
  die Storage-Textur; **der Plugin-Body hat keine Storage-Bindings**. Mit
  `workgroup-cache-radius` lädt der Host Kachel + Halo in `var<workgroup>` (vec4<f32>);
  Grenze ≤ 8, weil (16 + 2·8)² × 16 B = 16 KiB = `maxComputeWorkgroupStorageSize` des
  WebGPU-Standardprofils.
- Mehrere Passes einer `gpu-chain` bilden eine Kette (`inputs = ["hooked", "original",
  "saved:<name>"]`, max. 4, `save-as`, `scale = 0.5` für Pyramiden, Zwischenbilder immer
  `Rgba16Float`). `entry` ist `lumen_pixel` (fragment) bzw. `lumen_tile` (compute), je Datei.

**Beispiel `mrd.guided-denoise`**: separierbare Näherung eines bilateralen Filters in zwei
Passes. Der erste linearisiert beim Lesen und schreibt linear in `saved:h`; der zweite liest
linear, sodass nur 17 + 1 Potenzfunktionen je Pixel statt 289 anfallen. Konstante
Schleifenschranke 17, Fetches 18 bzw. 19 je Pixel.

```wgsl
// shaders/denoise_h.wgsl: horizontal, liest sRGB, schreibt linear
fn lumen_pixel(uv: vec2<f32>, px: vec2<i32>) -> vec4<f32> {
  let r = max(1, i32(ceil(f32(params.radius) * lumen.texel_scale)));
  let c = lumen_srgb_to_linear(lumen_load(0u, px).rgb);
  let k = (101.0 - params.strength) * 40.0;
  var acc = vec3<f32>(0.0);
  var w = 0.0;
  for (var d = -8; d <= 8; d++) {                        // konstante Schranke: 17 Iterationen
    if (abs(d) > r) { continue; }
    let s = lumen_srgb_to_linear(lumen_load(0u, px + vec2<i32>(d, 0)).rgb);
    let e = s - c;
    let g = exp(-dot(e, e) * k);
    acc += s * g;
    w += g;
  }
  return vec4<f32>(acc / w, 1.0);
}
```

```wgsl
// shaders/denoise_v.wgsl: vertikal, liest linear (in0 = saved:h) und das Original (in1 = hooked)
fn lumen_pixel(uv: vec2<f32>, px: vec2<i32>) -> vec4<f32> {
  let r = max(1, i32(ceil(f32(params.radius) * lumen.texel_scale)));
  let o = lumen_load(1u, px);
  let c = lumen_load(0u, px).rgb;
  let k = (101.0 - params.strength) * 40.0;
  var acc = vec3<f32>(0.0);
  var w = 0.0;
  for (var d = -8; d <= 8; d++) {
    if (abs(d) > r) { continue; }
    let s = lumen_load(0u, px + vec2<i32>(0, d)).rgb;
    let e = s - c;
    let g = exp(-dot(e, e) * k);
    acc += s * g;
    w += g;
  }
  var lin = acc / w;
  if (params.chroma_only != 0u) {                        // Helligkeit vom Original behalten
    lin = lin + (lumen_luma(lumen_srgb_to_linear(o.rgb)) - lumen_luma(lin));
  }
  return vec4<f32>(lumen_linear_to_srgb(lin), o.a);
}
```

### Einhängepunkte v1

| Hook | Eingang | Lage | Warum paritätssicher |
|---|---|---|---|
| `source` | `Rgba16Float`-Quelle (bzw. Bake-Ergebnis), **sRGB-kodiert**, Kamera-WB, sRGB-Primärfarben (LibRaw `output_color=1`) | eigener Pass **vor** `develop.wgsl`; der Kern-Pass liest dann das Plugin-Ergebnis statt `src_tex` | Kern-Shader unverändert; eingebaute Rauschminderung, TCA und Verzeichnung lesen Nachbarn wie bisher |
| `output` | sRGB-kodiertes Ergebnis nach Vignette; der Kern schreibt dafür in ein `Rgba16Float`-Zwischenbild statt `Rgba8Unorm` | nach dem Kern-Pass, vor Anzeige bzw. Export-Encode | Kern-Shader unverändert; einziger Unterschied ist der Rundungsschritt, geprüft durch den Identitätstest |

- **Kein Plugin aktiv** (oder alle Ketten per `skip-when` aus): `Developer::render` läuft
  genau den heutigen Pfad (`pipeline.rs:124`). Null Kosten, null Paritätsrisiko. Die
  `skip-when`-Prüfung ist ein CPU-Vergleich einmal je Edit.
- `source` ist genau der Platz für Manuels Rauschminderung und RAW-nahe Korrekturen
  (Hotpixel). Wer linear rechnen will, nutzt `lumen_srgb_to_linear`.
- Mittlere Hooks (`scene-linear` nach Linse/Rauschminderung, `display` vor Vignette)
  brauchen eine Aufteilung des Kern-Shaders per Codegen. Sie kommen als API 0.2 und erst,
  wenn der **Identitäts-Plugin-Paritätstest** (Durchreich-Plugin an jedem Hook gegen die
  Goldens, ≤ 1/255) grün ist. Der Test entsteht in N5 für `source` und `output`.
- **Fusing** (in den Kern oder zwischen Punkt-Passes eines Plugins) ist zurückgestellt, bis
  Timestamp-Daten zeigen, dass getrennte Passes zu teuer sind. Die Bandbreitenkosten je
  Pass (Proxy RGBA16F lesen + schreiben ≈ 2 × 35 MB) gehen in die Kostenvorhersage ein.

### Pass-Cache und Kacheln

- **Reihenfolge mehrerer Plugins am selben Hook** (normativ): sortiert nach `(order,
  plugin-id)` aus dem Edit-State (`order` Standard 0, siehe Edit-State), damit gleich auf jedem
  Rechner und in jedem Preset. Der Nutzer ändert sie per Ziehen der Panels; das schreibt
  `order`.
- **Proxy**: Das Ergebnis jeder `source`-Kette wird als `Rgba16Float` gecacht, Schlüssel
  `(source_gen, chain_hash, params_hash)` **kumulativ** in Kettenreihenfolge (der Schlüssel
  der n-ten Kette enthält die Schlüssel aller vorigen); `chain_hash` = `passHash`
  (Hash der zusammengesetzten Module), nicht die Plugin-Version. Da `source` vor allem
  anderen liegt, ist der Cache ohne Paritätsfrage gültig: **Ton-Regler rechnen eine
  Plugin-Rauschminderung nie neu**, nur deren eigene Regler.
- **1:1-Zoom und Lupe** (`texel_scale = 1`): Die `source`-Kette läuft in VRAM-Kacheln
  und landet in einer LRU mit Schlüssel `(source_gen, chain_hash, params_hash, tile_x,
  tile_y)`. Halo `Σ radius-px` ist auch hier auf **256** begrenzt; die Kantenlänge der Kachel
  ist `max(512, 4 × Halo)` (auf Zweierpotenz gerundet), damit der Halo höchstens ≈ 2,25× Pixel
  kostet. Ein Schwenk rechnet nur neu sichtbare Kacheln, **je Frame aber nur so viele, dass
  ihre vorhergesagte Zeit (ns/px × Pixel inkl. Halo) unter `plugin_budget` bleibt**; der Rest
  wartet in einer Warteschlange, Mitte des sichtbaren Bereichs zuerst. Fehlende Kacheln zeigen
  bis dahin das hochskalierte Proxy-Ergebnis (kein Warten).
- VRAM-Budget **interaktiv** für Plugin-Zwischenbilder und Kacheln zusammen 256 MB, LRU
  (Proxy 2560 px RGBA16F ≈ 35 MB; Kachel 512² ≈ 2 MB).
- VRAM-Budget **Export**, getrennt ausgewiesen und gemeinsam mit dem Editor abgerechnet
  (ein `VramLedger` in `lumen-gpu`): `Quelle + Kettenergebnis + Zwischenbilder je Kachel`
  = `W·H·8 B` (Quelltextur) `+ W·H·8 B` (volles `source`-Ergebnis) `+ k · (2048 + 2·Halo)² ·
  8 B` (k = gespeicherte Zwischenbilder der Kette). Z6III: ≈ 195 + 195 + k · 52 MB; 61 MP:
  ≈ 490 + 490 + k · 52 MB. Liegt die Summe über `min(50 % des geschätzten VRAM bzw. bei iGPUs
  des geteilten Anteils, adapter max_buffer_size)` abzüglich des interaktiven Budgets, legt
  der Export **keine volle Textur** an: Die `source`-Kette läuft in Streifen, die Ergebnisse
  liegen in einem CPU-Puffer (RGBA16F, gemappt) und der Kern-Pass lädt je Ausgabekachel nur
  den benötigten Quellbereich (Bounding-Box der verzerrten Abtaststellen + Rand) wieder hoch.
- **Export** (der Kern tastet die Quelle an verzerrten Stellen ab: Verzeichnung, TCA,
  Begradigen, Crop; ein kleiner Halo um eine Ausgabekachel reicht deshalb nicht):
  1. `source`-Kette in voller Auflösung, gekachelt im **Quellraum** (2048² + Halo
     `Σ radius-px`, Σ ≤ 256), zusammengesetzt zu einer vollen `Rgba16Float`-Textur
     (Z6III ≈ 195 MB; Host-Textur mit Adapter-Limits).
  2. Kern-Pass gekachelt im Ausgaberaum wie ohne Plugins; er liest die volle Textur.
  3. `output`-Kette je Ausgabekachel mit Halo `Σ radius-px` (nach dem Kern gibt es keine
     Verzerrung mehr).
  Alles über den GPU-Scheduler in der Hintergrund-Klasse.
- Vorschaubilder: Schlüssel `(passHash, params_hash)`; nach einer Änderung werden nur
  sichtbare Kacheln im Raster lazy und mit Hintergrund-Priorität neu gerendert.

### Vorab-Validator (`validate_plugin_wgsl`)

Läuft bei Installation, beim Laden (Ergebnis gecacht nach `sha256(wgsl) + naga-Version`)
und auf dem Server (Unterprozess mit CPU-Zeit-Grenze), jeweils auf einem Worker mit
8 MiB Stack:

1. Body ≤ 64 KiB, UTF-8 ohne Bidi-/unsichtbare Zeichen.
2. **Body hinter einer Stub-Prelude parsen** (`naga::front::wgsl::parse_str`): Die Stub-Prelude
   hat dieselben Deklarationen wie die echte (`lumen`, `params`, API-Funktionen als Stubs),
   sonst scheitert naga an unbekannten Bezeichnern. Dann das abgesenkte Modul gegen das
   Modul der Stub-Prelude allein vergleichen: zusätzliche globale Variablen jeder
   Adressklasse, Entry-Points, `override` → ablehnen. Die Einzelprüfungen laufen nur auf
   Elementen, deren Span im Body liegt: kein `@group`/`@binding`, keine `enable`-Direktive,
   kein `atomic`, kein `textureStore`, kein `workgroupBarrier`/`storageBarrier`, keine Zeiger
   auf `storage`/`uniform`, keine Referenz auf Bezeichner mit Präfix `_lumen` (damit sind
   `_lumen_in*`, `_lumen_smp`, `_lumen_curves` nur über `lumen_load`/`lumen_sample`/
   `lumen_curve` erreichbar), Bezeichner mit Präfix `lumen_` nur als Aufruf der Prelude-API
   oder als Definition des Entry `lumen_pixel`/`lumen_tile`. Das erste Argument von
   `lumen_load`/`lumen_sample` muss eine Konstante < Zahl der deklarierten `inputs` sein.
3. Echtes Modul zusammensetzen, `naga::valid::Validator::new(ValidationFlags::all(), Capabilities::empty())`.
4. **Kostenregel** (nicht austricksbar):
   - Akzeptiert wird nur die von naga abgesenkte for-Schleifenform: ein `Statement::Loop`,
     dessen Body mit einem `If` auf einen Vergleich `Zähler <op> Schranke` und `Break`
     beginnt, mit konstantem Schritt im `continuing`-Block. Die Schranke ist eine Konstante
     oder `params.<int-Param mit loop-bound = true>` (dann zählt dessen `max`). Der Zähler
     darf im Body nicht geschrieben werden, auch nicht über einen Zeiger (`&zähler` ist
     verboten). Alles andere (while mit Laufzeitbedingung) wird abgelehnt.
   - Kosten werden über **alle Aufrufe inline** gerechnet (WGSL kennt keine Rekursion):
     Summe über aufeinanderfolgende Anweisungen, Produkt über Verschachtelung, Grenze **je
     Pixel**: Iterationen gesamt ≤ 4096, `fetches` (`lumen_load`/`lumen_sample`) ≤ 512,
     gewichtete ALU-Operationen (Transzendente × 8) ≤ 65 536.
   - Ergebnis `StaticCost { iterations_per_px, fetches_per_px, alu_per_px, class: S|M|L }`,
     angezeigt im Plugin-Manager; Fehlermeldungen mit Datei:Zeile des Autors (Spans um die
     Prelude-Länge verschoben), z. B.
     `shaders/denoise_h.wgsl:7:14 unbegrenzte Schleife: Schranke hängt von Laufzeitwert ab; konstante Schranke oder loop-bound-Param verwenden`.
   - Im zusammengesetzten Modul ersetzt der Codegen jede Schranke `params.x` zusätzlich durch
     `min(params.x, MAX_X)` (Verteidigung in der Tiefe zur Klemmung in `set_params`).
5. Limits-Profil `wgpu::Limits::default()` (WebGPU-Standard) für Plugin-Code, nie die
   Adapter-Limits (der Kern fordert sie an, `device.rs:23,41`).
6. `device.create_shader_module` (immer `ShaderRuntimeChecks::checked()`: Bounds-Checks +
   `force_loop_bounding`). Nie `_trusted`/`_passthrough` für Plugin-Code. Läuft im Zustand
   `Compiling` auf einem Worker (siehe Probezeit-Journal).
7. `sha256(zusammengesetztes Modul)` wird mit dem Pass gespeichert; `passHash` der Kette im
   Edit-State.

### Laufzeit-Budget und Notbremsen

**Regel** (Entscheidung Manuel 7): GPU ≤ 8 ms auf dem Proxy gilt **hart auf jeder
unterstützten GPU**. Das Plugin-Budget ist dynamisch:

`plugin_budget = 8 ms − core_p95(Gerät, aktueller Edit) − 1 ms Reserve`

`core_p95` misst derselbe Timestamp-Timer um den Kern-Pass (ab N2 ohnehin vorhanden),
gleitend über die letzten 30 Frames; neu bewertet bei jeder Edit-Änderung, die Kern-Stufen
zu- oder abschaltet, und bei jeder **Änderung der Proxy-Größe** (Fenstergröße, Wechsel auf
einen Monitor mit anderem DPR, DS Z. 191): Messfenster zurücksetzen, bekannte Pass-Zeiten
über ns/px auf die neuen Pixel umrechnen, bis neue Messungen vorliegen.

**Was die Regel für den Kern heißt.** Plugins können die 8 ms nur einhalten, wenn der Kern
selbst darunter liegt. Das sichert DS/N2 für den Kern (z. B. kleinerer Proxy beim Ziehen
auf schwachen GPUs), nicht dieses Dokument. „Unterstützte GPU“ heißt hier: Hardware-Adapter
(Software-Adapter wie WARP und lavapipe sind ausgenommen, sie laufen nur funktional). Für
Plugins garantiert der Host nur: **Ist `core_p95 ≥ 7 ms`, fügen Plugin-Passes beim Ziehen
nichts hinzu** (alle `OnRelease`). Rechenbeispiel UHD 630: `8 − 5,44 − 1 ≈ 1,5 ms` mit dem
Spike-Shader, mit den N2–N5-Stufen ≤ 0; `guided-denoise` (Ziel 2 ms auf der 680M, auf der
UHD 630 grob × 4,5 ≈ 9 ms, `Reduced` ≈ 2,2 ms) landet dort also in `OnRelease`.

**Startzustand statt Blindflug.** Im Zustand `Compiling` misst der Host für jeden neuen Pass
auch für den interaktiven Pfad einen **256²-Probelauf** (Timestamps, sonst Wanduhr um
`on_submitted_work_done`), rechnet ns/px auf die Proxy-Pixel hoch und wählt damit den
Startzustand (`Live`, `Reduced`, `OnRelease`, `Disabled(TooSlow)`). Ein Pass mit
vorhergesagt > 100 ms auf dem Proxy wird wie eine Hintergrund-Kachel behandelt: über
1,5 s → `Disabled(TooSlow)` (unter dem Windows-TDR von 2 s), sonst höchstens `OnRelease`
und dann in Kacheln ≤ 4 ms über den GPU-Scheduler gerechnet, nie als ein ungeschnittener
Proxy-Pass.

- Host fordert `Features::TIMESTAMP_QUERY` (und `TIMESTAMP_QUERY_INSIDE_ENCODERS`, wo
  vorhanden) über den Device-Descriptor-Hook von eframes `WgpuConfiguration` an (in N2 gegen
  die eframe-0.37-Quellen prüfen) und reicht den Feature-Satz in `Gpu`. Jeder Plugin-Pass
  wird mit `RenderPassTimestampWrites`/`ComputePassTimestampWrites` geklammert; Auslesen
  asynchron aus einem Ring von Query-Sets.
- Stufen je Kette, teuerste zuerst herabgestuft. **Herab sofort**, sobald ein einzelner
  Frame Σ Plugin-Zeit > `plugin_budget` misst; **hinauf** nur, wenn Σ Plugin-p95 über
  30 Frames im höheren Zustand vorhergesagt < 70 % des Budgets liegt (Hysterese):

  | Zustand | Verhalten | Übergang |
  |---|---|---|
  | `Live` | jeder Frame | ein Frame über Budget → `Reduced` |
  | `Reduced` | während eines Zieh-Vorgangs mit `scale 0.5` in ein kleineres Zwischenbild, bilinear hochskaliert (≈ 4× günstiger), `texel_scale` halbiert; beim Loslassen volle Auflösung. Der Identitäts-/Paritätstest prüft auch `Reduced` gegen den `Live`-Render (Toleranz wie Proxy ↔ Export) | reicht nicht → `OnRelease` |
  | `OnRelease` | `source`: beim Ziehen eines eigenen Reglers das zuletzt gerechnete Ergebnis, bei Kern-Reglern ohnehin der Cache; `output`: beim Ziehen entfällt der Pass (Abzeichen „Vorschau ohne Plugin X beim Ziehen“); einmal beim Loslassen voll | Loslass-Render p95 > 100 ms → `Disabled(TooSlow)` |
  | `Disabled(reason)` | aus, Banner mit Grund | Nutzer kann auf „nur beim Loslassen“ zurückschalten |

  `plugin_budget ≤ 0` → alle Plugin-Passes `OnRelease`. Ein Schalter „trotzdem live“ gibt
  es nicht. Hinweis bei jeder Herabstufung: „Vorschau vereinfacht: Plugin X“.
- **Ohne Timestamps** (WARP, lavapipe, manche Treiber) lassen sich Zeiten keinem Pass
  zuordnen: keine Strikes und keine Herabstufung einzelner Plugins. Liegt die Wanduhr
  Submit → `on_submitted_work_done` des ganzen Frames über 8 ms, laufen alle Plugin-Passes
  `OnRelease`.
- **GPU-Probezeit-Journal**: Vor `create_shader_module`, vor `create_render_pipeline` und
  vor dem ersten Submit eines auf diesem Gerät neuen `(plugin, pass, hash)` schreibt Lumen
  `~/.local/state/lumen/gpu-probation.json` (Windows `%LOCALAPPDATA%\Lumen\state\`) mit fsync
  und löscht den Eintrag nach dem Fence. Treiber-Compiler können schon beim Erstellen von
  Modul oder Pipeline abstürzen oder Sekunden brauchen; deshalb läuft das alles im Zustand
  `Compiling` auf einem Worker, zusammen mit der lazy Hash-Prüfung der Artefakte und der
  naga-Validierung. `Live` wird der Pass erst, wenn alles fertig ist; bis dahin rendert der
  Frame ohne ihn (Abzeichen „wird vorbereitet“), nach 2 s Hinweis. Stirbt Gerät oder App,
  kommt der Pass beim nächsten Start in Quarantäne und der Nutzer wird gefragt.
- **Device lost** (`set_device_lost_callback`): eframe 0.37 bietet keinen Weg, Device und
  egui-wgpu-Renderer im laufenden Prozess neu aufzubauen (beim Bau in N2 gegen die Quellen
  prüfen). v1: Zustand sichern, kontrollierter Neustart der App, Plugin-Passes pausiert bis
  zur Bestätigung.
- Plugin-Passes bekommen nie eigene Timestamp-Queries, Storage-Bindings oder Features über
  das Basisprofil hinaus.

### GPU-Scheduler

wgpu hat eine Queue, die Editor-Frame, Vorschaubilder und Export teilen. Damit
Hintergrundarbeit Regler nie unter 60 Hz drückt (Entscheidung Manuel 7), bekommt
`lumen-gpu` einen Scheduler (ein Submitter-Thread, zwei Klassen):

- **Interaktiv** (Editor-Frame, Lupe): immer zuerst.
- **Hintergrund** (Export-Kacheln, Vorschaubilder, Pass-Cache-Aufwärmen, Bake-Upload): in
  Submits mit vorhergesagt ≤ 4 ms GPU-Zeit geschnitten (Vorhersage aus gemessenen ns/px je
  Pass × Kachelpixel, ohne Timestamps aus einem 256²-Probelauf), gesendet direkt nach dem
  Present. **Höchstens ein Hintergrund-Submit gleichzeitig in Arbeit**: Der nächste geht
  erst nach `on_submitted_work_done` des vorigen raus (die wgpu-Queue ist nicht
  unterbrechbar). Je Frame-Intervall gilt das Budget `min(4 ms, 16,7 ms − interaktiv_p95 −
  2 ms Reserve)`; ist es ≤ 0, ruht der Hintergrund in diesem Intervall.
- **Pause bei Interaktion**: keine neuen Hintergrund-Submits, solange eine **interaktive
  Edit-Änderung** in den letzten 250 ms kam (Ziehen, Tastatur-Schritte, Mausrad,
  Doppelklick-Reset, Undo/Redo, Schwenk/Zoom), nicht nur bei gedrücktem Zeiger. Ein schon
  eingereihter Submit läuft zu Ende; weil es höchstens einer ≤ 4 ms ist, kommt auch der
  erste Zieh-Frame rechtzeitig.
- Sagt der 256²-Probelauf mehr als 1,5 s je Kachel voraus, wird der Pass `Disabled(TooSlow)`
  (unter dem Windows-TDR von 2 s).

## CPU-Budget

Ohne gemeinsame Grenze laufen mehrere Pools nebeneinander: Plugin-Exec-Pool, LibRaw-OpenMP
(je aufrufendem Thread ein Team über alle Kerne), Vorschaubild-Worker, Export-Pool, parallele
WASM-Instanzen, später native Runner. `lumen-core::sched::CpuBudget` legt die Größen an
**einer** Stelle fest:

- Kerne: physische Kerne (`std::thread::available_parallelism` plus sysfs/cpuid-Prüfung).
- Reserviert: UI-Thread und GPU-Submitter-Thread.
- Klassen: **Vordergrund-Decode** (geöffnetes Bild, darf alle übrigen Kerne nutzen),
  **Interaktiv** (Editor), **Hintergrund** (Import, Vorschaubilder, Metadaten, Export,
  WASM-CPU-Schritte, Plugin-Exec-Pool, Erstkompilierung). Hintergrund-Threads laufen mit
  niedriger OS-Priorität (`nice`, `THREAD_PRIORITY_BELOW_NORMAL`) und schrumpfen auf einen
  Thread, solange ein Regler gezogen wird.
- **OpenMP**: `nice`/Thread-Priorität des aufrufenden Threads steuert die libomp-Worker
  nicht (libomp hält einen dauerhaften Pool; unter Linux erben Worker den nice-Wert nur bei
  ihrer Erzeugung, unter Windows starten sie normal). Deshalb:
  - Alle LibRaw-OpenMP-Aufrufe laufen durch **ein gemeinsames Gate** (höchstens ein
    OpenMP-Team gleichzeitig im Prozess), das der Vordergrund-Decode bekommt.
  - Hintergrund-Decodes (Import, Vorschaubilder, Export-Vorlauf) laufen mit
    `omp_set_num_threads(1)` (per Thread wirksam), also ohne Team, auf den gedrosselten
    Hintergrund-Threads.
  - Beim Start setzt Lumen `KMP_BLOCKTIME=0` und `OMP_WAIT_POLICY=passive` (vor dem ersten
    OpenMP-Aufruf), damit Worker nach einem Parallelbereich keine Kerne leer drehen.
  - `omp_set_num_threads` gilt erst für den nächsten Aufruf: **Ein laufender voller Decode
    (Z6III 810 ms auf allen Kernen) schrumpft beim Ziehen nicht.** Die 60-Hz-Zusage trägt in
    diesem Fall die Reservierung von UI- und GPU-Submitter-Thread (sie zählen nicht zum Team
    und laufen mit normaler bzw. erhöhter Priorität).
  - Native Plugins bekommen ihr Budget über `worker_threads()`, später der Runner über
    `OMP_NUM_THREADS`.
- Plugin-Exec-Pool, CPU-Schritt-Instanzen und `total_core_instances` des Pooling-Allocators
  leiten sich daraus ab (statt eigener Zahlen in jedem Abschnitt).

## Edit-State-, Preset- und Profil-Integration

### Edit-State (lumen-core, N1)

Neue oberste Ebene neben `adjustments`, `masks`, `crop` (heute `ImageEditState`,
`backend/app/schemas.py:512-527`):

```json
{ "adjustments": { "…": 0 }, "masks": [], "crop": null,
  "plugins": {
    "mrd.guided-denoise": { "v": 2, "version": "0.3.1", "passHash": "sha256:41aa…",
                            "enabled": true, "order": 0,
                            "params": { "strength": 35, "radius": 3, "chroma-only": false } } } }
```

- Rust: `BTreeMap<PluginId, PluginEntry>`, `params: serde_json::Map`. Param-Schlüssel stehen
  **genau wie im Manifest** (kebab-case); die camelCase-Regel des Wireformats gilt für die
  Hülle (`passHash`), nicht innerhalb von `params`. Einträge unbekannter Plugins werden
  **unverändert** mitgeführt (Round-Trip-Test, nie interpretiert). Grenzen: 8 KiB je Plugin,
  Tiefe 4, 64 Plugins.
- `passHash` = sha256 über die zusammengesetzten Module aller Ketten des Plugins in
  Reihenfolge.
- **Reihenfolge mehrerer Plugins**: `order` (Ganzzahl, optional, Standard 0) je Eintrag.
  Ketten am selben Hook und `export-pre-encode`-Schritte laufen sortiert nach
  `(order, plugin-id)`; gleiches `order` = alphabetisch nach Plugin-ID. Damit ist die
  Reihenfolge Teil des Edits und des Presets und auf jedem Rechner gleich (nicht die
  Installationsreihenfolge).
- Plugin-Werte nie in `adjustments` (sonst bricht das 8-Gruppen-Mapping in `edit-groups.json`).
- **Eine Klemmstelle:** `GpuPassHost::set_params` (der einzige Schreiber des Uniform-Puffers)
  klemmt jeden Wert gegen `min`/`max` des **installierten** Manifests, egal woher er kommt
  (Edit laden, YAML, Batch-Apply, Marketplace-Preset, `migrate`, `edit-own.set`). Beim Laden
  werden Ausreißer zusätzlich angezeigt (Edit markiert).
- `edit-own.set` prüft gegen die Param-Deklaration: nur deklarierte Schlüssel, richtiger Typ,
  Floats auf `step` quantisiert, Kurven ≤ 16 Punkte. So wird der Edit kein verdeckter Kanal.
- **Fehlendes oder deaktiviertes Plugin**: Werte bleiben, Abzeichen „Plugin
  „Geführte Rauschminderung“ fehlt – Effekt nicht angewendet“, Bild rendert ohne den Pass,
  Export warnt vorher. Das spiegelt die `processVersion: null`-Regel: Unbekanntes bleibt
  und wird nie umgedeutet.
- **`passHash` weicht ab** (Update): Abzeichen „Look kann abweichen“, nie automatisch
  aufgelöst. Lumen behält alte Versionen in `plugins/<id>/<version>/`, bis der Nutzer sie
  entfernt; eine Version kann je Plugin gepinnt werden.
- **Migration**: Integer `v`. S2/nativ exportieren `migrate(from_v, params)`, S1 nutzt die
  `[[migrate]]`-Tabelle. Der Host migriert beim Laden im Speicher und speichert erst nach
  einer Nutzeränderung.
- Vorschaubild- und Pass-Cache-Schlüssel enthalten `(passHash, params_hash)`, nicht die
  Plugin-Version; Vorschaubilder rendern durch denselben `render_graph`.

### Schritt-Gruppen

`profile_groups` wird dynamisch: die 8 eingebauten Gruppen aus `edit-groups.json` plus
`plugin:<id>` je installiertem Plugin, mit lokalisiertem Namen und
`default-enabled-in-batch` (geometrieartige Plugins sollen `false` setzen). Gilt für
StepCheckboxes, Batch-Apply und `merge_edit_state`.

### YAML-Profil

`lumenProfile: 1` bleibt. Neu und optional: `plugins:` (gleiche Form wie im Edit-State) und
`requires: [{ id, minVersion }]`. Ein Test in N1 stellt sicher, dass der Rust-Port von
`parseProfileYaml` unbekannte Blöcke toleriert.

### Server-Presets (N9, Migration 015)

- `PresetIn.plugins: dict[PluginId, PluginParamsIn] | None`. `extra="forbid"` bleibt auf
  allen Modellen. `PluginId` per Regex `^[a-z0-9-]{2,32}\.[a-z0-9-]{2,48}$`,
  `PluginParamsIn` mit `v: int`, `version: str`, `order: int | None`, `params: dict[str,
  scalar | list]`, ≤ 8 KB, Tiefe ≤ 4. Der Server prüft nur Form und Größe, nie
  Plugin-Semantik.
- Vor dem Senden (Preset speichern, YAML-Import, Veröffentlichen) **entfernt der Client**
  `passHash` und `enabled` und lässt deaktivierte Einträge ganz weg; so passt ein
  Edit-State- oder YAML-Eintrag zu `extra="forbid"`.
- `PresetOut.requiresPlugins: list[{id, minVersion}]`, damit die App vor dem Download warnt.
  Kein Eingabefeld: Der Server leitet es ab als `[{id, minVersion: plugins[id].version}
  for id in plugins]`.
- Beim Veröffentlichen oder Teilen sendet die App Plugin-Params nur für installierte Plugins
  und nur, wenn sie der Deklaration entsprechen; andere Einträge werden mit Hinweis
  weggelassen.
- **Presets installieren nie Plugins.** Unerfüllte `requires` zeigen „Benötigt Plugin X
  (nicht installiert)“ mit Link auf die Marketplace-Seite; Installation dann über den
  normalen Zustimmungsablauf.

### Katalog

Lokale Tabellen `plugin_meta(image_id, plugin_id, key, value, PRIMARY KEY(image_id,
plugin_id, key))` und `plugin_settings(plugin_id, key, value)` kommen additiv in N11b
(lokale Katalog-Migration); N6 baut nur die internen Registries. Deinstallieren bietet
„Daten des Plugins löschen“ (Zeilen + `plugin-data`-Ordner).

## Verteilung über den Marketplace

Nur S1/S2-Pakete (Entscheidung Manuel 4). Native Pakete lehnt der Server ab.

### Server (v1, N11b)

- Tabellen in einer **additiven Migration in N11** (Nummer beim Bau; 015 bleibt bei den
  Preset-Feldern): `plugin_listings(id, publisher_user_id, name, tier, status, hidden,
  reports_count, created_at)`, `plugin_versions(plugin_id, semver, api, tier, sha256, size,
  manifest_bytes, signatures, artifact_path, published_at, revoked_at)`,
  `publisher_keys(user_id, prefix, key_id, pubkey, created_at, revoked_at)`.
- **Artefakte auf Platte**, nicht in Postgres: gestreamt nach `/srv/lumen/plugins/<sha256>`
  (kein `bytea`, keine aufgeblähten Backups/WAL). Das globale 1-MiB-Body-Limit wird nur für
  `POST /api/v1/plugins` angehoben (S1 ≤ 1 MiB, S2 ≤ 64 MiB), Upload gestreamt.
- Endpunkte (lesen anonym, veröffentlichen mit Konto über PKCE):
  `GET /api/v1/plugins`, `GET /api/v1/plugins/{id}` (Cursor-Paging wie der Marketplace,
  `MAX_CURSOR_OFFSET`), `GET /api/v1/plugins/{id}/versions/{v}/download` (Zählung über den
  gesalzenen Tageshash wie `preset_downloads`), `POST /api/v1/plugins`,
  `POST /api/v1/plugins/{id}/report`, `POST /api/v1/publisher-keys` (Publisher-Schlüssel
  registrieren: `{pubkey}`; beim ersten Schlüssel eines Kontos vergibt der Server das Präfix
  aus dem Wunsch `{prefix}`, reservierte und vergebene Präfixe → 409; weitere Schlüssel =
  Rotation, der alte bleibt bis zum Widerruf gültig), `POST /api/v1/publisher-keys/{key_id}/revoke`
  (setzt `revoked_at`; Versionen, die danach mit diesem Schlüssel hochgeladen werden, lehnt
  der Server ab). Beide nur mit **TOTP-Step-up**: Das Access-Token muss `amr` mit `otp`
  enthalten (Keycloak-AMR-Mapper) oder `acr` ≥ der für OTP konfigurierten Stufe (Step-up per
  `acr_values`, Keycloak „Level of Authentication“), und `auth_time` darf höchstens 5 min
  zurückliegen; sonst 403. Später: `GET /api/v1/plugins/index`,
  `GET /api/v1/plugins/revocations`.
- **Moderation**: `moderation.py` wird um `kind=plugin` erweitert, mit diesen Abweichungen
  von Presets: (1) schon **eine** Meldung blendet das Plugin aus Listen aus (nicht bei
  installierten Clients) und stellt es in die Admin-Prüfung; (2) gezählt werden nur
  Meldungen von Konten über `REPORT_MIN_ACCOUNT_AGE_HOURS`, damit niemand Konkurrenz per
  Wegwerfkonto versteckt; (3) bestätigter Schadcode → Version zurückgezogen +
  `block_publishing` für den Publisher (Sperrliste, sobald gebaut).
- **Automatische Prüfung** mit **demselben Validator wie der Client** (`lumen-plugin
  validate`, in einem netzlosen Container ohne Zugangsdaten, Unterprozess mit CPU-Zeit- und
  Speichergrenze): Paketgrenzen, Pfad- und Zip-Regeln, `[files]` vollständig, Unicode- und
  Skeleton-Prüfung; Manifest-Schema, ID-Präfix ↔ Publisher-Schlüssel, reservierte Präfixe,
  OSI-Lizenz, Quell-URL, Ausleitungs-Regel; WASM `wasm-tools validate`, Welt passt,
  **Import-Liste ⊆ angefragte Rechte + Basis-WASI**; WGSL-Validator + Kostenbericht;
  Rechte-Diff zur Vorversion (neues Recht oder Stufensprung → manuelle Prüfung durch Manuel).
  Plugin-eigene `tests/` laufen **nicht** auf dem Prod-VPS.
- **Gegensignatur** nach bestandener Prüfung mit dem Marketplace-Schlüssel (Nachricht oben).
  README wird als Klartext angezeigt (oder Markdown ohne Bilder/HTML); Links öffnen erst nach
  einer Bestätigung „Im Browser öffnen: *URL*“.

### Schlüssel und Signaturen (Format festgelegt; v1 baut Publisher + Gegensignatur)

| Schlüssel | Halter | Zweck | Ablage | v1 |
|---|---|---|---|---|
| **Lumen-Root** (Ed25519) | Manuel | zertifiziert die anderen Schlüssel; einzige Instanz, die Sperren **aufheben**, Platzhalter-Sperren setzen und den Sperr- oder Gegensignatur-Schlüssel widerrufen darf | offline (Hardware-Token/Papier), öffentlicher Teil in der App einkompiliert (N10) | Public Key einkompiliert |
| **Marketplace-Gegensignatur** (Ed25519, jährlich rotiert) | Server | signiert geprüfte Pakete (später auch den Index) | Server-Secret, nie in der DB; Zertifikat = Root-Signatur über `"lumen-cert-v1\0" ‖ "countersign\0" ‖ key ‖ u64be(not-before) ‖ u64be(not-after)` (Format bei `SIGNATURES`), steht in jedem `SIGNATURES [marketplace].cert` | ✓ (ein Schlüssel; Zertifikat in `SIGNATURES`, mit der App nur vorbelegt) |
| **Sperr-Schlüssel** (Ed25519) | Manuel, online (z. B. Passwortmanager) | darf Sperrlisten-Einträge nur **hinzufügen**, nur exakte `(id, sha256)`-Paare, ≤ 20 je Liste | getrennt vom Server; Zertifikat vom Root | später |
| **Publisher** (Ed25519) | Plugin-Autor | signiert das Manifest | Autorenrechner, `lumen-plugin keygen`; Registrierung/Rotation am Konto nur mit TOTP in Keycloak | ✓ |

Prüfung offline im Client mit `ed25519-dalek` und `sha2` (beide beim Hinzufügen pinnen).
Eine Marketplace-Installation braucht **beide** Signaturen (Publisher + Gegensignatur).

**TOFU-Publisher-Bindung (später, mit dem ersten fremden Autor).** Die Bindung Präfix ↔
Schlüssel steht auf dem Server; ein kompromittierter Server oder eine gestohlene
Konto-Sitzung könnte einen neuen Schlüssel für `mrd.` eintragen. Deshalb speichert der
Client bei der ersten Installation eines Präfixes den Publisher-Schlüssel in der
Zustimmungsdatei. Ein Schlüsselwechsel gilt nur mit einer Rotationserklärung, die der alte
Schlüssel signiert (`"lumen-key-rotation-v1\0" ‖ prefix\0 ‖ old_key(32 B) ‖ new_key(32 B) ‖
u64be(not_before)`, als Datei `rotation.toml` mit `prefix`, `old-key`, `new-key` (base64),
`not-before` (String im festen Zeitformat) und `sig`),
oder mit einer Root-signierten Rücksetzung. Danach kann der Server für Nutzer, die das
Präfix schon kennen, keinen Publisher fälschen; bei der Erstinstallation vertraut der Client
der Server-Bindung (ehrlich im Bedrohungsmodell benannt). Bis dahin (v1) gilt: Marketplace
liefert nur S1/S2, also Sandbox-Code.

**Signierter Index (später)** `index.toml` mit `seq`, `generated-at` und `[[entry]]` `{id,
version, sha256, tier, capabilities-digest, published-at}`, gegensigniert (Hülle unten): Der Client speichert das höchste `seq`
und lehnt kleinere ab (Rollback); bei einem ausdrücklichen Update-Check warnt er, wenn
`generated_at` älter als 30 Tage ist (Freeze). Der Index ist öffentlich und nur anhängend –
jeder kann ihn spiegeln und vergleichen.

**Signaturhülle für Index und Sperrlisten** (Format jetzt festgelegt): Jedes Objekt ist eine
TOML-Datei plus eine Datei `<name>.sig` daneben. Signiert werden die **exakten Bytes** der
TOML-Datei, nie eine kanonisierte Form:

```toml
# index.sig / revocations.sig / revocations-root.sig
key-id = "ed25519:…(64 hex)"
sig    = "base64…"
cert   = { role = "countersign", key = "base64…", not-before = "…Z", not-after = "…Z", root-sig = "base64…" }   # fehlt bei Root
```

| Objekt | Datei | Unterzeichner | Nachricht |
|---|---|---|---|
| Index | `index.toml` | Gegensignatur-Schlüssel (`cert.role = "countersign"`) | `"lumen-index-v1\0" ‖ sha256(bytes)` |
| Sperrliste | `revocations.toml` | Sperr-Schlüssel (`cert.role = "revocation"`) | `"lumen-revocations-v1\0" ‖ "revocation\0" ‖ sha256(bytes)` |
| Root-Liste | `revocations-root.toml` | Root (einkompiliert, kein `cert`) | `"lumen-revocations-v1\0" ‖ "root\0" ‖ sha256(bytes)` |

Zeiten in den TOML-Dateien sind Strings im festen Format `YYYY-MM-DDTHH:MM:SSZ`.

**Sperrlisten (später).** Eine Liste hat genau **einen** Unterzeichner; der gilt je Datei,
nicht je Eintrag (es gibt kein Feld `signer`). Sperr- und Root-Listen haben **getrennte**
`seq`-Zähler; der Client speichert beide und lehnt kleinere ab.

```toml
# revocations.toml (Sperr-Schlüssel): nur exakte Paarsperren, ≤ 20 Einträge
seq          = 42
generated-at = "2027-02-01T09:00:00Z"
[[entry]]
kind     = "package"
id       = "mrd.guided-denoise"
sha256   = "41aa0c3e0000000000000000000000000000000000000000000000000000d107"
severity = "disable"                  # "disable" | "warn"
reason   = "Schadcode bestätigt"
```

```toml
# revocations-root.toml (Root): zusätzlich Bereiche, Schlüssel-Widerruf, Aufhebung
seq          = 3
generated-at = "2027-02-02T12:00:00Z"
[[entry]]
kind     = "package"
id       = "evil.plugin"
versions = "*"                        # oder semver-Bereich "<=0.3.1"; statt sha256
severity = "disable"
reason   = "Publisher gesperrt"
[[entry]]
kind         = "key"
key-id       = "ed25519:…(64 hex)"
role         = "countersign"          # "countersign" | "revocation" | "publisher"
invalid-from = "2027-01-15T00:00:00Z" # optional; Signaturen mit published-at ≥ diesem Wert ungültig, fehlt = alle
reason       = "Server kompromittiert"
[[entry]]
kind   = "lift"                       # hebt eine Paketsperre auf
id     = "mrd.guided-denoise"
sha256 = "41aa…"
```

Prüfregel: Einträge mit `versions`, `kind = "key"` oder `kind = "lift"` sind **nur in
Root-Listen** gültig; eine Sperrliste mit solchen Einträgen wird ganz verworfen. Der Client
vereinigt beide Listen; ein Root-`lift` entfernt nur die passende Paketsperre. Ein Client
entfernt sonst nie einen Eintrag. Geladen nur bei Nutzeraktionen im Marketplace (Stöbern, Installieren, „Nach
Updates suchen“) oder bei der opt-in „Sicherheitsprüfung beim Start“ (Standard **aus**);
jedes App-Release bündelt einen Stand. `disable` stoppt sofort (Passes entfernt, Instanzen
beendet): „Plugin X wurde vom Lumen-Team gesperrt: <Grund>“. `warn` kann der Nutzer
übergehen, `disable` nicht.

**Staging/Wartezeit (später).** Neue Versionen gelten erst nach 72 h als „aktuell“ (gilt
nur für S1/S2; native Pakete kommen nach Entscheidung 4 nicht in den Marketplace); vorher nur für Nutzer, die je Plugin „Vorabversionen“ wählen. Der **Client**
erzwingt es: „aktuell“ nur, wenn `published_at + Wartezeit ≤ jetzt` und der Eintrag im Index
steht. Sicherheitsfixes kann Manuel mit Root-Signatur beschleunigen.

### Installation, Pinning, Updates (v1)

1. Herunterladen bzw. Datei wählen, Grenzen und Signaturen prüfen.
2. Zustimmungsblatt: Name, Publisher (voller Fingerprint bzw. „wie installierte Version“, siehe „Signaturen“), Stufen-Abzeichen, Rechte in Klartext,
   Hash, Quell-Link, Prüfdatum bzw. „nicht geprüft“ bei Datei-Installation.
3. „Installieren“.

- Ablage `~/.local/share/lumen/plugins/<id>/<version>/` bzw.
  `%LOCALAPPDATA%\Lumen\plugins\<id>\<version>\`, kopiert und schreibgeschützt; Ordner, die
  für Gruppe/Welt (Linux) oder andere SIDs (Windows-ACL) schreibbar sind, werden abgelehnt.
- **Zustimmungsdatei** `~/.config/lumen/plugins.toml`: je Plugin `{version, sha256 je Datei,
  gewährte Rechte, Stufe, approved_at, publisher_key}`. Vor der ersten Aktivierung je Sitzung
  werden die Dateien lazy neu gehasht (≈ 50 ms für 20 MB, auf einem Worker im Zustand
  `Compiling`). Abweichung → aus, Warnung „Datei verändert“, neue Zustimmung nötig. Geladen
  wird genau die geprüfte Kopie.
- **Updates nie automatisch.** „Nach Updates suchen“ (opt-in, wie der App-Update-Check) zeigt
  je Update Changelog und **Rechte-Diff** (neue Rechte fett; Stufenwechsel wie
  Neuinstallation). **Downgrade-Schutz**: Versionen kleiner als die installierte bietet der
  Client nie als Update an; ein Downgrade geht nur ausdrücklich über „Version wählen“.
- **Datei-Installation** (`.lumenplugin` per Drag & Drop oder Datei → Plugin installieren,
  offline): S1/S2 mit Warnung „nicht geprüft“, Publisher-Signatur wird nach den Regeln in
  „Signaturen“ angezeigt. Pakete mit `[artifacts] native` lehnt die Datei-Installation in v1
  ab („Native Plugins gibt es in dieser Version nur im Entwicklermodus“); nativ lädt v1 nur
  über `--dev-plugins` (Dev-Ladeweg). Mit S3 (später) kommt die native Datei-Installation
  mit globalem Native-Schalter, Eintippen der Plugin-ID und FenceReport. Reservierte Präfixe
  und gleiche ID mit anderem Herausgeber: siehe „Reservierte Publisher-Präfixe“.
- Geschlossene (nicht OSI-lizenzierte) Plugins gehen nur per Datei-Installation.

### Lokale Notbremsen

- **Abgesicherter Modus**: `lumen --safe-mode` oder Shift beim Start. Keine Plugins, keine
  Passes; Edits behalten ihre Plugin-Werte.
- **Crash-Loop-Schutz**: Endet Lumen zweimal binnen 60 s nach Start abnormal, während
  Plugins aktiv waren, bietet der nächste Start den abgesicherten Modus mit der Liste der
  damals aktiven Plugins an (`~/.local/state/lumen/session.json`).
- Schalter je Stufe („Alle Shader-Plugins aus“, „Alle Sandbox-Plugins aus“), je Plugin (aus,
  deinstallieren mit Daten, Version pinnen), je GPU-Pass (aus, „nur beim Loslassen“).
- **Plugin-Inspektor** (Hilfe → Plugins, immer vorhanden): Zustand und Grund, GPU p50/p95
  gegen das aktuelle `plugin_budget`, WASM-Aufrufzeiten, Traps, Speicher-Höchststand,
  Rechte-Aufrufe (letzte 50), Netz-Log (Host, IP, Zeit, Bytes), Ereignis-Verluste, aktuelle
  Params als JSON. „Diagnose kopieren“ ohne Bilddaten und Pfade.

## Versionierung und Kompatibilität

Drei Versionsnummern, die sich nie mischen: App (`1.4.2`), Plugin-API (`0.1`, später `1.0`),
Plugin (semver). Dazu die C-ABI (`1.0`, eingefroren ab N11c).

| Fläche | Schema | Zusage |
|---|---|---|
| WIT `lumen:plugin@0.x`/`1.x` | Ordner `wit/since_vX.Y.Z` | Host hält Bindings für die aktuelle und die vorige Major ≥ 12 Monate; innerhalb einer Major nur Zusätze |
| C-ABI | `abi_major.minor` + `struct_size` | eingefroren als 1.0; Major ungleich → abgelehnt; Minor nur anhängen; Bruch = `_v2`-Symbol |
| WGSL-Prelude | Teil von `api` | Prelude-Funktionen werden innerhalb einer Major nie entfernt |
| Manifest | `schema = 1` | `deny_unknown_fields`; neues Schema braucht neue App, klare Meldung „Plugin benötigt Lumen ≥ X“ |
| `SIGNATURES`, Zertifikat, Index, Sperrlisten, Rotation, Dev | Domänen-Präfixe `lumen-plugin-v1`, `lumen-marketplace-v1`, `lumen-cert-v1`, `lumen-index-v1`, `lumen-revocations-v1`, `lumen-key-rotation-v1`, `lumen-dev-v1` | neue Fassung = neues Präfix, alte bleibt prüfbar |
| Plugin-Params | Integer `v` + Migration | Host schreibt Params nie ohne das Plugin um |
| App | `lumen = ">=1.0, <2.0"` | vor Installation geprüft |

- **0.x-Vorschau** (ab N11 bis etwa 3 Monate nach den ersten fremden Plugins): Minor-Versionen
  dürfen brechen, mit Migrationshinweis und Hinweis in `lumen-plugin check`; der Host
  unterstützt aktuelle und vorige 0.x-Minor. Ab 1.0 nur additiv.
- **Feature-Erkennung statt Versionsvergleich**: `has-feature("gpu.compute")`.
- **Experimentelle APIs** hinter `api-experimental = ["…"]` im Manifest: nur im Dev-Modus,
  nicht veröffentlichbar (VS-Code-`enabledApiProposals`-Muster).
- wasmtime wird nur zwischen LTS-Linien bewegt (48 → nächste LTS), Patch-Releases mit jedem
  App-Release. Ein Bump invalidiert den `.cwasm`-Cache automatisch (Schlüssel enthält den
  Engine-Hash).

**Lizenz** (Entscheidung Manuel 5). `lumen-plugin-abi`, `lumen-plugin-api` (WIT),
`lumen-plugin-sdk` und `lumen-plugin-manifest` stehen unter MIT OR Apache-2.0;
Plugin-Autoren linken nie AGPL-Code. Die App bekommt eine Zusatzerlaubnis nach AGPL-3.0 §7
(SPDX `AGPL-3.0-or-later WITH AdditionRef-Lumen-Plugin-Exception`; nach `WITH` ist nur eine
Exception-ID der SPDX-Liste oder eine `AdditionRef-…` (SPDX 3.0) gültig, nie `LicenseRef-`);
sie kommt als **eigene Aufgabe L** ins Repo (Abschnitt „Einordnung“). Text:

> „Zusätzliche Erlaubnis nach GNU AGPL Version 3, Abschnitt 7: Wenn Sie dieses Programm
> oder ein darauf basierendes Werk mit einem Plugin kombinieren, das ausschließlich über die
> Lumen-Plugin-Schnittstelle (die in lumen-plugin-abi, im WIT-Paket lumen:plugin und im
> dokumentierten WGSL-Pass-Vertrag definierten Schnittstellen) mit dem Programm
> interagiert, erteilen die Lizenzgeber die zusätzliche Erlaubnis, das resultierende Werk
> weiterzugeben; das Plugin darf unter Bedingungen Ihrer Wahl verbreitet werden, sofern es
> außer der Plugin-Schnittstelle keinen Code des Programms enthält. Diese Erlaubnis gilt
> nicht für veränderte Fassungen des Programms, die die Plugin-Schnittstelle so ändern, dass
> Interna offengelegt werden.“

Nur Rechteinhaber können sie erteilen; Manuel ist derzeit Alleinautor, deshalb jetzt
aufnehmen (DCO + Hinweis in CONTRIBUTING: Beiträge unter derselben Ausnahme). Wirksamkeit
anwaltlich prüfen lassen, bevor fremde Autoren eingeladen werden. Der Marketplace verlangt
eine OSI-Lizenz und eine Quell-URL; geschlossene Plugins nur per Datei. Ein Plugin, das eine
eigene LibRaw-Kopie mitbringt, erfüllt deren LGPL-2.1 selbst.

## Sicherheit

| Gegner | Ziel | Hauptabwehr | v1 |
|---|---|---|---|
| Böswilliger Erst-Publisher | Dateien/Schlüssel stehlen, Fotos ausleiten | WASM-Sandbox, Link-Zeit-Rechte, kein Netz/FS als Standard, keine Pfade, Ausleitungs-Regel, Netz-Filter (private IPs, Rebinding), Prüfung + Gegensignatur | ✓ |
| Gekapertes Publisher-Konto (GlassWorm) | Schad-Update an die Installationsbasis | Publisher-Schlüssel getrennt vom Konto-Passwort (TOTP), keine Auto-Updates, Rechte-Diff, Hash-Pinning; später Staging im Client, TOFU, öffentlicher Index | teilweise |
| „Schläfer“-Plugin | später bösartig werden | Hash-Pinning, neue Zustimmung bei jeder Rechteänderung, Downgrade-Schutz | ✓ |
| Kompromittierter Marketplace-Server | manipuliertes Paket an einzelne Nutzer | Publisher-Signatur Pflicht, nur Sandbox-Stufen im Marketplace; später TOFU, signierter monotoner Index, Root offline, Server kann Sperren nicht aufheben | teilweise |
| Ehrliches, fehlerhaftes Plugin | Absturz, Hänger, GPU-TDR, langsame Frames | Epoch-Deadlines (1 ms) + harte Wanduhr-Grenzen, Speichergrenzen (auch in Summe), Strikes, GPU-Probezeit-Journal, dynamisches Budget, GPU-Scheduler | ✓ |
| Bösartiges Preset/geteilter Edit | Code über Daten auslösen | Presets sind reine Daten; `requires` zeigt nur einen Hinweis; Größen-/Tiefengrenzen; Klemmung in `set_params` | ✓ |
| Bösartiger Shader | GPU hängen lassen, Kostenregel umgehen | nur Funktionen, `_lumen`-Globals unerreichbar, Kostenregel je Pixel über alle Aufrufe, Zähler unveränderlich, Klemmung + `min()` der Schranken, `checked()`-Laufzeitprüfungen, feste Limits, 4-ms-Hintergrund-Submits, Journal vor Kompilierung | ✓ |
| Verdeckter Kanal über Edits | Daten über geteilte Presets ausleiten | `edit-own` nur deklarierte, quantisierte Werte; beim Teilen nur deklarierte Params installierter Plugins | ✓ |
| Klick-Täuschung | Token durch untergeschobenen Knopf | 500-ms-Eingabesperre für neue/verschobene Widgets, Host-Bestätigung bei erster `net`-Nutzung je Knopf und Host | ✓ |
| Lokaler Angreifer mit Schreibrecht im Plugin-Ordner | Binary nach Zustimmung tauschen | schreibgeschützte versionierte Kopie, Neu-Hash vor Aktivierung, unsichere Ordnerrechte abgelehnt, `.cwasm` über einen Deskriptor gehasht und gelesen | ✓ |
| DLL-Hijacking (Windows) | fremde DLL unterschieben | `lumen.exe` (und später der Runner) mit `/DEPENDENTLOADFLAG:0xA00` gelinkt (APPLICATION_DIR\|SYSTEM32; `0x800` allein bräche `libomp.dll` neben der exe; lld-link-Unterstützung beim Bau mit LLVM 21 prüfen), dazu `SetDefaultDllDirectories`/`SetDllDirectoryW("")` beim Start (zu spät für statische Imports, deshalb das Link-Flag); DXC-Ladeweg in wgpu 30 prüfen (statisch oder absoluter Pfad) | ✓ (N10) |
| Social Engineering („installier dieses native Plugin“, „schalt Dev-Modus ein“) | volles Vertrauen erschleichen | kein nativer Code aus dem Marketplace, S4 nur mit lokal erzeugter Dev-Signatur + Startdialog mit Hashes, feste Warntexte | ✓ |
| Windows-S3 ohne AppContainer | Runner schreibt per `OpenProcess` in `lumen.exe`, bricht damit auch die S2-Sandbox | gilt als S4-gleichwertig → unter Windows nicht angeboten, bis der AppContainer-Fluchttest besteht | ✓ (aus) |
| Phishing-UI | Passwörter abgreifen, Menüs fälschen | keine Texteingabe, keine Plugin-Bilder, kein Toast in v1; Plugin-Befehle nur unter „Plugins“; Abzeichen nicht überschreibbar; Skeleton-Prüfung der Namen; README als Klartext | ✓ |
| Datenschutz (GPS, Seriennummer, Besitzer, Ordnerstruktur, Bildinhalte) | private Daten oder Pixel aller Bilder sammeln und beim nächsten Knopfdruck hochladen | `catalog.read.location` separat; GPS, Seriennummern und Besitzer aus `raw-meta.extra`, Encoder-EXIF (gleiche Allowlist, eigene Export-Schalter), Ereignissen und Export-an-`post` gefiltert; Import-Hooks nur 64 Byte, nur Basenames, Netz nur mit Token; Ausleitungs-Regel auch für Encoder und CPU-Schritt/Bake (kein `net`/`clipboard.write` neben Bildinhalten), Hochladen nur über `export.post` mit den gerade exportierten Dateien | ✓ |
| Meldungs-Missbrauch | fremdes Plugin per Meldung verstecken | Auto-Hide nur durch Konten über Mindestalter, nur aus Listen, Admin-Prüfung | ✓ |
| Feindliche Runner-Antworten (S3, später) | Host-Speicher korrumpieren | Grenzprüfung jeder Nachricht, postcard in feste Typen, Ring einmal lesen | später |
| Kanal-Übernahme (S3, später) | Pipe/Socket eines anderen Plugins belegen | nur anonyme, vererbte Kanäle | später |

Außerhalb des Bedrohungsmodells: vollständig kompromittiertes Nutzerkonto oder OS,
Seitenkanäle zwischen Plugins in wasmtime (Spectre-Klasse), Steganografie in vom Nutzer
selbst exportierten Bildern. In der Doku als Restrisiko benannt.

## Performance-Budgets

| Pfad | Budget | Mechanismus |
|---|---|---|
| Slider → Frame (Proxy) | ≤ 16,7 ms gesamt; GPU ≤ 8 ms **auf jeder GPU**; Plugin-Passes Σ ≤ `plugin_budget` (dynamisch) | Host schreibt Uniforms aus dem Edit-State, kein Plugin-Aufruf im Live-Pfad; Timestamps; `Reduced`/`OnRelease`/`Disabled` |
| Slider während Export/Vorschaubildern | ≥ 60 Hz | GPU-Scheduler (≤ 4-ms-Submits, Pause beim Ziehen), `CpuBudget` (Hintergrund schrumpft beim Ziehen) |
| Kette bei `skip-when` | 0 ms | aus dem Graphen entfernt; leerer Graph = heutiger Pfad |
| Ton-Regler bei aktiver `source`-Rauschminderung | + 0 ms Plugin-Zeit | Pass-Cache auf `source`-Ergebnis |
| 1:1-Zoom mit `source`-Plugin | Schwenk ohne Warten | Kachel-LRU, fehlende Kacheln aus dem Proxy hochskaliert |
| UI-Frame-CPU | + ≤ 0,3 ms für 10 sichtbare Plugin-Panels | Baum als Daten im `Arc`, ≤ 64 Knoten, `describe` off-thread, latest wins |
| Panel-Callback | 50 ms harte Deadline, off-thread | alter Baum bleibt stehen |
| App-Start mit 50 Plugins | Δ 0 ms bis zum ersten Frame; Manifest-Scan danach im Hintergrund ≤ 1 s (Windows mit Defender eingerechnet) | Scan nach dem ersten Frame auf einem Thread; Edit-Einträge noch nicht registrierter Plugins werden ohnehin mitgeführt |
| Erste Aktivierung S2 | ≤ 30 ms mit `.cwasm` im Cache; Erstkompilierung 0,2–2 s nur bei Installation im Hintergrund | `precompile_component`, `InstancePre`, Pooling |
| Erste Aktivierung S1 | Frame wartet nie; Pass nach `Compiling` live | Worker: Hash, naga, Pipeline, Journal |
| Decode per S4-Plugin (`libraw-runner`) | ≤ 1,02 × eingebaut | direkte Allokation in Host-Speicher |
| Decode per S2-Plugin | bearbeitbar < 1 s **nicht** zugesagt; eingebettete Vorschau sichtbar | Abzeichen, Fortschritt, `write-rows-u16` |
| Import 5 000 RAWs mit 2 Import-Hooks | bleibt ≤ 3 min | 256er-Bündel, 5 ms je Kandidat, Hook-Abschaltung bei > 1 ms Mittel; Metadaten-Plugins danach im Hintergrund |
| Export mit Plugins | DS-Wert (Z6III JPEG < 3 s) + Σ vorhergesagte Plugin-Kosten (GPU ns/px × px voll + CPU-Schritt ns/px gemessen) | Vorhersage im Export-Dialog und im Plugin-Manager („verlängert Export um ~0,4 s“) |
| Hash-Prüfung | ≤ 50 ms je 20 MB, einmal je Sitzung vor Aktivierung | sha2, lazy, auf Worker |
| Speicher | S2 ≤ 1 GiB je Store (Workflow 128 MiB), Σ ≤ min(4 GiB, 25 % RAM); Plugin-VRAM ≤ 256 MB; Bake-Cache ≤ 4 GiB Platte | StoreLimits + gemeinsamer Limiter, LRU |

Schätzungen, in `lumen-bench` zu messen (N11a/b): Pass-Zeit von `guided-denoise` auf 680M und
UHD 630; WASM-CPU 1,3–2,5× nativ je Thread; gekachelt mit den vom `CpuBudget` erlaubten
Instanzen etwa 2–3× nativ-OpenMP; LibRaw → `wasm32-wasip2` (wasi-sdk, `-msimd128 -O3
-fwasm-exceptions`, `open_buffer`) voller Z6III-Decode ~2,5–3,5 s. `lumen-plugin-host` hat
Features `wasm` und `native`; `--no-default-features` baut ohne wasmtime (kleinere
CI-Binaries, Ausweg).

## Crate-Aufbau

```
desktop/
  crates/
    lumen-core/src/sched.rs CpuBudget (N6)
    lumen-plugin-manifest/  Manifest-/Paket-Typen und -Validierung (Pfad-/Zip-Regeln, [files]),
                            Unicode- und Skeleton-Prüfung, Rechte-Modell + Ausleitungs-Regel,
                            Ausdrucks-Minisprache (skip-when, enabled_when), SIGNATURES-Format,
                            schemars-Export. Kein wasmtime. MIT OR Apache-2.0.
                            deps: serde, toml, semver, schemars, sha2, ed25519-dalek (beim Hinzufügen pinnen)
    lumen-plugin-api/       wit/since_v0.1.0/*.wit + gemeinsame Rust-Typen (ParamDecl, PanelDesc,
                            PassDecl). MIT OR Apache-2.0. Kompiliert mit wasm-tools, ohne Host.
    lumen-plugin-abi/       #![no_std] #[repr(C)], ABI 1.0, build.rs → desktop/sdk/c/include/lumen_plugin.h
                            (cbindgen). MIT OR Apache-2.0.
    lumen-plugin-sdk/       Gast-SDK: Traits Decoder/MetadataReader/CpuOp/Encoder/Workflow,
                            Makro lumen_plugin!{}; target_family = "wasm" → wit-bindgen (Welt aus
                            den Rollen), sonst → C-Vtable + catch_unwind. MIT OR Apache-2.0.
    lumen-plugin-host/      Registry, Zustimmungsdatei, Rechte-Broker, Nutzeraktions-Token, Netz-Filter,
                            wasmtime =48.0.10 + wasmtime-wasi =48.0.10 (Feature "wasm"),
                            S4-Lader (Feature "native", libloading). AGPL + Ausnahme.
    lumen-plugin-runner/    (später, S3) [[bin]]: landlock + seccompiler (Linux), windows-sys =0.61.2.
    lumen-plugin-test/      Golden-/Konformanz-Harness (lavapipe, 2/255), auch für Autoren per cargo test.
    lumen-gpu/src/plugin/   validate.rs (naga =30.0.2), cost.rs, prelude.rs (Codegen), graph.rs
                            (PassGraph), cache.rs (Proxy + Kachel-LRU), timing.rs (TIMESTAMP_QUERY,
                            core_p95, plugin_budget), probation.rs
    lumen-gpu/src/sched.rs  GPU-Scheduler (N6)
    lumen-raw/src/registry.rs   Decoder-/MetadataReader-Trait + DecoderRegistry, LibRawDecoder
  tools/lumen-plugin/       CLI (clap): new, check, expand, test, dev, pack, sign, keygen, validate
  sdk/c/include/lumen_plugin.h
  plugins/
    templates/{wgsl-filter, decoder-rust}/
    examples/{identity-pass, guided-denoise, libraw-runner}/   in make ci gebaut und getestet
schemas/lumen-plugin.schema.json   erzeugt, eingecheckt, in CI diff-geprüft
backend/app/routers/plugins.py, backend/app/plugin_review.py   (N11b)
LICENSE-Zusatz, CONTRIBUTING.md   (Aufgabe L)
```

Jedes neue Crate bekommt ein `cargo-deny`-Gate. Alle Crate-Versionen außer wasmtime/
wasmtime-wasi `=48.0.10`, wgpu/naga `=30.0.2` und windows-sys `=0.61.2` (im Lockfile) werden
beim Hinzufügen nach `cargo search` auf testbox exakt gepinnt (`toml`, `semver`, `schemars`,
`sha2`, `ed25519-dalek`, `cbindgen`, `wit-bindgen`, `libloading`, `clap`; später `postcard`,
`memmap2`, `landlock`, `seccompiler`).

**Autoren-Werkzeug (`lumen-plugin`), bewusst klein:** `new` (2 Vorlagen: `wgsl-filter`,
`decoder-rust`), `check` (Manifest, `[files]`, WGSL mit Datei:Zeile-Fehlern, Rollen ↔
`contributes`, Ausleitungs-Regel, Rechte-Lint „`catalog.write` deklariert, aber nie genutzt“,
Texte `en` vollständig), `expand` (zeigt Prelude + Body, genau was läuft), `test`
(Golden-Vektoren `tests/<name>/{input.rgb16, params.toml, expected.png}` auf lavapipe,
2/255; Konformanz je Rolle: Decoder deterministisch, abbrechbar < 200 ms, übersteht
abgeschnittene und 30 s mutierte Eingaben, Ausgabevertrag gegen LibRaw; CPU-Schritt ohne
Kachelnähte ≤ 1/255; Pass identisch bei `skip-when`; **Proxy und Export innerhalb der
Toleranz gleich**; `--bless`), `dev` (Hot-Reload: WGSL < 150 ms per `GpuPassHost::swap` an
der Frame-Grenze, Manifest < 100 ms, WASM < 300 ms + Build, nativ per Neustart; Params,
Undo, Bild und Zoom bleiben; fehlgeschlagener Reload lässt die letzte gute Version laufen),
`pack` (schreibt `[files]`), `keygen` (`--dev` für S4), `sign` (`--dev`), `validate`
(dieselbe Binary nutzt der Server). C/Python/JS-Vorlagen, mdBook-Site und `publish`-Befehl
kommen erst, wenn es fremde Autoren gibt.

### Host-API (Rust, intern)

```rust
pub enum HookPoint { Source, Output }                     // API 0.2: + SceneLinear, Display
pub enum PassKind { Fragment, Compute { workgroup_cache_radius: u32 } }   // ≤ 8
pub enum InputRef { Hooked, Original, Saved(SmolStr) }
pub struct PassDecl { pub name: SmolStr, pub kind: PassKind, pub inputs: SmallVec<[InputRef; 4]>,
                      pub save_as: Option<SmolStr>, pub scale: f32, pub radius_px: RadiusRef,
                      pub body: Arc<str> }
pub struct PassChainDecl { pub plugin_id: PluginId, pub hook: HookPoint,
                           pub params: Vec<ParamDecl>, pub passes: Vec<PassDecl>,
                           pub skip_when: Option<Expr> }
pub struct PassGraph { /* je Hook geordnet; leer = heutiger Pfad */ }

impl Developer {
    /// Nimmt einen fremden Encoder, damit Plugin-Passes im selben Submit laufen.
    pub fn render_graph(&self, gpu: &Gpu, enc: &mut wgpu::CommandEncoder, src: &SourceTexture,
                        p: &ToneParams, graph: &PassGraph, uniforms: &PluginUniforms,
                        target: &wgpu::TextureView, size: (u32, u32), timer: Option<&mut PassTimer>);
}
pub trait GpuPassHost {
    fn load(&mut self, d: &PassChainDecl) -> Result<PassChainId, PluginShaderError>; // Worker, Zustand Compiling
    fn swap(&mut self, old: PassChainId, new: PassChainId);                          // Hot-Reload an Frame-Grenze
    fn set_params(&mut self, id: PassChainId, v: &ParamValues);                      // einzige Klemmstelle
    fn state(&self, id: PassChainId) -> PassState;    // Compiling | Live | Reduced | OnRelease | Disabled(reason) | Quarantined
    fn timings(&self, id: PassChainId) -> Option<PassTiming>;   // p50/p95 ns
    fn budget(&self) -> PluginBudget;                           // core_p95, plugin_budget, Timestamps ja/nein
}
pub enum PluginShaderError { Parse(Diag), Validation(Diag), ForbiddenItem(Diag), UnboundedLoop(Diag),
                             CostTooHigh(StaticCost), LimitExceeded(&'static str), SourceTooLarge(usize) }
```

`PluginUniforms` ist ein einziger `wgpu::Buffer` mit allen aktiven Plugin-Params; jedes
Plugin bekommt einen Slot in Vielfachen von 256 Byte, berechnet aus seinen Params (WGSL-
Ausrichtung, `vec3` als `vec4`), höchstens 1 KiB. Ein `queue.write_buffer` je Frame und nur
bei Änderung. Kurven-LUTs in `_lumen_curves` werden nur bei Änderung neu hochgeladen.

## Einordnung in N0–N10

Vor N11 sind nur **Nähte** erlaubt, je Stunden statt Wochen. Sie verhindern spätere Brüche
an Katalog, YAML-Format, Server-Schema und Pipeline. GPU-Scheduler, `CpuBudget` und der
Timestamp-Timer sind keine Plugin-Arbeit: Sie sichern die 60-Hz-Zusage auch für die
eingebauten Funktionen und sind Voraussetzung für das dynamische Plugin-Budget.

| Meilenstein | Jetzt vorbereiten (kein Plugin-Code läuft) |
|---|---|
| **N1** lumen-core | `plugins`-Map in Edit-State und Preset-Typen + Round-Trip-Test für unbekannte Einträge (Param-Schlüssel kebab-case unverändert); dynamische Gruppen `plugin:<id>` in `profile_groups`; `library_keys` liefert Befehls-IDs; YAML `plugins:`/`requires:` + Toleranz-Test; `lumen-plugin-manifest` mit Schema und Test des Beispiel-Manifests (ohne Host); WIT-0.1-Entwurf in `lumen-plugin-api` (kompiliert mit `wasm-tools`) |
| **N2** lumen-raw/gpu | `Decoder`-/`MetadataReader`-Trait + `DecoderRegistry` (LibRaw = `Primary{0}`, Fallback-Kette); `RawMeta.compression` (siehe Anhang); `RawSource` mmap; `TIMESTAMP_QUERY` über den eframe-Device-Descriptor-Hook + Timer um den Kern-Pass (`core_p95`); Device lost → kontrollierter Neustart (eframe-Quellen prüfen) |
| **N3** Editor-UI | `CommandBus` + `MenuBar` mit leerem „Plugins“-Menü; Sidebar aus `PanelDesc` mit `DeclarativePanel` (eingebaute Sektionen nutzen ihn); Keymap-Konfliktschicht; Stufen-Abzeichen-Komponente |
| **N5** Detail-Passes | **nur leere Einhängepunkte + Test** (Entscheidung Manuel 6): `Developer::render_graph` mit fremdem Encoder und leerem `PassGraph` = heutiger Pfad; Hook-Stellen `source`/`output` (Kern liest wahlweise Plugin-Ausgabe, schreibt wahlweise `Rgba16Float`); Identitäts-Paritätstest mit `examples/identity-pass` als eingebautem Fixture für `source` und `output` (≤ 1/255 gegen die Goldens) |
| **N6** lumen-catalog | Import-, Metadaten- und Aktions-Hooks als interne Registries (gebündelte Import-Kandidaten); Job-System mit Fortschritt/Abbruch; Spalte Kompression; **GPU-Scheduler** (Vorschaubilder sind die erste Hintergrundlast) und **`CpuBudget`** |
| **N7** Lupe/1:1 | 1:1-Ansicht rendert über eine Kachel-Schnittstelle, in die N11a die Plugin-Kachel-LRU einhängt |
| **N8** lumen-export | `Encoder`-Trait + Registry (Optionen als `params`); Export-Ablauf Quelle → Kern gekachelt → `output` je Kachel (Hooks leer) über den GPU-Scheduler; `on-export-done`-Stelle; Ortsdaten-Schalter „Ort mitschreiben“ |
| **N9** Server | Migration 015: nur `PresetIn.plugins` und `PresetOut.requiresPlugins` |
| **N10** Paketierung | Root-Public-Key einkompiliert, Zertifikat des Gegensignatur-Schlüssels als Vorbelegung; `--safe-mode` + Crash-Loop-Schutz; Windows `/DEPENDENTLOADFLAG:0xA00` + `SetDefaultDllDirectories`/`SetDllDirectoryW("")` beim Start |
| **Aufgabe L** (sofort, unabhängig) | AGPL-§7-Plugin-Ausnahme ins Repo: Text als `LICENSE`-Zusatz, SPDX in `desktop/Cargo.toml` auf `AGPL-3.0-or-later WITH AdditionRef-Lumen-Plugin-Exception`, `LICENSES/AdditionRef-Lumen-Plugin-Exception.txt`, `CONTRIBUTING.md` mit DCO und Ausnahme-Hinweis. Abnahme: `cargo deny check licenses` auf testbox grün; lehnt die gepinnte cargo-deny-/`spdx`-Version `AdditionRef-` ab, Rückfall auf `license = "AGPL-3.0-or-later"` + Klartext-Hinweis auf die Ausnahme in `LICENSE` (nicht `license-file`, das verlöre die SPDX-Prüfung) |

Danach, nach der Parität (Entscheidung Manuel 6), in dieser Reihenfolge:

| Meilenstein | Inhalt | Schätzung |
|---|---|---|
| **N11a** Shader-Plugins (S1) | `.lumenplugin`-Datei-Installation, Pfad-/Zip-Regeln, Zustimmungsdatei; WGSL-Validator (Stub-Prelude) + Kostenregel, Prelude-Codegen inkl. Kurven-LUT, Auto-Panels, dynamisches Budget + `Reduced`/`OnRelease`, Probezeit-Journal, Pass-Cache + Kachel-LRU (1:1), Export-Ablauf mit Plugins, Inspektor, CLI `new/check/expand/test/dev/pack/sign` für S1; Beispiel 1 `guided-denoise` messen und abnehmen | 2,5 Wo |
| **N11b** WASM (S2) + Marketplace S1/S2 | wasmtime-Host, Welten, Basis-WASI + Import-Golden, Rechte-Broker, Nutzeraktions-Token, Netz-Filter, `.cwasm`-Cache, Kachel-Parallelität aus `CpuBudget`, Workflow-Hooks, lokale Katalog-Tabellen, Rust-SDK (wasm); LibRaw → wasip2 messen; Server: additive Migration, Upload/Download/Liste/Meldung, Prüf-Container, Publisher-Signatur + Gegensignatur, Downgrade-Schutz | 3,5 Wo |
| **N11c** Nativ S4 + C-ABI | C-ABI 1.0 einfrieren (Header, cbindgen-Gate), Rust-SDK (native), S4-Lader mit Dev-Ladeweg (`[files]`, `[dev]`-Signatur, Ordnerbeobachtung) und Startdialog (Linux + Windows); Datei-Installation lehnt native Pakete ab; Beispiel 2 `libraw-runner`; Ausgabevertrag-Konformanztest | 1,5 Wo |
| später: Community | Schlüsselkette (Sperr-Schlüssel, Rotation), TOFU, signierter Index, Sperrliste, Staging im Client | 1 Wo, wenn der erste fremde Autor kommt |
| später: S3 Linux | Runner mit Landlock/seccomp/cgroup, anonyme Kanäle, Ring, FenceReport, Fluchttests | 2 Wo, wenn ein echter nativer Kandidat existiert |
| später: S3 Windows | AppContainer-Spike, ACLs, Ring im Container, Fluchttest über `tb-win`; erst danach freigeschaltet | 1–2 Wo |

CI-Gates ab N11: Fuzz-Ziele für Manifest-, Paket-, Zip- und WGSL-Parsing (`cargo fuzz`,
nachts auf testbox); Korpus bösartiger WGSL (unbegrenzte Schleifen, verbotene Bindings,
`_lumen_in*`-Zugriff, Zähler über Zeiger, 100 sequentielle 4096er-Schleifen) muss abgelehnt
werden; WASM-Komponenten mit nicht gewährten Imports dürfen nicht linken; Import-Golden der
Basis-WASI; Beispiel-Manifest der Spec parst; `lumen_plugin.h` = erzeugte Fassung.

## Beispiel-Plugins als Abnahmetests

### 1. `mrd.guided-denoise` (S1, GPU-Rauschminderung, Manuels Wunsch)

Manifest und WGSL wie oben (Hook `source`, zwei separierbare Passes, Regler
Stärke/Radius/Nur Farbrauschen). **Abgenommen, wenn:**

- Von `lumen-plugin new --template wgsl-filter` bis zum laufenden Panel ohne Rust in < 2 h.
- Panel erscheint rechts nach „Detail“ mit deutschen Labels; Undo, Doppelklick-Reset,
  Bypass je Plugin, Preset-Speichern und Batch-Gruppe `plugin:mrd.guided-denoise` funktionieren.
- Bei `strength = 0` identische Goldens wie ohne Plugin (Kette entfernt) und 0 ms GPU.
- Auf der 680M bei Radius 8 im Zustand `Live` innerhalb des gemessenen `plugin_budget`; die
  Pass-Zeit p95 wird in N11a gemessen und hier als Zahl eingetragen (Ziel ≤ 2 ms für beide
  Passes zusammen). Auf der UHD 630 (testbox) ist `OnRelease` zulässig; Plugin-Passes erhöhen
  dort die GPU-Zeit beim Ziehen nie über 8 ms bzw. bei `core_p95 ≥ 7 ms` gar nicht. Ein
  Ton-Regler danach verursacht 0 ms Plugin-Zeit (Cache-Treffer).
- 1:1-Zoom: Schwenk ohne Warten (Kachel-LRU), Export gleich innerhalb der Golden-Toleranz.
- Hot-Reload einer WGSL-Änderung < 150 ms ohne Frame-Ausfall; ein Syntaxfehler zeigt
  Datei:Zeile im Terminal und im Editor-Banner, die alte Version läuft weiter.
- Deinstalliert: Bild rendert ohne Pass, Abzeichen „Plugin fehlt“, Werte bleiben im Edit
  und erscheinen nach Neuinstallation wieder.
- Proxy und Export sehen innerhalb der Golden-Toleranz gleich aus (Radius in Original-Pixeln
  über `texel_scale`).
- Einmal über den Marketplace veröffentlicht und installiert (beide Signaturen geprüft).

### 2. `lumen.libraw-runner` (S4, alternativer Decoder)

Das eingebaute LibRaw noch einmal als natives Plugin über die C-ABI mit `Fallback`-Claim
(bzw. testweise `Primary`), in v1 im S4-Entwickler-Modus. Zweck: C-ABI, Decoder-Weg und
Ausgabevertrag ehrlich prüfen, bevor fremde Decoder kommen; später derselbe Code im
S3-Runner zum Messen des IPC-Overheads. **Abgenommen, wenn:**

- Ausgabe bitgleich zum eingebauten `LibRawDecoder` für alle Fixtures in
  `tests-fixtures/raw-samples` (setzt damit den Konformanztest des Ausgabevertrags auf).
- Voller Z6III-Decode über die C-ABI ≤ 1,02 × eingebaut.
- Eine absichtliche Panik im Plugin kommt als `LUMEN_ERR_PANIC` an, Lumen fällt auf LibRaw
  zurück und bleibt bedienbar; Abbruch < 200 ms.
- Lädt ohne lokale Dev-Signatur nicht; Startdialog zeigt Ordner und Hashes; läuft unter
  Linux und unter Windows (`tb-win`).
- Konformanzsuite `lumen-plugin test` (deterministisch, Abbruch < 200 ms, Fuzz 30 s) grün.

Mit S3 (später) kommen dazu: Runner-Decode ≤ 1,02 × eingebaut, `kill -9` auf den Runner
mitten im Decode → Banner, Rückfall, dreimal in 10 min → Quarantäne; FenceReport vollständig;
ein Testmodus, der `socket()`, `execve()`, `io_uring_setup()`, `clone3()` und Schreiben nach
`$HOME` versucht, scheitert an allen.

Ein echtes Fremd-Decoder-Plugin für Z6III HE/HE★ wäre der natürliche erste S3-Kandidat,
sobald es eine Bibliothek gibt, die TicoRAW dekodiert und lizenzrechtlich passt
(Fallback-Slot). Manuel fotografiert lossless und bleibt dabei; der Fall ist nicht dringend.

Optional als drittes, kleines S2-Beispiel: „Picks in Ordner kopieren“ (`catalog.read`,
`originals.read`, `fs.pick write` über `pick-dir`, Nutzeraktions-Token), um den
Workflow-Weg und die Token-Regel abzunehmen.

## Risiken

1. **Umfang für einen Entwickler.** Gegenmittel: v1 nur S1, S2, S4; S3 und die
   Community-Sicherheitskette nur als festgelegtes Format; jedes Stück einzeln nutzbar;
   Python/JS/C-Vorlagen, Doku-Site und eigener Quell-Build gestrichen bzw. vertagt.
2. **Kostenregel zu streng oder zu lasch.** Zu streng: Autoren schaffen keine Pyramiden;
   zu lasch: Hänger. Gegenmittel: `loop-bound`-Params, Ketten, Compute mit Workgroup-Cache,
   Probezeit-Journal, dynamisches Budget; an `guided-denoise` in N11a nachjustieren.
3. **Dynamisches Budget auf schwachen GPUs nahe 0.** Dann laufen Plugins nur beim
   Loslassen. Gewollte Folge der harten 8-ms-Regel; `Reduced` mildert es.
4. **Basis-WASI weicht von der Annahme ab** (Rust-`std` importiert mehr). Import-Golden in
   N11b; Ausweg `wasm32-unknown-unknown` + `wasm-tools component new`.
5. **eframe-Grenzen** (Device-Neuaufbau, Feature-Anforderung). In N2 gegen die Quellen
   prüfen; Ausweg kontrollierter Neustart bzw. eigenes Device.
6. **wasmtime-CVEs und LTS-Wechsel** (48 bis etwa 2028-11, dann nächste LTS mit geänderter
   `bindgen!`-Syntax). wasmtime ist in `lumen-plugin-host` gekapselt; Patch-Bumps mit jedem
   Release; die Sandbox ist eine Schicht, die Rechte-Grenzen die zweite.
7. **WASM-Leistung ungemessen.** Nichts versprechen vor der Messung in N11b; Live-Arbeit ist
   ohnehin WGSL, schwere CPU-Arbeit nativ oder „Backen“.
8. **Druck, CPU-Schritte in den Live-Pfad zu holen.** Wird abgelehnt. Live heißt WGSL.
9. **Look-Drift Proxy ↔ Export** bei nicht auflösungsunabhängigen Plugins. `texel_scale`
   normativ, Konformanztest, Abzeichen „Look kann abweichen“.
10. **Server-Kompromittierung vor TOFU.** In v1 könnte ein kompromittierter Server einen
    Schlüssel für ein Präfix eintragen und ein S1/S2-Paket ausliefern. Gegenmittel: nur
    Sandbox-Stufen im Marketplace, Rechte-Diff, keine Auto-Updates; TOFU mit dem ersten
    fremden Autor.
11. **Lizenzausnahme**: Wirksamkeit anwaltlich prüfen, bevor fremde Autoren eingeladen werden.
12. **Publisher-Schlüssel verloren/gestohlen.** Rotation nur mit TOTP (später mit
    Rotationserklärung); alte Versionen gültig, bis gesperrt.
13. **S3 bleibt lange liegen** und das Format veraltet. Gegenmittel: C-ABI eingefroren und
    vom `libraw-runner` in CI benutzt; der Runner nutzt dieselbe ABI.
14. **Gegensignatur-Schlüssel kompromittiert, bevor die Sperrliste gebaut ist.** In v1 bleibt
    ein gestohlener Schlüssel bis `not-after` seines Zertifikats gültig; entfernen lässt er
    sich nur per App-Release (neues Vorbelegungs-Zertifikat reicht nicht, weil `SIGNATURES`
    ein gültiges altes Zertifikat mitbringt). Gegenmittel: kurzes Zertifikatsfenster (≤ 15
    Monate), Publisher-Signatur bleibt Pflicht (ein gestohlener Gegensignatur-Schlüssel allein
    fälscht kein Paket eines bekannten Publishers), nur Sandbox-Stufen im Marketplace; mit
    der Sperrliste dann `kind = "key"` aus der Root-Liste.

## Entscheidungen Manuel (2026-11-28)

Alle Empfehlungen angenommen:

1. **Sicherheit v1 minimal.** Gebaut werden nur S1 (WGSL) und S2 (WASM). Installation per
   Datei oder über den Marketplace mit Autor-Signatur + Server-Gegensignatur. Formate für
   Schlüsselkette, Sperrliste, Staging/Wartezeit (und TOFU, Index) sind jetzt festgelegt und
   werden gebaut, wenn der erste fremde Autor kommt.
2. **Native.** C-ABI jetzt festlegen und mit N11c einfrieren; S4-Entwicklermodus und das
   Beispiel `lumen.libraw-runner` (als S4) werden gebaut. S3 (abgeschotteter Runner) bleibt
   spezifiziert und ist zurückgestellt, bis ein echter Kandidat existiert.
3. **Windows.** Native Plugins (S3) bleiben aus, bis der AppContainer-Ausbruchstest besteht.
   Unter Windows bis dahin nur S4-Entwicklermodus.
4. **Native nur per Datei-Installation**, nicht über den Marketplace, solange es wenige gibt.
   Damit entfallen Handprüfung und reproduzierbarer Build für v1.
5. **Lizenz.** Die AGPL-3.0-§7-Plugin-Ausnahme kommt ins Repo (eigene Aufgabe L). Der
   Marketplace verlangt eine OSI-Lizenz; geschlossene Plugins nur per Datei-Installation.
6. **Zeitpunkt.** Plugins in N11, nach der Funktionsgleichheit. In N5 nur leere
   Einhängepunkte + Identitätstest.
7. **Tempo.** „GPU < 8 ms“ gilt hart auf jeder GPU. Das Plugin-Budget ist dynamisch je Gerät;
   reicht es nicht, laufen Plugin-Passes nur beim Loslassen des Reglers. Hintergrundarbeit
   (Export, Vorschaubilder) darf Regler nie unter 60 Hz drücken → GPU-Scheduler und globales
   `CpuBudget` (OpenMP, Vorschaubilder, WASM-Pools).

## Entscheidungen des Builders (zum Gegenlesen)

Diese Punkte hat Manuel nicht einzeln entschieden. Sie sind mein Vorschlag:

1. **Sicherheits-Entwurf als Basis**, weil seine Kernentscheidungen nicht nachrüstbar sind,
   sobald fremde Plugins existieren: Welten je Rolle mit Link-Zeit-Rechten,
   Nutzeraktions-Token, keine Pfade, Host-gezeichnete UI ohne Texteingabe,
   Plugin-Befehle nur unter „Plugins“, Presets installieren nie etwas.
2. **Ausleitungs-Regel**: Pakete mit nativem Code dürfen `net`, `clipboard.write`,
   `fs.pick write`, `export.post` nicht anfordern; S2-Pakete mit Vollzugriff auf Dateibytes
   oder Bildinhalte (`raw.decode`, `metadata`, `originals.read`, `export.encoder`,
   `image.process cpu-op` inkl. `bake`) kein `net`/`clipboard.write`. Getrennte
   Datenordner je Stufe.
3. **Bake-Schritt**: ersetzt die dekodierte Quelle vor dem `source`-Hook, Cache als RGBA16F in
   `~/.cache/lumen/bake/`, Schlüssel (Original-Hash, Decoder-ID/-Version, Modus, Plugin,
   Artefakt-Hash, Params-Hash), 4 GiB LRU, Neuberechnung beim Loslassen, höchstens ein
   Bake-Plugin je Bild; RGB16 rein, RGBA16F raus.
4. **Decoder-Ausgabe-Normalisierungsvertrag**: sRGB-Primärfarben, LibRaw-Kurve
   (`gamm` 0.45/4.5, numerisch angegeben), Kamera-WB, Auto-Bright-Formel mit
   `thr = 0.005`; Konformanztest gegen LibRaw.
5. **Reservierte Publisher-Präfixe** `lumen`, `builtin`, `core`, `plugin`, `system`, `mrd`;
   sonst erster Schlüssel je Konto. Auch bei der Datei-Installation erzwungen; Befehls-IDs
   mit Präfix `<plugin-id>.`; gleiche ID mit anderem Herausgeber ersetzt nie still.
6. **Plugin-Tabellen erst in einer späteren additiven Migration** (Server in N11b, lokaler
   Katalog in N11b); 015 bekommt nur `PresetIn.plugins`/`requiresPlugins`.
7. **v1-GPU-Hooks nur `source` und `output`**, Kern-Shader und Goldens bleiben unberührt;
   `source` sRGB-kodiert, Linearisierung über Prelude-Helfer. Kein Fusing in v1.
8. **Pass ist rein**: kein `frame`-Zähler in der Prelude; `texel_scale` normativ, Radien in
   Original-Pixeln.
9. **Validator mit Stub-Prelude**, Prelude-Globals mit `_lumen`-Präfix, Kostenregel je Pixel
   über alle Aufrufe, Klemmung nur in `set_params` plus `min()` im Codegen.
10. **Basis-WASI statt „kein WASI“** für Rust-Gäste, mit Import-Golden als Prüfpunkt.
11. **Kanonische Schnittstelle je Rolle**, WIT und C daraus abgeleitet; Ausgaben nur in
    Host-Puffer; C-Konstanten als `#define`.
12. **Param-IDs kebab-case**, im Edit-State unverändert, im WGSL snake_case; `passHash` je
    Plugin über alle Ketten; Cache-Schlüssel ohne Plugin-Version.
13. **Ed25519 ohne minisign**, Signatur über die exakten Manifest-Bytes mit `[files]`-Liste
    und Domänen-Präfix.
14. **Token gilt für die Job-Dauer** statt 30 s; 500-ms-Eingabesperre gegen Klick-Täuschung.
15. **Netz-Filter**: IP-Pinning je Anfrage, keine privaten/lokalen Adressen, nur Port 443,
    keine IP-Literale/Wildcards.
16. **Epoch-Tick 1 ms** und harte Wanduhr-Grenzen je Aufruf; Summen-Speichergrenze.
17. **S4 nur mit lokal erzeugtem Dev-Schlüssel** und Startdialog; Dev-Ordner = entpackte
    Pakete mit `[files]` und `[dev]`-Signatur, Lumen beobachtet den Ordner selbst.
18. **Device lost = kontrollierter Neustart** in v1.
19. **Plugin-Artefakte auf dem Server auf Platte** (`/srv/lumen/plugins/<sha256>`), nicht in
    Postgres und nicht in Garage (Garage entfällt laut DS); Body-Limit nur für den Upload.
20. **Auto-Hide nach 1 Meldung nur von Konten über Mindestalter.**
21. **Unbekannte Manifest-Schlüssel sind Fehler** (`deny_unknown_fields`); Rechte-Namen gequotet.
22. **Lokalisierte Texte nur im Manifest** (`{ en, de }`, en Pflicht), keine i18n-Dateien.
23. **Nur WGSL und Rust erste Klasse**; zwei Vorlagen; kein Python/JS/C-Aufwand vor fremden Autoren.
24. **Kompressionsanzeige eingebaut** (`RawMeta.compression`), nicht als Plugin.
25. **Metadaten-Plugins nach dem Import** im Hintergrund, Import-Hooks gebündelt mit 64 Byte.
26. **Herabstufung von Decodern relativ zu LibRaw** (1,5×), nicht gegen feste DS-Zeiten.
27. **Seccomp vor `dlopen`**, Pfade nur in Landlock, cgroup statt `RLIMIT_AS`, anonyme
    Kanäle (für S3, Format jetzt).
28. **Reihenfolge mehrerer Plugins** über `order` im Edit-State, dann Plugin-ID; kumulative
    Cache-Schlüssel.
29. **Signaturformate** mit vollem Fingerprint, `pubkey` in `[publisher]`, Zeiten als
    u64-BE in den Nachrichten, Zertifikat in `SIGNATURES`, getrennte Root-/Sperr-Listen.

## Anhang: „In was fotografiere ich?“ (Frage 3)

- **In der Kamera** (Z6III): Fotoaufnahme-Menü → RAW-Aufzeichnung → Komprimierung
  (Bezeichnung je nach Firmware-Sprache). Optionen: verlustfrei komprimiert, High
  Efficiency★, High Efficiency. Manuel fotografiert verlustfrei komprimiert und bleibt dabei
  (SR, „Nachtrag Z6III HE/HE★“).
- **An einer Datei**: `exiftool -NEFCompression DSC_0001.NEF` → `Lossless`,
  `High Efficiency` oder `High Efficiency*`. Für eine ganze Karte:
  `exiftool -T -FileName -NEFCompression -ext NEF /pfad/zur/karte/DCIM`.
- **In Lumen (N2/N6, eingebaut)**: `RawMeta.compression: Option<RawCompression>` mit
  `Lossless | Lossy | Uncompressed | HighEfficiency | HighEfficiencyStar | Unknown(u16)`
  (dieselbe Aufzählung als WIT-`variant compression`). Quelle bei dekodierbaren Dateien:
  LibRaw `imgdata.makernotes.nikon.NEFCompression` (im vendorten `libraw_types.h:510`).
  Bei HE/HE★ scheitert LibRaw schon beim Öffnen (`Unsupported file format`); dann sind weder
  Makernote noch `unpack_thumb` erreichbar. Deshalb liest `lumen-raw` mit einem kleinen
  eigenen TIFF-/Nikon-Makernote-Leser über die mmap **genau zwei Dinge**: das
  Kompressions-Tag und das größte JPEG-Vorschau-IFD (für die eingebettete Vorschau).
- **Tag und Werte**: Beim Z6III steht NEFCompression im Makernote-Tag **0x51** (Wert bei
  Offset +10), bei älteren Bodies (z. B. D7200) im Tag **0x93**. Werte: 3 = Lossless,
  13 = High Efficiency, 14 = High Efficiency★. Der Leser prüft zuerst 0x51, dann 0x93;
  Tests gegen `exiftool -v3` an den CC0-Samples von raw.pixls.us (IDs 7811, 7815, 7819) und
  einem D7200-Fixture pinnen beides.
- Anzeige als Zeile im Info-Panel und als sortier-/filterbare Katalogspalte. Ein HE/HE★-NEF
  bekommt statt eines allgemeinen Fehlers: „Nikon HE/HE★ wird noch nicht unterstützt –
  Kamera auf ‚verlustfrei komprimiert‘ stellen. Die eingebettete Vorschau wird angezeigt.“
  Ist ein `Fallback`-Decoder-Plugin installiert, übernimmt es stattdessen.
