import { GROUPS } from "./profileGroups";

interface Props {
  readonly enabled: ReadonlySet<string>;
  readonly onToggle: (key: string) => void;
}

/** Geteilte Schritt-Checkboxen (Editor + Library-Batch). crop/lens sind
 *  bildspezifisch — daher der Hinweis und default aus. */
export default function StepCheckboxes({ enabled, onToggle }: Props) {
  return (
    <div data-testid="step-checkboxes" className="space-y-1.5">
      {GROUPS.map((g) => {
        const isImageSpecific = g.key === "crop" || g.key === "lens";
        return (
          <label
            key={g.key}
            className="flex items-center gap-2 text-xs text-stone-300 cursor-pointer"
          >
            <input
              type="checkbox"
              data-testid={`step-${g.key}`}
              checked={enabled.has(g.key)}
              onChange={() => onToggle(g.key)}
              className="accent-amber-300"
            />
            <span>{g.label}</span>
            {isImageSpecific && (
              <span className="text-[10px] text-stone-500">(bildspezifisch)</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
