// WGSL-Port des Fragment-Shaders aus frontend/src/editor/shaders.ts (GLSL ES 3.00).
//
// Spike-Umfang: genau der Pfad, den die Ton-Grundregler durchlaufen —
// Quelle lesen -> Weissabgleich -> Belichtung -> toneProcessV1 bzw.
// toneProcessV2 -> sRGB-Ausgabe. Reihenfolge, Klemmungen und Konstanten
// 1:1 wie im GLSL. Ausgelassene Stufen sind mit "N2:" markiert; mit ihren
// Neutralwerten (bypass=false, Linse 0, keine Masken, hsl null, toneCurve
// null, uvTransform Identitaet) sind sie im GLSL ohne Wirkung.
//
// Der Shader schreibt sRGB-kodierte Werte in ein Unorm-Ziel (kein *Srgb-
// Format), wie WebGL in den RGBA8-Drawingbuffer.

struct Params {
  exposure: f32,
  contrast: f32,
  highlights: f32,
  shadows: f32,
  whites: f32,
  blacks: f32,
  temperature: f32,
  tint: f32,
  process_version: u32,
  _pad0: u32,
  target_size: vec2<f32>,
}

@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var src_tex: texture_2d<f32>;
@group(0) @binding(2) var src_sampler: sampler;

// Fullscreen-Triangle: (-1,-1), (3,-1), (-1,3).
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  let x = f32(i32(i & 1u) * 4 - 1);
  let y = f32(i32(i >> 1u) * 4 - 1);
  return vec4<f32>(x, y, 0.0, 1.0);
}

// GLSL-smoothstep nach Spezifikation (t = clamp((x-e0)/(e1-e0))), auch fuer
// e0 > e1 wie in toneProcessV1. Das WGSL-Builtin verbietet das bei Konstanten.
fn ss(e0: f32, e1: f32, x: f32) -> f32 {
  let t = clamp((x - e0) / (e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// GLSL mix(a, b, step(edge, c)) als select: gleiches Ergebnis, aber ohne
// NaN-Durchschlag, falls pow(0, y) auf einem Treiber NaN liefert.
fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  return select(c / 12.92, pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c >= vec3<f32>(0.04045));
}

fn linear_to_srgb(c_in: vec3<f32>) -> vec3<f32> {
  let c = max(c_in, vec3<f32>(0.0));
  return select(
    c * 12.92,
    1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055,
    c >= vec3<f32>(0.0031308),
  );
}

fn luminance(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// ----- Prozessversion 1: Tonwertarbeit im Display-Raum (toneProcessV1). -----
fn tone_process_v1(lin: vec3<f32>, eff_contrast: f32) -> vec3<f32> {
  // 4. Linear -> sRGB fuer perzeptive Tonwertarbeit
  var c = linear_to_srgb(lin);
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(2.0));

  // 5. Tonwertbereiche via Luminanz-Masken
  let l = luminance(c);
  let shadow_mask = ss(0.55, 0.0, l);
  let highlight_mask = ss(0.45, 1.0, l);
  let black_mask = ss(0.25, 0.0, l);
  let white_mask = ss(0.75, 1.0, l);
  c += u.shadows * 0.30 * shadow_mask;
  c += u.highlights * 0.30 * highlight_mask;
  c += u.blacks * 0.25 * black_mask;
  c += u.whites * 0.25 * white_mask;

  // 6. Kontrast um 0.5
  c = (c - 0.5) * (1.0 + eff_contrast) + 0.5;
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
  return c;
}

// ----- Prozessversion 2: szenenbezogene Tonabbildung (toneProcessV2). -----
// Konstanten = TONEMAP_GLSL_CONSTANTS in frontend/src/editor/tonemap.ts.
const TM_PIVOT: f32 = 0.18;
const TM_EPS: f32 = 0.00001;
const TM_KNEE: f32 = 0.955;
const TM_TAIL: f32 = 0.3;
const TM_PTW_EV: f32 = 5.0;
const TM_SHADOWS_GAIN: f32 = 2.5;
const TM_SHADOWS_LO: f32 = -3.0;
const TM_SHADOWS_HI: f32 = 0.5;
const TM_HIGHLIGHTS_GAIN: f32 = 1.5;
const TM_HIGHLIGHTS_LO: f32 = -0.5;
const TM_HIGHLIGHTS_HI: f32 = 2.5;
const TM_BLACKS_GAIN: f32 = 2.0;
const TM_BLACKS_LO: f32 = -4.5;
const TM_BLACKS_HI: f32 = -1.5;
const TM_WHITES_GAIN: f32 = 1.0;
const TM_WHITES_LO: f32 = 1.0;
const TM_WHITES_HI: f32 = 3.0;

// Log-Belichtung relativ zu Mittelgrau.
fn tm_ev(lin: vec3<f32>) -> f32 {
  return log2(max(luminance(lin), TM_EPS) / TM_PIVOT);
}

// Schulter: Identitaet bis zum Knie, danach C1-stetiger Potenz-Auslauf gegen 1.
fn tm_shoulder(x: f32) -> f32 {
  if (x <= TM_KNEE) {
    return x;
  }
  let w = 1.0 - TM_KNEE;
  return 1.0 - w * pow(1.0 + (x - TM_KNEE) / (TM_TAIL * w), -TM_TAIL);
}

fn tone_process_v2(lin_in: vec3<f32>, eff_contrast: f32) -> vec3<f32> {
  var lin = lin_in;
  // Tonbereiche als Belichtungs-Gains im Log-Raum (ein Faktor fuer alle Kanaele).
  let ev = tm_ev(lin);
  let tone_ev =
      u.shadows * TM_SHADOWS_GAIN * (1.0 - ss(TM_SHADOWS_LO, TM_SHADOWS_HI, ev))
    + u.highlights * TM_HIGHLIGHTS_GAIN * ss(TM_HIGHLIGHTS_LO, TM_HIGHLIGHTS_HI, ev)
    + u.blacks * TM_BLACKS_GAIN * (1.0 - ss(TM_BLACKS_LO, TM_BLACKS_HI, ev))
    + u.whites * TM_WHITES_GAIN * ss(TM_WHITES_LO, TM_WHITES_HI, ev);
  lin *= exp2(tone_ev);

  // Kontrast im Log-Raum um Mittelgrau, keine harte Begrenzung.
  lin *= exp2(tm_ev(lin) * eff_contrast);

  // Display-Transform: Schulter auf max(r,g,b), als Verhaeltnis angewandt.
  let n = max(lin.r, max(lin.g, lin.b));
  if (n <= 1e-6) {
    return vec3<f32>(0.0);
  }
  let f_n = tm_shoulder(n);
  var c = linear_to_srgb(lin * (f_n / n));
  // Path to white: ab Sensor-Weiss Richtung Weiss entsaettigen.
  let d = ss(0.0, TM_PTW_EV, log2(n));
  let white = linear_to_srgb(vec3<f32>(f_n)).r;
  c = mix(c, vec3<f32>(white), d);
  return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs_main(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
  // v_uv wie im WebGL-Quad: Pixelmitte / Zielgroesse, Zeile 0 oben.
  // N2: u_uvTransform (Crop/Rotation) — im Spike Identitaet.
  let v_uv = pos.xy / u.target_size;

  // Distortion vor dem Texture-Fetch; mit u_lensDistortion = 0 ist kg = 0.
  // N2: u_lensDistortion, TCA (u_lensTcaR/B).
  let dc = v_uv - 0.5;
  let src_uv = dc + 0.5;
  let src = textureSampleLevel(src_tex, src_sampler, src_uv, 0.0);

  // N2: Noise-Reduction (3x3 bilateral), Bypass.
  // N2: lineare/radiale Masken — eff* = globale Regler.
  let eff_exposure = u.exposure;
  let eff_contrast = u.contrast;
  let eff_temperature = u.temperature;

  // 1. sRGB -> Linear
  var lin = srgb_to_linear(src.rgb);

  // 2. Weissabgleich (in linear): Temperatur shiftet R/B, Tint shiftet G vs M
  let temp_k = eff_temperature * 0.4;
  let tint_k = u.tint * 0.3;
  lin.r *= 1.0 + temp_k;
  lin.b *= 1.0 - temp_k;
  lin.g *= 1.0 + tint_k;
  lin.r *= 1.0 - tint_k * 0.5;
  lin.b *= 1.0 - tint_k * 0.5;

  // 3. Belichtung (linear)
  lin *= pow(2.0, eff_exposure);
  lin = max(lin, vec3<f32>(0.0));

  // 4.-6. Tonwertarbeit nach Prozessversion (uniformer Zweig).
  var c: vec3<f32>;
  if (u.process_version >= 2u) {
    c = tone_process_v2(lin, eff_contrast);
  } else {
    c = tone_process_v1(lin, eff_contrast);
  }

  // N2: 7. Saettigung/Dynamik (HSL-Rundreise, bei 0 ohne Wirkung auf [0,1]).
  // N2: 7b. HSL-Mischer, 7c. Tonkurve, 7c2. Highlight-Recovery,
  // N2: 7d. Sharpening, 7e. Local Contrast.

  // 8. Vignette: mit u_lensVignette = 0 bleibt nur die Klemmung.
  // N2: u_lensVignette.
  c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));

  return vec4<f32>(c, src.a);
}
