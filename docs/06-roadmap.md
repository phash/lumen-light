# 06 · Roadmap

Granularität: wochenweise. Jede Phase endet mit einem Demo-fähigen Stand. Annahme: ~10–15 Stunden Entwicklung pro Woche (Side-Projekt-Tempo).

**Stand 2026-04-28:** MVP (Phasen 1–6) im Kern komplett. Phase E (Power-Tools) und Phase F1 (Preset-Marketplace) zusätzlich abgeschlossen. Was noch fehlt, ist Pre-Beta-Polish und ein paar deferred Stretch-Features — siehe Abschnitt „Aktuell offen" unten.

## Iteration-Übersicht

| It. | Thema | Status |
|---|---|---|
| 0 | Grundordnung (Git, arc42, Spec/Plan-Dirs) | ✓ abgeschlossen |
| 1 | Backend test-tauglich (testcontainers, Pytest) | ✓ abgeschlossen |
| 2 | Vite-Frontend-Skelett (5 Routes, Vitest) | ✓ abgeschlossen |
| 3 | Architektur-Update (Keycloak + Garage + Caddy in Doku) | ✓ abgeschlossen |
| 4 | Backend auf Keycloak (`/auth/*` raus, JWK-Verifikation rein, JIT-User-Provisioning) | ✓ abgeschlossen |
| 5 | Frontend Auth (OIDC via `react-oidc-context`, AuthGuard) | ✓ abgeschlossen |
| 6 | Image-Storage (Garage, Pre-Signed URLs, Library-UI) | ✓ abgeschlossen |
| 7 | Production-Deployment (`docker-compose.prod.yml`, Caddyfile, Realm-Hardening) | ✓ abgeschlossen |
| 8+ | Editor-Logik aus Prototyp extrahieren, Slider, Histogramm, Export | ✓ abgeschlossen |
| 17–19 | Multi-Mask-Architektur, lineare + radiale Verlaufsfilter, Preset-Persistenz | ✓ abgeschlossen |
| E1 | HSL-Farbmischer (8 × 3 = 24 Slider, Bell-Function-Weighting) | ✓ abgeschlossen |
| E2 | Tonkurve (Monotone-Hermite, 256-LUT-Texture) | ✓ abgeschlossen |
| E3 | Sharpening + Noise-Reduction (Unsharp + Bilateral) | ✓ abgeschlossen |
| E4 | Face-Detection (TF.js, opt-in Consent, Smart-Suggestion-Boost) | ✓ abgeschlossen |
| E5 | Auto-Straighten (Sobel + Hough-Voting) | ✓ abgeschlossen |
| F1 | Preset-Marketplace (publish/apply/fork/report, Auto-Hide, Profil) | ✓ abgeschlossen |
| D1/D2/D4/D6 | Editor-Refactor + Wireformat camelCase + Tests | ✓ abgeschlossen |

## Phase 1 · Bildverarbeitung im Browser ✓

**Demo-Stand:** Bild reinziehen, alle Slider bewegen (12 globale + 24 HSL + Tonkurve), Vorher/Nachher (Bypass-Hold + Compare-Split), exportieren als JPEG/PNG.

## Phase 2 · Auth & Presets ✓

**Demo-Stand:** Account in Keycloak anlegen, einloggen, Preset speichern, auf zweitem Gerät einloggen (SSO), dort Preset wiederfinden. JIT-User-Provisioning legt 10 Default-Presets an (4 Looks + 6 Genres).

## Phase 3 · RAW-Decoding ✓

**Demo-Stand:** Original-RAW (CR2/CR3/NEF/ARW/DNG/RAF/RW2/ORF) öffnet via libraw-wasm in einem Web-Worker; embedded-JPEG-Vorschau in unter 5 s, Voll-Decode danach.

## Phase 4 · Beschnitt, Drehung, Objektivkorrektur ✓

**Demo-Stand:** Bild schief? Begradigen oder Auto-Straighten (E5). Beschneiden mit pixelgenauem Output (Canvas resized auf cropSize × imageDims). Objektiv aus EXIF erkannt (18 Profile aus Lensfun) → Verzerrung + Vignette automatisch korrigiert.

## Phase 5 · Lokale Anpassungen ✓

**Architektur:** Single-Fragment-Shader mit Uniform-Arrays (`MAX_LINEAR_MASKS=4`, `MAX_RADIAL_MASKS=4`) und uniform-driven Loops — kein FBO-Pingpong. Mask-Overlays rechnen Output-UV ↔ Source-UV via `forwardUvTransform` / `invertUvTransform`, damit der User auf dem gecropten Output dragged und die Maske trotzdem im Source-System landet.

**Demo-Stand:** Himmel mit Verlaufsfilter abdunkeln, Gesicht mit Radial aufhellen, Preset speichern und auf zweitem Bild laden.

## Phase 6 · Polish & Deployment

| Iteration | Aufgabe | Status |
|---|---|---|
| 6 | Image-Storage (Garage, /images/*-Endpoints, Library-UI) | ✓ |
| 7 | Production-Deployment (compose.prod, Caddyfile mit CSP/HSTS, Realm-Hardening, Redis für Multi-Worker-Rate-Limit) | ✓ |
| 8 | UI-Polish, Tastatur-Shortcuts vollständig, Touch-Optimierung, Mobile-Hamburger im Header | ⏳ teilweise (Tooltips + Sektions-Reihenfolge + Mobile-Burger drin; Touch-Gesten im Editor-Viewport noch nicht) |
| 9 | PWA-Manifest, Service Worker (offline-fähiger Editor) | ⏳ offen |
| 10 | Beta-Test mit 5–10 echten Usern, Bug-Backlog, Release-Notes, Selfhosting-Anleitung | ⏳ offen (Selfhosting ist im README + Runbook drin, Rest fehlt) |

## Phase E · Power-Tools ✓ (alle 5 Items)

E1 HSL · E2 Tonkurve · E3 Sharpen+Noise · E4 Face-Detection (opt-in DSGVO) · E5 Auto-Straighten — siehe entsprechende Specs in `docs/superpowers/specs/`.

## Phase F · Marketplace

| Item | Aufgabe | Status |
|---|---|---|
| F1 | Preset-Marketplace MVP (publish/apply/fork/report, Auto-Hide, Profil) | ✓ |
| F2 | Credits-System (Creator-Earnings, Stripe-Kauf) | ⏸ deferred (Rechtsform/AGB nötig) |

## Aktuell offen (Stand 2026-04-28)

**Pre-Beta-Polish:**
- PWA-Manifest + Service Worker (Offline-fähiger Editor) — kleines Stück, wahrscheinlich 0.5 Tag.
- Touch-Optimierung im Editor-Viewport (Pinch-Zoom, Pan-Touch) — Editor läuft heute mit Pointer-Events, Touch sollte schon halbwegs funktionieren, aber kein dedizierter Test.
- Release-Notes-Pflege + CHANGELOG (heute keiner).
- Beta-User-Onboarding-Doku (kurze Anleitung „so legst du dir einen Account an", Selfhosting-Block ist im README).

**Sicherheit/DSGVO (vor Multi-Tenant-Live):**
- Pre-Signed-POST mit Content-Length-Range — heute heuristischer Schutz via HEAD+Cleanup. Pflicht-Folge-Schritt: kleiner Janitor-Cron, der `images.upload_state='pending' AND created_at < now()-15min` plus zugehörige S3-Objekte löscht.
- DELETE /me Keycloak-Admin-API-Aufruf — heute werden nur App-Daten gelöscht, der KC-Account bleibt; Datenschutz-Hinweis ist drin. Sauberer Fix: Service-Account-Setup im Realm + Admin-API-Call.
- E2E-Test für Marketplace — Stack-Compose-Setup ausstehend.

**Stretch-Features (Backlog, nach Beta):**
- KI-Masken (Motiv-/Himmel-/Personen-Selektion via Segment-Anything-WebGPU oder MobileSAM)
- Spot-Removal (Inpainting)
- Stapel-Verarbeitung (Preset auf 100 Bilder anwenden, Output als ZIP)
- Per-Channel-Tonkurven (RGB statt nur Luminanz)
- Auto-Vignette um detected Face (Stretch aus E4)
- Phase F2 Credits-System (deferred, braucht Rechtsform)
- Kollaborative Bearbeitung (CRDT auf Adjustment-State, sehr nice-to-have)
- HDR/EXR-Support
- Preset-Versionierung im Marketplace
- Rating/Sterne/Kommentare im Marketplace
- Federated Login (GitHub/Google OAuth via Keycloak Identity Brokering)

## Meilensteine

| Wann | Was zeigen | Status |
|---|---|---|
| Ende Woche 3 | Funktionaler JPEG-Editor im Browser (Single-User, lokal) | ✓ |
| Ende Woche 5 | Multi-Device-Sync von Presets | ✓ |
| Ende Woche 8 | RAW-Verarbeitung läuft | ✓ |
| Ende Woche 10 | Vollständiger Basis-Workflow eines Lightroom-Light-Tools | ✓ |
| Ende Woche 13 | Lokale Anpassungen → echtes Premium-Feature | ✓ |
| **Heute** | **Power-Tools (HSL/Tonkurve/Sharpen/Face/Straighten) + Marketplace MVP + Reviews-Hardening** | **✓** |
| Ende Woche 16 | Public Beta | ⏳ ausstehend (PWA + Onboarding-Doku + Beta-User) |

## Pufferplanung

Realistische Annahme: Phase 3 (RAW) UND Phase 5 (lokale Anpassungen) waren die Risikopfade. Beide sind durch, ohne dass MVP-Termine gerissen wurden. Phase E + F1 + Reviews-Hardening laufen jetzt im „Bonus"-Bereich.

Was nicht passieren darf: scope creep. Wenn Idee X auftaucht („hey, eine Zoom-Funktion wäre cool") → ab in den Backlog, nicht ins MVP einbauen.
