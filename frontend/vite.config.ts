import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // @mediapipe/face_detection ist UMD-only und bricht das ESM-
      // Bundling von @tensorflow-models/face-detection. Wir nutzen
      // runtime: "tfjs" und brauchen das Mediapipe-Klassen-Symbol nie
      // zur Laufzeit — der Shim wirft, falls jemand den Pfad doch
      // erreicht (verhindert Silent-Failure).
      "@mediapipe/face_detection": fileURLToPath(
        new URL(
          "./src/editor/__shims__/mediapipe-face-detection-shim.ts",
          import.meta.url,
        ),
      ),
    },
  },
  server: { port: 5173 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
