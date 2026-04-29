import { beforeEach, describe, expect, it } from "vitest";

import {
  getOnboardingState,
  markOnboardingCompleted,
  markOnboardingDismissed,
  resetOnboarding,
} from "../src/onboarding/state";

describe("onboarding state", () => {
  beforeEach(() => {
    // localStorage in vitest ist flaky (siehe CLAUDE.md) — wir verlassen
    // uns auf den Modul-Level-Cache und setzen via resetOnboarding zurueck.
    resetOnboarding();
  });

  it("default ist 'none'", () => {
    // Direkt nach Reset
    expect(getOnboardingState()).toBe("none");
  });

  it("dismissed wird persistiert", () => {
    markOnboardingDismissed();
    expect(getOnboardingState()).toBe("dismissed");
  });

  it("completed wird persistiert", () => {
    markOnboardingCompleted();
    expect(getOnboardingState()).toBe("completed");
  });

  it("reset setzt zurueck auf none", () => {
    markOnboardingCompleted();
    expect(getOnboardingState()).toBe("completed");
    resetOnboarding();
    expect(getOnboardingState()).toBe("none");
  });
});
