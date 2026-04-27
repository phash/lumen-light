import { useCallback, useRef } from "react";

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
  onChange,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
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

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const factor = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange(Math.max(min, value - step * factor));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      onChange(Math.min(max, value + step * factor));
    }
  };

  const atDefault = isAtDefault(adjustmentKey, value);

  return (
    <div
      className="select-none py-1.5"
      data-testid={`slider-${adjustmentKey}`}
    >
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] uppercase tracking-wider text-stone-400">
          {label}
        </span>
        <span
          className={`text-[12px] tabular-nums ${atDefault ? "text-stone-500" : "text-amber-200"}`}
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
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        className="relative h-5 cursor-ew-resize touch-none focus:outline-none focus:ring-1 focus:ring-amber-300/40"
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
    </div>
  );
}
