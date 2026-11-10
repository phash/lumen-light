import { beforeEach, describe, expect, it, vi } from "vitest";

const disposeSpy = vi.fn();
let failOpen = false;

vi.mock("libraw-wasm", () => ({
  default: class {
    open() {
      return failOpen ? Promise.reject(new Error("kaputt")) : Promise.resolve();
    }
    metadata() {
      return Promise.resolve({ width: 2, height: 1 });
    }
    imageData() {
      return Promise.resolve(new Uint8Array(6));
    }
    dispose() {
      disposeSpy();
    }
  },
}));

import { decodeRaw } from "../src/editor/raw";

function rawFile(): File {
  return new File([new Uint8Array(16)], "x.nef");
}

describe("decodeRaw gibt den LibRaw-Worker frei", () => {
  beforeEach(() => {
    disposeSpy.mockClear();
    failOpen = false;
  });

  it("dispose nach erfolgreichem Decode", async () => {
    const out = await decodeRaw(rawFile());
    expect(out.width).toBe(2);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it("dispose auch bei Fehler", async () => {
    failOpen = true;
    await expect(decodeRaw(rawFile())).rejects.toThrow("kaputt");
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
