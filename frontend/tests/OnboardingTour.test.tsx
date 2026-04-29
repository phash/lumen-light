import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingTour from "../src/onboarding/OnboardingTour";
import {
  getOnboardingState,
  resetOnboarding,
} from "../src/onboarding/state";
import { ONBOARDING_STEPS } from "../src/onboarding/steps";
import { renderWithAuth } from "./test-utils";

function render(onClose = vi.fn()) {
  renderWithAuth(<OnboardingTour onClose={onClose} />, {
    wrapper: (c) => <MemoryRouter>{c}</MemoryRouter>,
  });
  return { onClose };
}

describe("OnboardingTour", () => {
  beforeEach(() => {
    resetOnboarding();
  });

  afterEach(() => {
    // Stub-Knoten aus „Letzter Schritt"-Test entfernen, damit andere
    // Tests die Wait-Targets wieder als fehlend sehen.
    for (const step of ONBOARDING_STEPS) {
      if (step.waitForTestId) {
        document
          .querySelectorAll(`[data-testid="${step.waitForTestId}"]`)
          .forEach((n) => {
            // Nur die im Body direkt platzierten Stubs entfernen, nicht
            // React-gemountete Knoten.
            if (n.parentElement === document.body) n.remove();
          });
      }
    }
  });

  it("startet beim Welcome-Modal", () => {
    render();
    const modal = screen.getByTestId("onboarding-modal");
    expect(modal).toBeInTheDocument();
    expect(modal.textContent).toContain("Willkommen");
    expect(screen.getByTestId("onboarding-next").textContent).toMatch(
      /Tour starten/,
    );
  });

  it("Skip persistiert als 'dismissed' und ruft onClose", async () => {
    const onClose = vi.fn();
    render(onClose);
    await userEvent.click(screen.getByTestId("onboarding-skip"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getOnboardingState()).toBe("dismissed");
  });

  it("Weiter geht in den naechsten Schritt", async () => {
    render();
    await userEvent.click(screen.getByTestId("onboarding-next"));
    // Schritt 2 ist „Bild laden" (spotlight). Hat kein Modal mehr,
    // dafuer Tooltip + Spotlight.
    expect(screen.queryByTestId("onboarding-modal")).toBeNull();
    expect(screen.getByTestId("onboarding-tooltip")).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-tooltip").textContent).toMatch(
      /Bild laden/,
    );
  });

  it("Zurueck-Button erscheint ab Schritt 2 und navigiert zurueck", async () => {
    render();
    await userEvent.click(screen.getByTestId("onboarding-next"));
    const back = screen.getByTestId("onboarding-prev");
    await userEvent.click(back);
    expect(screen.getByTestId("onboarding-modal")).toBeInTheDocument();
  });

  it("Letzter Schritt persistiert als 'completed'", async () => {
    // Wait-Targets in den DOM einfuegen, damit der Tour-Lauf nicht
    // blockiert. Echte Targets fehlen in jsdom — wir simulieren ihre
    // Praesenz mit unsichtbaren Stub-Knoten.
    for (const step of ONBOARDING_STEPS) {
      if (step.waitForTestId) {
        const stub = document.createElement("div");
        stub.setAttribute("data-testid", step.waitForTestId);
        document.body.appendChild(stub);
      }
    }
    const onClose = vi.fn();
    render(onClose);
    for (let i = 0; i < ONBOARDING_STEPS.length - 1; i++) {
      const btn =
        screen.queryByTestId("onboarding-next") ??
        screen.getByTestId("onboarding-done");
      await waitFor(() => expect(btn).not.toBeDisabled());
      await userEvent.click(btn);
    }
    const done = screen.getByTestId("onboarding-done");
    await userEvent.click(done);
    expect(onClose).toHaveBeenCalled();
    expect(getOnboardingState()).toBe("completed");
  });

  it("Wait-Block setzt onboarding-waiting hint, wenn Target fehlt", async () => {
    render();
    await userEvent.click(screen.getByTestId("onboarding-next"));
    // Schritt 2 wartet auf testid `histogram` — der ist im jsdom nicht da.
    await waitFor(() => {
      expect(screen.getByTestId("onboarding-waiting")).toBeInTheDocument();
    });
    expect(screen.getByTestId("onboarding-next")).toBeDisabled();
  });
});
