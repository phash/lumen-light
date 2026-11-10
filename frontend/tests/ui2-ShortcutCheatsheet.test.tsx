import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ShortcutCheatsheet from "../src/editor/ShortcutCheatsheet";

describe("ShortcutCheatsheet", () => {
  it("weist auf das Abschalten der Einzeltasten-Kuerzel im Account hin", () => {
    render(<ShortcutCheatsheet open onClose={vi.fn()} />);
    expect(screen.getByTestId("shortcut-single-key-hint")).toHaveTextContent(
      /im Account unter „Tastenkürzel“ abschalten/,
    );
  });

  it("nennt Enter/Entf als Slider-Reset", () => {
    render(<ShortcutCheatsheet open onClose={vi.fn()} />);
    expect(screen.getByText("Enter / Entf")).toBeInTheDocument();
  });
});
