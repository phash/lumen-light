import { useEffect, useState } from "react";

import { computeHistogram, type HistogramBins } from "./histogram";

interface Props {
  readonly canvas: HTMLCanvasElement | null;
  /** Trigger fuer Re-Berechnung — Slider-Bewegung etc. */
  readonly tick: number;
}

const SAMPLE_DIM = 128;

export default function Histogram({ canvas, tick }: Props) {
  const [bins, setBins] = useState<HistogramBins | null>(null);

  useEffect(() => {
    if (!canvas) {
      // Reset, wenn kein Canvas mehr verfuegbar — legitime Effect-State-
      // Synchronisation (passt nicht ins "external system"-Schema der Regel).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBins(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      try {
        const off = document.createElement("canvas");
        off.width = SAMPLE_DIM;
        off.height = SAMPLE_DIM;
        const ctx = off.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(canvas, 0, 0, SAMPLE_DIM, SAMPLE_DIM);
        const { data } = ctx.getImageData(0, 0, SAMPLE_DIM, SAMPLE_DIM);
        setBins(computeHistogram(data));
      } catch {
        /* canvas evtl. noch nicht gerendert */
      }
    });
    return () => cancelAnimationFrame(id);
  }, [canvas, tick]);

  return (
    <div
      data-testid="histogram"
      className="h-20 w-full bg-stone-950 rounded-sm border border-stone-800/60 overflow-hidden relative"
    >
      {bins && (
        <svg viewBox={`0 0 ${bins.r.length} 40`} preserveAspectRatio="none" className="w-full h-full">
          {(["r", "g", "b"] as const).map((channel, i) => {
            const arr = bins[channel];
            const path =
              Array.from(arr)
                .map((v, x) => {
                  const y = 40 - (v / bins.max) * 38;
                  return `${x === 0 ? "M" : "L"}${x},${y}`;
                })
                .join(" ") + ` L${arr.length - 1},40 L0,40 Z`;
            const fills = ["#ef4444", "#22c55e", "#3b82f6"] as const;
            return (
              <path
                key={channel}
                d={path}
                fill={fills[i]}
                fillOpacity="0.35"
                style={{ mixBlendMode: "screen" }}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
