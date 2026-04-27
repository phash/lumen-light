/**
 * RAW-Datei-Detection und Decoding via libraw-wasm.
 *
 * Decoding laeuft intern in einem Web-Worker (libraw-wasm-Default), der
 * UI-Thread bleibt frei. Magic-Byte-Detection macht die Format-Erkennung
 * unabhaengig vom Datei-Namen.
 */
import LibRaw from "libraw-wasm";

export type RawFormat =
  | "cr2"      // Canon — TIFF-basierter Header
  | "cr3"      // Canon — ISO-BMFF-Container
  | "nef"      // Nikon — TIFF-basierter Header (CR2-aehnlich)
  | "arw"      // Sony — TIFF-basierter Header
  | "raf"      // Fuji — eigenes Format mit "FUJIFILMCCD-RAW"-Header
  | "dng"      // Adobe — TIFF-basierter Header
  | "rw2"      // Panasonic — eigenes Format
  | "orf";     // Olympus — TIFF-basierter Header

const RAW_EXTENSIONS: ReadonlyArray<readonly [string, RawFormat]> = [
  [".cr2", "cr2"],
  [".cr3", "cr3"],
  [".nef", "nef"],
  [".arw", "arw"],
  [".raf", "raf"],
  [".dng", "dng"],
  [".rw2", "rw2"],
  [".orf", "orf"],
];

export interface DecodedRaw {
  readonly width: number;
  readonly height: number;
  readonly focalLen: number | null;
  /** RGB-Pixel-Buffer (nicht RGBA). Laenge = width × height × 3. */
  readonly rgb: Uint8Array;
  readonly cameraMake: string | null;
  readonly cameraModel: string | null;
}

/**
 * Erkennt RAW-Formate primaer ueber Magic-Bytes (Datei-Header), sekundaer
 * ueber Endung. RAF und CR3 haben unverwechselbare Markierungen; alle
 * anderen sind TIFF-basiert und nur ueber Endung sicher unterscheidbar.
 */
export function detectRawFormat(
  filename: string,
  header: Uint8Array,
): RawFormat | null {
  // RAF: ASCII-Signatur am Datei-Anfang
  if (header.length >= 15) {
    const fujiSig = String.fromCharCode(...header.slice(0, 15));
    if (fujiSig === "FUJIFILMCCD-RAW") return "raf";
  }

  // CR3: ISO-BMFF mit "ftyp...crx " ab Byte 4
  if (header.length >= 12) {
    const ftyp = String.fromCharCode(...header.slice(4, 8));
    const brand = String.fromCharCode(...header.slice(8, 12));
    if (ftyp === "ftyp" && brand === "crx ") return "cr3";
  }

  // Endung als Fallback fuer TIFF-basierte Formate
  const lower = filename.toLowerCase();
  for (const [ext, fmt] of RAW_EXTENSIONS) {
    if (lower.endsWith(ext)) return fmt;
  }
  return null;
}

/**
 * Liest die ersten n Bytes einer File. Praktisch fuer Magic-Byte-Detection
 * ohne den ganzen RAW-Buffer ins Memory zu laden.
 */
export async function readFileHeader(file: File, bytes = 32): Promise<Uint8Array> {
  const slice = file.slice(0, Math.min(bytes, file.size));
  const buf = await slice.arrayBuffer();
  return new Uint8Array(buf);
}

export async function isRawFile(file: File): Promise<boolean> {
  const header = await readFileHeader(file);
  return detectRawFormat(file.name, header) !== null;
}

/**
 * Decoded ein RAW als RGB-Pixel-Buffer. Standard-Settings: keine
 * automatische Helligkeit, sRGB-Output, 8-bit. Siehe libraw-Docs fuer
 * weitere Optionen — der Lumen-Editor uebernimmt anschliessend die
 * Adjustments selbst.
 */
export async function decodeRaw(file: File): Promise<DecodedRaw> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  const raw = new LibRaw();
  try {
    await raw.open(buffer, {
      use_camera_wb: 1,
      output_color: 1,           // sRGB
      output_bps: 8,
      no_auto_bright: 1,
    });

    const meta = await raw.metadata(true);
    const result = await raw.imageData();

    let rgb: Uint8Array;
    let width: number;
    let height: number;
    if (result instanceof Uint8Array) {
      rgb = result;
      width = meta.width ?? meta.iwidth ?? 0;
      height = meta.height ?? meta.iheight ?? 0;
    } else {
      rgb = result.data ?? new Uint8Array();
      width = result.width ?? meta.width ?? 0;
      height = result.height ?? meta.height ?? 0;
    }

    if (rgb.length !== width * height * 3) {
      throw new Error(
        `RAW-Decode lieferte ${rgb.length} Bytes, erwartet wurden ${width * height * 3} (= ${width}x${height}x3)`,
      );
    }

    return {
      width,
      height,
      rgb,
      focalLen: pickNumber(meta, "focal_len"),
      cameraMake: pickString(meta, "camera_make", "make"),
      cameraModel: pickString(meta, "camera_model", "model"),
    };
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Liest einen String-Wert aus einem unbekannt-strukturierten Metadata-
 * Objekt. Probiert mehrere Pfade (Top-Level-Keys oder verschachtelte
 * Pfade als Array). Erster nicht-leerer String gewinnt; Whitespace wird
 * gestrippt.
 */
function pickNumber(source: unknown, key: string): number | null {
  if (source && typeof source === "object" && key in (source as Record<string, unknown>)) {
    const v = (source as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickString(
  source: unknown,
  ...paths: ReadonlyArray<string | ReadonlyArray<string>>
): string | null {
  for (const path of paths) {
    const keys = typeof path === "string" ? [path] : path;
    let cursor: unknown = source;
    for (const key of keys) {
      if (cursor && typeof cursor === "object" && key in (cursor as Record<string, unknown>)) {
        cursor = (cursor as Record<string, unknown>)[key];
      } else {
        cursor = undefined;
        break;
      }
    }
    if (typeof cursor === "string" && cursor.trim().length > 0) {
      return cursor.trim();
    }
  }
  return null;
}

/**
 * Konvertiert RGB-Daten in eine RGBA-Image-Bitmap, die direkt als
 * WebGL-Texture-Source genutzt werden kann.
 */
export async function rgbToImageBitmap(
  rgb: Uint8Array,
  width: number,
  height: number,
): Promise<ImageBitmap> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i]!;
    rgba[j + 1] = rgb[i + 1]!;
    rgba[j + 2] = rgb[i + 2]!;
    rgba[j + 3] = 255;
  }
  const data = new ImageData(rgba, width, height);
  return createImageBitmap(data);
}
