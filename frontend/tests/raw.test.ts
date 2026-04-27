import { describe, expect, it } from "vitest";

import { detectRawFormat, readFileHeader } from "../src/editor/raw";

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function ascii(s: string): Uint8Array {
  return new Uint8Array(Array.from(s, (c) => c.charCodeAt(0)));
}

describe("detectRawFormat", () => {
  it("erkennt Fuji RAF an der ASCII-Signatur", () => {
    expect(detectRawFormat("foo.raf", ascii("FUJIFILMCCD-RAW"))).toBe("raf");
    // Auch wenn die Endung anders waere — Magic-Byte gewinnt
    expect(detectRawFormat("foo.bin", ascii("FUJIFILMCCD-RAW"))).toBe("raf");
  });

  it("erkennt Canon CR3 an ftyp/crx Brand", () => {
    const header = new Uint8Array(16);
    // Bytes 0-3: irgendwas (Box-Size), 4-7: 'ftyp', 8-11: 'crx '
    header.set(ascii("ftyp"), 4);
    header.set(ascii("crx "), 8);
    expect(detectRawFormat("anything", header)).toBe("cr3");
  });

  it("erkennt TIFF-basierte Formate ueber Endung", () => {
    const dummy = bytes(0, 0, 0, 0);
    expect(detectRawFormat("IMG_0001.cr2", dummy)).toBe("cr2");
    expect(detectRawFormat("DSC_0042.NEF", dummy)).toBe("nef");
    expect(detectRawFormat("DSC00007.arw", dummy)).toBe("arw");
    expect(detectRawFormat("foto.dng", dummy)).toBe("dng");
    expect(detectRawFormat("foto.RW2", dummy)).toBe("rw2");
    expect(detectRawFormat("foto.orf", dummy)).toBe("orf");
  });

  it("liefert null bei unbekannten Endungen ohne Magic", () => {
    expect(detectRawFormat("foto.jpg", bytes(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
    expect(detectRawFormat("foto.png", bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
    expect(detectRawFormat("foto.txt", bytes(0, 0, 0, 0))).toBeNull();
  });

  it("ist tolerant bei kurzen Headern", () => {
    expect(detectRawFormat("foto.cr2", new Uint8Array(0))).toBe("cr2");
    expect(detectRawFormat("foto.bin", new Uint8Array(2))).toBeNull();
  });
});

describe("readFileHeader", () => {
  it("liest die ersten n Bytes", async () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const blob = new Blob([data]);
    const file = new File([blob], "test.bin");
    const head = await readFileHeader(file, 4);
    expect(Array.from(head)).toEqual([1, 2, 3, 4]);
  });

  it("ist tolerant bei kleinen Dateien", async () => {
    const file = new File([new Uint8Array([1, 2])], "tiny.bin");
    const head = await readFileHeader(file, 32);
    expect(head.length).toBe(2);
  });
});
