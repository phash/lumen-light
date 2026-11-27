//! `--bench`: automatischer Lauf durch Raster und Editor mit Messung.
//!
//! Messmethode (Details im Bericht):
//! - Frame-Zeit = Abstand zweier `raw_input_hook`-Aufrufe. Der Hook ist der
//!   erste App-Code eines Frames und laeuft direkt nach `queue.present()`
//!   des Vorframes (eframe ruft present synchron in `paint_and_update_textures`).
//! - Slider-Latenz: im Hook von Frame k werden Zeiger-Events auf die Schiene
//!   des Belichtungs-Reglers eingespeist (t_in). Der echte egui-Slider
//!   verarbeitet sie in `ui`, der Editor rendert und submittet (t_submit),
//!   egui zeichnet und praesentiert. Der Hook von Frame k+1 nimmt t_done.
//!   Latenz = t_done - t_in (Event -> nach present). Das ist nicht
//!   "Licht auf dem Panel": der Compositor zeigt den Frame erst zum
//!   naechsten Vblank.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use eframe::egui::{self, Color32, Pos2, Rect, pos2, vec2};
use eframe::egui_wgpu;
use lumen_gpu::{Gpu, SourceTexture, ToneParams};
use serde_json::{Value, json};

use crate::editor::{DevTarget, Editor, slider_rows};
use crate::grid::{Grid, TileMeta};
use crate::{Args, View};

const SLIDER_FRAMES: u32 = 400;
const GRID_SLOW_FRAMES: u32 = 600;
const GRID_FAST_FRAMES: u32 = 400;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    GridWarmup,
    GridShot,
    GridSlow,
    GridFast,
    EditorWait,
    EditorWarmup,
    Slider,
    SliderRelease,
    EditorShot,
    CropShot,
    ColorCheck,
    Finish,
    Done,
}

impl Phase {
    fn key(self) -> Option<&'static str> {
        match self {
            Phase::GridSlow => Some("grid_slow"),
            Phase::GridFast => Some("grid_fast"),
            Phase::Slider => Some("slider"),
            _ => None,
        }
    }
}

pub struct Bench {
    out: PathBuf,
    shots: PathBuf,
    golden: PathBuf,
    label: String,
    present: String,
    phase: Phase,
    n: u32,
    t_start: Instant,
    last_start: Option<Instant>,
    intervals: BTreeMap<&'static str, Vec<f64>>,
    cpu: BTreeMap<&'static str, Vec<f64>>,
    uploads: Vec<usize>,
    // Slider
    pending: Option<(Instant, Option<Instant>)>,
    lat_total: Vec<f64>,
    lat_submit: Vec<f64>,
    slider_misses: u32,
    pressed: bool,
    release: bool,
    // Screenshots
    shots_pending: Arc<AtomicUsize>,
    shot_errors: Arc<Mutex<Vec<String>>>,
    color_img: Arc<Mutex<Option<Arc<egui::ColorImage>>>>,
    color_requested: bool,
    color_origin_px: (usize, usize),
    golden_target: Option<DevTarget>,
    color_result: Value,
    accesskit: Value,
    adapter: Value,
}

impl Bench {
    pub fn new(out: PathBuf, args: &Args, gpu: &Gpu, rs: &egui_wgpu::RenderState) -> Bench {
        let info = &gpu.adapter_info;
        Bench {
            out,
            shots: args.shots.clone(),
            golden: args.golden.clone(),
            label: args.label.clone(),
            present: args.present.clone(),
            phase: Phase::GridWarmup,
            n: 0,
            t_start: Instant::now(),
            last_start: None,
            intervals: BTreeMap::new(),
            cpu: BTreeMap::new(),
            uploads: Vec::new(),
            pending: None,
            lat_total: Vec::new(),
            lat_submit: Vec::new(),
            slider_misses: 0,
            pressed: false,
            release: false,
            shots_pending: Arc::new(AtomicUsize::new(0)),
            shot_errors: Arc::default(),
            color_img: Arc::default(),
            color_requested: false,
            color_origin_px: (0, 0),
            golden_target: None,
            color_result: Value::Null,
            accesskit: accesskit_probe(),
            adapter: json!({
                "name": info.name,
                "backend": format!("{:?}", info.backend),
                "driver": info.driver,
                "driver_info": info.driver_info,
                "surface_format": format!("{:?}", rs.target_format),
            }),
        }
    }

    fn set_phase(&mut self, p: Phase) {
        eprintln!("[bench] {:?} -> {:?} ({:.1} s)", self.phase, p, self.t_start.elapsed().as_secs_f64());
        self.phase = p;
        self.n = 0;
    }

    /// Erster App-Code eines Frames (nach present des Vorframes).
    pub fn on_frame_start(&mut self, now: Instant, raw: &mut egui::RawInput, editor: &Editor) {
        if let (Some(last), Some(k)) = (self.last_start, self.phase.key()) {
            self.intervals
                .entry(k)
                .or_default()
                .push((now - last).as_secs_f64() * 1e3);
        }
        self.last_start = Some(now);

        if let Some((t_in, sub)) = self.pending.take() {
            match sub {
                Some(t_sub) => {
                    self.lat_total.push((now - t_in).as_secs_f64() * 1e3);
                    self.lat_submit.push((t_sub - t_in).as_secs_f64() * 1e3);
                }
                None => self.slider_misses += 1,
            }
        }

        let Some(r) = editor.exposure_rect else {
            return;
        };
        let y = r.center().y;
        let left = r.left() + 12.0;
        let span = editor.slider_width - 24.0;
        if self.phase == Phase::Slider {
            // Pendeln ueber die Schiene, jeder Frame ein neuer Wert.
            let t = (self.n as f32 * 0.21).sin() * 0.5 + 0.5;
            let pos = pos2(left + t * span, y);
            raw.events.push(egui::Event::PointerMoved(pos));
            if !self.pressed {
                raw.events.push(egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed: true,
                    modifiers: egui::Modifiers::NONE,
                });
                self.pressed = true;
            }
            self.pending = Some((now, None));
        } else if self.release && self.pressed {
            let pos = pos2(left, y);
            raw.events.push(egui::Event::PointerButton {
                pos,
                button: egui::PointerButton::Primary,
                pressed: false,
                modifiers: egui::Modifiers::NONE,
            });
            // Zeiger aus dem Fenster nehmen, damit kein Hover-Zustand bleibt.
            raw.events.push(egui::Event::PointerGone);
            self.pressed = false;
            self.release = false;
        }
    }

    /// Nach dem Editor-UI: hat dieser Frame neu gerendert?
    pub fn on_editor_ui(&mut self, _t_ui: Instant, editor: &Editor) {
        if let (Some((t_in, None)), Some(t_sub)) = (self.pending, editor.last_submit)
            && t_sub >= t_in
        {
            self.pending = Some((t_in, Some(t_sub)));
        }
    }

    fn shot(&self, ctx: &egui::Context, name: &str) {
        let path = self.shots.join(name);
        let pending = self.shots_pending.clone();
        let errors = self.shot_errors.clone();
        pending.fetch_add(1, Ordering::SeqCst);
        ctx.request_screenshot(move |img| {
            if let Err(e) = save_png(&path, &img) {
                errors.lock().unwrap().push(format!("{}: {e}", path.display()));
            } else {
                eprintln!("[bench] Screenshot {}", path.display());
            }
            pending.fetch_sub(1, Ordering::SeqCst);
        });
    }

    #[allow(clippy::too_many_arguments)]
    pub fn drive(
        &mut self,
        ctx: &egui::Context,
        frame: &mut eframe::Frame,
        view: &mut View,
        grid: &mut Grid,
        editor: &mut Editor,
        gpu: &Gpu,
        rs: &egui_wgpu::RenderState,
    ) {
        let cpu_ms = frame.info().cpu_usage.map(|s| f64::from(s) * 1e3);
        if let (Some(k), Some(c)) = (self.phase.key(), cpu_ms) {
            self.cpu.entry(k).or_default().push(c);
        }
        self.n += 1;
        let n = self.n;
        match self.phase {
            Phase::GridWarmup => {
                *view = View::Grid;
                if n == 1 {
                    demo_meta(grid);
                }
                if n >= 90 {
                    self.shot(ctx, "n0-grid.png");
                    self.set_phase(Phase::GridShot);
                }
            }
            Phase::GridShot => {
                if n >= 6 {
                    self.set_phase(Phase::GridSlow);
                }
            }
            Phase::GridSlow | Phase::GridFast => {
                let (step, frames) = if self.phase == Phase::GridSlow {
                    (30.0, GRID_SLOW_FRAMES)
                } else {
                    (240.0, GRID_FAST_FRAMES)
                };
                let max = grid.max_offset.max(1.0);
                // Hin und her, damit staendig neue Kacheln kommen.
                let pos = (n as f32 * step) % (2.0 * max);
                grid.force_offset = Some(if pos > max { 2.0 * max - pos } else { pos });
                self.uploads.push(grid.uploads_last_frame());
                if n >= frames {
                    let next = if self.phase == Phase::GridSlow {
                        Phase::GridFast
                    } else {
                        Phase::EditorWait
                    };
                    self.set_phase(next);
                }
            }
            Phase::EditorWait => {
                *view = View::Editor;
                if editor.is_ready() && editor.exposure_rect.is_some() {
                    self.set_phase(Phase::EditorWarmup);
                } else if n > 3000 {
                    eprintln!("[bench] Editor nicht bereit: {}", editor.status);
                    self.set_phase(Phase::ColorCheck);
                }
            }
            Phase::EditorWarmup => {
                if n >= 30 {
                    self.set_phase(Phase::Slider);
                }
            }
            Phase::Slider => {
                if n >= SLIDER_FRAMES {
                    self.release = true;
                    self.set_phase(Phase::SliderRelease);
                }
            }
            Phase::SliderRelease => {
                if n == 2 {
                    editor.values = [0.0; 10];
                    editor.values[0] = 0.35;
                    editor.values[1] = 0.15;
                    editor.values[3] = 0.25;
                    editor.mark_dirty();
                }
                if n >= 8 {
                    self.shot(ctx, "n0-editor.png");
                    self.set_phase(Phase::EditorShot);
                }
            }
            Phase::EditorShot => {
                if n == 6 {
                    editor.crop_on = true;
                    editor.crop = Rect::from_min_max(pos2(0.12, 0.08), pos2(0.86, 0.9));
                    editor.curve = vec![
                        pos2(0.0, 0.0),
                        pos2(0.25, 0.18),
                        pos2(0.5, 0.52),
                        pos2(0.75, 0.84),
                        pos2(1.0, 1.0),
                    ];
                }
                if n >= 12 {
                    self.shot(ctx, "n0-curve-crop.png");
                    self.set_phase(Phase::CropShot);
                }
            }
            Phase::CropShot => {
                if n >= 6 {
                    editor.crop_on = false;
                    self.prepare_color_check(gpu, rs, editor);
                    self.set_phase(Phase::ColorCheck);
                }
            }
            Phase::ColorCheck => {
                *view = View::ColorCheck;
                if self.golden_target.is_none() {
                    self.set_phase(Phase::Finish);
                } else if n == 6 && !self.color_requested {
                    self.color_requested = true;
                    let slot = self.color_img.clone();
                    ctx.request_screenshot(move |img| {
                        *slot.lock().unwrap() = Some(img);
                    });
                } else if let Some(img) = self.color_img.lock().unwrap().take() {
                    self.color_result = self.compare_golden(&img);
                    self.phase = Phase::Finish;
                    self.n = 0;
                } else if n > 600 {
                    self.color_result = json!({"error": "kein Screenshot"});
                    self.set_phase(Phase::Finish);
                }
            }
            Phase::Finish => {
                if self.shots_pending.load(Ordering::SeqCst) == 0 || n > 600 {
                    self.write_json(ctx, editor);
                    ctx.send_viewport_cmd(egui::ViewportCommand::Close);
                    self.set_phase(Phase::Done);
                }
            }
            Phase::Done => {}
        }
    }

    fn prepare_color_check(&mut self, gpu: &Gpu, rs: &egui_wgpu::RenderState, editor: &Editor) {
        let res = (|| -> Result<(), String> {
            let meta: Value = serde_json::from_slice(
                &std::fs::read(self.golden.join("source.json")).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let w = meta["width"].as_u64().ok_or("width")? as u32;
            let h = meta["height"].as_u64().ok_or("height")? as u32;
            let bytes = std::fs::read(self.golden.join("source.rgb16")).map_err(|e| e.to_string())?;
            let data = bytes
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            let img = lumen_raw::Rgb16Image {
                width: w,
                height: h,
                data,
            };
            let sets: Value = serde_json::from_slice(
                &std::fs::read(self.golden.parent().ok_or("parent")?.join("sets.json"))
                    .map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            let set = sets
                .as_array()
                .and_then(|a| a.iter().find(|s| s["id"] == "neutral-pv2"))
                .ok_or("neutral-pv2 fehlt")?;
            let params = ToneParams::from_adjustments_json(&set["adjustments"]);
            let src = SourceTexture::upload(gpu, &img).map_err(|e| e.to_string())?;
            // Nearest: jedes Bildschirm-Pixel trifft genau ein Texel.
            let t = DevTarget::new(gpu, rs, (w, h), wgpu::FilterMode::Nearest);
            editor.developer.render(gpu, &src, &params, &t.view, (w, h));
            self.golden_target = Some(t);
            Ok(())
        })();
        if let Err(e) = res {
            self.color_result = json!({ "error": e });
        }
    }

    /// Zeichnet die Golden-Quelle pixelgenau 1:1 (physische Pixel).
    pub fn color_check_ui(&mut self, ui: &mut egui::Ui) {
        let Some(t) = &self.golden_target else {
            return;
        };
        let ppp = ui.ctx().pixels_per_point();
        let avail = ui.available_rect_before_wrap();
        let ox = (avail.min.x * ppp).ceil() as usize + 8;
        let oy = (avail.min.y * ppp).ceil() as usize + 8;
        self.color_origin_px = (ox, oy);
        let rect = Rect::from_min_size(
            Pos2::new(ox as f32 / ppp, oy as f32 / ppp),
            vec2(t.size.0 as f32 / ppp, t.size.1 as f32 / ppp),
        );
        ui.painter().image(
            t.id,
            rect,
            Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
            Color32::WHITE,
        );
    }

    fn compare_golden(&self, shot: &egui::ColorImage) -> Value {
        let path = self.golden.join("neutral-pv2.png");
        let (gw, gh, golden) = match read_png(&path) {
            Ok(v) => v,
            Err(e) => return json!({"error": e}),
        };
        let (ox, oy) = self.color_origin_px;
        let [sw, sh] = shot.size;
        if ox + gw > sw || oy + gh > sh {
            return json!({"error": format!("Screenshot {sw}x{sh} zu klein fuer {gw}x{gh} bei {ox},{oy}")});
        }
        let mut max = 0u8;
        let mut over2 = 0usize;
        let mut sum = 0u64;
        let mut hist = [0usize; 6];
        for y in 0..gh {
            for x in 0..gw {
                let s = shot.pixels[(oy + y) * sw + ox + x].to_array();
                let g = &golden[(y * gw + x) * 4..(y * gw + x) * 4 + 3];
                let mut pmax = 0u8;
                for c in 0..3 {
                    let d = s[c].abs_diff(g[c]);
                    pmax = pmax.max(d);
                    sum += u64::from(d);
                }
                max = max.max(pmax);
                if pmax > 2 {
                    over2 += 1;
                }
                hist[(pmax as usize).min(5)] += 1;
            }
        }
        let mid = ((gh / 2) * gw + gw / 2) * 4;
        let ms = shot.pixels[(oy + gh / 2) * sw + ox + gw / 2].to_array();
        json!({
            "golden": path.display().to_string(),
            "size": [gw, gh],
            "screenshot_size": [sw, sh],
            "origin_px": [ox, oy],
            "max_channel_diff": max,
            "pixels_over_2": over2,
            "mean_abs_diff": sum as f64 / (gw * gh * 3) as f64,
            "hist_pixel_max_diff_0_to_5plus": hist,
            "center_screenshot_rgb": [ms[0], ms[1], ms[2]],
            "center_golden_rgb": [golden[mid], golden[mid + 1], golden[mid + 2]],
        })
    }

    fn write_json(&self, ctx: &egui::Context, editor: &Editor) {
        let (ppp, inner) = ctx.input(|i| (i.pixels_per_point(), i.viewport().inner_rect));
        let mut frames = serde_json::Map::new();
        for (k, v) in &self.intervals {
            frames.insert((*k).into(), summary(v));
        }
        let mut cpu = serde_json::Map::new();
        for (k, v) in &self.cpu {
            cpu.insert((*k).into(), summary(v));
        }
        let env = |k: &str| std::env::var(k).ok();
        let v = json!({
            "label": self.label,
            "present": self.present,
            "adapter": self.adapter,
            "env": {
                "WAYLAND_DISPLAY": env("WAYLAND_DISPLAY"),
                "DISPLAY": env("DISPLAY"),
                "XDG_SESSION_TYPE": env("XDG_SESSION_TYPE"),
                "WGPU_BACKEND": env("WGPU_BACKEND"),
            },
            "pixels_per_point": ppp,
            "inner_rect_points": inner.map(|r| [r.width(), r.height()]),
            "decode": editor.decode_info.as_ref().map(|(d, s, size, cam)| json!({
                "half_decode_ms": d, "downscale_2560_ms": s, "proxy_size": [size.0, size.1], "camera": cam
            })),
            "slider_to_present_ms": summary(&self.lat_total),
            "slider_to_submit_ms": summary(&self.lat_submit),
            "slider_frames_without_change": self.slider_misses,
            "frame_interval_ms": frames,
            "cpu_frame_ms_eframe": cpu,
            "grid_uploads_per_frame_mean": if self.uploads.is_empty() { 0.0 } else {
                self.uploads.iter().sum::<usize>() as f64 / self.uploads.len() as f64 },
            "color_check": self.color_result,
            "accesskit": self.accesskit,
            "screenshot_errors": *self.shot_errors.lock().unwrap(),
            "total_s": self.t_start.elapsed().as_secs_f64(),
        });
        if let Some(dir) = self.out.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        match std::fs::write(&self.out, serde_json::to_string_pretty(&v).unwrap()) {
            Ok(()) => eprintln!("[bench] JSON {}", self.out.display()),
            Err(e) => eprintln!("[bench] JSON-Fehler {}: {e}", self.out.display()),
        }
    }
}

fn demo_meta(grid: &mut Grid) {
    for i in 0..60 {
        let h = (i as u32).wrapping_mul(2_654_435_761) >> 7;
        grid.meta[i] = TileMeta {
            flag: [0, 0, 1, -1, 0][(h % 5) as usize],
            stars: (h % 6) as u8,
        };
    }
    grid.focus = 10;
}

fn summary(v: &[f64]) -> Value {
    if v.is_empty() {
        return json!({"n": 0});
    }
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    let pct = |p: f64| s[((s.len() - 1) as f64 * p).round() as usize];
    let mean = s.iter().sum::<f64>() / s.len() as f64;
    let max = *s.last().unwrap();
    json!({
        "n": s.len(),
        "p50": pct(0.5),
        "p95": pct(0.95),
        "p99": pct(0.99),
        "min": s[0],
        "max": max,
        "mean": mean,
        "fps_p50": 1000.0 / pct(0.5),
        "fps_p05": 1000.0 / pct(0.95),
        "fps_min": 1000.0 / max,
        "over_16_7ms": s.iter().filter(|x| **x > 16.7).count(),
        "over_33ms": s.iter().filter(|x| **x > 33.0).count(),
    })
}

/// Prueft, welche Namen AccessKit fuer die Regler sieht (headless egui).
fn accesskit_probe() -> Value {
    use egui::accesskit::{Node, NodeId, Role};
    let ctx = egui::Context::default();
    ctx.enable_accesskit();
    let mut vals = [0.0f32; 10];
    let mut upd = None;
    for _ in 0..3 {
        let out = ctx.run_ui(egui::RawInput::default(), |ui| {
            egui::CentralPanel::default().show(ui, |ui| {
                slider_rows(ui, &mut vals, 170.0);
            });
        });
        if out.platform_output.accesskit_update.is_some() {
            upd = out.platform_output.accesskit_update;
        }
    }
    let Some(upd) = upd else {
        return json!({"error": "kein TreeUpdate"});
    };
    let nodes: std::collections::HashMap<NodeId, &Node> =
        upd.nodes.iter().map(|(id, n)| (*id, n)).collect();
    let name_of = |n: &Node| {
        let direct = n.label().map(str::to_owned);
        let via: Vec<String> = n
            .labelled_by()
            .iter()
            .filter_map(|id| nodes.get(id))
            .filter_map(|l| l.value().or(l.label()).map(str::to_owned))
            .collect();
        json!({"label": direct, "labelled_by": via})
    };
    let mut sliders = Vec::new();
    let mut spins = Vec::new();
    for (_, n) in &upd.nodes {
        match n.role() {
            Role::Slider => sliders.push(json!({
                "name": name_of(n),
                "value": n.numeric_value(),
                "min": n.min_numeric_value(),
                "max": n.max_numeric_value(),
                "step": n.numeric_value_step(),
            })),
            Role::SpinButton => spins.push(name_of(n)),
            _ => {}
        }
    }
    json!({
        "nodes_total": upd.nodes.len(),
        "sliders": sliders,
        "spin_buttons": spins,
    })
}

fn save_png(path: &std::path::Path, img: &egui::ColorImage) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let [w, h] = img.size;
    let rgb: Vec<u8> = img
        .pixels
        .iter()
        .flat_map(|c| {
            let a = c.to_array();
            [a[0], a[1], a[2]]
        })
        .collect();
    let f = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(f), w as u32, h as u32);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::High);
    let mut wr = enc.write_header().map_err(|e| e.to_string())?;
    wr.write_image_data(&rgb).map_err(|e| e.to_string())
}

fn read_png(path: &std::path::Path) -> Result<(usize, usize, Vec<u8>), String> {
    let f = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let dec = png::Decoder::new(std::io::BufReader::new(f));
    let mut r = dec.read_info().map_err(|e| e.to_string())?;
    let mut buf = vec![0; r.output_buffer_size().ok_or("Puffer")?];
    let info = r.next_frame(&mut buf).map_err(|e| e.to_string())?;
    let data = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        other => return Err(format!("Farbtyp {other:?}")),
    };
    Ok((info.width as usize, info.height as usize, rgba))
}
