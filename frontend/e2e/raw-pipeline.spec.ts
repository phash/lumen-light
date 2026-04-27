import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { cleanupUser, loginAsNewUser } from "./auth-helper";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "tests-fixtures", "raw-samples");
const MANIFEST_PATH = join(HERE, "..", "..", "tests-fixtures", "manifest.json");

interface ManifestSample {
  filename: string;
  format: string;
  expectedMake: string;
  expectedModelContains: string;
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as {
  samples: ManifestSample[];
};

test.describe("RAW-Pipeline gegen echten Korpus", () => {
  for (const sample of manifest.samples) {
    const path = join(FIXTURES, sample.filename);
    const present = existsSync(path);

    (present ? test : test.skip)(
      `${sample.filename} (${sample.format}) decodiert + Camera-Info`,
      async ({ page }) => {
        const user = await loginAsNewUser(page);
        try {
          await page.goto("/editor");
          await page.setInputFiles('[data-testid="editor-file-input"]', path);

          // RAW-Decoding: zuerst Indicator sichtbar, dann verschwindet
          await expect(page.getByTestId("editor-decoding")).toBeVisible({
            timeout: 5_000,
          });
          await expect(page.getByTestId("editor-decoding")).toBeHidden({
            timeout: 60_000,
          });

          // Bypass-Button (= Bild geladen + Renderer hat Texture)
          await expect(page.getByTestId("editor-bypass")).toBeVisible({
            timeout: 5_000,
          });

          // Kein Error
          await expect(page.getByTestId("editor-error")).toHaveCount(0);

          // Slider funktioniert auf dem RAW
          const expoSlider = page
            .getByTestId("slider-exposure")
            .getByRole("slider");
          await expoSlider.focus();
          await expoSlider.press("ArrowRight");
          const value = await page
            .getByTestId("slider-exposure-value")
            .textContent();
          expect(value?.startsWith("+0.01")).toBeTruthy();

          // Camera-Info — case-insensitive Substring-Match auf den
          // erwarteten Hersteller-Namen.
          const cameraInfo = page.getByTestId("editor-camera-info");
          await expect(cameraInfo).toBeVisible({ timeout: 5_000 });
          const text = (await cameraInfo.textContent()) ?? "";
          expect(text.toLowerCase()).toContain(
            sample.expectedMake.toLowerCase().split(" ")[0]!,
          );

          // Lens-Profil wurde automatisch angewendet — alle Korpus-Files
          // matchen ein Profil aus infra/lensfun/profiles.json.
          const lensStatus = page.getByTestId("lens-profile-status");
          await expect(lensStatus).toContainText("auto");
        } finally {
          await cleanupUser(user);
        }
      },
    );
  }
});
