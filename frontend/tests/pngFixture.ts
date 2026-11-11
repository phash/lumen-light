/**
 * Minimaler PNG-Decoder fuer Test-Fixtures (8-bit RGB/RGBA, nicht
 * interlaced). jsdom kann keine Bilder dekodieren; fuer die Ton-Referenz-
 * Tests reichen die Rohpixel der Fixtures in tests-fixtures/test-samples/.
 */
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  /** RGBA, 4 Byte pro Pixel. */
  readonly data: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(path: string): RgbaImage {
  const buf = readFileSync(path);
  let offset = 8; // Signatur
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const body = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const bitDepth = body[8];
      colorType = body[9] ?? 0;
      const interlace = body[12];
      if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || interlace !== 0) {
        throw new Error(`PNG-Format nicht unterstuetzt: ${path}`);
      }
    } else if (type === "IDAT") {
      idat.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x] ?? 0;
      const a = x >= bpp ? (pixels[y * stride + x - bpp] ?? 0) : 0;
      const b = y > 0 ? (pixels[(y - 1) * stride + x] ?? 0) : 0;
      const c = x >= bpp && y > 0 ? (pixels[(y - 1) * stride + x - bpp] ?? 0) : 0;
      let out: number;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + Math.floor((a + b) / 2); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`PNG-Filter ${filter} unbekannt`);
      }
      pixels[y * stride + x] = out & 0xff;
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = pixels[i * bpp] ?? 0;
    data[i * 4 + 1] = pixels[i * bpp + 1] ?? 0;
    data[i * 4 + 2] = pixels[i * bpp + 2] ?? 0;
    data[i * 4 + 3] = bpp === 4 ? (pixels[i * bpp + 3] ?? 255) : 255;
  }
  return { width, height, data };
}
