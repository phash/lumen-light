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
