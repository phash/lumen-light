import { useRef } from "react";

import type { PointUv, RadialMask } from "./mask";
import { HANDLE_HIT_CLASS, nudgeDelta } from "./overlayKeys";
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

  // Tastatur: Zentrum wird im Output-System verschoben und zurueck
  // transformiert; Radien aendern sich direkt im Source-System.
  const onHandleKeyDown =
    (which: DragMode) => (event: React.KeyboardEvent<HTMLDivElement>) => {
      const d = nudgeDelta(event);
      if (!d) return;
      event.preventDefault();
      event.stopPropagation();
      if (which === "center") {
        const out = applyUv(inverseUvTransform, mask.center.u, mask.center.v);
        const src = applyUv(
          forwardUvTransform,
          clamp01(out.x + d.dx),
          clamp01(out.y + d.dy),
        );
        onChangeCenter({ u: clamp01(src.x), v: clamp01(src.y) });
      } else if (which === "rx") {
        // Rechts/Hoch vergroessert, Links/Runter verkleinert.
        const delta = d.dx !== 0 ? d.dx : -d.dy;
        onChangeRadii(Math.max(0.01, mask.rx + delta), mask.ry);
      } else {
        // Runter/Rechts vergroessert (Handle sitzt unten).
        const delta = d.dy !== 0 ? d.dy : d.dx;
        onChangeRadii(mask.rx, Math.max(0.01, mask.ry + delta));
      }
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
        role="button"
        tabIndex={0}
        aria-label="Radialmaske Zentrum verschieben (Pfeiltasten, Shift für größere Schritte)"
        onKeyDown={onHandleKeyDown("center")}
        onPointerDown={(e) => beginDrag("center", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`${HANDLE_HIT_CLASS} cursor-grab pointer-events-auto`}
        style={{ ...centerStyle, touchAction: "none" }}
      >
        <span className="block w-4 h-4 rounded-full bg-amber-200 border-2 border-stone-900 pointer-events-none" />
      </div>
      <div
        data-testid="radial-mask-handle-rx"
        role="button"
        tabIndex={0}
        aria-label="Radialmaske horizontaler Radius (Pfeiltasten, Shift für größere Schritte)"
        onKeyDown={onHandleKeyDown("rx")}
        onPointerDown={(e) => beginDrag("rx", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`${HANDLE_HIT_CLASS} cursor-ew-resize pointer-events-auto`}
        style={{ ...rxStyle, touchAction: "none" }}
      >
        <span className="block w-3 h-3 rounded-full bg-amber-200 border-2 border-stone-900 pointer-events-none" />
      </div>
      <div
        data-testid="radial-mask-handle-ry"
        role="button"
        tabIndex={0}
        aria-label="Radialmaske vertikaler Radius (Pfeiltasten, Shift für größere Schritte)"
        onKeyDown={onHandleKeyDown("ry")}
        onPointerDown={(e) => beginDrag("ry", e)}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        className={`${HANDLE_HIT_CLASS} cursor-ns-resize pointer-events-auto`}
        style={{ ...ryStyle, touchAction: "none" }}
      >
        <span className="block w-3 h-3 rounded-full bg-amber-200 border-2 border-stone-900 pointer-events-none" />
      </div>
    </div>
  );
}
