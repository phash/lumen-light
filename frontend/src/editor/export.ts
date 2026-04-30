/**
 * Export-Helfer fuer den Lumen-Editor.
 *
 * Akzeptiert ein gerendertes <canvas> (das WebGL-Renderer hat es bereits
 * mit allen Adjustments gerendert), kann es optional skalieren und als
 * Blob im gewuenschten Format zurueckgeben.
 *
 * In Iteration 10 ist die Export-Aufloesung auf die Live-Preview-Aufloesung
 * limitiert (max 1600px Breite, siehe loadImageFromFile). Voll-Aufloesungs-
 * Export auf der Original-Breite ist eine eigene Iteration und braucht
 * einen Re-Render in einen Off-Screen-FBO mit Original-Texture.
 */

export type ExportFormat = "jpeg" | "png" | "webp";

export interface ExportOptions {
  readonly format: ExportFormat;
  /** 0..1 fuer JPEG/WebP, fuer PNG ignoriert. Default 0.92. */
  readonly quality?: number;
  /** Ziel-Breite. Wenn nicht gesetzt, wird die Canvas-Breite verwendet.
   *  Hoehe wird proportional skaliert. */
  readonly width?: number;
}

const MIME: Record<ExportFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const EXTENSION: Record<ExportFormat, string> = {
  jpeg: "jpg",
  png: "png",
  webp: "webp",
};

export function suggestFilename(originalName: string, format: ExportFormat): string {
  const dot = originalName.lastIndexOf(".");
  const stemRaw = dot > 0 ? originalName.slice(0, dot) : originalName;
  const stem = stemRaw && stemRaw !== "." ? stemRaw : "lumen-export";
  return `${stem}.${EXTENSION[format]}`;
}

export async function exportCanvas(
  canvas: HTMLCanvasElement,
  options: ExportOptions,
): Promise<Blob> {
  const targetWidth = options.width ?? canvas.width;
  if (targetWidth <= 0) {
    throw new Error("Ziel-Breite muss > 0 sein");
  }

  let source: HTMLCanvasElement = canvas;
  if (options.width !== undefined && options.width !== canvas.width) {
    const scale = options.width / canvas.width;
    const off = document.createElement("canvas");
    off.width = options.width;
    off.height = Math.max(1, Math.round(canvas.height * scale));
    const ctx = off.getContext("2d");
    if (!ctx) {
      throw new Error("Kein 2D-Context für Skalierung verfügbar");
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, off.width, off.height);
    source = off;
  }

  const quality = options.quality ?? 0.92;
  return new Promise((resolve, reject) => {
    source.toBlob(
      (blob) => {
        if (!blob) reject(new Error("toBlob lieferte null — Export fehlgeschlagen"));
        else resolve(blob);
      },
      MIME[options.format],
      quality,
    );
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // URL erst beim naechsten Tick freigeben — Safari triggert Download asynchron.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
