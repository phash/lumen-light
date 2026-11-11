import { useEffect, useRef } from "react";
import type { KeyboardEventHandler, ReactNode } from "react";

interface ModalProps {
  readonly onClose: () => void;
  /** data-testid auf dem Backdrop (stabile Test-API, wie bisher). */
  readonly testId?: string;
  /** data-testid auf der Dialog-Karte (role="dialog"), falls Tests die
   *  Rolle direkt am Test-Element erwarten. */
  readonly cardTestId?: string;
  /** id der Ueberschrift fuer aria-labelledby (bevorzugt). */
  readonly labelledBy?: string;
  /** Fallback-Label, wenn keine sichtbare Ueberschrift verlinkt werden kann. */
  readonly ariaLabel?: string;
  readonly backdropClassName?: string;
  readonly cardClassName?: string;
  /** Klick auf den Backdrop schliesst (Default true). */
  readonly closeOnBackdrop?: boolean;
  /** Tasten auf der Karte (inkl. Karte selbst fokussiert, z.B. nach Klick
   *  auf eine nicht-interaktive Flaeche) — fuer Dialog-eigene Kuerzel. */
  readonly onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  /** Esc zuerst dem Dialog anbieten (z.B. Lupe: Zoom verlassen).
   *  true = verarbeitet, der Dialog bleibt offen. */
  readonly onEscape?: () => boolean;
  readonly children: ReactNode;
}

// Auswahl der fokussierbaren Elemente fuer den Focus-Trap.
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Geteilter Modal-Wrapper: Backdrop + Karte mit role="dialog"/aria-modal,
 * Escape-zum-Schliessen, Focus-Trap (Tab zykliert in der Karte) und
 * Fokus-Wiederherstellung auf das ausloesende Element beim Schliessen.
 *
 * Die Komponente wird vom Parent nur gerendert, wenn das Modal offen ist
 * ({open && <Modal/>}) — sie haelt selbst keinen open-State.
 */
export default function Modal({
  onClose,
  testId,
  cardTestId,
  labelledBy,
  ariaLabel,
  backdropClassName = "fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4",
  cardClassName,
  closeOnBackdrop = true,
  onKeyDown,
  onEscape,
  children,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  // onClose im Ref halten: Aufrufer uebergeben oft Inline-Arrows. Waere
  // onClose eine Effect-Dependency, liefe der Fokus-Effekt bei jedem
  // Parent-Re-Render neu und zoege den Fokus aufs erste Element zurueck.
  const onCloseRef = useRef(onClose);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onCloseRef.current = onClose;
    onEscapeRef.current = onEscape;
  }, [onClose, onEscape]);

  useEffect(() => {
    const card = cardRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const focusables = (): HTMLElement[] =>
      card
        ? Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
            (el) => el.offsetParent !== null,
          )
        : [];

    // Initialfokus in die Karte ziehen (erstes interaktives Element, sonst
    // die Karte selbst via tabIndex=-1).
    const first = focusables()[0];
    (first ?? card)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Offenes Menue im Dialog (data-popup-open, z.B. Farblabel-Palette)
        // schliesst sich zuerst selbst; erst das naechste Esc schliesst
        // den Dialog.
        if (e.target instanceof Element && e.target.closest("[data-popup-open]")) return;
        // stopPropagation, damit Editor-Shortcuts (globaler keydown) nicht
        // zusaetzlich feuern, waehrend ein Dialog offen ist.
        e.stopPropagation();
        if (onEscapeRef.current?.()) return;
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !card) return;
      const items = focusables();
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (!firstEl || !lastEl) {
        e.preventDefault();
        card.focus();
        return;
      }
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previouslyFocused?.focus();
    };
    // Nur Mount/Unmount — onClose kommt ueber onCloseRef.
  }, []);

  return (
    <div
      data-testid={testId}
      className={backdropClassName}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={cardRef}
        data-testid={cardTestId}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-label={ariaLabel}
        tabIndex={-1}
        className={cardClassName}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
