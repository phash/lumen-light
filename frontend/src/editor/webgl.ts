/**
 * WebGL2-Helpers fuer die Lumen-Pipeline. Side-Effekt-frei, soweit moeglich:
 * `compileShader` und `linkProgram` sind reine Funktionen, `Renderer` ist
 * ein State-Container, der explizit instanziiert wird.
 */
import { ADJUSTMENTS, type Adjustments } from "./adjustments";
import { FRAG_SRC, VERT_SRC } from "./shaders";

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
  readonly adjustments: ReadonlyMap<string, WebGLUniformLocation>;
}

const IDENTITY_UV_TRANSFORM = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly uniforms: UniformMap;
  private texture: WebGLTexture | null = null;

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
    const tex = gl.getUniformLocation(this.program, "u_tex");
    const bypass = gl.getUniformLocation(this.program, "u_bypass");
    const uvTransform = gl.getUniformLocation(this.program, "u_uvTransform");
    const lensDistortion = gl.getUniformLocation(this.program, "u_lensDistortion");
    const lensVignette = gl.getUniformLocation(this.program, "u_lensVignette");
    if (
      tex === null ||
      bypass === null ||
      uvTransform === null ||
      lensDistortion === null ||
      lensVignette === null
    ) {
      throw new WebGLRendererError(
        "Uniforms u_tex/u_bypass/u_uvTransform/u_lensDistortion/u_lensVignette nicht gefunden",
      );
    }
    this.uniforms = {
      tex,
      bypass,
      uvTransform,
      lensDistortion,
      lensVignette,
      adjustments: adjustmentLocs,
    };
    gl.useProgram(this.program);
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
    gl.canvas.width = width;
    gl.canvas.height = height;
  }

  hasImage(): boolean {
    return this.texture !== null;
  }

  render(
    adjustments: Adjustments,
    bypass: boolean,
    uvTransform: Float32Array = IDENTITY_UV_TRANSFORM,
    lensDistortion = 0,
    lensVignette = 0,
  ): void {
    if (!this.texture) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniforms.tex, 0);
    gl.uniform1f(this.uniforms.bypass, bypass ? 1.0 : 0.0);
    gl.uniformMatrix3fv(this.uniforms.uvTransform, false, uvTransform);
    gl.uniform1f(this.uniforms.lensDistortion, lensDistortion);
    gl.uniform1f(this.uniforms.lensVignette, lensVignette);
    for (const [key, loc] of this.uniforms.adjustments) {
      gl.uniform1f(loc, adjustments[key as keyof Adjustments]);
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
