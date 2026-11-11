/**
 * H1b · decodeRaw mit 16 bit: Optionen (camelCase — libraw-wasm liest nur
 * diese), Pixel-Typ, Laengenpruefung, dispose.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const openSpy = vi.fn();
const disposeSpy = vi.fn();
let result: unknown = null;

vi.mock("libraw-wasm", () => ({
  default: class {
    open(_buf: Uint8Array, settings: unknown) {
      openSpy(settings);
      return Promise.resolve();
    }
    metadata() {
      return Promise.resolve({ width: 2, height: 1, camera_make: "Sony" });
    }
    imageData() {
      return Promise.resolve(result);
    }
    dispose() {
      disposeSpy();
    }
  },
}));

import { decodeRaw } from "../src/editor/raw";

function rawFile(): File {
  return new File([new Uint8Array(16)], "x.arw");
}

describe("decodeRaw 16 bit", () => {
  beforeEach(() => {
    openSpy.mockClear();
    disposeSpy.mockClear();
  });

  it("fordert outputBps 16 an und liefert Uint16-Pixel", async () => {
    const data = new Uint16Array([1, 2, 3, 65535, 0, 256]);
    result = { width: 2, height: 1, bits: 16, colors: 3, data };
    const out = await decodeRaw(rawFile());
    expect(openSpy).toHaveBeenCalledWith({ outputBps: 16 });
    expect(out.pixels.bits).toBe(16);
    expect(out.pixels.rgb).toBe(data);
    expect(out.width).toBe(2);
    expect(out.cameraMake).toBe("Sony");
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("bits 8 fordert outputBps 8 an (alter Pfad)", async () => {
    result = { width: 2, height: 1, bits: 8, colors: 3, data: new Uint8Array(6) };
    const out = await decodeRaw(rawFile(), { bits: 8 });
    expect(openSpy).toHaveBeenCalledWith({ outputBps: 8 });
    expect(out.pixels.bits).toBe(8);
  });

  it("keine wirkungslosen snake_case-Optionen mehr", async () => {
    result = { width: 2, height: 1, data: new Uint16Array(6) };
    await decodeRaw(rawFile());
    const settings = openSpy.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(settings).some((k) => k.includes("_"))).toBe(false);
  });

  it("liefert die Bibliothek trotz 16-bit-Wunsch 8 bit, gilt 8 bit", async () => {
    result = new Uint8Array(6);
    const out = await decodeRaw(rawFile());
    expect(out.pixels.bits).toBe(8);
  });

  it("falsche Laenge wirft und gibt den Worker frei", async () => {
    result = { width: 2, height: 1, data: new Uint16Array(5) };
    await expect(decodeRaw(rawFile())).rejects.toThrow(/erwartet/);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
