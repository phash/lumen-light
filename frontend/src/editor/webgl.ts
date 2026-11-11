/**
 * WebGL2-Helpers fuer die Lumen-Pipeline. Side-Effekt-frei, soweit moeglich:
 * `compileShader` und `linkProgram` sind reine Funktionen, `Renderer` ist
 * ein State-Container, der explizit instanziiert wird.
 */
import {
  ADJUSTMENTS,
  type AdjustmentKey,
  type Adjustments,
  HSL_CHANNELS,
  normalizeProcessVersion,
} from "./adjustments";
import { unorm16ToHalf } from "./float16";
import { MAX_LINEAR_MASKS, MAX_RADIAL_MASKS } from "./mask";
import { type Rgb16Image, boxDownscaleRgb16, isRgb16Image, rgb16ToRgb8 } from "./rawPixels";
import { FRAG_SRC, VERT_SRC } from "./shaders";
import { TONE_CURVE_LUT_SIZE, computeToneCurveLut } from "./toneCurve";

export class WebGLRendererError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebGLRendererError";
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  src: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new WebGLRendererError("createShader fehlgeschlagen");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new WebGLRendererError(`Shader-Compile fehlgeschlagen: ${log ?? "(no log)"}`);
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vs: WebGLShader,
  fs: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new WebGLRendererError("createProgram fehlgeschlagen");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new WebGLRendererError(`Program-Link fehlgeschlagen: ${log ?? "(no log)"}`);
  }
  return program;
}

interface UniformMap {
  readonly tex: WebGLUniformLocation;
  readonly bypass: WebGLUniformLocation;
  readonly uvTransform: WebGLUniformLocation;
  readonly lensDistortion: WebGLUniformLocation;
  readonly lensVignette: WebGLUniformLocation;
  readonly lensTcaR: WebGLUniformLocation;
  readonly lensTcaB: WebGLUniformLocation;
  readonly numLinearMasks: WebGLUniformLocation;
  readonly linMaskP1: WebGLUniformLocation;
  readonly linMaskP2: WebGLUniformLocation;
  readonly linMaskFeather: WebGLUniformLocation;
  readonly linLocalExposure: WebGLUniformLocation;
  readonly linLocalContrast: WebGLUniformLocation;
  readonly linLocalSaturation: WebGLUniformLocation;
  readonly linLocalTemperature: WebGLUniformLocation;
  readonly numRadialMasks: WebGLUniformLocation;
  readonly radMaskCenter: WebGLUniformLocation;
  readonly radMaskRadii: WebGLUniformLocation;
  readonly radMaskFeather: WebGLUniformLocation;
  readonly radLocalExposure: WebGLUniformLocation;
  readonly radLocalContrast: WebGLUniformLocation;
  readonly radLocalSaturation: WebGLUniformLocation;
  readonly radLocalTemperature: WebGLUniformLocation;
  readonly hslHue: WebGLUniformLocation;
  readonly hslSat: WebGLUniformLocation;
  readonly hslLum: WebGLUniformLocation;
  readonly toneCurveLut: WebGLUniformLocation;
  readonly toneCurveActive: WebGLUniformLocation;
  readonly processVersion: WebGLUniformLocation;
  readonly adjustments: ReadonlyMap<string, WebGLUniformLocation>;
}

/** Lokale Anpassung + Feather — identisch zwischen Linear- und Radial-
 *  Maske. */
interface LocalAdj {
  readonly feather: number;
  readonly exposure: number;
  readonly contrast: number;
  readonly saturation: number;
  readonly temperature: number;
}

export interface LinearMaskParams extends LocalAdj {
  readonly p1u: number;
  readonly p1v: number;
  readonly p2u: number;
  readonly p2v: number;
}

export interface RadialMaskParams extends LocalAdj {
  readonly cu: number;
  readonly cv: number;
  readonly rx: number;
  readonly ry: number;
}

export interface MasksUniforms {
  readonly linear: ReadonlyArray<LinearMaskParams>;
  readonly radial: ReadonlyArray<RadialMaskParams>;
}

const EMPTY_MASKS: MasksUniforms = { linear: [], radial: [] };

/** Pre-allokierte Float32-Arrays fuer feather + 4 Local-Adj-Felder.
 *  Wird zwischen Linear- und Radial-Pfad geteilt — beide haben dieselben
 *  Local-Adj-Slots, nur die Geometrie unterscheidet sich. */
class LocalAdjBuffers {
  readonly feather: Float32Array;
  readonly exposure: Float32Array;
  readonly contrast: Float32Array;
  readonly saturation: Float32Array;
  readonly temperature: Float32Array;

  constructor(capacity: number) {
    this.feather = new Float32Array(capacity);
    this.exposure = new Float32Array(capacity);
    this.contrast = new Float32Array(capacity);
    this.saturation = new Float32Array(capacity);
    this.temperature = new Float32Array(capacity);
  }

  clear(): void {
    this.feather.fill(0);
    this.exposure.fill(0);
    this.contrast.fill(0);
    this.saturation.fill(0);
    this.temperature.fill(0);
  }

  set(i: number, m: LocalAdj): void {
    this.feather[i] = m.feather;
    this.exposure[i] = m.exposure;
    this.contrast[i] = m.contrast;
    this.saturation[i] = m.saturation;
    this.temperature[i] = m.temperature;
  }

  bind(
    gl: WebGL2RenderingContext,
    locs: {
      feather: WebGLUniformLocation;
      exposure: WebGLUniformLocation;
      contrast: WebGLUniformLocation;
      saturation: WebGLUniformLocation;
      temperature: WebGLUniformLocation;
    },
  ): void {
    gl.uniform1fv(locs.feather, this.feather);
    gl.uniform1fv(locs.exposure, this.exposure);
    gl.uniform1fv(locs.contrast, this.contrast);
    gl.uniform1fv(locs.saturation, this.saturation);
    gl.uniform1fv(locs.temperature, this.temperature);
  }
}

const IDENTITY_UV_TRANSFORM = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** Natuerliche Pixelgroesse einer Textur-Quelle (Image: naturalWidth,
 *  sonst width/height). */
export function texSourceSize(src: TexImageSource): { width: number; height: number } {
  if (typeof HTMLImageElement !== "undefined" && src instanceof HTMLImageElement) {
    return { width: src.naturalWidth, height: src.naturalHeight };
  }
  if (typeof HTMLVideoElement !== "undefined" && src instanceof HTMLVideoElement) {
    return { width: src.videoWidth, height: src.videoHeight };
  }
  if ("displayWidth" in src) {
    return { width: src.displayWidth, height: src.displayHeight };
  }
  return { width: src.width, height: src.height };
}

/** Skaliert (w, h) proportional so, dass beide Kanten <= limit sind. */
export function fitWithin(
  width: number,
  height: number,
  limit: number,
): { width: number; height: number; scaled: boolean } {
  const scale = Math.min(1, limit / Math.max(width, height, 1));
  if (scale >= 1) return { width, height, scaled: false };
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scaled: true,
  };
}

/** Zeichnet die Quelle per 2D-Canvas auf die Zielgroesse herunter.
 *  null, wenn kein 2D-Context verfuegbar ist. */
function downscaleSource(
  src: TexImageSource,
  width: number,
  height: number,
): TexImageSource | null {
  let canvas: HTMLCanvasElement | OffscreenCanvas;
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    canvas = c;
  } else if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height);
  } else {
    return null;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src as CanvasImageSource, 0, 0, width, height);
  return canvas;
}

/** Praezision der aktuell geladenen Quelltextur. */
export type SourcePrecision = "float16" | "8bit";

/** Teilmenge von WebGL2, die der 16-bit-Upload braucht (Fake-GL in Tests). */
export type Rgb16UploadGl = Pick<
  WebGL2RenderingContext,
  | "createTexture"
  | "deleteTexture"
  | "bindTexture"
  | "texParameteri"
  | "pixelStorei"
  | "texStorage2D"
  | "texSubImage2D"
  | "getError"
  | "NO_ERROR"
  | "TEXTURE_2D"
  | "TEXTURE_WRAP_S"
  | "TEXTURE_WRAP_T"
  | "TEXTURE_MIN_FILTER"
  | "TEXTURE_MAG_FILTER"
  | "CLAMP_TO_EDGE"
  | "LINEAR"
  | "UNPACK_ALIGNMENT"
  | "RGB"
  | "RGB8"
  | "RGB16F"
  | "HALF_FLOAT"
  | "UNSIGNED_BYTE"
>;

/** Zeilen pro texSubImage2D-Streifen: haelt den Konvertierungspuffer klein
 *  (6000 px Breite -> ~9 MB) statt einer zweiten Vollbild-Kopie. */
export const UPLOAD_STRIPE_ROWS = 256;

/** Liest aufgelaufene GL-Fehler aus (begrenzt: bei Kontextverlust kommt
 *  sonst evtl. kein NO_ERROR). */
function drainGlErrors(gl: Rgb16UploadGl): void {
  for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) {
    // nur leeren
  }
}

function tryUploadRgb16(
  gl: Rgb16UploadGl,
  src: Rgb16Image,
  precision: SourcePrecision,
  stripeRows: number,
): WebGLTexture | null {
  const { width, height, data } = src;
  const half = precision === "float16";
  drainGlErrors(gl);
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  // RGB-Zeilen sind 3 bzw. 6 Byte × Breite -> nicht 4-Byte-ausgerichtet.
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  try {
    gl.texStorage2D(gl.TEXTURE_2D, 1, half ? gl.RGB16F : gl.RGB8, width, height);
    if (gl.getError() !== gl.NO_ERROR) throw new Error("texStorage2D");
    const rows = Math.max(1, Math.min(stripeRows, height));
    const rowLen = width * 3;
    const buf = half ? new Uint16Array(rows * rowLen) : new Uint8Array(rows * rowLen);
    for (let y = 0; y < height; y += rows) {
      const n = Math.min(rows, height - y);
      const chunk = data.subarray(y * rowLen, (y + n) * rowLen);
      const out = buf.subarray(0, n * rowLen);
      if (out instanceof Uint16Array) unorm16ToHalf(chunk, out);
      else rgb16ToRgb8(chunk, out);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, y, width, n, gl.RGB,
        half ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, out,
      );
    }
    if (gl.getError() !== gl.NO_ERROR) throw new Error("texSubImage2D");
    return tex;
  } catch {
    gl.deleteTexture(tex);
    return null;
  } finally {
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }
}

/**
 * H1b: laedt eine 16-bit-RGB-Quelle als Textur. Bevorzugt RGB16F
 * (Half-Float, in WebGL2 filterbar); schlaegt das fehl (OUT_OF_MEMORY,
 * Exception), wird dieselbe Quelle als RGB8 (oberes Byte) geladen.
 * Wirft, wenn beides scheitert. Die Textur bleibt gebunden.
 */
export function uploadRgb16Texture(
  gl: Rgb16UploadGl,
  src: Rgb16Image,
  options: { readonly preferHalf: boolean; readonly stripeRows?: number },
): { texture: WebGLTexture; precision: SourcePrecision } {
  const stripeRows = options.stripeRows ?? UPLOAD_STRIPE_ROWS;
  const attempts: SourcePrecision[] = options.preferHalf ? ["float16", "8bit"] : ["8bit"];
  for (const precision of attempts) {
    const texture = tryUploadRgb16(gl, src, precision, stripeRows);
    if (texture) return { texture, precision };
  }
  throw new WebGLRendererError(
    "Bild konnte nicht in den Grafikspeicher geladen werden.",
  );
}

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: UniformMap;
  private texture: WebGLTexture | null = null;
  private readonly toneCurveTexture: WebGLTexture;
  private toneCurveLutCache = new Uint8Array(TONE_CURVE_LUT_SIZE);
  private _imageWidth = 0;
  private _imageHeight = 0;
  private _sourcePrecision: SourcePrecision = "8bit";
  private readonly vao: WebGLVertexArrayObject | null;
  private readonly vbo: WebGLBuffer | null;
  /** Groesste Kantenlaenge, die Textur, Renderbuffer UND Viewport
   *  gleichzeitig schaffen. Darueber rendert WebGL still schwarz. */
  readonly maxDimension: number;

  // Pre-allocated typed arrays — vermeiden Allocation pro Frame.
  private readonly linP1 = new Float32Array(MAX_LINEAR_MASKS * 2);
  private readonly linP2 = new Float32Array(MAX_LINEAR_MASKS * 2);
  private readonly linLocal = new LocalAdjBuffers(MAX_LINEAR_MASKS);
  private readonly radCenter = new Float32Array(MAX_RADIAL_MASKS * 2);
  private readonly radRadii = new Float32Array(MAX_RADIAL_MASKS * 2);
  private readonly radLocal = new LocalAdjBuffers(MAX_RADIAL_MASKS);
  private readonly hslHueArr = new Float32Array(HSL_CHANNELS.length);
  private readonly hslSatArr = new Float32Array(HSL_CHANNELS.length);
  private readonly hslLumArr = new Float32Array(HSL_CHANNELS.length);

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      preserveDrawingBuffer: true,
      premultipliedAlpha: false,
    });
    if (!gl) {
      throw new WebGLRendererError(
        "WebGL2 nicht verfügbar — Browser-Support prüfen.",
      );
    }
    this.gl = gl;

    const maxTex = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 4096;
    const maxRb = Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || maxTex;
    const vp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
    const maxVp = vp ? Math.min(vp[0] ?? maxTex, vp[1] ?? maxTex) : maxTex;
    this.maxDimension = Math.min(maxTex, maxRb, maxVp);

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    this.program = linkProgram(gl, vs, fs);

    const vao = gl.createVertexArray();
    this.vao = vao;
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    this.vbo = buf;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1, -1, 0, 1,
         1, -1, 1, 1,
        -1,  1, 0, 0,
         1,  1, 1, 0,
      ]),
      gl.STATIC_DRAW,
    );
    const posLoc = gl.getAttribLocation(this.program, "a_pos");
    const uvLoc = gl.getAttribLocation(this.program, "a_uv");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

    const adjustmentLocs = new Map<string, WebGLUniformLocation>();
    for (const a of ADJUSTMENTS) {
      const loc = gl.getUniformLocation(this.program, `u_${a.key}`);
      if (loc === null) {
        throw new WebGLRendererError(`Uniform u_${a.key} nicht gefunden`);
      }
      adjustmentLocs.set(a.key, loc);
    }
    const get = (name: string): WebGLUniformLocation => {
      const loc = gl.getUniformLocation(this.program, name);
      if (loc === null) {
        throw new WebGLRendererError(`Uniform ${name} nicht gefunden`);
      }
      return loc;
    };
    this.uniforms = {
      tex: get("u_tex"),
      bypass: get("u_bypass"),
      uvTransform: get("u_uvTransform"),
      lensDistortion: get("u_lensDistortion"),
      lensVignette: get("u_lensVignette"),
      lensTcaR: get("u_lensTcaR"),
      lensTcaB: get("u_lensTcaB"),
      numLinearMasks: get("u_numLinearMasks"),
      linMaskP1: get("u_linMaskP1[0]"),
      linMaskP2: get("u_linMaskP2[0]"),
      linMaskFeather: get("u_linMaskFeather[0]"),
      linLocalExposure: get("u_linLocalExposure[0]"),
      linLocalContrast: get("u_linLocalContrast[0]"),
      linLocalSaturation: get("u_linLocalSaturation[0]"),
      linLocalTemperature: get("u_linLocalTemperature[0]"),
      numRadialMasks: get("u_numRadialMasks"),
      radMaskCenter: get("u_radMaskCenter[0]"),
      radMaskRadii: get("u_radMaskRadii[0]"),
      radMaskFeather: get("u_radMaskFeather[0]"),
      radLocalExposure: get("u_radLocalExposure[0]"),
      radLocalContrast: get("u_radLocalContrast[0]"),
      radLocalSaturation: get("u_radLocalSaturation[0]"),
      radLocalTemperature: get("u_radLocalTemperature[0]"),
      hslHue: get("u_hslHue[0]"),
      hslSat: get("u_hslSat[0]"),
      hslLum: get("u_hslLum[0]"),
      toneCurveLut: get("u_toneCurveLut"),
      toneCurveActive: get("u_toneCurveActive"),
      processVersion: get("u_processVersion"),
      adjustments: adjustmentLocs,
    };

    // Tonkurven-LUT als 256x1 R8-Texture. Identity beim Init, wird beim
    // ersten Render mit aktiver Kurve via uploadToneCurveLut neu befuellt.
    const lutTex = gl.createTexture();
    if (!lutTex) throw new WebGLRendererError("createTexture (LUT) fehlgeschlagen");
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lutTex);
    const identity = new Uint8Array(TONE_CURVE_LUT_SIZE);
    for (let i = 0; i < TONE_CURVE_LUT_SIZE; i++) identity[i] = i;
    this.toneCurveLutCache = identity.slice();
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      TONE_CURVE_LUT_SIZE,
      1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      identity,
    );
    this.toneCurveTexture = lutTex;
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(this.program);
  }

  private uploadToneCurveLut(adjustments: Adjustments): void {
    const gl = this.gl;
    if (adjustments.toneCurve === null) return;
    const lut = computeToneCurveLut(adjustments.toneCurve);
    // Skip-Upload, wenn unveraendert (drag-Frame-Spam).
    let same = true;
    for (let i = 0; i < TONE_CURVE_LUT_SIZE; i++) {
      if (this.toneCurveLutCache[i] !== lut[i]) {
        same = false;
        break;
      }
    }
    if (same) return;
    this.toneCurveLutCache.set(lut);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.toneCurveTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      TONE_CURVE_LUT_SIZE,
      1,
      gl.RED,
      gl.UNSIGNED_BYTE,
      lut,
    );
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Laedt die Quelle als Textur in der Zielgroesse width × height. Ist die
   *  Quelle groesser (Full-Res-Bitmap fuer die Vorschau), wird sie vorher
   *  per 2D-Canvas heruntergerechnet — spart GPU-Speicher und Upload-Zeit
   *  (H1b: 16-bit-RAW-Quellen per CPU-Box-Filter, Upload als RGB16F).
   *  Zielgroessen ueber `maxDimension` werden proportional begrenzt
   *  (sonst bleibt das Bild schwarz). Die effektive Groesse steht danach
   *  in imageWidth/imageHeight. */
  loadImage(image: TexImageSource | Rgb16Image, width: number, height: number): void {
    const gl = this.gl;
    const target = fitWithin(width, height, this.maxDimension);
    if (isRgb16Image(image)) {
      this.loadRgb16(image, target.width, target.height);
      return;
    }
    const srcSize = texSourceSize(image);
    let upload: TexImageSource = image;
    if (srcSize.width > target.width || srcSize.height > target.height) {
      const scaled = downscaleSource(image, target.width, target.height);
      if (scaled) {
        upload = scaled;
      } else if (Math.max(srcSize.width, srcSize.height) > this.maxDimension) {
        throw new WebGLRendererError(
          `Bild zu groß für die Grafikkarte (max. ${this.maxDimension} px Kantenlänge).`,
        );
      }
    }
    width = target.width;
    height = target.height;
    if (this.texture) gl.deleteTexture(this.texture);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, upload);
    this.texture = tex;
    this._sourcePrecision = "8bit";
    this.setImageSize(width, height);
  }

  /** H1b: 16-bit-Quelle — CPU-Box-Verkleinerung (das 2D-Canvas kann nur
   *  8 bit), dann Half-Float-Upload mit RGB8-Rueckfall. */
  private loadRgb16(image: Rgb16Image, width: number, height: number): void {
    const gl = this.gl;
    const src =
      image.width > width || image.height > height
        ? boxDownscaleRgb16(image, Math.min(width, image.width), Math.min(height, image.height))
        : image;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = null;
    const { texture, precision } = uploadRgb16Texture(gl, src, { preferHalf: true });
    this.texture = texture;
    this._sourcePrecision = precision;
    this.setImageSize(src.width, src.height);
  }

  private setImageSize(width: number, height: number): void {
    this._imageWidth = width;
    this._imageHeight = height;
    this.gl.canvas.width = width;
    this.gl.canvas.height = height;
  }

  /** "float16", wenn die aktuelle Quelle als RGB16F geladen ist. */
  get sourcePrecision(): SourcePrecision {
    return this._sourcePrecision;
  }

  hasImage(): boolean {
    return this.texture !== null;
  }

  /** Gibt den WebGL-Context frei. Wichtig fuer kurzlebige Export-Renderer —
   *  Browser begrenzen die Zahl gleichzeitiger WebGL-Contexts (~16). */
  dispose(): void {
    this.release();
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }

  /** Gibt alle GPU-Ressourcen frei, laesst den Context aber bestehen. Fuer
   *  den Live-Renderer beim Unmount: React-StrictMode mountet dasselbe
   *  Canvas erneut, ein verlorener Context waere dann nicht mehr nutzbar. */
  release(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = null;
    gl.deleteTexture(this.toneCurveTexture);
    if (this.vbo) gl.deleteBuffer(this.vbo);
    if (this.vao) gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
  }

  /** Original-Pixel-Dimensionen des geladenen Bildes (vor Crop). */
  get imageWidth(): number { return this._imageWidth; }
  get imageHeight(): number { return this._imageHeight; }

  private packLinearMasks(linear: ReadonlyArray<LinearMaskParams>): number {
    const n = Math.min(linear.length, MAX_LINEAR_MASKS);
    this.linP1.fill(0);
    this.linP2.fill(0);
    this.linLocal.clear();
    for (let i = 0; i < n; i++) {
      const m = linear[i]!;
      this.linP1[2 * i] = m.p1u;
      this.linP1[2 * i + 1] = m.p1v;
      this.linP2[2 * i] = m.p2u;
      this.linP2[2 * i + 1] = m.p2v;
      this.linLocal.set(i, m);
    }
    return n;
  }

  private packHsl(adjustments: Adjustments): void {
    this.hslHueArr.fill(0);
    this.hslSatArr.fill(0);
    this.hslLumArr.fill(0);
    const hsl = adjustments.hsl;
    if (hsl === null) return;
    for (let i = 0; i < HSL_CHANNELS.length; i++) {
      const ch = HSL_CHANNELS[i]!;
      this.hslHueArr[i] = hsl.hue[ch];
      this.hslSatArr[i] = hsl.saturation[ch];
      this.hslLumArr[i] = hsl.luminance[ch];
    }
  }

  private packRadialMasks(radial: ReadonlyArray<RadialMaskParams>): number {
    const n = Math.min(radial.length, MAX_RADIAL_MASKS);
    this.radCenter.fill(0);
    this.radRadii.fill(0);
    this.radLocal.clear();
    for (let i = 0; i < n; i++) {
      const m = radial[i]!;
      this.radCenter[2 * i] = m.cu;
      this.radCenter[2 * i + 1] = m.cv;
      this.radRadii[2 * i] = m.rx;
      this.radRadii[2 * i + 1] = m.ry;
      this.radLocal.set(i, m);
    }
    return n;
  }

  render(
    adjustments: Adjustments,
    bypass: boolean,
    uvTransform: Float32Array = IDENTITY_UV_TRANSFORM,
    lensDistortion = 0,
    lensVignette = 0,
    masks: MasksUniforms = EMPTY_MASKS,
    outputSize: { width: number; height: number } | null = null,
    lensTcaR = 0,
    lensTcaB = 0,
  ): void {
    if (!this.texture) return;
    const gl = this.gl;
    // Drawingbuffer auf das gewuenschte Output-Format setzen — typisch
    // imageDimensions × cropSize, sodass das gecropte Rechteck
    // pixelgenau auf den Output gemapt wird statt gestreckt.
    if (outputSize) {
      const w = Math.max(1, Math.round(outputSize.width));
      const h = Math.max(1, Math.round(outputSize.height));
      if (gl.canvas.width !== w) gl.canvas.width = w;
      if (gl.canvas.height !== h) gl.canvas.height = h;
    }
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.tex, 0);
    gl.uniform1f(this.uniforms.bypass, bypass ? 1.0 : 0.0);
    gl.uniformMatrix3fv(this.uniforms.uvTransform, false, uvTransform);
    gl.uniform1f(this.uniforms.lensDistortion, lensDistortion);
    gl.uniform1f(this.uniforms.lensVignette, lensVignette);
    gl.uniform1f(this.uniforms.lensTcaR, lensTcaR);
    gl.uniform1f(this.uniforms.lensTcaB, lensTcaB);

    const numLin = this.packLinearMasks(masks.linear);
    gl.uniform1i(this.uniforms.numLinearMasks, numLin);
    gl.uniform2fv(this.uniforms.linMaskP1, this.linP1);
    gl.uniform2fv(this.uniforms.linMaskP2, this.linP2);
    this.linLocal.bind(gl, {
      feather: this.uniforms.linMaskFeather,
      exposure: this.uniforms.linLocalExposure,
      contrast: this.uniforms.linLocalContrast,
      saturation: this.uniforms.linLocalSaturation,
      temperature: this.uniforms.linLocalTemperature,
    });

    const numRad = this.packRadialMasks(masks.radial);
    gl.uniform1i(this.uniforms.numRadialMasks, numRad);
    gl.uniform2fv(this.uniforms.radMaskCenter, this.radCenter);
    gl.uniform2fv(this.uniforms.radMaskRadii, this.radRadii);
    this.radLocal.bind(gl, {
      feather: this.uniforms.radMaskFeather,
      exposure: this.uniforms.radLocalExposure,
      contrast: this.uniforms.radLocalContrast,
      saturation: this.uniforms.radLocalSaturation,
      temperature: this.uniforms.radLocalTemperature,
    });

    this.packHsl(adjustments);
    gl.uniform1fv(this.uniforms.hslHue, this.hslHueArr);
    gl.uniform1fv(this.uniforms.hslSat, this.hslSatArr);
    gl.uniform1fv(this.uniforms.hslLum, this.hslLumArr);

    this.uploadToneCurveLut(adjustments);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.toneCurveTexture);
    gl.uniform1i(this.uniforms.toneCurveLut, 1);
    gl.uniform1f(
      this.uniforms.toneCurveActive,
      adjustments.toneCurve === null ? 0 : 1,
    );
    gl.activeTexture(gl.TEXTURE0);

    // H1: Prozessversion waehlt im Shader den Ton-Pfad (1 = Display-Raum,
    // 2 = szenenbezogen). Fehlt das Feld (Altdaten), gilt 1.
    gl.uniform1i(
      this.uniforms.processVersion,
      normalizeProcessVersion(adjustments.processVersion),
    );

    for (const [key, loc] of this.uniforms.adjustments) {
      gl.uniform1f(loc, adjustments[key as AdjustmentKey]);
    }
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/**
 * Bequemes API: laed eine Datei als Image, dimensioniert sie auf max maxWidth
 * und gibt das geladene HTMLImageElement plus Zielgroesse zurueck.
 */
export async function loadImageFromFile(
  file: File,
  maxWidth = 1600,
): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Bild konnte nicht geladen werden"));
      img.src = url;
    });
    const scale = Math.min(1, maxWidth / image.width);
    return {
      image,
      width: Math.round(image.width * scale),
      height: Math.round(image.height * scale),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
