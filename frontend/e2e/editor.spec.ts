import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { cleanupUser, loginAsNewUser } from "./auth-helper";

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_DIR = join(HERE, "..", "..", "tests-fixtures", "test-samples");
const JPG_PATH = join(SAMPLE_DIR, "gradient.jpg");
const PNG_PATH = join(SAMPLE_DIR, "gradient.png");

test.describe("Editor", () => {
  test("JPG laden, Bypass-Toggle, Reset-All", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.setInputFiles('[data-testid="editor-file-input"]', JPG_PATH);

      // Slider-Sidebar erscheint, Histogramm rendert
      await expect(page.getByTestId("editor-sidebar")).toBeVisible();
      await expect(page.getByTestId("histogram")).toBeVisible();

      // Bypass-Button erscheint nach erfolgreichem Bild-Load
      await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 5_000 });

      // Slider 'Belichtung' ueber Keyboard bewegen
      const expoSlider = page.getByTestId("slider-exposure").getByRole("slider");
      await expoSlider.focus();
      await expoSlider.press("ArrowRight");
      await expoSlider.press("ArrowRight");
      // Wert sollte > 0 sein (zwei steps a 0.01 = +0.02)
      const value = await page.getByTestId("slider-exposure-value").textContent();
      expect(value?.startsWith("+0.02")).toBeTruthy();

      // Reset-All
      await page.getByTestId("editor-reset-all").click();
      const reset = await page.getByTestId("slider-exposure-value").textContent();
      expect(reset?.trim()).toBe("+0.00");
    } finally {
      await cleanupUser(user);
    }
  });

  test("PNG laden + Crop-Mode toggle + Geometrie-Reset", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.setInputFiles('[data-testid="editor-file-input"]', PNG_PATH);
      await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 5_000 });

      // Crop-Toggle einschalten
      await page.getByTestId("editor-crop-toggle").click();
      await expect(page.getByTestId("crop-overlay")).toBeVisible();
      await expect(page.getByTestId("crop-handle-nw")).toBeVisible();

      // Aspect-Ratio aendern
      await page.getByTestId("aspect-select").selectOption("1:1");

      // Crop-Mode wieder aus
      await page.getByTestId("editor-crop-toggle").click();
      await expect(page.getByTestId("crop-overlay")).not.toBeVisible();

      // Reset-Geometry
      await page.getByTestId("editor-reset-geometry").click();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Export PNG triggert Download", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.setInputFiles('[data-testid="editor-file-input"]', JPG_PATH);
      await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 5_000 });

      await page.getByTestId("editor-export").click();
      await expect(page.getByTestId("export-dialog")).toBeVisible();
      await page.getByTestId("export-format").selectOption("png");

      const downloadPromise = page.waitForEvent("download");
      await page.getByTestId("export-confirm").click();
      const download = await downloadPromise;

      const filename = download.suggestedFilename();
      expect(filename.endsWith(".png")).toBeTruthy();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Lens-Sektion: Distortion + Vignette Slider bewegen", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.setInputFiles('[data-testid="editor-file-input"]', JPG_PATH);
      await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 5_000 });

      const distSlider = page.getByTestId("lens-distortion-slider");
      const vigSlider = page.getByTestId("lens-vignette-slider");
      await expect(distSlider).toBeVisible();
      await expect(vigSlider).toBeVisible();

      // Range-Input direkt mit fill setzen
      await distSlider.fill("0.4");
      await vigSlider.fill("-0.3");

      // Visuelle Labels aktualisieren
      const lensSection = page.getByTestId("lens-section");
      await expect(lensSection.getByText(/Verzeichnung \(40\)/)).toBeVisible();
      await expect(lensSection.getByText(/Vignettierung \(-30\)/)).toBeVisible();

      // Geometry-Reset setzt auch Lens zurueck
      await page.getByTestId("editor-reset-geometry").click();
      await expect(lensSection.getByText(/Verzeichnung \(0\)/)).toBeVisible();
      await expect(lensSection.getByText(/Vignettierung \(0\)/)).toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Linearer Verlaufsfilter: Toggle, Overlay, lokale Slider, Reset", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.setInputFiles('[data-testid="editor-file-input"]', JPG_PATH);
      await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 5_000 });

      await page.getByTestId("editor-linear-mask-toggle").click();
      await expect(page.getByTestId("linear-mask-overlay")).toBeVisible();
      await expect(page.getByTestId("linear-mask-handle-p1")).toBeVisible();
      await expect(page.getByTestId("linear-mask-handle-p2")).toBeVisible();

      const localSection = page.getByTestId("local-mask-section");
      await expect(localSection).toBeVisible();

      const expoSlider = page.getByTestId("local-exposure-slider");
      await expoSlider.fill("1.5");
      await expect(localSection.getByText(/Belichtung \(1\.50\)/)).toBeVisible();

      await page.getByTestId("editor-reset-mask").click();
      await expect(page.getByTestId("linear-mask-overlay")).not.toBeVisible();
      await expect(localSection).not.toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Radialfilter: Toggle, Overlay, lokale Slider, Reset", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.setInputFiles('[data-testid="editor-file-input"]', JPG_PATH);
      await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 5_000 });

      await page.getByTestId("editor-radial-mask-toggle").click();
      await expect(page.getByTestId("radial-mask-overlay")).toBeVisible();
      await expect(page.getByTestId("radial-mask-handle-center")).toBeVisible();
      await expect(page.getByTestId("radial-mask-handle-rx")).toBeVisible();
      await expect(page.getByTestId("radial-mask-handle-ry")).toBeVisible();

      const radialSection = page.getByTestId("radial-mask-section");
      await expect(radialSection).toBeVisible();

      const expoSlider = page.getByTestId("radial-exposure-slider");
      await expoSlider.fill("-1");
      await expect(radialSection.getByText(/Belichtung \(-1\.00\)/)).toBeVisible();

      await page.getByTestId("editor-reset-radial").click();
      await expect(page.getByTestId("radial-mask-overlay")).not.toBeVisible();
      await expect(radialSection).not.toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });

  test("Tastenkuerzel: 0=Reset-All, R=Crop-Toggle", async ({ page }) => {
    const user = await loginAsNewUser(page);
    try {
      await page.goto("/editor");
      await page.setInputFiles('[data-testid="editor-file-input"]', JPG_PATH);
      await expect(page.getByTestId("editor-bypass")).toBeVisible({ timeout: 5_000 });

      // Slider veraendern, dann via Tastenkuerzel zuruecksetzen
      const expo = page.getByTestId("slider-exposure").getByRole("slider");
      await expo.focus();
      await expo.press("ArrowRight");
      let value = await page.getByTestId("slider-exposure-value").textContent();
      expect(value?.startsWith("+0.01")).toBeTruthy();

      // Body-Fokus, dann '0'
      await page.locator("body").click({ position: { x: 0, y: 0 } });
      await page.keyboard.press("0");
      value = await page.getByTestId("slider-exposure-value").textContent();
      expect(value?.trim()).toBe("+0.00");

      // 'R' = Crop-Toggle
      await page.keyboard.press("r");
      await expect(page.getByTestId("crop-overlay")).toBeVisible();
      await page.keyboard.press("r");
      await expect(page.getByTestId("crop-overlay")).not.toBeVisible();
    } finally {
      await cleanupUser(user);
    }
  });
});
