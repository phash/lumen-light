/**
 * Minimaler Type-Stub fuer libraw-wasm 1.6.x. Das Paket liefert keine
 * eigenen Typdefinitionen aus.
 */
declare module "libraw-wasm" {
  export interface LibRawMetadata {
    width?: number;
    height?: number;
    iwidth?: number;
    iheight?: number;
    make?: string | null;
    model?: string | null;
    desc?: string;
    timestamp?: Date;
    thumb_format?: string;
    [key: string]: unknown;
  }

  export interface LibRawImageData {
    data?: Uint8Array;
    width?: number;
    height?: number;
    [key: string]: unknown;
  }

  /** Eingebettete Kamera-Vorschau (`thumbnailData()`, >= 1.6). `bitmap`
   *  = RGB, width × height × 3 Bytes. */
  export interface LibRawThumbnailData {
    data: Uint8Array;
    width: number;
    height: number;
    format: "jpeg" | "bitmap" | "unknown";
  }

  export type LibRawSettings = Record<string, number | boolean | string>;

  export default class LibRaw {
    constructor();
    open(buffer: Uint8Array, settings?: LibRawSettings): Promise<void>;
    metadata(allMetadata?: boolean): Promise<LibRawMetadata>;
    imageData(): Promise<LibRawImageData | Uint8Array>;
    /** Eingebettete Vorschau, undefined wenn keine vorhanden. */
    thumbnailData(): Promise<LibRawThumbnailData | undefined>;
    /** Beendet den internen Worker und gibt den WASM-Heap frei (>= 1.6). */
    dispose(): void;
  }
}
