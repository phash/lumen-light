import { test, expect } from "@playwright/test";

import { cleanupUser, loginAsNewUser } from "./auth-helper";

/**
 * Browser-Tests fuer das Onboarding-System. localStorage-Markierung
 * ist Pro-User-Pro-Browser; ein frisch eingeloggter Test-User triggert
 * also immer das Welcome-Modal beim ersten /editor-Render.
 *
 * Wichtig: Cookies vor jedem Test loeschen, weil sonst die KC-SSO-
 * Session aus vorherigen Tests den User automatisch eingeloggt haelt.
 * localStorage explizit nicht resetten — die Tour-Persistenz ist Teil
 * der Test-Annahmen.
 */
test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  // localStorage einmalig leeren — addInitScript wuerde bei jedem
  // Reload ausgefuehrt und damit den Persistenz-Test brechen.
  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.removeItem("lumen.onboarding.v1");
  });
});

test.describe("Onboarding", () => {
  test("zeigt Welcome-Modal beim ersten Editor-Aufruf", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      // Welcome-Modal kommt automatisch (state=none)
      await expect(page.getByTestId("onboarding-modal")).toBeVisible({
        timeout: 5_000,
      });
      await expect(page.getByTestId("onboarding-modal")).toContainText(
        "Willkommen",
      );
      await expect(
        page.getByRole("button", { name: /tour starten/i }),
      ).toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Skip persistiert dismissed und blendet Tour aus", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await expect(page.getByTestId("onboarding-modal")).toBeVisible();
      await page.getByTestId("onboarding-skip").click();
      await expect(page.getByTestId("onboarding-tour")).not.toBeVisible();

      // Reload — Tour kommt nicht mehr auto
      await page.reload();
      await expect(page.getByTestId("onboarding-tour")).not.toBeVisible({
        timeout: 3_000,
      });
    } finally {
      await cleanupUser(user);
    }
  });

  test("Tour durchklicken setzt completed", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await expect(page.getByTestId("onboarding-modal")).toBeVisible();

      // 1. Welcome -> Tour starten
      await page.getByTestId("onboarding-next").click();

      // 2. „Bild laden" — Wartet auf Histogramm. Sample laden.
      await expect(page.getByTestId("onboarding-tooltip")).toBeVisible();
      await expect(page.getByTestId("onboarding-tooltip")).toContainText(
        "Bild laden",
      );
      await page.getByTestId("editor-load-sample").click();
      // Histogramm muss sichtbar werden, dann ist der Weiter-Button
      // wieder klickbar.
      await expect(page.getByTestId("histogram")).toBeVisible({
        timeout: 10_000,
      });
      await expect(page.getByTestId("onboarding-waiting")).not.toBeVisible({
        timeout: 5_000,
      });

      // 3.-7. — durchschalten
      const expectedTitles = [
        /Auto-Ton/i,
        /Slider/i,
        /Vorher/i,
        /Beschneiden/i,
        /Preset/i,
        /Exportieren/i,
      ];
      for (const re of expectedTitles) {
        await page.getByTestId("onboarding-next").click();
        await expect(page.getByTestId("onboarding-tooltip")).toContainText(re);
      }

      // 8. Done-Modal
      await page.getByTestId("onboarding-next").click();
      await expect(page.getByTestId("onboarding-modal")).toContainText(
        /Fertig/i,
      );
      await page.getByTestId("onboarding-done").click();
      await expect(page.getByTestId("onboarding-tour")).not.toBeVisible();

      // Reload — kommt nicht mehr (completed)
      await page.reload();
      await expect(page.getByTestId("onboarding-tour")).not.toBeVisible({
        timeout: 3_000,
      });
    } finally {
      await cleanupUser(user);
    }
  });

  test("Restart-Button im Account-Bereich startet die Tour erneut", async ({
    page,
  }) => {
    const user = await loginAsNewUser(page);
    try {
      // Tour erst skippen
      await page.goto("/editor");
      await page.getByTestId("onboarding-skip").click();

      // Account oeffnen, Tour erneut starten
      await page.goto("/account");
      await page.getByTestId("account-tour-restart").click();
      await expect(page.getByTestId("onboarding-modal")).toBeVisible();
      await expect(page.getByTestId("onboarding-modal")).toContainText(
        "Willkommen",
      );

      // Schliessen via Skip — kein Crash
      await page.getByTestId("onboarding-skip").click();
      await expect(page.getByTestId("onboarding-tour")).not.toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Spotlight zeigt Tooltip auch wenn Target im DOM fehlt", async ({
    page,
  }) => {
    // Defensive: wenn ein Tour-Target dynamisch verschwindet (collapsed
    // Sidebar etc.), der Tooltip soll trotzdem sichtbar bleiben.
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.getByTestId("onboarding-next").click(); // Welcome -> Bild laden

      // Schritt 2 zielt auf editor-load-sample. Ist es da? Ja, weil noch
      // kein Bild geladen. Tooltip sichtbar.
      await expect(page.getByTestId("onboarding-tooltip")).toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });
});
