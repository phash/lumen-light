import { useRef } from "react";

import type { LinearMask, PointUv } from "./mask";
import { applyUv } from "./transform";

interface Props {
  readonly mask: LinearMask;
  readonly onChangePoint: (which: "p1" | "p2", uv: PointUv) => void;
  /** Forward-Transform: Output-UV (Container, post-crop) → Source-UV.
   *  Wird beim Drag genutzt, damit die gespeicherten Mask-Koordinaten
   *  ins Source-System landen — der Shader evaluiert die Maske gegen
   *  Source-UV. */
  readonly forwardUvTransform: Float32Array;
  /** Inverse-Transform: Source-UV → Output-UV. Wird zur Anzeige der
   *  Handles in den Container-Koordinaten benoetigt. */
  readonly inverseUvTransform: Float32Array;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Drag-Overlay fuer einen linearen Verlaufsfilter. Zwei grosse Drag-Punkte
 * an den Linien-Endpunkten, dazwischen eine Linie.
 *
 * Coordinate-Systeme:
 * - Container = Output (post-crop). Drag-Position wird in Output-UV
 *   normalisiert.
 * - Mask-State = Source-UV. Forward-Transform ueber `forwardUvTransform`
 *   beim Speichern; Inverse zur Anzeige.
 */
export default function LinearMaskOverlay({
  mask,
  onChangePoint,
  forwardUvTransform,
  inverseUvTransform,
}: Props) {
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
    const outU = clamp01((event.clientX - rect.left) / rect.width);
    const outV = clamp01((event.clientY - rect.top) / rect.height);
    const src = applyUv(forwardUvTransform, outU, outV);
    onChangePoint(which, { u: clamp01(src.x), v: clamp01(src.y) });
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

  // Source-UV → Output-UV fuer Handle-Positionen.
  const p1Out = applyUv(inverseUvTransform, mask.p1.u, mask.p1.v);
  const p2Out = applyUv(inverseUvTransform, mask.p2.u, mask.p2.v);
  const p1Style = {
    left: `${p1Out.x * 100}%`,
    top: `${p1Out.y * 100}%`,
  };
  const p2Style = {
    left: `${p2Out.x * 100}%`,
    top: `${p2Out.y * 100}%`,
  };

  return (
    <div
      ref={containerRef}
      data-testid="linear-mask-overlay"
      className="absolute inset-0 pointer-events-none"
    >
      <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
        <line
          x1={`${p1Out.x * 100}%`}
          y1={`${p1Out.y * 100}%`}
          x2={`${p2Out.x * 100}%`}
          y2={`${p2Out.y * 100}%`}
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
