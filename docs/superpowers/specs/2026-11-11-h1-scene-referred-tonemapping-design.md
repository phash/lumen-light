# H1 · Szenenbezogene Tonabbildung (Prozessversion 2)

Stand: 2026-11-11 · Roadmap: `docs/06-roadmap.md`, Phase H, Item H1.
Herkunft: darktable-Recherche (sigmoid/filmic/AgX). darktable ist GPL-3.0 —
nur Ideen und veröffentlichte Mathematik, kein Code.

Manuel hat die Rückfragen übersprungen („leg los"). Alle Entscheidungen
unten sind meine Annahmen und als solche markiert, wo es nicht offensichtlich
ist.

## Intent

Heute rechnet der Shader Weißabgleich und Belichtung linear, wandelt dann
nach sRGB, klemmt bei 2.0 und macht Lichter/Tiefen/Weiß/Schwarz und Kontrast
additiv im Display-Raum. Folgen:

- Belichtung hoch: Lichter clippen hart, gesättigte Farben kippen in
  Richtung Gelb/Cyan (per-Kanal-Clip).
- Lichter runter wirkt als grauer Schleier statt als Kompression.
- Kontrast um 0.5 schneidet Tiefen und Lichter ab.

Ziel: Lightroom-artiges Verhalten. Tonarbeit auf linearem Licht, erst am
Ende eine weiche Schulter zum Bildschirm. Helle Bereiche laufen sanft nach
Weiß, Farbton bleibt stabil.

## Ehrliche Grenze

Die Quelltextur ist 8-bit sRGB (`raw.ts`: `output_bps: 8`,
`webgl.ts`: `UNSIGNED_BYTE`). Echter Headroom über Sensor-Weiß existiert
also nicht. Der Gewinn kommt aus:

1. Werten > 1, die durch Belichtung/Weiß/Lichter nach oben entstehen —
   heute geclippt, künftig komprimiert.
2. farbtonerhaltender Tonarbeit (Luminanz-/Norm-Verhältnis statt
   Per-Kanal-Addition).

16-bit-Dekodierung in eine Float-Textur (RGBA16F) ist **nicht** Teil von H1
(Follow-up H1b: GPU-Speicher ×2 bei 24 MP ≈ 190 MB, auf Mobile kritisch).

## Goals

- Neue Prozessversion 2 (PV2) im Fragment-Shader, Umschaltung per Uniform.
- PV1 bleibt bitgleich erhalten. Kein bestehender Edit und kein bestehendes
  Preset ändert sein Aussehen.
- Neue Bilder und „Zurücksetzen" starten auf PV2.
- Sichtbare, rückgängig machbare Aktion „Auf Version 2 aktualisieren" für
  PV1-Bearbeitungen (Vorbild: Lightroom „Process Version").
- Export, Histogramm, Compare-Split und Masken folgen automatisch (gleicher
  Renderer).

## Non-Goals

- 16-bit/Float-Pipeline (H1b).
- Neue Regler für Sigmoid-Parameter (Kontrast-Schulter, Skew, Primaries).
  Die bestehenden Regler steuern PV2.
- Volle AgX-Implementierung mit Inset/Outset-Primaries.
- Neu-Tuning der 20 Default-Presets. Sie haben kein Feld und bleiben PV1.
- Automatische Massen-Migration bestehender Edits.

## Anti-Goals (wäre ein Fehlschlag, auch wenn es technisch läuft)

- Ein bestehendes Bild oder Preset sieht nach dem Deploy anders aus.
- PV2 bei Default-Reglern sieht deutlich anders aus als PV1 (flau, grau,
  dunkler). Ein unbearbeitetes Foto muss gleich wirken.
- Frame-Zeit im Editor steigt messbar (> 10 %) gegenüber PV1.

## Datenmodell (meine Entscheidung)

- Neues Feld `processVersion` in `Adjustments` (Frontend-Typ, Backend-
  Pydantic `Literal[1, 2]`, `backend/schemas/adjustments.schema.json`).
- **Fehlt das Feld beim Lesen, gilt 1.** Das gilt für Backend-Default,
  Frontend-Parser (Edit-State, Presets, YAML-Profile, Marketplace).
- `defaultAdjustments()` liefert 2 — neue Bilder und „Alles zurücksetzen"
  landen auf PV2.
- Kein Alembic-Schritt: Adjustments liegen als JSONB vor.
- `processVersion` gehört zur Gruppe `tone` in `edit-groups.json`. Wer ein
  Preset mit Ton-Gruppe anwendet, übernimmt dessen Version (damit das Preset
  so aussieht, wie der Ersteller es sah). Ohne Ton-Gruppe bleibt die
  Version des Bildes.
- YAML-Profil-Format bleibt `lumenProfile: 1`; Feld optional.

## Pipeline PV2 (Shader)

Reihenfolge, PV1-Block bleibt unverändert im `else`-Zweig:

1. sRGB → linear (wie heute), Weißabgleich, Belichtung `2^EV` (wie heute,
   inkl. lokaler Masken-Anteile). **Kein** Clamp nach oben.
2. Tonbereiche als Belichtungs-Gains im Log-Raum:
   `ev = log2(max(Y, eps) / 0.18)`; weiche Masken über `ev` für Tiefen,
   Lichter, Schwarz, Weiß; Ergebnis als Faktor `2^(Σ slider·gain·mask)` auf
   alle drei Kanäle (Verhältnis bleibt → Farbton bleibt).
3. Kontrast im Log-Raum um Mittelgrau 0.18 (Pivot), statt um 0.5 im
   Display-Raum. Keine harte Begrenzung.
4. Display-Transform: Schulter-Kurve auf eine Farbnorm (Vorschlag:
   `max(r,g,b)`), angewandt als `rgb · f(n)/n`, plus Entsättigung Richtung
   Weiß, je näher `f(n)` an 1 kommt („path to white"). Ergebnis in [0,1].
5. linear → sRGB, danach unverändert: Sättigung/Dynamik, HSL, Tonkurve,
   Highlight-Recovery, Schärfe, Klarheit, Vignette.

Abnahmekriterien für `f` (Formel ist Sache des Builders; darktable-Sigmoid
oder eine Reinhard-artige Schulter mit Knie sind beide okay):

- monoton steigend, `f(0)=0`, asymptotisch ≤ 1.
- unterhalb Knie (Vorschlag: linear 0.6) praktisch Identität, damit PV2 bei
  Default-Reglern wie PV1 aussieht: auf einer Graustufen-Rampe 0..1 und auf
  den Test-Fixtures mittlere Abweichung < 0.02, max < 0.06 (sRGB 0..1).
- Eingang 1.0 (Sensor-Weiß, EV 0) landet ≥ 0.97 — Weiß bleibt Weiß.
- Eingang 8.0 (+3 EV) landet < 1.0 und unterscheidet sich von 4.0
  (Zeichnung bleibt).
- Farbton eines gesättigten Rots bleibt bei +3 EV innerhalb ±3° (HSV-Hue),
  läuft aber in der Sättigung Richtung Weiß.

Konstanten (Knie, Gains, Pivot) leben als TS-Konstanten in einem neuen Modul
(`frontend/src/editor/tonemap.ts`) **und** als GLSL-Literale; der
bestehende Sync-Test (`frontend/tests/shader-limits-sync.test.ts`) bekommt
sie dazu. `tonemap.ts` enthält zusätzlich eine reine TS-Referenz der PV2-
Tonmathematik (Muster wie `autoStraighten.ts`), gegen die die Unit-Tests
laufen.

## UI (meine Entscheidung)

- Sidebar, Abschnitt „Belichtung & Ton": bei PV1 eine Zeile „Bearbeitet mit
  Prozessversion 1" + Button „Auf Version 2 aktualisieren"
  (`data-testid="process-version-upgrade"`). Klick setzt nur das Feld, ist
  ein Undo-Schritt, Regler bleiben.
- Bei PV2 nichts Zusätzliches (kein Rauschen im UI).
- Cheatsheet/Onboarding unverändert.

## Auto-Ton / Smart-Suggestion

`autoAdjust.ts` und `suggestPreset.ts` liefern Reglerwerte, die für PV1
getunt sind. Builder prüft auf den Test-Fixtures, dass Auto-Ton unter PV2
nicht sichtbar übersteuert (gleiche Kriterien wie oben: kein Clipping,
Mitteltöne ±0.05). Falls doch: PV2-spezifische Skalierung im Auto-Ton,
nicht in den Reglern.

## Tests

- Backend: fehlendes Feld → 1; `2` gültig; `3` → 422; Preset-Roundtrip;
  Edit-State-Roundtrip; `merge_edit_state` mit/ohne Ton-Gruppe.
- Frontend Unit: `tonemap.ts`-Referenz gegen alle Abnahmekriterien;
  Parser-Default 1; `defaultAdjustments().processVersion === 2`;
  `mergeGroups` übernimmt Version nur mit Ton-Gruppe; YAML-Roundtrip.
- Sync-Test: neue GLSL-Konstanten, `u_processVersion` vorhanden, PV1-Block
  textgleich zum heutigen (Snapshot des Code-Abschnitts).
- Component: Upgrade-Button nur bei PV1 sichtbar, setzt Version, Undo
  stellt PV1 wieder her.
- E2E: bestehende Editor-Specs grün; ein neuer Check, dass ein frisch
  geladenes Bild PV2 speichert (`PUT /images/{id}/edit` Body).

## Offen für den Builder

- Exakte Form von `f` und Gains der Tonbereich-Masken im Log-Raum.
- Ob Highlight-Recovery in PV2 vor den Display-Transform wandert (würde
  physikalisch besser passen). Nur wenn die Abnahmekriterien halten.
