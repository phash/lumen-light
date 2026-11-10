import { describe, expect, test } from "vitest";

import { defaultAdjustments } from "../src/editor/adjustments";
import { parseProfileYaml, serializeProfileYaml } from "../src/editor/profileYaml";

describe("profileYaml", () => {
  test("Round-Trip erhaelt name/adjustments/masks/geometry", () => {
    const profile = {
      name: "Mein Look",
      adjustments: { ...defaultAdjustments(), contrast: 0.3 },
      masks: [],
      geometry: {
        crop: { x0: 0, y0: 0, x1: 1, y1: 1 },
        straightenAngle: 0,
        lensCorrection: null,
        lensProfileId: null,
        manualLensOverride: false,
      },
    };
    const text = serializeProfileYaml(profile);
    const parsed = parseProfileYaml(text);
    expect(parsed.name).toBe("Mein Look");
    expect(parsed.adjustments.contrast).toBe(0.3);
    expect(parsed.geometry?.crop).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  test("falsche Version wird abgelehnt", () => {
    expect(() => parseProfileYaml("lumenProfile: 99\nname: x\nadjustments: {}\n")).toThrow();
  });

  test("fehlender Name wird abgelehnt", () => {
    expect(() => parseProfileYaml("lumenProfile: 1\nadjustments: {}\n")).toThrow();
  });

  test("ungueltiges YAML liefert freundliche Fehlermeldung", () => {
    expect(() => parseProfileYaml("a: [1, 2\n")).toThrow("Ungültige YAML-Datei.");
  });

  test("Skalar- oder Array-Wurzel wird abgelehnt", () => {
    expect(() => parseProfileYaml("42")).toThrow();
    expect(() => parseProfileYaml("- lumenProfile: 1\n")).toThrow();
  });

  test("adjustments als Liste wird abgelehnt", () => {
    expect(() => parseProfileYaml("lumenProfile: 1\nname: x\nadjustments: []\n")).toThrow();
  });

  test("masks ohne Liste wird abgelehnt statt still verworfen", () => {
    expect(() =>
      parseProfileYaml("lumenProfile: 1\nname: x\nadjustments: {}\nmasks: x\n"),
    ).toThrow("Masken");
  });

  test("fehlende masks ergeben leere Liste", () => {
    expect(parseProfileYaml("lumenProfile: 1\nname: x\nadjustments: {}\n").masks).toEqual([]);
  });

  test("Alias-Bombe wirft statt zu haengen", () => {
    const bomb = [
      "lumenProfile: 1",
      "name: x",
      "a: &a [1,1,1,1,1,1,1,1,1]",
      "b: &b [*a,*a,*a,*a,*a,*a,*a,*a,*a]",
      "c: &c [*b,*b,*b,*b,*b,*b,*b,*b,*b]",
      "d: &d [*c,*c,*c,*c,*c,*c,*c,*c,*c]",
      "adjustments: {x: [*d,*d,*d,*d,*d,*d,*d,*d,*d]}",
    ].join("\n");
    expect(() => parseProfileYaml(bomb)).toThrow("Ungültige YAML-Datei.");
  });

  test("__proto__-Schluessel verschmutzt Object.prototype nicht", () => {
    const parsed = parseProfileYaml(
      "lumenProfile: 1\nname: x\nadjustments:\n  __proto__: {polluted: 1}\n",
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(parsed.adjustments)).toBe(Object.prototype);
  });
});
