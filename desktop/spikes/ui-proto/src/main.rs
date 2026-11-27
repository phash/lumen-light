//! Spike N0, Task 5: egui-UI-Prototyp (Wegwerf).
//!
//! Raster mit 5 000 Fake-Kacheln und ein Editor, der ein echtes RAW ueber
//! `lumen-raw` dekodiert und mit `lumen-gpu` entwickelt. `--bench` faehrt
//! Raster-Scrollen und Slider-Ziehen automatisch, misst und schreibt JSON
//! plus Screenshots.

mod bench;
mod editor;
mod grid;
mod thumbs;

use std::path::PathBuf;
use std::sync::mpsc;
use std::time::Instant;

use eframe::egui;
use eframe::egui_wgpu;

use crate::bench::Bench;
use crate::editor::Editor;
use crate::grid::Grid;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum View {
    Grid,
    Editor,
    /// Nur im Bench: Golden-Quelle 1:1 fuer den Farbvergleich.
    ColorCheck,
}

pub struct Args {
    pub raw: PathBuf,
    pub bench: Option<PathBuf>,
    pub shots: PathBuf,
    pub golden: PathBuf,
    pub present: String,
    pub label: String,
}

fn parse_args() -> Args {
    let mut a = Args {
        raw: PathBuf::from("tests-fixtures/raw-samples/Nikon_D7100.NEF"),
        bench: None,
        shots: PathBuf::from("docs/screenshots"),
        golden: PathBuf::from("tests-fixtures/goldens/Nikon_D7100"),
        present: "vsync".into(),
        label: "unbenannt".into(),
    };
    let mut it = std::env::args().skip(1);
    while let Some(arg) = it.next() {
        let mut val = || it.next().expect("Wert fehlt");
        match arg.as_str() {
            "--bench" => a.bench = Some(PathBuf::from(val())),
            "--shots" => a.shots = PathBuf::from(val()),
            "--golden" => a.golden = PathBuf::from(val()),
            "--present" => a.present = val(),
            "--label" => a.label = val(),
            "-h" | "--help" => {
                println!(
                    "ui-proto [--bench out.json] [--present vsync|lowlat|novsync] \
                     [--label name] [--shots dir] [--golden dir] [raw]"
                );
                std::process::exit(0);
            }
            other => a.raw = PathBuf::from(other),
        }
    }
    a
}

/// Ergebnis des Decode-Threads.
pub struct Decoded {
    pub img: lumen_raw::Rgb16Image,
    pub decode_ms: f64,
    pub downscale_ms: f64,
    pub camera: String,
}

struct App {
    view: View,
    grid: Grid,
    editor: Editor,
    bench: Option<Bench>,
    gpu: lumen_gpu::Gpu,
    rs: egui_wgpu::RenderState,
    decoded: Option<mpsc::Receiver<Result<Decoded, String>>>,
    logic_calls: u64,
    ui_calls: u64,
    last_diag: Instant,
}

impl App {
    fn new(cc: &eframe::CreationContext<'_>, args: Args) -> App {
        install_fonts(&cc.egui_ctx);
        let rs = cc
            .wgpu_render_state
            .clone()
            .expect("eframe ohne wgpu-Renderer");
        let gpu = lumen_gpu::Gpu::from_parts(rs.device.clone(), rs.queue.clone(), &rs.adapter);
        eprintln!(
            "Adapter: {} ({:?}), Surface-Format {:?}",
            gpu.adapter_info.name, gpu.adapter_info.backend, rs.target_format
        );

        // Decode im Hintergrund, damit das Fenster sofort steht.
        let (tx, rx) = mpsc::channel();
        let raw = args.raw.clone();
        std::thread::spawn(move || {
            let t0 = Instant::now();
            let res = lumen_raw::decode(&raw, lumen_raw::DecodeMode::Half);
            let decode_ms = t0.elapsed().as_secs_f64() * 1e3;
            let msg = match res {
                Ok((img, meta)) => {
                    let t1 = Instant::now();
                    let img = lumen_raw::box_downscale(&img, 2560);
                    Ok(Decoded {
                        img,
                        decode_ms,
                        downscale_ms: t1.elapsed().as_secs_f64() * 1e3,
                        camera: format!("{} {}", meta.make, meta.model),
                    })
                }
                Err(e) => Err(format!("{}: {e}", raw.display())),
            };
            let _ = tx.send(msg);
        });

        let editor = Editor::new(&gpu);
        let bench = args.bench.clone().map(|out| Bench::new(out, &args, &gpu, &rs));
        App {
            view: View::Grid,
            grid: Grid::new(&cc.egui_ctx),
            editor,
            bench,
            gpu,
            rs,
            decoded: Some(rx),
            logic_calls: 0,
            ui_calls: 0,
            last_diag: Instant::now(),
        }
    }
}

/// Noto Sans (OFL 1.1) als erste Proportional-Schrift; die egui-Standardschriften
/// bleiben als Rueckfall (Sterne/Symbole aus der Emoji-Schrift).
fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert(
        "noto-sans".into(),
        std::sync::Arc::new(egui::FontData::from_static(include_bytes!(
            "../assets/NotoSans-Regular.ttf"
        ))),
    );
    fonts
        .families
        .entry(egui::FontFamily::Proportional)
        .or_default()
        .insert(0, "noto-sans".into());
    ctx.set_fonts(fonts);
}

impl eframe::App for App {
    fn raw_input_hook(&mut self, _ctx: &egui::Context, raw_input: &mut egui::RawInput) {
        // Fruehester App-Hook eines Frames: liegt direkt nach `present` des Vorframes.
        let now = Instant::now();
        if let Some(b) = self.bench.as_mut() {
            b.on_frame_start(now, raw_input, &self.editor);
        }
    }

    fn logic(&mut self, ctx: &egui::Context, _frame: &mut eframe::Frame) {
        if self.bench.is_some() {
            self.logic_calls += 1;
            if self.last_diag.elapsed().as_secs_f32() > 1.0 {
                self.last_diag = Instant::now();
                let vp = ctx.input(|i| i.viewport().clone());
                eprintln!(
                    "[diag] logic={} ui={} minimized={:?} occluded={:?} focused={:?}",
                    self.logic_calls, self.ui_calls, vp.minimized, vp.occluded, vp.focused
                );
            }
            ctx.request_repaint();
        }
    }

    fn ui(&mut self, ui: &mut egui::Ui, frame: &mut eframe::Frame) {
        self.ui_calls += 1;
        let ctx = ui.ctx().clone();
        if let Some(rx) = &self.decoded
            && let Ok(msg) = rx.try_recv()
        {
            self.editor.set_decoded(&self.gpu, &self.rs, msg);
            self.decoded = None;
        }

        if let Some(b) = self.bench.as_mut() {
            b.drive(
                &ctx,
                frame,
                &mut self.view,
                &mut self.grid,
                &mut self.editor,
                &self.gpu,
                &self.rs,
            );
        } else {
            self.handle_view_keys(&ctx);
        }

        egui::Panel::top("kopf").show(ui, |ui| {
            ui.horizontal(|ui| {
                ui.heading("Lumen");
                ui.separator();
                ui.selectable_value(&mut self.view, View::Grid, "Bibliothek (G)");
                ui.selectable_value(&mut self.view, View::Editor, "Entwickeln (D)");
                ui.separator();
                ui.label(match self.view {
                    View::Grid => format!(
                        "{} Bilder · Fokus #{} · Pfeile, P/X/U, 0–5",
                        grid::TILE_COUNT,
                        self.grid.focus + 1
                    ),
                    View::Editor => self.editor.status.clone(),
                    View::ColorCheck => "Farbprüfung gegen Golden (1:1)".into(),
                });
            });
        });

        match self.view {
            View::Grid => {
                egui::CentralPanel::default().show(ui, |ui| self.grid.ui(ui));
            }
            View::Editor => {
                let t_ui = Instant::now();
                egui::Panel::right("regler")
                    .resizable(false)
                    .exact_size(330.0)
                    .show(ui, |ui| {
                        egui::ScrollArea::vertical().show(ui, |ui| {
                            self.editor.sidebar(ui, &self.gpu);
                        });
                    });
                egui::CentralPanel::default().show(ui, |ui| self.editor.canvas(ui));
                if let Some(b) = self.bench.as_mut() {
                    b.on_editor_ui(t_ui, &self.editor);
                }
            }
            View::ColorCheck => {
                egui::CentralPanel::default().show(ui, |ui| {
                    if let Some(b) = self.bench.as_mut() {
                        b.color_check_ui(ui);
                    }
                });
            }
        }

        if self.bench.is_some() {
            ctx.request_repaint();
        }
    }
}

impl App {
    fn handle_view_keys(&mut self, ctx: &egui::Context) {
        if ctx.egui_wants_keyboard_input() {
            return;
        }
        let (g, d) = ctx.input(|i| (i.key_pressed(egui::Key::G), i.key_pressed(egui::Key::D)));
        if g {
            self.view = View::Grid;
        }
        if d {
            self.view = View::Editor;
        }
        match self.view {
            View::Grid => self.grid.handle_keys(ctx),
            View::Editor => self.editor.handle_keys(ctx),
            View::ColorCheck => {}
        }
    }
}

fn main() -> eframe::Result {
    let args = parse_args();
    let surface = match args.present.as_str() {
        // eframe-Default: AutoVsync, bis zu 2 Frames in der Warteschlange.
        "vsync" => egui_wgpu::SurfaceConfig::HIGH_THROUGHPUT,
        "lowlat" => egui_wgpu::SurfaceConfig::LOW_LATENCY,
        "novsync" => egui_wgpu::SurfaceConfig {
            present_mode: wgpu::PresentMode::AutoNoVsync,
            desired_maximum_frame_latency: Some(1),
        },
        other => panic!("--present {other}: erwartet vsync|lowlat|novsync"),
    };
    let mut options = eframe::NativeOptions {
        viewport: egui::ViewportBuilder::default()
            .with_inner_size([1440.0, 900.0])
            .with_title("Lumen N0 – egui-Prototyp"),
        // Kein Dithering: das Foto soll bitgenau ankommen (Farbpruefung).
        dithering: false,
        ..Default::default()
    };
    options.wgpu_options.surface = surface;
    eframe::run_native(
        "lumen-ui-proto",
        options,
        Box::new(move |cc| Ok(Box::new(App::new(cc, args)))),
    )
}
