/**
 * GLSL-Shader fuer die WebGL2-Pipeline.
 * Reihenfolge der Operationen siehe docs/05-frontend-konzept.md "WebGL-Pipeline".
 *
 * Multi-Mask: bis zu MAX_LINEAR_MASKS lineare und MAX_RADIAL_MASKS radiale
 * Masken werden ueber Uniform-Arrays uebergeben. Die Schleife laeuft bis
 * u_numLinearMasks bzw. u_numRadialMasks (uniform-driven, WebGL2-zulaessig).
 */

export const VERT_SRC = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
uniform mat3 u_uvTransform;
out vec2 v_uv;
void main() {
  vec3 transformed = u_uvTransform * vec3(a_uv, 1.0);
  v_uv = transformed.xy;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

export const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform sampler2D u_toneCurveLut;
uniform float u_toneCurveActive;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform float u_temperature;
uniform float u_tint;
uniform float u_vibrance;
uniform float u_saturation;
uniform float u_sharpness;
uniform float u_noiseReduction;
uniform float u_highlightRecovery;
uniform float u_bypass;
uniform float u_lensDistortion;
uniform float u_lensVignette;
uniform float u_lensTcaR;
uniform float u_lensTcaB;

const int MAX_LINEAR_MASKS = 4;
const int MAX_RADIAL_MASKS = 4;
const int HSL_CHANNELS = 8;
const float HSL_SIGMA = 0.05;
const float HSL_HUE_GAIN = 0.1;
const float HSL_LUM_GAIN = 0.3;

uniform int u_numLinearMasks;
uniform vec2 u_linMaskP1[MAX_LINEAR_MASKS];
uniform vec2 u_linMaskP2[MAX_LINEAR_MASKS];
uniform float u_linMaskFeather[MAX_LINEAR_MASKS];
uniform float u_linLocalExposure[MAX_LINEAR_MASKS];
uniform float u_linLocalContrast[MAX_LINEAR_MASKS];
uniform float u_linLocalSaturation[MAX_LINEAR_MASKS];
uniform float u_linLocalTemperature[MAX_LINEAR_MASKS];

uniform int u_numRadialMasks;
uniform vec2 u_radMaskCenter[MAX_RADIAL_MASKS];
uniform vec2 u_radMaskRadii[MAX_RADIAL_MASKS];
uniform float u_radMaskFeather[MAX_RADIAL_MASKS];
uniform float u_radLocalExposure[MAX_RADIAL_MASKS];
uniform float u_radLocalContrast[MAX_RADIAL_MASKS];
uniform float u_radLocalSaturation[MAX_RADIAL_MASKS];
uniform float u_radLocalTemperature[MAX_RADIAL_MASKS];

uniform float u_hslHue[HSL_CHANNELS];
uniform float u_hslSat[HSL_CHANNELS];
uniform float u_hslLum[HSL_CHANNELS];

out vec4 outColor;

const float DISTORTION_GAIN = 0.4;
const float VIGNETTE_GAIN = 2.0;
const float TCA_GAIN = 0.05;

float computeLinearMaskN(int i, vec2 uv) {
  vec2 d = u_linMaskP2[i] - u_linMaskP1[i];
  float len2 = dot(d, d);
  if (len2 < 1e-8) return 0.0;
  float t = dot(uv - u_linMaskP1[i], d) / len2;
  float halfFeather = max(0.001, u_linMaskFeather[i] * 0.5);
  return smoothstep(0.5 - halfFeather, 0.5 + halfFeather, t);
}

float computeRadialMaskN(int i, vec2 uv) {
  vec2 r = max(u_radMaskRadii[i], vec2(0.001));
  vec2 d = (uv - u_radMaskCenter[i]) / r;
  float dist2 = dot(d, d);
  float halfFeather = max(0.001, u_radMaskFeather[i] * 0.5);
  return 1.0 - smoothstep(1.0 - halfFeather, 1.0 + halfFeather, dist2);
}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c));
}
vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(vec3(0.0031308), c));
}

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 rgbToHsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float h = 0.0, s = 0.0;
  float d = mx - mn;
  if (d > 1e-6) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}

float h2r(float p, float q, float t) {
  if (t < 0.0) t += 1.0;
  if (t > 1.0) t -= 1.0;
  if (t < 1.0/6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0/3.0) return p + (q - p) * (2.0/3.0 - t) * 6.0;
  return p;
}

vec3 hslToRgb(vec3 hsl) {
  float h = hsl.x, s = hsl.y, l = hsl.z;
  if (s < 1e-6) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  return vec3(h2r(p, q, h + 1.0/3.0), h2r(p, q, h), h2r(p, q, h - 1.0/3.0));
}

void main() {
  // Distortion (Brown-Conrady 1-Term) — vor Texture-Fetch.
  vec2 dc = v_uv - 0.5;
  float dr2 = dot(dc, dc);
  float kg = u_lensDistortion * DISTORTION_GAIN;
  vec2 src_uv = dc * (1.0 + kg * dr2) + 0.5;

  vec2 px = 1.0 / vec2(textureSize(u_tex, 0));
  // TCA: pro Channel eigener Distortion-Faktor. Wenn Slider beide auf 0,
  // greifen wir den gemeinsamen src-Sample, sparen 2 Texture-Reads.
  vec4 src;
  if (abs(u_lensTcaR) > 0.001 || abs(u_lensTcaB) > 0.001) {
    float kr = kg + u_lensTcaR * TCA_GAIN;
    float kb = kg + u_lensTcaB * TCA_GAIN;
    vec2 src_uv_r = dc * (1.0 + kr * dr2) + 0.5;
    vec2 src_uv_b = dc * (1.0 + kb * dr2) + 0.5;
    float r_ch = texture(u_tex, src_uv_r).r;
    float g_ch = texture(u_tex, src_uv).g;
    float b_ch = texture(u_tex, src_uv_b).b;
    float a_ch = texture(u_tex, src_uv).a;
    src = vec4(r_ch, g_ch, b_ch, a_ch);
  } else {
    src = texture(u_tex, src_uv);
  }

  // Noise-Reduction: 3x3 Bilateral-Light. Tonal-Sigma waechst mit
  // Slider — bei 1 mittelt der Filter staerker. wRange = 0.05 + (1-r)*0.3
  // sorgt dafuer, dass kleine Slider-Werte eher konservativ wirken.
  if (u_noiseReduction > 0.001) {
    vec3 sum = vec3(0.0);
    float wsum = 0.0;
    float tonalSigma = 0.05 + (1.0 - u_noiseReduction) * 0.3;
    for (int oy = -1; oy <= 1; oy++) {
      for (int ox = -1; ox <= 1; ox++) {
        vec3 sn = texture(u_tex, src_uv + vec2(float(ox), float(oy)) * px).rgb;
        float dl = luminance(sn) - luminance(src.rgb);
        float wt = exp(-(dl * dl) / (tonalSigma * tonalSigma));
        // Spatial-Kernel: Mitte 1, Kanten 0.5, Diagonalen 0.25.
        float wsx = (ox == 0 ? 1.0 : 0.5);
        float wsy = (oy == 0 ? 1.0 : 0.5);
        float w = wt * wsx * wsy;
        sum += sn * w;
        wsum += w;
      }
    }
    vec3 denoised = sum / max(wsum, 1e-4);
    src.rgb = mix(src.rgb, denoised, u_noiseReduction);
  }

  if (u_bypass > 0.5) { outColor = src; return; }

  // Lokale Masken summieren: effective = global + Sum_i(maskFactor_i * local_i).
  float effExposure    = u_exposure;
  float effContrast    = u_contrast;
  float effSaturation  = u_saturation;
  float effTemperature = u_temperature;

  for (int i = 0; i < MAX_LINEAR_MASKS; i++) {
    if (i >= u_numLinearMasks) break;
    float m = computeLinearMaskN(i, v_uv);
    effExposure    += m * u_linLocalExposure[i];
    effContrast    += m * u_linLocalContrast[i];
    effSaturation  += m * u_linLocalSaturation[i];
    effTemperature += m * u_linLocalTemperature[i];
  }
  for (int i = 0; i < MAX_RADIAL_MASKS; i++) {
    if (i >= u_numRadialMasks) break;
    float m = computeRadialMaskN(i, v_uv);
    effExposure    += m * u_radLocalExposure[i];
    effContrast    += m * u_radLocalContrast[i];
    effSaturation  += m * u_radLocalSaturation[i];
    effTemperature += m * u_radLocalTemperature[i];
  }

  // 1. sRGB -> Linear
  vec3 lin = srgbToLinear(src.rgb);

  // 2. Weissabgleich (in linear): Temperatur shiftet R/B, Tint shiftet G vs M
  float tempK = effTemperature * 0.4;
  float tintK = u_tint * 0.3;
  lin.r *= 1.0 + tempK;
  lin.b *= 1.0 - tempK;
  lin.g *= 1.0 + tintK;
  lin.r *= 1.0 - tintK * 0.5;
  lin.b *= 1.0 - tintK * 0.5;

  // 3. Belichtung (linear)
  lin *= pow(2.0, effExposure);
  lin = max(lin, 0.0);

  // 4. Linear -> sRGB fuer perzeptive Tonwertarbeit
  vec3 c = linearToSrgb(lin);
  c = clamp(c, 0.0, 2.0);

  // 5. Tonwertbereiche via Luminanz-Masken
  float L = luminance(c);
  float shadowMask    = smoothstep(0.55, 0.0, L);
  float highlightMask = smoothstep(0.45, 1.0, L);
  float blackMask     = smoothstep(0.25, 0.0, L);
  float whiteMask     = smoothstep(0.75, 1.0, L);
  c += u_shadows    * 0.30 * shadowMask;
  c += u_highlights * 0.30 * highlightMask;
  c += u_blacks     * 0.25 * blackMask;
  c += u_whites     * 0.25 * whiteMask;

  // 6. Kontrast um 0.5
  c = (c - 0.5) * (1.0 + effContrast) + 0.5;
  c = clamp(c, 0.0, 1.0);

  // 7. Saettigung & Dynamik in HSL
  vec3 hsl = rgbToHsl(c);
  float vibBoost = u_vibrance * (1.0 - hsl.y) * (1.0 - hsl.y);
  hsl.y = clamp(hsl.y + vibBoost, 0.0, 1.0);
  hsl.y = clamp(hsl.y * (1.0 + effSaturation), 0.0, 1.0);

  // 7b. HSL-Mischer: pro Farbtonbereich Hue/Saturation/Luminance shiften.
  // Bell-Funktion (Gauss) gewichtet die 8 Center-Hues. Wenn alle 24 Werte
  // 0 sind, ergibt der Block keine Aenderung.
  float wSum = 0.0;
  float dHue = 0.0;
  float dSat = 0.0;
  float dLum = 0.0;
  float centers[HSL_CHANNELS] = float[](
    0.0, 0.0833, 0.1667, 0.3333, 0.5, 0.6667, 0.75, 0.8333
  );
  for (int i = 0; i < HSL_CHANNELS; i++) {
    float dx = abs(hsl.x - centers[i]);
    dx = min(dx, 1.0 - dx);
    float w = exp(-(dx * dx) / (HSL_SIGMA * HSL_SIGMA));
    dHue += w * u_hslHue[i];
    dSat += w * u_hslSat[i];
    dLum += w * u_hslLum[i];
    wSum += w;
  }
  if (wSum > 1e-4) {
    hsl.x = mod(hsl.x + dHue / wSum * HSL_HUE_GAIN + 1.0, 1.0);
    hsl.y = clamp(hsl.y * (1.0 + dSat / wSum), 0.0, 1.0);
    hsl.z = clamp(hsl.z + dLum / wSum * HSL_LUM_GAIN, 0.0, 1.0);
  }
  c = hslToRgb(hsl);

  // 7c. Tonkurve (Luminanz). LUT 256x1 R8 wird im JS als
  // Monotone-Hermite-Interpolation gerechnet und hier nur gesampled.
  if (u_toneCurveActive > 0.5) {
    float L = luminance(c);
    float newL = texture(u_toneCurveLut, vec2(L, 0.5)).r;
    if (L > 1e-4) {
      c *= newL / L;
      c = clamp(c, 0.0, 1.0);
    }
  }

  // 7c2. Highlight-Recovery (RawTherapee Blend-Modus, vereinfacht):
  // Geclippte Channels werden auf den Mittelwert der noch nicht
  // clipped Channels gezogen. Wenn 1-2 Channels clipped, verschwindet
  // der typische Magenta-Cast (gruen-clipped) bzw. Cyan-Cast
  // (rot-clipped); wenn alle 3 clipped, ist es echtes Weiss und
  // bleibt unveraendert.
  if (u_highlightRecovery > 0.001) {
    float thr = 0.94;
    vec3 isClipped = step(vec3(thr), c);
    float n = isClipped.r + isClipped.g + isClipped.b;
    if (n > 0.5 && n < 2.5) {
      vec3 unclipped = c * (1.0 - isClipped);
      float refValue = (unclipped.r + unclipped.g + unclipped.b) / max(0.001, 3.0 - n);
      vec3 recovered = mix(c, vec3(refValue), isClipped);
      c = mix(c, recovered, u_highlightRecovery);
    }
  }

  // 7d. Sharpening (Unsharp-Mask, 4-Tap-Laplacian aus u_tex).
  // Bewusst auf den Quell-Pixeln berechnet — fuer ein 1-Pass-Shader
  // genuegt das, statt die ganze Pipeline pro Nachbar zu replayen.
  if (u_sharpness > 0.001) {
    vec3 cn = texture(u_tex, src_uv + vec2( 0.0, -px.y)).rgb;
    vec3 cs = texture(u_tex, src_uv + vec2( 0.0,  px.y)).rgb;
    vec3 cw = texture(u_tex, src_uv + vec2(-px.x, 0.0)).rgb;
    vec3 ce = texture(u_tex, src_uv + vec2( px.x, 0.0)).rgb;
    vec3 hf = src.rgb - (cn + cs + cw + ce) * 0.25;
    c = clamp(c + hf * u_sharpness * 1.5, 0.0, 1.0);
  }

  // 8. Vignette (radial, am Ende der Pipeline)
  float vr2 = dot(dc, dc);
  c *= 1.0 + u_lensVignette * VIGNETTE_GAIN * vr2;
  c = clamp(c, 0.0, 1.0);

  outColor = vec4(c, src.a);
}`;
