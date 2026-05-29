# Off-Page-Submissions — copy-paste-ready

Stand: 2026-05-29 · Repo ist **public** (AGPL-3.0): https://github.com/phash/lumen-light
· Demo: https://lumen.mr-development.de

Diese Texte sind fertig zum Einreichen/Posten. **Posten unter deiner
Identität** (eigene Accounts, Timing, Reaktion auf Kommentare) — daher
hier als Vorlage, nicht automatisch abgeschickt.

> **Reihenfolge-Hinweis (wichtig):** awesome-selfhosted & AlternativeTo
> wirken stärker, wenn das Repo schon **ein paar Stars** hat. In der
> Praxis lohnt sich: **Launch zuerst** (Show HN / r/selfhosted) → Stars
> sammeln → dann awesome-selfhosted-PR & AlternativeTo. Issue-Reihenfolge
> #1/#2 vor #3 ist „technisch vorbereitet"; das eigentliche Einreichen
> würde ich nach dem Launch machen.

---

## #3 — Launch-Posts (zuerst posten)

### Show HN (news.ycombinator.com/submit)

**Title** (max 80 Zeichen, kein „Show HN:"-Doppelung — HN ergänzt es selbst nicht, also rein):
```
Show HN: Lumen – a browser-based RAW photo editor you can self-host
```
**URL:** `https://lumen.mr-development.de`

**Erster Kommentar** (direkt nach dem Posten, als Autor):
```
Hi HN! Lumen is a self-hosted, browser-based RAW photo editor — a
lightweight Lightroom alternative I built for my own photo workflow.

Why: I wanted to develop RAW files without a subscription and without
uploading everything to someone's cloud. Everything runs client-side in
WebGL2; images stay on your machine unless you deliberately store them in
your own S3.

What it does: RAW decoding (CR2/CR3/NEF/ARW/RAF/DNG/RW2/ORF) via
libraw-wasm in a worker, the usual global sliders, HSL mixer, spline tone
curve, up to 8 local masks (linear + radial), auto-tone/auto-WB, lens
profiles, and a preset marketplace.

Stack: React 19 + a single-pass WebGL2 fragment shader (uniform arrays for
multi-mask), FastAPI + Postgres + Keycloak + S3, all Docker Compose on a
4 GB VPS. AGPL-3.0.

Code: https://github.com/phash/lumen-light
Happy to answer questions about the shader pipeline or the self-host setup.
```
**Timing:** Werktag, ~08:00–10:00 US-Eastern. Die ersten 1–2 h aktiv auf
Kommentare antworten (entscheidend für die Rangfolge).

---

### Reddit — r/selfhosted

**Title:**
```
Lumen – a self-hosted, browser-based RAW photo editor (Lightroom alternative), AGPL-3.0
```
**Body:**
```
I built a self-hosted RAW photo editor that runs entirely in the browser —
think a lightweight Lightroom alternative you own end-to-end.

- RAW in the browser: CR2/CR3/NEF/ARW/RAF/DNG/RW2/ORF (libraw-wasm)
- Global sliders + HSL + spline tone curve
- Up to 8 local masks (linear + radial)
- Auto-tone, auto-WB, lens profiles, preset marketplace
- WebGL2 pipeline, images never leave the client unless you store them
- Stack: React 19 / FastAPI / Postgres / Keycloak / S3, Docker Compose,
  runs on a 4 GB VPS. DSGVO/GDPR-friendly by default.

Demo: https://lumen.mr-development.de
Source (AGPL-3.0): https://github.com/phash/lumen-light

Feedback welcome — especially on the self-host experience.
```
**Regeln:** r/selfhosted erlaubt Eigenprojekte, aber als Diskussion, nicht
als reine Werbung. Erst die Subreddit-Rules lesen (Self-Promotion-Ratio).
Flair: „Release" o. Ä.

**Sekundär:** r/photography / r/postprocessing — dort den Foto-Workflow
betonen, nicht den Tech-Stack (andere Zielgruppe).

---

### Product Hunt

- **Name:** Lumen · light
- **Tagline (max 60):** `Self-hosted RAW photo editor in your browser`
- **Description:**
  ```
  Lumen is a self-hosted, browser-based RAW photo editor — a lightweight,
  subscription-free Lightroom alternative. Develop RAW files (CR2, NEF,
  ARW, DNG …) with global sliders, HSL, tone curve and local masks, all in
  WebGL2. Your images stay on your machine. Open source (AGPL-3.0),
  Docker Compose, runs on a small VPS.
  ```
- **Topics:** Photography, Open Source, Design Tools, Self-Hosted
- **First comment (Maker):** kurze Motivation + Stack + Einladung zum
  Selbsthosten (analog Show-HN-Kommentar).
- **Timing:** PH-Tag startet 00:01 PST. Vorab „Coming soon"-Seite + ein
  paar Leute aktivieren, die früh upvoten/kommentieren.

---

## #1 — awesome-selfhosted (PR, nach erstem Star-Zuwachs)

Repo: https://github.com/awesome-selfhosted/awesome-selfhosted
Sinnvollste Kategorie: **Photo and Video Galleries** (es gibt keine eigene
„Photo Editing"-Sektion; Maintainer dürfen umsortieren).

**Eintrag** (alphabetisch einsortieren, exaktes Repo-Format beachten):
```
- [Lumen · light](https://lumen.mr-development.de) - Browser-based, self-hosted RAW photo editor (lightweight Lightroom alternative): RAW development, local masks, HSL and tone curve, all in WebGL2. ([Demo](https://lumen.mr-development.de), [Source Code](https://github.com/phash/lumen-light)) `AGPL-3.0` `Docker/JavaScript/Python`
```
**Schritte:** Fork → Branch → Zeile alphabetisch einfügen → `make`-Lint
des Repos beachten → PR mit kurzer Begründung. Akzeptanzkriterien lesen
(aktive Entwicklung, English README, LICENSE — alles vorhanden).
Parallel: [awesome-selfhosted-data](https://github.com/awesome-selfhosted/awesome-selfhosted-data)
(YAML-Eintrag) — das ist inzwischen die Quelle der Wahrheit.

---

## #2 — AlternativeTo (alternativeto.net)

Neuen App-Eintrag „Lumen · light" anlegen, Felder:

- **Name:** Lumen · light
- **URL:** https://lumen.mr-development.de
- **Kurzbeschreibung:**
  `Self-hosted, browser-based RAW photo editor — a free, subscription-free Lightroom alternative built on WebGL2.`
- **Lange Beschreibung:** (Feature-Bullets aus dem README übernehmen)
- **Lizenz:** Open Source / AGPL-3.0 · **Plattform:** Web, Self-Hosted
- **Tags:** RAW, Photo Editing, Self-Hosted, Web-based, Free, Open Source
- **Alternative zu:** Adobe Lightroom, darktable, RawTherapee
- Screenshot hochladen (z. B. `docs/screenshots/phase5/01-editor-default.png`).

Sekundär gleiches Profil bei **Slant** und **SaaSHub**.

---

## #4 — Tech-Blogpost (dev.to + Cross-Post)

Empfohlener Erst-Artikel (höchster Such-Intent, deckt sich mit Quickstart):
**„Eine Lightroom-Alternative selbst hosten — RAW im Browser mit Docker in 10 Minuten"**

Gliederung:
1. Problem: Abo + Cloud-Zwang bei Lightroom; Wunsch nach Datenhoheit.
2. Was Lumen ist (1 Absatz + Hero-Screenshot).
3. Architektur in einem Bild (das ASCII-Diagramm aus dem README).
4. Self-Host in 10 Min: `docker-compose.prod.yml`, `.env`, Caddy, erster
   Login. (Schritte aus `infra/deployment-runbook.md`.)
5. Der spannende Teil: RAW-Pipeline in einem **Single-Pass WebGL2
   Fragment-Shader** — Uniform-Arrays für Multi-Mask, Tonkurve als
   Hermite-LUT, libraw-wasm im Worker. (GEO-Futter: KI-Engines zitieren
   erklärende Inhalte.)
6. Datenschutz by default (DSGVO-Abschnitt aus dem README).
7. CTA: Demo + Repo + „Stars/Issues willkommen".

**Publishing:** Primärquelle = eigener Blog (falls vorhanden) ODER dev.to;
Cross-Posts mit `rel=canonical` auf die Primärquelle (kein Duplicate
Content). Hashnode/Medium optional. Mit `?mtm_campaign=blog-devto` o. Ä.
verlinken, damit Matomo den Referrer sauber zählt.

---

## Tracking (alle Kanäle)

An jeden ausgehenden Link einen Matomo-Kampagnen-Parameter hängen:
`https://lumen.mr-development.de/?mtm_campaign=launch-hn` (bzw.
`-reddit`, `-ph`, `-blog-devto`). Dann ist in Matomo sichtbar, welcher
Kanal wirklich Traffic bringt.
