# arc42 §12 · Glossar

Fachbegriffe, die in der Lumen-Doku ohne weitere Erklärung verwendet werden.

| Begriff | Bedeutung |
|---|---|
| **Adjustment** | Ein einzelner Slider-Wert (z. B. `exposure`, `contrast`). Wird im Frontend als State gehalten, im Shader als Uniform gesetzt und im Backend als JSONB-Feld gespeichert. |
| **Adjustments** | Die Sammlung aller 10 Adjustments. Single Source of Truth ist `backend/schemas/adjustments.schema.json`. |
| **Belichtung (Exposure)** | Lineare Multiplikation der RGB-Werte mit `2^stops`. Einheit: Blendenstufen, Bereich `−5..+5`. |
| **Dynamik (Vibrance)** | Sättigungs-Boost mit Schutz für bereits gesättigte Farben (`(1−s)²`-Gewichtung). Bereich `−1..+1`. |
| **EXIF** | Metadaten in JPEG/RAW-Dateien (Kamera-Modell, Objektiv, Belichtungszeit, …). Wird in Phase 4 für die Lensfun-Auto-Erkennung benötigt. |
| **FBO (Framebuffer Object)** | WebGL-Konstrukt für Off-Screen-Rendering. Pflicht für Multi-Pass-Pipelines (Phase 5+). |
| **JSONB** | Postgres-Datentyp für strukturierte JSON-Daten mit GIN-Index-Support. Hier für `presets.adjustments`. |
| **JWT** | JSON Web Token. Stateless Auth-Token, hier mit HS256. Access-Token lebt 15 min, Refresh-Token 7 Tage. |
| **Lensfun** | Open-Source-Datenbank für Objektiv-Korrektur-Profile (Verzeichnung, Vignettierung, chromatische Aberration). Wird in Phase 4 als statisches JSON ausgeliefert. |
| **libraw-wasm** | WebAssembly-Build der RAW-Decoding-Library libraw. Wird in Phase 3 lazy geladen. |
| **Linear (RGB)** | Farbraum ohne Gamma-Korrektur. Mathematisch korrekt für Belichtung und Weißabgleich. |
| **Pipeline** | Reihenfolge der Shader-Operationen, siehe `docs/05-frontend-konzept.md` §"WebGL-Pipeline". |
| **Preset** | Benannte Sammlung von Adjustments, gehört genau einem User. Wiederverwendbar zwischen Bildern. |
| **Refresh-Token-Rotation** | Beim Aufruf von `/auth/refresh` wird der alte Refresh-Token invalidiert und ein neuer ausgegeben. Schutz gegen Replay. |
| **sRGB** | Standard-Farbraum für Bildschirme, mit Gamma-Kurve (≈ 2.2). Eingang aller Bilder, Ausgang vor Display. |
| **Tenant-Isolation** | Garantie, dass Daten eines Users (`user_id`) für andere User nicht sichtbar oder änderbar sind. Auf API-Ebene durch `where(... user_id == current_user.id)` erzwungen. |
| **Tonwertbereiche** | Lichter, Tiefen, Weiß, Schwarz — Adjustments, die per Luminanz-Maske nur einen Helligkeitsbereich beeinflussen. |
| **Uniform** | Globale Variable im GLSL-Shader, vom JavaScript pro Frame setzbar. Hier: ein Uniform pro Adjustment. |
