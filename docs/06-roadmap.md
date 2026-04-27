# 06 · Roadmap

Granularität: wochenweise. Jede Phase endet mit einem Demo-fähigen Stand. Annahme: ~10–15 Stunden Entwicklung pro Woche (Side-Projekt-Tempo).

**Hinweis 2026-04-27:** Die ursprünglichen Phasen 1–6 sind durch die Architektur-Updates (ADR-010 Keycloak, ADR-011 Garage, ADR-012 Caddy) neu strukturiert. Iterationen sind feiner granular als die alten "Phasen" — siehe `docs/superpowers/specs|plans/` für jede einzelne. Nachfolgende Tabelle zeigt den aktuellen Stand.

## Iteration-Übersicht (Stand 2026-04-27)

| It. | Thema | Status |
|---|---|---|
| 0 | Grundordnung (Git, arc42, Spec/Plan-Dirs) | abgeschlossen |
| 1 | Backend test-tauglich (testcontainers, 35 Tests) | abgeschlossen |
| 2 | Vite-Frontend-Skelett (5 Routes, Vitest) | abgeschlossen |
| 3 | Architektur-Update (Keycloak + Garage + Caddy in Doku) | in Arbeit |
| 4 | Backend auf Keycloak (`/auth/*` raus, JWK-Verifikation rein) | geplant |
| 5 | Frontend Auth (OIDC via `react-oidc-context`, AuthGuard) | geplant |
| 6 | Image-Storage (Garage, Pre-Signed URLs, Library-UI) | geplant |
| 7 | Production-Deployment (`docker-compose.prod.yml`, Caddyfile) | geplant |
| 8+ | Phase-1-Roadmap-Inhalte: Editor-Logik aus Prototyp extrahieren, Slider, Histogramm, Export | folgt |

## Phase 1 · Bildverarbeitung im Browser (urspr. Wochen 1–3, jetzt Iteration 8+)

**Ziel:** JPEG laden, alle 10 Slider funktional, Vorher/Nachher, Export.

| Woche | Aufgabe |
|---|---|
| ~ | WebGL2-Boilerplate (Quad, Programm, Texture-Upload) im Vite-Projekt. Erstes Bild rendert mit Identity-Shader. |
| ~ | Komplette Shader-Pipeline (sRGB↔Linear, alle 10 Adjustments). Custom Slider-Component. Histogramm via Canvas-Readback. |
| ~ | Vorher/Nachher-Toggle. Tastatur-Shortcuts. Export als JPEG/PNG mit Quality-Slider. Polish & Bugfixes. |

**Demo-Stand:** Bild reinziehen, alle Slider bewegen, exportieren. Keine Persistenz, alles flüchtig.

## Phase 2 · Auth & Presets (urspr. Wochen 4–5, jetzt Iterationen 4+5)

**Ziel ändert sich gegenüber dem Original:** statt eigenem Auth-Server nutzen wir Keycloak (siehe ADR-010). Presets-CRUD bleibt im Lumen-Backend.

| Iteration | Aufgabe |
|---|---|
| 4 | Backend: `/auth/*` zurückbauen, JWK-basierte JWT-Verifikation gegen Keycloak-Realm `lumen`, JIT-User-Provisioning, Tests-Suite umstellen (Test-Keycloak via testcontainers oder Mock-JWK-Server). |
| 5 | Frontend: OIDC-Library einbinden, Login-/Logout-Buttons reden mit Keycloak, AuthGuard schützt `/editor` und `/account`, Preset-API-Calls mit Bearer-Token. |

**Demo-Stand:** Account in Keycloak anlegen, einloggen, Preset speichern, auf zweitem Gerät einloggen (SSO), dort Preset wiederfinden.

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

## Phase 5 · Lokale Anpassungen (Wochen 11–13) — abgeschlossen

**Ziel:** Linearer Verlaufsfilter und radialer Filter.

| Woche | Aufgabe | Status |
|---|---|---|
| 11 | ~~Multi-Pass-Pipeline mit Framebuffer-Objekten.~~ → Single-Fragment-Shader mit Uniform-Arrays + uniform-driven Loop (siehe Kasten unten) | umgesetzt anders |
| 12 | Linearer Verlaufsfilter: zwei Drag-Punkte, lokale Adjustment-Werte. Maskenberechnung im Shader (Distance-to-Line). | abgeschlossen (It 17) |
| 13 | Radialer Filter (Ellipse). UI für Maskenauswahl-Liste. Persistenz im Preset-Format (Adjustments + Masken). | abgeschlossen (It 18, 19a, 19b, 19c) |

**Architektur-Abweichung Woche 11:** Der ursprünglich vorgesehene
FBO-Pingpong-Refactor wurde nicht umgesetzt. Stattdessen läuft Multi-Mask
in **einem** Fragment-Shader mit Uniform-Arrays (`MAX_LINEAR_MASKS=4`,
`MAX_RADIAL_MASKS=4`) und zwei Schleifen mit konstantem Loop-Bound plus
`if (i >= u_num*) break;` als uniform-driven Early-Termination
(GLSL ES 3.00-konform). Begründung in
`docs/superpowers/specs/2026-04-27-multi-mask-and-preset-persistence-design.md`.
Wenn die lokalen Adjustments später auf alle 10 Slider erweitert werden,
wird der FBO-Refactor unausweichlich — bis dahin pragmatisch.

**Demo-Stand:** Himmel mit Verlaufsfilter abdunkeln, Gesicht mit Radial
aufhellen, Preset speichern und auf zweitem Bild laden — funktioniert.

## Phase 6 · Polish & Deployment (Wochen 14–16)

Nach dem Architektur-Update entspricht das den Iterationen 6 (Image-Storage), 7 (Production-Deployment) und einer abschließenden Polish-Iteration.

| Iteration | Aufgabe |
|---|---|
| 6 | Image-Storage: Garage-Bucket-Setup, Backend `/images/*`-Endpoints (init/confirm/list/url/delete), Frontend Library-Panel mit Upload, Tests gegen lokalen Garage-Container. |
| 7 | Production-Deployment: `docker-compose.prod.yml` mit `caddy-proxy`-Network-Anschluss, Caddyfile-Eintrag, Realm-Export, Garage-Init-Script, initiales Deployment durch Manuel. Backup-Strategie (`pg_dump` Cron für Lumen + Keycloak DB, Garage-Replikation). |
| 8 | UI-Polish, Tastatur-Shortcuts vollständig, Touch-Optimierung. PWA-Manifest. Offline-fähig (Service Worker). |
| 9 | Beta-Test mit 5–10 echten Usern, Bug-Backlog abarbeiten. Release-Notes, Doku, Selfhosting-Anleitung. |

**Demo-Stand:** Öffentlich nutzbar unter `lumen.mr-development.de`. README beschreibt Selfhosting (Cluster-Add-On *oder* Standalone-Compose) in unter 10 Minuten.

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
