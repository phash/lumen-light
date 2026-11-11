import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { imageListParams } from "../src/api/client";
import { DEFAULT_FILTER } from "../src/library/FilterBar";
import { filterFromParams, filterToParams } from "../src/library/filterUrl";
import { setLibraryView } from "../src/library/viewPrefs";
import {
  IMG_A,
  locationSearch as search,
  makeFakeLibraryApi as makeFakeApi,
  renderLibraryAt as renderLibrary,
} from "./library-fakes";

beforeEach(() => setLibraryView("grid"));

describe("H2d Filter in der URL (reine Funktionen)", () => {
  it("leere URL ergibt den Default-Filter", () => {
    expect(filterFromParams(new URLSearchParams())).toEqual(DEFAULT_FILTER);
  });

  it("liest gueltige Werte", () => {
    const p = new URLSearchParams(
      "minRating=3&colorLabel=blue&colorLabel=none&colorLabel=red&flag=pick&sort=name_asc",
    );
    expect(filterFromParams(p)).toEqual({
      minRating: 3,
      // Reihenfolge normiert: Farben in Label-Reihenfolge, „ohne" zuletzt.
      colorLabels: ["red", "blue", "none"],
      flag: "pick",
      sort: "name_asc",
    });
  });

  it("ungueltige Werte fallen still auf Defaults zurueck", () => {
    const p = new URLSearchParams(
      "minRating=9&colorLabel=orange&colorLabel=red&colorLabel=red&flag=maybe&sort=-created_at",
    );
    expect(filterFromParams(p)).toEqual({ ...DEFAULT_FILTER, colorLabels: ["red"] });
    for (const bad of ["minRating=-1", "minRating=2.5", "minRating=x", "minRating="]) {
      expect(filterFromParams(new URLSearchParams(bad)).minRating).toBe(0);
    }
  });

  it("schreibt Defaults nicht in die URL und laesst fremde Parameter stehen", () => {
    expect(filterToParams(DEFAULT_FILTER, new URLSearchParams()).toString()).toBe("");
    const out = filterToParams(
      { minRating: 2, colorLabels: ["green", "none"], flag: "reject", sort: "rating_desc" },
      new URLSearchParams("foo=1&minRating=5&flag=pick"),
    );
    expect(out.toString()).toBe(
      "foo=1&minRating=2&colorLabel=green&colorLabel=none&flag=reject&sort=rating_desc",
    );
  });

  it("Rundreise URL -> Filter -> URL ist stabil", () => {
    const url = "minRating=1&colorLabel=yellow&flag=none&sort=created_asc";
    expect(filterToParams(filterFromParams(new URLSearchParams(url)), new URLSearchParams()).toString()).toBe(url);
  });

  it("API-Parameter kennen colorLabel=none", () => {
    expect(imageListParams({ colorLabels: ["none"] }).toString()).toBe("colorLabel=none");
  });
});

describe("H2d Bibliothek mit Filtern in der URL", () => {
  it("laedt mit den Filtern aus der URL und zeigt sie in der Leiste", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api, "/library?minRating=4&colorLabel=none&flag=pick&sort=rating_desc");
    await screen.findByTestId("image-tile-i-a");
    expect(api.listImages).toHaveBeenCalledTimes(1);
    expect(api.listImages).toHaveBeenLastCalledWith("ready", {
      minRating: 4,
      colorLabels: ["none"],
      flag: "pick",
      sort: "rating_desc",
    });
    expect(screen.getByTestId("filter-min-rating")).toHaveValue("4");
    expect(screen.getByTestId("filter-label-none")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("filter-flag")).toHaveValue("pick");
    expect(screen.getByTestId("filter-sort")).toHaveValue("rating_desc");
  });

  it("ungueltige URL-Werte ergeben still den Default", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api, "/library?minRating=99&flag=nope&sort=x&colorLabel=pink");
    await screen.findByTestId("image-tile-i-a");
    expect(api.listImages).toHaveBeenLastCalledWith("ready", {
      minRating: 0,
      colorLabels: [],
      flag: undefined,
      sort: "created_desc",
    });
    expect(screen.queryByTestId("library-error")).not.toBeInTheDocument();
  });

  it("Filter aendern schreibt die URL, Zuruecksetzen leert sie", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    await screen.findByTestId("image-tile-i-a");
    expect(search()).toBe("");

    await userEvent.selectOptions(screen.getByTestId("filter-min-rating"), "2");
    await waitFor(() => expect(search()).toBe("?minRating=2"));
    await userEvent.click(screen.getByTestId("filter-label-none"));
    await waitFor(() => expect(search()).toBe("?minRating=2&colorLabel=none"));
    await userEvent.selectOptions(screen.getByTestId("filter-sort"), "name_asc");
    await waitFor(() => expect(search()).toBe("?minRating=2&colorLabel=none&sort=name_asc"));
    expect(api.listImages).toHaveBeenLastCalledWith("ready", {
      minRating: 2,
      colorLabels: ["none"],
      flag: undefined,
      sort: "name_asc",
    });

    await userEvent.click(screen.getByTestId("filter-reset"));
    // Sortierung bleibt beim Zuruecksetzen (wie bisher).
    await waitFor(() => expect(search()).toBe("?sort=name_asc"));
    await userEvent.selectOptions(screen.getByTestId("filter-sort"), "created_desc");
    await waitFor(() => expect(search()).toBe(""));
  });

  it("Ansicht Raster/Liste landet nicht in der URL", async () => {
    renderLibrary(makeFakeApi([IMG_A]));
    await screen.findByTestId("image-tile-i-a");
    await userEvent.click(screen.getByTestId("library-view-list"));
    await screen.findByTestId("image-row-i-a");
    expect(search()).toBe("");
  });
});

describe("H2d Filter Ohne Label", () => {
  it("Button „Ohne Label“ schaltet den Filter und ist beschriftet", async () => {
    const api = makeFakeApi([IMG_A]);
    renderLibrary(api);
    await screen.findByTestId("image-tile-i-a");
    const btn = screen.getByTestId("filter-label-none");
    expect(btn).toHaveAccessibleName("Ohne Label");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(screen.getByTestId("filter-label-red"));
    await userEvent.click(btn);
    await waitFor(() =>
      expect(api.listImages).toHaveBeenLastCalledWith(
        "ready",
        expect.objectContaining({ colorLabels: ["red", "none"] }),
      ),
    );
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(btn);
    await waitFor(() =>
      expect(api.listImages).toHaveBeenLastCalledWith(
        "ready",
        expect.objectContaining({ colorLabels: ["red"] }),
      ),
    );
  });
});
