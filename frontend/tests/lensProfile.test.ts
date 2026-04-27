import { describe, expect, it } from "vitest";

import { DISTORTION_GAIN } from "../src/editor/lens";
import {
  type LensProfile,
  PROFILES,
  findLensProfile,
  profileToCorrection,
} from "../src/editor/lensProfile";

const SAMPLE: LensProfile[] = [
  { id: "x-wide", make: "Sony", modelMatch: "ILCE-7", focalMax: 35, k1: -0.2, vignette: 0.3 },
  { id: "x-tele", make: "Sony", modelMatch: "ILCE-7", focalMin: 80, k1: 0.05, vignette: 0.1 },
  { id: "x-mid", make: "Sony", modelMatch: "ILCE-7", focalMin: 35, focalMax: 80, k1: -0.05, vignette: 0.2 },
  { id: "fuji-wide", make: "Fujifilm", modelMatch: "X-Pro", focalMax: 24, k1: -0.22, vignette: 0.35 },
];

describe("findLensProfile", () => {
  it("matched bei korrektem make + Substring + focal in range", () => {
    const r = findLensProfile("Sony", "ILCE-7M3", 24, SAMPLE);
    expect(r.reason).toBe("matched");
    expect(r.profile?.id).toBe("x-wide");
  });

  it("focalMin grenzwertig: <80 -> mid, >=80 -> tele", () => {
    expect(findLensProfile("Sony", "ILCE-7M3", 79, SAMPLE).profile?.id).toBe("x-mid");
    expect(findLensProfile("Sony", "ILCE-7M3", 100, SAMPLE).profile?.id).toBe("x-tele");
  });

  it("Make wird case-insensitive verglichen", () => {
    const r = findLensProfile("sony", "ilce-7m3", 24, SAMPLE);
    expect(r.profile?.id).toBe("x-wide");
  });

  it("Fehlende make/model -> reason no-make/no-model", () => {
    expect(findLensProfile(null, "x", 50, SAMPLE).reason).toBe("no-make");
    expect(findLensProfile("Sony", null, 50, SAMPLE).reason).toBe("no-model");
  });

  it("kein Match -> reason no-match, profile null", () => {
    expect(findLensProfile("Hasselblad", "X1D", 50, SAMPLE).reason).toBe(
      "no-match",
    );
  });

  it("focalLen=null wird ignoriert (Profile mit Range matcht trotzdem)", () => {
    const noFocal = findLensProfile("Sony", "ILCE-7M3", null, SAMPLE);
    // Erstes Profil mit Sony+ILCE-7-Match gewinnt — hier x-wide
    expect(noFocal.profile?.id).toBe("x-wide");
  });
});

describe("profileToCorrection", () => {
  it("teilt k1 durch DISTORTION_GAIN", () => {
    const c = profileToCorrection({
      id: "p", make: "X", modelMatch: "Y", k1: -0.2, vignette: 0.3,
    });
    expect(c.distortion).toBeCloseTo(-0.2 / DISTORTION_GAIN, 5);
    expect(c.vignette).toBeCloseTo(0.3, 5);
  });

  it("klemmt extreme k1 auf [-1, 1]", () => {
    const c = profileToCorrection({
      id: "p", make: "X", modelMatch: "Y", k1: -2, vignette: 99,
    });
    expect(c.distortion).toBe(-1);
    expect(c.vignette).toBe(1);
  });
});

describe("Korpus-Profile (echte profiles.json)", () => {
  it("matched fuer alle Korpus-Files (Canon EOS 600D, EOS R, Sony ILCE-7M3, Nikon D7100, Fuji X-Pro1, Olympus E-M5, Panasonic DC-G9)", () => {
    const corpus = [
      { make: "Canon", model: "EOS 600D", focal: 25 },
      { make: "Canon", model: "EOS R", focal: 70 },
      { make: "Sony", model: "ILCE-7M3", focal: 32 },
      { make: "Nikon", model: "D7100", focal: 135 },
      { make: "Fujifilm", model: "X-Pro1", focal: 24 },
      { make: "Olympus", model: "E-M5", focal: 38 },
      { make: "Panasonic", model: "DC-G9", focal: 25 },
    ];
    for (const c of corpus) {
      const r = findLensProfile(c.make, c.model, c.focal, PROFILES);
      expect(r.reason, `${c.make} ${c.model} @${c.focal}`).toBe("matched");
    }
  });
});
