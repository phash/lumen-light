# Pipeline-Smoke-Test (manuell, im Browser)

Verifikation der vollständigen Bildverarbeitungs-Pipeline gegen einen echten Test-Korpus. Diese Smoke-Tests sind **manuell**, weil weder Vitest+jsdom noch Node ohne Polyfill den WebGL2-Renderer + libraw-wasm-Worker fahren kann. Eine Playwright-Variante folgt in einer eigenen Iteration.

## Voraussetzungen

```bash
# 1. Test-Korpus ziehen (~150 MB, eintimes)
bash scripts/fetch-test-images.sh

# 2. Lokalen Stack hochfahren
docker compose -f deployment/docker-compose.dev.yml up -d
cd backend && cp ../deployment/.env.example .env  # Werte für dev anpassen
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 &
cd ../frontend && cp .env.example .env.local
npm run dev
```

Browser auf `http://localhost:5173`, einloggen via Keycloak (`admin/admin`-User auf http://localhost:18080 vorab anlegen oder den Test-User aus dem Iteration-6-Smoke wiederverwenden).

## Test-Matrix

Korpus liegt in `tests-fixtures/raw-samples/`. Pro Sample folgendes durchspielen:

| Sample | Erwartetes Verhalten |
|---|---|
| `Canon_EOS_600D.CR2` | „RAW wird dekodiert …", dann Bild auf Canvas, Camera-Info „Canon … 600D" oben rechts |
| `Canon_EOS_R.CR3` | dito, Camera-Info „Canon EOS R" |
| `Sony_A7M3.ARW` | dito, Camera-Info „Sony … ILCE-7M3" |
| `Nikon_D7100.NEF` | dito, Camera-Info „Nikon D7100" |
| `Fujifilm_X-Pro1.RAF` | dito, Camera-Info „Fujifilm X-Pro1" |
| `Olympus_E-M5.ORF` | dito, Camera-Info „Olympus E-M5" |
| `Panasonic_DC-G9.RW2` | dito, Camera-Info „Panasonic DC-G9" |
| Beliebige JPG/PNG | Direkt auf Canvas, ohne Decoding-Indicator |

## Pro Sample der Reihe nach

1. **Öffnen** — Drag&Drop oder „Datei wählen"
   - Bei RAW: Decoding-Indicator erscheint, verschwindet nach Sekunden
   - Bei Fehler (z. B. CR3 mit unbekannter Kamera-Variante): Error-Banner mit libraw-Message, Issue notieren

2. **Bearbeiten** — Slider in jeder Gruppe einmal anfassen:
   - Belichtung ±2 EV
   - Kontrast ±0.5
   - Sättigung ±0.5
   - Weißabgleich Temperatur ±0.3
   
   Erwartung: Live-Vorschau folgt jedem Slider, Histogramm aktualisiert sich, Vorher/Nachher-Toggle (Halten linker Maustaste auf „Halten für Original" oder `\`-Taste) zeigt das Original.

3. **Reset** — `0`-Taste oder Reset-Button → alle Slider auf 0.

4. **Export** — pro Sample einmal:
   - JPEG @ Quality 92, native Vorschau-Breite
   - JPEG @ Quality 60, 1024 px
   - PNG @ 2048 px
   - WebP @ 512 px
   
   Erwartung: Browser-Download startet, Datei öffnet in einem externen Viewer, Inhalt entspricht der Live-Vorschau.

5. **Verifikation Output** (im Terminal):
   ```bash
   file ~/Downloads/<exportierter-name>
   identify ~/Downloads/<exportierter-name>   # ImageMagick: prüft Format, Größe, Farbtiefe
   ```

## Bekannte Limits / offene Fragen

- **CR3-Stabilität:** libraw-wasm 1.1.2 enthält eine ältere libraw-Version. Aktuelle Sony-YCC-Compression und einige R5 Mark II-Varianten sind in libraw 0.22 fixed (Jan 2026), aber noch nicht im npm-Paket. Bei Decoding-Fehler eines CR3: Issue + Plan B (server-side libraw-Python) erwägen — siehe ADR-002.
- **Voll-Auflösung-Export:** aktuell wird die Live-Vorschau-Auflösung (max 1600 px Breite) exportiert. Original-Auflösung-Export braucht Renderer-FBO + Texture-Re-Upload — eigene Iteration.
- **TIFF-Export:** Browser-`canvas.toBlob` unterstützt kein TIFF. Wenn TIFF gewünscht: `utif`/`UPNG` einbinden — eigene Iteration.

## Auswertung

| ✓ | Sample | Decoding | Slider | Export JPG | Export PNG | Export WebP | Notizen |
|---|---|---|---|---|---|---|---|
| | Canon_EOS_600D.CR2 | | | | | | |
| | Canon_EOS_R.CR3 | | | | | | |
| | Sony_A7M3.ARW | | | | | | |
| | Nikon_D7100.NEF | | | | | | |
| | Fujifilm_X-Pro1.RAF | | | | | | |
| | Olympus_E-M5.ORF | | | | | | |
| | Panasonic_DC-G9.RW2 | | | | | | |
| | beliebige JPG | n/a | | | | | |
| | beliebige PNG | n/a | | | | | |

## Was die automatischen Tests bereits abdecken

| Test | Was | Wo |
|---|---|---|
| `tests/raw-corpus.test.ts` | `detectRawFormat` gegen 7 echte RAWs (CR2, CR3, ARW, NEF, RAF, ORF, RW2) | Vitest |
| `tests/export-roundtrip.test.ts` | Magic-Bytes von JPEG/PNG/WebP-Output | Vitest |
| `tests/export.test.ts` | Filename-Heuristik, Skalierung mit Mock-Canvas, Fehler-Pfade | Vitest |
| `tests/raw.test.ts` | Magic-Byte-Detection ohne echte Files | Vitest |
| `tests/Slider.test.tsx` | Drag, Doppelklick, Arrow-Keys, Bounds | Vitest |
| `tests/store.test.ts` | Zustand-Store-Reducer, applyAdjustments | Vitest |
| `tests/histogram.test.ts` | Bins-Berechnung gegen Referenz-Pixel | Vitest |
| `tests/useKeyboardShortcuts.test.tsx` | 0/`\\`/Cmd+E/Cmd+O Listener | Vitest |
| `tests/adjustments.test.ts` | Definitionen, format, clamp | Vitest |

In Summe **87 Vitest-Tests** plus **45 Backend-Tests** = 132 grüne Tests.
