import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { useKeyboardShortcuts } from "../src/editor/useKeyboardShortcuts";

function Harness(props: Parameters<typeof useKeyboardShortcuts>[0] & { modal?: boolean }) {
  const { modal, ...shortcuts } = props;
  useKeyboardShortcuts(shortcuts);
  return (
    <div>
      <select data-testid="sel">
        <option>a</option>
      </select>
      {modal && <div role="dialog" aria-modal="true" data-testid="modal" />}
    </div>
  );
}

describe("useKeyboardShortcuts Haertung", () => {
  it("window blur setzt Bypass zurueck", () => {
    const setBypass = vi.fn();
    render(<Harness setBypass={setBypass} />);
    fireEvent.keyDown(window, { key: "\\" });
    fireEvent.blur(window);
    expect(setBypass).toHaveBeenLastCalledWith(false);
  });

  it("ignoriert Shortcuts in SELECT", () => {
    const onToggleCrop = vi.fn();
    const { getByTestId } = render(<Harness onToggleCrop={onToggleCrop} />);
    fireEvent.keyDown(getByTestId("sel"), { key: "r" });
    expect(onToggleCrop).not.toHaveBeenCalled();
  });

  it("ignoriert Shortcuts waehrend ein Modal offen ist", () => {
    const onToggleCrop = vi.fn();
    const onEscape = vi.fn();
    render(<Harness modal onToggleCrop={onToggleCrop} onEscape={onEscape} />);
    fireEvent.keyDown(window, { key: "r" });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onToggleCrop).not.toHaveBeenCalled();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("Escape ruft onEscape ohne Modal", () => {
    const onEscape = vi.fn();
    render(<Harness onEscape={onEscape} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("+ und - zoomen", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(<Harness onZoomIn={onZoomIn} onZoomOut={onZoomOut} />);
    fireEvent.keyDown(window, { key: "+" });
    fireEvent.keyDown(window, { key: "=" });
    fireEvent.keyDown(window, { key: "-" });
    expect(onZoomIn).toHaveBeenCalledTimes(2);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it("nutzt nach Rerender mit neuen Objekt-Literalen den neuesten Callback", () => {
    const stale = vi.fn();
    const { rerender } = render(<Harness onResetAll={stale} />);
    const latest = vi.fn();
    rerender(<Harness onResetAll={() => undefined} />);
    rerender(<Harness onResetAll={latest} />);
    fireEvent.keyDown(window, { key: "0" });
    // Genau ein Aufruf: kein doppelt abonnierter Listener, kein veralteter Callback.
    expect(latest).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });
});
