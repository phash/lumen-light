import { test, expect } from "@playwright/test";

import { cleanupUser, loginAsNewUser } from "./auth-helper";

// Cookies leeren (KC-Session-Leak zwischen Tests) + Onboarding "dismissed":
// nach dem Login landet man im Editor, dessen Welcome-Modal sonst den
// Logout-Button-Klick abfaengt -> 30s-Timeout. Gleiches Muster wie admin.spec.
test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumen.onboarding.v1",
      JSON.stringify({ status: "dismissed" }),
    );
  });
});

test.describe("Login-Flow gegen Keycloak", () => {
  test("ohne Login: /editor redirected auf /login", async ({ page }) => {
    await page.goto("/editor");
    await expect(page.getByTestId("page-login")).toBeVisible();
  });

  test("Login-Roundtrip: Klick → Keycloak → zurueck im Frontend", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      // Email steht im Header
      await expect(page.getByTestId("auth-email")).toHaveText(user.username);

      // Geschuetzte Routen jetzt erreichbar
      await page.goto("/editor");
      await expect(page.getByTestId("page-editor")).toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Logout fuehrt zurueck auf Landing", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.getByRole("button", { name: "Logout" }).click();
      // Nach Logout-Redirect landet man wieder auf der App
      await expect(page.getByTestId("auth-login-button")).toBeVisible({ timeout: 15_000 });
    } finally {
      await cleanupUser(user);
    }
  });
});
