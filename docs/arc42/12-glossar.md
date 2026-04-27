# arc42 §12 · Glossar

Fachbegriffe, die in der Lumen-Doku ohne weitere Erklärung verwendet werden.

| Begriff | Bedeutung |
|---|---|
| **Adjustment** | Ein einzelner Slider-Wert (z. B. `exposure`, `contrast`). Wird im Frontend als State gehalten, im Shader als Uniform gesetzt und im Backend als JSONB-Feld gespeichert. |
| **Bucket** | Container für Objekte in Garage S3, hier `lumen-images`. Per-User-Prefix sorgt für Tenant-Isolation. |
| **Caddy** | Reverse Proxy mit automatischer TLS-Vergabe (Let's Encrypt). Cluster-weit geteilt im `caddy-proxy`-Network. |
| **Caddy-Alias** | Pflicht-Schritt im Cluster: `docker network connect --alias <name> caddy-proxy <container>`. Caddy erreicht Container nur über Aliase, nicht über die Compose-Service-Namen. |
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
| **Garage** | Open-Source S3-kompatibler Object-Store, hier für Image-Library. Setup-Pattern aus dem MRD-Cluster (siehe `gp200editor`). |
| **JIT-Provisioning** | "Just-in-Time": ein User erscheint zum ersten Mal mit gültigem Keycloak-JWT — Backend legt automatisch die lokale `users`-Row an, kein vorheriger `/register`-Aufruf nötig. |
| **JWK-Set** | "JSON Web Key Set" — der Public-Key-Endpoint von Keycloak (`/realms/lumen/.../certs`), den der Resource-Server (FastAPI) zum Verifizieren der JWT-Signatur abfragt. |
| **Keycloak** | Open-Source Identity- und Access-Provider, hier als zentraler IdP. Realm `lumen` für Lumen-User. |
| **Keycloak-`sub`** | UUID-String, der einen User in Keycloak identifiziert. In Lumens lokaler `users`-Tabelle als `keycloak_sub` gespeichert (autoritativ). |
| **OIDC Authorization Code + PKCE** | Standard-Login-Flow für Single-Page-Apps. PKCE (`Proof Key for Code Exchange`) verhindert Code-Interception ohne Client-Secret. |
| **Pipeline** | Reihenfolge der Shader-Operationen, siehe `docs/05-frontend-konzept.md` §"WebGL-Pipeline". |
| **Pre-Signed URL** | S3-URL mit zeitlich limitierter Signatur, vom Backend ausgestellt — der Browser nutzt sie direkt für PUT/GET, ohne dass der Pixel-Stream durch FastAPI läuft. |
| **Preset** | Benannte Sammlung von Adjustments, gehört genau einem User. Wiederverwendbar zwischen Bildern. |
| **Refresh-Token-Rotation** | Beim Aufruf von `/auth/refresh` wird der alte Refresh-Token invalidiert und ein neuer ausgegeben. Schutz gegen Replay. |
| **sRGB** | Standard-Farbraum für Bildschirme, mit Gamma-Kurve (≈ 2.2). Eingang aller Bilder, Ausgang vor Display. |
| **Tenant-Isolation** | Garantie, dass Daten eines Users (`user_id`) für andere User nicht sichtbar oder änderbar sind. Auf API-Ebene durch `where(... user_id == current_user.id)` erzwungen. |
| **Tonwertbereiche** | Lichter, Tiefen, Weiß, Schwarz — Adjustments, die per Luminanz-Maske nur einen Helligkeitsbereich beeinflussen. |
| **Uniform** | Globale Variable im GLSL-Shader, vom JavaScript pro Frame setzbar. Hier: ein Uniform pro Adjustment. |
