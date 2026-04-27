import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';

// =====================================================================
// SHADERS
// =====================================================================

const VERT_SRC = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
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
out vec4 outColor;

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
  vec4 src = texture(u_tex, v_uv);
  if (u_bypass > 0.5) { outColor = src; return; }

  // 1. sRGB -> Linear
  vec3 lin = srgbToLinear(src.rgb);

  // 2. Weissabgleich (in linear): Temperatur shiftet R/B, Tint shiftet G vs M
  float tempK = u_temperature * 0.4;
  float tintK = u_tint * 0.3;
  lin.r *= 1.0 + tempK;
  lin.b *= 1.0 - tempK;
  lin.g *= 1.0 + tintK;
  lin.r *= 1.0 - tintK * 0.5;
  lin.b *= 1.0 - tintK * 0.5;

  // 3. Belichtung (linear)
  lin *= pow(2.0, u_exposure);
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
  c = (c - 0.5) * (1.0 + u_contrast) + 0.5;
  c = clamp(c, 0.0, 1.0);

  // 7. Saettigung & Dynamik in HSL
  vec3 hsl = rgbToHsl(c);
  // Vibrance: skaliert nichtlinear mit Abstand zu max
  float vibBoost = u_vibrance * (1.0 - hsl.y) * (1.0 - hsl.y);
  hsl.y = clamp(hsl.y + vibBoost, 0.0, 1.0);
  // Sattigung linear
  hsl.y = clamp(hsl.y * (1.0 + u_saturation), 0.0, 1.0);
  c = hslToRgb(hsl);

  outColor = vec4(c, src.a);
}`;

// =====================================================================
// WebGL Helper
// =====================================================================

function compileShader(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('Shader compile error: ' + log);
  }
  return sh;
}

function createProgram(gl) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

// =====================================================================
// DEFAULTS & ADJUSTMENT DEFINITIONS
// =====================================================================

const ADJUSTMENTS = [
  { key: 'exposure',    label: 'Belichtung',  min: -5,  max: 5,  step: 0.01, default: 0, group: 'Licht' },
  { key: 'contrast',    label: 'Kontrast',    min: -1,  max: 1,  step: 0.01, default: 0, group: 'Licht' },
  { key: 'highlights',  label: 'Lichter',     min: -1,  max: 1,  step: 0.01, default: 0, group: 'Licht' },
  { key: 'shadows',     label: 'Tiefen',      min: -1,  max: 1,  step: 0.01, default: 0, group: 'Licht' },
  { key: 'whites',      label: 'Weiß',        min: -1,  max: 1,  step: 0.01, default: 0, group: 'Licht' },
  { key: 'blacks',      label: 'Schwarz',     min: -1,  max: 1,  step: 0.01, default: 0, group: 'Licht' },
  { key: 'temperature', label: 'Temperatur',  min: -1,  max: 1,  step: 0.01, default: 0, group: 'Farbe' },
  { key: 'tint',        label: 'Farbton',     min: -1,  max: 1,  step: 0.01, default: 0, group: 'Farbe' },
  { key: 'vibrance',    label: 'Dynamik',     min: -1,  max: 1,  step: 0.01, default: 0, group: 'Farbe' },
  { key: 'saturation',  label: 'Sättigung',   min: -1,  max: 1,  step: 0.01, default: 0, group: 'Farbe' },
];

const defaultAdjustments = () =>
  ADJUSTMENTS.reduce((acc, a) => ({ ...acc, [a.key]: a.default }), {});

const formatVal = (v, key) => {
  if (key === 'exposure') return (v >= 0 ? '+' : '') + v.toFixed(2);
  return Math.round(v * 100).toString();
};

// =====================================================================
// PRESET STORAGE
// In Production: ersetze durch fetch('/api/presets', ...)
// =====================================================================

const PresetAPI = {
  async list() {
    try {
      const res = await window.storage.list('preset:');
      if (!res || !res.keys) return [];
      const out = [];
      for (const k of res.keys) {
        try {
          const r = await window.storage.get(k);
          if (r) out.push({ key: k, ...JSON.parse(r.value) });
        } catch {}
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    } catch { return []; }
  },
  async save(name, adjustments) {
    const id = 'preset:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    const payload = { id, name, adjustments, createdAt: new Date().toISOString() };
    await window.storage.set(id, JSON.stringify(payload));
    return payload;
  },
  async remove(key) {
    try { await window.storage.delete(key); } catch {}
  },
};

// =====================================================================
// CUSTOM SLIDER
// =====================================================================

function Slider({ label, value, onChange, min, max, step, defaultValue, valueKey }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startValRef = useRef(0);

  const range = max - min;
  const pct = ((value - min) / range) * 100;
  const centerPct = ((defaultValue - min) / range) * 100;
  const isDefault = Math.abs(value - defaultValue) < 1e-4;

  const setFromX = useCallback((clientX) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const raw = min + t * range;
    const snapped = Math.round(raw / step) * step;
    onChange(Math.max(min, Math.min(max, snapped)));
  }, [min, max, step, range, onChange]);

  const onPointerDown = (e) => {
    e.target.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startValRef.current = value;
    setFromX(e.clientX);
  };
  const onPointerMove = (e) => {
    if (!draggingRef.current) return;
    setFromX(e.clientX);
  };
  const onPointerUp = (e) => {
    draggingRef.current = false;
    e.target.releasePointerCapture?.(e.pointerId);
  };
  const onDoubleClick = () => onChange(defaultValue);

  return (
    <div className="group select-none py-1.5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] tracking-wide uppercase text-stone-400" style={{ fontFamily: 'Bricolage Grotesque, sans-serif', letterSpacing: '0.08em' }}>
          {label}
        </span>
        <span
          className={`text-[12px] tabular-nums ${isDefault ? 'text-stone-500' : 'text-amber-200'}`}
          style={{ fontFamily: 'JetBrains Mono, monospace' }}
        >
          {formatVal(value, valueKey)}
        </span>
      </div>
      <div
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
        className="relative h-5 cursor-ew-resize touch-none"
        title="Ziehen zum Ändern, Doppelklick = Reset"
      >
        {/* Track */}
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-stone-700" />
        {/* Center mark */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-px h-2 bg-stone-600"
          style={{ left: `${centerPct}%` }}
        />
        {/* Filled portion (from center to value) */}
        <div
          className="absolute top-1/2 -translate-y-1/2 h-px bg-amber-300/70"
          style={{
            left: `${Math.min(centerPct, pct)}%`,
            width: `${Math.abs(pct - centerPct)}%`,
          }}
        />
        {/* Thumb */}
        <div
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-stone-200 ring-1 ring-stone-900 shadow-sm transition-transform group-hover:scale-125"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// =====================================================================
// HISTOGRAM
// =====================================================================

function Histogram({ canvas, deps }) {
  const histRef = useRef(null);
  const [bins, setBins] = useState(null);

  useEffect(() => {
    if (!canvas) return;
    const id = requestAnimationFrame(() => {
      try {
        // Downsample for speed
        const w = 128, h = 128;
        const off = document.createElement('canvas');
        off.width = w; off.height = h;
        const ctx = off.getContext('2d');
        ctx.drawImage(canvas, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;

        const r = new Uint32Array(64);
        const g = new Uint32Array(64);
        const b = new Uint32Array(64);
        for (let i = 0; i < data.length; i += 4) {
          r[(data[i] >> 2)]++;
          g[(data[i+1] >> 2)]++;
          b[(data[i+2] >> 2)]++;
        }
        const max = Math.max(
          ...Array.from(r), ...Array.from(g), ...Array.from(b)
        ) || 1;
        setBins({ r, g, b, max });
      } catch (e) { /* canvas not ready */ }
    });
    return () => cancelAnimationFrame(id);
  }, [canvas, deps]);

  return (
    <div className="h-20 w-full bg-stone-950 rounded-sm border border-stone-800/60 overflow-hidden relative">
      {bins && (
        <svg viewBox="0 0 64 40" preserveAspectRatio="none" className="w-full h-full">
          {['r', 'g', 'b'].map((ch, i) => {
            const arr = bins[ch];
            const path = Array.from(arr).map((v, x) => {
              const y = 40 - (v / bins.max) * 38;
              return `${x === 0 ? 'M' : 'L'}${x},${y}`;
            }).join(' ') + ` L63,40 L0,40 Z`;
            const fill = ['#ef4444', '#22c55e', '#3b82f6'][i];
            return <path key={ch} d={path} fill={fill} fillOpacity="0.35" style={{ mixBlendMode: 'screen' }} />;
          })}
        </svg>
      )}
    </div>
  );
}

// =====================================================================
// MAIN APP
// =====================================================================

export default function App() {
  const canvasRef = useRef(null);
  const glRef = useRef(null);
  const progRef = useRef(null);
  const texRef = useRef(null);
  const uniformsRef = useRef({});
  const imageDimsRef = useRef({ w: 0, h: 0 });

  const [hasImage, setHasImage] = useState(false);
  const [adj, setAdj] = useState(defaultAdjustments());
  const [bypass, setBypass] = useState(false); // Vorher/Nachher
  const [presets, setPresets] = useState([]);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [histTick, setHistTick] = useState(0);

  // Init WebGL
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) {
      console.error('WebGL2 nicht verfügbar');
      return;
    }
    glRef.current = gl;
    const prog = createProgram(gl);
    progRef.current = prog;

    // Quad
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    const uvLoc  = gl.getAttribLocation(prog, 'a_uv');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

    // Uniform locations
    const uniforms = {};
    ['u_tex', 'u_bypass', ...ADJUSTMENTS.map(a => 'u_' + a.key)].forEach(name => {
      uniforms[name] = gl.getUniformLocation(prog, name);
    });
    uniformsRef.current = uniforms;
    gl.useProgram(prog);
  }, []);

  // Load presets
  useEffect(() => { PresetAPI.list().then(setPresets); }, []);

  // Render whenever adjustments or bypass change
  const render = useCallback(() => {
    const gl = glRef.current;
    const prog = progRef.current;
    if (!gl || !prog || !texRef.current) return;
    const u = uniformsRef.current;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texRef.current);
    gl.uniform1i(u.u_tex, 0);
    gl.uniform1f(u.u_bypass, bypass ? 1.0 : 0.0);
    ADJUSTMENTS.forEach(a => {
      gl.uniform1f(u['u_' + a.key], adj[a.key]);
    });
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    setHistTick(t => t + 1);
  }, [adj, bypass]);

  useEffect(() => { render(); }, [render]);

  // Image loading
  const loadImage = useCallback((file) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const gl = glRef.current;
      if (!gl) return;
      // Fit image into canvas at max 1600 width while keeping aspect
      const maxW = 1600;
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = canvasRef.current;
      canvas.width = w;
      canvas.height = h;
      imageDimsRef.current = { w, h };

      // Upload texture
      if (texRef.current) gl.deleteTexture(texRef.current);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      texRef.current = tex;
      setHasImage(true);
      URL.revokeObjectURL(url);
      requestAnimationFrame(render);
    };
    img.src = url;
  }, [render]);

  const onFileInput = (e) => {
    const f = e.target.files?.[0];
    if (f) loadImage(f);
  };
  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) loadImage(f);
  };

  const updateAdj = (key, value) => setAdj(prev => ({ ...prev, [key]: value }));
  const resetAll = () => setAdj(defaultAdjustments());

  // Presets
  const savePreset = async () => {
    if (!presetName.trim()) return;
    await PresetAPI.save(presetName.trim(), adj);
    setPresets(await PresetAPI.list());
    setPresetName('');
    setShowSaveDialog(false);
  };
  const applyPreset = (p) => setAdj({ ...defaultAdjustments(), ...p.adjustments });
  const deletePreset = async (key) => {
    await PresetAPI.remove(key);
    setPresets(await PresetAPI.list());
  };

  const exportImage = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'export-' + Date.now() + '.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  };

  const groups = useMemo(() => {
    const g = {};
    ADJUSTMENTS.forEach(a => { (g[a.group] ||= []).push(a); });
    return g;
  }, []);

  return (
    <div className="min-h-screen w-full bg-stone-950 text-stone-200 flex flex-col" style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;1,9..144,300&family=Bricolage+Grotesque:opsz,wght@12..96,300;12..96,400;12..96,500&family=JetBrains+Mono:wght@400;500&display=swap');
        body { background: #0a0908; }
        .grain::before {
          content: ''; position: absolute; inset: 0; pointer-events: none;
          background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.06 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
          mix-blend-mode: overlay; opacity: 0.6;
        }
      `}</style>

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-stone-800/80">
        <div className="flex items-baseline gap-3">
          <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: '22px', letterSpacing: '-0.02em' }}>
            <span className="italic text-amber-200/90">Lumen</span>
            <span className="text-stone-400"> · light</span>
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-stone-600" style={{ fontFamily: 'JetBrains Mono, monospace' }}>v0.1 prototype</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="px-3 py-1.5 text-xs uppercase tracking-wider border border-stone-700 hover:border-amber-300/50 hover:text-amber-200 cursor-pointer transition-colors">
            Bild öffnen
            <input type="file" accept="image/*" className="hidden" onChange={onFileInput} />
          </label>
          <button
            disabled={!hasImage}
            onClick={exportImage}
            className="px-3 py-1.5 text-xs uppercase tracking-wider border border-stone-700 hover:border-amber-300/50 hover:text-amber-200 disabled:opacity-30 disabled:hover:border-stone-700 disabled:hover:text-stone-200 transition-colors"
          >
            Exportieren
          </button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex min-h-0">
        {/* Canvas area */}
        <main
          className="flex-1 relative grain overflow-hidden flex items-center justify-center p-8"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{ background: 'radial-gradient(ellipse at center, #18130e 0%, #0a0908 70%)' }}
        >
          <canvas
            ref={canvasRef}
            className={`max-w-full max-h-full shadow-2xl shadow-black ${hasImage ? 'block' : 'hidden'}`}
            style={{ imageRendering: 'auto' }}
          />
          {!hasImage && (
            <div className="text-center text-stone-500 select-none">
              <div style={{ fontFamily: 'Fraunces, serif', fontSize: '32px', fontWeight: 300, fontStyle: 'italic' }} className="text-stone-600 mb-2">
                Bild hier ablegen
              </div>
              <div className="text-xs uppercase tracking-[0.3em] text-stone-700">oder oben öffnen</div>
            </div>
          )}

          {hasImage && (
            <button
              onMouseDown={() => setBypass(true)}
              onMouseUp={() => setBypass(false)}
              onMouseLeave={() => setBypass(false)}
              onTouchStart={() => setBypass(true)}
              onTouchEnd={() => setBypass(false)}
              className="absolute bottom-6 left-6 px-3 py-1.5 text-[10px] uppercase tracking-[0.2em] bg-stone-900/80 backdrop-blur border border-stone-700 hover:border-amber-300/40 text-stone-300"
            >
              {bypass ? 'Original' : 'Halten für Original'}
            </button>
          )}
        </main>

        {/* Right panel */}
        <aside className="w-[320px] border-l border-stone-800/80 bg-stone-950/60 flex flex-col min-h-0">
          {/* Histogram */}
          <div className="p-4 border-b border-stone-800/60">
            <div className="text-[10px] uppercase tracking-[0.2em] text-stone-500 mb-2">Histogramm</div>
            <Histogram canvas={hasImage ? canvasRef.current : null} deps={histTick} />
          </div>

          {/* Adjustments */}
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {Object.entries(groups).map(([group, items]) => (
              <div key={group} className="mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontStyle: 'italic', fontSize: '15px' }} className="text-stone-300">
                    {group}
                  </span>
                  <div className="flex-1 h-px bg-stone-800" />
                </div>
                {items.map(a => (
                  <Slider
                    key={a.key}
                    label={a.label}
                    value={adj[a.key]}
                    defaultValue={a.default}
                    min={a.min} max={a.max} step={a.step}
                    valueKey={a.key}
                    onChange={(v) => updateAdj(a.key, v)}
                  />
                ))}
              </div>
            ))}
            <button
              onClick={resetAll}
              className="w-full mt-2 py-2 text-[10px] uppercase tracking-[0.25em] text-stone-500 hover:text-amber-200 border border-stone-800 hover:border-amber-300/40 transition-colors"
            >
              Alles zurücksetzen
            </button>
          </div>

          {/* Presets */}
          <div className="border-t border-stone-800/80 p-4">
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontStyle: 'italic', fontSize: '15px' }} className="text-stone-300">
                Voreinstellungen
              </span>
              <button
                onClick={() => setShowSaveDialog(true)}
                disabled={!hasImage}
                className="text-[10px] uppercase tracking-wider text-stone-500 hover:text-amber-200 disabled:opacity-30"
              >
                + Speichern
              </button>
            </div>
            {showSaveDialog && (
              <div className="mb-3 p-2 border border-stone-700 bg-stone-900/50">
                <input
                  autoFocus
                  type="text"
                  placeholder="Name der Voreinstellung"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') savePreset(); if (e.key === 'Escape') setShowSaveDialog(false); }}
                  className="w-full bg-transparent outline-none text-sm text-stone-200 px-1 py-1 border-b border-stone-700 focus:border-amber-300/50"
                  style={{ fontFamily: 'Bricolage Grotesque, sans-serif' }}
                />
                <div className="flex gap-2 mt-2">
                  <button onClick={savePreset} className="text-[10px] uppercase tracking-wider text-amber-200 hover:text-amber-100">Sichern</button>
                  <button onClick={() => setShowSaveDialog(false)} className="text-[10px] uppercase tracking-wider text-stone-500">Abbrechen</button>
                </div>
              </div>
            )}
            <div className="space-y-1 max-h-32 overflow-y-auto">
              {presets.length === 0 && (
                <div className="text-[11px] text-stone-600 italic">Noch keine Voreinstellungen</div>
              )}
              {presets.map(p => (
                <div key={p.key} className="group flex items-center justify-between hover:bg-stone-900/60 px-2 py-1 rounded-sm">
                  <button onClick={() => applyPreset(p)} className="text-xs text-stone-300 hover:text-amber-200 text-left flex-1 truncate">
                    {p.name}
                  </button>
                  <button onClick={() => deletePreset(p.key)} className="text-[10px] text-stone-700 hover:text-red-400 opacity-0 group-hover:opacity-100">
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
