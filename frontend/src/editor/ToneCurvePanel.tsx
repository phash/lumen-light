/**
 * Tonkurven-Editor (E2). 200x200 SVG mit draggable Stuetzpunkten.
 *
 * - Click auf leeren Bereich: Punkt hinzufuegen (sortiert)
 * - Drag auf Punkt: Position aendern (Endpunkte: nur y)
 * - Doppelklick auf inneren Punkt: entfernen (mind. 2 bleiben)
 *
 * Stateless: Werte/Callbacks vom Editor; LUT wird im Renderer aus dem
 * Curve-Objekt nachgerechnet.
 */
import { useCallback, useRef, useState } from "react";

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
      <p className="text-[10px] text-stone-500 leading-tight">
        Klick auf die Kurve fuegt einen Punkt hinzu, Doppelklick auf
        einen Punkt entfernt ihn. Endpunkte (links/rechts) lassen sich
        nur vertikal bewegen.
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
                cx={cx}
                cy={cy}
                r={HIT_RADIUS}
                fill="transparent"
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

      <div className="flex items-center justify-between text-[10px] text-stone-500">
        <span>{effective.points.length} Punkte (max {TONE_CURVE_MAX_POINTS})</span>
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
