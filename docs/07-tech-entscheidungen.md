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

**Status:** Entschieden

**Optionen:**
1. JWT mit Access + Refresh — stateless, skaliert horizontal trivially.
2. Server-Sessions mit Redis — einfacher zu invalidieren, größerer Footprint.
3. Session-Cookie via DB-Lookup — kein Redis nötig, langsamer.

**Entscheidung:** JWT mit kurzer Access-Token-Lebensdauer (15 min) und Refresh-Token-Rotation.

**Begründung:** Wir wollen das Backend stateless halten (keine Redis-Abhängigkeit). Refresh-Token werden in DB gehasht gespeichert, sodass Logout und globaler Logout-aller-Sessions möglich bleiben.

**Konsequenz:** Token-Rotation muss korrekt implementiert werden (alter Refresh-Token wird beim Refresh invalidiert, sonst Replay-Angriff möglich). Token-Storage im Frontend: Access-Token im Memory (volatil), Refresh-Token in HttpOnly-Cookie.

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
