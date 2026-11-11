/**
 * H2b: Bedienelemente fuer Sterne, Farblabel und Markierung. Genutzt in
 * der Raster-Kachel, der Listenzeile und der Mehrfachauswahl-Leiste.
 *
 * `value === null` bedeutet "gemischt/unbekannt" (Mehrfachauswahl): dann
 * ist nichts gedrueckt, ein Klick setzt den Wert immer (kein Umschalten).
 * `tabbable=false` nimmt die Buttons aus der Tab-Reihenfolge (Roving-
 * Tabindex im Raster: nur die aktive Kachel ist per Tab erreichbar).
 */
import { useEffect, useId, useRef, useState } from "react";

import type { ColorLabel, ImageFlag, ImageMetaPatch } from "../api/client";
import { POPUP_OPEN_ATTR } from "./libraryKeys";
import { COLOR_LABELS, MAX_RATING, colorLabelDef, ratingText } from "./meta";

interface CommonProps {
  /** Praefix fuer data-testid, z.B. `tile-i-1` oder `batch`. */
  readonly testId: string;
  readonly onChange: (patch: ImageMetaPatch) => void;
  readonly tabbable?: boolean;
  readonly disabled?: boolean;
}

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-amber-300";

export function StarRating({
  value,
  testId,
  onChange,
  tabbable = true,
  disabled = false,
  showClear = false,
}: CommonProps & { readonly value: number | null; readonly showClear?: boolean }) {
  const stars = Array.from({ length: MAX_RATING }, (_, i) => i + 1);
  return (
    <div role="group" aria-label="Bewertung" className="flex items-center">
      {stars.map((n) => {
        const filled = value !== null && n <= value;
        return (
          <button
            key={n}
            type="button"
            data-testid={`${testId}-star-${n}`}
            tabIndex={tabbable ? 0 : -1}
            disabled={disabled}
            aria-label={ratingText(n)}
            aria-pressed={value === n}
            title={value === n ? `${ratingText(n)} – erneut klicken entfernt` : ratingText(n)}
            // Erneuter Klick auf den aktuellen Stern setzt auf 0 zurueck.
            onClick={() => onChange({ rating: value === n ? 0 : n })}
            className={`flex h-6 w-6 items-center justify-center text-base leading-none transition-colors disabled:opacity-40 ${focusRing} ${
              filled ? "text-amber-300" : "text-stone-600 hover:text-amber-200/70"
            }`}
          >
            <span aria-hidden="true">{filled ? "★" : "☆"}</span>
          </button>
        );
      })}
      {showClear && (
        <button
          type="button"
          data-testid={`${testId}-star-0`}
          tabIndex={tabbable ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange({ rating: 0 })}
          className={`ml-1 px-1 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40 ${focusRing}`}
        >
          Keine Sterne
        </button>
      )}
    </div>
  );
}

export function ColorLabelPicker({
  value,
  testId,
  onChange,
  tabbable = true,
  disabled = false,
  menuBelow = false,
  triggerLabel,
}: CommonProps & {
  /** Abweichende Beschriftung des Ausloesers (Mehrfachauswahl). */
  readonly triggerLabel?: string;
  readonly value: ColorLabel | null | undefined;
  /** Palette unter statt ueber dem Ausloeser oeffnen (Leiste oben). */
  readonly menuBelow?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const current = value ? colorLabelDef(value) : null;

  // Klick ausserhalb schliesst die Palette (Listener nur solange offen).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (label: ColorLabel | null) => {
    setOpen(false);
    onChange({ colorLabel: label });
    triggerRef.current?.focus();
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      // H2c: offenes Menue sperrt Einzeltasten und das Esc des Dialogs.
      {...(open ? { [POPUP_OPEN_ATTR]: "" } : {})}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid={`${testId}-label`}
        tabIndex={tabbable ? 0 : -1}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          triggerLabel ?? (current ? `Farblabel: ${current.name}` : "Farblabel: keins")
        }
        title={current ? `Farblabel ${current.name}` : "Farblabel wählen"}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-6 w-6 items-center justify-center disabled:opacity-40 ${focusRing}`}
      >
        <span
          aria-hidden="true"
          className={`block h-3 w-3 rounded-full ${
            current ? current.swatch : "border border-dashed border-stone-500"
          }`}
        />
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label="Farblabel wählen"
          data-testid={`${testId}-label-menu`}
          className={`absolute z-20 flex ${menuBelow ? "left-0 top-full mt-1" : "bottom-full right-0 mb-1"} items-center gap-1 border border-stone-700 bg-stone-900 p-1 shadow-lg shadow-black/40`}
        >
          {COLOR_LABELS.map((l) => (
            <button
              key={l.key}
              type="button"
              data-testid={`${testId}-label-${l.key}`}
              aria-label={l.name}
              aria-pressed={value === l.key}
              title={l.name}
              onClick={() => pick(l.key)}
              className={`flex h-7 w-7 items-center justify-center ${focusRing} ${
                value === l.key ? "bg-stone-700" : "hover:bg-stone-800"
              }`}
            >
              <span aria-hidden="true" className={`block h-3.5 w-3.5 rounded-full ${l.swatch}`} />
            </button>
          ))}
          <button
            type="button"
            data-testid={`${testId}-label-none`}
            aria-pressed={value === null}
            onClick={() => pick(null)}
            className={`h-7 px-2 text-xs text-stone-300 hover:bg-stone-800 ${focusRing}`}
          >
            Keins
          </button>
        </div>
      )}
    </div>
  );
}

function FlagIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5" fill="currentColor">
      <path d="M3 1.5h1.5V15H3zM5.5 2h7.2l-1.6 3.2 1.6 3.3H5.5z" />
    </svg>
  );
}

function RejectIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" />
    </svg>
  );
}

export function FlagButtons({
  value,
  testId,
  onChange,
  tabbable = true,
  disabled = false,
  showNone = false,
}: CommonProps & { readonly value: ImageFlag | null; readonly showNone?: boolean }) {
  // Einzelbild: erneuter Klick auf die aktive Markierung hebt sie auf.
  const set = (flag: Exclude<ImageFlag, "none">) =>
    onChange({ flag: value === flag ? "none" : flag });
  const base = `flex h-6 w-6 items-center justify-center transition-colors disabled:opacity-40 ${focusRing}`;
  return (
    <div role="group" aria-label="Markierung" className="flex items-center">
      <button
        type="button"
        data-testid={`${testId}-pick`}
        tabIndex={tabbable ? 0 : -1}
        disabled={disabled}
        aria-label="Ausgewählt"
        aria-pressed={value === "pick"}
        title="Als ausgewählt markieren"
        onClick={() => set("pick")}
        className={`${base} ${value === "pick" ? "text-amber-300" : "text-stone-500 hover:text-stone-200"}`}
      >
        <FlagIcon />
      </button>
      <button
        type="button"
        data-testid={`${testId}-reject`}
        tabIndex={tabbable ? 0 : -1}
        disabled={disabled}
        aria-label="Abgelehnt"
        aria-pressed={value === "reject"}
        title="Als abgelehnt markieren"
        onClick={() => set("reject")}
        className={`${base} ${value === "reject" ? "text-red-400" : "text-stone-500 hover:text-stone-200"}`}
      >
        <RejectIcon />
      </button>
      {showNone && (
        <button
          type="button"
          data-testid={`${testId}-unflag`}
          tabIndex={tabbable ? 0 : -1}
          disabled={disabled}
          onClick={() => onChange({ flag: "none" })}
          className={`ml-1 px-1 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40 ${focusRing}`}
        >
          Markierung entfernen
        </button>
      )}
    </div>
  );
}
