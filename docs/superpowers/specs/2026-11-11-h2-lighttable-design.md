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
