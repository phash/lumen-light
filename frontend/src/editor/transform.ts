/**
 * UV-Transform-Mathematik fuer Crop und Begradigung.
 *
 * Output-Pixel (UV in 0..1) wird in Source-UV transformiert:
 *   src_uv = T_cropCenter · S_cropSize · R(-angle) · (uv - 0.5)
 * Pure functions — Tests koennen ohne WebGL gegen Referenzwerte pruefen.
 */

export interface CropRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export const defaultCropRect = (): CropRect => ({ x0: 0, y0: 0, x1: 1, y1: 1 });

export function isIdentityCrop(rect: CropRect): boolean {
  return (
    Math.abs(rect.x0) < 1e-6 &&
    Math.abs(rect.y0) < 1e-6 &&
    Math.abs(rect.x1 - 1) < 1e-6 &&
    Math.abs(rect.y1 - 1) < 1e-6
  );
}

export function clampCropRect(rect: CropRect, minSize = 0.05): CropRect {
  const x0 = Math.max(0, Math.min(rect.x0, 1 - minSize));
  const y0 = Math.max(0, Math.min(rect.y0, 1 - minSize));
  const x1 = Math.max(x0 + minSize, Math.min(rect.x1, 1));
  const y1 = Math.max(y0 + minSize, Math.min(rect.y1, 1));
  return { x0, y0, x1, y1 };
}

/**
 * 3×3 affine UV-Transformation (column-major fuer GLSL `mat3`).
 *
 * Layout:
 *   [m0, m1, m2] = Spalte 0 = X-Basisvektor
 *   [m3, m4, m5] = Spalte 1 = Y-Basisvektor
 *   [m6, m7, m8] = Spalte 2 = Translation + 1
 *
 * angle in Radiant. Positiver Winkel = Bild dreht im Uhrzeigersinn (UV
 * dreht entsprechend gegen den Uhrzeigersinn).
 */
export function uvTransformMatrix(
  crop: CropRect,
  angle: number,
): Float32Array {
  const cw = crop.x1 - crop.x0;
  const ch = crop.y1 - crop.y0;
  const cx = (crop.x0 + crop.x1) / 2;
  const cy = (crop.y0 + crop.y1) / 2;
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);

  // Lineare Spalten:
  //   col0 = (c*cw,  s*cw)
  //   col1 = (-s*ch, c*ch)
  // Translation (Spalte 2):
  //   t = (cx, cy) - 0.5 * (col0 + col1)
  const tx = cx - 0.5 * (c * cw - s * ch);
  const ty = cy - 0.5 * (s * cw + c * ch);

  return new Float32Array([
    c * cw, s * cw, 0,
    -s * ch, c * ch, 0,
    tx, ty, 1,
  ]);
}

/**
 * Wendet eine Matrix (column-major) auf einen UV-Vektor an. Praktisch
 * fuer Tests, um die Transform gegen Referenzpunkte zu pruefen.
 */
export function applyUv(
  m: Float32Array,
  uvX: number,
  uvY: number,
): { x: number; y: number } {
  const x = m[0]! * uvX + m[3]! * uvY + m[6]!;
  const y = m[1]! * uvX + m[4]! * uvY + m[7]!;
  return { x, y };
}

export type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type AspectRatio = "free" | "1:1" | "3:2" | "4:3" | "16:9";

export function aspectValue(ratio: AspectRatio): number | null {
  switch (ratio) {
    case "1:1": return 1;
    case "3:2": return 3 / 2;
    case "4:3": return 4 / 3;
    case "16:9": return 16 / 9;
    default: return null;
  }
}

interface DragArgs {
  readonly current: CropRect;
  readonly handle: CropHandle;
  readonly dx: number;       // delta in normalisierten Source-Koordinaten
  readonly dy: number;
  readonly aspect: AspectRatio;
  readonly imageAspect: number;  // sourceWidth / sourceHeight, fuer Verhaeltnis-Erhaltung
}

/**
 * Berechnet den neuen Crop-Rect nach einem Drag eines Handles.
 * Wenn aspect != 'free', wird das Verhaeltnis durch Mitziehen der
 * gegenueberliegenden Achse erhalten — das ist das Lightroom-Verhalten.
 *
 * imageAspect (Source) wird benoetigt, damit z. B. '1:1' auf einem 3:2-
 * Bild ein quadratisches Crop ergibt: dafuer muss in Source-UV-Koordinaten
 * crop_height_uv = crop_width_uv * imageAspect sein.
 */
export function updateCropOnDrag({
  current, handle, dx, dy, aspect, imageAspect,
}: DragArgs): CropRect {
  let { x0, y0, x1, y1 } = current;

  if (handle.includes("w")) x0 = current.x0 + dx;
  if (handle.includes("e")) x1 = current.x1 + dx;
  if (handle.includes("n")) y0 = current.y0 + dy;
  if (handle.includes("s")) y1 = current.y1 + dy;

  const ratio = aspectValue(aspect);
  if (ratio !== null) {
    // crop_w = (x1-x0), crop_h_in_pixels = (y1-y0) * imageAspect⁻¹ (weil
    // Source haelt's anders).  In normalisierten UVs: pixel-Aspect-Ratio
    // ist (cropW * imageWidth) / (cropH * imageHeight) = (cropW / cropH) *
    // imageAspect = ratio  →  cropH = cropW * imageAspect / ratio.
    const cropW = x1 - x0;
    const targetCropH = (cropW * imageAspect) / ratio;
    const isHorizontalHandle = handle === "e" || handle === "w";
    const isVerticalHandle = handle === "n" || handle === "s";

    if (isHorizontalHandle) {
      // X wurde geaendert, Y proportional anpassen — symmetrisch um die Mitte
      const cy = (current.y0 + current.y1) / 2;
      y0 = cy - targetCropH / 2;
      y1 = cy + targetCropH / 2;
    } else if (isVerticalHandle) {
      const cropH = y1 - y0;
      const targetCropW = (cropH * ratio) / imageAspect;
      const cx = (current.x0 + current.x1) / 2;
      x0 = cx - targetCropW / 2;
      x1 = cx + targetCropW / 2;
    } else {
      // Corner: X als Master, Y proportional, mit dem Anker auf der
      // gegenueberliegenden Ecke.
      const anchorY = handle.startsWith("n") ? y1 : y0;
      if (handle.startsWith("n")) {
        y0 = anchorY - targetCropH;
      } else {
        y1 = anchorY + targetCropH;
      }
    }
  }

  return clampCropRect({ x0, y0, x1, y1 });
}
