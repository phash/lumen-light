/**
 * Tonkurven-Editor (E2). 200x200 SVG mit draggable Stuetzpunkten.
 *
 * - Click auf leeren Bereich: Punkt hinzufuegen (sortiert)
 * - Drag auf Punkt: Position aendern (Endpunkte: nur y)
 * - Doppelklick auf inneren Punkt: entfernen (mind. 2 bleiben)
 * - Tastatur: Punkte sind fokussierbare Slider. Pfeiltasten verschieben
 *   (Shift = 10er-Schritt), Entf/Backspace entfernt innere Punkte,
 *   Button "Punkt hinzufuegen" setzt einen Punkt in die groesste Luecke.
 *
 * Stateless: Werte/Callbacks vom Editor; LUT wird im Renderer aus dem
 * Curve-Objekt nachgerechnet.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  TONE_CURVE_MAX_POINTS,
  type ToneCurve,
  defaultToneCurve,
} from "./adjustments";
import { evaluateToneCurve } from "./toneCurve";

const SIZE = 200;
const POINT_RADIUS = 4.5;
const HIT_RADIUS = 9;
const SAMPLES = 50;
// Tastatur-Schrittweite in Kurven-Koordinaten (1/255 ~ ein Tonwert).
const KEY_STEP = 1 / 255;
const KEY_STEP_LARGE = 10 / 255;

function toTonal(v: number): number {
  return Math.round(v * 255);
}

/** Sucht die groesste x-Luecke zwischen zwei Punkten und liefert deren Mitte. */
export function largestGapMidpoint(curve: ToneCurve): number {
  const pts = curve.points;
  let bestX = 0.5;
  let bestGap = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) continue;
    const gap = b.x - a.x;
    if (gap > bestGap) {
      bestGap = gap;
      bestX = (a.x + b.x) / 2;
    }
  }
  return bestX;
}

interface Props {
  readonly curve: ToneCurve | null;
  readonly onSetPoint: (index: number, x: number, y: number) => void;
  readonly onAddPoint: (x: number, y: number) => number | null;
  readonly onRemovePoint: (index: number) => void;
  readonly onReset: () => void;
}

function clientToCurve(
  e: React.PointerEvent | React.MouseEvent,
  el: SVGSVGElement,
): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  const cx = (e.clientX - r.left) / r.width;
  const cy = 1 - (e.clientY - r.top) / r.height;
  return {
    x: Math.max(0, Math.min(1, cx)),
    y: Math.max(0, Math.min(1, cy)),
  };
}

export default function ToneCurvePanel({
  curve,
  onSetPoint,
  onAddPoint,
  onRemovePoint,
  onReset,
}: Props) {
  const effective: ToneCurve = curve ?? defaultToneCurve();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // Nach Hinzufuegen/Entfernen per Tastatur den Fokus auf diesen Index setzen.
  const pendingFocusRef = useRef<number | null>(null);
  const pointRefs = useRef<Array<SVGCircleElement | null>>([]);

  // Laeuft nach jedem Render: offenen Fokus-Request einloesen.
  useEffect(() => {
    const idx = pendingFocusRef.current;
    if (idx === null) return;
    pendingFocusRef.current = null;
    pointRefs.current[idx]?.focus();
  });

  const full = effective.points.length >= TONE_CURVE_MAX_POINTS;

  const addPointViaButton = () => {
    if (full) return;
    const x = largestGapMidpoint(effective);
    const y = evaluateToneCurve(effective, x);
    const idx = onAddPoint(x, y);
    if (idx !== null) pendingFocusRef.current = idx;
  };

  const onPointKeyDown =
    (idx: number, inner: boolean) => (e: React.KeyboardEvent<SVGCircleElement>) => {
      const p = effective.points[idx];
      if (!p) return;
      const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
      let nx = p.x;
      let ny = p.y;
      switch (e.key) {
        case "ArrowUp":
          ny = p.y + step;
          break;
        case "ArrowDown":
          ny = p.y - step;
          break;
        case "ArrowLeft":
          if (!inner) return;
          nx = p.x - step;
          break;
        case "ArrowRight":
          if (!inner) return;
          nx = p.x + step;
          break;
        case "Delete":
        case "Backspace":
          e.preventDefault();
          e.stopPropagation();
          if (inner) {
            onRemovePoint(idx);
            pendingFocusRef.current = Math.max(0, idx - 1);
          }
          return;
        default:
          return;
      }
      e.preventDefault();
      // Keine globalen Editor-Shortcuts (z.B. Pfeil-Nudges) zusaetzlich ausloesen.
      e.stopPropagation();
      onSetPoint(idx, Math.max(0, Math.min(1, nx)), Math.max(0, Math.min(1, ny)));
    };

  // Polyline der Kurve aus 50 Samples — kein LUT-Roundtrip im UI.
  const samples: Array<[number, number]> = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = i / SAMPLES;
    const y = evaluateToneCurve(effective, x);
    samples.push([x * SIZE, (1 - y) * SIZE]);
  }
  const linePath = samples
    .map(([x, y], i) => (i === 0 ? `M${x.toFixed(2)},${y.toFixed(2)}` : `L${x.toFixed(2)},${y.toFixed(2)}`))
    .join(" ");

  const onPointerDown = (idx: number) => (e: React.PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragIndex(idx);
  };

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (dragIndex === null || !svgRef.current) return;
      const { x, y } = clientToCurve(e, svgRef.current);
      onSetPoint(dragIndex, x, y);
    },
    [dragIndex, onSetPoint],
  );

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (dragIndex !== null) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    setDragIndex(null);
  };

  const onSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (effective.points.length >= TONE_CURVE_MAX_POINTS) return;
    if (!svgRef.current) return;
    // Nur reagieren, wenn nicht auf einem Punkt geklickt wurde — die
    // Punkt-Handler stoppen Propagation.
    const { x, y } = clientToCurve(e, svgRef.current);
    onAddPoint(x, y);
  };

  return (
    <div data-testid="tone-curve-panel" className="space-y-2">
      <p className="text-[11px] text-stone-400 leading-tight">
        Klick auf die Kurve fügt einen Punkt hinzu, Doppelklick auf
        einen Punkt entfernt ihn. Endpunkte (links/rechts) lassen sich
        nur vertikal bewegen. Per Tastatur: Pfeiltasten verschieben
        (Shift = größerer Schritt), Entf entfernt.
      </p>
      <svg
        ref={svgRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="block bg-stone-900 border border-stone-800 rounded select-none touch-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onSvgClick}
        data-testid="tone-curve-svg"
      >
        {[1, 2, 3].map((i) => (
          <g key={`grid-${i}`} stroke="#3f3f46" strokeWidth={0.5}>
            <line x1={(i * SIZE) / 4} y1={0} x2={(i * SIZE) / 4} y2={SIZE} />
            <line x1={0} y1={(i * SIZE) / 4} x2={SIZE} y2={(i * SIZE) / 4} />
          </g>
        ))}
        <line
          x1={0}
          y1={SIZE}
          x2={SIZE}
          y2={0}
          stroke="#52525b"
          strokeWidth={0.5}
          strokeDasharray="3 3"
        />
        <path
          d={linePath}
          stroke="#fcd34d"
          strokeWidth={1.5}
          fill="none"
        />
        {effective.points.map((p, idx) => {
          const cx = p.x * SIZE;
          const cy = (1 - p.y) * SIZE;
          const last = idx === effective.points.length - 1;
          const inner = idx > 0 && !last;
          return (
            <g key={idx}>
              <circle
                ref={(el) => {
                  pointRefs.current[idx] = el;
                }}
                cx={cx}
                cy={cy}
                r={HIT_RADIUS}
                fill="transparent"
                role="slider"
                tabIndex={0}
                aria-label={
                  idx === 0
                    ? "Kurvenpunkt Schwarzpunkt"
                    : last
                      ? "Kurvenpunkt Weißpunkt"
                      : `Kurvenpunkt ${idx}`
                }
                aria-valuemin={0}
                aria-valuemax={255}
                aria-valuenow={toTonal(p.y)}
                aria-valuetext={`Eingang ${toTonal(p.x)}, Ausgang ${toTonal(p.y)}`}
                aria-orientation="vertical"
                className="outline-none focus-visible:stroke-amber-300 focus-visible:[stroke-width:2]"
                onKeyDown={onPointKeyDown(idx, inner)}
                onPointerDown={onPointerDown(idx)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (inner) onRemovePoint(idx);
                }}
                style={{ cursor: inner ? "pointer" : "ns-resize" }}
                data-testid={`tone-curve-point-${idx}`}
              />
              <circle
                cx={cx}
                cy={cy}
                r={POINT_RADIUS}
                fill={dragIndex === idx ? "#fde68a" : "#fcd34d"}
                stroke="#451a03"
                strokeWidth={1}
                pointerEvents="none"
              />
            </g>
          );
        })}
      </svg>

      <div className="flex items-center justify-between gap-2 text-[11px] text-stone-400">
        <span>{effective.points.length} Punkte (max {TONE_CURVE_MAX_POINTS})</span>
        <button
          type="button"
          onClick={addPointViaButton}
          disabled={full}
          data-testid="tone-curve-add-point"
          className="px-2 py-1 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Punkt hinzufügen
        </button>
        <button
          type="button"
          onClick={onReset}
          data-testid="tone-curve-reset"
          className="px-2 py-1 uppercase tracking-[0.2em] hover:text-amber-200 border border-stone-800 hover:border-amber-300/40 transition-colors"
        >
          Zurücksetzen
        </button>
      </div>
    </div>
  );
}
