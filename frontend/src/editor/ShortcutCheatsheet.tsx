interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
}

interface Shortcut {
  readonly keys: string;
  readonly desc: string;
}

const SHORTCUTS: ReadonlyArray<{
  group: string;
  items: ReadonlyArray<Shortcut>;
}> = [
  {
    group: "Bild",
    items: [
      { keys: "Cmd/Ctrl + O", desc: "Datei öffnen" },
      { keys: "Cmd/Ctrl + E", desc: "Exportieren" },
      { keys: "0", desc: "Alle Slider zurücksetzen" },
      { keys: "\\", desc: "Original anzeigen (gedrückt halten)" },
    ],
  },
  {
    group: "Bearbeiten",
    items: [
      { keys: "Cmd/Ctrl + Z", desc: "Rückgängig" },
      { keys: "Cmd/Ctrl + Shift + Z", desc: "Wiederherstellen" },
      { keys: "Cmd/Ctrl + Y", desc: "Wiederherstellen (Win)" },
    ],
  },
  {
    group: "Modi",
    items: [
      { keys: "R", desc: "Beschneiden ein/aus" },
      { keys: "P", desc: "Preset-Dialog ein/aus" },
    ],
  },
  {
    group: "Slider",
    items: [
      { keys: "Doppelklick", desc: "Slider auf Default zurücksetzen" },
      { keys: "Mausrad über Bild", desc: "Zoom" },
      { keys: "Drag im Bild", desc: "Pan" },
    ],
  },
  {
    group: "Hilfe",
    items: [
      { keys: "?", desc: "Diese Hilfe anzeigen" },
    ],
  },
];

export default function ShortcutCheatsheet({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div
      data-testid="shortcut-cheatsheet"
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[420px] max-h-[80vh] overflow-y-auto bg-stone-900 border border-stone-700 text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
          <h2 className="text-stone-200">Tastenkürzel</h2>
          <button
            type="button"
            data-testid="shortcut-close"
            onClick={onClose}
            className="text-stone-500 hover:text-stone-200"
            aria-label="Schließen"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3 space-y-4">
          {SHORTCUTS.map((group) => (
            <section key={group.group}>
              <h3 className="text-[10px] uppercase tracking-[0.2em] text-stone-500 mb-2">
                {group.group}
              </h3>
              <ul className="space-y-1">
                {group.items.map((s) => (
                  <li
                    key={s.keys}
                    className="flex items-center justify-between gap-3 text-stone-300"
                  >
                    <span>{s.desc}</span>
                    <kbd className="font-mono text-xs px-2 py-0.5 bg-stone-950 border border-stone-700 text-stone-200">
                      {s.keys}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
