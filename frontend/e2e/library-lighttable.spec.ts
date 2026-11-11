import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { uploadTinyImage } from "./api-helper";
import { apiTokenFor, cleanupUser, loginAsNewUser } from "./auth-helper";

/**
 * E2E fuer H2b (Lighttable-Raster): Upload ueber die UI erzeugt eine Kachel
 * mit Vorschaubild, Sterne ueberleben einen Reload, der minRating-Filter
 * blendet unbewertete Bilder aus.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const JPG_PATH = join(HERE, "..", "..", "tests-fixtures", "test-samples", "gradient.jpg");

// Onboarding "dismissed" + Cookies leeren (KC-Session-Leak), Ansicht auf
// Raster (Default) — gleiches Muster wie editor/marketplace.spec.
test.beforeEach(async ({ page, context }) => {
  await context.clearCookies();
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "lumen.onboarding.v1",
      JSON.stringify({ status: "dismissed" }),
    );
    window.localStorage.removeItem("lumen.library.view");
  });
});

test.describe("Bibliothek Raster", () => {
  test("Upload zeigt Vorschau, Sterne bleiben nach Reload, Filter blendet aus", async ({
    page,
  }) => {
    const user = await loginAsNewUser(page);
    try {
      // Unbewertetes Vergleichsbild per API.
      const token = await apiTokenFor(user);
      const unrated = await uploadTinyImage(token, "unbewertet.jpg");

      await page.goto("/library");
      await expect(page.getByTestId("image-grid")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId(`image-tile-${unrated.id}`)).toBeVisible();

      // JPEG ueber die UI hochladen -> Kachel mit echtem Vorschaubild.
      await page.setInputFiles('[data-testid="upload-input"]', JPG_PATH);
      const tiles = page.locator('[data-testid^="image-tile-"]');
      await expect(tiles).toHaveCount(2, { timeout: 15_000 });
      const uploadedTile = tiles.filter({ hasText: "gradient.jpg" });
      await expect(uploadedTile).toHaveCount(1);
      const testId = await uploadedTile.getAttribute("data-testid");
      const id = (testId ?? "").replace("image-tile-", "");
      expect(id).not.toBe("");
      const thumb = page.getByTestId(`image-thumb-${id}`);
      await expect(thumb).toBeVisible({ timeout: 15_000 });
      await expect
        .poll(() => thumb.evaluate((el) => (el as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);

      // 3 Sterne setzen -> Ansage + nach Reload noch da.
      await page.getByTestId(`tile-${id}-star-3`).click();
      await expect(page.getByTestId("library-announce")).toHaveText("3 Sterne");
      await expect(page.getByTestId(`tile-${id}-star-3`)).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(page.getByTestId(`tile-${id}-star-3`)).toHaveAttribute(
        "aria-pressed",
        "true",
        { timeout: 10_000 },
      );

      // Filter "ab 3 Sternen": unbewertetes Bild verschwindet.
      await page.getByTestId("filter-min-rating").selectOption("3");
      await expect(page.getByTestId(`image-tile-${unrated.id}`)).toBeHidden();
      await expect(page.getByTestId(`image-tile-${id}`)).toBeVisible();

      // Zuruecksetzen bringt es wieder.
      await page.getByTestId("filter-reset").click();
      await expect(page.getByTestId(`image-tile-${unrated.id}`)).toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });
});
