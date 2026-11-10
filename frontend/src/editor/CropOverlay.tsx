import { useCallback, useRef } from "react";

import {
  type AspectRatio,
  type CropHandle,
  type CropRect,
  updateCropOnDrag,
} from "./transform";
import { HANDLE_HIT_CLASS, nudgeDelta } from "./overlayKeys";

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
  readonly label: string;
}

const HANDLES: ReadonlyArray<HandleSpec> = [
  { id: "nw", fx: 0,   fy: 0,   cursor: "nwse-resize", label: "Zuschnitt-Ecke oben links" },
  { id: "n",  fx: 0.5, fy: 0,   cursor: "ns-resize", label: "Zuschnitt-Kante oben" },
  { id: "ne", fx: 1,   fy: 0,   cursor: "nesw-resize", label: "Zuschnitt-Ecke oben rechts" },
  { id: "e",  fx: 1,   fy: 0.5, cursor: "ew-resize", label: "Zuschnitt-Kante rechts" },
  { id: "se", fx: 1,   fy: 1,   cursor: "nwse-resize", label: "Zuschnitt-Ecke unten rechts" },
  { id: "s",  fx: 0.5, fy: 1,   cursor: "ns-resize", label: "Zuschnitt-Kante unten" },
  { id: "sw", fx: 0,   fy: 1,   cursor: "nesw-resize", label: "Zuschnitt-Ecke unten links" },
  { id: "w",  fx: 0,   fy: 0.5, cursor: "ew-resize", label: "Zuschnitt-Kante links" },
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

  // Tastatur: Pfeiltasten wirken wie ein Drag um einen festen Schritt.
  const onHandleKeyDown =
    (handle: CropHandle | "move") => (event: React.KeyboardEvent<HTMLDivElement>) => {
      const d = nudgeDelta(event);
      if (!d) return;
      event.preventDefault();
      event.stopPropagation();
      let next: CropRect;
      if (handle === "move") {
        const w = cropRect.x1 - cropRect.x0;
        const h = cropRect.y1 - cropRect.y0;
        const x0 = Math.max(0, Math.min(1 - w, cropRect.x0 + d.dx));
        const y0 = Math.max(0, Math.min(1 - h, cropRect.y0 + d.dy));
        next = { x0, y0, x1: x0 + w, y1: y0 + h };
      } else {
        next = updateCropOnDrag({
          current: cropRect,
          handle,
          dx: d.dx,
          dy: d.dy,
          aspect,
          imageAspect,
        });
      }
      onChange(next);
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
          role="button"
          tabIndex={0}
          aria-label="Zuschnitt verschieben (Pfeiltasten, Shift für größere Schritte)"
          onKeyDown={onHandleKeyDown("move")}
          onPointerDown={(e) => beginDrag("move", e)}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="absolute inset-0 border border-amber-200/80 outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
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
            role="button"
            tabIndex={0}
            aria-label={`${spec.label} verschieben (Pfeiltasten)`}
            onKeyDown={onHandleKeyDown(spec.id)}
            onPointerDown={(e) => beginDrag(spec.id, e)}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            className={HANDLE_HIT_CLASS}
            style={{
              left: `${spec.fx * 100}%`,
              top: `${spec.fy * 100}%`,
              cursor: spec.cursor,
              touchAction: "none",
            }}
          >
            {/* Sichtbarer Punkt bleibt klein, Trefferflaeche ist 24px. */}
            <span className="block w-3 h-3 bg-amber-200 border border-stone-900 rounded-sm pointer-events-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
