# 08 · Risiken & offene Fragen

Liste der Punkte, die das Projekt zum Scheitern bringen oder verzögern können — und der Fragen, die vor Phase X beantwortet werden müssen.

## Hohe Risiken

### R1 · libraw-wasm-Reife unbekannt

**Risiko:** libraw-wasm könnte bei bestimmten Kameras crashen, falsche Farben liefern oder zu langsam sein. Es gibt mehrere Forks und keinen offensichtlichen Maintenance-Standard.

**Auswirkung:** Phase 3 (RAW-Decoding) verzögert sich um 2–4 Wochen oder erfordert Wechsel auf Server-Decoding.

**Mitigation:**
- In Phase 1 schon einen Test-Spike machen (1 Tag): RAW von Canon, Nikon, Sony, Fuji, DNG einlesen und visuell vergleichen.
- Plan B (Server-Decoding) architektonisch von Anfang an offen halten.

---

### R2 · Performance bei sehr großen Bildern

**Risiko:** 50-MP-Bilder und mehr (Sony α7R V, Fujifilm GFX) bringen mobile GPUs an die Grenze. Slider-Drag wird ruckelig.

**Auswirkung:** Schlechte UX bei Pro-Kameras.

**Mitigation:**
- Display-Texture wird auf 2048 × `n` runterskaliert für Live-Vorschau.
- Voll-Auflösung erst beim Export gerendert.
- WebGL2-Texture-Größen-Limits prüfen (`gl.MAX_TEXTURE_SIZE`), Fallback auf Tiling.

---

### R3 · Browser-Memory-Limits

**Risiko:** Ein 100-MP-RAW dekodiert kann mehrere hundert MB im Heap belegen. Tabs sterben unter Memory Pressure, besonders auf iOS/Safari.

**Auswirkung:** App crasht für High-End-Workflows.

**Mitigation:**
- RAW-Decoding in Web Worker mit explizitem Buffer-Transfer.
- Original-RAW-Buffer nach Texture-Upload freigeben (nur Display-Texture im Speicher behalten).
- IndexedDB als Auslagerung für Sessions, nicht als Live-Working-Set.

---

## Mittlere Risiken

### R4 · Color-Management / ICC-Profile

**Risiko:** Korrekt dargestellte Farben brauchen Color-Management. Browser unterstützt ICC-Profile bei Display, aber WebGL-Output ist standardmäßig sRGB. Wide-Gamut-Displays (P3, AdobeRGB) erhalten kein korrektes Color-Management.

**Auswirkung:** Profis sehen Farbverschiebungen zwischen Editor und Druck/Export.

**Mitigation für MVP:**
- sRGB-Workflow als Standard akzeptieren (deckt 95 % der Use Cases ab).
- Hinweis im UI: "Optimiert für sRGB-Displays."
- Stretch nach MVP: P3-Output via `<canvas color-space="display-p3">` (Chromium-only momentan).

---

### R5 · WB-Algorithmus zu simplistisch

**Risiko:** Der aktuelle Weißabgleich (R/B-Skala in Linear) ist eine grobe Approximation. Profis erkennen sofort, wenn das nicht stimmt.

**Auswirkung:** Glaubwürdigkeit bei zahlenden / Power-Usern leidet.

**Mitigation:**
- Phase 2: Bessere WB-Implementierung über XYZ-Konvertierung und Bradford-Adaptation.
- AsShot-WB aus EXIF lesen und als Default setzen, sobald RAW-Decoding läuft (Phase 3).

---

### R6 · Datenschutz-Compliance (DSGVO)

**Risiko:** Für deutschen/EU-Markt müssen wir DSGVO-konform sein: Datenschutzerklärung, AV-Vertrag (falls SaaS), Recht auf Löschung, Datenexport.

**Auswirkung:** Ohne saubere Compliance keine echte User-Akquisition möglich.

**Mitigation:**
- Self-hosting macht das einfach: User ist selbst Verantwortlicher.
- Bei späterem SaaS-Angebot: Datenschutzerklärung-Boilerplate, Account-Lösch-Endpoint, JSON-Datenexport.
- Account-Löschung mit `ON DELETE CASCADE` bereits jetzt in DB-Schema vorgesehen.

---

## Niedrige Risiken

### R7 · Accessibility

**Risiko:** Pixel-genaues Drag-and-Drop von Slidern ist mit Screen-Reader und Keyboard-Only schwer.

**Mitigation:** Tastatur-Navigation der Slider (←/→) bereits in Phase 1 eingebaut. ARIA-Labels überall. Vollständige WCAG-AA-Compliance ist Stretch nach MVP.

---

### R8 · Mobile-Performance

**Risiko:** Auf älteren Smartphones läuft die WebGL-Pipeline schlecht.

**Mitigation:** Mobile-Optimierung (kleinere Texture, vereinfachter Shader-Pfad bei niedriger GPU-Tier) ist Phase 6 / Stretch.

---

## Offene Fragen vor Phase 1

- [ ] Welche Domain wird verwendet? (DNS-Setup, TLS-Cert)
- [ ] Wo wird gehostet? Hetzner CX21? Eigener Heimserver mit DynDNS?
- [ ] Repository: GitHub oder selbst-gehostet (Forgejo/Gitea)?
- [ ] Lizenz: AGPL? MIT? Proprietary?
- [ ] Telemetry: ja/nein? (Plausible Analytics für Public-Beta wäre fair)

## Offene Fragen vor Phase 3 (RAW)

- [ ] Welche Kamera-Modelle sind die Top 5, die zwingend funktionieren müssen?
- [ ] Soll das Embedded-JPEG aus dem RAW als Schnell-Vorschau angezeigt werden, während das volle RAW dekodiert wird? (UX-Pattern wie Lightroom)
- [ ] Wie groß darf eine einzelne RAW-Datei sein? Limit setzen?

## Offene Fragen vor Phase 5 (lokale Anpassungen)

- [ ] UI-Pattern für Maskenliste: rechte Sidebar separat, oder Tab im Adjustments-Panel?
- [ ] Soll man mehrere Masken vom selben Typ haben können (z.B. zwei Verlaufsfilter)?
- [ ] Werden Masken in Presets mitgespeichert? Oder separat?

## Erkenntnisse aus Beta (für Phase 6)

Diese Liste füllt sich erst, wenn echte User testen. Plan: Kurze Surveys nach jedem Beta-Release, qualitative Interviews mit 3–5 Power-Usern.
