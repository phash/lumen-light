import { useRef } from "react";

import type { LinearMask, PointUv } from "./mask";

interface Props {
  readonly mask: LinearMask;
  readonly onChangePoint: (which: "p1" | "p2", uv: PointUv) => void;
}

/**
 * Drag-Overlay fuer einen linearen Verlaufsfilter. Zwei grosse Drag-Punkte
 * an den Linien-Endpunkten, dazwischen eine Linie. Schnell, defensiv —
 * kein Animationspolish.
 */
export default function LinearMaskOverlay({ mask, onChangePoint }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<"p1" | "p2" | null>(null);

  const beginDrag = (
    which: "p1" | "p2",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* jsdom */
    }
    dragRef.current = which;
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const which = dragRef.current;
    const container = containerRef.current;
    if (!which || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const u = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const v = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    onChangePoint(which, { u, v });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current === null) return;
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      /* jsdom */
    }
    dragRef.current = null;
  };

  const p1Style = {
    left: `${mask.p1.u * 100}%`,
    top: `${mask.p1.v * 100}%`,
  };
  const p2Style = {
    left: `${mask.p2.u * 100}%`,
    top: `${mask.p2.v * 100}%`,
  };

  return (
    <div
      ref={containerRef}
      data-testid="linear-mask-overlay"
      className="absolute inset-0 pointer-events-none"
    >
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <line
          x1={`${mask.p1.u * 100}%`}
          y1={`${mask.p1.v * 100}%`}
          x2={`${mask.p2.u * 100}%`}
          y2={`${mask.p2.v * 100}%`}
          stroke="rgba(253,230,138,0.7)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>

      <div
        data-testid="linear-mask-handle-p1"
        onPointerDown={(e) => beginDrag("p1", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute -ml-2 -mt-2 w-4 h-4 rounded-full bg-amber-200 border-2 border-stone-900 cursor-grab pointer-events-auto"
        style={{ ...p1Style, touchAction: "none" }}
      />
      <div
        data-testid="linear-mask-handle-p2"
        onPointerDown={(e) => beginDrag("p2", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute -ml-2 -mt-2 w-4 h-4 rounded-full bg-amber-200 border-2 border-stone-900 cursor-grab pointer-events-auto"
        style={{ ...p2Style, touchAction: "none" }}
      />
    </div>
  );
}
