/**
 * H2b: Lighttable-Metadaten (Sterne, Farblabel, Markierung) — Konstanten,
 * Ansage-Texte und die reine Pfeiltasten-Navigation fuer das Raster.
 */
import type { ColorLabel, Image, ImageFlag, ImageMetaPatch } from "../api/client";

export const MAX_RATING = 5;

export interface ColorLabelDef {
  readonly key: ColorLabel;
  /** User-sichtbarer Name (mit Umlauten). */
  readonly name: string;
  /** Tailwind-Klassen fuer den Farbpunkt. */
  readonly swatch: string;
}

/** Reihenfolge = Lightroom-Tasten 6..9 (+ Lila), relevant fuer H2c. */
export const COLOR_LABELS: readonly ColorLabelDef[] = [
  { key: "red", name: "Rot", swatch: "bg-red-500" },
  { key: "yellow", name: "Gelb", swatch: "bg-yellow-400" },
  { key: "green", name: "Grün", swatch: "bg-emerald-500" },
  { key: "blue", name: "Blau", swatch: "bg-sky-500" },
  { key: "purple", name: "Lila", swatch: "bg-violet-500" },
];

export function colorLabelDef(key: ColorLabel): ColorLabelDef {
  const def = COLOR_LABELS.find((l) => l.key === key);
  if (!def) throw new Error(`Unbekanntes Farblabel: ${key}`);
  return def;
}

export const FLAG_NAMES: Readonly<Record<ImageFlag, string>> = {
  none: "Keine Markierung",
  pick: "Ausgewählt",
  reject: "Abgelehnt",
};

/** Normierte Metadaten (alte Fixtures/Antworten ohne Felder -> Defaults). */
export interface ImageMeta {
  rating: number;
  colorLabel: ColorLabel | null;
  flag: ImageFlag;
}

export function metaOf(image: Image): ImageMeta {
  return {
    rating: image.rating ?? 0,
    colorLabel: image.colorLabel ?? null,
    flag: image.flag ?? "none",
  };
}

export function ratingText(rating: number): string {
  if (rating <= 0) return "Keine Sterne";
  return rating === 1 ? "1 Stern" : `${rating} Sterne`;
}

/** Zugaenglicher Name einer Kachel/Zeile: „Datei, n Sterne, Label X, …". */
export function imageAriaLabel(image: Image): string {
  const meta = metaOf(image);
  const parts = [image.originalFilename, ratingText(meta.rating)];
  if (meta.colorLabel) parts.push(`Label ${colorLabelDef(meta.colorLabel).name}`);
  if (meta.flag !== "none") parts.push(FLAG_NAMES[meta.flag]);
  return parts.join(", ");
}

/** Text fuer die aria-live-Ansage nach einer Aenderung. */
export function announcePatch(patch: ImageMetaPatch, count = 1): string {
  const parts: string[] = [];
  if (patch.rating !== undefined) parts.push(ratingText(patch.rating));
  if (patch.colorLabel !== undefined) {
    parts.push(
      patch.colorLabel === null
        ? "Label entfernt"
        : `Label ${colorLabelDef(patch.colorLabel).name}`,
    );
  }
  if (patch.flag !== undefined) {
    parts.push(
      patch.flag === "pick"
        ? "Als ausgewählt markiert"
        : patch.flag === "reject"
          ? "Als abgelehnt markiert"
          : "Markierung entfernt",
    );
  }
  const text = parts.join(", ");
  return count > 1 ? `${count} Bilder: ${text}` : text;
}

export type GridKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export function isGridKey(key: string): key is GridKey {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "Home" ||
    key === "End"
  );
}

/** Ziel-Index fuer Pfeiltasten im Raster (an den Raendern geklemmt, kein
 *  Umlauf). `columns` = Kacheln pro Zeile (>= 1). */
export function nextGridIndex(
  current: number,
  key: GridKey,
  count: number,
  columns: number,
): number {
  if (count <= 0) return -1;
  const cols = Math.max(1, columns);
  const clamp = (i: number) => Math.min(count - 1, Math.max(0, i));
  switch (key) {
    case "ArrowLeft":
      return clamp(current - 1);
    case "ArrowRight":
      return clamp(current + 1);
    case "ArrowUp":
      return current - cols >= 0 ? current - cols : current;
    case "ArrowDown":
      return current + cols < count ? current + cols : current;
    case "Home":
      return 0;
    case "End":
      return count - 1;
  }
}
