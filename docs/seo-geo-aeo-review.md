# SEO / GEO / AEO — Review & Maßnahmen

Stand: 2026-05-29 · Domain: `https://lumen.mr-development.de`

Ziel: Lumen · light bei klassischer Such- (SEO), KI-/Generative-Engine-
(GEO) und Answer-Engine- (AEO) Sichtbarkeit auffindbar machen — als
selbst-gehostete, abofreie **Lightroom-Alternative**.

## Begriffe

- **SEO** — Suchmaschinen (Google/Bing): Crawlbarkeit, Meta, Backlinks.
- **GEO** (Generative Engine Optimization) — von KI-Modellen
  (ChatGPT, Gemini, Perplexity, Claude) zitiert werden. Diese Crawler
  führen i. d. R. **kein JavaScript** aus → Inhalt muss im rohen HTML
  stehen. Strukturierte, erklärende Inhalte werden bevorzugt zitiert.
- **AEO** (Answer Engine Optimization) — direkte Antworten/Featured
  Snippets: FAQ-Format + `FAQPage`-Structured-Data.

## Ausgangsbefund (das Kernproblem)

Lumen ist eine **Single-Page-App** (React/Vite). Der ausgelieferte
HTML-Body war praktisch leer (`<div id="root">`), alle Inhalte werden
client-seitig gerendert. Folge:

1. KI-Crawler & viele Such-Bots sehen **keinen Inhalt** (kein JS).
2. Keine `<meta description>`, kein Open Graph → keine sinnvollen
   Vorschauen beim Teilen.
3. Keine strukturierten Daten → keine Rich Results / keine
   maschinenlesbare „Was ist das?"-Antwort.
4. Keine `robots.txt`, keine `sitemap.xml`.

## Recherchierte Best Practices (priorisiert)

| Hebel | Wirkung | Aufwand |
|-------|---------|---------|
| `<meta>` + Open Graph + Canonical | SEO-Basis, Teilen-Vorschau | gering |
| JSON-LD `SoftwareApplication` + `FAQPage` | Rich Results, GEO/AEO | gering |
| `robots.txt` + `sitemap.xml` | Crawl-Steuerung | gering |
| Inhalt im rohen HTML (`<noscript>` → später Prerender) | GEO entscheidend | mittel→hoch |
| Sichtbare FAQ + Vergleichsblock | AEO, Long-Tail | gering |
| Off-Page: Listen, Communities, Backlinks | Autorität, Erst-Traffic | laufend |

## Umgesetzt — Block 1 (On-Page-Technik)

Alles in `frontend/index.html` + `frontend/public/`:

- **Meta**: `description`, `robots`, `canonical`.
- **Open Graph** (`og:title/description/image/url/type/site_name/locale`)
  + **Twitter Card** (`summary_large_image`).
- **JSON-LD `SoftwareApplication`**: Name, Kategorie, Preis 0 €,
  `featureList` (RAW-Formate, WebGL2, Masken, HSL, Tonkurve,
  Marketplace, Selfhost), `author`, `sameAs` → GitHub.
- **JSON-LD `FAQPage`**: 6 Q&A (Was ist Lumen / RAW-Formate /
  Lightroom-Alternative / Selbst hosten / Kostenlos / Bilder privat).
- **`<noscript>`-Block**: H1 + Beschreibung + FAQ-Auszug + GitHub-Link,
  damit JS-lose Crawler/KI-Engines sofort Inhalt sehen.
- **`public/robots.txt`**: Index erlaubt, KI-Bots willkommen;
  Login-gated App-Routen + `/auth` `/api` `/lumen-images` ausgenommen;
  Sitemap referenziert.
- **`public/sitemap.xml`**: `/`, `/datenschutz`, `/impressum`.
- **`public/og-image.png`**: gebrandetes 1200×630-Share-Bild
  (Playwright-gerendert, keine neue Dependency).
- **GitHub**: `homepageUrl = lumen.mr-development.de` + 8 Topics
  (raw-editor, lightroom-alternative, self-hosted, photo-editor,
  webgl, react, fastapi, raw-photography).

## Umgesetzt — Block 2 (On-Page-Inhalt)

In `frontend/src/pages/Landing.tsx` (+ `tests/Landing.test.tsx`):

- **Sichtbare FAQ-Sektion** (`data-testid="landing-faq"`) — Fragen und
  Antworten **1:1 deckungsgleich** mit dem `FAQPage`-JSON-LD (AEO:
  sichtbarer Inhalt muss dem Markup entsprechen).
- **Vergleichsblock** „Lumen oder Lightroom?" (`landing-compare`) —
  ehrliche Tabelle (Preis, Plattform, Daten, RAW im Browser, Masken,
  Abo/offline). Bedient den Such-Intent „Lightroom-Alternative".
- **Semantische Struktur**: ein `<h1>`, Abschnitts-`<h2>`,
  Feature-`<h3>`; Vergleich als echte `<table>` mit `scope`.
- **Perf**: Landing importiert nur `react-router` + `react-oidc-context`
  — keine schweren Editor-Libs (libraw-wasm, TF.js, Mediapipe) am
  Einstiegspfad; die bleiben lazy hinter den Editor-Routen.

## Block 3 (Off-Page) — Vorgehen → GitHub-Issues

Off-Page ist laufende Arbeit und teils an „Repo öffentlich" gekoppelt.
Als Issues in `phash/lumen-light` angelegt:

| # | Maßnahme | Kern |
|---|----------|------|
| #1 | awesome-selfhosted & Selfhost-Listen | stärkster thematischer Backlink |
| #2 | AlternativeTo (als Lightroom-Alternative) | hohe Autorität, exakter Intent |
| #3 | Launch: Show HN / r/selfhosted / Product Hunt | Erst-Traffic-Peak |
| #4 | Technischer Blogpost (dev.to) | dauerhafter Link + GEO-Futter |
| #5 | README-Schaufenster + LICENSE | GitHub-Discovery, Listen-Voraussetzung |
| #6 | Echtes Prerendering/SSG statt `<noscript>` | GEO-Endausbau |
| #7 | Marketplace ohne Login + indexierbare Preset-Seiten | Long-Tail-Seiten |
| #8 | Repo öffentlich (LICENSE, Secrets-Audit, Impressum-Link) | entsperrt #1/#2/#5 |

**Reihenfolge-Empfehlung:** #8 → #5 → #1/#2 → #3 → #4; #6/#7 als
größere Folge-Iteration.

### Update (2026-05-29) — Stand der Umsetzung

- **#8 ✓** Repo public (AGPL-3.0, von GitHub erkannt), Secrets-Audit der
  gesamten History clean, GitHub-Link in Footer + Impressum live.
- **#5 ✓** README-Schaufenster (Hero, Badges, Demo-Link, Vergleich) + LICENSE.
- **#6 ✓** Echtes Prerendering live: `frontend/src/entry-server.tsx`
  (Vite-SSR) + `frontend/scripts/prerender.mjs` rendern `/`, `/datenschutz`,
  `/impressum` zu statischem HTML (Flat-Files, `nginx try_files $uri.html`,
  kein 301). Läuft im alpine-Docker-Build (pure Node, kein Browser, kein
  neues Dep). `<noscript>` entfernt; Rechtsseiten ohne Landing-JSON-LD.
- **#7 teilweise ✓** Marketplace-Browse öffentlich ohne Login (Backend
  ungated read; apply/fork/report bleiben gated + ratelimitiert; Frontend
  Public-Route + Login-Redirect + Hinweis). `robots.txt`/sitemap angepasst.
  Datenschutz + Publish-Consent auf „öffentlich inkl. Suchmaschinen/KI"
  aktualisiert. **Offen:** pro-Preset prerenderte Detailseiten (brauchen
  Runtime-SSR oder Build-Time-API) — Issue #7 bleibt dafür offen.
- **#1–#4** vorbereitet als Drafts (`docs/off-page-submissions.md`),
  Einreichen/Posten erfolgt manuell.

## Verifikation (live)

```bash
curl -s https://lumen.mr-development.de/ | grep -E 'og:title|application/ld\+json|<noscript'
curl -s https://lumen.mr-development.de/robots.txt
curl -s https://lumen.mr-development.de/sitemap.xml
curl -sI https://lumen.mr-development.de/og-image.png   # Content-Type: image/png
```

Seit der Bilingual-Iteration (siehe Update unten) werden sichtbare FAQ und
`FAQPage`-JSON-LD **aus derselben Quelle** (`src/i18n/content.ts` →
`structuredData.ts`) erzeugt und beim Prerender injiziert — die fruehere
„JSON-LD in `index.html` manuell synchron halten"-Pflicht entfaellt.
`tests/Landing.test.tsx` und `tests/structuredData.test.ts` sichern die
Deckungsgleichheit pro Locale ab.

### Update (2026-06-09) — Bilingual DE+EN + GEO-Politur

- **Zweisprachig DE+EN**: geteiltes `frontend/src/i18n/content.ts` (Single
  Source), `Landing` locale-aware, `/en`-Route + Flat-File `en.html`,
  hreflang-Cluster (`de`/`en`/`x-default`=`/en`), Header-Sprachumschalter.
  Die `/en`-Seite setzt außerdem `<html lang="en">` + `og:locale=en_US`.
- **JSON-LD aus CONTENT generiert** (`structuredData.ts`): SoftwareApplication
  + FAQPage + neue **HowTo**, pro Locale, `inLanguage` gesetzt — FAQ und Markup
  per Konstruktion deckungsgleich (alte „manuell synchron halten"-Falle weg).
  Injektion im Prerender gehärtet: Funktion statt String-Replace (sicher gegen
  `$` im Inhalt), `<`→`<`-Escaping im JSON-LD-Output.
- **Keyword-Schärfung**: H1/Title DE „kostenlose Lightroom-Alternative",
  EN „free Lightroom alternative"; +3 FAQ (Open Source / Installation / Kameras).
- **/marketplace prerendert** echten Intro-Inhalt (`MarketplaceIntro`,
  SSR-sicher) statt Landing-Fallback.
- **`public/llms.txt`** für AI-Engines.
- **nginx**: Junk-/Scan-Pfade (`*.php`, `.env`, `/wp-*`, `/.git`) → 404.
- Damit Befunde #1–#7 des 2026-06-09-Reviews geschlossen (außer #7
  Pro-Preset-Detailseiten — bleibt bewusst offen).
