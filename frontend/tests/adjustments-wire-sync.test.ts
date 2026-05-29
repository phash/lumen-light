import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import type { Adjustments } from "../src/api/client";
import { ADJUSTMENTS } from "../src/editor/adjustments";

// Kanonisches Schema (Backend) als Single Source of Truth fuer die
// Wire-Adjustments. Per fs gelesen (statt JSON-Import), damit kein
// rootDir-Konflikt mit der Datei ausserhalb des Frontend-Projekts entsteht.
// vitest laeuft mit cwd = frontend/, das Backend-Schema liegt daneben.
const schema = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../backend/schemas/adjustments.schema.json"),
    "utf8",
  ),
) as { properties: Record<string, unknown> };

const SCHEMA_KEYS = Object.keys(schema.properties);
const SCHEMA_SCALARS = SCHEMA_KEYS.filter((k) => k !== "hsl" && k !== "toneCurve");

// Vollstaendiges Adjustments-Objekt, getypt als API-Wire-`Adjustments`.
// Fehlt in client.ts ein Schema-Feld (oder eins zu viel), schlaegt schon
// `tsc -b` hier fehl (missing/excess Property). Der Laufzeit-Vergleich unten
// faengt zusaetzlich den Fall ab, dass das Sample selbst aus dem Tritt geraet.
const WIRE_SAMPLE: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
  sharpness: 0,
  noiseReduction: 0,
  highlightRecovery: 0,
  localContrast: 0,
  hsl: null,
  toneCurve: null,
};

describe("Adjustments Wire-Format Sync", () => {
  test("Editor-ADJUSTMENTS deckt exakt die skalaren Schema-Felder ab", () => {
    const editorKeys = ADJUSTMENTS.map((a) => a.key).sort();
    expect(editorKeys).toEqual([...SCHEMA_SCALARS].sort());
  });

  test("client.ts Adjustments deckt exakt alle Schema-Properties ab", () => {
    expect(Object.keys(WIRE_SAMPLE).sort()).toEqual([...SCHEMA_KEYS].sort());
  });
});
