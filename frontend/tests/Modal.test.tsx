import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Modal from "../src/components/Modal";

describe("Modal", () => {
  it("rendert role=dialog mit aria-modal und aria-labelledby", () => {
    render(
      <Modal onClose={() => {}} testId="m" labelledBy="t">
        <h2 id="t">Titel</h2>
        <button>OK</button>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "t");
  });

  it("schliesst bei Escape", async () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} testId="m" ariaLabel="Test">
        <button>OK</button>
      </Modal>,
    );
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("schliesst bei Klick auf den Backdrop, nicht auf den Karteninhalt", async () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} testId="backdrop" ariaLabel="Test">
        <button>Inhalt</button>
      </Modal>,
    );
    await userEvent.click(screen.getByText("Inhalt"));
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId("backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stellt den Fokus beim Schliessen auf das ausloesende Element zurueck", async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button data-testid="opener" onClick={() => setOpen(true)}>
            Öffnen
          </button>
          {open && (
            <Modal onClose={() => setOpen(false)} testId="m" ariaLabel="Test">
              <button data-testid="inside">Drin</button>
            </Modal>
          )}
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByTestId("opener");
    await userEvent.click(opener);
    expect(screen.getByTestId("inside")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(opener);
  });
});
