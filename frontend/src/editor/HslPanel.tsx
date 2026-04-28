/**
 * HSL-Mischer-Panel — 3 Achsen-Tabs (Hue/Saettigung/Luminanz) ueber 8
 * Farbtonbereichen. Stateless: Werte kommen vom Editor, Aenderungen
 * gehen via onChange in den Store.
 */
import { useState } from "react";

import {
  HSL_CHANNELS,
  type HslAdjustments,
  type HslAxis,
  type HslChannel,
} from "./adjustments";

interface Props {
  readonly hsl: HslAdjustments | null;
  readonly onChange: (axis: HslAxis, channel: HslChannel, value: number) => void;
  readonly onReset: () => void;
}

const AXES: ReadonlyArray<{ key: HslAxis; label: string }> = [
  { key: "hue", label: "Hue" },
  { key: "saturation", label: "Sättigung" },
  { key: "luminance", label: "Luminanz" },
];

const CHANNEL_LABEL: Record<HslChannel, string> = {
  red: "Rot",
  orange: "Orange",
  yellow: "Gelb",
  green: "Grün",
  aqua: "Aqua",
  blue: "Blau",
  violet: "Violett",
  magenta: "Magenta",
};

// CSS-Farben fuer die 8 Channel-Punkte. Kein Live-HSL-Mapping noetig —
// statische Anker reichen, der Slider zeigt den Verlauf.
const CHANNEL_COLOR: Record<HslChannel, string> = {
  red: "#dc2626",
  orange: "#ea580c",
  yellow: "#eab308",
  green: "#16a34a",
  aqua: "#06b6d4",
  blue: "#2563eb",
  violet: "#7c3aed",
  magenta: "#db2777",
};

function formatPct(v: number): string {
  return Math.round(v * 100).toString();
}

export default function HslPanel({ hsl, onChange, onReset }: Props) {
  const [axis, setAxis] = useState<HslAxis>("hue");

  const valueOf = (ch: HslChannel): number => {
    if (hsl === null) return 0;
    return hsl[axis][ch];
  };

  return (
    <div data-testid="hsl-panel" className="space-y-3">
      <div className="flex gap-1" role="tablist" aria-label="HSL-Achse">
        {AXES.map((a) => (
          <button
            key={a.key}
            type="button"
            role="tab"
            aria-selected={axis === a.key}
            data-testid={`hsl-axis-${a.key}`}
            onClick={() => setAxis(a.key)}
            className={`flex-1 py-1 text-[10px] uppercase tracking-[0.2em] border ${
              axis === a.key
                ? "border-amber-300/60 text-amber-200 bg-amber-200/10"
                : "border-stone-800 text-stone-400 hover:border-amber-300/30"
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        {HSL_CHANNELS.map((ch) => {
          const v = valueOf(ch);
          return (
            <label
              key={ch}
              className="grid grid-cols-[14px_72px_1fr_36px] items-center gap-2 text-[11px]"
              data-testid={`hsl-row-${axis}-${ch}`}
            >
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ backgroundColor: CHANNEL_COLOR[ch] }}
                aria-hidden
              />
              <span className="text-stone-300">{CHANNEL_LABEL[ch]}</span>
              <input
                type="range"
                min={-1}
                max={1}
                step={0.01}
                value={v}
                onChange={(e) => onChange(axis, ch, Number(e.target.value))}
                className="w-full"
                data-testid={`hsl-slider-${axis}-${ch}`}
              />
              <span className="text-right tabular-nums text-stone-500">
                {formatPct(v)}
              </span>
            </label>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onReset}
        data-testid="hsl-reset"
        className="w-full py-1.5 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40 transition-colors"
      >
        HSL zurücksetzen
      </button>
    </div>
  );
}
