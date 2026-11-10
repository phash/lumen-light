import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { usePageMeta } from "../src/hooks/usePageMeta";
import Datenschutz from "../src/pages/Datenschutz";
import Impressum from "../src/pages/Impressum";

function Probe({ title, lang }: { title: string; lang?: "de" | "en" }) {
  usePageMeta(title, lang);
  return null;
}

afterEach(() => {
  document.documentElement.lang = "de";
});

describe("usePageMeta", () => {
  it("lang=en setzt documentElement.lang und den Titel", () => {
    render(<Probe title="Hello" lang="en" />);
    expect(document.documentElement.lang).toBe("en");
    expect(document.title).toBe("Hello");
  });

  it("Default-Sprache ist de", () => {
    document.documentElement.lang = "en";
    render(<Probe title="Hallo" />);
    expect(document.documentElement.lang).toBe("de");
  });

  it("Datenschutz und Impressum setzen eigene Titel", () => {
    const { unmount } = render(<Datenschutz />, { wrapper: MemoryRouter });
    expect(document.title).toMatch(/^Datenschutz/);
    unmount();
    render(<Impressum />, { wrapper: MemoryRouter });
    expect(document.title).toMatch(/^Impressum/);
    expect(document.documentElement.lang).toBe("de");
  });
});
