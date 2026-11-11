/**
 * H2b: Raster-Ansicht der Bibliothek (Lighttable).
 *
 * Tastatur: das Raster ist EIN Tab-Stopp (Roving-Tabindex). Pfeiltasten,
 * Pos1/Ende bewegen den Fokus zwischen den Kacheln; Tab fuehrt von der
 * aktiven Kachel in deren Bedienelemente und dann aus dem Raster heraus.
 * Die Bedienelemente nicht-aktiver Kacheln sind per Maus/Touch erreichbar,
 * aber nicht in der Tab-Reihenfolge (sonst ~10 Tab-Stopps pro Bild).
 *
 * H2c haengt Einzeltasten (0-5, 6-9, P/X/U, Enter, E, C) an
 * `onTileKey` an — der Handler sieht nur Tasten, die direkt auf der
 * Kachel (nicht in einem Button darin) gedrueckt wurden.
 */
import { useRef, useState, type KeyboardEvent } from "react";

import type { Image, ImageMetaPatch } from "../api/client";
import ImageActions from "./ImageActions";
import ImageThumb from "./ImageThumb";
import { ColorLabelPicker, FlagButtons, StarRating } from "./MetaControls";
import { FLAG_NAMES, colorLabelDef, isGridKey, metaOf, nextGridIndex, ratingText } from "./meta";

export interface LibraryGridProps {
  readonly images: readonly Image[];
  readonly selected: ReadonlySet<string>;
  readonly confirmDeleteId: string | null;
  readonly onToggleSelect: (id: string) => void;
  readonly onMetaChange: (id: string, patch: ImageMetaPatch) => void;
  readonly onOpen: (id: string) => void;
  readonly onAskDelete: (id: string) => void;
  readonly onConfirmDelete: (id: string) => void;
  readonly onCancelDelete: (id: string) => void;
  /** Erweiterungspunkt fuer H2c: true = Taste verarbeitet. */
  readonly onTileKey?: (image: Image, event: KeyboardEvent<HTMLElement>) => boolean;
}

/** Kacheln pro Zeile aus dem Layout ablesen (gleiche offsetTop wie die
 *  erste Kachel). Ohne Layout (jsdom) -> 1. */
function columnsOf(list: HTMLElement | null): number {
  if (!list) return 1;
  const items = Array.from(list.children) as HTMLElement[];
  const first = items[0];
  if (!first || first.offsetHeight === 0) return 1;
  let cols = 0;
  for (const item of items) {
    if (item.offsetTop !== first.offsetTop) break;
    cols += 1;
  }
  return Math.max(1, cols);
}

function tileLabel(image: Image): string {
  const meta = metaOf(image);
  const parts = [image.originalFilename, ratingText(meta.rating)];
  if (meta.colorLabel) parts.push(`Label ${colorLabelDef(meta.colorLabel).name}`);
  if (meta.flag !== "none") parts.push(FLAG_NAMES[meta.flag]);
  return parts.join(", ");
}

export default function LibraryGrid({
  images,
  selected,
  confirmDeleteId,
  onToggleSelect,
  onMetaChange,
  onOpen,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
  onTileKey,
}: LibraryGridProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Verschwindet die aktive Kachel (Loeschen/Filter), uebernimmt die erste.
  const found = images.findIndex((i) => i.id === activeId);
  const activeIndex = found >= 0 ? found : 0;

  const focusTile = (index: number) => {
    const target = images[index];
    if (!target) return;
    setActiveId(target.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-testid="image-tile-${target.id}"]`)
      ?.focus();
  };

  const onKeyDown = (image: Image, index: number, event: KeyboardEvent<HTMLElement>) => {
    // Nur Tasten direkt auf der Kachel; Buttons/Checkbox darin behalten
    // ihr natives Verhalten.
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isGridKey(event.key)) {
      event.preventDefault();
      focusTile(nextGridIndex(index, event.key, images.length, columnsOf(listRef.current)));
      return;
    }
    if (event.key === " ") {
      // Leertaste = Auswahl umschalten (wie die Checkbox).
      event.preventDefault();
      onToggleSelect(image.id);
      return;
    }
    if (onTileKey?.(image, event)) event.preventDefault();
  };

  return (
    <ul
      ref={listRef}
      data-testid="image-grid"
      aria-label="Bilder"
      className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5"
    >
      {images.map((img, index) => {
        const meta = metaOf(img);
        const active = index === activeIndex;
        const isSelected = selected.has(img.id);
        const tid = `tile-${img.id}`;
        return (
          <li key={img.id} className="min-w-0">
            <div
              role="group"
              data-testid={`image-tile-${img.id}`}
              aria-label={tileLabel(img)}
              tabIndex={active ? 0 : -1}
              onFocus={() => setActiveId(img.id)}
              onKeyDown={(e) => onKeyDown(img, index, e)}
              data-selected={isSelected || undefined}
              className={`group flex h-full flex-col border bg-stone-900/60 outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                isSelected ? "border-amber-300/70" : "border-stone-800 hover:border-stone-600"
              }`}
            >
              {/* Passepartout: dunkle Flaeche, Bild unbeschnitten mittig. */}
              <div className="relative aspect-[4/3] bg-stone-950 p-2">
                <ImageThumb
                  key={img.thumbUrl ?? "none"}
                  id={img.id}
                  url={img.thumbUrl ?? null}
                  contentType={img.contentType}
                  variant="tile"
                  dimmed={meta.flag === "reject"}
                />
                <label className="absolute left-0 top-0 flex h-9 w-9 cursor-pointer items-center justify-center">
                  <input
                    type="checkbox"
                    data-testid={`image-select-${img.id}`}
                    tabIndex={active ? 0 : -1}
                    checked={isSelected}
                    onChange={() => onToggleSelect(img.id)}
                    aria-label={`„${img.originalFilename}“ auswählen`}
                    className={`h-4 w-4 accent-amber-300 transition-opacity ${
                      isSelected ? "" : "opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                    }`}
                  />
                </label>
                {meta.colorLabel && (
                  <span
                    aria-hidden="true"
                    data-testid={`${tid}-label-bar`}
                    className={`absolute inset-x-0 bottom-0 h-1 ${colorLabelDef(meta.colorLabel).swatch}`}
                  />
                )}
                {meta.flag === "pick" && (
                  <span
                    aria-hidden="true"
                    className="absolute right-1.5 top-1.5 bg-stone-950/80 px-1 text-[10px] text-amber-300"
                  >
                    ⚑
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-1 px-2 pb-2 pt-1.5">
                <div className="truncate text-sm text-stone-200" title={img.originalFilename}>
                  {img.originalFilename}
                </div>
                <div className="-ml-1 flex flex-wrap items-center justify-between gap-y-0.5">
                  <StarRating
                    value={meta.rating}
                    testId={tid}
                    tabbable={active}
                    onChange={(p) => onMetaChange(img.id, p)}
                  />
                  <div className="flex items-center">
                    <FlagButtons
                      value={meta.flag}
                      testId={tid}
                      tabbable={active}
                      onChange={(p) => onMetaChange(img.id, p)}
                    />
                    <ColorLabelPicker
                      value={meta.colorLabel}
                      testId={tid}
                      tabbable={active}
                      onChange={(p) => onMetaChange(img.id, p)}
                    />
                  </div>
                </div>
                <div className="mt-auto pt-1">
                  <ImageActions
                    image={img}
                    compact
                    tabbable={active}
                    confirming={confirmDeleteId === img.id}
                    onOpen={() => onOpen(img.id)}
                    onAskDelete={() => onAskDelete(img.id)}
                    onConfirmDelete={() => onConfirmDelete(img.id)}
                    onCancelDelete={() => onCancelDelete(img.id)}
                  />
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
