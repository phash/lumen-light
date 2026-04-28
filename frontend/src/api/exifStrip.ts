/**
 * EXIF-Strip fuer JPEG-Dateien (DSGVO Art. 5 Datenminimierung).
 *
 * JPEG-Aufbau:
 *   FFD8  (SOI)
 *   FFXX [len-MSB] [len-LSB] [data...]   - APPx-Segmente mit EXIF/IPTC/etc.
 *   FFDB ...                             - Quantization-Tables
 *   FFC0/FFC2 ...                        - Frame-Header
 *   FFC4 ...                             - Huffman
 *   FFDA [len] [data]                    - Start of Scan, danach roher
 *                                          Bilddaten-Stream bis FFD9
 *   FFD9  (EOI)
 *
 * EXIF lebt im APP1-Segment (FFE1), GPS dort als IFD. Wir entfernen
 * APP1 und APP2 (XMP/ICC) komplett. APP0 (JFIF, FFE0) bleibt — das ist
 * keine PII, wird aber von vielen Decodern erwartet.
 *
 * Andere Formate: PNG/RAW unveraendert zurueckgegeben. PNG kann EXIF
 * in eXIf-Chunks haben, ist aber selten. RAW-EXIF zu strippen ist
 * herstellerspezifisch — out of scope.
 */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === JPEG_MAGIC[0] &&
    bytes[1] === JPEG_MAGIC[1] &&
    bytes[2] === JPEG_MAGIC[2]
  );
}

/**
 * Entfernt APP1 (EXIF) und APP2 (ICC/XMP) aus einer JPEG-Byte-Sequenz.
 * Liefert die gestripte Sequenz; bei Nicht-JPEG oder ungueltiger
 * Struktur unveraendert.
 */
export function stripJpegExifBytes(input: Uint8Array): Uint8Array {
  if (!isJpeg(input)) return input;

  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    if (input[i] !== 0xff) {
      // Nach SOS folgt der Image-Stream — alles bis EOI durchreichen.
      out.push(input[i]!);
      i++;
      continue;
    }
    const marker = input[i + 1]!;
    // Marker ohne Length-Field: SOI(D8), EOI(D9), TEM(01), RSTn(D0..D7).
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    // SOS (FFDA) — Length + Data folgt, danach Image-Stream bis EOI.
    if (marker === 0xda) {
      const length = (input[i + 2]! << 8) | input[i + 3]!;
      // Header inklusive Marker + Length-Bytes
      for (let k = 0; k < length + 2; k++) out.push(input[i + k]!);
      i += length + 2;
      // Image-Stream bis FFD9 — alles 1:1 kopieren.
      while (i < input.length) {
        out.push(input[i]!);
        i++;
      }
      break;
    }
    // Sonstige Marker mit Length-Field (FFE0..FFEF, FFDB, FFC0, FFC4, etc.)
    const length = (input[i + 2]! << 8) | input[i + 3]!;
    if (marker === 0xe1 || marker === 0xe2) {
      // APP1 (EXIF) und APP2 (ICC/XMP): segment komplett ueberspringen.
      i += length + 2;
      continue;
    }
    // Anderes Segment: durchreichen.
    for (let k = 0; k < length + 2; k++) out.push(input[i + k]!);
    i += length + 2;
  }
  return new Uint8Array(out);
}

export async function stripExifIfJpeg(file: File): Promise<File> {
  if (!file.type.includes("jpeg") && !file.name.toLowerCase().match(/\.jpe?g$/)) {
    return file;
  }
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const stripped = stripJpegExifBytes(bytes);
  if (stripped.length === bytes.length) {
    // No-op (z.B. Datei hatte gar keine EXIF) — gib das Original
    // zurueck, damit kein neues Blob-Objekt entsteht.
    return file;
  }
  return new File([new Uint8Array(stripped)], file.name, {
    type: file.type || "image/jpeg",
    lastModified: file.lastModified,
  });
}
