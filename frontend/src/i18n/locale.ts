import type { Locale } from "./content";

/** EN-Bereich: genau /en oder Unterpfade /en/... — nicht /entwurf o.ae. */
export function isEnPath(pathname: string): boolean {
  return pathname === "/en" || pathname.startsWith("/en/");
}

/** Locale einer Route (Default de). */
export function localeForPath(pathname: string): Locale {
  return isEnPath(pathname) ? "en" : "de";
}
