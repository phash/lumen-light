# Beta-Onboarding · Lumen · light

Kurzer Quickstart fuer Beta-User, die zum ersten Mal Lumen nutzen.
**Diese Anleitung gilt fuer Endnutzer**, nicht fuer Selfhost-Betreiber —
Selfhosting-Schritte stehen im README und im `infra/deployment-runbook.md`.

## 1. Account anlegen

1. Auf der Startseite **Anmelden & starten** klicken.
2. Du landest im Keycloak-Login. **Registrieren** unten klicken.
3. E-Mail-Adresse, Passwort und Vor-/Nachname ausfuellen.
   - Die E-Mail wird automatisch zu deinem Benutzernamen.
   - Ohne Registrierungs-Bestaetigung: hier reicht das. (Production-Setups
     verlangen E-Mail-Verifizierung — folge dann dem Link in der Mail.)
4. Nach der Bestaetigung wirst du zurueck zu Lumen geleitet und siehst
   den Editor.

## 2. Dein erstes Bild

**Drag & Drop** ist der einfachste Weg: Bild aus dem Datei-Manager auf
die Drop-Zone in der Editor-Mitte ziehen.

Alternativ:
- **Datei waehlen** — Standard-Datei-Picker. Akzeptiert JPEG, PNG, RAW
  (CR2, CR3, NEF, ARW, DNG, RAF, RW2, ORF).
- **Beispielbild laden** — laed das mitgelieferte `sample.jpg` zum
  Ausprobieren.

Bei RAW-Dateien dauert das Dekodieren ~3–5 Sekunden (Embedded-JPEG-
Vorschau erscheint sofort, voller RAW-Decode laeuft im Hintergrund).

## 3. Schnell zum Ergebnis: die Auto-Funktionen

Die untere Toolbar hat drei „Auto"-Buttons:

- **Auto-Ton**: Belichtung, Kontrast, Weiss und Schwarz aus dem
  Histogramm gerechnet. Macht aus flauen Out-of-Camera-RAWs in einem
  Klick ein vorzeigbares Bild.
- **Auto-WB**: Weissabgleich nach „Robust-Average". Bei Mischlicht oder
  blau-getoenten Innenraum-Aufnahmen sehr nuetzlich.
- **Auto** neben dem Begradigen-Slider (in der Geometrie-Sektion):
  erkennt schiefe Horizonte und korrigiert sie.

Plus das **Smart-Preset-Banner**: bei manchen Bildern erscheint oben
ein Vorschlag wie „Sieht aus wie Portrait — Preset anwenden?" Ein Klick
laed das passende Genre-Preset.

## 4. Manuelle Anpassung

Die Sidebar hat (von oben nach unten):

1. **Histogramm** — live, zeigt Tonwertverteilung.
2. **Licht** (offen by default) — Belichtung, Kontrast, Lichter, Tiefen,
   Weiss, Schwarz.
3. **Farbe** (collapsed) — Temperatur, Toenung, Dynamik, Saettigung.
4. **Detail** (collapsed) — Schaerfen, Rauschen.
5. **Farben (HSL)** — fuer 8 Farbkanaele jeweils Hue/Saettigung/Luminanz
   einzeln einstellen. Power-Tool fuer Hauttoene oder Himmel-Verstaerkung.
6. **Tonkurve** — Spline-Editor mit 2–8 Punkten. Klick auf die Kurve
   fuegt einen Punkt hinzu, Doppelklick entfernt ihn.
7. **Geometrie** (collapsed) — Aspect-Ratio, Begradigen.
8. **Objektiv** (collapsed) — Verzeichnung und Vignettierung manuell;
   bei RAW mit erkanntem Profil automatisch gesetzt.

Tipps:
- **Tooltip** auf jedem Slider beim Hover — kurze Erklaerung in
  einfachem Deutsch.
- **Slider-Doppelklick** = Reset auf Default.
- **`Shift` + Pfeiltasten** = 10× groessere Schritte, sobald der Slider
  fokussiert ist.

## 5. Vergleich Vorher / Nachher

In der Toolbar:

- **Augen-Icon (Bypass)** — gedrueckt halten zeigt das Original. Beim
  Loslassen wieder die bearbeitete Version.
- **Vorher/Nachher** — Toggle: legt einen Split-Slider auf das Bild,
  links Vorher, rechts Nachher. Mit Drag bewegst du die Trennung.

## 6. Beschneiden

1. **Beschneiden** in der Toolbar klicken (Tastenkuerzel: `R`).
2. Das volle Bild bleibt sichtbar, ein gelbes Crop-Rechteck erscheint.
3. **Innen klicken und ziehen** verschiebt das Rechteck.
4. **Eck-Punkte ziehen** veraendert die Groesse.
5. **Aspect-Ratio** in der Geometrie-Sektion festlegen (1:1, 3:2, 4:3,
   16:9 oder Frei).
6. Erneut **Crop fertig** klicken: das Bild wird auf das Rechteck
   reduziert. Output ist pixelgenau (kein Stretchen).

## 7. Zoom & Pan

- **Mausrad** zoomt um den Cursor.
- **Klick + ziehen** im Bild verschiebt (Pan).
- **Touchscreen**: Pinch zum Zoomen, Ein-Finger-Drag fuer Pan.
- **Reset-View**-Button (zeigt den aktuellen Zoom-Prozentwert) setzt
  zurueck.

## 8. Presets

**Speichern**: rechts in der Toolbar **Presets** klicken (Tastenkuerzel:
`P`), Name eingeben, **Speichern**. Optional **Im Marketplace
veroeffentlichen** — dann musst du Genre, Beschreibung und ein
Vorschau-Bild aus deiner Bibliothek auswaehlen.

**Laden**: gleicher Dialog, in der Liste auf **Laden** klicken.

**Default-Presets**: bei deinem ersten Login werden 10 Presets
automatisch angelegt:
- *Neutral* — keine Korrekturen, Ausgangspunkt.
- *Punchy*, *Soft Mood*, *Schwarzweiss-Vorbereitung* — allgemeine Looks.
- 6 Genre-Presets: *Portrait*, *Landschaft*, *Stadt*, *Natur*, *Tiere*,
  *Sport*.

## 9. Marketplace

In der Hauptnavigation oder in der Editor-Toolbar:

- **Stoebern** mit Genre-Filter, Suche und Sortierung (neu/beliebt).
- **Anwenden** uebernimmt das Preset auf dein gerade geladenes Bild.
  Falls du gerade an einem Bild arbeitest, kommt eine Bestaetigung —
  damit du nichts versehentlich verlierst.
- **In meine Bibliothek kopieren** legt eine private Kopie an, die du
  weiter veraendern kannst.
- **Melden** mit kurzem Grund — bei drei Meldungen wird ein Preset
  automatisch zurueckgezogen.

## 10. Bibliothek (eigene Bilder)

Unter **Bibliothek** liegen alle Bilder, die du in den Editor geladen
hast. Du kannst sie loeschen oder erneut oeffnen.

Storage: alle Bilder liegen in deinem privaten S3-Bucket auf dem
Selfhost-Server. Sie werden niemals an Dritte weitergegeben.

## 11. Account & Datenschutz

Unter **Account**:

- **Smart-Preset-Vorschlag** mit Gesichtserkennung — opt-in. Aktivierst
  du den Toggle, laed dein Browser einmalig ein TF.js-Modell von
  Googles CDN (Drittlandtransfer USA). Die eigentliche Erkennung laeuft
  lokal; Bilder verlassen deinen Rechner nicht.
- **Profil** — Handle und Bio, die im Marketplace neben deinen
  veroeffentlichten Presets erscheinen. E-Mail bleibt immer privat.
- **Daten exportieren** — JSON-Export aller Daten (Profil, Presets,
  Bild-Metadaten mit kurzlebigen Download-URLs, abgegebene Reports).
  DSGVO Art. 15 + 20.
- **Account-Daten loeschen** — entfernt alle App-Daten unwiderruflich.
  Hinweis: der Keycloak-Account selbst bleibt; den schliesst du
  separat im Keycloak-Self-Service-UI deines Realms.

## 12. PWA

Die App laesst sich installieren — im Browser auf das Plus-Symbol in
der Adresszeile klicken (Chrome/Edge/Brave) oder „Zum Home-Bildschirm
hinzufuegen" (Safari iOS / Firefox Android). Lumen oeffnet dann ohne
Browser-Chrome. Offline funktioniert die Editor-Shell, sobald sie
einmal online geladen wurde — das Backend (Login, Presets,
Marketplace) braucht weiterhin Internet.

## 13. Hilfe & Tastenkuerzel

In der Editor-Toolbar das **?** klicken (oder `?` druecken) — zeigt
eine Liste aller Tastenkuerzel:

- `R` — Beschneiden umschalten
- `P` — Preset-Dialog
- `Cmd+Z` / `Cmd+Shift+Z` — Rueckgaengig / Wiederherstellen
- `Cmd+E` — Exportieren
- `0` — Alles zuruecksetzen
- `\` (Backslash) — Bypass halten zum Vorher-Anzeigen
- `?` — diese Liste

## Probleme melden

Bugs und Feature-Wuensche an den Selfhost-Betreiber (siehe Impressum)
oder im GitHub-Issue-Tracker, falls vorhanden. Mit dem Bug-Report bitte
Kameramodell, RAW-Format und Browser-Version mitschicken.
