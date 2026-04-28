import { describe, expect, it } from "vitest";

import { suggestGenre } from "../src/editor/suggestPreset";

describe("suggestGenre", () => {
  it("Tele 300mm + Gruendominant -> Tiere", () => {
    expect(
      suggestGenre({ focalLen: 300, meanR: 0.4, meanG: 0.55, meanB: 0.4, p500: 0.5 }),
    ).toBe("Tiere");
  });

  it("Tele 300mm + neutral -> Sport", () => {
    expect(
      suggestGenre({ focalLen: 300, meanR: 0.5, meanG: 0.5, meanB: 0.5, p500: 0.5 }),
    ).toBe("Sport");
  });

  it("Weitwinkel 24mm + blau-grau -> Stadt", () => {
    expect(
      suggestGenre({ focalLen: 24, meanR: 0.45, meanG: 0.5, meanB: 0.55, p500: 0.5 }),
    ).toBe("Stadt");
  });

  it("Weitwinkel 18mm + warm/saturiert -> Landschaft", () => {
    expect(
      suggestGenre({ focalLen: 18, meanR: 0.5, meanG: 0.6, meanB: 0.45, p500: 0.5 }),
    ).toBe("Landschaft");
  });

  it("85mm + Hauttoebereich + roetlich -> Portrait", () => {
    expect(
      suggestGenre({ focalLen: 85, meanR: 0.6, meanG: 0.55, meanB: 0.5, p500: 0.55 }),
    ).toBe("Portrait");
  });

  it("Stark gruen ohne klare Brennweite -> Natur", () => {
    expect(
      suggestGenre({ focalLen: 50, meanR: 0.4, meanG: 0.55, meanB: 0.4, p500: 0.45 }),
    ).toBe("Natur");
  });

  it("ohne Match -> null (keine Empfehlung lieber als falsche)", () => {
    expect(
      suggestGenre({ focalLen: null, meanR: 0.5, meanG: 0.5, meanB: 0.5, p500: 0.5 }),
    ).toBeNull();
  });

  // ---------- Face-Detection (E4) ----------

  it("faceCount >= 1 ueberschreibt heuristische Tele-Logik -> Portrait", () => {
    expect(
      suggestGenre({
        focalLen: 300,
        meanR: 0.5,
        meanG: 0.5,
        meanB: 0.5,
        p500: 0.5,
        faceCount: 1,
      }),
    ).toBe("Portrait");
  });

  it("faceCount=0 verhaelt sich wie alte Heuristik", () => {
    const r1 = suggestGenre({
      focalLen: 24,
      meanR: 0.45,
      meanG: 0.5,
      meanB: 0.55,
      p500: 0.5,
      faceCount: 0,
    });
    const r2 = suggestGenre({
      focalLen: 24,
      meanR: 0.45,
      meanG: 0.5,
      meanB: 0.55,
      p500: 0.5,
    });
    expect(r1).toBe(r2);
  });

  it("faceCount >= 1 ohne Brennweite -> Portrait (greift bei JPEG ohne EXIF)", () => {
    expect(
      suggestGenre({
        focalLen: null,
        meanR: 0.5,
        meanG: 0.5,
        meanB: 0.5,
        p500: 0.5,
        faceCount: 2,
      }),
    ).toBe("Portrait");
  });
});
