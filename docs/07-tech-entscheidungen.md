# 07 · Tech-Entscheidungen (ADRs)

Architecture Decision Records: für jede wesentliche Tech-Wahl die Alternativen, die Begründung und die Konsequenzen.

## ADR-001 · WebGL2 statt WebGPU

**Status:** Entschieden für MVP

**Optionen:**
1. WebGL2 — Browser-Support seit 2017, läuft überall.
2. WebGPU — moderner, mächtiger (Compute-Shader, bessere Performance), Browser-Support seit 2023 in Chromium, seit Safari 18 stabil, Firefox noch hinter Flag.

**Entscheidung:** WebGL2.

**Begründung:** Für unsere Pipeline (Fragment-Shader-basierte Pixel-Operationen) reicht WebGL2 voll aus. WebGPU wäre nur sinnvoll, wenn wir Compute-Shader für Histogramm-Berechnung oder ML-Inference im Editor selbst bräuchten. Browser-Reichweite zählt mehr als marginale Performance-Gewinne.

**Konsequenz:** Wenn später KI-Masken via Segment-Anything direkt im Editor laufen sollen, wird ggf. ein WebGPU-Pfad parallel nötig. Architektur sollte das nicht verbauen.

---

## ADR-002 · libraw-wasm statt serverseitigem RAW-Decoding

**Status:** Entschieden, mit Plan B

**Optionen:**
1. libraw-wasm im Browser — alles bleibt clientseitig, keine RAW-Daten am Server.
2. Server-Decoding via Python-libraw — RAW-Upload, Backend dekodiert, Frontend bekommt nur Pixel-Buffer.

**Entscheidung:** libraw-wasm primär, Server-Decoding als Fallback.

**Begründung:** Hauptverkaufsargument von Lumen ist Datensouveränität. RAWs verlassen den Client nicht. Außerdem: das Backend bleibt zustandslos und winzig.

**Konsequenz:** Initial Page Load wird größer (libraw-wasm ist mehrere MB). Lazy-Loaden, erst beim ersten RAW-Open. Wenn libraw-wasm zu unzuverlässig ist (kommt bei Random-Kameras zu Crashes), Fallback auf Server-Decoding. User wird dann transparent informiert.

---

## ADR-003 · FastAPI statt Express/Spring/Django

**Status:** Entschieden

**Optionen:**
1. FastAPI (Python) — async, OpenAPI out-of-box, Pydantic-Validierung.
2. Express (Node) — Frontend-Sprache, riesiges Ökosystem.
3. Spring Boot (Java) — du kennst Java; mächtig, aber overkill für 5 Endpoints.
4. Django Rest Framework — synchron, schwerer, weniger Type-Sicherheit.

**Entscheidung:** FastAPI.

**Begründung:** Du kennst es schon und nutzt es im anderen Projekt — keine Lernkurve. Pydantic-Validierung passt 1:1 zur JSON-Schema-Strategie für `adjustments`. OpenAPI-Auto-Generation spart Frontend-Typen-Arbeit. Performance reicht für unsere Last bei Weitem.

**Konsequenz:** Ein zweiter Sprach-Stack im Repo (Python + JS/TS). Wenn das mal stört, ist Express-Migration in einem Wochenende machbar.

---

## ADR-004 · JWT statt Server-Sessions

**Status:** **OBSOLET (2026-04-27)** — ersetzt durch ADR-010 (Keycloak als IdP).

**Begründung der Aufhebung:** Manuel betreibt auf dem MRD Production Cluster bereits Keycloak als zentralen IdP für andere Projekte (`wgapp`, geplant: weitere). Ein eigenes JWT-Auth-System mit Registrierung, Passwort-Hashing und Refresh-Token-Rotation würde Aufwand duplizieren und User zwingen, pro App ein neues Konto anzulegen. Single Sign-On über Keycloak ist die Cluster-Konvention.

**Was bleibt:** Iteration 1 hat gezeigt, dass das Test-Fundament tragfähig ist (35 Tests inkl. Tenant-Isolation). Die Test-Fixtures und das Pattern werden weiterverwendet, nur der Auth-Mechanismus wechselt.

**Was geht weg:** `app/auth.py` (bcrypt, eigene JWT-Erzeugung), `app/routers/auth.py` (register/login/refresh/logout), `models.RefreshToken`, `models.User.password_hash`. Tests: 18 von 35 werden durch Keycloak-Integrationstests ersetzt.

---

## ADR-005 · PostgreSQL mit JSONB statt separater Adjustment-Tabelle

**Status:** Entschieden

**Optionen:**
1. JSONB-Spalte `adjustments` in `presets`-Tabelle.
2. Separate Tabelle `preset_adjustments` mit Spalten pro Adjustment.
3. EAV-Pattern (Key-Value-Tabelle).

**Entscheidung:** JSONB.

**Begründung:** Adjustments sind eine konzeptuell kohärente Einheit, die immer zusammen gelesen und geschrieben wird. Schema-Evolution (neues Adjustment dazu) ist mit JSONB trivial — kein DDL, nur eine UPDATE-Migration. Pydantic validiert die Struktur ohnehin auf Application-Layer.

**Konsequenz:** Suche nach Presets mit bestimmten Adjustment-Werten ist möglich (GIN-Index), aber langsamer als bei Spalten. Für die geplanten Use Cases (User listet eigene Presets) ist das irrelevant.

---

## ADR-006 · Tailwind statt CSS-Modules / styled-components

**Status:** Entschieden

**Begründung:** Du nutzt es schon. Schnelle Iteration, keine Context-Switches zwischen Markup und Stil. Atomic-CSS-Build ist klein.

**Konsequenz:** Bei sehr komplexen, animierten Komponenten kann Lesbarkeit leiden. Dann auf `@apply` oder Component-Klassen ausweichen.

---

## ADR-007 · Single-File-Frontend-Build statt Microfrontends

**Status:** Entschieden

**Begründung:** Ein Editor, eine Codebasis, ein Build. Microfrontends sind Lösung für Probleme, die wir nicht haben.

---

## ADR-008 · Self-Hosted statt SaaS

**Status:** Strategische Grundsatzentscheidung

**Begründung:** Kern-USP ist Datensouveränität. Wir bauen also primär für Self-Hoster und Hobbyisten. Eine gehostete Variante kann später als optionale Convenience kommen, ist aber Plan B, nicht Plan A.

**Konsequenz:** Onboarding-Friction höher (User muss VPS oder Heimserver haben). Adressieren wir mit hervorragender Docker-Compose-Doku und einer One-Liner-Installation.

---

## ADR-009 · Kein WYSIWYG-Editor für Presets-Sharing

**Status:** Aufgeschoben

**Hintergrund:** Die Vision sieht Preset-Sharing zwischen Usern vor. Frage: Web-Marketplace im Stil von Lightroom-Mobile, oder einfach JSON-Export/Import?

**Entscheidung MVP:** JSON-Export/Import von Presets. Marketplace ist Backlog, sobald genug User da sind.

**Begründung:** Marketplace bedeutet Moderation, Bezahlung, Lizenz, Reporting. Komplexes Feature, nur sinnvoll mit Nutzerbasis. JSON-Datei tut's für die ersten 100 Power-User.

---

## ADR-010 · Keycloak als zentraler Identity-Provider

**Status:** Entschieden (2026-04-27, ersetzt ADR-004)

**Optionen:**
1. **Keycloak** als externer IdP, FastAPI nur Resource Server (verifiziert Tokens via JWK-Set).
2. Eigenes JWT-Auth-System (vorheriger Stand, ADR-004) — eigene `/register`/`/login`-Endpoints, bcrypt, Refresh-Token-Rotation.
3. **Auth0/Clerk** als gehosteter SaaS-IdP — würde dem Self-Hosting-Anspruch widersprechen.

**Entscheidung:** Keycloak.

**Begründung:**
- Cluster-Konvention: Manuel betreibt Keycloak bereits für andere MRD-Projekte (`wgapp` u. a.). Pattern ist etabliert (eigener Realm pro App-Familie, PostgreSQL-Backend, Realm-Export im Repo, Caddy auf Subdomain).
- Self-Hosting bleibt erhalten — Keycloak läuft im selben Compose-Stack wie die App.
- Single Sign-On zwischen MRD-Projekten möglich, falls später erwünscht.
- Standard-OIDC: Frontend nutzt `react-oidc-context` o. ä., kein eigenes Token-Handling-Risiko.

**Realm-Strategie:** Eigener Realm `lumen` (nicht ein gemeinsamer MRD-Realm). Begründung: saubere Trennung der User-Pools zwischen Apps, einfachere spätere Konsolidierung möglich.

**Konsequenz:**
- Backend: `app/auth.py` und `app/routers/auth.py` werden ersetzt durch eine schlanke JWK-basierte Token-Verifikation. `current_user` baut Profil aus Keycloak-`sub` und -`email`-Claim.
- Lokale `users`-Tabelle behält nur `keycloak_sub` (UUID) + `email` (gespiegelt). Kein `password_hash`, keine `refresh_tokens`-Tabelle.
- Frontend: Keine eigene Login-/Register-Form mehr. Buttons "Login" / "Registrieren" leiten zum Keycloak-Login-Screen weiter (OIDC Authorization Code Flow + PKCE).
- Tests: testcontainers fährt zusätzlich einen Keycloak-Container hoch, importiert den Realm-Export, FastAPI-Tests bekommen einen "Issued-by-Test-Keycloak"-JWT statt selbst zu signieren.

**Realm-Export-Pflege:** `infra/keycloak/lumen-realm.json` ist der Source-of-Truth, wird im Repo versioniert. Realm-Änderungen via Keycloak-Admin-UI werden anschließend exportiert und committed (sonst Drift zwischen Test- und Production-Realm).

---

## ADR-011 · Garage S3 für Image-Storage

**Status:** Entschieden (2026-04-27)

**Hintergrund:** Lumen war initial als reiner Editor konzipiert (*"Pixel verlassen den Client nicht"*). Mit der Cluster-Realität (Garage S3 verfügbar, Multi-Device-Use-Case) wird das ergänzt: User kann **bewusst und gesteuert** Bilder in den eigenen Bucket hochladen, um sie auf einem zweiten Gerät weiterzubearbeiten oder zu archivieren.

**Was bleibt vom Datensouveränitäts-USP:** Nichts wandert *automatisch* zum Server. Upload ist immer eine explizite User-Aktion. Backend speichert keine Pixeldaten — der Pixel-Pfad ist Browser↔Garage direkt via Pre-Signed URL.

**Optionen:**
1. **Garage** (S3-kompatibel, im Cluster bereits laufendes Pattern, z. B. `gp200editor`).
2. MinIO — größere Verbreitung, aber redundante Tooling-Vielfalt im Cluster.
3. Eigene Postgres-LargeObject-Speicherung — kein Streaming, schlechte Skalierung.

**Entscheidung:** Garage.

**Begründung:**
- Cluster-Konvention: Pattern für Container, Bucket-Anlage, Access-Key-Verteilung existiert bereits (`gp200editor/scripts/garage-init.sh`).
- S3-API-Standard: Frontend nutzt `aws-sdk/client-s3` oder direkt `fetch` mit pre-signed URLs.
- Pixel laufen *nicht* durch FastAPI — Backend issuiert nur Pre-Signed URLs nach Auth-Check, der eigentliche Upload/Download ist direkt Browser↔Garage. Bandbreite und Footprint des Backends bleiben minimal.

**Datenfluss Upload:**

```
Browser          Backend (FastAPI)         Garage
   │                  │                       │
   │ POST /images     │                       │
   │ {filename, type, │                       │
   │  size}           │                       │
   ├─────────────────▶│                       │
   │                  │ JWT verifizieren      │
   │                  │ Image-Row in DB       │
   │                  │ pre-signed PUT-URL    │
   │                  │ generieren (15 min)   │
   │ ◀──────URL───────┤                       │
   │                  │                       │
   │ PUT  binary      │                       │
   ├──────────────────────────────────────────▶│
   │ ◀─────────  200 ──────────────────────────┤
   │                  │                       │
   │ POST /images/:id/                        │
   │ confirm          │                       │
   ├─────────────────▶│                       │
   │                  │ HEAD Object via       │
   │                  │ S3-API → bestätigt    │
   │                  ├──────────────────────▶│
   │ ◀──────200───────┤ ◀────────────────────┤
```

**Bucket-Struktur:** `lumen-images` (per-User-Prefix `<keycloak_sub>/originals/<image_id>`, später ggf. `<keycloak_sub>/exports/<image_id>`). Lifecycle-Rules folgen, wenn Speicherbedarf wächst.

**Konsequenz:**
- Neue Tabelle `images` in Postgres (siehe `docs/03-datenmodell.md`).
- Neue Endpoints `/api/v1/images/*` (siehe `docs/04-api-spezifikation.md`).
- Frontend: Upload-/Library-Komponente, lazy-loaded.
- Datenschutz-Aussage in `01-konzept.md` wird präzisiert: Upload ist optional und vom User initiiert.

---

## ADR-012 · Caddy als Reverse Proxy + TLS-Terminierung

**Status:** Entschieden (2026-04-27)

**Optionen:**
1. **Caddy** im `caddy-proxy`-Network des Cluster-Setups.
2. Nginx mit certbot — etabliert, aber Cluster nutzt bereits Caddy.
3. Traefik — Auto-Discovery via Docker-Labels, aber Cluster ist Caddy-zentriert.

**Entscheidung:** Caddy.

**Begründung:** Folge dem bestehenden Cluster-Pattern (`/opt/caddyserver/Caddyfile`). Keine zusätzliche Infrastruktur. TLS via Let's Encrypt out-of-box, kein certbot-Cron nötig. Routing per einfachen Caddyfile-Blocks.

**Caddy-Topologie für Lumen:**

```
lumen.mr-development.de        → /api/v1/* → lumen-api:4100
                               → Rest      → lumen-web:80

auth.mr-development.de         → keycloak:8080
  (oder Subdomain pro Realm)
```

**Container-Aliase:** `lumen-api`, `lumen-web`, ggf. `keycloak` via `docker network connect --alias`.

**Konsequenz:** `deployment/docker-compose.yml` wird in `deployment/docker-compose.prod.yml` aufgespalten: lokale Dev-Stack (mit eigenem Caddy für Bequemlichkeit) und Cluster-Prod-Stack (joint dem geteilten `caddy-proxy`-Network).
