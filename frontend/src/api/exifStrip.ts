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

  const n = input.length;
  const out: number[] = [];
  let i = 0;
  while (i < n) {
    const b = input[i]!;
    if (b !== 0xff) {
      // Defensive: ausserhalb des Image-Streams sollte hier immer 0xFF stehen.
      out.push(b);
      i++;
      continue;
    }
    // Fill-Bytes: beliebig viele aufeinanderfolgende 0xFF vor einem Marker
    // sind laut JPEG-Spec legal. Marker ist das erste Nicht-0xFF danach.
    let j = i + 1;
    while (j < n && input[j] === 0xff) j++;
    if (j >= n) {
      // Trailing 0xFF ohne Marker — Rest unveraendert durchreichen.
      for (let k = i; k < n; k++) out.push(input[k]!);
      break;
    }
    const marker = input[j]!;

    // Marker ohne Length-Field: SOI(D8), EOI(D9), TEM(01), RSTn(D0..D7).
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      for (let k = i; k <= j; k++) out.push(input[k]!); // Fill + Marker
      i = j + 1;
      continue;
    }

    // Ab hier Length-Field-Marker: 2 Length-Bytes bei j+1,j+2 noetig.
    // Bei truncated/malformed Struktur lieber NICHTS strippen und das
    // Original unveraendert zurueckgeben, statt korrupte Bytes zu erzeugen.
    if (j + 2 >= n) return input;
    const length = (input[j + 1]! << 8) | input[j + 2]!;
    if (length < 2) return input;
    const segEnd = j + 1 + length; // exklusiv: Marker(j) + Length + Data
    if (segEnd > n) return input;

    if (marker === 0xda) {
      // SOS — Header durchreichen, danach roher Image-Stream bis EOI 1:1.
      for (let k = i; k < n; k++) out.push(input[k]!);
      break;
    }
    if (marker === 0xe1 || marker === 0xe2) {
      // APP1 (EXIF) / APP2 (ICC/XMP) inkl. evtl. Fill davor ueberspringen.
      i = segEnd;
      continue;
    }
    // Anderes Segment: Fill + Marker + Length + Data durchreichen.
    for (let k = i; k < segEnd; k++) out.push(input[k]!);
    i = segEnd;
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
