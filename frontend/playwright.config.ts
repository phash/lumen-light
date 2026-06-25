import { defineConfig, devices } from "@playwright/test";

const BASE_URL = process.env.LUMEN_BASE_URL ?? "http://localhost:5173";

/**
 * Playwright-Konfiguration. Die Tests laufen gegen einen bereits hoch-
 * gefahrenen Dev-Stack (siehe deployment/docker-compose.dev.yml) — kein
 * webServer-Eintrag, weil Backend + Keycloak + MinIO ausserhalb dieses
 * Frontend-Repos starten.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  // list = lesbare Konsolen-Ausgabe; html = durchsuchbarer Report mit
  // eingebetteten Traces/Screenshots, der im nightly-Workflow als Artifact
  // hochgeladen wird (sonst existiert kein playwright-report/-Verzeichnis).
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
