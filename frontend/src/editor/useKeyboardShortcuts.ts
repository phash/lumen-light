import { useEffect } from "react";

interface Shortcuts {
  readonly onResetAll?: () => void;
  readonly onExport?: () => void;
  readonly onOpenFile?: () => void;
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
