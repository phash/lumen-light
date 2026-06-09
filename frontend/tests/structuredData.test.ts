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
    for (const m of jsons) expect(() => JSON.parse(m[1]!)).not.toThrow();
  });
});
