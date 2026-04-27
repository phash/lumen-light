import { useEffect } from "react";

interface Shortcuts {
  readonly onResetAll?: () => void;
  readonly onExport?: () => void;
  readonly onOpenFile?: () => void;
  readonly onToggleCrop?: () => void;
  readonly onTogglePresets?: () => void;
  readonly onShowHelp?: () => void;
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly setBypass?: (bypass: boolean) => void;
}

const isTextInput = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    target.isContentEditable
  );
};

export function useKeyboardShortcuts(shortcuts: Shortcuts): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextInput(e.target)) return;

      if (e.key === "0" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        shortcuts.onResetAll?.();
      } else if (e.key === "\\" && !e.repeat) {
        e.preventDefault();
        shortcuts.setBypass?.(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
        e.preventDefault();
        shortcuts.onExport?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        shortcuts.onOpenFile?.();
      } else if (e.key.toLowerCase() === "r" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        shortcuts.onToggleCrop?.();
      } else if (e.key.toLowerCase() === "p" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        shortcuts.onTogglePresets?.();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "z") {
        // Cmd+Shift+Z = Redo (Mac/Win-Konvention).
        e.preventDefault();
        shortcuts.onRedo?.();
      } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        shortcuts.onUndo?.();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        // Win-zusaetzlich: Ctrl+Y = Redo.
        e.preventDefault();
        shortcuts.onRedo?.();
      } else if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        shortcuts.onShowHelp?.();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "\\") {
        shortcuts.setBypass?.(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [shortcuts]);
}
