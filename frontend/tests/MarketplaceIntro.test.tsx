import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CONTENT } from "../src/i18n/content";
import MarketplaceIntro from "../src/pages/MarketplaceIntro";

describe("MarketplaceIntro", () => {
  it.each(["de", "en"] as const)("rendert Heading + Body — %s", (loc) => {
    render(<MarketplaceIntro lang={loc} />);
    expect(
      screen.getByRole("heading", { level: 1, name: CONTENT[loc].marketplace.heading }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("marketplace-intro").textContent).toContain(
      CONTENT[loc].marketplace.body.slice(0, 20),
    );
  });
});
