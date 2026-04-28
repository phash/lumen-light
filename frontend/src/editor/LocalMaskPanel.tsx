import {
  LOCAL_ADJUSTMENT_LIMITS,
  type LocalAdjustments,
  type MaskInstance,
} from "./mask";

const LABELS: Record<keyof LocalAdjustments, string> = {
  exposure: "Belichtung",
  contrast: "Kontrast",
  saturation: "Sättigung",
  temperature: "Temperatur",
};

interface Props {
  readonly mask: MaskInstance;
  readonly onLocalAdjust: (key: keyof LocalAdjustments, value: number) => void;
  readonly onFeather: (feather: number) => void;
  readonly onRemove: () => void;
}

/**
 * Sidebar-Sektion fuer die lokalen Slider einer selektierten Maske.
 * Generic ueber Linear- und Radial-Masken — die Daten kommen via Prop,
 * der Typ entscheidet ueber Header-Text + testid-Praefix.
 */
export default function LocalMaskPanel({
  mask,
  onLocalAdjust,
  onFeather,
  onRemove,
}: Props) {
  const isLinear = mask.type === "linear";
  const sectionTestId = isLinear ? "local-mask-section" : "radial-mask-section";
  const sliderPrefix = isLinear ? "local" : "radial";
  const headerText = isLinear ? "Lokal · Verlauf" : "Lokal · Radial";
  const removeText = isLinear ? "Verlauf entfernen" : "Radial entfernen";
  const removeTestId = isLinear ? "editor-reset-mask" : "editor-reset-radial";

  return (
    <div className="mb-5" data-testid={sectionTestId}>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-stone-300 italic">{headerText}</span>
        <div className="flex-1 h-px bg-stone-800" />
      </div>
      {(["exposure", "contrast", "saturation", "temperature"] as const).map((key) => {
        const [min, max] = LOCAL_ADJUSTMENT_LIMITS[key];
        const value = mask.localAdj[key];
        return (
          <label key={key} className="block py-1.5">
            <span className="text-[11px] uppercase tracking-wider text-stone-400">
              {LABELS[key]} (
              {key === "exposure" ? value.toFixed(2) : Math.round(value * 100)})
            </span>
            <input
              type="range"
              min={min}
              max={max}
              step={key === "exposure" ? 0.05 : 0.01}
              value={value}
              onChange={(e) => onLocalAdjust(key, Number(e.target.value))}
              onDoubleClick={() => onLocalAdjust(key, 0)}
              data-testid={`${sliderPrefix}-${key}-slider`}
              className="mt-1 w-full"
            />
          </label>
        );
      })}
      <label className="block py-1.5">
        <span className="text-[11px] uppercase tracking-wider text-stone-400">
          Übergang ({Math.round(mask.mask.feather * 100)})
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={mask.mask.feather}
          onChange={(e) => onFeather(Number(e.target.value))}
          onDoubleClick={() => onFeather(0)}
          data-testid={`${sliderPrefix}-feather-slider`}
          className="mt-1 w-full"
        />
      </label>
      <button
        type="button"
        onClick={onRemove}
        data-testid={removeTestId}
        className="w-full mt-2 py-1.5 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40"
      >
        {removeText}
      </button>
    </div>
  );
}
