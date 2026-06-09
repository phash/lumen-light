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
