# Phase-5-Erweiterung: Implementierungsplan

> **Fuer agentische Worker:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development oder superpowers:executing-plans, Tasks koennen einzeln und sequentiell abgearbeitet werden.

**Goal:** Lumen vom funktionalen MVP zu einer stabilen, sicheren, DSGVO-tauglichen und fuer Hobbyfotografen nutzbaren App ausbauen — basierend auf vier Reviews (Code, Security, DSGVO, UI/UX) vom 2026-04-28.

**Architecture:** Phaseneinteilung A-E priorisiert nach Production-Risiko: zuerst Security + DSGVO-Blocker, dann UX-Blocker, dann Automatismen, dann Code-Quality, schliesslich Tiefe. Jede Phase ist liefer-faehig und CI-gruen.

**Tech Stack:** Bestehender Stack — FastAPI, SQLAlchemy 2.0 async, Pydantic 2, React 19, TypeScript 6, Vite 8, Tailwind 4, Zustand 5, WebGL2, Playwright. Neu: pyjwt statt python-jose, slowapi fuer Rate-Limit, github-actions fuer CI.

---

## Phase A — Sicherheits- + DSGVO-Foundations

### Task A1: JWT alg-Whitelist
**Files:**
- Modify: `backend/app/auth.py:124`
- Test: `backend/tests/test_auth_jwks.py` (existiert)

- [ ] Step 1: Aenderung — `algorithms=[header.get("alg", "RS256")]` -> `algorithms=["RS256"]`
- [ ] Step 2: Test in test_auth_jwks.py: kreiert Token mit `alg=HS256` (HMAC mit JWK-Public-Key als Secret), erwartet 401 statt 200.
- [ ] Step 3: Tests laufen, commit.

### Task A2: python-jose -> pyjwt
**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/auth.py` (jwt-Imports + verify-Code)
- Test: bestehende Suite (`test_auth_*.py`)

- [ ] Step 1: `python-jose` aus requirements raus, `PyJWT[crypto]>=2.10` rein.
- [ ] Step 2: `from jose import jwt, JWTError` → `import jwt; from jwt.exceptions import InvalidTokenError`.
- [ ] Step 3: Verify-Code anpassen — `jwt.decode(token, key=..., algorithms=["RS256"], audience=..., issuer=...)`.
- [ ] Step 4: pytest komplett gruen.

### Task A3: Upload-Size hart durchsetzen
**Files:**
- Modify: `backend/app/routers/images.py:88-110` (confirm_upload)
- Modify: `backend/app/storage.py` (head() liefert bereits content_length)
- Test: `backend/tests/test_images_upload.py` neue Faelle

- [ ] Step 1: In `confirm_upload`: `head_response = storage.head(bucket_key)`, lese `ContentLength`.
- [ ] Step 2: Bei `ContentLength > settings.max_image_size_bytes`: `storage.delete(bucket_key)` + `raise HTTPException(413)`.
- [ ] Step 3: Test: pre-signed PUT mit zu grossem Body, confirm gibt 413, Object weg.

### Task A4: Schema-Drift Single-Source
**Files:**
- Create: `frontend/src/shared/limits.ts` mit `MAX_LINEAR_MASKS`, `MAX_RADIAL_MASKS`, `LOCAL_ADJUSTMENT_LIMITS`, `DISTORTION_GAIN`, `VIGNETTE_GAIN`, `TEMPERATURE_GAIN`, `TINT_GAIN`.
- Modify: `frontend/src/editor/mask.ts`, `frontend/src/editor/lens.ts` (Re-Exports).
- Modify: `frontend/src/editor/shaders.ts` — Konstanten via Template-String-Interpolation injizieren.
- Test: `frontend/tests/limits-sync.test.ts` validiert Shader-String enthaelt erwartete Werte.
- Backend: `backend/app/schemas.py` MAX_LINEAR/RADIAL bleiben, aber `backend/tests/test_schema_sync.py` erweitern um diese Werte gegen das ausgelieferte JSON zu pruefen.

- [ ] Step 1: limits.ts mit allen geteilten Konstanten erstellen.
- [ ] Step 2: shaders.ts auf Template-String umstellen.
- [ ] Step 3: Tests gruen.

### Task A5: DELETE /me + Datenexport
**Files:**
- Modify: `backend/app/routers/auth.py` (oder neuer router)
- Modify: `backend/app/storage.py` (delete_by_prefix oder bulk-delete)
- Modify: `backend/app/keycloak_admin.py` (neu — Admin-API-Client fuer User-Delete)
- Modify: `frontend/src/pages/Account.tsx` (UI-Knoepfe)
- Test: `backend/tests/test_user_lifecycle.py` neu

- [ ] Step 1: `DELETE /api/v1/me` — iteriert bucket_keys, ruft `storage.delete()`, dann `db.delete(user)` (cascade kuemmert presets+images-Rows), dann `keycloak_admin.delete_user(sub)`.
- [ ] Step 2: `GET /api/v1/me/export` — JSON mit `me`, `presets[]`, `images[]` (Metadaten + Pre-Signed-URLs gueltig 60s).
- [ ] Step 3: UI-Buttons mit Confirm-Dialog.
- [ ] Step 4: Test-Suite: User anlegen, Bilder hochladen, DELETE /me, alles weg (DB + S3 + Keycloak-Mock).

### Task A6: Rate-Limiting + Container-Hardening
**Files:**
- Modify: `backend/requirements.txt` (slowapi)
- Modify: `backend/app/main.py` (Limiter Middleware)
- Modify: `backend/app/routers/*.py` (Decorators auf write-Endpoints)
- Modify: `backend/Dockerfile` + `frontend/Dockerfile` (USER non-root)

- [ ] Step 1: slowapi-Limiter, Default 60/min auf write, 600/min auf read.
- [ ] Step 2: `presets/` POST/PUT/DELETE und `images/` init/confirm dekorieren.
- [ ] Step 3: Dockerfiles: `RUN groupadd -r app && useradd -r -g app app`, `USER app`.

### Task A7: Docker-Logging-Rotation + extra="forbid"
**Files:**
- Modify: `deployment/docker-compose.prod.yml` (logging-Section pro Service)
- Modify: `backend/app/schemas.py` `PresetIn`, `ImageInitIn` mit `extra="forbid"`

- [ ] Step 1: `logging: { driver: "json-file", options: { max-size: "10m", max-file: "3" }}` zu jedem Service.
- [ ] Step 2: model_config = ConfigDict(extra="forbid") auf den Top-Level-In-Schemas.

---

## Phase B — UX-Blocker

### Task B1: Undo/Redo + History
**Files:**
- Create: `frontend/src/editor/history.ts` (state-snapshot middleware fuer Zustand)
- Modify: `frontend/src/editor/store.ts` (Wrapper mit history)
- Modify: `frontend/src/editor/useKeyboardShortcuts.ts` (Cmd+Z, Cmd+Shift+Z)
- Modify: `frontend/src/pages/Editor.tsx` (Undo/Redo-Toolbar-Buttons)
- Test: `frontend/tests/history.test.ts`

- [ ] Step 1: history.ts mit fixed-size-Stack (50 Eintraege), debounced 200ms.
- [ ] Step 2: Snapshot-Felder: adjustments, masks, cropRect, straightenAngle, lensCorrection.
- [ ] Step 3: Tests: 30 setAdjustment-Calls, undo()→Wert von vor 30, redo()→aktuell.

### Task B2: Echte Landing-Page + Demo-Bild
**Files:**
- Modify: `frontend/src/pages/Landing.tsx` (Hero + Vorher/Nachher-Demo + CTA)
- Modify: `frontend/src/pages/Editor.tsx` (Empty-State „Beispielbild laden"-Button, faded sample served from public/)
- Add: `frontend/public/sample-before.jpg`, `sample-after.jpg`, `sample-source.jpg` (Test-Sample fuer Demo-Klick)

- [ ] Step 1: Landing mit Marketing-Hero („Lumen — RAW im Browser entwickeln"), CTA „Im Editor starten" → /login?next=/editor.
- [ ] Step 2: Empty-State-Editor: „Bild laden" + „Beispielbild laden" (laed gradient.jpg via fetch).

### Task B3: Tooltips + Shortcut-Cheatsheet
**Files:**
- Modify: `frontend/src/pages/Editor.tsx` — `title=` auf jedem Toolbar-Button.
- Create: `frontend/src/editor/ShortcutCheatsheet.tsx` — Modal-Liste der Shortcuts.
- Modify: `useKeyboardShortcuts.ts`: `?` → onShowHelp.

- [ ] Step 1: Cheatsheet-Modal mit allen Tasten und Beschreibungen.
- [ ] Step 2: title-Attribute auf alle Buttons.

### Task B4: Sidebar-Reorganisation
**Files:**
- Modify: `frontend/src/pages/Editor.tsx` (Sidebar-Reihenfolge + collapsable sections)
- Create: `frontend/src/editor/CollapsibleSection.tsx` (state per `localStorage`-Key)

- [ ] Step 1: Reihenfolge — Histogramm, Licht, Farbe, Geometrie (collapsed), Objektiv (collapsed), Masken, Lokal · *.
- [ ] Step 2: Collapsible-Component mit Persistenz pro User.

### Task B5: „Halten fuer Original" → Icon mit Tooltip
**Files:**
- Modify: `frontend/src/pages/Editor.tsx` Toolbar.

- [ ] Step 1: Augen-Icon (Lucide oder selbst SVG), title=„Drueck-und-halten zeigt Original (Shortcut: \\)".

### Task B6: Toolbar-Gruppierung
**Files:**
- Modify: `frontend/src/pages/Editor.tsx`.

- [ ] Step 1: Drei Gruppen: View (Bypass + Crop + WB + Zoom), Masken (+Verlauf, +Radial), Action (Presets, Export). Trenner dazwischen, Export rechts abgesetzt.

### Task B7: Slider-Konsistenz + Bezeichnungen
**Files:**
- Modify: `frontend/src/editor/adjustments.ts` (Tint-Label „Toenung")
- Modify: `frontend/src/pages/Editor.tsx` (onDoubleClick auf Feather-Slider)

- [ ] Step 1: `tint` label „Toenung", Vibrance bleibt „Dynamik" (Lightroom-Konvention).
- [ ] Step 2: onDoubleClick auf Feather-Slider in beiden Local-Sections.

### Task B8: Decoding-Progress
**Files:**
- Modify: `frontend/src/pages/Editor.tsx` (Spinner + Schritt-Anzeige).
- Modify: `frontend/src/editor/raw.ts` (Callback fuer Phase: „lese", „dekodiere", „rendere").

- [ ] Step 1: decodeRaw bekommt onProgress-Callback.
- [ ] Step 2: Editor zeigt Inline-Spinner mit Schritt-Text.

### Task B9: Errors dismissable
**Files:**
- Modify: `frontend/src/pages/Editor.tsx`.

- [ ] Step 1: Fehler-Anzeige als Toast mit X-Button + 8s Auto-Hide.

---

## Phase C — Automatismen fuer „gute Ergebnisse"

### Task C1: Auto-Tone-Button
**Files:**
- Create: `frontend/src/editor/autoTone.ts` (Histogramm-Analyse + Slider-Vorschlag)
- Modify: `frontend/src/pages/Editor.tsx` (Toolbar-Button „Auto")
- Test: `frontend/tests/autoTone.test.ts` (statisches Bild → erwartete Slider-Werte)

- [ ] Step 1: Histogramm aus Canvas readback (analog Histogram.tsx).
- [ ] Step 2: 0.5%-Quantile berechnen, daraus blacks/whites/exposure ableiten.
- [ ] Step 3: applyAdjustments mit Vorschlag.

### Task C2: Auto-WB-Button (Gray-World)
**Files:**
- Modify: `frontend/src/pages/Editor.tsx` (Button neben WB-Picker).

- [ ] Step 1: Mean(R), Mean(G), Mean(B) aus Canvas-Readback (skaliert 100×100 fuer Speed).
- [ ] Step 2: Gleiche Korrektur-Math wie Picker, aber mit Mittelwerten.

### Task C3: Vorher/Nachher-Split
**Files:**
- Create: `frontend/src/editor/CompareSplit.tsx` (Bar mit Drag-Handle).
- Modify: `frontend/src/pages/Editor.tsx` (Toggle-Button).

- [ ] Step 1: Bar bei x-Position (Default 50%), links Original-Canvas, rechts edited-Canvas. Realisierung: zweite Canvas-Render im Bypass-Mode mit clip-path.

### Task C4: Smart-Preset-Suggestion
**Files:**
- Create: `frontend/src/editor/suggestPreset.ts` (EXIF + Histogramm → Preset-Name).
- Modify: `frontend/src/pages/Editor.tsx` (Hint-Banner + Apply).

- [ ] Step 1: Brennweite + Histogram-Median + Sat-Mean → Heuristik („Landschaft" / „Portrait" / „Stadt" / „Sport").
- [ ] Step 2: Banner „Vorschlag: Landschaft anwenden?" mit Klick-Aktion.

### Task C5: Auto-Straighten (optional, kompliziert)
**Files:**
- Create: `frontend/src/editor/autoStraighten.ts` (Sobel + Hough-Lite).
- Modify: `frontend/src/editor/CropOverlay.tsx` (Button im Crop-Mode).

- [ ] Step 1: Edge-Detection auf 256×256-Downscale.
- [ ] Step 2: Dominanten Winkel finden, setStraightenAngle.

---

## Phase D — Code-Quality + CI

### Task D1: Editor.tsx aufteilen
- [ ] EditorViewport.tsx (Pan/Zoom/WB/Drop/Toolbar)
- [ ] EditorSidebar.tsx (alle Sections)
- [ ] LocalMaskPanel.tsx (Linear/Radial-Duplikation eliminiert)
- [ ] ExportDialog.tsx (out of Editor.tsx)

### Task D2: Linear/Radial-Renderer-Generic
- [ ] webgl.ts: pack-Logik per Schema, einmal implementiert.

### Task D3: CI-Pipeline
- [ ] `.github/workflows/ci.yml` mit backend-pytest, frontend-vitest, frontend-lint, frontend-build, schema-sync-check, e2e (nightly).

### Task D4: Wireformat normalisieren
- [ ] Pydantic alias_generator=to_camel auf allen Out-Schemas.
- [ ] frontend/src/api/client.ts → openapi-typescript-Build oder weiter handgepflegt aber konsistent camelCase.

### Task D5: legacy/ entfernen
- [ ] `git rm -rf frontend/legacy/`.

### Task D6: Tests fuer Editor-Komponenten
- [ ] EditorViewport.test.tsx, EditorSidebar.test.tsx, LocalMaskPanel.test.tsx (sobald aufgeteilt).

---

## Phase E — Tiefere Bearbeitung (Backlog, nicht in dieser Iteration)

- HSL-Farbmischer (8 Hue × 3 Achsen)
- Tonkurve (Spline)
- Sharpening + Noise-Reduction (RAW-Pipeline)
- Face-Detection fuer Smart-Preset (TensorFlow.js)
- EXIF-Strip-Option beim Upload (DSGVO)
- Datenschutzerklaerung + Impressum (DSGVO Public-Launch)

---

## Reihenfolge der Umsetzung

1. **A1, A4, A7** (kleine Sicherheits- und Schema-Fixes) → 1 Commit
2. **A3** (Upload-Size) → 1 Commit
3. **A2** (python-jose → pyjwt) → 1 Commit
4. **A5** (DELETE /me + Export) → 1 Commit
5. **A6** (Rate-Limit + Container-User) → 1 Commit
6. **B7, B5, B6, B9** (kleine UX) → 1 Commit
7. **B1** (Undo/Redo) → 1 Commit
8. **B3** (Tooltips + Cheatsheet) → 1 Commit
9. **B4** (Sidebar-Reorg + Collapsible) → 1 Commit
10. **B8** (Decoding-Progress) → 1 Commit
11. **B2** (Landing-Page + Demo) → 1 Commit
12. **C1** (Auto-Tone) → 1 Commit
13. **C2** (Auto-WB) → 1 Commit
14. **C3** (Vorher/Nachher-Split) → 1 Commit
15. **C4** (Smart-Preset) → 1 Commit
16. **D1, D2** (Editor-Split + Renderer-Generic) → 1 Commit
17. **D3** (CI) → 1 Commit
18. **D5** (legacy weg) → 1 Commit

Phasen E + restliche D bleiben Backlog.

## Akzeptanzkriterien

- pytest 100%, vitest 100%, lint 0, build sauber.
- E2E-Suite ueber alle Phasen-A-C-Aenderungen gruen.
- Production-Deployment zeigt keine [BLOCKER] aus den vier Reviews mehr.
