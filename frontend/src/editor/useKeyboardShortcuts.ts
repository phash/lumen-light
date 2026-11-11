import { useEffect, useLayoutEffect, useRef } from "react";

import { getSingleKeyShortcutsEnabled } from "./shortcutPrefs";

interface Shortcuts {
  readonly onResetAll?: () => void;
  readonly onExport?: () => void;
  readonly onOpenFile?: () => void;
  readonly onToggleCrop?: () => void;
  readonly onTogglePresets?: () => void;
  readonly onShowHelp?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly setBypass?: (bypass: boolean) => void;
  /** Escape ohne offenes Modal: Crop-/WB-Picker-Modus verlassen. */
  readonly onEscape?: () => void;
  readonly onZoomIn?: () => void;
  readonly onZoomOut?: () => void;
}

const isTextInput = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable
  );
};

/** Offenes Modal (Dialog mit aria-modal) faengt die Tastatur — inklusive
 *  Escape, das der Dialog selbst behandelt. Die Onboarding-Tour ist zwar
 *  aria-modal, laesst aber bewusst Interaktion mit dem Editor zu (sie
 *  verweist sogar auf Tastenkuerzel) und blockt deshalb nicht. */
const isModalOpen = (): boolean =>
  document.querySelector(
    '[aria-modal="true"]:not([data-testid="onboarding-tour"])',
  ) !== null;

/** Onboarding-Tour offen: Escape gehoert der Tour (sie schliesst sich
 *  selbst) und darf nicht zusaetzlich Crop/WB-Modus verlassen. */
const isTourOpen = (): boolean =>
  document.querySelector('[data-testid="onboarding-tour"]') !== null;

/** Einzelzeichen-Shortcuts (WCAG 2.1.4). */
const SINGLE_KEYS: ReadonlySet<string> = new Set([
  "0", "\\", "r", "R", "p", "P", "?", "+", "=", "-",
]);

/** Einzeltaste ohne Strg/Cmd. Backslash zaehlt immer als Einzeltaste:
 *  auf DE-Layouts kommt er per AltGr (= Strg+Alt unter Windows). */
const isSingleKeyShortcut = (e: KeyboardEvent): boolean =>
  SINGLE_KEYS.has(e.key) && (e.key === "\\" || (!e.metaKey && !e.ctrlKey));

/** Fokus auf/in einem role=slider: Zifferntasten etc. gehoeren dem Slider. */
const isSliderFocused = (target: EventTarget | null): boolean => {
  const inSlider = (el: Element | null): boolean =>
    el !== null && el.closest('[role="slider"]') !== null;
  return (
    inSlider(document.activeElement) ||
    (target instanceof Element && inSlider(target))
  );
};

export function useKeyboardShortcuts(shortcuts: Shortcuts): void {
  // Letzte Callbacks in einem Ref halten: Aufrufer duerfen jedes Render ein
  // neues Objekt-Literal uebergeben, ohne dass die Listener neu abonniert
  // werden.
  const ref = useRef(shortcuts);
  useLayoutEffect(() => {
    ref.current = shortcuts;
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;
      if (isModalOpen()) return;
      // K1: Einzeltasten abschaltbar (Account) und nie auf Slidern.
      if (
        isSingleKeyShortcut(e) &&
        (!getSingleKeyShortcutsEnabled() || isSliderFocused(e.target))
      ) {
        return;
      }
      const s = ref.current;
      const plain = !e.metaKey && !e.ctrlKey && !e.altKey;

      if (e.key === "Escape") {
        // K2: Tour faengt Escape selbst ab.
        if (isTourOpen()) return;
        s.onEscape?.();
      } else if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        s.onResetAll?.();
      } else if (e.key === "\\" && !e.repeat) {
        e.preventDefault();
        s.setBypass?.(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        s.onExport?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        s.onOpenFile?.();
      } else if (e.key.toLowerCase() === "r" && plain) {
        e.preventDefault();
        s.onToggleCrop?.();
      } else if (e.key.toLowerCase() === "p" && plain) {
        e.preventDefault();
        s.onTogglePresets?.();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        // Cmd+Shift+Z = Redo (Mac/Win-Konvention).
        e.preventDefault();
        s.onRedo?.();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        s.onUndo?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        // Win-zusaetzlich: Ctrl+Y = Redo.
        e.preventDefault();
        s.onRedo?.();
      } else if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        s.onShowHelp?.();
      } else if ((e.key === "+" || e.key === "=") && plain) {
        // Ctrl/Cmd + "+" bleibt Browser-Zoom.
        e.preventDefault();
        s.onZoomIn?.();
      } else if (e.key === "-" && plain) {
        e.preventDefault();
        s.onZoomOut?.();
      }
    };

    // keyup bleibt ungegated: ein gedrueckter Bypass muss immer loslassen.
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "\\") {
        ref.current.setBypass?.(false);
      }
    };

    // Fenster verliert den Fokus (Alt+Tab) -> keyup kommt nie an, Bypass
    // wuerde sonst haengen bleiben.
    const onBlur = () => {
      ref.current.setBypass?.(false);
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
