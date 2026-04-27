/**
 * Minimaler Type-Stub fuer libraw-wasm 1.1.x. Das Paket liefert keine
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

  export type LibRawSettings = Record<string, number | boolean | string>;

  export default class LibRaw {
    constructor();
    open(buffer: Uint8Array, settings?: LibRawSettings): Promise<void>;
    metadata(allMetadata?: boolean): Promise<LibRawMetadata>;
    imageData(): Promise<LibRawImageData | Uint8Array>;
  }
}
