# Changelog

Alle nennenswerten Aenderungen an Lumen werden hier dokumentiert. Format
orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung an [SemVer](https://semver.org/lang/de/).

## [Unreleased] — Pre-Beta

### Hinzugefuegt

- **Phase E · Power-Tools**
  - HSL-Farbmischer mit 8 Farbtonbereichen × 3 Achsen (Hue/Saettigung/Luminanz), Bell-Funktion-Gewichtung im Shader.
  - Tonkurve mit 2–8 Stuetzpunkten (Monotone-Hermite, kein Overshoot), 256-Eintrag-LUT-Texture, SVG-Editor mit Drag/Add (Klick) /Remove (Doppelklick).
  - Sharpening-Slider (4-Tap-Unsharp-Mask) und Noise-Reduction-Slider (3×3-Bilateral-Light) als neue Detail-Gruppe.
  - Auto-Begradigen-Button via Sobel + Hough-Voting (Confidence-Schwelle 0.15 schuetzt vor Snap-auf-Rauschen).
  - Face-Detection (TensorFlow.js MediaPipe) als opt-in Smart-Preset-Boost — Default deaktiviert (DSGVO-Drittlandtransfer ueber tfhub-CDN).

- **Phase F1 · Preset-Marketplace**
  - Public/Private-Toggle im Preset-Save-Dialog mit Genre-Picker, Description (10–500 Zeichen) und Vorschau-Bild-Auswahl als 4-Spalten-Thumbnail-Grid.
  - Marketplace-Seite mit Genre-Filter, Suche (300 ms debounced), Sortierung (neu/beliebt), Pagination via Cursor, Skeleton-Loader.
  - Detail-Modal mit „Anwenden", „In meine Bibliothek kopieren" (Fork) und Reporting (Auto-Hide bei ≥3 Reports).
  - Account-Profil (Handle 3–40 Zeichen + Bio) und Liste eigener veroeffentlichter Presets mit Apply-Counter und Zurueckziehen.
  - Migration 005: `presets` bekommt `visibility/genre/description/preview_image_id/published_at/apply_count/report_count` plus partial Index. `users` bekommt `handle/bio`. Neue Tabelle `preset_reports`.
  - Migration 006: `preset_reports.reporter_user_id` auf `ON DELETE SET NULL` (Reports bleiben anonymisiert nach Account-Loeschung erhalten — Moderationshistorie bleibt).

- **Editor-Polish**
  - Mobile-Hamburger-Menu im Header.
  - Pinch-Zoom im Editor-Viewport (Pointer-Events-Map mit nahtlosem Wechsel zwischen Pan und Pinch).
  - Empty-State mit gestricheltem Drop-Zone-Container, Upload-Icon und CTA-Buttons.
  - Slider-Tooltips fuer alle 12 Adjustments (Erklaerung in einfachem Deutsch).
  - Sektions-Reihenfolge in der Sidebar: Adjustment-Gruppen oben (Licht open by default), Geometrie/Objektiv unten.
  - Tonkurven-Onboarding-Hint im Panel.
  - Marketplace-Link direkt in der Editor-Toolbar.
  - Marketplace-Apply-Confirm bei aktiver, ungespeicherter Bearbeitung.

- **PWA**
  - `manifest.webmanifest` mit installierbarem Icon, Theme-Color, Standalone-Display.
  - Service-Worker (`sw.js`) mit Stale-While-Revalidate fuer Same-Origin-GET, Network-Only fuer `/api/*` und `/auth/*`, Network-First mit Cache-Fallback fuer Navigation (offline-faehiger Editor sobald die Shell einmal online geladen wurde).

- **Security & DSGVO**
  - Production-Realm `lumen-realm.prod.json` mit `directAccessGrantsEnabled=false` und `verifyEmail=true`.
  - Caddy-Snippet mit Content-Security-Policy, HSTS-Preload, Permissions-Policy, X-Frame-Options DENY und 404-Block fuer `/docs|/redoc|/openapi.json` (Defense-in-Depth zum Backend-Toggle).
  - Backend-Hardening: stabile SHA-256-Hashes im Rate-Limit-Key (statt randomisiertem `hash()`), `LUMEN_ENV=production` blendet OpenAPI-Docs aus, CORS-allow_methods auf konkrete Liste eingeschraenkt, Marketplace-Listing/Cursor-Validation mit MAX_OFFSET, atomic `apply_count`-Increment, Rate-Limit auf `/me/export`.
  - Multi-Worker-Redis-Backend fuer slowapi (`LUMEN_RATELIMIT_STORAGE=redis://lumen-redis:6379/0` in der Production-Compose, Default `memory://`).
  - DSGVO Art. 15+20 Export erweitert um Profil (handle/bio), alle Marketplace-Felder pro Preset und vom User abgegebene Reports.
  - Datenschutzerklaerung um Drittlandtransfer (tfhub-CDN bei opt-in Face-Detection), Marketplace-Sichtbarkeit, Anonymisierung der Reports bei Account-Loeschung und Hinweis auf separate Keycloak-Account-Loeschung erweitert.
  - Face-Detection-Consent-Toggle in der Account-Seite (Modul-Cache + localStorage-Backup, Default off).

- **Refactors**
  - `EditorToolbar`, `EditorBanners`, `EditorOverlayCanvas` aus `Editor.tsx` extrahiert (von 991 auf 636 Zeilen geschrumpft).
  - `LocalAdjBuffers`-Klasse konsolidiert Linear/Radial-Mask-Pre-Allocation im Renderer.
  - Wireformat komplett camelCase (Pydantic `alias_generator=to_camel` + `serialize_by_alias=True`, `populate_by_name=True` fuer Backwards-Compat).

### Geaendert

- **Crop-Pipeline**: Output-Canvas wird auf `imageDims × cropSize` resized, sodass das Crop-Rechteck pixelgenau gemapt wird statt gestreckt. Im Crop-Modus wird waehrend des Editierens das volle Bild gezeigt; erst nach Verlassen des Modus zieht sich der Output zusammen. Crop-Rechteck ist jetzt im Inneren auch verschiebbar (cursor=grab).
- **Mask-Overlays** rechnen Output-UV ↔ Source-UV via `forwardUvTransform` / `invertUvTransform`, damit Drag und Anzeige bei aktivem Crop konsistent zur Shader-Sample-Position bleiben.
- **Auto-WB** nutzt jetzt einen Trimmed-Mean (5–95-Quantil-Bereich) statt purem Gray-World — robuster gegen ausgebrannte Highlights und tiefe Schatten (RawTherapee „Robust Average"-inspiriert).
- **Wireformat** ist jetzt komplett camelCase auf der Wire-Seite, Pydantic-Attribute bleiben snake_case.

### Behoben

- Mediapipe-ESM-Bundling-Fehler unter Rolldown (Vite 8) via Shim-Alias auf `__shims__/mediapipe-face-detection-shim.ts` umgangen.
- Verzerrtes Crop-Output (1:1-Crop wurde auf 3:2-Bild zurueckgestreckt).
- Marketplace-Empty-State erschien faelschlich beim ersten Mount (loading-Initialwert auf `true` korrigiert).
- `apply_count`-Race bei parallelen Apply-Requests (atomic UPDATE statt Read-Modify-Write).
- Cursor-Pagination akzeptierte negative Offsets / unrealistisch hohe Werte (jetzt 422).

## Versionierung

Bis zum Public-Beta-Tag wird auf `main` direkt entwickelt; vor jedem Release-Tag wird der Unreleased-Block in einen versionierten Eintrag geschnitten.

## Konventionen

- Conventional-Commits (`feat()`, `fix()`, `refactor()`, `docs()`, `chore()`).
- Co-Author-Trailer fuer Claude-Code-Sessions.
- Pre-Push: `pnpm build && pnpm lint && pnpm test && pnpm exec tsc -b --noEmit` und `pytest -q` muessen gruen sein.
