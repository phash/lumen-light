import { test, expect } from "@playwright/test";

import { seedPublishedPreset, setHandle } from "./api-helper";
import { apiTokenFor, cleanupUser, loginAsNewUser } from "./auth-helper";

/**
 * E2E fuer Phase F1 (Preset-Marketplace). Setup:
 * - User A loggt sich ein (UI), kriegt zusaetzlich einen Backend-Token
 *   per ROPC und seedet ueber die API ein veroeffentlichtes Preset
 *   (Image-Upload + Preset-Create mit visibility=public).
 * - User B loggt sich ein und navigiert auf /marketplace; verifiziert
 *   List-View, Filter, Detail-Modal, Apply, Fork und Report.
 *
 * Wir umgehen den vollstaendigen UI-Publish-Pfad bewusst — der ist in
 * den Component-Tests (vitest) abgedeckt und wuerde im E2E-Setup
 * mehrere Sekunden plus Bilddatei-Auswahl kosten.
 */
// Onboarding "dismissed" vorsetzen + Cookies leeren: sonst blockiert das
// Welcome-Modal den Logout-Klick (Creator->Consumer-Wechsel) und KC-Sessions
// leaken zwischen Tests. Gleiches Muster wie admin/feedback.spec.
test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumen.onboarding.v1",
      JSON.stringify({ status: "dismissed" }),
    );
  });
});

test.describe("Marketplace", () => {
  test("Empty-State sichtbar wenn keine Presets veroeffentlicht", async ({
    page,
  }) => {
    const user = await loginAsNewUser(page);
    try {
      // Frischer Test-User, frische DB-Snapshot — niemand hat publiziert.
      // Hinweis: in der Test-DB koennen Presets aus parallelen Test-Files
      // sichtbar sein. Daher fragen wir nicht "0 Items", sondern den
      // Filter-Reset-Pfad: ein nicht existierendes Genre liefert leer.
      await page.goto("/marketplace");
      await expect(page.getByTestId("page-marketplace")).toBeVisible();

      // Nach einem strikten Genre-Klick + zufaelligem Suchbegriff sollte
      // der Empty-State auftauchen.
      await page.getByTestId("marketplace-search").fill(
        `nonexistent-${Date.now()}`,
      );
      await expect(page.getByTestId("marketplace-empty")).toBeVisible({
        timeout: 5_000,
      });

      // Reset-Button im Empty-State raeumt Filter weg.
      await page.getByTestId("marketplace-empty-reset").click();
      await expect(page.getByTestId("marketplace-search")).toHaveValue("");
    } finally {
      await cleanupUser(user);
    }
  });

  test("Publish via API → Browse → Detail-Modal → Apply", async ({ page }) => {
    const creator = await loginAsNewUser(page);
    let consumer: Awaited<ReturnType<typeof loginAsNewUser>> | null = null;
    try {
      // 1) Creator seedt Preset via Backend-API (umgeht Image-Upload-UI).
      const creatorToken = await apiTokenFor(creator);
      await setHandle(creatorToken, `creator-${Date.now()}`);
      const seeded = await seedPublishedPreset(creatorToken, {
        name: `MP-Test ${Date.now()}`,
        description:
          "Smoke-Test-Preset fuer den Marketplace-E2E-Roundtrip.",
        genre: "portrait",
        exposure: 0.7,
      });

      // 2) Logout creator, login consumer
      await page.getByRole("button", { name: "Logout" }).click();
      await page
        .getByTestId("auth-login-button")
        .waitFor({ state: "visible", timeout: 15_000 });
      consumer = await loginAsNewUser(page);

      // 3) /marketplace zeigt das Preset
      await page.goto("/marketplace");
      const card = page.getByTestId(`marketplace-card-${seeded.presetId}`);
      await expect(card).toBeVisible({ timeout: 10_000 });

      // 4) Genre-Filter auf Portrait laesst es weiterhin durch
      await page.getByTestId("marketplace-genre-portrait").click();
      await expect(card).toBeVisible();

      // 5) Detail-Modal oeffnet
      await card.click();
      const modal = page.getByTestId("marketplace-detail-modal");
      await expect(modal).toBeVisible();
      await expect(modal).toContainText("Anwendungen");

      // 6) Apply triggert applyAdjustments + Navigation zurueck zu /editor
      await page.getByTestId("marketplace-apply").click();
      await expect(page).toHaveURL(/\/editor$/, { timeout: 5_000 });
    } finally {
      if (consumer) await cleanupUser(consumer);
      await cleanupUser(creator);
    }
  });

  test("Fork kopiert Preset in eigene Bibliothek", async ({ page }) => {
    const creator = await loginAsNewUser(page);
    let consumer: Awaited<ReturnType<typeof loginAsNewUser>> | null = null;
    try {
      const creatorToken = await apiTokenFor(creator);
      const seeded = await seedPublishedPreset(creatorToken, {
        name: `MP-Fork ${Date.now()}`,
        description: "Fork-Test-Preset fuer den Marketplace-E2E-Roundtrip.",
        genre: "landscape",
      });

      await page.getByRole("button", { name: "Logout" }).click();
      await page
        .getByTestId("auth-login-button")
        .waitFor({ state: "visible", timeout: 15_000 });
      consumer = await loginAsNewUser(page);

      await page.goto("/marketplace");
      await page
        .getByTestId(`marketplace-card-${seeded.presetId}`)
        .click();
      await expect(page.getByTestId("marketplace-detail-modal")).toBeVisible();

      await page.getByTestId("marketplace-fork").click();
      await expect(page.getByTestId("marketplace-detail-modal")).toContainText(
        /Bibliothek/i,
      );
    } finally {
      if (consumer) await cleanupUser(consumer);
      await cleanupUser(creator);
    }
  });

  test("Report sendet Meldung und feedbackt", async ({ page }) => {
    const creator = await loginAsNewUser(page);
    let consumer: Awaited<ReturnType<typeof loginAsNewUser>> | null = null;
    try {
      const creatorToken = await apiTokenFor(creator);
      const seeded = await seedPublishedPreset(creatorToken, {
        name: `MP-Report ${Date.now()}`,
        description: "Report-Test-Preset fuer den Marketplace-E2E-Roundtrip.",
        genre: "other",
      });

      await page.getByRole("button", { name: "Logout" }).click();
      await page
        .getByTestId("auth-login-button")
        .waitFor({ state: "visible", timeout: 15_000 });
      consumer = await loginAsNewUser(page);

      await page.goto("/marketplace");
      await page
        .getByTestId(`marketplace-card-${seeded.presetId}`)
        .click();
      // Den details-Block fuer "Melden" aufklappen
      await page
        .getByTestId("marketplace-detail-modal")
        .getByText("Melden")
        .click();

      await page
        .getByTestId("marketplace-report-reason")
        .fill("Spam-Test im E2E-Lauf");
      await page.getByTestId("marketplace-report-submit").click();
      await expect(page.getByTestId("marketplace-detail-modal")).toContainText(
        /Meldung gesendet/i,
      );
    } finally {
      if (consumer) await cleanupUser(consumer);
      await cleanupUser(creator);
    }
  });
});
