import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import ExportDialog from "../src/editor/ExportDialog";
import type { ExportFormat } from "../src/editor/export";

function props(overrides: Partial<Parameters<typeof ExportDialog>[0]> = {}) {
  return {
    canvasWidth: 4000,
    format: "jpeg" as ExportFormat,
    onFormatChange: vi.fn(),
    quality: 0.9,
    onQualityChange: vi.fn(),
    width: "native" as const,
    onWidthChange: vi.fn(),
    exporting: false,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("ExportDialog", () => {
  it("fokussiert beim Mount das Format-Select", () => {
    render(<ExportDialog {...props()} />);
    expect(document.activeElement).toBe(screen.getByTestId("export-format"));
  });

  it("Escape ruft onCancel und stoppt die Propagation", () => {
    const p = props();
    render(<ExportDialog {...p} />);
    const outer = vi.fn();
    window.addEventListener("keydown", outer);
    fireEvent.keyDown(screen.getByTestId("export-format"), { key: "Escape" });
    window.removeEventListener("keydown", outer);
    expect(p.onCancel).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("gibt den Fokus beim Schliessen an den Ausloeser zurueck", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="trigger" onClick={() => setOpen(true)}>
            Export
          </button>
          {open && <ExportDialog {...props({ onCancel: () => setOpen(false) })} />}
        </>
      );
    }
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");
    await userEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId("export-format"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByTestId("export-dialog")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("Breite und Qualitaet melden Aenderungen", () => {
    const p = props();
    render(<ExportDialog {...p} />);
    fireEvent.change(screen.getByTestId("export-width"), { target: { value: "1024" } });
    expect(p.onWidthChange).toHaveBeenCalledWith(1024);
    fireEvent.change(screen.getByTestId("export-width"), { target: { value: "native" } });
    expect(p.onWidthChange).toHaveBeenLastCalledWith("native");
    fireEvent.change(screen.getByTestId("export-quality"), { target: { value: "0.75" } });
    expect(p.onQualityChange).toHaveBeenCalledWith(0.75);
    fireEvent.change(screen.getByTestId("export-format"), { target: { value: "png" } });
    expect(p.onFormatChange).toHaveBeenCalledWith("png");
  });

  it("PNG blendet den Qualitaetsregler aus", () => {
    render(<ExportDialog {...props({ format: "png" })} />);
    expect(screen.queryByTestId("export-quality")).not.toBeInTheDocument();
  });
});
