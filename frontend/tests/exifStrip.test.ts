import { describe, expect, it } from "vitest";

import { stripJpegExifBytes } from "../src/api/exifStrip";

/**
 * Konstruiert ein minimales JPEG-Skelett mit konfigurierbaren Segmenten.
 * Jedes Segment ist [marker, lengthMSB, lengthLSB, ...payload]
 * — Length zaehlt die zwei Length-Bytes mit, also payload.length + 2.
 */
function jpeg(segments: Array<[number, Uint8Array]>): Uint8Array {
  const parts: number[] = [0xff, 0xd8]; // SOI
  for (const [marker, payload] of segments) {
    parts.push(0xff, marker);
    const len = payload.length + 2;
    parts.push((len >> 8) & 0xff, len & 0xff);
    for (const b of payload) parts.push(b);
  }
  // SOS-Header (zwei Bytes Payload, irrelevant) + Image-Stream + EOI.
  parts.push(0xff, 0xda, 0x00, 0x04, 0x00, 0x00);
  parts.push(0xab, 0xcd, 0xef);
  parts.push(0xff, 0xd9);
  return new Uint8Array(parts);
}

describe("stripJpegExifBytes", () => {
  it("entfernt APP1 (FFE1)", () => {
    const exifPayload = new Uint8Array(20).fill(0x42);
    const input = jpeg([
      [0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0x00])], // APP0/JFIF
      [0xe1, exifPayload], // APP1/EXIF
      [0xdb, new Uint8Array([0x10, 0x20])], // DQT
    ]);
    const out = stripJpegExifBytes(input);
    // APP1 darf nicht mehr drin sein
    let foundApp1 = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xe1) {
        foundApp1 = true;
        break;
      }
    }
    expect(foundApp1).toBe(false);
    // APP0 + DQT bleiben
    expect(Array.from(out.slice(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("entfernt auch APP2 (FFE2 — XMP/ICC)", () => {
    const xmp = new Uint8Array(15).fill(0x77);
    const input = jpeg([[0xe2, xmp]]);
    const out = stripJpegExifBytes(input);
    let foundApp2 = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xe2) {
        foundApp2 = true;
        break;
      }
    }
    expect(foundApp2).toBe(false);
  });

  it("ohne APPx-Segmente: gleicher Output", () => {
    const input = jpeg([[0xdb, new Uint8Array([0x01, 0x02])]]);
    const out = stripJpegExifBytes(input);
    expect(out.length).toBe(input.length);
  });

  it("Nicht-JPEG: unveraendert", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const out = stripJpegExifBytes(png);
    expect(out).toBe(png);
  });

  it("EOI-Marker bleibt erhalten", () => {
    const input = jpeg([[0xe1, new Uint8Array([0xaa, 0xbb])]]);
    const out = stripJpegExifBytes(input);
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
  });

  it("trunciertes Segment (Length ragt ueber den Puffer): unveraendert statt korrupt", () => {
    // APP1 deklariert Length 0x40 (64), aber nur 2 Payload-Bytes + Puffer-Ende.
    const truncated = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, 0x00, 0x40, 0x01, 0x02, // APP1, Length=64, aber Puffer endet
    ]);
    const out = stripJpegExifBytes(truncated);
    expect(Array.from(out)).toEqual(Array.from(truncated));
  });

  it("Fill-Bytes (0xFF) vor einem Marker: APP1 wird trotzdem korrekt entfernt", () => {
    const input = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, // legales Fill-Byte vor dem naechsten Marker
      0xff, 0xe1, 0x00, 0x04, 0xaa, 0xbb, // APP1
      0xff, 0xda, 0x00, 0x04, 0x00, 0x00, // SOS-Header
      0xab, 0xcd, 0xef, // Image-Stream
      0xff, 0xd9, // EOI
    ]);
    const out = stripJpegExifBytes(input);
    // APP1 muss weg sein
    let foundApp1 = false;
    for (let i = 0; i < out.length - 1; i++) {
      if (out[i] === 0xff && out[i + 1] === 0xe1) foundApp1 = true;
    }
    expect(foundApp1).toBe(false);
    // Stream + EOI intakt
    expect(out[out.length - 2]).toBe(0xff);
    expect(out[out.length - 1]).toBe(0xd9);
    expect(Array.from(out).includes(0xab)).toBe(true);
  });
});
