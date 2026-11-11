/**
 * H2c: Vergleich — genau zwei ausgewaehlte Bilder nebeneinander (schmal:
 * untereinander), jedes mit eigenen Sternen/Markierung/Farblabel.
 * Esc schliesst (Modal), der Fokus kehrt zum Ausloeser zurueck.
 */
import type { ReactNode } from "react";

import type { Image, ImageMetaPatch } from "../api/client";
import Modal from "../components/Modal";
import { ColorLabelPicker, FlagButtons, StarRating } from "./MetaControls";
import PreviewImage, { previewSrc } from "./PreviewImage";
import { metaOf } from "./meta";

export interface CompareViewProps {
  readonly images: readonly [Image, Image];
  readonly onClose: () => void;
  readonly onMetaChange: (id: string, patch: ImageMetaPatch) => void;
  readonly onOpenEditor: (id: string) => void;
  readonly liveRegion?: ReactNode;
}

function Pane({
  image,
  onMetaChange,
  onOpenEditor,
}: {
  readonly image: Image;
  readonly onMetaChange: (id: string, patch: ImageMetaPatch) => void;
  readonly onOpenEditor: (id: string) => void;
}) {
  const meta = metaOf(image);
  const tid = `compare-${image.id}`;
  const change = (patch: ImageMetaPatch) => onMetaChange(image.id, patch);
  return (
    <section
      data-testid={tid}
      aria-label={image.originalFilename}
      className="flex min-h-0 min-w-0 flex-col border border-stone-800"
    >
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/40 p-2">
        <PreviewImage key={previewSrc(image) ?? image.id} image={image} testId={tid} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-stone-800 px-3 py-2 text-sm">
        <span className="w-full truncate text-stone-200 sm:w-auto sm:flex-1" title={image.originalFilename}>
          {image.originalFilename}
        </span>
        <StarRating value={meta.rating} testId={tid} onChange={change} />
        <FlagButtons value={meta.flag} testId={tid} onChange={change} />
        <ColorLabelPicker value={meta.colorLabel} testId={tid} onChange={change} />
        <button
          type="button"
          data-testid={`${tid}-edit`}
          onClick={() => onOpenEditor(image.id)}
          aria-label={`„${image.originalFilename}“ im Editor öffnen`}
          className="text-xs text-amber-200 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
        >
          Bearbeiten
        </button>
      </div>
    </section>
  );
}

export default function CompareView({
  images,
  onClose,
  onMetaChange,
  onOpenEditor,
  liveRegion,
}: CompareViewProps) {
  return (
    <Modal
      onClose={onClose}
      testId="compare"
      cardTestId="compare-dialog"
      labelledBy="compare-title"
      closeOnBackdrop={false}
      backdropClassName="fixed inset-0 z-50 bg-stone-950"
      cardClassName="h-full w-full outline-none"
    >
      <div className="flex h-full flex-col text-stone-200">
        <div className="flex items-center gap-3 border-b border-stone-800 px-4 py-2">
          <h2 id="compare-title" className="flex-1 text-sm">
            Vergleich
          </h2>
          <button
            type="button"
            data-testid="compare-close"
            onClick={onClose}
            aria-label="Vergleich schließen"
            title="Schließen (Esc)"
            className="px-2 py-1 text-stone-400 hover:text-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
          >
            ✕
          </button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-2 p-2 sm:grid-cols-2 sm:grid-rows-1 sm:gap-4 sm:p-4">
          {images.map((img) => (
            <Pane key={img.id} image={img} onMetaChange={onMetaChange} onOpenEditor={onOpenEditor} />
          ))}
        </div>
        {liveRegion}
      </div>
    </Modal>
  );
}
