/**
 * H2c: Einzeltasten der Bibliothek (Lightroom-nah) als reine Funktion.
 *
 * 0-5 Sterne, 6-9 Labels rot/gelb/gruen/blau, P ausgewaehlt, X abgelehnt,
 * U Markierung weg, Enter Lupe, E Editor, C Vergleich, ? Hilfe.
 *
 * Alle diese Tasten laufen nur, wenn Einzeltasten-Kuerzel aktiv sind
 * (WCAG 2.1.4, `shortcutPrefs.ts`) und der Fokus nicht in einem
 * Eingabefeld bzw. in einem offenen Menue steht — das prueft
 * `isShortcutBlocked`. Jede Aktion hat zusaetzlich einen Button-Weg.
 */
import type { ColorLabel, ImageMetaPatch } from "../api/client";

export type LibraryKeyAction =
  | { readonly kind: "meta"; readonly patch: ImageMetaPatch }
  | { readonly kind: "loupe" }
  | { readonly kind: "editor" }
  | { readonly kind: "compare" }
  | { readonly kind: "help" };

export interface KeyLike {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}

/** Tasten 6..9 -> Labels in Lightroom-Reihenfolge (Lila hat keine Taste). */
const LABEL_KEYS: Readonly<Record<string, ColorLabel>> = {
  "6": "red",
  "7": "yellow",
  "8": "green",
  "9": "blue",
};

export function libraryKeyAction(event: KeyLike): LibraryKeyAction | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  const { key } = event;
  if (key.length === 1 && key >= "0" && key <= "5") {
    return { kind: "meta", patch: { rating: Number(key) } };
  }
  const label = LABEL_KEYS[key];
  if (label) return { kind: "meta", patch: { colorLabel: label } };
  switch (key.toLowerCase()) {
    case "p":
      return { kind: "meta", patch: { flag: "pick" } };
    case "x":
      return { kind: "meta", patch: { flag: "reject" } };
    case "u":
      return { kind: "meta", patch: { flag: "none" } };
    case "enter":
      return { kind: "loupe" };
    case "e":
      return { kind: "editor" };
    case "c":
      return { kind: "compare" };
    case "?":
      return { kind: "help" };
    default:
      return null;
  }
}

/** Markiert einen geoeffneten Popup-Bereich (z.B. Farblabel-Palette).
 *  Solange einer offen ist, ruhen Einzeltasten; Modal ignoriert Escape
 *  darin, damit Esc zuerst nur das Menue schliesst. */
export const POPUP_OPEN_ATTR = "data-popup-open";

/** Eingabefelder, in denen Tippen Vorrang vor Kuerzeln hat. Checkbox/
 *  Radio/Button-Inputs zaehlen nicht dazu. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range"].includes(target.type);
  }
  return false;
}

/** true = Einzeltaste nicht auswerten (Eingabefeld fokussiert oder ein
 *  Menue im Bereich `scope` offen). */
export function isShortcutBlocked(target: EventTarget | null, scope: ParentNode | null): boolean {
  if (isTypingTarget(target)) return true;
  if (target instanceof Element && target.closest(`[${POPUP_OPEN_ATTR}]`)) return true;
  return scope?.querySelector(`[${POPUP_OPEN_ATTR}]`) != null;
}
