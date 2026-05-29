import { screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Landing from "../src/pages/Landing";
import { makeFakeAuth, renderWithAuth } from "./test-utils";

function renderLanding() {
  return renderWithAuth(<Landing />, {
    auth: makeFakeAuth({ isAuthenticated: false }),
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
}

describe("Landing FAQ und Vergleich", () => {
  it("rendert eine FAQ-Sektion mit den sechs Kernfragen", () => {
    renderLanding();
    expect(screen.getByTestId("landing-faq")).toBeInTheDocument();
    // Fragen muessen 1:1 mit dem FAQPage-JSON-LD in index.html uebereinstimmen
    expect(screen.getByText(/Was ist Lumen/i)).toBeInTheDocument();
    expect(screen.getByText(/Welche RAW-Formate/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Ist Lumen eine Lightroom-Alternative/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Kann ich Lumen selbst hosten/i)).toBeInTheDocument();
    expect(screen.getByText(/Kostet Lumen etwas/i)).toBeInTheDocument();
    expect(screen.getByText(/Bleiben meine Bilder privat/i)).toBeInTheDocument();
  });

  it("rendert einen Lumen-vs-Lightroom-Vergleichsblock", () => {
    renderLanding();
    expect(screen.getByTestId("landing-compare")).toBeInTheDocument();
    // Vergleichstabelle nennt beide Produkte
    const compare = screen.getByTestId("landing-compare");
    expect(compare.textContent).toMatch(/Lightroom/);
    expect(compare.textContent).toMatch(/Lumen/);
  });
});
