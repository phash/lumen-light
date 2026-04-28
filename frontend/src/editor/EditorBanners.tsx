/**
 * Editor-Banner: Fehler, Decoding-Indikator, Smart-Preset-Suggestion,
 * Camera-Info. Stateless — alle vier Banner sind absolut positioniert
 * relativ zum Viewport-Container.
 */
import type { Genre } from "./suggestPreset";

interface Props {
  readonly error: string | null;
  readonly onErrorDismiss: () => void;
  readonly decoding: boolean;
  readonly cameraInfo: string | null;
  readonly suggestedGenre: Genre | null;
  readonly suggestionDismissed: boolean;
  readonly onApplySuggestion: (genre: Genre) => void;
  readonly onDismissSuggestion: () => void;
}

export default function EditorBanners({
  error,
  onErrorDismiss,
  decoding,
  cameraInfo,
  suggestedGenre,
  suggestionDismissed,
  onApplySuggestion,
  onDismissSuggestion,
}: Props) {
  return (
    <>
      {error && (
        <div
          data-testid="editor-error"
          className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 bg-red-950/80 border border-red-500/60 backdrop-blur"
        >
          <span className="text-red-300 text-sm">{error}</span>
          <button
            type="button"
            data-testid="editor-error-dismiss"
            onClick={onErrorDismiss}
            aria-label="Fehler schliessen"
            className="text-red-400 hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}

      {suggestedGenre && !suggestionDismissed && (
        <div
          data-testid="preset-suggestion"
          className="absolute top-16 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2 bg-stone-900/90 border border-amber-300/50 backdrop-blur"
        >
          <span className="text-sm text-stone-200">
            Sieht aus wie <span className="text-amber-200">{suggestedGenre}</span> — Preset anwenden?
          </span>
          <button
            type="button"
            data-testid="preset-suggestion-apply"
            onClick={() => onApplySuggestion(suggestedGenre)}
            className="px-3 py-1 text-[10px] uppercase tracking-[0.18em] bg-amber-200/15 border border-amber-300 text-amber-200 hover:bg-amber-200/25"
          >
            Anwenden
          </button>
          <button
            type="button"
            data-testid="preset-suggestion-dismiss"
            onClick={onDismissSuggestion}
            className="text-stone-500 hover:text-stone-200"
            aria-label="Vorschlag wegklicken"
          >
            ✕
          </button>
        </div>
      )}

      {decoding && (
        <div
          data-testid="editor-decoding"
          className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-stone-900/80 border border-amber-300/30 backdrop-blur text-amber-200 text-sm"
          role="status"
          aria-live="polite"
        >
          <svg
            className="w-4 h-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
            <path d="M12 2 a 10 10 0 0 1 10 10" strokeLinecap="round" />
          </svg>
          RAW wird dekodiert …
        </div>
      )}

      {cameraInfo && (
        <p
          data-testid="editor-camera-info"
          className="absolute top-6 right-6 text-xs uppercase tracking-[0.2em] text-stone-500"
        >
          {cameraInfo}
        </p>
      )}
    </>
  );
}
