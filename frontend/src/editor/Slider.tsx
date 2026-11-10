import { useCallback, useId, useRef } from "react";

import {
  type AdjustmentKey,
  formatAdjustmentValue,
  isAtDefault,
} from "./adjustments";

interface Props {
  readonly adjustmentKey: AdjustmentKey;
  readonly label: string;
  readonly value: number;
  readonly defaultValue: number;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly tooltip?: string;
  readonly onChange: (next: number) => void;
}

export default function Slider({
  adjustmentKey,
  label,
  value,
  defaultValue,
  min,
  max,
  step,
  tooltip,
  onChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const draggingRef = useRef(false);

  const range = max - min;
  const pct = ((value - min) / range) * 100;
  const centerPct = ((defaultValue - min) / range) * 100;

  const setFromX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + t * range;
      const snapped = Math.round(raw / step) * step;
      onChange(Math.max(min, Math.min(max, snapped)));
    },
    [min, max, step, range, onChange],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = true;
    setFromX(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    setFromX(event.clientX);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onDoubleClick = () => onChange(defaultValue);

  // Auf das Step-Raster runden (verhindert Float-Drift wie 0.30000000004).
  const snap = (v: number): number => {
    const decimals = Math.max(0, Math.ceil(-Math.log10(step)));
    const snapped = Number((Math.round(v / step) * step).toFixed(decimals));
    return Math.max(min, Math.min(max, snapped));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const factor = event.shiftKey ? 10 : 1;
    // PageUp/PageDown: 10 % der Spanne (ARIA-Slider-Konvention).
    const page = Math.max(step, range / 10);
    let next: number | null = null;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowDown":
        next = value - step * factor;
        break;
      case "ArrowRight":
      case "ArrowUp":
        next = value + step * factor;
        break;
      case "PageDown":
        next = value - page;
        break;
      case "PageUp":
        next = value + page;
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      // Tastatur-Pendant zum Doppelklick: auf Default zuruecksetzen.
      case "Enter":
      case "Delete":
        next = defaultValue;
        break;
      default:
        return;
    }
    event.preventDefault();
    // Globale Editor-Shortcuts (Pfeil-Nudges, Zoom) nicht zusaetzlich ausloesen.
    event.stopPropagation();
    onChange(snap(next));
  };

  const atDefault = isAtDefault(adjustmentKey, value);

  return (
    <div
      className="select-none py-1.5"
      data-testid={`slider-${adjustmentKey}`}
      title={tooltip}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wider text-stone-400">
          {label}
        </span>
        <span
          className={`text-[12px] tabular-nums ${atDefault ? "text-stone-400" : "text-amber-200"}`}
          data-testid={`slider-${adjustmentKey}-value`}
        >
          {formatAdjustmentValue(adjustmentKey, value)}
        </span>
      </div>
      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatAdjustmentValue(adjustmentKey, value)}
        aria-describedby={tooltip ? tooltipId : undefined}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        className="relative h-5 py-3 -my-2 box-content cursor-ew-resize touch-none rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-stone-700" />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-stone-600"
          style={{ left: `${centerPct}%` }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-px bg-amber-300/70"
          style={{
            left: `${Math.min(centerPct, pct)}%`,
            width: `${Math.abs(pct - centerPct)}%`,
          }}
        />
        <div
          data-testid={`slider-${adjustmentKey}-thumb`}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-stone-200 ring-1 ring-stone-900 shadow-sm"
          style={{ left: `${pct}%` }}
        />
      </div>
      {tooltip && (
        // Tooltip fuer Screenreader/Tastatur — title allein ist nicht zugaenglich.
        <span id={tooltipId} className="sr-only">
          {tooltip}
        </span>
      )}
    </div>
  );
}
