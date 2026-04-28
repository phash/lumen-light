import { useRef } from "react";

interface Props {
  readonly snapshotUrl: string;
  readonly splitX: number; // 0..1
  readonly onSplitChange: (x: number) => void;
}

/**
 * Vorher/Nachher-Compare-Overlay. Liegt UEBER dem Canvas (z-10) und
 * zeigt die linke Haelfte aus einem statischen Bypass-Snapshot;
 * die rechte Haelfte ist transparent — der Canvas darunter scheint durch.
 *
 * Drag der vertikalen Bar bewegt splitX. UV-Mapping ist linear vom
 * Container-BoundingClientRect — funktioniert auch bei skaliertem
 * Wrapper (Pan/Zoom) korrekt.
 */
export default function CompareSplitOverlay({
  snapshotUrl,
  splitX,
  onSplitChange,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const begin = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* jsdom */
    }
    draggingRef.current = true;
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSplitChange(x);
  };

  const end = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      }
    } catch {
      /* jsdom */
    }
    draggingRef.current = false;
  };

  const inset = `inset(0 ${(1 - splitX) * 100}% 0 0)`;
  const barLeft = `${splitX * 100}%`;

  return (
    <div
      ref={ref}
      data-testid="compare-overlay"
      className="absolute inset-0 pointer-events-none"
    >
      {/* Linke Haelfte: das gespeicherte „Original"-Bild ueber dem Canvas. */}
      <img
        src={snapshotUrl}
        alt="Original"
        draggable={false}
        className="absolute inset-0 w-full h-full select-none"
        style={{ clipPath: inset }}
      />

      {/* „Vorher" / „Nachher"-Labels */}
      <span
        className="absolute top-2 left-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] bg-stone-900/60 text-stone-200"
        style={{ display: splitX > 0.05 ? "inline-block" : "none" }}
      >
        Vorher
      </span>
      <span
        className="absolute top-2 right-2 px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] bg-stone-900/60 text-stone-200"
        style={{ display: splitX < 0.95 ? "inline-block" : "none" }}
      >
        Nachher
      </span>

      {/* Drag-Bar */}
      <div
        data-testid="compare-bar"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute top-0 bottom-0 w-1 -ml-0.5 bg-amber-200/60 cursor-ew-resize pointer-events-auto"
        style={{ left: barLeft, touchAction: "none" }}
        aria-label="Compare-Trennlinie verschieben"
      >
        {/* Griff */}
        <div className="absolute top-1/2 -translate-y-1/2 -ml-2 w-5 h-12 bg-amber-200 border-2 border-stone-900 flex items-center justify-center">
          <span className="text-[10px] text-stone-900 font-mono leading-none">‖</span>
        </div>
      </div>
    </div>
  );
}
