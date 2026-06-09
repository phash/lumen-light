# Bilingual (DE+EN) + GEO/SEO/AEO-Politur — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lumen als leichtgewichtige, kostenlose, browser-basierte Lightroom-Alternative zweisprachig (DE+EN) auffindbar machen und die GEO/SEO/AEO-Crawl-Luecken schliessen.

**Architecture:** Ein geteiltes i18n-Content-Modul (`content.ts`, DE+EN) ist Single Source fuer alle sichtbaren Landing-Strings UND fuer die JSON-LD-Generierung (`structuredData.ts`) — das beseitigt die bisherige „index.html-JSON-LD manuell synchron halten"-Falle. `Landing` wird locale-aware (`lang`-Prop), `/en` ist eine eigene Route + prerenderte Flat-File mit hreflang. Marketplace bekommt eine SSR-sichere Intro-Sektion, damit Crawler echten Inhalt statt Landing-Fallback sehen. Dazu: `llms.txt`, nginx-404 fuer Junk-Pfade, keyword-geschaerfte H1/Titles, `HowTo`-JSON-LD.

**Tech Stack:** React 19 + TypeScript strict, Vite (Client + `--ssr`), Vitest + Testing-Library, Node-Prerender (`scripts/prerender.mjs`), nginx (prod static).

**Spec:** `docs/superpowers/specs/2026-06-09-bilingual-seo-geo-aeo-design.md`

---

## File Structure

| Datei | Verantwortung |
|-------|---------------|
| `frontend/src/i18n/content.ts` | **neu** — Single Source: alle sichtbaren Strings + Meta, DE+EN |
| `frontend/src/i18n/structuredData.ts` | **neu** — baut JSON-LD (SoftwareApplication/FAQPage/HowTo) aus CONTENT |
| `frontend/src/pages/Landing.tsx` | locale-aware (`lang`-Prop, liest CONTENT) |
| `frontend/src/pages/MarketplaceIntro.tsx` | **neu** — pure, SSR-sichere Intro (kein Hook/window) |
| `frontend/src/pages/Marketplace.tsx` | rendert `<MarketplaceIntro>` oben |
| `frontend/src/components/Header.tsx` | DE/EN-Umschalter |
| `frontend/src/App.tsx` | Route `/en` |
| `frontend/src/entry-server.tsx` | `/en`+`/marketplace` prerendern, JSON-LD/hreflang exportieren |
| `frontend/scripts/prerender.mjs` | ROUTE_META + JSON-LD-Injektion + hreflang + sitemap |
| `frontend/index.html` | statisches JSON-LD raus (Generator ist Quelle), hreflang via Prerender |
| `frontend/public/llms.txt` | **neu** — GEO-Faktenseite fuer AI-Engines |
| `frontend/nginx.conf` | Junk-Pfade → 404 |
| `frontend/tests/i18nContent.test.ts` | **neu** |
| `frontend/tests/structuredData.test.ts` | **neu** |
| `frontend/tests/Landing.test.tsx` | DE+EN + Sync-Assertion |
| `frontend/tests/MarketplaceIntro.test.tsx` | **neu** |
| `docs/seo-geo-aeo-review.md` | Update-Notiz |
| `docs/06-roadmap.md` | Iterationsstand |

**Konvention (CLAUDE.md):** Code/Comments deutsch ohne Umlaute; **user-sichtbare UI-Strings mit echten Umlauten** (ä/ö/ü/ß). `data-testid` ist stabile Test-API.

---

## Task 1: i18n-Content-Modul (Single Source)

**Files:**
- Create: `frontend/src/i18n/content.ts`
- Test: `frontend/tests/i18nContent.test.ts`

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/i18nContent.test.ts
import { describe, expect, it } from "vitest";

import { CONTENT, LOCALES } from "../src/i18n/content";

describe("i18n CONTENT", () => {
  it("hat de und en mit gleicher FAQ- und Feature-Anzahl", () => {
    expect(LOCALES).toEqual(["de", "en"]);
    expect(CONTENT.de.faq.length).toBe(CONTENT.en.faq.length);
    expect(CONTENT.de.features.length).toBe(CONTENT.en.features.length);
    expect(CONTENT.de.compare.rows.length).toBe(CONTENT.en.compare.rows.length);
  });

  it("traegt die Kern-Keywords in H1 und Title", () => {
    expect(CONTENT.de.hero.h1).toMatch(/Lightroom-Alternative/i);
    expect(CONTENT.de.meta.title).toMatch(/kostenlose/i);
    expect(CONTENT.en.hero.h1).toMatch(/Lightroom alternative/i);
    expect(CONTENT.en.meta.title).toMatch(/free/i);
  });

  it("hat mindestens 9 FAQ-Eintraege je Locale", () => {
    expect(CONTENT.de.faq.length).toBeGreaterThanOrEqual(9);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm exec vitest run tests/i18nContent.test.ts`
Expected: FAIL — `Cannot find module '../src/i18n/content'`.

- [ ] **Step 3: Implement `content.ts`**

```ts
// frontend/src/i18n/content.ts
// Single Source fuer alle sichtbaren Landing-/Header-Strings + Meta, getrennt
// nach Locale. Wird ausserdem von structuredData.ts gelesen, damit JSON-LD und
// sichtbare Seite per Konstruktion deckungsgleich sind.

export type Locale = "de" | "en";
export const LOCALES: readonly Locale[] = ["de", "en"];

export interface Feature {
  readonly title: string;
  readonly body: string;
}
export interface FaqEntry {
  readonly q: string;
  readonly a: string;
}
export interface LandingContent {
  readonly meta: { readonly title: string; readonly description: string; readonly ogTitle: string };
  readonly hero: {
    readonly h1: string;
    readonly tagline: string;
    readonly ctaStartAnon: string;
    readonly ctaStartAuth: string;
    readonly ctaDemoAnon: string;
    readonly ctaDemoAuth: string;
  };
  readonly featuresHeading: string;
  readonly features: readonly Feature[];
  readonly selfhost: { readonly heading: string; readonly body: string };
  readonly compare: {
    readonly heading: string;
    readonly intro: string;
    readonly colLightroom: string;
    readonly rows: readonly (readonly [string, string, string])[];
  };
  readonly faqHeading: string;
  readonly faq: readonly FaqEntry[];
  readonly footer: { readonly privacy: string; readonly imprint: string };
  readonly marketplace: { readonly title: string; readonly description: string; readonly heading: string; readonly body: string };
  readonly howto: { readonly name: string; readonly steps: readonly string[] };
  readonly langSwitch: { readonly de: string; readonly en: string };
}

const de: LandingContent = {
  meta: {
    title: "Kostenlose Lightroom-Alternative im Browser — Lumen · light",
    description:
      "Lumen · light ist eine kostenlose, leichtgewichtige, selbst-hostbare Lightroom-Alternative: RAW direkt im Browser entwickeln — lokale Masken, HSL, Tonkurve, Auto-Ton. Ohne Abo, ohne Cloud-Zwang.",
    ogTitle: "Lumen · light — kostenlose Lightroom-Alternative im Browser",
  },
  hero: {
    h1: "Die kostenlose Lightroom-Alternative im Browser",
    tagline:
      "RAW entwickeln direkt im Browser — leichtgewichtig, ohne Abo, ohne Cloud-Zwang. Deine Bilder bleiben auf deinem Gerät.",
    ctaStartAnon: "Anmelden & starten",
    ctaStartAuth: "Im Editor starten",
    ctaDemoAnon: "Anmelden & ausprobieren",
    ctaDemoAuth: "Beispielbild ausprobieren",
  },
  featuresHeading: "Was Lumen kann",
  features: [
    {
      title: "Alle wichtigen Regler",
      body: "Belichtung, Kontrast, Lichter, Tiefen, Weiss, Schwarz, Temperatur, Tönung, Dynamik, Sättigung — die zehn klassischen Lightroom-Regler, vollständig im Browser via WebGL2.",
    },
    {
      title: "Echte RAW-Dateien",
      body: "CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF — direkt in der App geöffnet, ohne Server-Roundtrip. Embedded-Vorschau in unter 5 Sekunden.",
    },
    {
      title: "Lokale Anpassungen",
      body: "Bis zu 4 lineare Verlaufsfilter und 4 Radialmasken pro Bild — Belichtung, Kontrast, Sättigung, Temperatur lokal pro Bereich.",
    },
    {
      title: "Auto-Ton & Auto-WB",
      body: "Ein Klick — Histogramm-Analyse setzt Belichtung, Whites/Blacks, Kontrast und Weißabgleich auf vernünftige Werte. Gut für flaue Out-of-Camera-RAWs.",
    },
    {
      title: "Genre-Presets",
      body: "Portrait, Landschaft, Stadt, Natur, Tiere, Sport — moderate Voreinstellungen, die den Bild-Charakter unterstreichen, ohne zu übertreiben.",
    },
    {
      title: "Deine Daten",
      body: "Selbst-hostbar: Postgres + S3-kompatibles Garage, Keycloak für Login. Daten bleiben in deiner Hand — DELETE-/me und JSON-Export integriert.",
    },
  ],
  selfhost: {
    heading: "Selbsthosten",
    body: "FastAPI · React 19 · WebGL2 · Postgres · Keycloak · Garage S3 · Docker Compose. Production-fertig auf einem 4-GB-VPS.",
  },
  compare: {
    heading: "Lumen oder Lightroom?",
    intro:
      "Lumen ersetzt nicht jeden Profi-Workflow — aber für RAW-Entwicklung ohne Abo und ohne Cloud-Zwang deckt es die wichtigsten Schritte ab.",
    colLightroom: "Adobe Lightroom",
    rows: [
      ["Preis", "Kostenlos, selbst-hostbar", "Abo ab ~12 €/Monat"],
      ["Plattform", "Browser (WebGL2)", "Desktop + Cloud-App"],
      ["Deine Daten", "Bleiben bei dir", "Adobe Creative Cloud"],
      ["RAW im Browser", "Ja", "Nein (Desktop)"],
      ["Lokale Masken", "Linear + Radial", "Umfangreich (inkl. KI)"],
      ["Open Source", "Ja (AGPL-3.0)", "Nein"],
      ["Ohne Abo / offline", "Ja", "Nein"],
    ],
  },
  faqHeading: "Häufige Fragen",
  faq: [
    {
      q: "Was ist Lumen · light?",
      a: "Lumen ist eine kostenlose, selbst-hostbare, browser-basierte RAW-Foto-Entwicklung — eine leichtgewichtige Lightroom-Alternative. RAW-Dateien werden direkt im Browser via WebGL2 entwickelt, ohne Cloud-Zwang.",
    },
    {
      q: "Welche RAW-Formate unterstützt Lumen?",
      a: "CR2, CR3, NEF, ARW, RAF, DNG, RW2 und ORF — geöffnet via libraw-wasm direkt im Browser.",
    },
    {
      q: "Ist Lumen eine Lightroom-Alternative?",
      a: "Ja. Lumen bietet die klassischen Regler (Belichtung, Kontrast, Lichter, Tiefen, HSL, Tonkurve), lokale Masken und Presets — als selbst-hostbare, abofreie Web-App.",
    },
    {
      q: "Kann ich Lumen selbst hosten?",
      a: "Ja, via Docker Compose (FastAPI, React, Postgres, Keycloak, S3). Läuft auf einem kleinen VPS.",
    },
    {
      q: "Kostet Lumen etwas?",
      a: "Nein. Lumen ist kostenlos und selbst-hostbar — kein Abo, keine Cloud-Pflicht.",
    },
    {
      q: "Bleiben meine Bilder privat?",
      a: "Ja. Die Bildverarbeitung läuft lokal im Browser; Bilder bleiben auf deinem Gerät, außer du sicherst sie bewusst im eigenen Storage.",
    },
    {
      q: "Ist Lumen Open Source?",
      a: "Ja. Lumen steht unter der AGPL-3.0 und ist auf GitHub einsehbar — du kannst es selbst hosten, anpassen und weitergeben.",
    },
    {
      q: "Muss ich etwas installieren?",
      a: "Nein. Lumen läuft komplett im Browser via WebGL2 — keine Desktop-Installation, kein Plugin.",
    },
    {
      q: "Welche Kameras werden unterstützt?",
      a: "RAW von Canon, Nikon, Sony, Fujifilm, Panasonic und Olympus — über die Formate CR2, CR3, NEF, ARW, RAF, DNG, RW2 und ORF.",
    },
  ],
  footer: { privacy: "Datenschutz", imprint: "Impressum" },
  marketplace: {
    title: "Kostenlose Presets — Lumen · light Marketplace",
    description:
      "Kostenlose Foto-Presets für Lumen · light, die browser-basierte Lightroom-Alternative. Ohne Konto stöbern, mit einem Klick anwenden.",
    heading: "Kostenlose Presets",
    body: "Stöbere ohne Konto durch von der Community geteilte Presets für Lumen · light — die kostenlose, browser-basierte Lightroom-Alternative. Anwenden und Forken brauchen nur einen kostenlosen Login.",
  },
  howto: {
    name: "RAW im Browser entwickeln",
    steps: [
      "RAW-Datei in Lumen öffnen — die Vorschau erscheint in unter 5 Sekunden.",
      "Auto-Ton und Auto-Weißabgleich mit einem Klick als Startpunkt setzen.",
      "Mit Reglern, HSL, Tonkurve und lokalen Masken feinabstimmen.",
      "Das Ergebnis in voller Auflösung exportieren.",
    ],
  },
  langSwitch: { de: "DE", en: "EN" },
};

const en: LandingContent = {
  meta: {
    title: "Free Lightroom Alternative in Your Browser — Lumen",
    description:
      "Lumen is a free, lightweight, self-hostable Lightroom alternative: develop RAW photos right in your browser — local masks, HSL, tone curve, auto-tone. No subscription, no forced cloud.",
    ogTitle: "Lumen — free Lightroom alternative in your browser",
  },
  hero: {
    h1: "The free, browser-based Lightroom alternative for RAW",
    tagline:
      "Develop RAW photos right in your browser — lightweight, no subscription, no forced cloud. Your images stay on your device.",
    ctaStartAnon: "Sign in & start",
    ctaStartAuth: "Open the editor",
    ctaDemoAnon: "Sign in & try it",
    ctaDemoAuth: "Try a sample image",
  },
  featuresHeading: "What Lumen does",
  features: [
    {
      title: "All the key sliders",
      body: "Exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, vibrance, saturation — the ten classic Lightroom sliders, fully in the browser via WebGL2.",
    },
    {
      title: "Real RAW files",
      body: "CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF — opened directly in the app, no server round-trip. Embedded preview in under 5 seconds.",
    },
    {
      title: "Local adjustments",
      body: "Up to 4 linear gradient filters and 4 radial masks per image — exposure, contrast, saturation and temperature locally per region.",
    },
    {
      title: "Auto-tone & auto-WB",
      body: "One click — histogram analysis sets exposure, whites/blacks, contrast and white balance to sensible values. Great for flat out-of-camera RAWs.",
    },
    {
      title: "Genre presets",
      body: "Portrait, landscape, city, nature, animals, sport — moderate presets that bring out an image's character without overdoing it.",
    },
    {
      title: "Your data",
      body: "Self-hostable: Postgres + S3-compatible Garage, Keycloak for login. Your data stays yours — DELETE /me and JSON export built in.",
    },
  ],
  selfhost: {
    heading: "Self-hosting",
    body: "FastAPI · React 19 · WebGL2 · Postgres · Keycloak · Garage S3 · Docker Compose. Production-ready on a 4 GB VPS.",
  },
  compare: {
    heading: "Lumen or Lightroom?",
    intro:
      "Lumen does not replace every pro workflow — but for RAW development without a subscription or forced cloud it covers the most important steps.",
    colLightroom: "Adobe Lightroom",
    rows: [
      ["Price", "Free, self-hostable", "Subscription from ~$10/month"],
      ["Platform", "Browser (WebGL2)", "Desktop + cloud app"],
      ["Your data", "Stays with you", "Adobe Creative Cloud"],
      ["RAW in the browser", "Yes", "No (desktop)"],
      ["Local masks", "Linear + radial", "Extensive (incl. AI)"],
      ["Open source", "Yes (AGPL-3.0)", "No"],
      ["No subscription / offline", "Yes", "No"],
    ],
  },
  faqHeading: "Frequently asked questions",
  faq: [
    {
      q: "What is Lumen?",
      a: "Lumen is a free, self-hostable, browser-based RAW photo developer — a lightweight Lightroom alternative. RAW files are developed directly in the browser via WebGL2, with no forced cloud.",
    },
    {
      q: "Which RAW formats does Lumen support?",
      a: "CR2, CR3, NEF, ARW, RAF, DNG, RW2 and ORF — opened via libraw-wasm directly in the browser.",
    },
    {
      q: "Is Lumen a Lightroom alternative?",
      a: "Yes. Lumen offers the classic sliders (exposure, contrast, highlights, shadows, HSL, tone curve), local masks and presets — as a self-hostable, subscription-free web app.",
    },
    {
      q: "Can I self-host Lumen?",
      a: "Yes, via Docker Compose (FastAPI, React, Postgres, Keycloak, S3). Runs on a small VPS.",
    },
    {
      q: "Does Lumen cost anything?",
      a: "No. Lumen is free and self-hostable — no subscription, no mandatory cloud.",
    },
    {
      q: "Do my images stay private?",
      a: "Yes. Image processing runs locally in the browser; images stay on your device unless you deliberately save them to your own storage.",
    },
    {
      q: "Is Lumen open source?",
      a: "Yes. Lumen is licensed under AGPL-3.0 and available on GitHub — you can self-host, modify and redistribute it.",
    },
    {
      q: "Do I need to install anything?",
      a: "No. Lumen runs entirely in the browser via WebGL2 — no desktop install, no plugin.",
    },
    {
      q: "Which cameras are supported?",
      a: "RAW from Canon, Nikon, Sony, Fujifilm, Panasonic and Olympus — via the formats CR2, CR3, NEF, ARW, RAF, DNG, RW2 and ORF.",
    },
  ],
  footer: { privacy: "Privacy", imprint: "Imprint" },
  marketplace: {
    title: "Free presets — Lumen Marketplace",
    description:
      "Free photo presets for Lumen, the browser-based Lightroom alternative. Browse without an account, apply in one click.",
    heading: "Free presets",
    body: "Browse community-shared presets for Lumen — the free, browser-based Lightroom alternative — without an account. Applying and forking just need a free login.",
  },
  howto: {
    name: "Develop RAW in your browser",
    steps: [
      "Open a RAW file in Lumen — the preview appears in under 5 seconds.",
      "Set a starting point with one-click auto-tone and auto white balance.",
      "Fine-tune with sliders, HSL, tone curve and local masks.",
      "Export the result at full resolution.",
    ],
  },
  langSwitch: { de: "DE", en: "EN" },
};

export const CONTENT: Record<Locale, LandingContent> = { de, en };
```

- [ ] **Step 4: Run, verify pass**

Run: `cd frontend && pnpm exec vitest run tests/i18nContent.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/content.ts frontend/tests/i18nContent.test.ts
git commit -m "feat(i18n): geteiltes DE+EN Content-Modul als Single Source"
```

---

## Task 2: JSON-LD-Builder aus CONTENT

**Files:**
- Create: `frontend/src/i18n/structuredData.ts`
- Test: `frontend/tests/structuredData.test.ts`

- [ ] **Step 1: Failing test**

```ts
// frontend/tests/structuredData.test.ts
import { describe, expect, it } from "vitest";

import { CONTENT, LOCALES } from "../src/i18n/content";
import { buildJsonLd, jsonLdScripts } from "../src/i18n/structuredData";

describe("structuredData", () => {
  it.each(LOCALES)("FAQPage ist deckungsgleich mit CONTENT.%s.faq", (loc) => {
    const blocks = buildJsonLd(loc);
    const faq = blocks.find((b) => b["@type"] === "FAQPage");
    expect(faq).toBeDefined();
    const names = (faq!.mainEntity as { name: string }[]).map((q) => q.name);
    expect(names).toEqual(CONTENT[loc].faq.map((f) => f.q));
  });

  it("liefert SoftwareApplication mit Preis 0 und ohne aggregateRating", () => {
    const blocks = buildJsonLd("en");
    const app = blocks.find((b) => b["@type"] === "SoftwareApplication");
    expect(app).toBeDefined();
    expect((app!.offers as { price: string }).price).toBe("0");
    expect(app!.aggregateRating).toBeUndefined();
    expect(app!.inLanguage).toBe("en");
  });

  it("liefert eine HowTo mit den CONTENT-Schritten", () => {
    const blocks = buildJsonLd("de");
    const howto = blocks.find((b) => b["@type"] === "HowTo");
    expect(howto).toBeDefined();
    expect((howto!.step as unknown[]).length).toBe(CONTENT.de.howto.steps.length);
  });

  it("jsonLdScripts rendert valides <script>-Markup", () => {
    const html = jsonLdScripts("de");
    expect(html).toContain('<script type="application/ld+json">');
    // Parsebar: alle JSON-Bloecke wieder einlesbar
    const jsons = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(jsons.length).toBe(3);
    for (const m of jsons) expect(() => { JSON.parse(m[1]!); }).not.toThrow();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm exec vitest run tests/structuredData.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `structuredData.ts`**

```ts
// frontend/src/i18n/structuredData.ts
// Baut die JSON-LD-Bloecke (SoftwareApplication, FAQPage, HowTo) aus CONTENT.
// Damit sind sichtbare Seite und Structured-Data per Konstruktion synchron.

import { CONTENT, type Locale } from "./content";

const BASE = "https://lumen.mr-development.de";

// Lockerer Record-Typ: JSON-LD ist heterogen; @type erlaubt das Filtern im Test.
export type JsonLdBlock = Record<string, unknown> & { "@type": string };

export function buildJsonLd(locale: Locale): JsonLdBlock[] {
  const c = CONTENT[locale];
  const url = locale === "de" ? `${BASE}/` : `${BASE}/en`;

  const software: JsonLdBlock = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lumen · light",
    applicationCategory: "MultimediaApplication",
    applicationSubCategory: "RAW Photo Editor",
    operatingSystem: "Web",
    url,
    inLanguage: locale,
    description: c.meta.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
    featureList: c.features.map((f) => f.title),
    softwareVersion: "0.1.0",
    author: { "@type": "Person", name: "Manuel Rödig" },
    publisher: { "@type": "Organization", name: "Lumen · light", url: BASE },
    sameAs: ["https://github.com/phash/lumen-light"],
  };

  const faq: JsonLdBlock = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: locale,
    mainEntity: c.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  const howto: JsonLdBlock = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    inLanguage: locale,
    name: c.howto.name,
    step: c.howto.steps.map((text, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      text,
    })),
  };

  return [software, faq, howto];
}

// Rendert die JSON-LD-Bloecke als <script>-Markup-String fuer die Head-Injektion
// im Prerender. Wird von entry-server.tsx re-exportiert (Node-Prerender liest
// das aus dem SSR-Bundle).
export function jsonLdScripts(locale: Locale): string {
  return buildJsonLd(locale)
    .map(
      (block) =>
        `<script type="application/ld+json">\n${JSON.stringify(block, null, 2)}\n</script>`,
    )
    .join("\n    ");
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd frontend && pnpm exec vitest run tests/structuredData.test.ts`
Expected: PASS (6 cases: 2 locale FAQ + 3 single).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/i18n/structuredData.ts frontend/tests/structuredData.test.ts
git commit -m "feat(i18n): JSON-LD aus CONTENT generieren (FAQ-Sync per Konstruktion)"
```

---

## Task 3: Landing locale-aware

**Files:**
- Modify: `frontend/src/pages/Landing.tsx` (komplett ersetzen)
- Test: `frontend/tests/Landing.test.tsx` (ersetzen)

- [ ] **Step 1: Failing test (DE + EN aus CONTENT)**

```tsx
// frontend/tests/Landing.test.tsx
import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { CONTENT } from "../src/i18n/content";
import Landing from "../src/pages/Landing";
import { makeFakeAuth, renderWithAuth } from "./test-utils";

function renderLanding(lang: "de" | "en" = "de") {
  return renderWithAuth(<Landing lang={lang} />, {
    auth: makeFakeAuth({ isAuthenticated: false }),
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
}

describe("Landing", () => {
  it("rendert die DE-H1 mit Kern-Keyword", () => {
    renderLanding("de");
    expect(
      screen.getByRole("heading", { level: 1, name: /Lightroom-Alternative/i }),
    ).toBeInTheDocument();
  });

  it("rendert die EN-H1 mit Kern-Keyword", () => {
    renderLanding("en");
    expect(
      screen.getByRole("heading", { level: 1, name: /Lightroom alternative/i }),
    ).toBeInTheDocument();
  });

  it.each(["de", "en"] as const)(
    "zeigt jede FAQ-Frage sichtbar (Sync mit JSON-LD-Quelle) — %s",
    (loc) => {
      renderLanding(loc);
      const faq = screen.getByTestId("landing-faq");
      for (const { q } of CONTENT[loc].faq) {
        expect(faq.textContent).toContain(q);
      }
    },
  );

  it("rendert den Vergleichsblock mit beiden Produkten", () => {
    renderLanding("de");
    const compare = screen.getByTestId("landing-compare");
    expect(compare.textContent).toMatch(/Lightroom/);
    expect(compare.textContent).toMatch(/Lumen/);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm exec vitest run tests/Landing.test.tsx`
Expected: FAIL — `Landing` akzeptiert noch keine `lang`-Prop / EN-H1 fehlt.

- [ ] **Step 3: Implement `Landing.tsx`**

```tsx
// frontend/src/pages/Landing.tsx
import { Link } from "react-router-dom";
import { useAuth } from "react-oidc-context";

import { CONTENT, type Locale } from "../i18n/content";

interface LandingProps {
  readonly lang?: Locale;
}

export default function Landing({ lang = "de" }: LandingProps) {
  const auth = useAuth();
  const c = CONTENT[lang];
  const startHref = auth.isAuthenticated ? "/editor" : "/login";

  return (
    <section data-testid="page-landing" className="min-h-[calc(100vh-3rem)]">
      {/* Hero */}
      <div className="px-8 py-16 max-w-4xl mx-auto">
        <h1 className="text-5xl text-stone-100 leading-tight">{c.hero.h1}</h1>
        <p className="mt-6 text-xl text-stone-400 max-w-xl">{c.hero.tagline}</p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            to={startHref}
            data-testid="landing-cta-primary"
            className="px-6 py-3 text-sm uppercase tracking-[0.2em] bg-amber-200/15 border border-amber-300 text-amber-200 hover:bg-amber-200/25"
          >
            {auth.isAuthenticated ? c.hero.ctaStartAuth : c.hero.ctaStartAnon}
          </Link>
          <Link
            to={startHref}
            data-testid="landing-cta-demo"
            className="px-6 py-3 text-sm uppercase tracking-[0.2em] border border-stone-700 text-stone-300 hover:border-amber-300/40"
          >
            {auth.isAuthenticated ? c.hero.ctaDemoAuth : c.hero.ctaDemoAnon}
          </Link>
        </div>
      </div>

      {/* Feature-Grid */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-10">
          <h2 className="col-span-full text-2xl text-stone-200">{c.featuresHeading}</h2>
          {c.features.map((f) => (
            <div key={f.title}>
              <h3 className="text-stone-200 italic">{f.title}</h3>
              <p className="mt-2 text-sm text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tech / Repo */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-stone-300 italic">{c.selfhost.heading}</h2>
          <p className="mt-3 text-stone-400">{c.selfhost.body}</p>
        </div>
      </div>

      {/* Vergleich */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto" data-testid="landing-compare">
          <h2 className="text-2xl text-stone-200">{c.compare.heading}</h2>
          <p className="mt-3 text-stone-400 max-w-2xl">{c.compare.intro}</p>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-stone-300 border-b border-stone-700">
                  <th className="py-2 pr-4 font-normal" scope="col">&nbsp;</th>
                  <th className="py-2 pr-4 font-medium text-amber-200" scope="col">
                    Lumen · light
                  </th>
                  <th className="py-2 pr-4 font-normal" scope="col">
                    {c.compare.colLightroom}
                  </th>
                </tr>
              </thead>
              <tbody className="text-stone-400">
                {c.compare.rows.map(([label, lumen, lr]) => (
                  <tr key={label} className="border-b border-stone-800/60">
                    <th scope="row" className="py-2 pr-4 font-normal text-stone-300">
                      {label}
                    </th>
                    <td className="py-2 pr-4 text-stone-200">{lumen}</td>
                    <td className="py-2 pr-4">{lr}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="px-8 py-12 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto" data-testid="landing-faq">
          <h2 className="text-2xl text-stone-200">{c.faqHeading}</h2>
          <div className="mt-6 divide-y divide-stone-800/60">
            {c.faq.map(({ q, a }) => (
              <details key={q} className="group py-3">
                <summary className="cursor-pointer text-stone-200 marker:text-amber-300/60 hover:text-amber-200">
                  {q}
                </summary>
                <p className="mt-2 text-sm text-stone-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-8 py-6 border-t border-stone-800/60">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-4 text-xs text-stone-500">
          <Link to="/datenschutz" className="hover:text-stone-300">{c.footer.privacy}</Link>
          <Link to="/impressum" className="hover:text-stone-300">{c.footer.imprint}</Link>
          <a
            href="https://github.com/phash/lumen-light"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-github"
            className="hover:text-stone-300"
          >
            GitHub
          </a>
          <a
            href="https://buymeacoffee.com/phash"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="landing-bmac"
            className="ml-auto text-amber-200/80 hover:text-amber-200"
          >
            ☕ Buy me a coffee
          </a>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `cd frontend && pnpm exec vitest run tests/Landing.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Landing.tsx frontend/tests/Landing.test.tsx
git commit -m "feat(landing): locale-aware Landing aus CONTENT (DE+EN)"
```

---

## Task 4: Header-Sprachumschalter

**Files:**
- Modify: `frontend/src/components/Header.tsx`

- [ ] **Step 1: Add language switch in the `<nav>` right-side group**

In `Header.tsx`, im rechten `<div className="flex items-center gap-3 text-sm">`-Block (vor dem Login/Logout-Conditional) diese Sprach-Links einfuegen:

```tsx
        <div className="flex items-center gap-3 text-sm">
          {/* Sprachumschalter — Landing DE auf /, EN auf /en */}
          <span className="hidden sm:flex items-center gap-1 text-xs" data-testid="lang-switch">
            <a href="/" className="text-stone-400 hover:text-amber-200" hrefLang="de" aria-label="Deutsch">
              DE
            </a>
            <span className="text-stone-600">/</span>
            <a href="/en" className="text-stone-400 hover:text-amber-200" hrefLang="en" aria-label="English">
              EN
            </a>
          </span>
          {auth.isAuthenticated ? (
```

(Bewusst native `<a>` statt `NavLink`: `/` und `/en` sind prerenderte
Flat-Files — ein echter Navigationswechsel laedt die locale-korrekte HTML
inkl. passendem JSON-LD/hreflang, statt nur client-seitig umzurouten.)

- [ ] **Step 2: Build/typecheck check**

Run: `cd frontend && pnpm exec tsc -b --noEmit`
Expected: PASS (kein Typfehler).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/Header.tsx
git commit -m "feat(header): DE/EN-Sprachumschalter"
```

---

## Task 5: Marketplace-Intro (SSR-sicher) + Einbindung

**Files:**
- Create: `frontend/src/pages/MarketplaceIntro.tsx`
- Modify: `frontend/src/pages/Marketplace.tsx`
- Test: `frontend/tests/MarketplaceIntro.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
// frontend/tests/MarketplaceIntro.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CONTENT } from "../src/i18n/content";
import MarketplaceIntro from "../src/pages/MarketplaceIntro";

describe("MarketplaceIntro", () => {
  it.each(["de", "en"] as const)("rendert Heading + Body — %s", (loc) => {
    render(<MarketplaceIntro lang={loc} />);
    expect(
      screen.getByRole("heading", { level: 1, name: CONTENT[loc].marketplace.heading }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("marketplace-intro").textContent).toContain(
      CONTENT[loc].marketplace.body.slice(0, 20),
    );
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `cd frontend && pnpm exec vitest run tests/MarketplaceIntro.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `MarketplaceIntro.tsx` (pure, keine Hooks/window)**

```tsx
// frontend/src/pages/MarketplaceIntro.tsx
// Pure, SSR-sichere Intro-Sektion fuer den Marketplace. Wird sowohl live (oben
// in Marketplace.tsx) als auch im Prerender (/marketplace) gerendert — damit
// Crawler echten Inhalt statt Landing-Fallback sehen. KEINE Hooks, kein window.
import { CONTENT, type Locale } from "../i18n/content";

interface Props {
  readonly lang?: Locale;
}

export default function MarketplaceIntro({ lang = "de" }: Props) {
  const m = CONTENT[lang].marketplace;
  return (
    <div data-testid="marketplace-intro" className="px-8 pt-10 max-w-4xl mx-auto">
      <h1 className="text-3xl text-stone-100">{m.heading}</h1>
      <p className="mt-3 text-stone-400 max-w-2xl">{m.body}</p>
    </div>
  );
}
```

- [ ] **Step 4: Render it at the top of `Marketplace.tsx`**

In `frontend/src/pages/Marketplace.tsx`: Import ergaenzen und die Intro als
erstes Element im zurueckgegebenen JSX rendern.

Import (zu den bestehenden lokalen Imports):

```tsx
import MarketplaceIntro from "./MarketplaceIntro";
```

Im `return (...)` der Komponente die Intro als erstes Kind einfuegen. Beispiel
(Wrapper an bestehende Struktur anpassen — Intro VOR Filter/Liste):

```tsx
  return (
    <>
      <MarketplaceIntro lang="de" />
      {/* ... bestehender Marketplace-JSX (Filter, Liste, Modal) ... */}
    </>
  );
```

Falls das bestehende Top-Level-Element bereits ein Fragment/`<section>` ist,
die `<MarketplaceIntro lang="de" />` einfach als erstes Kind ergaenzen.

- [ ] **Step 5: Run tests**

Run: `cd frontend && pnpm exec vitest run tests/MarketplaceIntro.test.tsx && pnpm exec tsc -b --noEmit`
Expected: PASS + kein Typfehler.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/MarketplaceIntro.tsx frontend/src/pages/Marketplace.tsx frontend/tests/MarketplaceIntro.test.tsx
git commit -m "feat(marketplace): SSR-sichere Intro-Sektion fuer Prerender + SEO"
```

---

## Task 6: Route `/en` in App.tsx

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Make `/` DE-explicit and add `/en`**

In `App.tsx` die Landing-Route ersetzen/ergaenzen:

```tsx
            <Route path="/" element={<Landing lang="de" />} />
            <Route path="/en" element={<Landing lang="en" />} />
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm exec tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "feat(routing): /en-Route fuer englische Landing"
```

---

## Task 7: entry-server — /en + /marketplace prerendern, JSON-LD/hreflang exportieren

**Files:**
- Modify: `frontend/src/entry-server.tsx`

- [ ] **Step 1: Extend Shell routes + PRERENDER_ROUTES + exports**

`entry-server.tsx` anpassen:

1. Imports ergaenzen:

```tsx
import MarketplaceIntro from "./pages/MarketplaceIntro";
import { jsonLdScripts } from "./i18n/structuredData";
```

2. `PRERENDER_ROUTES` erweitern:

```tsx
export const PRERENDER_ROUTES: readonly string[] = [
  "/",
  "/en",
  "/marketplace",
  "/datenschutz",
  "/impressum",
];
```

3. In `Shell` die Routes ergaenzen (Landing DE auf `/`, EN auf `/en`,
   `/marketplace` rendert die pure Intro — NICHT die volle Marketplace-
   Komponente, die `useApi`/`window` braucht):

```tsx
          <Routes>
            <Route path="/" element={<Landing lang="de" />} />
            <Route path="/en" element={<Landing lang="en" />} />
            <Route path="/marketplace" element={<MarketplaceIntro lang="de" />} />
            <Route path="/datenschutz" element={<Datenschutz />} />
            <Route path="/impressum" element={<Impressum />} />
          </Routes>
```

4. Am Dateiende die Head-Bausteine fuer den Prerender exportieren:

```tsx
// Vom Node-Prerender (scripts/prerender.mjs) gelesen: locale-korrekte JSON-LD-
// Bloecke + hreflang-Alternates. Single Source dafuer ist structuredData.ts.
const BASE = "https://lumen.mr-development.de";
export const LANDING_JSONLD: Record<"de" | "en", string> = {
  de: jsonLdScripts("de"),
  en: jsonLdScripts("en"),
};
export const HREFLANG_HTML =
  `<link rel="alternate" hreflang="de" href="${BASE}/" />\n` +
  `    <link rel="alternate" hreflang="en" href="${BASE}/en" />\n` +
  `    <link rel="alternate" hreflang="x-default" href="${BASE}/en" />`;
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && pnpm exec tsc -b --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/entry-server.tsx
git commit -m "feat(prerender): /en + /marketplace + JSON-LD/hreflang-Exporte"
```

---

## Task 8: prerender.mjs — ROUTE_META, JSON-LD-Injektion, hreflang, sitemap

**Files:**
- Modify: `frontend/scripts/prerender.mjs`
- Modify: `frontend/index.html`

- [ ] **Step 1: index.html — statisches JSON-LD entfernen, hreflang-Marker setzen**

In `frontend/index.html`: die ZWEI `<script type="application/ld+json">…</script>`-
Bloecke (SoftwareApplication + FAQPage) loeschen und durch einen Marker-Kommentar
ersetzen (der Prerender fuellt ihn locale-korrekt):

```html
    <!-- JSON-LD wird beim Prerender locale-korrekt injiziert (structuredData.ts). -->
    <!-- LD_JSON_SLOT -->
```

Direkt nach dem `<link rel="canonical" … />` einen hreflang-Marker ergaenzen:

```html
    <link rel="canonical" href="https://lumen.mr-development.de/" />
    <!-- HREFLANG_SLOT -->
```

- [ ] **Step 2: prerender.mjs — Importe + ROUTE_META erweitern**

Import-Zeile erweitern:

```js
import { render, PRERENDER_ROUTES, LANDING_JSONLD, HREFLANG_HTML } from "../dist-ssr/entry-server.js";
```

`ROUTE_META` um `/en` und `/marketplace` ergaenzen und `/` + `/en` als
Landing-Locales markieren:

```js
const ROUTE_META = {
  "/": { file: "index.html", title: null, description: null, locale: "de" },
  "/en": {
    file: "en.html",
    title: "Free Lightroom Alternative in Your Browser — Lumen",
    description:
      "Lumen is a free, lightweight, self-hostable Lightroom alternative: develop RAW photos right in your browser — local masks, HSL, tone curve, auto-tone. No subscription, no forced cloud.",
    locale: "en",
  },
  "/marketplace": {
    file: "marketplace.html",
    title: "Kostenlose Presets — Lumen · light Marketplace",
    description:
      "Kostenlose Foto-Presets für Lumen · light, die browser-basierte Lightroom-Alternative. Ohne Konto stöbern, mit einem Klick anwenden.",
  },
  "/datenschutz": {
    file: "datenschutz.html",
    title: "Datenschutz — Lumen · light",
    description:
      "Datenschutzerklärung von Lumen · light: welche Daten verarbeitet werden, Matomo-Analyse und deine Rechte nach DSGVO.",
  },
  "/impressum": {
    file: "impressum.html",
    title: "Impressum — Lumen · light",
    description: "Impressum und Anbieterkennzeichnung von Lumen · light nach TMG/DDG.",
  },
};
```

- [ ] **Step 3: prerender.mjs — applyHead: JSON-LD + hreflang einsetzen**

Den bestehenden JSON-LD-Block am Ende von `applyHead` (die `if (route !== "/")`-
Strip-Logik) durch eine locale-gesteuerte Injektion ersetzen:

```js
  // hreflang nur fuer das de/en-Landing-Cluster; Rechtsseiten/Marketplace ohne.
  const HREFLANG_RE = /\s*<!-- HREFLANG_SLOT -->/;
  if (meta.locale) {
    out = replaceOnce(out, HREFLANG_RE, `\n    ${HREFLANG_HTML}`, route, "hreflang");
  } else if (HREFLANG_RE.test(out)) {
    out = out.replace(HREFLANG_RE, "");
  }

  // JSON-LD: Landing-Locales bekommen den generierten Block, alle anderen Routen
  // bekommen KEIN JSON-LD (Slot leer entfernen) — verhindert FAQPage ohne FAQ.
  const LD_RE = /\s*<!-- LD_JSON_SLOT -->/;
  if (meta.locale) {
    out = replaceOnce(out, LD_RE, `\n    ${LANDING_JSONLD[meta.locale]}`, route, "ld-json");
  } else if (LD_RE.test(out)) {
    out = out.replace(LD_RE, "");
  }
  return out;
}
```

(Die alte `if (route !== "/") { out = out.replace(/<script type="application\/ld\+json">…/g, "") }`-
Passage ENTFAELLT — es gibt kein statisches JSON-LD mehr im Template.)

- [ ] **Step 4: prerender.mjs — sitemap mit /en + hreflang-Alternates**

`SITEMAP` + Generator ersetzen:

```js
const SITEMAP = [
  { loc: `${BASE}/`, freq: "weekly", priority: "1.0", alt: { de: `${BASE}/`, en: `${BASE}/en` } },
  { loc: `${BASE}/en`, freq: "weekly", priority: "1.0", alt: { de: `${BASE}/`, en: `${BASE}/en` } },
  { loc: `${BASE}/marketplace`, freq: "weekly", priority: "0.8" },
  { loc: `${BASE}/datenschutz`, freq: "yearly", priority: "0.3" },
  { loc: `${BASE}/impressum`, freq: "yearly", priority: "0.3" },
];
const sitemap =
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
  SITEMAP.map(({ loc, freq, priority, alt }) => {
    const alts = alt
      ? `\n    <xhtml:link rel="alternate" hreflang="de" href="${alt.de}"/>` +
        `\n    <xhtml:link rel="alternate" hreflang="en" href="${alt.en}"/>` +
        `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${alt.en}"/>`
      : "";
    return `  <url>\n    <loc>${loc}</loc>\n    <changefreq>${freq}</changefreq>\n    <priority>${priority}</priority>${alts}\n  </url>`;
  }).join("\n") +
  `\n</urlset>\n`;
writeFileSync(resolve(DIST, "sitemap.xml"), sitemap, "utf8");
console.log(`prerender: sitemap.xml (${SITEMAP.length} URLs)`);
```

- [ ] **Step 5: Commit**

```bash
git add frontend/scripts/prerender.mjs frontend/index.html
git commit -m "feat(prerender): /en+/marketplace Flat-Files, JSON-LD/hreflang-Injektion, sitemap-Alternates"
```

---

## Task 9: Build-Smoke — Prerender-Output verifizieren

**Files:** (kein Code; Verifikation)

- [ ] **Step 1: Full build**

Run: `cd frontend && pnpm build`
Expected: Build OK; Prerender-Logs zeigen `/-> dist/index.html`, `/en -> dist/en.html`, `/marketplace -> dist/marketplace.html`, `sitemap.xml (5 URLs)`. Kein `replaceOnce`-Throw (keine Template-Drift).

- [ ] **Step 2: Assert EN-Seite**

Run:
```bash
cd frontend
grep -c "Lightroom alternative" dist/en.html
grep -c 'hreflang="x-default"' dist/en.html
grep -c '"inLanguage": "en"' dist/en.html
```
Expected: jeweils ≥1.

- [ ] **Step 3: Assert DE-Seite + Marketplace + sitemap**

Run:
```bash
cd frontend
grep -c '"inLanguage": "de"' dist/index.html      # DE-JSON-LD vorhanden
grep -c 'hreflang="de"' dist/index.html           # hreflang vorhanden
grep -c "Kostenlose Presets" dist/marketplace.html # Marketplace-Intro prerendert
grep -c "/en" dist/sitemap.xml                     # EN in sitemap
grep -c "application/ld+json" dist/datenschutz.html # = 0 (kein JSON-LD auf Rechtsseiten)
```
Expected: DE-JSON-LD ≥1, hreflang ≥1, Marketplace ≥1, sitemap ≥1, Datenschutz-JSON-LD = 0.

- [ ] **Step 4: Commit (falls Fixes noetig waren, sonst skip)**

```bash
git add -A && git commit -m "test(prerender): Build-Smoke fuer DE/EN/Marketplace gruen" || echo "nichts zu committen"
```

---

## Task 10: llms.txt

**Files:**
- Create: `frontend/public/llms.txt`

- [ ] **Step 1: Create the file**

```text
# Lumen · light

> A free, lightweight, self-hostable Lightroom alternative: develop RAW photos directly in your browser via WebGL2. No subscription, no forced cloud, open source (AGPL-3.0).

## What it is
- Free, browser-based RAW photo developer — a lightweight alternative to Adobe Lightroom.
- Runs entirely in the browser (WebGL2). No desktop install, no plugin.
- Self-hostable via Docker Compose (FastAPI, React, Postgres, Keycloak, S3-compatible Garage).
- Images are processed locally in the browser and stay on your device unless you save them to your own storage.

## Key facts
- Price: free (0 EUR), no subscription.
- License: AGPL-3.0, source on GitHub.
- RAW formats: CR2, CR3, NEF, ARW, RAF, DNG, RW2, ORF (Canon, Nikon, Sony, Fujifilm, Panasonic, Olympus).
- Editing: 10 classic sliders, HSL mixer, tone curve, up to 4 linear + 4 radial local masks, auto-tone, auto white balance, genre presets, full-resolution export.

## Links
- Home (German): https://lumen.mr-development.de/
- Home (English): https://lumen.mr-development.de/en
- Preset marketplace: https://lumen.mr-development.de/marketplace
- Source code: https://github.com/phash/lumen-light
```

- [ ] **Step 2: Verify it lands in the build**

Run: `cd frontend && pnpm build && test -f dist/llms.txt && echo OK`
Expected: `OK` (Vite kopiert `public/` → `dist/`).

- [ ] **Step 3: Commit**

```bash
git add frontend/public/llms.txt
git commit -m "feat(geo): llms.txt fuer AI-Engines"
```

---

## Task 11: nginx — Junk-Pfade → 404

**Files:**
- Modify: `frontend/nginx.conf`

- [ ] **Step 1: Add a 404 location block BEFORE `location /`**

In `frontend/nginx.conf`, vor dem `location / { try_files … }`-Block einfuegen:

```nginx
    # Bekannte Scan-/Junk-Pfade hart auf 404 statt SPA-Fallback (200 +
    # index.html) — vermeidet Soft-404s und gibt Scannern keinen 200.
    location ~* (\.php$|\.env$|/\.git|/wp-) {
        return 404;
    }
```

- [ ] **Step 2: Validate nginx config syntax**

Run:
```bash
docker run --rm -v "$PWD/frontend/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
```
Expected: `syntax is ok` / `test is successful`.
(Falls Docker nicht verfuegbar: visuell pruefen, dass der `location ~* (...)`-
Block syntaktisch korrekt vor `location /` steht.)

- [ ] **Step 3: Commit**

```bash
git add frontend/nginx.conf
git commit -m "fix(nginx): Junk-/Scan-Pfade auf 404 statt SPA-200"
```

---

## Task 12: Docs aktualisieren

**Files:**
- Modify: `docs/seo-geo-aeo-review.md`
- Modify: `docs/06-roadmap.md`

- [ ] **Step 1: Update-Notiz an `docs/seo-geo-aeo-review.md` anhaengen**

Am Ende ergaenzen:

```markdown
### Update (2026-06-09) — Bilingual DE+EN + GEO-Politur

- **Zweisprachig DE+EN**: geteiltes `frontend/src/i18n/content.ts` (Single
  Source), `Landing` locale-aware, `/en`-Route + Flat-File `en.html`,
  hreflang-Cluster (`de`/`en`/`x-default`=`/en`), Header-Sprachumschalter.
- **JSON-LD aus CONTENT generiert** (`structuredData.ts`): SoftwareApplication
  + FAQPage + neue **HowTo**, pro Locale, `inLanguage` gesetzt — FAQ und Markup
  per Konstruktion deckungsgleich (alte „manuell synchron halten"-Falle weg).
- **Keyword-Schaerfung**: H1/Title DE „kostenlose Lightroom-Alternative",
  EN „free Lightroom alternative"; +3 FAQ (Open Source / Installation / Kameras).
- **/marketplace prerendert** echten Intro-Inhalt (`MarketplaceIntro`,
  SSR-sicher) statt Landing-Fallback.
- **`public/llms.txt`** fuer AI-Engines.
- **nginx**: Junk-/Scan-Pfade (`*.php`, `.env`, `/wp-*`, `/.git`) → 404.
- Damit Befunde #1–#7 des 2026-06-09-Reviews geschlossen (ausser #7
  Pro-Preset-Detailseiten — bleibt bewusst offen).
```

- [ ] **Step 2: Roadmap-Eintrag**

In `docs/06-roadmap.md` einen Eintrag fuer die abgeschlossene Iteration
„Bilingual DE+EN + GEO/SEO/AEO-Politur (2026-06-09)" ergaenzen (an der
Stelle der juengsten Eintraege, im bestehenden Format der Datei).

- [ ] **Step 3: Commit**

```bash
git add docs/seo-geo-aeo-review.md docs/06-roadmap.md
git commit -m "docs(seo): Bilingual+GEO-Iteration dokumentiert"
```

---

## Task 13: Finale Verifikation (Gate)

**Files:** (kein Code)

- [ ] **Step 1: Full gate**

Run:
```bash
cd frontend && pnpm lint && pnpm exec tsc -b --noEmit && pnpm test && pnpm build
```
Expected: lint clean, kein Typfehler, alle Vitest gruen, Build inkl. Prerender ok.

- [ ] **Step 2: Re-run Build-Smoke-Assertions aus Task 9 Step 2/3**

Expected: weiterhin alle ≥1 bzw. Datenschutz-JSON-LD = 0.

- [ ] **Step 3: Branch-Status pruefen**

Run: `git -C /home/manuel/claude/lumen log --oneline origin/main..HEAD`
Expected: die Task-Commits dieser Iteration; sauberer `git status`.

---

## Self-Review-Notiz (vom Plan-Autor)

- **Spec-Coverage:** A/i18n→T1+T3, B/JSON-LD→T2+T7+T8, C/URL+hreflang→T6+T7+T8,
  D/Prerender→T7+T8+T9, E/Keywords→T1, F/Marketplace→T5+T7+T8, G/llms.txt→T10,
  H/nginx→T11, Tests→über alle Tasks + T9/T13. Alle Spec-Punkte abgedeckt.
- **Marketplace-SSR-Risiko (Spec):** durch pure `MarketplaceIntro` (Prerender
  rendert NICHT die volle `Marketplace`-Komponente) entschaerft — kein
  `useApi`/`window` im SSR-Pfad.
- **hreflang-Symmetrie:** `/` und `/en` referenzieren sich gegenseitig (T8 Step 3
  injiziert denselben `HREFLANG_HTML` in beide).
- **Typkonsistenz:** `CONTENT`/`Locale`/`buildJsonLd`/`jsonLdScripts`/
  `LANDING_JSONLD`/`HREFLANG_HTML`/`MarketplaceIntro` durchgaengig gleich benannt.
