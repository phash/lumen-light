import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { useKeyboardShortcuts } from "../src/editor/useKeyboardShortcuts";

function Harness(props: Parameters<typeof useKeyboardShortcuts>[0]) {
  useKeyboardShortcuts(props);
  return <input data-testid="text" />;
}

describe("useKeyboardShortcuts", () => {
  it("0 -> onResetAll", () => {
    const onResetAll = vi.fn();
    render(<Harness onResetAll={onResetAll} />);
    fireEvent.keyDown(window, { key: "0" });
    expect(onResetAll).toHaveBeenCalledTimes(1);
  });

  it("\\ -> setBypass(true) on keydown, false on keyup", () => {
    const setBypass = vi.fn();
    render(<Harness setBypass={setBypass} />);
    fireEvent.keyDown(window, { key: "\\" });
    expect(setBypass).toHaveBeenCalledWith(true);
    fireEvent.keyUp(window, { key: "\\" });
    expect(setBypass).toHaveBeenCalledWith(false);
  });

  it("Cmd+E (oder Ctrl+E) -> onExport", () => {
    const onExport = vi.fn();
    render(<Harness onExport={onExport} />);
    fireEvent.keyDown(window, { key: "e", metaKey: true });
    expect(onExport).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "E", ctrlKey: true });
    expect(onExport).toHaveBeenCalledTimes(2);
  });

  it("Cmd+O -> onOpenFile", () => {
    const onOpenFile = vi.fn();
    render(<Harness onOpenFile={onOpenFile} />);
    fireEvent.keyDown(window, { key: "o", metaKey: true });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });

  it("ignoriert Tasten in Text-Inputs", () => {
    const onResetAll = vi.fn();
    const { getByTestId } = render(<Harness onResetAll={onResetAll} />);
    const input = getByTestId("text");
    input.focus();
    fireEvent.keyDown(input, { key: "0" });
    expect(onResetAll).not.toHaveBeenCalled();
  });
});
