import { expect, test } from "@playwright/test";

import { uploadTinyImage } from "./api-helper";
import { apiTokenFor, cleanupUser, loginAsNewUser } from "./auth-helper";

/**
 * E2E fuer Bearbeitungs-Profile: Batch-Anwendung auf mehrere Bilder.
 *
 * Setup: Neuer User loggt sich ein, zwei Bilder werden via API-Helper
 * hochgeladen (kein UI-Upload-Flow noetig — getrennte Concern), dann
 * die Library-Seite oeffnen, beide Bilder selektieren, Batch-Apply
 * durchfuehren und Toast verifizieren.
 */
test.describe("Bearbeitungs-Profile", () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test("Profil auf mehrere Bilder anwenden zeigt Toast mit Ergebnis", async ({
    page,
  }) => {
    const user = await loginAsNewUser(page);
    try {
      // Zwei Bilder per API seeden (umgeht Pre-Signed-PUT-Browser-Timing).
      const token = await apiTokenFor(user);
      const img1 = await uploadTinyImage(token, "batch-a.png");
      const img2 = await uploadTinyImage(token, "batch-b.png");

      // Library-Seite laden — die zwei Bilder erscheinen in der Liste.
      await page.goto("/library");
      await expect(page.getByTestId("page-library")).toBeVisible();
      await expect(
        page.getByTestId(`image-row-${img1.id}`),
      ).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId(`image-row-${img2.id}`)).toBeVisible();

      // Beide Bilder selektieren.
      await page.getByTestId(`image-select-${img1.id}`).check();
      await page.getByTestId(`image-select-${img2.id}`).check();

      // „Profil anwenden (2)"-Button ist jetzt aktiv.
      const openBtn = page.getByTestId("batch-apply-open");
      await expect(openBtn).not.toBeDisabled();
      await openBtn.click();

      // Modal erscheint.
      await expect(page.getByTestId("batch-apply-modal")).toBeVisible();

      // Erstes Default-Preset waehlen (neue User bekommen 20 Default-Presets
      // beim JIT-Provisioning — index 1 ist das erste echte Preset).
      await page
        .getByTestId("batch-preset-select")
        .selectOption({ index: 1 });

      // Schritt-Checkboxen sind sichtbar (StepCheckboxes), crop/lens bleiben
      // deaktiviert (default out) — keine explizite Aktion noetig.

      // Anwenden bestaetigen.
      await page.getByTestId("batch-apply-confirm").click();

      // Toast „2 von 2 angewendet" erscheint, Modal verschwindet.
      await expect(page.getByTestId("batch-toast")).toContainText(
        "2 von 2",
        { timeout: 10_000 },
      );
      await expect(page.getByTestId("batch-apply-modal")).not.toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });
});
