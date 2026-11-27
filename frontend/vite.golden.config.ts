import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

// Eigener Vite-Server nur fuer den Golden-Harness (Port 5199). Liefert die
// RAW-Fixtures ueber /@fs/ aus tests-fixtures/raw-samples.
const frontendRoot = fileURLToPath(new URL(".", import.meta.url));
const rawSamples = fileURLToPath(new URL("../tests-fixtures/raw-samples", import.meta.url));

export default defineConfig({
  root: frontendRoot,
  // Nur den Harness scannen, nicht die ganze App (TF.js/Mediapipe braucht er nicht).
  optimizeDeps: { entries: ["golden/index.html"] },
  server: {
    port: 5199,
    strictPort: true,
    fs: { allow: [frontendRoot, rawSamples, fileURLToPath(new URL("../backend/schemas", import.meta.url))] },
  },
});
