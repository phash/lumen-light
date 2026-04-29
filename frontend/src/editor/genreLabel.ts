/**
 * Genre-Slug → Anzeige-Label. Single Source of Truth, damit Marketplace,
 * EditorBanners (Smart-Suggestion) und PresetDialog dieselbe Schreibweise
 * benutzen.
 */
import type { PresetGenre } from "../api/client";

export const GENRE_LABEL: Record<PresetGenre, string> = {
  portrait: "Portrait",
  landscape: "Landschaft",
  city: "Stadt",
  nature: "Natur",
  animals: "Tiere",
  sports: "Sport",
  blackandwhite: "Schwarzweiß",
  other: "Sonstiges",
};

export const ALL_GENRES: ReadonlyArray<PresetGenre> = [
  "portrait",
  "landscape",
  "city",
  "nature",
  "animals",
  "sports",
  "blackandwhite",
  "other",
];

/** Sicherer Lookup — fuer Genres, die nicht in der Map sind, fallen
 *  wir auf den Slug zurueck (z.B. neue Backend-Slugs vor Frontend-Update). */
export function genreLabel(g: string | null | undefined): string {
  if (!g) return "";
  return (GENRE_LABEL as Record<string, string>)[g] ?? g;
}
