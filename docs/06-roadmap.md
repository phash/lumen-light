# 06 · Roadmap

Granularität: wochenweise. Jede Phase endet mit einem Demo-fähigen Stand. Annahme: ~10–15 Stunden Entwicklung pro Woche (Side-Projekt-Tempo).

## Phase 1 · Bildverarbeitung im Browser (Wochen 1–3)

**Ziel:** JPEG laden, alle 10 Slider funktional, Vorher/Nachher, Export.

| Woche | Aufgabe |
|---|---|
| 1 | Vite-Projekt-Setup, React + Tailwind. WebGL2-Boilerplate (Quad, Programm, Texture-Upload). Erstes Bild rendert mit Identity-Shader. |
| 2 | Komplette Shader-Pipeline (sRGB↔Linear, alle 10 Adjustments). Custom Slider-Component. Histogramm via Canvas-Readback. |
| 3 | Vorher/Nachher-Toggle. Tastatur-Shortcuts. Export als JPEG/PNG mit Quality-Slider. Polish & Bugfixes. |

**Demo-Stand:** Bild reinziehen, alle Slider bewegen, exportieren. Keine Persistenz, alles flüchtig.

## Phase 2 · Auth & Presets-Backend (Wochen 4–5)

**Ziel:** User-Account, Login, Presets serverseitig speichern.

| Woche | Aufgabe |
|---|---|
| 4 | FastAPI-Skeleton, Postgres in Docker, SQLAlchemy + Alembic Setup. `users`, `presets`, `refresh_tokens`-Migrationen. Auth-Endpoints (register, login, refresh, logout, /me). |
| 5 | Presets-CRUD-Endpoints. CORS, Rate Limiting (für Auth), Tests. Frontend-Integration: Login-Form, geschützte Route, Preset-Liste in Editor. |

**Demo-Stand:** Account anlegen, einloggen, Preset speichern, einloggen auf zweitem Gerät, dort Preset wiederfinden.

## Phase 3 · RAW-Decoding (Wochen 6–8)

**Ziel:** Echte RAW-Dateien (CR2, NEF, ARW, DNG, RAF) im Browser laden.

| Woche | Aufgabe |
|---|---|
| 6 | libraw-wasm evaluieren, in Frontend integrieren. RAW-Detection per Magic-Bytes/Extension. Erstes Canon CR2 öffnet. |
| 7 | Test-Suite mit verschiedenen Kameras (Canon, Nikon, Sony, Fuji). Embedded-JPEG als Schnell-Vorschau extrahieren. Voll-RAW-Decode in Web Worker auslagern (UI bleibt responsiv). |
| 8 | IndexedDB-Cache für dekodierte RAWs. Memory-Management (große Buffer freigeben). Fortschrittsanzeige beim Decoden. |

**Demo-Stand:** Original-RAW vom Camera-SD-Card öffnet in unter 5 Sekunden, Bearbeitung läuft mit Original-Tiefe (nicht Embedded-JPEG-Qualität).

**Risiko:** libraw-wasm könnte unstabile Bibliothek sein. Plan B: serverseitiges Decoding via libraw-Python-Binding, RAW wird hochgeladen, dekodiertes JPEG-Preview kommt zurück. Sicherheits- und Datenschutz-Implikationen → Phase 3 ggf. nach hinten verschieben oder Stretch-Feature.

## Phase 4 · Beschnitt, Drehung, Objektivkorrektur (Wochen 9–10)

| Woche | Aufgabe |
|---|---|
| 9 | Beschnitt-Tool: Overlay-Komponente, Aspect-Ratios, Drittel-Raster. Crop wird im Vertex-Shader via UV-Transformation umgesetzt — keine Re-Texture nötig. |
| 10 | Begradigen (kontinuierliche Rotation). Objektiv-Profil: Lensfun-Datenbank als JSON exportieren, im Browser als Lookup. Distortions- und Vignette-Korrektur als zusätzliche Shader-Passes. |

**Demo-Stand:** Bild schief? Begradigen. Beschneiden. Objektiv aus EXIF erkannt → Verzerrung weg.

## Phase 5 · Lokale Anpassungen (Wochen 11–13)

**Ziel:** Linearer Verlaufsfilter und radialer Filter.

| Woche | Aufgabe |
|---|---|
| 11 | Multi-Pass-Pipeline mit Framebuffer-Objekten. Architektur-Refactoring: Pipeline als Liste von Stages. |
| 12 | Linearer Verlaufsfilter: zwei Drag-Punkte, lokale Adjustment-Werte. Maskenberechnung im Shader (Distance-to-Line). |
| 13 | Radialer Filter (Ellipse). UI für Maskenauswahl-Liste. Persistenz im Preset-Format (Adjustments + Masken). |

**Demo-Stand:** Himmel mit Verlaufsfilter abdunkeln, ohne den Rest zu verändern.

## Phase 6 · Polish & Deployment (Wochen 14–16)

| Woche | Aufgabe |
|---|---|
| 14 | UI-Polish, Tastatur-Shortcuts vollständig, Touch-Optimierung. PWA-Manifest. Offline-fähig (Service Worker). |
| 15 | Docker-Compose-Setup finalisieren. CI/CD via GitHub Actions: Build → Test → Deploy. Backup-Strategie (`pg_dump` Cron). |
| 16 | Beta-Test mit 5–10 echten Usern, Bug-Backlog abarbeiten. Release-Notes, Doku, Selfhosting-Anleitung. |

**Demo-Stand:** Öffentlich nutzbar unter eigener Domain. README beschreibt Selfhosting in 5 Minuten.

## Nach dem MVP (Backlog)

Priorisiert nach erwartetem Impact, nicht nach Aufwand. Reihenfolge nach Beta-Feedback:

- HSL-Farbkanäle (Farbton/Sättigung/Luminanz pro Farbe)
- Gradationskurve (Punkt-Editor)
- Schärfen + Rauschreduzierung (CNN-basiert via ONNX-Runtime-Web)
- KI-Masken: Motiv-, Himmel-, Personen-Selektion (Segment-Anything-WebGPU oder MobileSAM)
- Spot-Removal (Inpainting)
- Stapel-Verarbeitung (Preset auf 100 Bilder anwenden, Output als ZIP)
- Geteilte Presets (Public-URL-Sharing oder Org-Accounts)
- Kollaborative Bearbeitung (CRDT auf Adjustment-State, sehr nice-to-have)

## Meilensteine & Demo-Punkte

| Wann | Was zeigen |
|---|---|
| Ende Woche 3 | Funktionaler JPEG-Editor im Browser (Single-User, lokal) |
| Ende Woche 5 | Multi-Device-Sync von Presets |
| Ende Woche 8 | RAW-Verarbeitung läuft |
| Ende Woche 10 | Vollständiger Basis-Workflow eines Lightroom-Light-Tools |
| Ende Woche 13 | Lokale Anpassungen → echtes Premium-Feature |
| Ende Woche 16 | Public Beta |

## Pufferplanung

Realistische Annahme: Phase 3 (RAW) UND Phase 5 (lokale Anpassungen) sind die Risikopfade. Wenn beide jeweils 2 Wochen länger brauchen, landet das MVP bei 20 Wochen. Das ist OK.

Was nicht passieren darf: scope creep. Wenn Idee X auftaucht ("hey, eine Zoom-Funktion wäre cool") → ab in den Backlog, nicht ins MVP einbauen.
