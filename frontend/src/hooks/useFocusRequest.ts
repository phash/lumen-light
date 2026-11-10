import { useCallback, useEffect, useRef } from "react";

/**
 * Fokus nach dem naechsten Render auf ein Element (per data-testid)
 * setzen. Gedacht fuer Inline-Bestaetigungen: nach "Abbrechen" ist der
 * Ausloeser neu gerendert und braucht den Fokus zurueck.
 */
export function useFocusRequest(): (testId: string) => void {
  const pending = useRef<string | null>(null);

  // Ohne Deps: nach jedem Render offenen Request einloesen.
  useEffect(() => {
    const id = pending.current;
    if (id === null) return;
    pending.current = null;
    const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    el?.focus();
  });

  return useCallback((testId: string) => {
    pending.current = testId;
  }, []);
}
