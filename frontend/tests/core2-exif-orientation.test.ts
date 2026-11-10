import { describe, expect, it } from "vitest";

import { stripJpegExifBytes } from "../src/api/exifStrip";

type ByteOrder = "II" | "MM";

interface IfdEntry {
  readonly tag: number;
  readonly type: number;
  readonly count: number;
  /** Rohe 4 Wert-Bytes (inline oder Offset). */
  readonly value: Uint8Array;
}

/** Baut einen TIFF-Block mit IFD0 (Eintraege inline, 4 Byte Wert). */
function tiff(order: ByteOrder, entries: ReadonlyArray<IfdEntry>): Uint8Array {
  const size = 8 + 2 + entries.length * 12 + 4;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  const le = order === "II";
  buf[0] = order.charCodeAt(0);
  buf[1] = order.charCodeAt(1);
  dv.setUint16(2, 42, le);
  dv.setUint32(4, 8, le);
  dv.setUint16(8, entries.length, le);
  entries.forEach((e, i) => {
    const off = 10 + i * 12;
    dv.setUint16(off, e.tag, le);
    dv.setUint16(off + 2, e.type, le);
    dv.setUint32(off + 4, e.count, le);
    buf.set(e.value, off + 8);
  });
  dv.setUint32(10 + entries.length * 12, 0, le);
  return buf;
}

function shortValue(order: ByteOrder, v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint16(0, v, order === "II");
  return b;
}

function longValue(order: ByteOrder, v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, order === "II");
  return b;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];

function exifApp1(order: ByteOrder, orientation: number | null): Uint8Array {
  const entries: IfdEntry[] = [
    // Make (ASCII, 4 Byte inline: "Foo\0")
    { tag: 0x010f, type: 2, count: 4, value: new Uint8Array([0x46, 0x6f, 0x6f, 0x00]) },
  ];
  if (orientation !== null) {
    entries.push({ tag: 0x0112, type: 3, count: 1, value: shortValue(order, orientation) });
  }
  // GPS-IFD-Pointer (Zielinhalt egal — Test prueft nur, dass er verschwindet).
  entries.push({ tag: 0x8825, type: 4, count: 1, value: longValue(order, 0x1234) });
  return new Uint8Array([...EXIF_HEADER, ...tiff(order, entries)]);
}

function jpeg(segments: Array<[number, Uint8Array]>): Uint8Array {
  const parts: number[] = [0xff, 0xd8];
  for (const [marker, payload] of segments) {
    const len = payload.length + 2;
    parts.push(0xff, marker, (len >> 8) & 0xff, len & 0xff, ...payload);
  }
  parts.push(0xff, 0xda, 0x00, 0x04, 0x00, 0x00, 0xab, 0xcd, 0xef, 0xff, 0xd9);
  return new Uint8Array(parts);
}

interface Segment {
  readonly marker: number;
  readonly payload: Uint8Array;
}

/** Liest die Segmente bis SOS. */
function segments(bytes: Uint8Array): Segment[] {
  const out: Segment[] = [];
  let i = 2;
  while (i + 4 <= bytes.length) {
    expect(bytes[i]).toBe(0xff);
    const marker = bytes[i + 1]!;
    if (marker === 0xda) break;
    const len = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    out.push({ marker, payload: bytes.slice(i + 4, i + 2 + len) });
    i += 2 + len;
  }
  return out;
}

interface ParsedTiff {
  readonly order: ByteOrder;
  readonly tags: Map<number, { type: number; count: number; short: number }>;
  readonly nextIfd: number;
}

/** Mini-TIFF-Reader: Header pruefen, IFD0 lesen. */
function parseExif(payload: Uint8Array): ParsedTiff {
  expect(Array.from(payload.slice(0, 6))).toEqual(EXIF_HEADER);
  const t = payload.slice(6);
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const order = String.fromCharCode(t[0]!, t[1]!) as ByteOrder;
  expect(["II", "MM"]).toContain(order);
  const le = order === "II";
  expect(dv.getUint16(2, le)).toBe(42);
  const ifd0 = dv.getUint32(4, le);
  expect(ifd0).toBeGreaterThanOrEqual(8);
  const n = dv.getUint16(ifd0, le);
  const tags = new Map<number, { type: number; count: number; short: number }>();
  for (let k = 0; k < n; k++) {
    const off = ifd0 + 2 + k * 12;
    expect(off + 12).toBeLessThanOrEqual(t.length);
    tags.set(dv.getUint16(off, le), {
      type: dv.getUint16(off + 2, le),
      count: dv.getUint32(off + 4, le),
      short: dv.getUint16(off + 8, le),
    });
  }
  const nextIfd = dv.getUint32(ifd0 + 2 + n * 12, le);
  return { order, tags, nextIfd };
}

const JFIF = new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0x00]);
const DQT = new Uint8Array([0x10, 0x20]);

describe("stripJpegExifBytes Orientation", () => {
  for (const order of ["II", "MM"] as const) {
    it(`Orientation 6 bleibt erhalten (${order}), GPS und Make verschwinden`, () => {
      const input = jpeg([
        [0xe0, JFIF],
        [0xe1, exifApp1(order, 6)],
        [0xdb, DQT],
      ]);
      const out = stripJpegExifBytes(input);
      const segs = segments(out);
      expect(segs.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xdb]);
      const parsed = parseExif(segs[1]!.payload);
      expect(parsed.order).toBe(order);
      expect([...parsed.tags.keys()]).toEqual([0x0112]);
      expect(parsed.tags.get(0x0112)).toEqual({ type: 3, count: 1, short: 6 });
      expect(parsed.nextIfd).toBe(0);
      // Bilddaten unveraendert am Ende.
      expect(Array.from(out.slice(-5))).toEqual([0xab, 0xcd, 0xef, 0xff, 0xd9]);
    });
  }

  it("Orientation 1 -> APP1 komplett entfernt", () => {
    const input = jpeg([[0xe0, JFIF], [0xe1, exifApp1("II", 1)], [0xdb, DQT]]);
    const segs = segments(stripJpegExifBytes(input));
    expect(segs.map((s) => s.marker)).toEqual([0xe0, 0xdb]);
  });

  it("ohne Orientation -> APP1 komplett entfernt", () => {
    const input = jpeg([[0xe1, exifApp1("MM", null)], [0xdb, DQT]]);
    const segs = segments(stripJpegExifBytes(input));
    expect(segs.map((s) => s.marker)).toEqual([0xdb]);
  });

  it("XMP-APP1 wird weiter entfernt, Exif-Orientation bleibt", () => {
    const xmp = new Uint8Array([...new TextEncoder().encode("http://ns.adobe.com/xap/1.0/\0"), 0x3c]);
    const input = jpeg([[0xe1, exifApp1("II", 8)], [0xe1, xmp], [0xdb, DQT]]);
    const segs = segments(stripJpegExifBytes(input));
    expect(segs.map((s) => s.marker)).toEqual([0xe1, 0xdb]);
    expect(parseExif(segs[0]!.payload).tags.get(0x0112)?.short).toBe(8);
  });

  it("kaputtes Exif (IFD-Offset ausserhalb) -> APP1 entfernt, kein Absturz", () => {
    const broken = new Uint8Array([...EXIF_HEADER, 0x49, 0x49, 42, 0, 0xff, 0xff, 0, 0]);
    const input = jpeg([[0xe1, broken], [0xdb, DQT]]);
    const segs = segments(stripJpegExifBytes(input));
    expect(segs.map((s) => s.marker)).toEqual([0xdb]);
  });

  it("ungueltiger Orientation-Wert (9) -> verworfen", () => {
    const input = jpeg([[0xe1, exifApp1("II", 9)], [0xdb, DQT]]);
    const segs = segments(stripJpegExifBytes(input));
    expect(segs.map((s) => s.marker)).toEqual([0xdb]);
  });
});
