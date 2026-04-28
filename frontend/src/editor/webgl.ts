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
} from "./adjustments";
import { MAX_LINEAR_MASKS, MAX_RADIAL_MASKS } from "./mask";
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

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: UniformMap;
  private texture: WebGLTexture | null = null;
  private readonly toneCurveTexture: WebGLTexture;
  private toneCurveLutCache = new Uint8Array(TONE_CURVE_LUT_SIZE);
  private _imageWidth = 0;
  private _imageHeight = 0;

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
        "WebGL2 nicht verfuegbar — Browser-Support pruefen.",
      );
    }
    this.gl = gl;

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    this.program = linkProgram(gl, vs, fs);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
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

  loadImage(image: TexImageSource, width: number, height: number): void {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.texture = tex;
    this._imageWidth = width;
    this._imageHeight = height;
    gl.canvas.width = width;
    gl.canvas.height = height;
  }

  hasImage(): boolean {
    return this.texture !== null;
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
