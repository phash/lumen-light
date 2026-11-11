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

### R9 · Service-Account `lumen-admin` darf alle Realm-User verwalten (akzeptiertes Risiko, Review M3 2026-11)

**Risiko:** `DELETE /me` loescht auch den Keycloak-Account. Dafuer braucht der
Confidential Client `lumen-admin` die Rolle `realm-management/manage-users`.
Die erlaubt aber mehr als Loeschen: Passwoerter zuruecksetzen, Required
Actions setzen, User anlegen/deaktivieren, Sessions beenden — fuer ALLE User
des Realms `lumen`. Wer das Client-Secret hat, kann also jeden Account
uebernehmen. Keycloak bietet auch mit Fine-Grained Admin Permissions v2
(FGAP) keinen Scope "nur loeschen" (`manage` umfasst Loeschen und
Credential-Reset), eine engere Rolle gibt es nicht.

**Entscheidung:** akzeptiert. DSGVO-Loeschung inkl. IdP-Account wiegt schwerer;
ein eigener Loesch-Microservice haette dasselbe Secret-Problem.

**Mitigation (von `deploy.sh` Schritt 6a bei jedem Lauf idempotent erzwungen):**
- Secret liegt nur in `deployment/.env` (chmod 600, von `deploy.sh`/`backup.sh`
  erzwungen) und in der Env von `lumen-api` — nicht im Repo, nicht im Realm-JSON.
- Client nur `client_credentials`: `publicClient=false`, `standardFlowEnabled`,
  `implicitFlowEnabled`, `directAccessGrantsEnabled` = false,
  `serviceAccountsEnabled=true`. Ein Login als Mensch ueber diesen Client ist
  nicht moeglich. `deploy.sh` liest die Flags nach dem Merge zurueck und bricht
  bei Abweichung ab.
- Access-Token-Lebensdauer 60 s (`access.token.lifespan` am Client), kein
  Refresh-Token bei client_credentials — ein abgegriffenes Token ist schnell
  wertlos.
- Service-Account hat GENAU `realm-management/manage-users`: `deploy.sh`
  entfernt jede andere Rolle (auch `default-roles-lumen`, die Keycloak jedem
  Service-Account gibt).
- Admin-REST-API ist von aussen gesperrt (Caddy/nginx 404 fuer `/auth/admin/*`);
  die API spricht Keycloak nur intern ueber `lumen-internal` an. Das Secret
  nuetzt also nur mit Zugriff auf das interne Netz bzw. den Host.
- Admin-Events sind an (`adminEventsEnabled` + `adminEventsDetailsEnabled` aus
  `lumen-realm.prod.json`): jede Aktion des Service-Accounts (Passwort-Reset,
  User-Update) steht im Admin-Event-Log des Realms.

**Offen / Nachschaerfung:** Admin-Events werden nur gespeichert, nicht aktiv
gemeldet. Sinnvoll waere ein Event-Listener (z.B. `jboss-logging` mit
Log-Alert oder eigener SPI), der bei `UPDATE`/`ACTION` auf
`users/*/reset-password` oder `users/*/execute-actions-email` durch den
Service-Account alarmiert — im Normalbetrieb macht `lumen-admin` nur `DELETE`.
Secret-Rotation: `kcadm.sh create clients/<id>/client-secret -r lumen` +
`deploy.sh` (traegt das neue Secret ein und erzeugt `lumen-api` neu).

---

### R10 · Refresh-Token-Rotation bewusst aus (Review L13, 2026-11)

**Risiko:** `revokeRefreshToken=false` — ein abgegriffenes Refresh-Token bleibt
bis zum Ablauf der SSO-Session nutzbar (Idle 30 min, Max 30 Tage).

**Entscheidung:** Die SPA speichert Tokens pro Tab in `sessionStorage`; alle
Tabs teilen sich dieselbe Keycloak-Client-Session. Mit Rotation
(`revokeRefreshToken=true`, `refreshTokenMaxReuse=0`) entwertet der Refresh in
Tab A das Refresh-Token von Tab B -> Tab B fliegt beim naechsten Silent-Renew
raus. Deshalb aus. Kompensiert durch kurze Access-Tokens (15 min), Idle-Timeout
30 min (`ssoSessionIdleTimeout=1800`), Brute-Force-Schutz und CSP (kein
Token-Abfluss per XSS-Drittskript). Die Werte stehen explizit in
`lumen-realm.prod.json` und werden von `deploy.sh` bei jedem Lauf gesetzt.
Rotation wieder einschalten, sobald die SPA Tokens tab-uebergreifend teilt
(z.B. BroadcastChannel/`localStorage` mit Lock).

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
