import { useRef } from "react";

import type { PointUv, RadialMask } from "./mask";

interface Props {
  readonly mask: RadialMask;
  readonly onChangeCenter: (uv: PointUv) => void;
  readonly onChangeRadii: (rx: number, ry: number) => void;
}

type DragMode = "center" | "rx" | "ry";

/**
 * Drag-Overlay fuer eine elliptische Radialmaske. Drei Drag-Handles:
 * Zentrum (verschiebt Ellipse), Ost-Handle (rx), Sued-Handle (ry).
 * SVG-Ellipse visualisiert den Maskenbereich.
 */
export default function RadialMaskOverlay({
  mask,
  onChangeCenter,
  onChangeRadii,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);

  const beginDrag = (
    which: DragMode,
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
    if (which === "center") {
      onChangeCenter({ u, v });
    } else if (which === "rx") {
      onChangeRadii(Math.abs(u - mask.center.u), mask.ry);
    } else {
      onChangeRadii(mask.rx, Math.abs(v - mask.center.v));
    }
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

  const centerStyle = {
    left: `${mask.center.u * 100}%`,
    top: `${mask.center.v * 100}%`,
  };
  const rxStyle = {
    left: `${(mask.center.u + mask.rx) * 100}%`,
    top: `${mask.center.v * 100}%`,
  };
  const ryStyle = {
    left: `${mask.center.u * 100}%`,
    top: `${(mask.center.v + mask.ry) * 100}%`,
  };

  return (
    <div
      ref={containerRef}
      data-testid="radial-mask-overlay"
      className="absolute inset-0 pointer-events-none"
    >
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <ellipse
          cx={`${mask.center.u * 100}%`}
          cy={`${mask.center.v * 100}%`}
          rx={`${mask.rx * 100}%`}
          ry={`${mask.ry * 100}%`}
          fill="none"
          stroke="rgba(253,230,138,0.7)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>

      <div
        data-testid="radial-mask-handle-center"
        onPointerDown={(e) => beginDrag("center", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute -ml-2 -mt-2 w-4 h-4 rounded-full bg-amber-200 border-2 border-stone-900 cursor-grab pointer-events-auto"
        style={{ ...centerStyle, touchAction: "none" }}
      />
      <div
        data-testid="radial-mask-handle-rx"
        onPointerDown={(e) => beginDrag("rx", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute -ml-1.5 -mt-1.5 w-3 h-3 rounded-full bg-amber-200 border-2 border-stone-900 cursor-ew-resize pointer-events-auto"
        style={{ ...rxStyle, touchAction: "none" }}
      />
      <div
        data-testid="radial-mask-handle-ry"
        onPointerDown={(e) => beginDrag("ry", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className="absolute -ml-1.5 -mt-1.5 w-3 h-3 rounded-full bg-amber-200 border-2 border-stone-900 cursor-ns-resize pointer-events-auto"
        style={{ ...ryStyle, touchAction: "none" }}
      />
    </div>
  );
}
