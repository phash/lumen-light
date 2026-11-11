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
| P1 | Bearbeitungs-Profile: YAML-Export/Import, Schritt-Checkboxen, Batch-Anwendung | ✓ abgeschlossen |
| SEO1 | Bilingual DE+EN + GEO/SEO/AEO-Politur (2026-06-09) | ✓ abgeschlossen |
| H1 | Szenenbezogene Tonabbildung (Prozessversion 2, Schulter + Path-to-White) | ✓ abgeschlossen |
| H1b | 16-bit-RAW-Dekodierung in Half-Float-Textur (weniger Banding, kein Headroom) | ✓ abgeschlossen |
| H2 | Lighttable: Sterne, Farblabels, Aussortieren | ✓ abgeschlossen (H2a, H2b, H2c, H2d) |

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
| 8 | UI-Polish, Tastatur-Shortcuts vollständig, Touch-Optimierung, Mobile-Hamburger im Header | ✓ (Tooltips, Sektions-Reihenfolge, Mobile-Burger, Pinch-Zoom + Touch-Pan im Editor-Viewport) |
| 9 | PWA-Manifest, Service Worker (offline-fähiger Editor) | ✓ (Stale-While-Revalidate-SW, manifest.webmanifest, theme-color, installierbar) |
| 10 | Beta-Test mit 5–10 echten Usern, Bug-Backlog, Release-Notes, Selfhosting-Anleitung | ⏳ offen (Selfhosting ist im README + Runbook drin, Beta-User + Release-Notes fehlen) |

## Phase E · Power-Tools ✓ (alle 5 Items)

E1 HSL · E2 Tonkurve · E3 Sharpen+Noise · E4 Face-Detection (opt-in DSGVO) · E5 Auto-Straighten — siehe entsprechende Specs in `docs/superpowers/specs/`.

## Phase F · Marketplace

| Item | Aufgabe | Status |
|---|---|---|
| F1 | Preset-Marketplace MVP (publish/apply/fork/report, Auto-Hide, Profil) | ✓ |
| F2 | Credits-System (Creator-Earnings, Stripe-Kauf) | ⏸ deferred (Rechtsform/AGB nötig) |

## Phase G · Pro-Korrekturen (RawTherapee-inspiriert)

Recherche-Output siehe `docs/superpowers/specs/2026-04-28-phase-g-pro-corrections.md`.

| Item | Aufgabe | Status |
|---|---|---|
| G1 | Highlight Recovery Blend-Modus (geclippte Channels auf unclipped-Mittel pullen) | ✓ |
| G2 | Local Contrast / Clarity (Unsharp-Mask im Y-Kanal, 5x5-Gauss) | ✓ |
| G3 | TCA-Korrektur (per-Channel-Distortion fuer R/B) | ✓ |
| G4 | Lensfun-DB-Migration mit Stuetzstellen-Interpolation | ⏸ Backlog |

## Phase H · Pipeline & Workflow (darktable-/REAPER-inspiriert, geplant)

Ergebnis der Recherche vom 2026-11-11. darktable steht unter GPL-3.0: Wir übernehmen nur Ideen und veröffentlichte Algorithmen, keinen Code.

| Item | Aufgabe | Aufwand | Status |
|---|---|---|---|
| H1 | Szenenbezogene Tonabbildung: Belichtung, Weißabgleich und Kontrast rechnen auf linearem Licht, erst am Ende bildet eine Sigmoid-/AgX-Kurve auf den Bildschirm ab. Ziel: Lightroom-artiges Verhalten, keine Farbverschiebung in hellen Lichtern. Bestehende Presets brauchen einen Kompatibilitätspfad (Pipeline-Version im Edit-State). Umgesetzt als `processVersion` 1/2 (fehlt = 1), Spec `docs/superpowers/specs/2026-11-11-h1-scene-referred-tonemapping-design.md`. Follow-up H1b siehe nächste Zeile. | M | ✓ abgeschlossen |
| H1b | 16-bit-RAW-Dekodierung (`outputBps: 16`) in eine `RGB16F`-Half-Float-Textur für Live-Vorschau, Vorschaubild und Full-Res-Export; JPEG/PNG bleiben 8 bit. Gewinn ist Präzision (weniger Banding in gepushten Tiefen), **kein** Headroom — libraw klemmt bei Weiß. Fallback auf 8 bit bei `deviceMemory` < 4 oder fehlgeschlagenem Upload. Spec `docs/superpowers/specs/2026-11-11-h1b-float-pipeline-design.md`. **Offen:** die libraw-Optionen `use_camera_wb`/`no_auto_bright` waren als snake_case wirkungslos (libraw-wasm liest camelCase) — RAWs laufen seit jeher mit Tageslicht-WB und Auto-Helligkeit; Korrektur ändert den Look und braucht eine eigene Entscheidung (z. B. neue Prozessversion). | M | ✓ abgeschlossen |
| H2 | Lighttable in der Bibliothek: Sterne (0–5), Farblabels, Filter danach, Tastatur-Aussortieren (Vorschau groß, Taste vergeben, nächstes Bild), Vergleichsansicht. Braucht Migration für Bewertung/Label pro Bild und `GET /images`-Filter. Spec: `docs/superpowers/specs/2026-11-11-h2-lighttable-design.md`. **H2a ✓** Vorschaubilder pro Bild (Migration 013, `PUT /images/{id}/thumbnail`, Backfill, Listen-Vorschau). **H2b ✓** Raster/Sterne/Labels/Markierung/Filter (Migration 014, `PATCH /images[/{id}]`, Filter-/Sortier-Parameter an `GET /images`). **H2c ✓** Lupe (Vollbild, Blättern, Auto-Weiter), Vergleich zweier Bilder, Lightroom-Einzeltasten (abschaltbar), Cheatsheet-Abschnitt „Bibliothek". **H2d ✓** Nacharbeiten: Lupe mit Zoom 1:1 (Z/Klick, Original bei JPEG/PNG, Vorschau bei RAW), Einzeltasten in der Listenansicht, Filter „Ohne Label" (`colorLabel=none`), Filterzustand in der URL. | M | ✓ fertig |

Weitere Kandidaten aus derselben Recherche (Backlog):
- Zentrale Aktionsliste mit frei belegbaren Tasten, Befehlspalette und beschrifteter Undo-Historie (REAPER) (M)
- Virtuelle Kopien/Snapshots pro Bild + Export-Warteschlange mit Dateinamen-Vorlagen und ZIP (M)
- Tone Equalizer mit kantenerhaltender Maske, Masken-Verfeinerung an Motivkanten (M)
- Klein (S): „Inpaint opposed“ für die Lichter-Rekonstruktion, Vektorskop, Fokus-Peaking, Warnung für Überbelichtung/Farbraum, Shift-Feinjustierung und Mausrad an Reglern, neutralgraues Theme

## Phase P · Bearbeitungs-Profile ✓

YAML-Export/Import von Presets (Client-seitig, Format-Version 1 `lumenProfile: 1`), granulare Schritt-Checkboxen beim Anwenden (8 Gruppen, Single-Source-JSON `backend/schemas/edit-groups.json`), nicht-destruktive Batch-Anwendung via `POST /presets/{id}/apply` auf mehrere Bilder gleichzeitig. Migration 009 (`009_preset_geometry`) ergaenzt `presets.geometry` JSONB fuer Crop/Straighten/Lens-Daten. Bibliothek zeigt Mehrfachauswahl + Batch-Apply-Modal.

## Phase SEO1 · Bilingual DE+EN + GEO/SEO/AEO-Politur ✓ (2026-06-09)

Geteiltes i18n-Content-Modul (`content.ts`) als Single Source für DE+EN-Strings und JSON-LD-Generierung. `Landing` locale-aware mit `lang`-Prop; `/en`-Route + prerenderte Flat-File `en.html` mit `<html lang="en">` + `og:locale=en_US`. hreflang-Cluster (`de`/`en`/`x-default`). Header-Sprachumschalter (native `<a>`, echte Navigation für locale-korrekte HTML). JSON-LD (SoftwareApplication + FAQPage + HowTo) pro Locale aus CONTENT generiert — FAQ und Structured Data per Konstruktion deckungsgleich. Marketplace-Intro SSR-sicher prerendert. `public/llms.txt` für AI-Engine-Crawler. nginx: Junk-/Scan-Pfade → 404 statt Soft-404-SPA-200.

## Aktuell offen (Stand 2026-04-28)

**Pre-Beta-Polish:**
- ~~PWA-Manifest + Service Worker~~ ✓ erledigt — installierbar, offline-fähig (Stale-While-Revalidate).
- ~~Touch-Optimierung im Editor-Viewport~~ ✓ erledigt — Pinch-Zoom mit Anker-Mitte, Two-Finger→One-Finger nahtlos zu Pan zurueck.
- ~~Release-Notes-Pflege + CHANGELOG~~ ✓ erledigt — `CHANGELOG.md` mit Unreleased-Pre-Beta-Block.
- ~~Beta-User-Onboarding-Doku~~ ✓ erledigt — `docs/beta-onboarding.md` (13 Kapitel von „Account anlegen" bis „PWA installieren").
- Real-Browser-Smoke-Tests fuer die Touch-Logik (jsdom kann keine echten Pointer-Events) — Playwright-E2E existiert jetzt als nightly CI-Workflow (`.github/workflows/e2e.yml`).
- ~~Voll-Auflösungs-Export~~ ✓ erledigt (C2) — Original wird offscreen in voller Auflösung durch die WebGL-Pipeline gerendert; „Original" = echte Originalauflösung statt 1600px-Vorschau.
- ~~Multi-Device-Weiterbearbeitung hochgeladener Bilder~~ ✓ erledigt (C1) — Bild aus Bibliothek wiederöffnen + Edit-State pro Bild persistiert (Migration 008, debounced Autosave). Erfüllt Erfolgskriterium #4 aus `01-konzept.md`.
- ~~Post-Review-Härtung~~ ✓ erledigt — Rate-Limiting (default + sub-Key), async-I/O off-loop, JIT-Race, Content-Type-Magic-Bytes, Coverage in CI; siehe CHANGELOG.

**Sicherheit/DSGVO (vor Multi-Tenant-Live):**
- ~~Pre-Signed-POST-Janitor-Cron~~ ✓ erledigt — `app/janitor.py` + `scripts/janitor.py` (CLI), 4 Tests. Cron-Eintrag empfohlen: alle 5 min `python -m scripts.janitor`.
- ~~DELETE /me Keycloak-Admin-API-Aufruf~~ ✓ erledigt — `app/keycloak_admin.py` mit Service-Account-Client (Client-Credentials-Grant). Konfiguriert via `KEYCLOAK_ADMIN_CLIENT_ID` + `KEYCLOAK_ADMIN_CLIENT_SECRET`. Best-effort: KC-Ausfall blockiert App-Cleanup nicht.
- ~~E2E-Test für Marketplace~~ ✓ erledigt — `frontend/e2e/marketplace.spec.ts` (empty-state, publish→browse→detail→apply, fork, report).

**Admin & Bot-Härtung (neu, MVP komplett):**
- Admin-Bereich `/admin` mit User-Tabelle (Disable-Toggle, Aggregate) und Feedback-Inbox (Status-Workflow new/triaged/closed, Admin-Notes). Frontend-Gating via `useIsAdmin`-Hook + `RequireAdmin`, Backend-Gating via `current_admin` (Realm-Role `admin`). Migration 007 (`users.is_disabled` + `feedbacks`).
- User-Feedback-Dialog im Header (kind: bug/idea/other, message 10-2000 Zeichen, Honeypot `website` + Rate-Limit 5/h).
- Realm-PROD-Härtung: failureFactor 5→3, lockout-Wait verdoppelt, passwordPolicy enforced (length 10, digits, history 3). Dev-Realm bekommt zusätzlich die `admin`-Realm-Role im Import.

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
