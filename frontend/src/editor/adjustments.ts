/**
 * Adjustment-Definitionen — Single Source of Truth fuer Slider-UI und
 * Shader-Uniforms im Frontend. Synchron mit
 * backend/schemas/adjustments.schema.json (Backend-Schema-Sync-Test
 * verhindert Drift).
 */

export type AdjustmentKey =
  | "exposure"
  | "contrast"
  | "highlights"
  | "shadows"
  | "whites"
  | "blacks"
  | "temperature"
  | "tint"
  | "vibrance"
  | "saturation"
  | "sharpness"
  | "noiseReduction"
  | "highlightRecovery";

export type ScalarAdjustments = Record<AdjustmentKey, number>;

// HSL: 8 Farbtonbereiche x 3 Achsen, Single Source of Truth fuer Backend +
// Shader. Reihenfolge muss mit HSL_CENTERS in shaders.ts und mit
// app.schemas.HSL_CHANNEL_NAMES uebereinstimmen.
export const HSL_CHANNELS = [
  "red",
  "orange",
  "yellow",
  "green",
  "aqua",
  "blue",
  "violet",
  "magenta",
] as const;

export type HslChannel = (typeof HSL_CHANNELS)[number];
export type HslAxis = "hue" | "saturation" | "luminance";

// HSL-Shader-Konstanten — Single-Source-of-Truth. Der GLSL-Shader hat
// dieselben Werte als `const float`-Literale; Sync-Test deckt das
// per Regex-Match ab.
export const HSL_SIGMA = 0.05;
export const HSL_HUE_GAIN = 0.1;
export const HSL_LUM_GAIN = 0.3;

export interface HslAdjustments {
  readonly hue: Record<HslChannel, number>;
  readonly saturation: Record<HslChannel, number>;
  readonly luminance: Record<HslChannel, number>;
}

export interface ToneCurvePoint {
  readonly x: number;
  readonly y: number;
}

export interface ToneCurve {
  // 2..8 Stuetzpunkte, sortiert nach x. Wireformat camelCase wegen
  // Backend-Konvention (siehe schemas.py: toneCurve).
  readonly points: ReadonlyArray<ToneCurvePoint>;
}

export const TONE_CURVE_MIN_POINTS = 2;
export const TONE_CURVE_MAX_POINTS = 8;

export type Adjustments = ScalarAdjustments & {
  // null = HSL inaktiv (Speicher-Optimierung im Backend-JSONB).
  readonly hsl: HslAdjustments | null;
  // null = Tonkurve = Identitaet.
  readonly toneCurve: ToneCurve | null;
};

export type AdjustmentGroup = "Licht" | "Farbe" | "Detail";

export interface AdjustmentDefinition {
  readonly key: AdjustmentKey;
  readonly label: string;
  readonly group: AdjustmentGroup;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
  /** Erklaerender Tooltip — wird im Slider als title-Attribut gesetzt
   *  und beim Hover gezeigt. Hilft Hobby-Fotografen mit Fachbegriffen. */
  readonly tooltip: string;
}

export const ADJUSTMENTS: ReadonlyArray<AdjustmentDefinition> = [
  { key: "exposure",    label: "Belichtung", group: "Licht", min: -5, max: 5, step: 0.01, default: 0,
    tooltip: "Globale Helligkeit in Blendenstufen. +1 = doppelt so hell." },
  { key: "contrast",    label: "Kontrast",   group: "Licht", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Spreizt Hell-Dunkel-Unterschiede um die Mitte. Negativ = flacher." },
  { key: "highlights",  label: "Lichter",    group: "Licht", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Korrigiert nur die hellen Bildbereiche. Negativ rettet ueberbelichtete Wolken/Haut." },
  { key: "shadows",     label: "Tiefen",     group: "Licht", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Korrigiert nur die dunklen Bildbereiche. Positiv hellt Schatten auf, ohne das Bild flach zu machen." },
  { key: "whites",      label: "Weiß",       group: "Licht", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Setzt den hellsten Punkt. Negativ verhindert Clip in den Lichtern." },
  { key: "blacks",      label: "Schwarz",    group: "Licht", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Setzt den dunkelsten Punkt. Negativ verstaerkt tiefes Schwarz." },
  { key: "highlightRecovery", label: "Lichter retten", group: "Licht", min: 0, max: 1, step: 0.01, default: 0,
    tooltip: "Rettet ausgebrannte Bereiche, indem geclippte Farbkanaele auf den Mittelwert der unclipped Kanaele gezogen werden. Entfernt Magenta-Cast in der Sonne. (RawTherapee-Blend-Modus inspiriert.)" },
  { key: "temperature", label: "Temperatur", group: "Farbe", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Weissabgleich blau↔gelb. Positiv = waermer." },
  { key: "tint",        label: "Tönung",     group: "Farbe", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Weissabgleich gruen↔magenta. Korrigiert Farbstich bei Mischlicht." },
  { key: "vibrance",    label: "Dynamik",    group: "Farbe", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Saettigung, die schon-bunte Bereiche und Hauttoene schont. Sicherer als Saettigung." },
  { key: "saturation",  label: "Sättigung",  group: "Farbe", min: -1, max: 1, step: 0.01, default: 0,
    tooltip: "Globale Farbintensitaet. Schnell uebertrieben — mit Dynamik kombinieren." },
  { key: "sharpness",      label: "Schärfen",   group: "Detail", min: 0, max: 1, step: 0.01, default: 0,
    tooltip: "Unsharp-Mask. Hebt Kanten an. Mit Bedacht — Halos bei zu viel." },
  { key: "noiseReduction", label: "Rauschen",   group: "Detail", min: 0, max: 1, step: 0.01, default: 0,
    tooltip: "Bilateral-Filter glaettet Rauschen, schont Kanten. Gut fuer ISO-hohe Aufnahmen." },
] as const;

const ADJUSTMENT_BY_KEY: ReadonlyMap<AdjustmentKey, AdjustmentDefinition> = new Map(
  ADJUSTMENTS.map((a) => [a.key, a]),
);

export function getAdjustment(key: AdjustmentKey): AdjustmentDefinition {
  const def = ADJUSTMENT_BY_KEY.get(key);
  if (!def) throw new Error(`Unbekanntes Adjustment: ${key}`);
  return def;
}

export function defaultAdjustments(): Adjustments {
  const result = {} as Record<AdjustmentKey, number>;
  for (const a of ADJUSTMENTS) {
    result[a.key] = a.default;
  }
  return { ...result, hsl: null, toneCurve: null };
}

export function defaultToneCurve(): ToneCurve {
  return {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  };
}

export function isToneCurveIdentity(curve: ToneCurve | null): boolean {
  if (curve === null) return true;
  if (curve.points.length !== 2) return false;
  const [a, b] = curve.points;
  if (!a || !b) return false;
  return (
    Math.abs(a.x - 0) < 1e-4 &&
    Math.abs(a.y - 0) < 1e-4 &&
    Math.abs(b.x - 1) < 1e-4 &&
    Math.abs(b.y - 1) < 1e-4
  );
}

export function defaultHslAdjustments(): HslAdjustments {
  const make = (): Record<HslChannel, number> => {
    const o = {} as Record<HslChannel, number>;
    for (const ch of HSL_CHANNELS) o[ch] = 0;
    return o;
  };
  return { hue: make(), saturation: make(), luminance: make() };
}

export function isHslNeutral(hsl: HslAdjustments | null): boolean {
  if (hsl === null) return true;
  for (const axis of ["hue", "saturation", "luminance"] as const) {
    for (const ch of HSL_CHANNELS) {
      if (Math.abs(hsl[axis][ch]) > 1e-4) return false;
    }
  }
  return true;
}

export function clampAdjustment(key: AdjustmentKey, value: number): number {
  const def = getAdjustment(key);
  if (Number.isNaN(value)) return def.default;
  return Math.max(def.min, Math.min(def.max, value));
}

export function isAtDefault(key: AdjustmentKey, value: number): boolean {
  return Math.abs(value - getAdjustment(key).default) < 1e-4;
}

export function formatAdjustmentValue(key: AdjustmentKey, value: number): string {
  if (key === "exposure") {
    return (value >= 0 ? "+" : "") + value.toFixed(2);
  }
  return Math.round(value * 100).toString();
}

export function adjustmentsByGroup(): ReadonlyMap<AdjustmentGroup, ReadonlyArray<AdjustmentDefinition>> {
  const map = new Map<AdjustmentGroup, AdjustmentDefinition[]>();
  for (const a of ADJUSTMENTS) {
    const list = map.get(a.group) ?? [];
    list.push(a);
    map.set(a.group, list);
  }
  return map;
}
