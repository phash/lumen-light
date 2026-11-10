/**
 * Tastatur-Nudging fuer Overlay-Handles (Crop, Masken, Compare-Split).
 * Pfeiltasten liefern ein Delta in normierten Koordinaten (0..1),
 * Shift vergroessert den Schritt. Pure Funktion, damit Tests ohne DOM
 * auskommen.
 */

/** Normaler Schritt: 1 % der Bildkante. */
export const NUDGE_STEP = 0.01;
/** Grosser Schritt (Shift): 5 % der Bildkante. */
export const NUDGE_STEP_LARGE = 0.05;

export interface NudgeKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
}

/**
 * Liefert {dx, dy} fuer Pfeiltasten, sonst null. dy waechst nach unten
 * (Bildschirm-Koordinaten), passend zu den Drag-Handlern.
 */
export function nudgeDelta(e: NudgeKeyEvent): { dx: number; dy: number } | null {
  const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
  switch (e.key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * Tailwind-Klassen fuer ein Handle mit >= 24px Trefferflaeche: der
 * Wrapper ist 24x24 transparent und zentriert, der sichtbare Punkt
 * sitzt als Kind darin. Fokus-Ring fuer Tastatur-Nutzer.
 */
export const HANDLE_HIT_CLASS =
  "absolute w-6 h-6 -ml-3 -mt-3 flex items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-amber-300";
