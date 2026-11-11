import { useState } from "react";

import type { Image } from "../api/client";

/** H2c: grosse Vorschau fuer Lupe und Vergleich. `previewUrl` (1600 px),
 *  sonst `thumbUrl` (400 px), sonst ein Platzhalter-Text. Laedt die URL
 *  nicht (abgelaufen), faellt sie auf den Platzhalter zurueck. Der Aufrufer
 *  setzt `key` auf die URL, damit ein Bildwechsel den Fehlerzustand
 *  zuruecksetzt. */
export function previewSrc(image: Image): string | null {
  return image.previewUrl ?? image.thumbUrl ?? null;
}

export default function PreviewImage({
  image,
  testId,
}: {
  readonly image: Image;
  readonly testId: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = previewSrc(image);
  if (!src || broken) {
    return (
      <p
        data-testid={`${testId}-placeholder`}
        className="max-w-xs px-4 text-center text-sm text-stone-400"
      >
        Noch keine Vorschau – öffne das Bild einmal im Editor, um eine zu erzeugen.
      </p>
    );
  }
  return (
    <img
      data-testid={`${testId}-image`}
      src={src}
      alt={image.originalFilename}
      decoding="async"
      onError={() => setBroken(true)}
      className="max-h-full max-w-full object-contain"
    />
  );
}
