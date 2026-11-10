import { useEffect } from "react";

import type { Locale } from "../i18n/content";

/** Suffix fuer alle Seitentitel ausser der Landing (die bringt ihren eigenen). */
export const TITLE_SUFFIX = " — Lumen · light";

/**
 * Setzt document.title und <html lang> pro Route. Laeuft nur im Browser
 * (useEffect), der SSR-Prerender setzt Title/Lang selbst.
 */
export function usePageMeta(title: string, lang: Locale = "de"): void {
  useEffect(() => {
    document.title = title;
    document.documentElement.lang = lang;
  }, [title, lang]);
}
