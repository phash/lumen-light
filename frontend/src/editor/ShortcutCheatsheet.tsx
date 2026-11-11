import Modal from "../components/Modal";

interface Props {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Wo die Hilfe geoeffnet wird: im Editor liegt sie im (relativen)
   *  Editor-Container, in der Bibliothek ueber der ganzen Seite und mit
   *  dem Abschnitt „Bibliothek" zuerst. */
  readonly context?: "editor" | "library";
}

interface Shortcut {
  readonly keys: string;
  readonly desc: string;
}

interface ShortcutGroup {
  readonly group: string;
  readonly items: ReadonlyArray<Shortcut>;
}

/** H2c/H2d: Lighttable (Raster/Liste + Lupe). Einzeltasten nur bei aktiven
 *  Einzeltasten-Kuerzeln; jede Aktion hat auch einen Button. */
const LIBRARY_SHORTCUTS: ShortcutGroup = {
  group: "Bibliothek",
  items: [
    { keys: "← → ↑ ↓", desc: "Im Raster bewegen (Liste: ↑ ↓)" },
    { keys: "Leertaste", desc: "Bild auswählen (Raster/Liste)" },
    { keys: "Enter", desc: "Lupe öffnen" },
    { keys: "← / →", desc: "In der Lupe blättern" },
    { keys: "Z", desc: "Lupe: Zoom 1:1 ein/aus" },
    { keys: "0 – 5", desc: "Sterne setzen (0 = keine)" },
    { keys: "6 / 7 / 8 / 9", desc: "Label Rot / Gelb / Grün / Blau" },
    { keys: "P", desc: "Als ausgewählt markieren" },
    { keys: "X", desc: "Als abgelehnt markieren" },
    { keys: "U", desc: "Markierung entfernen" },
    { keys: "E", desc: "Im Editor öffnen" },
    { keys: "C", desc: "Zwei ausgewählte Bilder vergleichen" },
    { keys: "Esc", desc: "Zoom verlassen, sonst Lupe / Vergleich schließen" },
  ],
};

const EDITOR_SHORTCUTS: ReadonlyArray<ShortcutGroup> = [
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
      { keys: "Esc", desc: "Beschneiden / WB-Picker verlassen" },
    ],
  },
  {
    group: "Slider",
    items: [
      { keys: "Doppelklick", desc: "Slider auf Default zurücksetzen" },
      { keys: "Enter / Entf", desc: "Fokussierten Slider auf Default zurücksetzen" },
      { keys: "← / →", desc: "Fokussierten Slider in kleinen Schritten ändern" },
      { keys: "Shift + ← / →", desc: "Fokussierten Slider in großen Schritten ändern" },
      { keys: "Pos1 / Ende", desc: "Slider auf Minimum / Maximum" },
      { keys: "Mausrad über Bild", desc: "Zoom" },
      { keys: "+ / −", desc: "Hinein- / Herauszoomen" },
      { keys: "Drag im Bild", desc: "Pan" },
      { keys: "Shift + Pfeiltasten", desc: "Pan (Bildansicht fokussiert)" },
    ],
  },
  {
    group: "Hilfe",
    items: [
      { keys: "?", desc: "Diese Hilfe anzeigen" },
    ],
  },
];

export default function ShortcutCheatsheet({ open, onClose, context = "editor" }: Props) {
  if (!open) return null;
  const groups =
    context === "library"
      ? [LIBRARY_SHORTCUTS, ...EDITOR_SHORTCUTS]
      : [...EDITOR_SHORTCUTS, LIBRARY_SHORTCUTS];
  return (
    <Modal
      onClose={onClose}
      testId="shortcut-cheatsheet"
      labelledBy="shortcut-cheatsheet-title"
      backdropClassName={`${context === "library" ? "fixed" : "absolute"} inset-0 z-50 flex items-center justify-center bg-black/60 p-4`}
      cardClassName="w-full max-w-[420px] max-h-[80vh] overflow-y-auto bg-stone-900 border border-stone-700 text-sm"
    >
      <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
        <h2 id="shortcut-cheatsheet-title" className="text-stone-200">Tastenkürzel</h2>
        <button
          type="button"
          data-testid="shortcut-close"
          onClick={onClose}
          className="text-stone-400 hover:text-stone-200"
          aria-label="Schließen"
        >
          ✕
        </button>
      </div>
      <div className="px-4 py-3 space-y-4">
        <p
          data-testid="shortcut-single-key-hint"
          className="text-xs text-stone-400"
        >
          Einzeltasten-Kürzel (Ziffern, Buchstaben, \, +, −, ?) kannst du im Account
          unter „Tastenkürzel“ abschalten.
        </p>
        {groups.map((group) => (
          <section key={group.group}>
            <h3 className="text-[10px] uppercase tracking-[0.2em] text-stone-400 mb-2">
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
    </Modal>
  );
}
