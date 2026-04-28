import { useRef } from "react";

import type { PointUv, RadialMask } from "./mask";
import { applyUv } from "./transform";

interface Props {
  readonly mask: RadialMask;
  readonly onChangeCenter: (uv: PointUv) => void;
  readonly onChangeRadii: (rx: number, ry: number) => void;
  readonly forwardUvTransform: Float32Array;
  readonly inverseUvTransform: Float32Array;
}

type DragMode = "center" | "rx" | "ry";

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Drag-Overlay fuer eine elliptische Radialmaske. Drei Drag-Handles:
 * Zentrum, Ost-Handle (rx), Sued-Handle (ry).
 *
 * Coordinate-Systeme analog zum LinearMaskOverlay: Container ist
 * Output-UV (post-crop), Mask-State ist Source-UV. Forward/Inverse
 * Transforms uebersetzen zwischen beidem. Radien (rx/ry) sind im
 * Source-System; bei der Anzeige werden sie ueber den linearen Anteil
 * der Inverse-Matrix in Output-Space skaliert (cw/ch im Identitaets-
 * Pfad, pure Skalierung — Rotation durch straighten ist klein und
 * wird hier ignoriert, weil die Ellipse-SVG keine Rotation unterstuetzt).
 */
export default function RadialMaskOverlay({
  mask,
  onChangeCenter,
  onChangeRadii,
  forwardUvTransform,
  inverseUvTransform,
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
    const outU = clamp01((event.clientX - rect.left) / rect.width);
    const outV = clamp01((event.clientY - rect.top) / rect.height);
    const src = applyUv(forwardUvTransform, outU, outV);
    if (which === "center") {
      onChangeCenter({ u: clamp01(src.x), v: clamp01(src.y) });
    } else if (which === "rx") {
      onChangeRadii(Math.abs(src.x - mask.center.u), mask.ry);
    } else {
      onChangeRadii(mask.rx, Math.abs(src.y - mask.center.v));
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

  // Source-UV → Output-UV fuer Anzeige.
  const centerOut = applyUv(inverseUvTransform, mask.center.u, mask.center.v);
  const rxEnd = applyUv(
    inverseUvTransform,
    mask.center.u + mask.rx,
    mask.center.v,
  );
  const ryEnd = applyUv(
    inverseUvTransform,
    mask.center.u,
    mask.center.v + mask.ry,
  );
  const rxOut = Math.abs(rxEnd.x - centerOut.x);
  const ryOut = Math.abs(ryEnd.y - centerOut.y);

  const centerStyle = {
    left: `${centerOut.x * 100}%`,
    top: `${centerOut.y * 100}%`,
  };
  const rxStyle = {
    left: `${(centerOut.x + rxOut) * 100}%`,
    top: `${centerOut.y * 100}%`,
  };
  const ryStyle = {
    left: `${centerOut.x * 100}%`,
    top: `${(centerOut.y + ryOut) * 100}%`,
  };

  return (
    <div
      ref={containerRef}
      data-testid="radial-mask-overlay"
      className="absolute inset-0 pointer-events-none"
    >
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <ellipse
          cx={`${centerOut.x * 100}%`}
          cy={`${centerOut.y * 100}%`}
          rx={`${rxOut * 100}%`}
          ry={`${ryOut * 100}%`}
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
