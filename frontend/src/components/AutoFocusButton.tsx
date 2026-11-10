import { useEffect, useRef } from "react";
import type { ButtonHTMLAttributes } from "react";

/**
 * Button, der beim Mount den Fokus bekommt — fuer Inline-Bestaetigungen
 * ("Wirklich löschen?"), damit Tastatur-Nutzer direkt am neuen Element
 * landen statt im Nirgendwo (das ausloesende Element ist weg).
 */
export default function AutoFocusButton(
  props: ButtonHTMLAttributes<HTMLButtonElement>,
) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return <button type="button" {...props} ref={ref} />;
}
