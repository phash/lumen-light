import {
  ADJUSTMENTS,
  defaultAdjustments,
  defaultHslAdjustments,
  type Adjustments,
  type AdjustmentKey,
} from "../src/editor/adjustments";

export interface GoldenSet {
  readonly id: string;
  /** true = Ton-Grundregler fuer den Spike (S2), false = spaetere Meilensteine. */
  readonly spike: boolean;
  readonly adjustments: Adjustments;
}

/** Grenzwert eines Reglers aus ADJUSTMENTS (nie hart codiert). */
function limit(key: AdjustmentKey, which: "min" | "max"): number {
  const def = ADJUSTMENTS.find((a) => a.key === key);
  if (!def) throw new Error(`Unbekanntes Adjustment: ${key}`);
  return def[which];
}

/** Nur diese Fixtures (Dateiname ohne Endung) bekommen alle Sets; Groessenbudget. */
export const fullFixtures: readonly string[] = ["Nikon_D7100", "Nikon_1_S2_portrait"];

/** Set-Ids, die jedes uebrige Fixture bekommt. */
export const reducedSetIds: readonly string[] = ["neutral-pv2", "neutral-pv1", "combo-pv2"];

/** Sets fuer ein Fixture (Stem): alle fuer fullFixtures, sonst die reduzierte Auswahl. */
export function setsForFixture(stem: string): GoldenSet[] {
  const all = goldenSets();
  return fullFixtures.includes(stem) ? all : all.filter((s) => reducedSetIds.includes(s.id));
}

function make(patch: Partial<Adjustments>): Adjustments {
  return { ...defaultAdjustments(), ...patch };
}

const COMBO = {
  exposure: 0.7,
  contrast: 30 / 100,
  highlights: -60 / 100,
  shadows: 40 / 100,
  temperature: 20 / 100,
} as const;

export function goldenSets(): GoldenSet[] {
  const hsl = defaultHslAdjustments();
  const hslMix: Adjustments["hsl"] = {
    hue: { ...hsl.hue, red: 50 / 100 },
    saturation: { ...hsl.saturation, blue: -80 / 100 },
    luminance: { ...hsl.luminance, green: 40 / 100 },
  };
  return [
    { id: "neutral-pv2", spike: true, adjustments: make({}) },
    { id: "neutral-pv1", spike: true, adjustments: make({ processVersion: 1 }) },
    { id: "exposure-p2", spike: true, adjustments: make({ exposure: 2 }) },
    { id: "exposure-m2", spike: true, adjustments: make({ exposure: -2 }) },
    { id: "contrast-p100", spike: true, adjustments: make({ contrast: limit("contrast", "max") }) },
    { id: "contrast-m100", spike: true, adjustments: make({ contrast: limit("contrast", "min") }) },
    { id: "highlights-m100", spike: true, adjustments: make({ highlights: limit("highlights", "min") }) },
    { id: "shadows-p100", spike: true, adjustments: make({ shadows: limit("shadows", "max") }) },
    { id: "whites-p100", spike: true, adjustments: make({ whites: limit("whites", "max") }) },
    { id: "blacks-m100", spike: true, adjustments: make({ blacks: limit("blacks", "min") }) },
    { id: "temperature-p100", spike: true, adjustments: make({ temperature: limit("temperature", "max") }) },
    { id: "temperature-m100", spike: true, adjustments: make({ temperature: limit("temperature", "min") }) },
    { id: "tint-p100", spike: true, adjustments: make({ tint: limit("tint", "max") }) },
    { id: "combo-pv2", spike: true, adjustments: make({ ...COMBO }) },
    { id: "combo-pv1", spike: true, adjustments: make({ ...COMBO, processVersion: 1 }) },
    { id: "vibrance-p100", spike: false, adjustments: make({ vibrance: limit("vibrance", "max") }) },
    { id: "saturation-m100", spike: false, adjustments: make({ saturation: limit("saturation", "min") }) },
    { id: "sharpness-max", spike: false, adjustments: make({ sharpness: limit("sharpness", "max") }) },
    { id: "noise-max", spike: false, adjustments: make({ noiseReduction: limit("noiseReduction", "max") }) },
    { id: "local-contrast-max", spike: false, adjustments: make({ localContrast: limit("localContrast", "max") }) },
    {
      id: "highlight-recovery-max",
      spike: false,
      adjustments: make({ highlightRecovery: limit("highlightRecovery", "max") }),
    },
    { id: "hsl-mix", spike: false, adjustments: make({ hsl: hslMix }) },
    {
      id: "curve-s",
      spike: false,
      adjustments: make({
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.25, y: 0.18 },
            { x: 0.75, y: 0.85 },
            { x: 1, y: 1 },
          ],
        },
      }),
    },
  ];
}
