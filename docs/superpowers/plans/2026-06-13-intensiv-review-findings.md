# Intensiv-Review 2026-06-13 — konsolidierte Findings + Fix-Plan

5 parallele Read-only-Reviews (Security, DSGVO, Backend-Code, Frontend-UI/UX,
Testabdeckung). Branch `main` war clean. Fix-Ziel: alle Findings bis
einschliesslich LOW.

## Severity-Bilanz (verifiziert am Code)

| Dimension      | CRIT | HIGH | MED | LOW |
|----------------|------|------|-----|-----|
| Security       | 0    | 0    | 0   | 7   |
| DSGVO          | 0    | 1    | 3   | 3   |
| Backend-Code   | 0    | 1    | 3   | 4   |
| Frontend-UI/UX | 1    | 2    | 6   | 6   |
| Testabdeckung  | 1    | 3    | 7   | 3   |

Tenant-Isolation, JWT-Verify (RS256-Whitelist gegen alg-confusion),
SQL/Path-Injection und CORS wurden positiv verifiziert — keine ausnutzbaren
Auth-Bypass-/IDOR-/Injection-Luecken.

## Fix-Gruppen

### A — Backend-Korrektheit + DSGVO-Datenpfade
- B1 [HIGH] `PATCH /me/profile` ueberschreibt nicht-gesendete Felder mit NULL → `exclude_unset`
- D1 [HIGH] `GET /me/export` unvollstaendig → Feedback + ImageEdit-State ergaenzen
- B2 [MED] `fork` verliert `geometry` → mitkopieren
- B4 [MED] `report_count` Lost-Update → Auto-Hide aus frischem `count` (tut der Code teils schon; persistiertes Feld atomar setzen)
- B3 [MED] `DELETE /images` S3-Fehler → 502 statt nacktem 500; Janitor raeumt `failed`
- B6 [LOW] `PresetExport` ohne `geometry` → ergaenzen
- B7 [LOW] Re-Confirm bereits `ready` → Early-Return idempotent
- B5 [LOW] Index-Drift Modell↔Migration → Indizes in `models.py` spiegeln
- S1 [LOW] Marketplace-Preview nur fuer `upload_state == "ready"` ausliefern
- B8 [LOW] 002-Downgrade Datenqualitaet → Kommentar

### B — Backend-Tests (Testabdeckung-Findings)
- T1 [CRIT] `confirm_upload` Tenant-Negativtest (fremder User → 404)
- T2 [HIGH] Re-Publish-Block nach Auto-Hide (409)
- T3 [HIGH] `fork`/`report` 404 auf privates Preset
- T4 [HIGH] `delete_image` S3-Fehlerpfad (failed + idempotent)
- T5 [MED] Disabled-Admin geblockt
- T6 [MED] Admin-Rolle via `resource_access`
- T7 [MED] Echter Expired-Token → 401
- T8 [MED] `list_images` ungueltiger `sort` → 422
- T9 [MED] Honeypot leer/whitespace → persistiert
- T10 [MED] `ImageEditState.straightenAngle`-Bound → 422
- T11 [MED] `merge_edit_state` masks/lens-Gruppen
- T12 [LOW] Token ohne `kid` → 401
- (Frontend) T13 [LOW] `stripExifIfJpeg`-Wrapper-Gate
- (Frontend) T14 [LOW] `invertUvTransform` degeneriert → Identity

### C — Frontend UI/UX
- F1 [CRIT] Library-Bild-Loeschen ohne Bestaetigung → zweistufig
- F2+F3+F11 [HIGH] Geteilter `<Modal>`-Wrapper (role/aria-modal/Escape/Focus-Trap) fuer Marketplace-Detail, PresetDialog, ShortcutCheatsheet, ExportDialog, BatchApplyModal
- F4 [MED] Onboarding Bypass-Shortcut „B" → „\"
- F5 [MED] „schliessen" → „schließen" (EditorBanners aria-label)
- F6 [MED] „Spass"/„Weiss" → „Spaß"/„Weiß" (Onboarding)
- F7 [MED] Smart-Suggestion „Anwenden" no-op → Hinweis
- F8 [MED] Login zeigt `auth.error` nicht → Fehlerbanner
- F9 [MED] Compare-Toggle waehrend Decoding → disabled
- F10 [LOW] Account stille catches → dezenter Hinweis
- F12 [LOW] Marketplace Sort-Select/Such-Input aria-label
- F13 [LOW] CollapsibleSection `aria-controls`

### D — DSGVO-Texte (Datenschutz.tsx)
- D2 [MED] Matomo-DNT-Aussage relativieren / Opt-out
- D3 [MED] tfhub.dev + kaggle.com Drittland-Empfaenger offenlegen (oder CSP reduzieren)
- D4 [MED] buy-me-a-coffee Drittland-Link erwaehnen
- D5 [LOW] Feedback-Erhalt nach Loeschung transparent
- D6 [LOW] Feedback als Datenkategorie listen
- D7 [LOW] RAW-EXIF-Hinweis verstaerken (Hardening)

### E — Infra/Config (Security-LOW)
- S4 [LOW] `security_headers`-Snippet ins Repo ✓ (`infra/caddy/security_headers.snippet.caddy` + Verweis im Caddyfile)
- S5 [LOW] CSP `script-src musikersuche.org` ✓ als bewusster Selfhost-Trade-off am CSP-Block dokumentiert (Haertung: matomo.js co-hosten/SRI)
- S7 [LOW] Pending-Upload-Soft-Quota ✓ (`max_pending_uploads_per_user=50`, 429 in `init_upload` + Test)
- S3 [LOW] EXIF-Strip serverseitig fuer Public-Previews — Public-Previews sind bereits JPEG-Pflicht; Hinweis in Datenschutz (D7) verschaerft.

## Umsetzungsstand (2026-06-13)

Alle Findings bis LOW umgesetzt. Bewusst als Selfhost-Single-User-Trade-off
akzeptiert (im Code/Plan dokumentiert, kein Launch-Blocker):

- **S2** [LOW] `me/export` Pre-Signed-URL-TTL 900s — Endpoint ist auth-geschuetzt
  und auf eigene Daten beschraenkt; eigene Export-TTL/Einmal-Token erst vor
  Multi-Tenant-Public noetig.
- **S6** [LOW] Rate-Limit-Bucketing aus unverifiziertem `sub` — Fake-`sub`
  scheitert ohnehin in der Auth-Dependency (401); ein zusaetzlicher Pre-Auth-
  IP-Limiter ist erst bei 401-Flooding noetig.

Tests: Backend +20 (AuthZ-Negativ, Moderation, S3-Fehlerpfad, Honeypot,
Bounds, Merge-Gruppen, Quota), Frontend +Modal-A11y, exifStrip-Wrapper,
transform-Degenerate.
