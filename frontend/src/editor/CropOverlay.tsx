import { useCallback, useRef } from "react";

import {
  type AspectRatio,
  type CropHandle,
  type CropRect,
  updateCropOnDrag,
} from "./transform";

interface Props {
  readonly cropRect: CropRect;
  readonly aspect: AspectRatio;
  readonly imageAspect: number;
  readonly onChange: (rect: CropRect) => void;
}

interface HandleSpec {
  readonly id: CropHandle;
  /** Position in 0..1 relativ zum Crop-Rect */
  readonly fx: number;
  readonly fy: number;
  readonly cursor: string;
}

const HANDLES: ReadonlyArray<HandleSpec> = [
  { id: "nw", fx: 0,   fy: 0,   cursor: "nwse-resize" },
  { id: "n",  fx: 0.5, fy: 0,   cursor: "ns-resize" },
  { id: "ne", fx: 1,   fy: 0,   cursor: "nesw-resize" },
  { id: "e",  fx: 1,   fy: 0.5, cursor: "ew-resize" },
  { id: "se", fx: 1,   fy: 1,   cursor: "nwse-resize" },
  { id: "s",  fx: 0.5, fy: 1,   cursor: "ns-resize" },
  { id: "sw", fx: 0,   fy: 1,   cursor: "nesw-resize" },
  { id: "w",  fx: 0,   fy: 0.5, cursor: "ew-resize" },
];

/**
 * Drag-fertiger Crop-Overlay. Liest den aktuellen Rect aus den Props,
 * meldet jede Aenderung via onChange. Aspect-Ratio-Snap wird in
 * updateCropOnDrag() (pure function) berechnet — diese Komponente
 * macht nur das DOM und Pointer-Tracking.
 */
export default function CropOverlay({
  cropRect,
  aspect,
  imageAspect,
  onChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    /** "move" verschiebt das ganze Rechteck, alle anderen Werte sind
     *  die Resize-Handles. */
    handle: CropHandle | "move";
    startX: number;
    startY: number;
    rectAtStart: CropRect;
    rectAtMove: CropRect;
  } | null>(null);

  const beginDrag = (
    handle: CropHandle | "move",
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.stopPropagation();
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* jsdom hat das nicht */
    }
    dragRef.current = {
      handle,
      startX: event.clientX,
      startY: event.clientY,
      rectAtStart: cropRect,
      rectAtMove: cropRect,
    };
  };

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;
      const rect = container.getBoundingClientRect();
      const dx = (event.clientX - drag.startX) / rect.width;
      const dy = (event.clientY - drag.startY) / rect.height;
      let next: CropRect;
      if (drag.handle === "move") {
        // Translation: Rechteck als Ganzes verschieben, an Bildraendern
        // klemmen statt Aspect-Verhaeltnis kaputt zu rechnen.
        const w = drag.rectAtStart.x1 - drag.rectAtStart.x0;
        const h = drag.rectAtStart.y1 - drag.rectAtStart.y0;
        const x0 = Math.max(0, Math.min(1 - w, drag.rectAtStart.x0 + dx));
        const y0 = Math.max(0, Math.min(1 - h, drag.rectAtStart.y0 + dy));
        next = { x0, y0, x1: x0 + w, y1: y0 + h };
      } else {
        next = updateCropOnDrag({
          current: drag.rectAtStart,
          handle: drag.handle,
          dx,
          dy,
          aspect,
          imageAspect,
        });
      }
      drag.rectAtMove = next;
      onChange(next);
    },
    [aspect, imageAspect, onChange],
  );

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    try {
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture?.(event.pointerId);
      }
    } catch {
      /* jsdom */
    }
    dragRef.current = null;
  };

  const left = `${cropRect.x0 * 100}%`;
  const top = `${cropRect.y0 * 100}%`;
  const width = `${(cropRect.x1 - cropRect.x0) * 100}%`;
  const height = `${(cropRect.y1 - cropRect.y0) * 100}%`;

  return (
    <div
      ref={containerRef}
      data-testid="crop-overlay"
      className="absolute inset-0 pointer-events-none"
    >
      {/* Halbtransparenter Maske um den Crop herum */}
      <div className="absolute inset-0 bg-black/50" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${cropRect.y0 * 100}%, ${cropRect.x0 * 100}% ${cropRect.y0 * 100}%, ${cropRect.x0 * 100}% ${cropRect.y1 * 100}%, ${cropRect.x1 * 100}% ${cropRect.y1 * 100}%, ${cropRect.x1 * 100}% ${cropRect.y0 * 100}%, 0 ${cropRect.y0 * 100}%)` }} />

      {/* Crop-Rect mit Drittel-Raster + Drag-Handles. Inneres Feld
          fungiert als Move-Drag-Surface (cursor=grab). */}
      <div
        className="absolute pointer-events-auto"
        style={{ left, top, width, height }}
      >
        <div
          data-testid="crop-move"
          onPointerDown={(e) => beginDrag("move", e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute inset-0 border border-amber-200/80"
          style={{ cursor: "grab", touchAction: "none" }}
        />
        {/* Drittel-Raster — pointer-events-none, damit Click in der
            Mitte zur Move-Surface darunter durchreicht. */}
        {[1, 2].map((i) => (
          <div
            key={`v${i}`}
            className="absolute top-0 bottom-0 border-l border-amber-200/30 pointer-events-none"
            style={{ left: `${(i / 3) * 100}%` }}
          />
        ))}
        {[1, 2].map((i) => (
          <div
            key={`h${i}`}
            className="absolute left-0 right-0 border-t border-amber-200/30 pointer-events-none"
            style={{ top: `${(i / 3) * 100}%` }}
          />
        ))}

        {HANDLES.map((spec) => (
          <div
            key={spec.id}
            data-testid={`crop-handle-${spec.id}`}
            onPointerDown={(e) => beginDrag(spec.id, e)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className="absolute w-3 h-3 -ml-1.5 -mt-1.5 bg-amber-200 border border-stone-900 rounded-sm"
            style={{
              left: `${spec.fx * 100}%`,
              top: `${spec.fy * 100}%`,
              cursor: spec.cursor,
              touchAction: "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}
