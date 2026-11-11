import { useState } from "react";

/** Kurzes Typ-Kuerzel fuer den Platzhalter (JPG, PNG, TIFF, RAW). */
export function typeBadge(contentType: string): string {
  if (contentType === "image/jpeg") return "JPG";
  if (contentType === "image/png") return "PNG";
  if (contentType === "image/tiff") return "TIFF";
  if (contentType.startsWith("image/x-")) return "RAW";
  return "BILD";
}

/** H2a/H2b: Vorschaubild. Dekorativ (alt=""), der Dateiname steht daneben.
 *  Platzhalter mit Dateityp, wenn keine Vorschau existiert oder die
 *  signierte URL nicht (mehr) laedt.
 *  - `row`: 48-px-Quadrat in der Listenzeile (beschnitten).
 *  - `tile`: Passepartout der Raster-Kachel; das Bild wird NICHT beschnitten
 *    (object-contain), damit Hoch-/Querformat beim Sichten ehrlich bleiben. */
export default function ImageThumb({
  id,
  url,
  contentType,
  variant = "row",
  dimmed = false,
}: {
  readonly id: string;
  readonly url: string | null;
  readonly contentType: string;
  readonly variant?: "row" | "tile";
  readonly dimmed?: boolean;
}) {
  const [broken, setBroken] = useState(false);
  const box =
    variant === "row"
      ? "h-12 w-12 shrink-0 border border-stone-800 bg-stone-900"
      : "h-full w-full";
  if (!url || broken) {
    return (
      <div
        data-testid={`image-thumb-placeholder-${id}`}
        aria-hidden="true"
        className={`${box} flex items-center justify-center tracking-[0.15em] text-stone-500 ${
          variant === "row" ? "text-[10px]" : "text-xs"
        }`}
      >
        {typeBadge(contentType)}
      </div>
    );
  }
  return (
    <img
      data-testid={`image-thumb-${id}`}
      src={url}
      alt=""
      loading="lazy"
      decoding="async"
      width={variant === "row" ? 48 : 400}
      height={variant === "row" ? 48 : 300}
      onError={() => setBroken(true)}
      className={`${box} ${variant === "row" ? "object-cover" : "object-contain"} transition-[opacity,filter] ${
        dimmed ? "opacity-35 grayscale" : ""
      }`}
    />
  );
}
