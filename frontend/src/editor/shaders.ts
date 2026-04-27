/**
 * GLSL-Shader fuer die WebGL2-Pipeline.
 * Reihenfolge der Operationen siehe docs/05-frontend-konzept.md "WebGL-Pipeline".
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
uniform float u_bypass;
uniform float u_lensDistortion;
uniform float u_lensVignette;
uniform float u_maskEnabled;
uniform vec2 u_maskP1;
uniform vec2 u_maskP2;
uniform float u_maskFeather;
uniform float u_localExposure;
uniform float u_localContrast;
uniform float u_localSaturation;
uniform float u_localTemperature;
uniform float u_radialEnabled;
uniform vec2 u_radialCenter;
uniform vec2 u_radialRadii;
uniform float u_radialFeather;
uniform float u_radialLocalExposure;
uniform float u_radialLocalContrast;
uniform float u_radialLocalSaturation;
uniform float u_radialLocalTemperature;
out vec4 outColor;

const float DISTORTION_GAIN = 0.4;
const float VIGNETTE_GAIN = 2.0;

float computeLinearMask(vec2 uv) {
  vec2 d = u_maskP2 - u_maskP1;
  float len2 = dot(d, d);
  if (len2 < 1e-8) return 0.0;
  float t = dot(uv - u_maskP1, d) / len2;
  float halfFeather = max(0.001, u_maskFeather * 0.5);
  return smoothstep(0.5 - halfFeather, 0.5 + halfFeather, t);
}

float computeRadialMask(vec2 uv) {
  vec2 r = max(u_radialRadii, vec2(0.001));
  vec2 d = (uv - u_radialCenter) / r;
  float dist2 = dot(d, d);
  float halfFeather = max(0.001, u_radialFeather * 0.5);
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
  float k1 = u_lensDistortion * DISTORTION_GAIN;
  vec2 src_uv = dc * (1.0 + k1 * dr2) + 0.5;

  vec4 src = texture(u_tex, src_uv);
  if (u_bypass > 0.5) { outColor = src; return; }

  // Lokale Masken einmal pro Pixel berechnen, dann effektive
  // Adjustment-Werte = global + linMaskFactor * linLocal + radMaskFactor * radLocal.
  float mLin = u_maskEnabled > 0.5 ? computeLinearMask(v_uv) : 0.0;
  float mRad = u_radialEnabled > 0.5 ? computeRadialMask(v_uv) : 0.0;
  float effExposure    = u_exposure
    + mLin * u_localExposure    + mRad * u_radialLocalExposure;
  float effContrast    = u_contrast
    + mLin * u_localContrast    + mRad * u_radialLocalContrast;
  float effSaturation  = u_saturation
    + mLin * u_localSaturation  + mRad * u_radialLocalSaturation;
  float effTemperature = u_temperature
    + mLin * u_localTemperature + mRad * u_radialLocalTemperature;

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
  c = hslToRgb(hsl);

  // 8. Vignette (radial, am Ende der Pipeline)
  float vr2 = dot(dc, dc);
  c *= 1.0 + u_lensVignette * VIGNETTE_GAIN * vr2;
  c = clamp(c, 0.0, 1.0);

  outColor = vec4(c, src.a);
}`;
