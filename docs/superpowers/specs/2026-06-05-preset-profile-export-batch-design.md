# Preset-Profile: YAML-Export/Import, Schritt-Checkboxen, Batch-Anwendung

**Datum:** 2026-06-05
**Status:** Design genehmigt, Spec zur Review

## Motivation

User sollen ihre Bearbeitungsschritte als wiederverwendbares Profil
behandeln koennen: im Account speichern, als YAML-Datei herunterladen,
wieder hochladen oder aus der Liste auswaehlen, beim Anwenden einzelne
Schritt-Gruppen per Checkbox de-/aktivieren, und ein Profil auf ein
oder mehrere Bilder gleichzeitig anwenden.

## Grundsatzentscheidungen

1. **Auf Presets aufbauen, kein neues Entity.** Die drei neuen
   Faehigkeiten (YAML, Schritt-Checkboxen, Batch) sind Features *von*
   Presets. Keine Marketplace-Brueche, keine Doppelung.
2. **Terminologie:** Das Datenmodell bleibt `Preset` (das Wort "Profil"
   ist im Code bereits fuer das Creator-Profil = Handle/Bio belegt). Das
   neue Step-/Batch-UI nennt die Aktionen "Bearbeitungsschritte" bzw.
   "Auf mehrere Bilder anwenden".
3. **Granularitaet = logische Gruppen** (8 Stueck), nicht pro Regler und
   nicht grob nach Adjustments/Masken.
4. **Anwenden = Edit-State nicht-destruktiv setzen.** Angehakte Gruppen
   ueberschreiben den jeweiligen Teil im gespeicherten Edit-State jedes
   Bildes; der Rest bleibt. Kein Rendern. Fertige Dateien holt man danach
   ueber den vorhandenen Voll-Res-Export (C2) pro Bild.
5. **Batch-Logik im Backend** (atomarer Bulk-Endpoint), nicht
   client-orchestriert.

## 1 · Datenmodell & Migration

Presets speichern heute nur `adjustments` + `masks`. Fuer die Schritte
"Crop & Geometrie" und "Objektivkorrektur" muss ein Preset diese Daten
mitfuehren.

**Migration 009 (`009_preset_geometry`)** fuegt der `presets`-Tabelle
eine nullable `geometry` JSONB-Spalte hinzu. Sie haelt dieselbe Form,
die `ImageEditState` bereits kennt:

```
geometry: {
  crop: dict | null,
  straightenAngle: float,         # default 0, -3.15..3.15
  lensCorrection: dict | null,
  lensProfileId: str | null,      # max 80
  manualLensOverride: bool        # default false
}
```

`null` = Preset hat keine Geometrie (Backwards-Compat: alle bestehenden
Presets bleiben gueltig, `geometry` ist optional).

### Schema-Aenderungen (`backend/app/schemas.py`)

- Neues Nested-Model `PresetGeometry` (Felder s.o., `CAMEL_BASE_CONFIG`).
  Crop/LensCorrection bleiben opake `dict | None` — wie in
  `ImageEditState` (der Pixel-Pfad lebt im Frontend).
- `PresetIn`: `geometry: PresetGeometry | None = None`.
- `PresetOut`: `geometry: PresetGeometry | None`.
- `MarketplaceApplyOut` bleibt **unveraendert** (nur adjustments+masks).
  Geometrie wird nie oeffentlich ausgespielt — bildspezifisch + privat.

## 2 · Die 8 Schritt-Gruppen — eine geteilte JSON als Single Source

Statt das Gruppen->Feld-Mapping in Frontend und Backend zu duplizieren
(+ Sync-Test), lebt es in **einer** Datei, die beide lesen — analog zu
`infra/lensfun/profiles.json`. Kein Drift moeglich.

**Neu: `infra/profiles/edit-groups.json`**

```json
[
  { "key": "tone",   "label": "Belichtung & Ton",
    "fields": ["exposure","contrast","highlights","shadows","whites","blacks","highlightRecovery"],
    "defaultEnabled": true },
  { "key": "color",  "label": "Farbe & Weißabgleich",
    "fields": ["temperature","tint","vibrance","saturation"],
    "defaultEnabled": true },
  { "key": "hsl",    "label": "HSL-Mischer",
    "fields": ["hsl"], "defaultEnabled": true },
  { "key": "curve",  "label": "Tonkurve",
    "fields": ["toneCurve"], "defaultEnabled": true },
  { "key": "detail", "label": "Detail (Schärfe/Rauschen/Klarheit)",
    "fields": ["sharpness","noiseReduction","localContrast"],
    "defaultEnabled": true },
  { "key": "masks",  "label": "Masken",
    "fields": ["masks"], "defaultEnabled": true },
  { "key": "crop",   "label": "Crop & Geometrie",
    "fields": ["crop","straightenAngle"], "defaultEnabled": false },
  { "key": "lens",   "label": "Objektivkorrektur",
    "fields": ["lensCorrection","lensProfileId","manualLensOverride"],
    "defaultEnabled": false }
]
```

`label` enthaelt echte Umlaute (UTF-8, user-sichtbar). Die `fields`
benennen Wire-Keys (camelCase), wie sie im Adjustments-/Geometry-Objekt
heissen.

**Feld-Abdeckung (lueckenlos):** Die 16 numerischen Adjustment-Felder +
`hsl` + `toneCurve` werden vollstaendig von tone/color/hsl/curve/detail
abgedeckt; `masks` von masks; die 5 Geometry-Felder von crop/lens. Ein
Vitest prueft, dass jedes bekannte Feld zu genau einer Gruppe gehoert
(keine Luecke, keine Doppelung).

### Merge-Semantik (nicht-destruktiv)

Pro Zielbild:
1. Start vom vorhandenen Edit-State des Bildes (oder Default-Adjustments
   + leere Masken + keine Geometrie, falls kein `image_edits`-Eintrag).
2. Fuer jede **angehakte** Gruppe: deren Felder aus dem Profil
   uebernehmen (ueberschreiben).
3. Nicht-angehakte Gruppen: Bild-Werte bleiben unveraendert.
4. Wenn das Profil keine Geometrie hat, aber `crop`/`lens` angehakt
   sind: Gruppe wird auf neutral/null gesetzt (Profil sagt "keine
   Geometrie") — gleiches Prinzip wie `hsl: null` = inaktiv.

## 3 · Backend-Endpoints

`backend/app/routers/presets.py`:

- `POST /presets` & `PUT /presets/{id}`: akzeptieren optional
  `geometry`, persistieren es in der neuen Spalte.
- **Neu** `POST /presets/{id}/apply`
  - Body: `BatchApplyIn { imageIds: list[UUID], groups: list[str] }`.
  - `groups` wird gegen die bekannten Gruppen-Keys validiert (unbekannt
    -> 422).
  - Validierung *vor* jeder Mutation: Preset gehoert dem User; alle
    `imageIds` gehoeren dem User und sind `upload_state == "ready"`.
    Sonst 400, kein Schreibvorgang (all-or-nothing).
  - Pro Bild: vorhandenen `image_edits`-Stand laden (oder Default),
    angehakte Gruppen aus dem Preset mergen (Mapping aus der geteilten
    JSON, backend-seitig in `app/profile_groups.py` geladen), upsert.
  - Alles in **einer** Transaktion, ein Commit.
  - Antwort: `BatchApplyOut { applied: int, total: int }`.
  - Rate-Limit analog der uebrigen Mutationen (`@limiter.limit`).
- **YAML braucht keinen eigenen Endpoint.** Import = Client parst die
  YAML und ruft `POST /presets` — Pydantic (`extra="forbid"`, Ranges,
  Mask-Caps) ist die Validierungs-Autoritaet. Export = reine
  Client-Serialisierung des bereits vorhandenen Preset-Objekts.

### `backend/app/profile_groups.py`

Liest `infra/profiles/edit-groups.json` beim Import (json.load), stellt
`GROUP_FIELDS: dict[str, list[str]]` und `KNOWN_GROUP_KEYS: set[str]`
bereit. Enthaelt `merge_groups(base_edit, preset, enabled_keys)`, das
einen neuen Edit-State-Dict baut.

## 4 · Frontend

### a) `src/editor/profileGroups.ts`

Importiert `infra/profiles/edit-groups.json` (Vite resolved JSON),
exportiert:
- `GROUPS` (Liste mit key/label/fields/defaultEnabled),
- `defaultEnabledGroups(): Set<string>`,
- `mergeGroups(base, profile, enabled)` — reine Funktion, baut einen
  gemergten Edit-State (fuer Live-Editor-Apply).

### b) `src/editor/PresetDialog.tsx`

- "Laden" -> **"Anwenden"**: oeffnet zuerst ein Step-Checkbox-Panel
  (8 Gruppen, crop/lens default aus, mit Hinweis dass diese
  bildspezifisch sind) -> "Anwenden" merged die gewaehlten Gruppen live
  in den Editor-Store fuer das aktuell offene Bild.
- **YAML-Export** je Preset (Button -> Download `<name>.yaml`).
- **YAML-Import** (Datei waehlen -> `yaml.parse` -> `POST /presets`,
  erscheint danach in der Liste = "auswaehlen" erledigt). Fehlerhafte
  YAML -> Fehlertext (Client-Shape-Check + Server-422).
- Speichern erfasst zusaetzlich `geometry` aus dem Store
  (cropRect/straightenAngle/lensCorrection/lensProfileId/
  manualLensOverride).

### c) `src/editor/store.ts`

Neuer Befehl `applyProfileGroups(profile, enabledKeys)`: merged nur die
angehakten Gruppen in den aktuellen State, ein History-Snapshot (Undo
bleibt heil). Nutzt dieselbe `mergeGroups`-Logik.

### d) `src/pages/Library.tsx`

- Mehrfachauswahl: Checkbox je Bildzeile + "Alle auswaehlen".
- "Profil anwenden" (aktiv ab >=1 selektiertem Bild) -> Modal:
  Preset-Auswahl (Liste) + 8 Step-Checkboxen -> "Auf N Bilder anwenden"
  -> `POST /presets/{id}/apply` -> Ergebnis-Toast ("N von N angewendet").

### e) API-Client `src/api/client.ts`

- `Preset`-Typ um `geometry` erweitern.
- `applyPresetBatch(id, { imageIds, groups })` + Response-Typ.

### f) Dependency

`yaml` (npm, eemeli/yaml) fuer robustes Serialisieren/Parsen.
Hand-Rolling von YAML-Parsing waere fehleranfaellig.

## 5 · YAML-Format (versioniert)

```yaml
lumenProfile: 1
name: "Mein Look"
adjustments:
  exposure: 0.3
  contrast: 0.1
  # ... restliche camelCase-Felder = Wire-Format
masks: []
geometry:            # optional, weglassbar
  crop: null
  straightenAngle: 0
  lensCorrection: null
  lensProfileId: null
  manualLensOverride: false
```

`lumenProfile: 1` ist die Format-Version (zukunftssicher fuer Migrationen).
Import lehnt unbekannte/zu hohe Versionen mit klarer Meldung ab.

## 6 · Tests

**pytest (`backend/tests/`)**
- Geometry-Round-Trip im Preset-CRUD (create/get/update mit + ohne
  geometry).
- Bulk-Apply merged nur angehakte Gruppen, laesst nicht-angehakte stehen.
- Bulk-Apply auf Bild ohne Vor-Edit startet von Defaults.
- Fremd-Bild in `imageIds` -> 400, **keine** Mutation an den eigenen.
- Unbekannter Gruppen-Key -> 422.
- `applied == total` bei Erfolg.

**vitest (`frontend/tests/`)**
- `mergeGroups`: angehakt ueberschreibt, nicht-angehakt behaelt.
- YAML Serialize -> Parse Round-Trip ergibt identisches Profil.
- Gruppen-Vollstaendigkeit: jedes bekannte Feld in genau einer Gruppe.

**Playwright (`frontend/e2e/`)**
- Profil speichern -> YAML-Export (Download) -> Library-Mehrfachauswahl
  -> mit einigen Schritten *aus* anwenden -> Edit-State der Zielbilder
  geprueft (via `GET /images/:id/edit`).

## 7 · Caveats (dokumentieren)

- **Crop/Objektiv default aus.** Eine Crop-Rect oder ein Lens-Profil
  ueber verschiedene Bilder/Objektive zu kopieren kann falsch aussehen.
  UI-Hinweis im Step-Panel.
- **Marketplace-Publish ignoriert Geometrie** — wird nie oeffentlich
  ausgespielt.
- **Batch-Apply ist all-or-nothing** — Ownership/Ready wird vorab
  geprueft, dann ein Commit.
- **Schema-Drift-Notiz** fuer CLAUDE.md: `infra/profiles/edit-groups.json`
  ist Single Source fuer das Gruppen->Feld-Mapping (FE + BE lesen sie);
  Feld-Abdeckung per Vitest geprueft.

## Nicht im Scope (YAGNI)

- Sofort-Rendern/Batch-Download fertiger JPEGs (Anwenden setzt nur
  Edit-State; Export bleibt der vorhandene Per-Bild-C2-Pfad).
- Pro-Regler-Granularitaet.
- YAML-Import als "direkt anwenden ohne speichern" (Import erzeugt immer
  ein gespeichertes privates Preset, das dann auswaehlbar ist).
