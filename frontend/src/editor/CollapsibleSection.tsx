import { useState } from "react";

interface Props {
  readonly id: string;
  readonly title: string;
  readonly defaultOpen?: boolean;
  readonly testId?: string;
  readonly children: React.ReactNode;
}

const STORAGE_PREFIX = "lumen.section.";

/**
 * Sidebar-Sektion mit klappbarem Header. Persistiert den
 * Open/Closed-State pro Section-id im localStorage, damit der User
 * seine Praeferenz behaelt. Defaults bestimmen die Reihenfolge im
 * Editor (Geometrie+Objektiv collapsed-default).
 */
export default function CollapsibleSection({
  id,
  title,
  defaultOpen = true,
  testId,
  children,
}: Props) {
  const storageKey = STORAGE_PREFIX + id;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch {
      /* localStorage unavailable */
    }
    return defaultOpen;
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      /* localStorage unavailable */
    }
  };

  return (
    <div className="mb-5" data-testid={testId}>
      <button
        type="button"
        onClick={toggle}
        data-testid={testId ? `${testId}-toggle` : undefined}
        className="w-full flex items-center gap-2 mb-2 text-left"
        aria-expanded={open}
      >
        <span className="text-stone-300 italic">{title}</span>
        <div className="flex-1 h-px bg-stone-800" />
        <span
          className="text-stone-500 text-xs"
          aria-hidden="true"
        >
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && children}
    </div>
  );
}
