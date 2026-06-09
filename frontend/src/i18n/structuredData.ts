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
