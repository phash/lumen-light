/**
 * H2d: 1:1-Ansicht der Lupe (Lightroom: Z bzw. Klick aufs Bild).
 *
 * Das Bild steht in natuerlicher Groesse in einem Ausschnitt ohne
 * Scrollbalken; Ziehen verschiebt ihn, ein Klick ohne Ziehen verlaesst den
 * Zoom (`onExit`). JPEG/PNG: erst die Vorschau (sofort da), das Original
 * laedt im Hintergrund (verstecktes <img>) und ersetzt sie dann an derselben
 * Stelle. RAW/TIFF: die Vorschau in 1:1 plus Hinweis, das Original sieht nur
 * der Editor. Der Aufrufer setzt `key` auf die Bild-ID.
 */
import { useEffect, useRef, useState, type PointerEvent } from "react";

import type { Image } from "../api/client";
import { previewSrc } from "./PreviewImage";
import {
  anchorForScroll,
  scrollForAnchor,
  zoomSourceKind,
  type ZoomAnchor,
} from "./zoom";

/** Ab so vielen px Weg gilt ein Zeiger-Druck als Ziehen, nicht als Klick. */
const DRAG_THRESHOLD_PX = 4;

export interface LoupeZoomProps {
  readonly image: Image;
  readonly anchor: ZoomAnchor;
  /** Signierte URL des Originals holen (GET /images/{id}/url). */
  readonly loadOriginalUrl: (id: string) => Promise<string>;
  /** Bereits geholte Original-URLs (lebt in der Lupe, ueberlebt Zoom aus/an). */
  readonly originalUrls: Map<string, string>;
  readonly onExit: () => void;
}

interface OriginalState {
  readonly url: string | null;
  readonly ready: boolean;
  readonly failed: boolean;
}

interface Drag {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly left: number;
  readonly top: number;
  moved: boolean;
}

function previewHint(image: Image): string {
  const size = image.previewUrl ? "1600 px" : "400 px";
  const raw = image.contentType !== "image/tiff";
  return `1:1 der Vorschau (${size}) – ${raw ? "RAW-Original" : "Original"} nur im Editor`;
}

export default function LoupeZoom({
  image,
  anchor,
  loadOriginalUrl,
  originalUrls,
  onExit,
}: LoupeZoomProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<ZoomAnchor>(anchor);
  const dragRef = useRef<Drag | null>(null);
  const wantsOriginal = zoomSourceKind(image) === "original";
  const [original, setOriginal] = useState<OriginalState>(() => ({
    url: wantsOriginal ? (originalUrls.get(image.id) ?? null) : null,
    ready: false,
    failed: false,
  }));

  const needsUrl = wantsOriginal && original.url === null && !original.failed;
  useEffect(() => {
    if (!needsUrl) return;
    let cancelled = false;
    loadOriginalUrl(image.id).then(
      (url) => {
        originalUrls.set(image.id, url);
        if (!cancelled) setOriginal((o) => ({ ...o, url }));
      },
      () => {
        if (!cancelled) setOriginal((o) => ({ ...o, failed: true }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [needsUrl, image.id, loadOriginalUrl, originalUrls]);

  const preview = previewSrc(image);
  const showOriginal = original.ready && original.url !== null;
  const src = showOriginal ? original.url : preview;
  const loading = wantsOriginal && !original.failed && !original.ready;
  const hint = !wantsOriginal
    ? previewHint(image)
    : original.failed
      ? "Original nicht verfügbar – 1:1 der Vorschau"
      : null;

  /** Ankerpunkt mittig zeigen (nach jedem Laden einer Quelle). */
  const recenter = () => {
    const vp = viewportRef.current;
    if (!vp) return;
    const pos = scrollForAnchor(anchorRef.current, vp);
    vp.scrollLeft = pos.left;
    vp.scrollTop = pos.top;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const vp = event.currentTarget;
    // Kein natives Bild-Ziehen (Geisterbild) und keine Textauswahl.
    event.preventDefault();
    if (typeof vp.setPointerCapture === "function") vp.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: vp.scrollLeft,
      top: vp.scrollTop,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD_PX) drag.moved = true;
    if (!drag.moved) return;
    const vp = event.currentTarget;
    vp.scrollLeft = drag.left - dx;
    vp.scrollTop = drag.top - dy;
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    const vp = event.currentTarget;
    if (!drag.moved) {
      onExit();
      return;
    }
    anchorRef.current = anchorForScroll({ left: vp.scrollLeft, top: vp.scrollTop }, vp);
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={viewportRef}
        data-testid="loupe-zoom-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        // touch-none: Ziehen verschiebt den Ausschnitt statt die Seite.
        className="h-full w-full cursor-grab touch-none select-none overflow-hidden active:cursor-grabbing"
      >
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center">
          {src && (
            <img
              data-testid="loupe-zoom-image"
              src={src}
              alt={image.originalFilename}
              draggable={false}
              onLoad={recenter}
              className="block max-w-none"
            />
          )}
        </div>
      </div>
      {/* Original im Hintergrund laden; erst wenn es da ist, tauscht es die
          Vorschau aus (kein leerer Bildschirm bei grossen Dateien). */}
      {original.url !== null && !original.ready && !original.failed && (
        <img
          data-testid="loupe-zoom-original-loader"
          src={original.url}
          alt=""
          hidden
          onLoad={() => setOriginal((o) => ({ ...o, ready: true }))}
          onError={() => setOriginal((o) => ({ ...o, failed: true }))}
        />
      )}
      {(loading || hint) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
          {loading ? (
            <p
              data-testid="loupe-zoom-loading"
              role="status"
              className="bg-stone-950/85 px-3 py-1 text-xs text-amber-200/90"
            >
              Original wird geladen …
            </p>
          ) : (
            <p
              data-testid="loupe-zoom-hint"
              className="bg-stone-950/85 px-3 py-1 text-xs text-stone-300"
            >
              {hint}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
