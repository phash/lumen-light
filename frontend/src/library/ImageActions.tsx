import AutoFocusButton from "../components/AutoFocusButton";
import type { Image } from "../api/client";

/**
 * „Im Editor öffnen" + zweistufiges Löschen — geteilt von Listenzeile und
 * Raster-Kachel. Die data-testids sind in beiden Ansichten identisch
 * (immer nur eine Ansicht gerendert), damit E2E/Fokus-Logik nicht doppelt
 * gepflegt werden muss.
 */
export default function ImageActions({
  image,
  confirming,
  onOpen,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
  tabbable = true,
  compact = false,
}: {
  readonly image: Image;
  readonly confirming: boolean;
  readonly onOpen: () => void;
  readonly onAskDelete: () => void;
  readonly onConfirmDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly tabbable?: boolean;
  readonly compact?: boolean;
}) {
  const tab = tabbable ? 0 : -1;
  const gap = compact ? "gap-3 text-xs" : "gap-4";
  if (confirming) {
    return (
      <span className={`flex flex-wrap items-center ${compact ? "gap-2 text-xs" : "gap-2"}`}>
        <span className="text-xs text-stone-300">Endgültig löschen?</span>
        <AutoFocusButton
          data-testid={`image-delete-confirm-${image.id}`}
          onClick={onConfirmDelete}
          aria-label={`„${image.originalFilename}“ endgültig löschen`}
          className="text-red-400 hover:text-red-300"
        >
          Löschen
        </AutoFocusButton>
        <button
          type="button"
          data-testid={`image-delete-cancel-${image.id}`}
          onClick={onCancelDelete}
          className="text-stone-400 hover:text-stone-200"
        >
          Abbrechen
        </button>
      </span>
    );
  }
  return (
    <div className={`flex items-center ${gap}`}>
      <button
        type="button"
        data-testid={`image-edit-${image.id}`}
        tabIndex={tab}
        onClick={onOpen}
        aria-label={compact ? `„${image.originalFilename}“ im Editor öffnen` : undefined}
        className="text-amber-200 hover:underline"
      >
        {compact ? "Bearbeiten" : "Im Editor öffnen"}
      </button>
      <button
        type="button"
        data-testid={`image-delete-${image.id}`}
        tabIndex={tab}
        aria-label={`„${image.originalFilename}“ löschen`}
        onClick={onAskDelete}
        className="text-stone-400 hover:text-red-400"
      >
        Löschen
      </button>
    </div>
  );
}
