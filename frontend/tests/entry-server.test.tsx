import { describe, expect, it } from "vitest";

import { render } from "../src/entry-server";
import { CONTENT } from "../src/i18n/content";

// Pruefen, dass die SSR-Render-Funktion fuer die Public-Routes echten Inhalt
// als HTML-String liefert (Grundlage des Prerenderings — Crawler/KI-Engines
// sehen diesen Inhalt ohne JS).
describe("entry-server render (Prerender-Quelle)", () => {
  it("rendert die Landing mit FAQ + Vergleich als HTML", () => {
    const html = render("/");
    expect(html).toContain("Die kostenlose Lightroom-Alternative im Browser");
    expect(html).toContain("Häufige Fragen");
    expect(html).toContain("Lumen oder Lightroom");
    // FAQ-Frage muss im statischen HTML stehen (AEO)
    expect(html).toContain("Ist Lumen eine Lightroom-Alternative");
  });

  it("rendert die EN-Landing (/en) mit englischer H1", () => {
    const html = render("/en");
    expect(html).toContain("The free, browser-based Lightroom alternative for RAW");
  });

  it("rendert die Marketplace-Intro (/marketplace) mit Heading", () => {
    const html = render("/marketplace");
    expect(html).toContain(CONTENT.de.marketplace.heading);
  });

  it("rendert das Impressum mit Betreiberdaten", () => {
    const html = render("/impressum");
    expect(html).toContain("Diensteanbieter");
    expect(html).toContain("Manuel Rödig");
  });

  it("rendert die Datenschutzseite", () => {
    const html = render("/datenschutz");
    expect(html.toLowerCase()).toContain("datenschutz");
  });

  it("liefert fuer eine unbekannte Route keinen Crash (leeres Routes-Match)", () => {
    const html = render("/gibt-es-nicht");
    expect(typeof html).toBe("string");
  });
});
