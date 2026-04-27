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
  | "saturation";

export type Adjustments = Record<AdjustmentKey, number>;

export type AdjustmentGroup = "Licht" | "Farbe";

export interface AdjustmentDefinition {
  readonly key: AdjustmentKey;
  readonly label: string;
  readonly group: AdjustmentGroup;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

export const ADJUSTMENTS: ReadonlyArray<AdjustmentDefinition> = [
  { key: "exposure",    label: "Belichtung", group: "Licht", min: -5, max: 5, step: 0.01, default: 0 },
  { key: "contrast",    label: "Kontrast",   group: "Licht", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "highlights",  label: "Lichter",    group: "Licht", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "shadows",     label: "Tiefen",     group: "Licht", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "whites",      label: "Weiß",       group: "Licht", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "blacks",      label: "Schwarz",    group: "Licht", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "temperature", label: "Temperatur", group: "Farbe", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "tint",        label: "Tönung",     group: "Farbe", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "vibrance",    label: "Dynamik",    group: "Farbe", min: -1, max: 1, step: 0.01, default: 0 },
  { key: "saturation",  label: "Sättigung",  group: "Farbe", min: -1, max: 1, step: 0.01, default: 0 },
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
  return result;
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
