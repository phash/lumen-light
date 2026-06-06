/**
 * Screenshot-Spec: nutzt Playwright zur Dokumentation der UI in Schluessel-
 * Zustaenden. Nicht Teil der CI-Suite (laeuft nur explizit), schreibt PNGs
 * nach /home/manuel/claude/lumen/screenshots/.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { cleanupUser, loginAsNewUser } from "./auth-helper";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(HERE, "..", "..", "tests-fixtures", "test-samples");
const JPG_PATH = join(SAMPLE_DIR, "gradient.jpg");
const SHOTS = join(HERE, "..", "..", "docs", "screenshots", "phase5");

test.use({ viewport: { width: 1440, height: 900 } });

test("UI-Screenshots: Editor-Hauptzustaende fuer Phase-5-Doku", async ({ page }) => {
  const user = await loginAsNewUser(page);
  try {
    await page.goto("/editor");
    await page.setInputFiles('[data-testid="editor-file-input"]', JPG_PATH);
    await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 10_000 });

    // 01 — Editor mit geladenem Bild, Default-State
    await page.screenshot({
      path: join(SHOTS, "01-editor-default.png"),
      fullPage: false,
    });

    // 02 — Verlauf hinzufuegen, Overlay sichtbar, Local-Section in Sidebar
    await page.getByTestId("editor-linear-mask-toggle").click();
    await page.getByTestId("local-exposure-slider").fill("1.5");
    await expect(page.getByTestId("linear-mask-overlay")).toBeVisible();
    await page.screenshot({
      path: join(SHOTS, "02-linear-mask.png"),
      fullPage: false,
    });

    // 03 — Plus Radial; jetzt zwei Masken in der Liste, Radial selektiert
    await page.getByTestId("editor-radial-mask-toggle").click();
    await page.getByTestId("radial-exposure-slider").fill("-1");
    await page.getByTestId("radial-saturation-slider").fill("0.4");
    await expect(page.getByTestId("radial-mask-overlay")).toBeVisible();
    await expect(page.getByTestId("mask-list")).toBeVisible();
    await page.screenshot({
      path: join(SHOTS, "03-multi-mask.png"),
      fullPage: false,
    });

    // 04 — Auf Verlauf 1 zurueckwechseln per Liste
    await page.getByTestId("mask-list-item-0").click();
    await expect(page.getByTestId("local-mask-section")).toBeVisible();
    await page.screenshot({
      path: join(SHOTS, "04-mask-selection.png"),
      fullPage: false,
    });

    // 05 — Preset-Dialog oeffnen, Liste zeigt Default-Presets aus JIT
    await page.getByTestId("editor-presets").click();
    await expect(page.getByTestId("preset-dialog")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({
      path: join(SHOTS, "05-preset-dialog-list.png"),
      fullPage: false,
    });

    // 06 — Preset speichern
    await page.getByTestId("preset-save-name").fill("Mein Look mit Masken");
    await page.screenshot({
      path: join(SHOTS, "06-preset-save-name.png"),
      fullPage: false,
    });
    await page.getByTestId("preset-save-confirm").click();
    await page.waitForTimeout(500);

    // 07 — Nach Save erscheint der Update-Button
    await expect(page.getByTestId("preset-update")).toBeVisible();
    await page.screenshot({
      path: join(SHOTS, "07-preset-saved-with-update.png"),
      fullPage: false,
    });

    // 08 — Dialog schliessen, alle Adjustments via Cmd+Reset zurueck,
    //       dann Preset wieder laden — Roundtrip-Beweis
    await page.getByTestId("preset-close").click();
    await expect(page.getByTestId("preset-dialog")).not.toBeVisible();

    // Reset alles
    const expoSlider = page.getByTestId("slider-exposure").getByRole("slider");
    await expoSlider.focus();
    await page.getByTestId("editor-reset-all").click();
    // Mask-Liste manuell entfernen (Reset-All nur fuer globale Sliders)
    while (await page.getByTestId("mask-list-item-0").isVisible().catch(() => false)) {
      await page.getByTestId("mask-list-delete-0").click();
    }
    await expect(page.getByTestId("mask-list")).not.toBeVisible();

    // Preset-Dialog erneut, mit P-Shortcut
    await page.locator("body").click({ position: { x: 0, y: 0 } });
    await page.keyboard.press("p");
    await expect(page.getByTestId("preset-dialog")).toBeVisible();
    await page.waitForTimeout(300);

    // Eigenes Preset anwenden. List-Sortierung ist alphabetisch by name,
    // daher suchen wir „Mein Look mit Masken" per Text. Der neue Flow
    // oeffnet zuerst das Schritt-Panel, dann bestaetigen wir.
    await page
      .locator("li")
      .filter({ hasText: "Mein Look mit Masken" })
      .getByText("Anwenden")
      .click();
    await expect(page.getByTestId("apply-step-panel")).toBeVisible();
    await page.getByTestId("apply-confirm").click();
    await page.waitForTimeout(300);

    // Mask-Liste sollte 2 Einträge zeigen
    await expect(page.getByTestId("mask-list")).toBeVisible();
    await page.screenshot({
      path: join(SHOTS, "08-after-preset-load.png"),
      fullPage: false,
    });
  } finally {
    await cleanupUser(user);
  }
});
