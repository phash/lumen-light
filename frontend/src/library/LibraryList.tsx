/**
 * H2b/H2d: Listenansicht der Bibliothek.
 *
 * H2d: jede Zeile ist ein Fokus-Ziel (Roving-Tabindex, ein zusaetzlicher
 * Tab-Stopp fuer die ganze Liste). Pfeil hoch/runter, Pos1/Ende bewegen
 * zwischen den Zeilen, Leertaste schaltet die Auswahl, alle weiteren
 * Einzeltasten laufen ueber `onRowKey` — derselbe Dispatch wie im Raster
 * (`Library.tsx` -> `libraryKeys.ts`). Wie im Raster sieht der Handler nur
 * Tasten direkt auf der Zeile, nicht in deren Buttons. Die Bedienelemente
 * bleiben (anders als im Raster) normal per Tab erreichbar.
 */
import { useRef, useState, type KeyboardEvent } from "react";

import type { Image, ImageMetaPatch } from "../api/client";
import ImageActions from "./ImageActions";
import ImageThumb from "./ImageThumb";
import { ColorLabelPicker, FlagButtons, StarRating } from "./MetaControls";
import { imageAriaLabel, isGridKey, metaOf, nextGridIndex } from "./meta";

export interface LibraryListProps {
  readonly images: readonly Image[];
  readonly selected: ReadonlySet<string>;
  readonly confirmDeleteId: string | null;
  readonly onToggleSelect: (id: string) => void;
  readonly onMetaChange: (id: string, patch: ImageMetaPatch) => void;
  readonly onOpen: (id: string) => void;
  readonly onLoupe: (id: string) => void;
  readonly onAskDelete: (id: string) => void;
  readonly onConfirmDelete: (id: string) => void;
  readonly onCancelDelete: (id: string) => void;
  /** Einzeltasten (wie `LibraryGrid.onTileKey`): true = verarbeitet. */
  readonly onRowKey?: (image: Image, event: KeyboardEvent<HTMLElement>) => boolean;
}

function formatSize(bytes: number | null): string {
  if (bytes == null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[i]}`;
}

export default function LibraryList({
  images,
  selected,
  confirmDeleteId,
  onToggleSelect,
  onMetaChange,
  onOpen,
  onLoupe,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
  onRowKey,
}: LibraryListProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Verschwindet die aktive Zeile (Loeschen/Filter), uebernimmt die erste.
  const found = images.findIndex((i) => i.id === activeId);
  const activeIndex = found >= 0 ? found : 0;

  const focusRow = (index: number) => {
    const target = images[index];
    if (!target) return;
    setActiveId(target.id);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-testid="image-row-${target.id}"]`)
      ?.focus();
  };

  const onKeyDown = (image: Image, index: number, event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const { key } = event;
    // Liste = eine Spalte: nur hoch/runter/Pos1/Ende bewegen.
    if (isGridKey(key) && key !== "ArrowLeft" && key !== "ArrowRight") {
      event.preventDefault();
      focusRow(nextGridIndex(index, key, images.length, 1));
      return;
    }
    if (key === " ") {
      event.preventDefault();
      onToggleSelect(image.id);
      return;
    }
    if (onRowKey?.(image, event)) event.preventDefault();
  };

  return (
    <ul ref={listRef} className="mt-6 divide-y divide-stone-800" data-testid="image-list" aria-label="Bilder">
      {images.map((img, index) => {
        const meta = metaOf(img);
        const tid = `row-${img.id}`;
        const isSelected = selected.has(img.id);
        return (
          <li key={img.id}>
            <div
              role="group"
              data-testid={`image-row-${img.id}`}
              aria-label={imageAriaLabel(img)}
              tabIndex={index === activeIndex ? 0 : -1}
              onFocus={() => setActiveId(img.id)}
              onKeyDown={(e) => onKeyDown(img, index, e)}
              data-selected={isSelected || undefined}
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300 ${
                isSelected ? "bg-stone-900/60" : ""
              }`}
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  data-testid={`image-select-${img.id}`}
                  checked={isSelected}
                  onChange={() => onToggleSelect(img.id)}
                  aria-label={`„${img.originalFilename}“ auswählen`}
                  className="accent-amber-300"
                />
                <ImageThumb
                  key={img.thumbUrl ?? "none"}
                  id={img.id}
                  url={img.thumbUrl ?? null}
                  contentType={img.contentType}
                  dimmed={meta.flag === "reject"}
                />
                <div className="min-w-0">
                  <div className="truncate text-stone-200">{img.originalFilename}</div>
                  <div className="text-xs text-stone-400">
                    {formatSize(img.sizeBytes)} · {img.contentType}
                  </div>
                </div>
              </div>
              <div className="flex items-center">
                <StarRating
                  value={meta.rating}
                  testId={tid}
                  onChange={(p) => onMetaChange(img.id, p)}
                />
                <FlagButtons
                  value={meta.flag}
                  testId={tid}
                  onChange={(p) => onMetaChange(img.id, p)}
                />
                <ColorLabelPicker
                  value={meta.colorLabel}
                  testId={tid}
                  onChange={(p) => onMetaChange(img.id, p)}
                />
              </div>
              <ImageActions
                image={img}
                confirming={confirmDeleteId === img.id}
                onOpen={() => onOpen(img.id)}
                onLoupe={() => onLoupe(img.id)}
                onAskDelete={() => onAskDelete(img.id)}
                onConfirmDelete={() => onConfirmDelete(img.id)}
                onCancelDelete={() => onCancelDelete(img.id)}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
