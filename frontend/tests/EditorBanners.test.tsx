import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import EditorBanners from "../src/editor/EditorBanners";

const NOOP_PROPS = {
  error: null,
  onErrorDismiss: () => {},
  decoding: false,
  cameraInfo: null,
  suggestedGenre: null,
  suggestionDismissed: false,
  onApplySuggestion: () => {},
  onDismissSuggestion: () => {},
};

describe("EditorBanners", () => {
  it("rendert nichts wenn alle Banner inaktiv", () => {
    const { container } = render(<EditorBanners {...NOOP_PROPS} />);
    // Nur das Fragment-Wrapper-Markup, sonst leer.
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
  });

  it("Fehler-Banner zeigt Text + Dismiss-Button", async () => {
    const onDismiss = vi.fn();
    render(
      <EditorBanners
        {...NOOP_PROPS}
        error="Bild konnte nicht geladen werden"
        onErrorDismiss={onDismiss}
      />,
    );
    expect(screen.getByTestId("editor-error")).toHaveTextContent(
      "Bild konnte nicht geladen werden",
    );
    await userEvent.click(screen.getByTestId("editor-error-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("Decoding-Spinner ist ein role=status fuer Screenreader", () => {
    render(<EditorBanners {...NOOP_PROPS} decoding />);
    const el = screen.getByTestId("editor-decoding");
    expect(el).toHaveAttribute("role", "status");
    expect(el).toHaveAttribute("aria-live", "polite");
    expect(el).toHaveTextContent("RAW wird dekodiert");
  });

  it("Camera-Info zeigt Marke + Modell", () => {
    render(<EditorBanners {...NOOP_PROPS} cameraInfo="Canon EOS R5" />);
    expect(screen.getByTestId("editor-camera-info")).toHaveTextContent(
      "Canon EOS R5",
    );
  });

  it("Suggestion-Banner zeigt Genre, Apply ruft Callback mit Genre", async () => {
    const onApply = vi.fn();
    render(
      <EditorBanners
        {...NOOP_PROPS}
        suggestedGenre="Portrait"
        onApplySuggestion={onApply}
      />,
    );
    expect(screen.getByTestId("preset-suggestion")).toHaveTextContent(
      "Portrait",
    );
    await userEvent.click(screen.getByTestId("preset-suggestion-apply"));
    expect(onApply).toHaveBeenCalledWith("Portrait");
  });

  it("Suggestion-Banner verschwindet wenn dismissed", () => {
    render(
      <EditorBanners
        {...NOOP_PROPS}
        suggestedGenre="Portrait"
        suggestionDismissed
      />,
    );
    expect(screen.queryByTestId("preset-suggestion")).not.toBeInTheDocument();
  });

  it("Suggestion-Dismiss ruft Callback ohne Argument", async () => {
    const onDismiss = vi.fn();
    render(
      <EditorBanners
        {...NOOP_PROPS}
        suggestedGenre="Portrait"
        onDismissSuggestion={onDismiss}
      />,
    );
    await userEvent.click(screen.getByTestId("preset-suggestion-dismiss"));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("Mehrere Banner gleichzeitig (Decoding + Camera-Info) rendern alle", () => {
    render(
      <EditorBanners
        {...NOOP_PROPS}
        decoding
        cameraInfo="Sony A7"
      />,
    );
    expect(screen.getByTestId("editor-decoding")).toBeInTheDocument();
    expect(screen.getByTestId("editor-camera-info")).toBeInTheDocument();
  });
});
