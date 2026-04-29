import { test, expect } from "@playwright/test";

import { cleanupUser, loginAsNewUser } from "./auth-helper";

/**
 * Browser-Tests fuer den Feedback-Dialog (Header-Trigger -> Dialog ->
 * Submit). Honeypot-Pfad wird im Backend-Pytest abgedeckt; hier
 * verifizieren wir den UI-Pfad.
 */
test.beforeEach(async ({ page, context }) => {
  // SSO-Session aus voherigen Tests verhindern, sonst meldet sich der
  // Test-User als der alte an. localStorage zusaetzlich, weil OIDC-
  // Token dort gespiegelt sein koennen.
  await context.clearCookies();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumen.onboarding.v1",
      JSON.stringify({ status: "dismissed" }),
    );
  });
});
test.describe("Feedback", () => {
  test("Header-Button oeffnet Dialog, Submit triggert Erfolgsmeldung", async ({
    page,
  }) => {
    const user = await loginAsNewUser(page);
    try {
      // Tour ueberspringen, damit sie das Header-Layout nicht ueberlagert
      await page.goto("/editor");
      const skip = page.getByTestId("onboarding-skip");
      if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await skip.click();
      }

      await page.getByTestId("header-feedback").click();
      await expect(page.getByTestId("feedback-dialog")).toBeVisible();

      // Dialog hat role + aria-modal
      const dialog = page.getByTestId("feedback-dialog");
      await expect(dialog).toHaveAttribute("role", "dialog");
      await expect(dialog).toHaveAttribute("aria-modal", "true");

      // Bug ist Default ausgewaehlt — wechsel auf Idee
      await page.getByTestId("feedback-kind-idea").click();

      const message = "Smoke-Test-Feedback aus dem Browser-E2E-Lauf.";
      await page.getByTestId("feedback-message").fill(message);
      await page.getByTestId("feedback-submit").click();

      await expect(page.getByTestId("feedback-status")).toContainText(/Danke/i);
    } finally {
      await cleanupUser(user);
    }
  });

  test("Esc schliesst den Dialog", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      const skip = page.getByTestId("onboarding-skip");
      if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await skip.click();
      }
      await page.getByTestId("header-feedback").click();
      await expect(page.getByTestId("feedback-dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("feedback-dialog")).not.toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Submit-Button bleibt disabled bei <10 Zeichen", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      const skip = page.getByTestId("onboarding-skip");
      if (await skip.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await skip.click();
      }
      await page.getByTestId("header-feedback").click();
      const submit = page.getByTestId("feedback-submit");
      await expect(submit).toBeDisabled();
      await page.getByTestId("feedback-message").fill("kurz");
      await expect(submit).toBeDisabled();
      await page.getByTestId("feedback-message").fill(
        "Jetzt sind genug Zeichen drin.",
      );
      await expect(submit).toBeEnabled();
    } finally {
      await cleanupUser(user);
    }
  });
});
