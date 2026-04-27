/**
 * Verifikation der RAW-Detection gegen den echten Test-Korpus.
 * Setzt voraus, dass tests-fixtures/raw-samples/ via
 * scripts/fetch-test-images.sh gezogen wurde — sonst werden alle Tests
 * mit it.skip uebersprungen.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { detectRawFormat } from "../src/editor/raw";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "..", "..", "tests-fixtures", "raw-samples");
const MANIFEST_PATH = join(HERE, "..", "..", "tests-fixtures", "manifest.json");

interface ManifestSample {
  filename: string;
  format: string;
  expectedMake: string;
  expectedModelContains: string;
}
interface Manifest {
  samples: ManifestSample[];
}

const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest;

describe("RAW-Korpus · detectRawFormat", () => {
  for (const sample of manifest.samples) {
    const path = join(FIXTURES, sample.filename);
    const exists = existsSync(path);
    (exists ? it : it.skip)(
      `${sample.filename} -> ${sample.format}`,
      () => {
        const fileBytes = readFileSync(path);
        const header = new Uint8Array(fileBytes.subarray(0, 32));
        const detected = detectRawFormat(sample.filename, header);
        expect(detected).toBe(sample.format);
      },
    );
  }

  it("Magic-Bytes erkennen RAF auch bei umbenannter Endung", () => {
    const rafPath = join(FIXTURES, "Fujifilm_X-Pro1.RAF");
    if (!existsSync(rafPath)) return;
    const fileBytes = readFileSync(rafPath);
    const header = new Uint8Array(fileBytes.subarray(0, 32));
    expect(detectRawFormat("renamed.bin", header)).toBe("raf");
  });

  it("Magic-Bytes erkennen CR3 auch bei umbenannter Endung", () => {
    const cr3Path = join(FIXTURES, "Canon_EOS_R.CR3");
    if (!existsSync(cr3Path)) return;
    const fileBytes = readFileSync(cr3Path);
    const header = new Uint8Array(fileBytes.subarray(0, 32));
    expect(detectRawFormat("renamed.bin", header)).toBe("cr3");
  });
});
