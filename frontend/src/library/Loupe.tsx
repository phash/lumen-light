/**
 * H2c: Lupe — ein Bild bildschirmfuellend, Blaettern im aktuellen
 * (gefilterten, sortierten) Ergebnis der Bibliothek.
 *
 * Bedienung: Pfeil links/rechts bzw. die sichtbaren Buttons blaettern,
 * Wischen auf Touch ebenso. Esc schliesst (Modal), der Aufrufer setzt den
 * Fokus auf die Kachel des zuletzt gezeigten Bildes (`onClose(id)`).
 * Einzeltasten (0-5, 6-9, P/X/U, E) nur bei aktiven Einzeltasten-Kuerzeln
 * und nicht in Eingabefeldern/offenen Menues; jede Taste hat einen Button
 * in der Leiste unten.
 *
 * H2d: Zoom 1:1 (Lightroom) per Z, Button oder Klick aufs Bild (zentriert
 * auf den Klickpunkt); Ziehen verschiebt, Klick/Z/Esc kehren zur
 * Einpassung zurueck — Esc im Zoom verlaesst nur den Zoom. Blaettern setzt
 * den Zoom zurueck. Details in `LoupeZoom.tsx`.
 */
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type TouchEvent,
} from "react";

import type { Image, ImageMetaPatch } from "../api/client";
import Modal from "../components/Modal";
import { getSingleKeyShortcutsEnabled } from "../editor/shortcutPrefs";
import LoupeZoom from "./LoupeZoom";
import { ColorLabelPicker, FlagButtons, StarRating } from "./MetaControls";
import PreviewImage, { previewSrc } from "./PreviewImage";
import { isShortcutBlocked, libraryKeyAction } from "./libraryKeys";
import { announcePatch, metaOf } from "./meta";
import { getLoupeAutoAdvance, setLoupeAutoAdvance } from "./viewPrefs";
import { CENTER_ANCHOR, anchorFromPoint, type ZoomAnchor } from "./zoom";

/** Mindest-Wischweg in px fuer Blaettern per Touch. */
const SWIPE_MIN_PX = 50;

export interface LoupeProps {
  readonly images: readonly Image[];
  readonly startId: string;
  readonly onClose: (currentId: string) => void;
  readonly onMetaChange: (id: string, patch: ImageMetaPatch) => void;
  readonly onOpenEditor: (id: string) => void;
  readonly announce: (text: string) => void;
  /** H2d: signierte URL des Originals (nur JPEG/PNG, erst beim Zoomen). */
  readonly loadOriginalUrl: (id: string) => Promise<string>;
  /** Die aria-live-Region der Bibliothek — im Dialog gerendert, weil
   *  Screenreader Inhalte ausserhalb von aria-modal ignorieren duerfen. */
  readonly liveRegion?: ReactNode;
}

function positionText(index: number, count: number): string {
  return `${index + 1} / ${count}`;
}

/** Nachbar-Vorschauen vorladen, damit Blaettern ohne Warten geht. */
function usePreload(urls: readonly (string | null)[]) {
  const key = urls.join("|");
  useEffect(() => {
    for (const url of key.split("|")) {
      if (!url) continue;
      const img = new window.Image();
      img.decoding = "async";
      img.src = url;
    }
  }, [key]);
}

export default function Loupe({
  images,
  startId,
  onClose,
  onMetaChange,
  onOpenEditor,
  announce,
  loadOriginalUrl,
  liveRegion,
}: LoupeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const [currentId, setCurrentId] = useState(startId);
  const [autoAdvance, setAutoAdvance] = useState(() => getLoupeAutoAdvance());
  // H2d: null = eingepasst, sonst 1:1 mit diesem Ankerpunkt.
  const [zoom, setZoom] = useState<ZoomAnchor | null>(null);
  // Geholte Original-URLs (Zoom aus/an ohne neuen Request).
  const [originalUrls] = useState(() => new Map<string, string>());

  const found = images.findIndex((i) => i.id === currentId);
  const index = found >= 0 ? found : 0;
  const image = images[index];
  const count = images.length;
  const prev = images[index - 1];
  const next = images[index + 1];
  usePreload([prev ? previewSrc(prev) : null, next ? previewSrc(next) : null]);

  if (!image) return null;
  const meta = metaOf(image);
  const close = () => onClose(image.id);
  const canZoom = previewSrc(image) !== null;

  const setZoomed = (next: ZoomAnchor | null) => {
    if ((next === null) === (zoom === null)) return;
    setZoom(next);
    announce(next ? "Zoom 1:1" : "Eingepasst");
  };
  const toggleZoom = () => {
    if (zoom) setZoomed(null);
    else if (canZoom) setZoomed(CENTER_ANCHOR);
  };
  /** Klick aufs eingepasste Bild: 1:1 zentriert auf den Klickpunkt. */
  const onFitClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!(event.target instanceof HTMLImageElement)) return;
    setZoomed(anchorFromPoint(event.target.getBoundingClientRect(), event.clientX, event.clientY));
  };

  const goTo = (target: number, prefix?: string) => {
    const dest = images[target];
    if (!dest || target === index) return;
    setCurrentId(dest.id);
    setZoom(null);
    const where = `${dest.originalFilename}, Bild ${positionText(target, count).replace(" / ", " von ")}`;
    announce(prefix ? `${prefix} – weiter: ${where}` : where);
  };

  const change = (patch: ImageMetaPatch) => {
    onMetaChange(image.id, patch);
    // Auto-Weiter: Ansage der Aenderung plus neues Bild in EINER Ansage.
    if (autoAdvance && next) goTo(index + 1, announcePatch(patch));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (isShortcutBlocked(event.target, rootRef.current)) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      // Pfeiltasten sind keine Zeichen-Kuerzel (WCAG 2.1.4) -> immer aktiv.
      event.preventDefault();
      goTo(index + (event.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    if (!getSingleKeyShortcutsEnabled()) return;
    const action = libraryKeyAction(event);
    if (action?.kind === "meta") {
      event.preventDefault();
      change(action.patch);
    } else if (action?.kind === "editor") {
      event.preventDefault();
      onOpenEditor(image.id);
    } else if (action?.kind === "zoom") {
      event.preventDefault();
      toggleZoom();
    }
  };

  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const t = event.touches[0];
    touchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStart.current;
    const t = event.changedTouches[0];
    touchStart.current = null;
    // Im Zoom verschiebt Ziehen den Ausschnitt statt zu blaettern.
    if (!start || !t || zoom) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy)) return;
    goTo(index + (dx < 0 ? 1 : -1));
  };

  const navButton = (dir: "prev" | "next") => {
    const target = dir === "prev" ? index - 1 : index + 1;
    const enabled = target >= 0 && target < count;
    return (
      <button
        type="button"
        data-testid={`loupe-${dir}`}
        aria-label={dir === "prev" ? "Vorheriges Bild" : "Nächstes Bild"}
        // aria-disabled statt disabled: der Fokus bleibt am Rand auf dem
        // Button, statt ins Leere zu fallen.
        aria-disabled={!enabled}
        onClick={() => goTo(target)}
        className={`absolute top-1/2 z-10 flex h-14 w-11 -translate-y-1/2 items-center justify-center border border-stone-700 bg-stone-900/80 text-2xl text-stone-200 transition-opacity focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 ${
          dir === "prev" ? "left-2 sm:left-4" : "right-2 sm:right-4"
        } ${enabled ? "hover:border-amber-300/50 hover:text-amber-200" : "cursor-default opacity-30"}`}
      >
        <span aria-hidden="true">{dir === "prev" ? "‹" : "›"}</span>
      </button>
    );
  };

  return (
    <Modal
      onClose={close}
      testId="loupe"
      cardTestId="loupe-dialog"
      labelledBy="loupe-title"
      closeOnBackdrop={false}
      backdropClassName="fixed inset-0 z-50 bg-stone-950"
      cardClassName="h-full w-full outline-none"
      onKeyDown={onKeyDown}
      onEscape={() => {
        if (!zoom) return false;
        setZoomed(null);
        return true;
      }}
    >
      <div
        ref={rootRef}
        className="flex h-full flex-col text-stone-200"
      >
        <div className="flex items-center gap-3 border-b border-stone-800 px-4 py-2">
          <h2 id="loupe-title" className="min-w-0 flex-1 truncate text-sm" title={image.originalFilename}>
            <span className="sr-only">Lupe: </span>
            {image.originalFilename}
          </h2>
          <span data-testid="loupe-position" className="shrink-0 font-mono text-xs text-stone-400">
            {positionText(index, count)}
          </span>
          <button
            type="button"
            data-testid="loupe-zoom-toggle"
            aria-pressed={zoom !== null}
            disabled={!canZoom}
            onClick={toggleZoom}
            title={canZoom ? "Zoom 1:1 (Z)" : "Keine Vorschau zum Zoomen"}
            className={`shrink-0 border px-2 py-0.5 font-mono text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-40 ${
              zoom
                ? "border-amber-300/70 bg-stone-800 text-amber-200"
                : "border-stone-700 text-stone-300 enabled:hover:border-stone-500"
            }`}
          >
            <span className="sr-only">Zoom </span>1:1
          </button>
          <button
            type="button"
            data-testid="loupe-close"
            onClick={close}
            aria-label="Lupe schließen"
            title="Schließen (Esc)"
            className="shrink-0 px-2 py-1 text-stone-400 hover:text-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            ✕
          </button>
        </div>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center p-2 sm:px-20 sm:py-6"
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {navButton("prev")}
          {zoom ? (
            <LoupeZoom
              key={image.id}
              image={image}
              anchor={zoom}
              loadOriginalUrl={loadOriginalUrl}
              originalUrls={originalUrls}
              onExit={() => setZoomed(null)}
            />
          ) : (
            // Klick aufs Bild zoomt (Maus); Tastatur nutzt Z bzw. den Button.
            <div
              className="flex h-full w-full items-center justify-center [&_img]:cursor-zoom-in"
              onClick={onFitClick}
            >
              <PreviewImage key={previewSrc(image) ?? image.id} image={image} testId="loupe" />
            </div>
          )}
          {navButton("next")}
        </div>

        <div
          role="group"
          aria-label="Bild bewerten"
          className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-stone-800 px-4 py-2 text-sm"
        >
          <StarRating value={meta.rating} testId="loupe" showClear onChange={change} />
          <FlagButtons value={meta.flag} testId="loupe" showNone onChange={change} />
          <ColorLabelPicker value={meta.colorLabel} testId="loupe" onChange={change} />
          <button
            type="button"
            data-testid="loupe-edit"
            onClick={() => onOpenEditor(image.id)}
            className="text-amber-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            Im Editor öffnen
          </button>
          <label className="ml-auto flex items-center gap-2 text-xs text-stone-400">
            <input
              type="checkbox"
              data-testid="loupe-auto-advance"
              checked={autoAdvance}
              onChange={(e) => {
                setLoupeAutoAdvance(e.target.checked);
                setAutoAdvance(e.target.checked);
              }}
              className="accent-amber-300"
            />
            Nach Bewertung automatisch weiter
          </label>
        </div>
        {liveRegion}
      </div>
    </Modal>
  );
}
