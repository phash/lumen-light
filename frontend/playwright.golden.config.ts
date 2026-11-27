import { defineConfig, devices } from "@playwright/test";

/**
 * Golden-Harness: rendert RAW-Fixtures mit dem heutigen WebGL-Renderer und
 * schreibt die Ergebnisse nach tests-fixtures/goldens/. SwiftShader macht die
 * Ausgabe auf jeder Maschine (auch ohne GPU) gleich.
 */
export default defineConfig({
  testDir: "./golden-e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  reporter: [["list"]],
  webServer: {
    command: "pnpm exec vite --config vite.golden.config.ts --port 5199",
    port: 5199,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: {
    baseURL: "http://localhost:5199",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
        },
      },
    },
  ],
});
