/**
 * H2b: Filter-/Sortierleiste der Bibliothek plus Umschalter Raster/Liste.
 * Filter laufen serverseitig (GET /images); die Leiste haelt nur den Zustand.
 */
import { useId } from "react";

import type { ColorLabel, ImageFlag, ImageListQuery, ImageSort } from "../api/client";
import { COLOR_LABELS, MAX_RATING } from "./meta";
import type { LibraryView } from "./viewPrefs";

export interface LibraryFilter {
  minRating: number;
  colorLabels: ColorLabel[];
  flag: ImageFlag | "all";
  sort: ImageSort;
}

export const DEFAULT_FILTER: LibraryFilter = {
  minRating: 0,
  colorLabels: [],
  flag: "all",
  sort: "created_desc",
};

/** true, wenn ein Filter (nicht die Sortierung) die Treffer einschraenkt. */
export function isFilterActive(f: LibraryFilter): boolean {
  return f.minRating > 0 || f.colorLabels.length > 0 || f.flag !== "all";
}

export function toListQuery(f: LibraryFilter): ImageListQuery {
  return {
    minRating: f.minRating,
    colorLabels: f.colorLabels,
    flag: f.flag === "all" ? undefined : f.flag,
    sort: f.sort,
  };
}

const SORT_OPTIONS: ReadonlyArray<{ value: ImageSort; label: string }> = [
  { value: "created_desc", label: "Neueste zuerst" },
  { value: "created_asc", label: "Älteste zuerst" },
  { value: "rating_desc", label: "Beste Bewertung" },
  { value: "name_asc", label: "Dateiname A–Z" },
];

const FLAG_OPTIONS: ReadonlyArray<{ value: LibraryFilter["flag"]; label: string }> = [
  { value: "all", label: "Alle" },
  { value: "pick", label: "Ausgewählt" },
  { value: "none", label: "Ohne Markierung" },
  { value: "reject", label: "Abgelehnt" },
];

const selectCls =
  "border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 hover:border-stone-500";
const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-300";

export default function FilterBar({
  filter,
  onChange,
  view,
  onViewChange,
}: {
  readonly filter: LibraryFilter;
  readonly onChange: (next: LibraryFilter) => void;
  readonly view: LibraryView;
  readonly onViewChange: (view: LibraryView) => void;
}) {
  const captionId = useId();
  const toggleLabel = (key: ColorLabel) => {
    const has = filter.colorLabels.includes(key);
    onChange({
      ...filter,
      colorLabels: has
        ? filter.colorLabels.filter((l) => l !== key)
        : // Reihenfolge stabil halten (gleiche URL fuer gleiche Auswahl).
          COLOR_LABELS.map((l) => l.key).filter((k) => k === key || filter.colorLabels.includes(k)),
    });
  };

  return (
    <div
      data-testid="library-filter-bar"
      className="mt-6 flex flex-wrap items-end gap-x-5 gap-y-3 border-y border-stone-800 py-3 text-sm"
    >
      <label className="flex flex-col gap-1 text-xs text-stone-400">
        Bewertung
        <select
          data-testid="filter-min-rating"
          value={filter.minRating}
          onChange={(e) => onChange({ ...filter, minRating: Number(e.target.value) })}
          className={selectCls}
        >
          <option value={0}>Alle</option>
          {Array.from({ length: MAX_RATING }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n === MAX_RATING ? "5 Sterne" : `ab ${n} ${n === 1 ? "Stern" : "Sternen"}`}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-1">
        <span id={captionId} className="text-xs text-stone-400">
          Farblabel
        </span>
        <div role="group" aria-labelledby={captionId} className="flex items-center gap-0.5">
          {COLOR_LABELS.map((l) => {
            const on = filter.colorLabels.includes(l.key);
            return (
              <button
                key={l.key}
                type="button"
                data-testid={`filter-label-${l.key}`}
                aria-pressed={on}
                aria-label={l.name}
                title={l.name}
                onClick={() => toggleLabel(l.key)}
                className={`flex h-8 w-8 items-center justify-center border ${focusRing} ${
                  on ? "border-amber-300/70 bg-stone-800" : "border-transparent hover:border-stone-700"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`block h-3.5 w-3.5 rounded-full ${l.swatch} ${on ? "" : "opacity-50"}`}
                />
              </button>
            );
          })}
        </div>
      </div>

      <label className="flex flex-col gap-1 text-xs text-stone-400">
        Markierung
        <select
          data-testid="filter-flag"
          value={filter.flag}
          onChange={(e) => {
            const value = FLAG_OPTIONS.find((o) => o.value === e.target.value)?.value ?? "all";
            onChange({ ...filter, flag: value });
          }}
          className={selectCls}
        >
          {FLAG_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-stone-400">
        Sortierung
        <select
          data-testid="filter-sort"
          value={filter.sort}
          onChange={(e) => {
            const value =
              SORT_OPTIONS.find((o) => o.value === e.target.value)?.value ?? "created_desc";
            onChange({ ...filter, sort: value });
          }}
          className={selectCls}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {isFilterActive(filter) && (
        <button
          type="button"
          data-testid="filter-reset"
          onClick={() => onChange({ ...DEFAULT_FILTER, sort: filter.sort })}
          className={`py-1 text-amber-200 hover:underline ${focusRing}`}
        >
          Filter zurücksetzen
        </button>
      )}

      <div
        role="group"
        aria-label="Ansicht"
        className="ml-auto flex border border-stone-700"
      >
        {(
          [
            ["grid", "Raster"],
            ["list", "Liste"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            data-testid={`library-view-${value}`}
            aria-pressed={view === value}
            onClick={() => onViewChange(value)}
            className={`px-3 py-1 text-sm ${focusRing} ${
              view === value ? "bg-stone-800 text-amber-200" : "text-stone-400 hover:text-stone-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
