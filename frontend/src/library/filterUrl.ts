/**
 * H2d: Filter/Sortierung der Bibliothek in den URL-Suchparametern, damit
 * Neuladen und Zurueck (z.B. aus dem Editor) den Stand behalten.
 *
 * Parameternamen wie in GET /images (`minRating`, `colorLabel` mehrfach,
 * `flag`, `sort`). Ungueltige Werte fallen still auf den Default zurueck;
 * Default-Werte werden nicht geschrieben (saubere URL). Die Ansicht
 * Raster/Liste gehoert nicht hierher (viewPrefs).
 */
import {
  COLOR_LABEL_FILTER_ORDER,
  DEFAULT_FILTER,
  FLAG_FILTER_VALUES,
  SORT_VALUES,
  type LibraryFilter,
} from "./FilterBar";
import { MAX_RATING } from "./meta";

const FILTER_PARAM_KEYS = ["minRating", "colorLabel", "flag", "sort"] as const;

function pick<T extends string>(values: readonly T[], raw: string | null, fallback: T): T {
  return values.find((v) => v === raw) ?? fallback;
}

export function filterFromParams(params: URLSearchParams): LibraryFilter {
  const rawRating = params.get("minRating") ?? "";
  const rating = /^\d$/.test(rawRating) ? Number(rawRating) : DEFAULT_FILTER.minRating;
  const labels = new Set(params.getAll("colorLabel"));
  return {
    minRating: rating <= MAX_RATING ? rating : DEFAULT_FILTER.minRating,
    // Unbekannte und doppelte Werte fallen weg, Reihenfolge normiert.
    colorLabels: COLOR_LABEL_FILTER_ORDER.filter((l) => labels.has(l)),
    flag: pick(FLAG_FILTER_VALUES, params.get("flag"), DEFAULT_FILTER.flag),
    sort: pick(SORT_VALUES, params.get("sort"), DEFAULT_FILTER.sort),
  };
}

/** Neue Suchparameter: fremde Parameter aus `current` bleiben stehen, die
 *  Filter-Parameter werden ersetzt (Defaults weggelassen). */
export function filterToParams(filter: LibraryFilter, current: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(current);
  for (const key of FILTER_PARAM_KEYS) next.delete(key);
  if (filter.minRating !== DEFAULT_FILTER.minRating) {
    next.set("minRating", String(filter.minRating));
  }
  for (const label of filter.colorLabels) next.append("colorLabel", label);
  if (filter.flag !== DEFAULT_FILTER.flag) next.set("flag", filter.flag);
  if (filter.sort !== DEFAULT_FILTER.sort) next.set("sort", filter.sort);
  return next;
}
