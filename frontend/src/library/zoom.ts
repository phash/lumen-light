/**
 * H2d: reine Hilfen fuer den 1:1-Zoom der Lupe.
 *
 * Quelle: JPEG/PNG-Originale kann der Browser direkt zeigen (signierte URL,
 * erst beim Zoomen geholt). RAW/TIFF nicht — dort zeigt der Zoom die
 * 1600-px-Vorschau in natuerlicher Groesse plus Hinweis.
 *
 * Der Ausschnitt wird als Ankerpunkt (0..1 relativ zum Bild) gefuehrt, damit
 * ein Quellwechsel (Vorschau -> Original) dieselbe Stelle zeigt.
 */
import type { Image } from "../api/client";

export interface ZoomAnchor {
  readonly x: number;
  readonly y: number;
}

export const CENTER_ANCHOR: ZoomAnchor = { x: 0.5, y: 0.5 };

/** Formate, die alle Browser als <img> zeigen. */
const BROWSER_ORIGINAL_TYPES = new Set(["image/jpeg", "image/png"]);

export function zoomSourceKind(image: Image): "original" | "preview" {
  return BROWSER_ORIGINAL_TYPES.has(image.contentType) ? "original" : "preview";
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Klickpunkt relativ zum (eingepassten) Bild, geklemmt auf 0..1. */
export function anchorFromPoint(
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  clientX: number,
  clientY: number,
): ZoomAnchor {
  if (rect.width <= 0 || rect.height <= 0) return CENTER_ANCHOR;
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

export interface ScrollBox {
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
}

/** Scroll-Position, die den Ankerpunkt mittig zeigt (im gueltigen Bereich). */
export function scrollForAnchor(anchor: ZoomAnchor, box: ScrollBox): { left: number; top: number } {
  const axis = (frac: number, total: number, view: number) =>
    Math.round(Math.min(Math.max(0, total - view), Math.max(0, frac * total - view / 2)));
  return {
    left: axis(anchor.x, box.scrollWidth, box.clientWidth),
    top: axis(anchor.y, box.scrollHeight, box.clientHeight),
  };
}

/** Umkehrung: welcher Bildpunkt steht gerade in der Mitte? */
export function anchorForScroll(
  scroll: { readonly left: number; readonly top: number },
  box: ScrollBox,
): ZoomAnchor {
  const axis = (pos: number, total: number, view: number) =>
    total > 0 ? clamp01((pos + view / 2) / total) : 0.5;
  return {
    x: axis(scroll.left, box.scrollWidth, box.clientWidth),
    y: axis(scroll.top, box.scrollHeight, box.clientHeight),
  };
}
