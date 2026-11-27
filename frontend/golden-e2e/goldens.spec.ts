/// <reference lib="dom" />
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { goldenSets, setsForFixture } from "../golden/sets";

interface ManifestSample {
  filename: string;
}
interface SourceJson {
  width: number;
  height: number;
  srcWidth: number;
  srcHeight: number;
  make: string;
  model: string;
}
interface Rendered {
  source: SourceJson & { rgb16Base64: string };
  pngs: Record<string, string>;
}

declare global {
  interface Window {
    renderGoldens: (fixtureUrl: string, sets: never) => Promise<Rendered>;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, "../../tests-fixtures");
const RAW_DIR = join(FIXTURES, "raw-samples");
const GOLDEN_DIR = join(FIXTURES, "goldens");

const manifest = JSON.parse(readFileSync(join(FIXTURES, "manifest.json"), "utf8")) as {
  samples: ManifestSample[];
};
const available = manifest.samples.filter((s) => existsSync(join(RAW_DIR, s.filename)));

async function render(page: Page, filename: string, fixtureSets = setsForFixture(parse(filename).name)): Promise<Rendered> {
  await page.goto("/golden/index.html");
  await page.waitForFunction(() => typeof window.renderGoldens === "function");
  const url = `/@fs/${join(RAW_DIR, filename)}`;
  return page.evaluate(([u, s]) => window.renderGoldens(u as string, s as never), [url, fixtureSets] as const);
}

function dataUrlToBuffer(dataUrl: string): Buffer {
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
}

test.describe.configure({ mode: "serial" });

test("fixtures sind vorhanden", () => {
  expect(available.length).toBeGreaterThan(0);
});

for (const sample of available) {
  const stem = parse(sample.filename).name;
  test(`goldens erzeugen fuer ${stem}`, async ({ page }) => {
    const fixtureSets = setsForFixture(stem);
    const { source, pngs } = await render(page, sample.filename, fixtureSets);
    const dir = join(GOLDEN_DIR, stem);
    mkdirSync(dir, { recursive: true });
    const { rgb16Base64, ...meta } = source;
    writeFileSync(join(dir, "source.json"), JSON.stringify(meta, null, 2) + "\n");
    const rgb = Buffer.from(rgb16Base64, "base64");
    expect(rgb.length).toBe(meta.width * meta.height * 3 * 2);
    writeFileSync(join(dir, "source.rgb16"), rgb);
    for (const set of fixtureSets) {
      const png = pngs[set.id];
      expect(png, set.id).toBeTruthy();
      writeFileSync(join(dir, `${set.id}.png`), dataUrlToBuffer(png as string));
    }
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(join(GOLDEN_DIR, "sets.json"), JSON.stringify(goldenSets(), null, 2) + "\n");
  });
}

test("goldens sind deterministisch", async ({ page }) => {
  const sample = available.find((s) => parse(s.filename).name === "Nikon_D7100");
  test.skip(!sample, "Nikon_D7100 nicht vorhanden");
  const first = await render(page, sample!.filename);
  const second = await render(page, sample!.filename);
  expect(second.source.rgb16Base64 === first.source.rgb16Base64).toBe(true);
  for (const set of setsForFixture("Nikon_D7100")) {
    const a = dataUrlToBuffer(first.pngs[set.id] as string);
    const b = dataUrlToBuffer(second.pngs[set.id] as string);
    expect(a.equals(b), `PNG ${set.id} byte-gleich`).toBe(true);
  }
});

test("hochformat fixture hat hoehe groesser breite", () => {
  const portraits = available
    .map((s) => parse(s.filename).name)
    .filter((stem) => existsSync(join(GOLDEN_DIR, stem, "source.json")))
    .map((stem) => JSON.parse(readFileSync(join(GOLDEN_DIR, stem, "source.json"), "utf8")) as SourceJson)
    .filter((m) => m.height > m.width);
  expect(portraits.length).toBeGreaterThan(0);
});
