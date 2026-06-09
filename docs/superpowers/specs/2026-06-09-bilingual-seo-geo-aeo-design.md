# Bilingual (DE+EN) + GEO/SEO/AEO-Politur — Design

Stand: 2026-06-09 · Domain: `https://lumen.mr-development.de`

Ziel: Lumen · light als **leichtgewichtige, kostenlose, browser-basierte
Lightroom-Alternative für RAW-Entwicklung** auffindbar machen — bei
klassischer Suche (SEO), AI-/Generative-Engines (GEO) und
Answer-Engines (AEO). Aufbauend auf `docs/seo-geo-aeo-review.md`
(Block 1 Technik + Block 2 Content sind bereits live).

## Ausgangslage

Der bestehende SEO-Stand ist reif: Meta/OG/Twitter/Canonical,
`SoftwareApplication`- + `FAQPage`-JSON-LD im rohen HTML, echtes
Prerendering von `/`, `/datenschutz`, `/impressum`, `robots.txt`,
generierte `sitemap.xml`, AGPL-Repo public. **Aber**: alles Deutsch,
eine Content-Seite, und ein paar konkrete Crawl-Lücken.

## Befunde (Review 2026-06-09)

| # | Ebene | Befund |
|---|-------|--------|
| 1 | SEO | `/marketplace` steht in der sitemap, ist aber NICHT prerendert → Crawler bekommen Landing-Fallback (`id="root"` + Landing-H1) statt Marketplace-Inhalt. |
| 2 | SEO | H1 „RAW im Browser entwickeln." enthält weder „Lightroom-Alternative" noch „kostenlos"; `<title>` führt mit Brand statt Kern-Keyword. |
| 3 | GEO | Kein `llms.txt` (das Live-200 ist der nginx-Catch-all, keine echte Datei). |
| 4 | SEO/GEO | nginx liefert für JEDEN unbekannten Pfad 200 + index.html → Soft-404s (auch `/wp-config.php`, Scanner bekommen 200). |
| 5 | Reichweite | Alles Deutsch (`lang="de"`). „free Lightroom alternative", „open source Lightroom", „RAW editor browser" wird überwiegend englisch gesucht — größter ungenutzter Hebel. |
| 6 | SEO/AEO | Nur eine Content-Seite; Kern-Keywords nicht in den stärksten Signalen (H1/Title/erste Absätze). |
| 7 | GEO | JSON-LD ausbaufähig (`inLanguage`, `Organization`-Publisher, `HowTo`). Kein Fake-`AggregateRating` (0 echte Ratings). |

## Entscheidungen

- **Zielmarkt:** Zweisprachig **DE + EN**.
- **Umfang:** On-Page + Technik + GEO-Politur. **Nicht** dabei:
  zusätzliche Keyword-Landingpages, Off-Page-Drafts, indexierbare
  Pro-Preset-Seiten (#7 bleibt offen), EN-Rechtsseiten.
- **`x-default` → `/en`** (fängt die internationale Nachfrage).
- **`HowTo`-JSON-LD** wird mitgenommen.

## Architektur

### A. i18n via geteiltes Content-Modul (kein Framework)

Neues Modul `frontend/src/i18n/content.ts` als **Single Source** für
alle sichtbaren Landing-/Header-Strings und die Meta-Daten, getrennt
nach Locale:

```ts
export type Locale = "de" | "en";
export interface LandingContent {
  meta: { title: string; description: string; ogTitle: string };
  hero: { h1: string; tagline: string; ctaPrimary: string; ctaDemo: string };
  features: { title: string; body: string }[];
  selfhost: { heading: string; body: string };
  compare: { heading: string; intro: string; rows: [string, string, string][] };
  faq: { q: string; a: string }[];
}
export const CONTENT: Record<Locale, LandingContent> = { de: {...}, en: {...} };
```

Begründung gegen eine i18n-Library: nur zwei statische Seiten; der
Landing-Einstiegspfad soll bewusst leicht bleiben (keine schweren Libs,
siehe bestehendes Review). Begründung gegen `LandingEn.tsx`-Duplikat:
Layout-Drift.

`Landing.tsx` wird locale-aware: Prop `lang: Locale` (Default `"de"`),
liest `CONTENT[lang]`. Layout/Styling bleiben identisch. `Header`
bekommt einen schlanken DE/EN-Umschalter (zwei `Link`s, aktive Locale
hervorgehoben).

### B. Strukturierte Daten aus derselben Quelle generieren

Ein Builder `frontend/src/i18n/structuredData.ts` erzeugt aus
`CONTENT[lang]` die JSON-LD-Objekte:

- `SoftwareApplication` (mit `inLanguage`, `Organization`-Publisher,
  `offers` price 0, `featureList`, `author`, `sameAs`).
- `FAQPage` (aus `CONTENT[lang].faq` — **deckungsgleich per
  Konstruktion**, beseitigt die heutige „index.html-JSON-LD manuell
  synchron halten"-Falle aus dem alten Review).
- `HowTo` „RAW im Browser entwickeln / Develop RAW in your browser"
  (Schritte: Bild öffnen → Auto-Ton → Regler/Masken → Export).

Diese JSON-LD-Blöcke werden beim Prerender pro Route in den `<head>`
injiziert (siehe D). Kein Fake-`AggregateRating`.

### C. URL- & Crawl-Struktur

- DE bleibt auf `/` (keine Breakage bestehender Links/Canonical/Backlinks).
- EN auf **`/en`**, als Flat-File `en.html` (gleiches no-301-Schema wie
  `datenschutz.html`; nginx `try_files $uri.html`).
- **hreflang** auf `/` und `/en`:
  `de`→`https://…/`, `en`→`https://…/en`, `x-default`→`https://…/en`.
- App-Router (`App.tsx`): neue Route `/en` → `<Landing lang="en" />`.
  `/` bleibt `<Landing lang="de" />`.

### D. Prerender-Anpassungen

- `entry-server.tsx`: `PRERENDER_ROUTES` um `/en` (und `/marketplace`,
  siehe F) erweitern. `Shell` rendert `/en` mit `lang="en"`. Die
  pro-Locale-JSON-LD-Blöcke werden im Prerender erzeugt und in den Head
  geschrieben.
- `prerender.mjs`: `ROUTE_META` um `/en` → `en.html` (EN title/desc/og),
  hreflang-Alternates für `/` und `/en`, locale-korrektes JSON-LD.
  `sitemap.xml`-Generierung um `/en` inkl. `xhtml:link`-hreflang-Alternates.
- `index.html`: hreflang-Alternates (`de`/`en`/`x-default`) ergänzen.
  Das bisher handgepflegte DE-JSON-LD wird durch den generierten Block
  ersetzt (Konsistenz mit `/en`).

### E. Keyword-Schärfung (in `content.ts`)

- **DE** title: „Kostenlose Lightroom-Alternative im Browser — Lumen · light".
  H1: „Die kostenlose Lightroom-Alternative im Browser"; Tagline:
  „RAW entwickeln im Browser — ohne Abo, ohne Cloud-Zwang."
- **EN** title: „Free Lightroom Alternative in Your Browser — Lumen".
  H1: „The free, browser-based Lightroom alternative for RAW".
- „leichtgewichtig/lightweight", „kostenlos/free", „open source (AGPL)"
  früh im Text. 2–3 neue FAQ-Einträge (Open-Source? / Ohne Installation? /
  Welche Kameras/Marken?), DE+EN, automatisch im JSON-LD gespiegelt.

### F. `/marketplace`-Prerender (Befund #1)

Statische, SSR-sichere Intro-Sektion in `Marketplace.tsx` (immer
gerendert, oberhalb der dynamischen Liste): Überschrift
„Kostenlose Presets / Free presets" + Erklärtext (was der Marketplace
ist, dass Stöbern ohne Konto geht). Der client-seitige Daten-Fetch wird
`typeof window`-guarded, damit `renderToString` nicht crasht. `/marketplace`
kommt in `PRERENDER_ROUTES` (Flat-File `marketplace.html`) mit eigener
title/description.

### G. `llms.txt` (Befund #3)

`frontend/public/llms.txt` — kompakte EN-Faktenseite für AI-Engines:
Was Lumen ist (free, lightweight, self-hosted Lightroom alternative),
Preis, RAW-Formate, Selfhost-Stack, Links zu `/`, `/en`, GitHub. Wird
als statisches Asset ausgeliefert.

### H. nginx-Härtung (Befund #4)

`frontend/nginx.conf`: vor dem SPA-Fallback einen `location`-Block, der
typische Junk-/Scan-Pfade mit echtem **404** beantwortet statt SPA-200:
`*.php`, `*.env`, Dotfiles, `/wp-*`, `/.git`. SPA-Fallback für echte
App-Routen bleibt unverändert (`try_files $uri $uri.html $uri/ /index.html`).

## Nicht im Scope (YAGNI)

- Zusätzliche Keyword-Landingpages (`/lightroom-alternative` etc.).
- Off-Page-Einreich-Drafts (AlternativeTo, awesome-selfhosted, Show HN).
- Indexierbare Pro-Preset-Detailseiten (#7 bleibt offen).
- EN-Versionen von Impressum/Datenschutz (deutsches Recht; EN-Footer
  verlinkt auf die DE-Rechtsseiten).
- `AggregateRating`/Bewertungen (keine echten Daten).

## Tests & Verifikation

- `frontend/tests/Landing.test.tsx`: EN-Locale rendern; Assertion
  „sichtbare FAQ == generiertes `FAQPage`-JSON-LD" (für beide Locales);
  H1/Keyword-Präsenz.
- Neuer Test für `structuredData.ts` (valide JSON-LD-Form, FAQ-Sync).
- Prerender-Smoke: nach Build enthalten `dist/en.html` echten EN-Inhalt
  + hreflang; `dist/marketplace.html` echten Marketplace-Intro.
- nginx: `*.php`/`.env` → 404 (lokaler Container-Smoke oder Live-Check
  nach Deploy).
- Vor Push: `pnpm build && pnpm lint && pnpm test && pnpm exec tsc -b --noEmit`
  und (falls Backend berührt — hier nicht) `pytest -q`.

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `frontend/src/i18n/content.ts` | **neu** — DE+EN Single Source |
| `frontend/src/i18n/structuredData.ts` | **neu** — JSON-LD-Builder |
| `frontend/src/pages/Landing.tsx` | locale-aware (`lang`-Prop, liest CONTENT) |
| `frontend/src/pages/Marketplace.tsx` | SSR-sichere Intro-Sektion + window-Guard |
| `frontend/src/components/Header.tsx` | DE/EN-Umschalter |
| `frontend/src/App.tsx` | Route `/en` |
| `frontend/src/entry-server.tsx` | `/en` + `/marketplace` in PRERENDER_ROUTES, JSON-LD-Injektion |
| `frontend/scripts/prerender.mjs` | ROUTE_META `/en`+`/marketplace`, hreflang, sitemap-Alternates |
| `frontend/index.html` | hreflang-Alternates, JSON-LD aus generiertem Block |
| `frontend/public/llms.txt` | **neu** |
| `frontend/nginx.conf` | Junk-Pfade → 404 |
| `frontend/tests/Landing.test.tsx` | EN + Sync-Assertion |
| `frontend/tests/structuredData.test.ts` | **neu** |
| `docs/seo-geo-aeo-review.md` | Update-Notiz (DE+EN live, Befunde geschlossen) |
| `docs/06-roadmap.md` | Iterationsstand |

## Risiken / offene Punkte

- **SSR-Sicherheit Marketplace**: vor Prerender prüfen, dass die
  Komponente ohne `window`/Auth-Effekte rendert; sonst Intro in eine
  eigene SSR-sichere Teilkomponente extrahieren.
- **hreflang-Symmetrie**: `/` und `/en` müssen sich gegenseitig
  referenzieren, sonst ignoriert Google die Annotation.
- **Prerender-Head-Injektion**: bestehende `replaceOnce`-Muster sind
  fail-loud; neue JSON-LD-Injektion muss demselben Muster folgen
  (wirft bei Template-Drift statt still danebenzugehen).
