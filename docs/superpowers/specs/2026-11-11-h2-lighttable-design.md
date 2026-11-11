# H2 · Lighttable (Bibliothek mit Vorschauen, Bewertung, Aussortieren)

Stand: 2026-11-11 · Roadmap: `docs/06-roadmap.md`, Phase H, Item H2.
Herkunft: darktable-Lighttable, Lightroom-Bibliothek. Manuel hat die
Rückfragen übersprungen („leg los"). Entscheidungen unten sind meine
Annahmen.

## Ausgangslage

`frontend/src/pages/Library.tsx` ist heute eine Textliste (Dateiname, Größe,
Typ). Es gibt **keine** Vorschaubilder. Ohne Vorschaubilder ist eine
Lighttable sinnlos. H2 baut deshalb in drei Schritten:

- **H2a** Vorschaubilder pro Bild (mit Bearbeitung).
- **H2b** Raster-Ansicht, Sterne, Farblabels, Markierung, Filter.
- **H2c** Lupe, Vergleich, Aussortieren per Tastatur.

Jeder Schritt ist einzeln mergebar und deploybar.

## Intent

Nach einem Shooting 200 RAWs hochladen, schnell durchsehen, die guten
markieren, die schlechten aussortieren, die guten bearbeiten. Heute muss
man jedes Bild einzeln im Editor öffnen, um es überhaupt zu sehen.

## Goals

- Raster mit Vorschaubildern, die die aktuelle Bearbeitung zeigen.
- Sterne 0–5, Farblabel (rot/gelb/grün/blau/lila), Markierung
  (keine/ausgewählt/abgelehnt) pro Bild; einzeln und für Mehrfachauswahl.
- Filter und Sortierung serverseitig.
- Lupe (großes Bild, Pfeiltasten blättern) und Vergleich von zwei Bildern.
- Alles per Tastatur bedienbar, alles auch per Maus/Touch bedienbar.

## Non-Goals

- Tags/Stichwörter, Alben/Sammlungen, EXIF-Suche, Gesichter-Gruppierung.
- XMP-Sidecar-Import/-Export.
- Bewertungen im Marketplace.
- Virtuelle Kopien (eigenes Backlog-Item).

## Anti-Goals

- Bibliothek mit 500 Bildern lädt spürbar langsamer als heute
  (Ziel: erste Kacheln < 1 s nach Liste, Bilder `loading="lazy"`).
- Vorschaubild verrät Metadaten (GPS, Kamera-Seriennummer).
- Einzeltasten-Kürzel ohne Abschaltmöglichkeit (WCAG 2.1.4; es gibt
  `shortcutPrefs.ts`).

## H2a · Vorschaubilder

**Entstehung (meine Entscheidung): im Browser.** Der Server kann RAW nicht
dekodieren; der Browser kann es (libraw-wasm) und kennt die Bearbeitung.

- Nach Upload: JPEG/PNG sofort per `createImageBitmap` verkleinern. RAW:
  eingebettetes JPEG über libraw-wasm, falls die Bibliothek das hergibt;
  sonst Platzhalter bis zum ersten Öffnen im Editor. TIFF: Platzhalter.
- Im Editor: nach erfolgreichem Autosave (debounced, max. 1× pro 10 s pro
  Bild) und beim Verlassen ein Bild aus dem Renderer mit Bearbeitung,
  lange Kante 1600 px, JPEG q≈0.85.
- Upload: `PUT /api/v1/images/{id}/thumbnail`, Multipart, max. 1 MB,
  Rate-Limit 30/min. **Abweichung** vom Grundsatz „Pixel nicht durch
  FastAPI": bewusst, weil klein und weil der Server ohnehin neu kodieren muss.
- Server: Pillow dekodiert (gleiche Grenzen wie `app/previews.py`:
  `MAX_IMAGE_PIXELS`, BoundedSemaphore teilen), re-encodet ohne Metadaten in
  zwei Größen: `preview` 1600 px, `thumb` 400 px. Keys versioniert:
  `{uid}/thumbs/{image_id}-{hex}-{400|1600}.jpg`; alter Satz wird gelöscht.
- DB: `images.thumb_key`, `images.preview_key` (nullable), Migration 013.
- `ImageOut` bekommt `thumbUrl` und `previewUrl` (signierte GET-URLs,
  kurze TTL wie `/url`), `null` wenn nicht vorhanden.
- Löschen: `DELETE /images/{id}` entfernt beide Objekte; `DELETE /me`
  deckt sie über den Prefix-Purge ab (prüfen).
- Bestand: Skript `scripts.backfill_thumbnails` erzeugt für JPEG/PNG/TIFF
  serverseitig Vorschauen (ohne Bearbeitung), idempotent; `deploy.sh` ruft
  es wie `backfill_previews` auf. RAW-Bestand bekommt sie beim nächsten
  Öffnen.

## H2b · Raster und Metadaten

- Migration 013 zusätzlich: `rating smallint not null default 0`
  (CHECK 0..5), `color_label text null` (CHECK in Liste), `flag text not
  null default 'none'` (CHECK none/pick/reject). Index
  `(user_id, rating)`.
- `PATCH /images/{id}` mit `rating?`, `colorLabel?`, `flag?`
  (extra=forbid). `PATCH /images` (Batch) mit `ids` (max. 500) + gleichen
  Feldern. Nur eigene Bilder; fremde IDs → 404 ohne Teil-Update.
- `GET /images` Filter: `minRating`, `colorLabel` (mehrfach), `flag`,
  `sort` (`created_desc` Default, `created_asc`, `rating_desc`,
  `name_asc`). Pagination und `X-Total-Count` wie heute.
- `/me/export` enthält die drei Felder.
- Frontend: Raster als Default, Umschalter zurück zur Liste (Zustand in
  localStorage). Kachel: Vorschaubild (sonst Platzhalter mit Dateityp),
  Dateiname, Sterne, Label-Punkt, Markierung. Auswahl per Checkbox bleibt
  (Batch-Apply, Löschen). Filterleiste oben. Leerer Filter-Treffer mit
  „Filter zurücksetzen".
- Fokus-Führung: Raster als Liste mit Roving-Tabindex, Pfeiltasten bewegen
  den Fokus, Änderungen werden über eine `aria-live`-Region angesagt
  („3 Sterne").

## H2c · Lupe, Vergleich, Aussortieren

- Lupe: Overlay/Route mit `previewUrl`, Pfeil links/rechts blättert im
  aktuellen Filter-Ergebnis, Esc schließt, Fokus kehrt zur Kachel zurück.
- Vergleich: genau zwei ausgewählte Bilder nebeneinander (mobil
  untereinander).
- Tasten (Lightroom-nah, nur wenn Einzeltasten-Kürzel an):
  `0`–`5` Sterne, `6`–`9` Labels rot/gelb/grün/blau, `P` ausgewählt,
  `X` abgelehnt, `U` Markierung weg, `Enter` Lupe, `E` Editor, `C`
  Vergleich. Option „nach Bewertung automatisch weiter" in der Lupe.
- Jede Taste hat einen sichtbaren Button-Weg (Kachel-Menü, Lupen-Leiste).
- Cheatsheet bekommt einen Abschnitt „Bibliothek".

## Tests

- Backend: Thumbnail-Upload (Größe, kein JPEG, fremdes Bild, Re-Encode ohne
  EXIF, Ersetzen löscht alte Keys, Rate-Limit), Löschen räumt auf, Backfill
  idempotent; PATCH einzeln/Batch (Grenzen, fremde IDs, CHECKs); Filter und
  Sortierung; Export enthält Felder.
- Frontend: Thumbnail-Erzeugung als reine Funktion (Größe, Seitenverhältnis),
  Upload-Hook-Drosselung; Raster-Komponente (Tasten, Roving-Tabindex,
  Ansage, Abschalten der Einzeltasten); Lupe (Blättern, Esc, Fokus zurück).
- E2E: Upload JPEG → Kachel mit Bild; Sterne per Taste setzen → nach Reload
  noch da; Filter `minRating`; Lupe öffnen/blättern.

## Offen für den Builder

- Ob libraw-wasm eingebettete Vorschauen liefert (sonst Platzhalter).
- Exaktes Kachel-Layout; an bestehendes Design (stone/amber) anlehnen,
  `frontend-design`-Skill nutzen.

## Umsetzung H2a (2026-11-11)

- **libraw-wasm 1.6.0 liefert eingebettete Vorschauen**: `thumbnailData()`
  → `{data, width, height, format: "jpeg"|"bitmap"|"unknown"}`, ohne
  Demosaicing. Gedreht wird nach LibRaw-`flip` (EXIF des eingebetteten
  JPEGs wird ignoriert). Ohne Vorschau → Platzhalter.
- Migration heißt `013_h2a_thumbnails` und enthält nur `thumb_key`/
  `preview_key`; die H2b-Spalten kommen in Migration 014 (Abweichung von
  „Migration 013 zusätzlich" oben).
- Upload nur für bestätigte Bilder (sonst 409); Formate JPEG/PNG (TIFF/
  andere → 415, unlesbar → 422); Grenze 1 000 000 Bytes, damit sie unter
  dem globalen 1-MiB-Body-Limit inkl. Multipart-Overhead greift.
- Editor: Vorschau aus der Live-Textur (max. 1600 px breit) per
  `Canvas.renderThumbnail` — kein zweiter WebGL-Context. Zusätzlich zum
  Autosave-Auslöser bekommt jedes aus der Bibliothek geöffnete Bild beim
  Verlassen genau einen Upload (RAW-/TIFF-Bestand). Bei `pagehide`
  (Tab schließen) geht nichts raus: `keepalive` ist auf 64 KB begrenzt.
- `/me/export`: unverändert. Vorschaubilder sind metadatenfreie
  Ableitungen der Originale, die der Export bereits per Download-URL
  enthält; der Bearbeitungsstand ist ebenfalls enthalten.
- `GET /images` signiert bis zu 1000 URLs pro 500er-Seite: lokal, gemessen
  ~0.18 ms pro URL (~180 ms CPU pro voller Seite). Falls das stört:
  eigenes SigV4-Query-Signing statt botocore (Backlog).

## Umsetzung H2b (2026-11-11)

- **Migration `014_h2b_ratings`**: `rating smallint not null default 0`
  (CHECK 0..5), `color_label text null` (CHECK rot/gelb/grün/blau/lila als
  `red|yellow|green|blue|purple`), `flag text not null default 'none'`
  (CHECK `none|pick|reject`), Index `ix_images_user_rating (user_id, rating)`.
- **PATCH-Semantik**: nur gesendete Felder ändern sich; `colorLabel: null`
  löscht das Label, `rating`/`flag: null` → 422; leerer Body → 422.
  Einzeln 120/min (wie Autosave, schnelles Durchklicken), Batch 30/min.
  Batch: `ids` 1..500, eindeutig (sonst 422); Zeilen werden mit
  `FOR UPDATE` geladen, fehlt auch nur eine (fremd/unbekannt) → 404 ohne
  Änderung. Antwort = `ImageOut[]` in der Reihenfolge der `ids`.
- **Sortierung**: `created_desc` (Default), `created_asc`, `rating_desc`
  (Zweitschlüssel `created_at desc`), `name_asc`; immer `id` als letzter
  Tiebreaker. Die alten Werte (`-created_at`, `original_filename`, …)
  bleiben gültig. `minRating=0` filtert nicht. Unbekannte Werte → 422.
- **Gefiltert wird nur beim Laden**: ändert man die Bewertung eines Bildes
  so, dass es nicht mehr zum Filter passt, bleibt die Kachel bis zum
  nächsten Laden stehen (kein Wegspringen unter dem Cursor, Lightroom-nah).
- **Auswahl ⊆ Sichtbares**: nach jedem Laden wird die Checkbox-Auswahl auf
  die sichtbaren Bilder beschnitten, damit Batch-Aktionen (Sterne, Preset,
  …) keine weggefilterten Bilder treffen.
- **Optimistisch mit Rollback**: Rollback-Ziel ist der letzte vom Server
  bestätigte Stand pro Bild; eine ältere Antwort/ein älterer Fehler
  überschreibt keine neuere Änderung desselben Bildes.
- **Kachel**: Bild unbeschnitten (`object-contain`) auf dunklem
  Passepartout 4:3 — Hoch-/Querformat bleiben beim Sichten erkennbar.
  Farblabel als Leiste am unteren Bildrand plus Punkt im Bedienfeld,
  „abgelehnt" dunkelt das Bild ab (Graustufen, 35 %). Sterne: erneuter
  Klick auf den aktuellen Stern setzt auf 0.
- **Tastatur**: Raster = ein Tab-Stopp (Roving-Tabindex auf der Kachel,
  `role=group` mit Name „Datei, n Sterne, Label X, Ausgewählt"). Pfeile,
  Pos1/Ende bewegen; Leertaste schaltet die Auswahl. Bedienelemente nicht
  aktiver Kacheln haben `tabindex=-1` (per Maus/Touch erreichbar). Spalten
  werden aus dem Layout gelesen (`offsetTop`). H2c hängt Einzeltasten über
  `LibraryGrid.onTileKey` an — der Handler sieht nur Tasten direkt auf der
  Kachel, nicht in deren Buttons.
- **Ansicht gemerkt** in `localStorage.lumen.library.view` mit Modul-Cache
  (`library/viewPrefs.ts`, Muster wie `consent.ts`).
- **testids**: Aktionen (`image-select-*`, `image-edit-*`, `image-delete-*`,
  `image-thumb-*`) sind in beiden Ansichten gleich (immer nur eine
  gerendert); neu sind `image-grid`, `image-tile-*`, `tile-<id>-star-N`,
  `-pick`, `-reject`, `-label`, `-label-<farbe>`, `-label-none`, Zeilen
  `row-<id>-…`, Mehrfachauswahl `batch-…`, Filter `filter-*`,
  `library-view-grid|list`, `library-filter-empty(-reset)`,
  `library-announce`.
- **Nicht in H2b**: Filter „ohne Label", Filter-Zustand in der URL,
  Lupe/Vergleich/Einzeltasten (H2c).

## Umsetzung H2c (2026-11-11)

- **Lupe als Overlay, keine Route**: `library/Loupe.tsx` im geteilten
  `Modal` (role=dialog, aria-modal, Fokus-Falle, Esc). Blättert in genau der
  Liste, die die Bibliothek gerade zeigt (Filter + Sortierung; die Liste
  springt bei Bewertungsänderungen nicht, siehe H2b). Rand = Ende, kein
  Umlauf; die Vor-/Zurück-Buttons sind am Rand `aria-disabled` statt
  `disabled`, damit der Fokus nicht ins Leere fällt. Wischen ab 50 px
  horizontal. Nachbar-Vorschauen per `new Image()` vorgeladen.
- **Fokus beim Schließen**: auf die Kachel des zuletzt gezeigten Bildes
  (nicht des Startbildes) — Raster `image-tile-<id>`, Liste
  `image-loupe-<id>`. Die Kachel wird dadurch auch Roving-Tabindex-aktiv.
- **Bild**: `previewUrl` (1600 px), sonst `thumbUrl`, sonst Hinweistext
  „Noch keine Vorschau – öffne das Bild einmal im Editor …". Abgelehnte
  Bilder werden in der Lupe nicht abgedunkelt (der gedrückte Ablehnen-Button
  zeigt den Zustand).
- **Auto-Weiter** („Nach Bewertung automatisch weiter", Default aus,
  `localStorage.lumen.library.autoAdvance` mit Modul-Cache in
  `viewPrefs.ts`): greift nach jeder Sterne-/Label-/Markierungs-Änderung in
  der Lupe — per Taste und per Button —, am letzten Bild nicht. Ansage in
  einem Satz: „Als ausgewählt markiert – weiter: b.nef, Bild 2 von 3".
- **Tasten**: `library/libraryKeys.ts` (reine Funktion). Alle
  Zeichen-Tasten **und Enter** nur bei aktiven Einzeltasten-Kürzeln (wie in
  der Aufgabe festgelegt; ohne sie öffnet der Button „Lupe" auf der Kachel
  bzw. in der Zeile). Pfeil links/rechts in der Lupe sind keine
  Zeichen-Kürzel (WCAG 2.1.4) und laufen immer. Gesperrt in Text-/Select-
  Feldern und solange ein Menü offen ist (`data-popup-open`). `?` öffnet
  zusätzlich die Hilfe. `Lila` hat keine Taste (Lightroom: 6–9).
- **Button-Wege**: Kachel/Zeile „Lupe" (`image-loupe-<id>`), Leiste in der
  Lupe (`loupe-star-N`, `-star-0`, `-pick`, `-reject`, `-unflag`, `-label`,
  `loupe-edit`, `loupe-auto-advance`, `loupe-prev|next|close`,
  `loupe-position`), „Vergleichen" (`compare-open`, nur bei genau zwei
  ausgewählten Bildern aktiv), „? Tastenkürzel" (`library-shortcuts-open`).
- **Vergleich**: `library/CompareView.tsx`, Bilder in Anzeige-Reihenfolge
  (nicht Klick-Reihenfolge), je eigene Sterne/Markierung/Label/„Bearbeiten"
  (`compare-<id>-…`). Keine Einzeltasten im Vergleich (zwei Bilder = unklar,
  welches gemeint ist); `C` im Raster mit falscher Auswahl sagt
  „Zum Vergleichen genau zwei Bilder auswählen" an.
- **Ansage**: Die vorhandene `library-announce`-Region wird während Lupe/
  Vergleich im Dialog gerendert (Screenreader dürfen Inhalte außerhalb von
  aria-modal ignorieren) und danach wieder auf der Seite — immer genau eine.
- **Cheatsheet**: `ShortcutCheatsheet` bekommt `context="library"`
  (Abschnitt „Bibliothek" zuerst, `fixed` statt `absolute`); im Editor
  steht der Abschnitt am Ende, sonst unverändert.
- **Nicht in H2c**: Zoom 1:1 in der Lupe, Einzeltasten in der
  Listenansicht (Zeilen sind keine Fokus-Ziele; Buttons reichen).

