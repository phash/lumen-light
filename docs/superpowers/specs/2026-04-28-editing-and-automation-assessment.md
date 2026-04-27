# Bewertung Bildbearbeitung + Automatismen

**Datum:** 2026-04-28
**Iteration:** Phase-5-Erweiterung (Genre-Presets + Auto-Tools + UX-Polish)

## Ziel

Lumen soll Hobbyfotografen ermoeglichen, **schnell** zu **guten,
nachvollziehbaren Ergebnissen** zu kommen — auch ohne Vorwissen ueber
Belichtung, Kontrast oder Farbtemperatur. Dieser Spec inventarisiert
den Ist-Stand, identifiziert Luecken und schlaegt sechs konkrete
Automatismen plus die genre-spezifischen Default-Presets vor, die in
Iteration 20+ ausgeliefert werden.

## Ist-Stand

### Manuelle Bearbeitung (vollstaendig)

| Bereich | Tools |
|---|---|
| Geometrie | Crop (Free/1:1/3:2/4:3/16:9), Begradigen (±10°), Reset |
| Objektiv | Distortion (-1..+1), Vignette (-1..+1), 18 Auto-Profile |
| Globale Tonwerte | Belichtung (-5..+5 EV), Kontrast, Lichter, Tiefen, Weiss, Schwarz |
| Globale Farbe | Temperatur, Toenung, Vibrance, Saettigung |
| Lokale Anpassungen | bis 4× Linear- + 4× Radial-Maske, je 4 Local-Adjustments |
| Weissabgleich | Eyedropper-Picker, klick auf neutralen Bildbereich |
| Geometrie-Viewport | Zoom (Mausrad, 0.1×-10×) + Pan (Drag) |
| Persistenz | Preset speichern/laden/aktualisieren mit Masken |

### Automatismen (vorhanden)

- **Lens-Profil-Auto-Detection** auf Basis Camera-Make + Model + Focal-Length (`findLensProfile`).
- **Weissabgleich-Picker** (manueller Klick, aber nur **ein** Klick noetig).

### Was fehlt fuer „nachvollziehbar gute Ergebnisse"

| Luecke | Auswirkung |
|---|---|
| Kein **Auto-Tone** | User mit unterbelichtetem RAW sieht eine flaue Vorschau, weiss nicht wo er anfangen soll. |
| Kein **Auto-WB** ohne manuellen Klick | Wenn der User keinen sicher-neutralen Punkt im Bild hat, bleibt der WB schief. |
| Keine **Smart-Preset-Suggestion** | Genre-Presets wirken nur, wenn der User sie aktiv waehlt. |
| Keine **HSL-Farbmischer** (Hue/Saturation/Luminance pro Farbkanal) | Hauttoene faerben, Himmel verstaerken, Gruen kuehlen — nicht moeglich. |
| Keine **Tonkurve** | Mid-Kontrast-Justage nur indirekt ueber 4 Tonwertbereich-Slider. |
| Keine **Sharpening / Noise-Reduction** | Standard-RAW-Workflow-Schritt fehlt. |
| Kein **Auto-Crop / Auto-Straighten** | Schiefer Horizont = manuelle Arbeit. |
| Keine **Vorher/Nachher-Compare** ausser Bypass-Druck-Halt | Schwierig zu beurteilen, was eigentlich passiert ist. |
| Keine **History / Undo** | Experimentieren ist riskant — Rueckkehr nur ueber Reset. |

## Genre-Default-Presets (umgesetzt 2026-04-28)

Sechs neue Presets in `backend/app/auth.py::_DEFAULT_PRESETS`. Werte
moderat, sollen den Bild-Charakter unterstreichen, nicht uebertreiben:

| Preset | Charakter | Schwerpunkt |
|---|---|---|
| **Portrait** | weich-warm | Lichter zaehmen (-0.20), Schatten oeffnen (+0.20), Vibrance (+0.20), Temperatur (+0.05) |
| **Landschaft** | dramatisch | Kontrast (+0.25), Highlights (-0.35), Shadows (+0.30), Vibrance (+0.40) |
| **Stadt** | gritty | Kontrast (+0.30), Schwarz (-0.15), leichter Kuehl-Touch |
| **Natur** | gruen-blau-pop | Shadows (+0.25), Vibrance (+0.45) |
| **Tiere** | balanciert | Mid-Kontrast (+0.20), Vibrance (+0.25), leicht warm |
| **Sport** | dynamisch | Kontrast (+0.35), Schwarz (-0.20), Vibrance (+0.30) |

Verfuegbar als JIT-Default fuer neue User. Bestehende User koennen sie
ueber den Preset-Dialog manuell anlegen — alternative
Migration-Strategie siehe „Plan unten".

## Vorgeschlagene Automatismen

### 1. Auto-Tone (Phase A)

**Algorithmus:**
1. Histogramm aus Canvas lesen (existiert: `Histogram.tsx`).
2. Black-Point: 0.5%-Quantil der Luminanzverteilung -> auf 0 setzen via
   `blacks`-Slider.
3. White-Point: 99.5%-Quantil -> auf 1 setzen via `whites`-Slider.
4. Mid-Tone: wenn Median < 0.4 -> `exposure +0.5..1.0`; wenn > 0.6 ->
   `exposure -0.3..-0.7`.
5. Kontrast leicht erhoehen (+0.10), wenn Histogramm sehr eng.

**UX:** Button „Auto" neben „Halten fuer Original". Setzt 4 Slider in
einem Schritt. Reset-bar via Cmd+Z (sobald Undo da ist).

**Effekt:** Flaue Out-of-Camera-RAWs werden in einem Klick „normal"
belichtet — wichtigster Hebel fuer Anfaenger.

### 2. Auto-Weissabgleich (Phase A)

**Algorithmus:** Gray-World-Annahme — Mittelwert aller Pixel ist neutral.
Berechne `mean(R), mean(G), mean(B)` aus dem aktuellen Canvas, leite
Temp/Tint-Korrekturen ab (gleicher Code wie der manuelle Picker, aber
ueber gesamtes Bild gemittelt).

**UX:** Button „Auto-WB" neben dem manuellen Picker. Zwei Klicks: einer
fuer „Ich klicke einen neutralen Punkt", einer fuer „Errate selbst".

### 3. Smart-Preset-Suggestion (Phase B)

**Trigger:** beim Image-Load, wenn EXIF Brennweite + Kameraprofil hat.
- Brennweite < 35mm + viel Gruen/Blau im Histogramm -> Vorschlag „Landschaft"
- Brennweite 50-85mm + Gesicht im Bild (faces sind Phase C) -> „Portrait"
- Brennweite > 200mm -> „Sport" oder „Tiere"
- Sonst kein Vorschlag.

**UX:** Dezenter Hint oben im Editor: „Sieht aus wie Landschaft —
Preset anwenden?" mit Klick zum Aktivieren, X zum Wegklicken.

### 4. Auto-Straighten (Phase B)

**Algorithmus:** Hough-Transform auf das Graustufenbild,
dominante Linien finden (Canny-Edges), Median-Winkel = Kippung. In
JS via opencv.js oder selbst implementiert.

**UX:** Im Crop-Mode Button „Horizont begradigen" — setzt nur den
Begradigen-Slider, ohne Crop-Rect anzufassen.

### 5. Vorher/Nachher-Split (Phase A)

Aktueller Bypass: Buttons „Halten" zeigt Original. Add: vertikalen
Split-Cursor. Drag bewegt Vergleichs-Linie. Macht Aenderungen
nachvollziehbar.

### 6. History / Undo (Phase A — UX-BLOCKER!)

**Algorithmus:** Zustand-Store-Snapshot bei jeder Slider-Aenderung
(debounced 200ms). History begrenzt auf 50 Eintraege. Cmd+Z / Cmd+Shift+Z.

**UX:** Tastenkuerzel + zwei Pfeil-Buttons in der Toolbar.

## Plan zur Umsetzung

### Phase A — UX-Foundations + Basis-Automatismen (high impact)

1. **Undo/Redo + History-Stack** — UX-Blocker laut Review.
2. **Auto-Tone-Button** — flau-aussehende RAWs sofort retten.
3. **Auto-WB-Button** (Gray-World) zusaetzlich zum manuellen Picker.
4. **Vorher/Nachher-Split** mit Drag-Bar.
5. **Tastenkuerzel-Cheatsheet** (`?`-Overlay).
6. **Tooltips + bessere Button-Labels** (z.B. „Halten" als Icon mit
   `title=`).
7. **Sidebar-Umordnung**: Histogramm + Licht + Farbe oben, Geometrie +
   Objektiv collapsable Akkordeons.
8. **Slider-Konsistenz**: onDoubleClick auf alle Slider inkl. Feather.

### Phase B — Smarte Vorschlaege + Demo-Erlebnis

9. **Smart-Preset-Suggestion** mit EXIF-Heuristik.
10. **Beispielbild-Button** auf der Landing- und Editor-Empty-Page.
11. **Auto-Straighten** im Crop-Mode.
12. **Bestehende User auf Genre-Presets aktualisieren** (Migration via
    `POST /api/v1/me/sync-default-presets` Endpoint, idempotent).
13. **Echte Landing-Page** mit Hero + Vorher/Nachher.

### Phase C — Tiefere Bearbeitung

14. **HSL-Farbmischer** (8 Farbkanaele × 3 Achsen).
15. **Tonkurve** (interaktive Spline).
16. **Sharpening + Noise-Reduction** (in der RAW-Pipeline).
17. **Face-Detection** fuer praeziseres Smart-Preset (Phase C, evtl.
    via TensorFlow.js Face-API).

### Phase D — Compliance + Polish (siehe Security/DSGVO-Reviews)

18. **DELETE /me + Datenexport** — DSGVO-Pflicht fuer Public-Launch.
19. **JWT-alg-Whitelist + python-jose -> pyjwt** — kritischer
    Security-Fix.
20. **Pre-Signed PUT mit Content-Length-Range** — DoS-Mitigation.
21. **Datenschutzerklaerung + Impressum**.
22. **EXIF-Strip-Option** beim Upload.

## Akzeptanzkriterien fuer „gute Ergebnisse"

Eine fuer Hobbyfotografen funktionierende App schafft, dass:

1. **Flaue RAW + 1 Klick „Auto" = sichtbar besser** (subjektiv „pop"-Effekt).
2. **Ein passender Preset wird vom System vorgeschlagen** in >70% der
   Faelle (basierend auf Brennweite + simpler Histogramm-Heuristik).
3. **Undo funktioniert nach 30 Slider-Edits**.
4. **Vorher/Nachher zeigt klar, was die Aenderungen gebracht haben**.
5. **Kein Hauptanwendungsfall braucht mehr als 5 Klicks**:
   Bild laden -> Auto -> Preset waehlen (oder Preset wird vorgeschlagen) ->
   Crop wenn noetig -> Export.

## Naechste Schritte

Phase A ist der Implementierungs-Fokus der naechsten Iteration. Reviews
liefern parallel Security-, DSGVO- und Code-Findings, die in Phase D
gebuendelt abgearbeitet werden.
