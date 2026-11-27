//! Editor: entwickeltes Bild als native wgpu-Textur, Regler, Kurve, Crop.

use std::time::Instant;

use eframe::egui::{
    self, Align2, Color32, CursorIcon, FontId, Id, Key, Pos2, Rect, Sense, Stroke, StrokeKind,
    Vec2, pos2, vec2,
};
use eframe::egui_wgpu;
use lumen_gpu::{Developer, Gpu, SourceTexture, ToneParams};

use crate::Decoded;

/// Regler wie im Web-Editor (`adjustments.ts`): Schluessel, Beschriftung, Bereich.
pub const SLIDERS: [(&str, &str, f32, f32); 10] = [
    ("exposure", "Belichtung", -5.0, 5.0),
    ("contrast", "Kontrast", -1.0, 1.0),
    ("highlights", "Lichter", -1.0, 1.0),
    ("shadows", "Tiefen", -1.0, 1.0),
    ("whites", "Weiß", -1.0, 1.0),
    ("blacks", "Schwarz", -1.0, 1.0),
    ("temperature", "Temperatur", -1.0, 1.0),
    ("tint", "Tönung", -1.0, 1.0),
    ("vibrance", "Dynamik", -1.0, 1.0),
    ("saturation", "Sättigung", -1.0, 1.0),
];

/// Ziel-Textur des Developers, bei egui als native Textur registriert.
pub struct DevTarget {
    _texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub id: egui::TextureId,
    pub size: (u32, u32),
}

impl DevTarget {
    pub fn new(gpu: &Gpu, rs: &egui_wgpu::RenderState, size: (u32, u32), filter: wgpu::FilterMode) -> DevTarget {
        // Rgba8Unorm: der Shader schreibt sRGB-kodiert, egui erwartet
        // gamma-kodierte Texturen ohne sRGB-Format -> keine Doppelkodierung.
        let texture = gpu.device.create_texture(&wgpu::TextureDescriptor {
            label: Some("ui-proto-dev-target"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let id = rs
            .renderer
            .write()
            .register_native_texture(&gpu.device, &view, filter);
        DevTarget {
            _texture: texture,
            view,
            id,
            size,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
enum Handle {
    Move,
    /// Kante/Ecke: (dx, dy) in {-1, 0, 1}.
    Edge(i8, i8),
}

pub struct Editor {
    pub values: [f32; 10],
    pub developer: Developer,
    src: Option<SourceTexture>,
    target: Option<DevTarget>,
    dirty: bool,
    pub status: String,
    pub decode_info: Option<(f64, f64, (u32, u32), String)>,
    /// Kurvenpunkte in 0..1 (x aufsteigend, Endpunkte bei x=0 und x=1).
    pub curve: Vec<Pos2>,
    curve_drag: Option<usize>,
    pub crop_on: bool,
    /// Crop-Rahmen in UV des Bildes.
    pub crop: Rect,
    crop_drag: Option<(Handle, Rect, Pos2)>,
    /// Bench: Rechteck des Belichtungs-Reglers im letzten Frame.
    pub exposure_rect: Option<Rect>,
    pub slider_width: f32,
    /// Bench: Zeitpunkt nach dem letzten `Developer::render` (Submit).
    pub last_submit: Option<Instant>,
    pub renders: u64,
}

impl Editor {
    pub fn new(gpu: &Gpu) -> Editor {
        Editor {
            values: [0.0; 10],
            developer: Developer::new(gpu, wgpu::TextureFormat::Rgba8Unorm),
            src: None,
            target: None,
            dirty: false,
            status: "Dekodiere …".into(),
            decode_info: None,
            curve: vec![pos2(0.0, 0.0), pos2(1.0, 1.0)],
            curve_drag: None,
            crop_on: false,
            crop: Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
            crop_drag: None,
            exposure_rect: None,
            slider_width: 170.0,
            last_submit: None,
            renders: 0,
        }
    }

    pub fn is_ready(&self) -> bool {
        self.target.is_some() && self.renders > 0
    }

    pub fn set_decoded(&mut self, gpu: &Gpu, rs: &egui_wgpu::RenderState, msg: Result<Decoded, String>) {
        match msg {
            Ok(d) => match SourceTexture::upload(gpu, &d.img) {
                Ok(src) => {
                    let size = (src.width, src.height);
                    self.target = Some(DevTarget::new(gpu, rs, size, wgpu::FilterMode::Linear));
                    self.status = format!(
                        "{} · {}×{} · Decode {:.0} ms",
                        d.camera, size.0, size.1, d.decode_ms
                    );
                    self.decode_info = Some((d.decode_ms, d.downscale_ms, size, d.camera));
                    self.src = Some(src);
                    self.dirty = true;
                }
                Err(e) => self.status = format!("GPU-Fehler: {e}"),
            },
            Err(e) => self.status = format!("Decode-Fehler: {e}"),
        }
    }

    pub fn tone(&self) -> ToneParams {
        let v = &self.values;
        ToneParams {
            process_version: 2,
            exposure: v[0],
            contrast: v[1],
            highlights: v[2],
            shadows: v[3],
            whites: v[4],
            blacks: v[5],
            temperature: v[6],
            tint: v[7],
        }
    }

    /// Rendert neu, falls ein Regler sich geaendert hat.
    pub fn render_if_dirty(&mut self, gpu: &Gpu) {
        if !self.dirty {
            return;
        }
        if let (Some(src), Some(t)) = (&self.src, &self.target) {
            self.developer.render(gpu, src, &self.tone(), &t.view, t.size);
            self.last_submit = Some(Instant::now());
            self.renders += 1;
            self.dirty = false;
        }
    }

    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    pub fn handle_keys(&mut self, ctx: &egui::Context) {
        if ctx.input(|i| i.key_pressed(Key::R)) {
            self.crop_on = !self.crop_on;
        }
    }

    pub fn sidebar(&mut self, ui: &mut egui::Ui, gpu: &Gpu) {
        ui.add_space(4.0);
        ui.strong("Grundeinstellungen");
        ui.add_space(4.0);
        let (changed, exp_rect) = slider_rows(ui, &mut self.values, self.slider_width);
        self.exposure_rect = exp_rect;
        if changed {
            self.dirty = true;
        }
        // Sofort rendern, damit dieser Frame das neue Bild zeigt.
        self.render_if_dirty(gpu);
        ui.label(
            egui::RichText::new("Dynamik/Sättigung: nur UI (Shader-Spike kennt sie nicht)")
                .small()
                .weak(),
        );
        ui.separator();
        ui.strong("Gradationskurve");
        ui.label(
            egui::RichText::new("Klick: Punkt · Ziehen · Doppelklick: entfernen (nur UI)")
                .small()
                .weak(),
        );
        self.curve_ui(ui);
        ui.separator();
        ui.horizontal(|ui| {
            ui.toggle_value(&mut self.crop_on, "Freistellen (R)");
            if ui.button("Zurücksetzen").clicked() {
                self.values = [0.0; 10];
                self.curve = vec![pos2(0.0, 0.0), pos2(1.0, 1.0)];
                self.crop = Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0));
                self.dirty = true;
            }
        });
    }

    fn curve_ui(&mut self, ui: &mut egui::Ui) {
        let size = 200.0;
        let (resp, painter) = ui.allocate_painter(vec2(size, size), Sense::click_and_drag());
        let r = resp.rect;
        // Endpunkte liegen auf dem Rand: Clip etwas weiter fassen.
        let painter = painter.with_clip_rect(r.expand(8.0));
        let to_screen = |p: Pos2| pos2(r.left() + p.x * size, r.bottom() - p.y * size);
        let from_screen = |s: Pos2| {
            pos2(
                ((s.x - r.left()) / size).clamp(0.0, 1.0),
                ((r.bottom() - s.y) / size).clamp(0.0, 1.0),
            )
        };
        let hit = |curve: &[Pos2], s: Pos2| {
            curve
                .iter()
                .enumerate()
                .map(|(i, p)| (i, to_screen(*p).distance(s)))
                .filter(|(_, d)| *d < 9.0)
                .min_by(|a, b| a.1.total_cmp(&b.1))
                .map(|(i, _)| i)
        };

        let pointer = resp.interact_pointer_pos().or(resp.hover_pos());
        if resp.drag_started()
            && let Some(s) = resp.interact_pointer_pos()
        {
            self.curve_drag = hit(&self.curve, s);
            if self.curve_drag.is_none() {
                // Ziehen auf freier Flaeche legt einen Punkt an und zieht ihn.
                self.curve_drag = Some(self.insert_curve_point(from_screen(s)));
            }
        }
        if resp.dragged()
            && let (Some(i), Some(s)) = (self.curve_drag, resp.interact_pointer_pos())
        {
            let p = from_screen(s);
            let n = self.curve.len();
            let x = if i == 0 {
                0.0
            } else if i == n - 1 {
                1.0
            } else {
                p.x.clamp(self.curve[i - 1].x + 0.01, self.curve[i + 1].x - 0.01)
            };
            self.curve[i] = pos2(x, p.y);
        }
        if resp.drag_stopped() {
            self.curve_drag = None;
        }
        if resp.double_clicked() {
            if let Some(s) = resp.interact_pointer_pos()
                && let Some(i) = hit(&self.curve, s)
                && i != 0
                && i != self.curve.len() - 1
            {
                self.curve.remove(i);
            }
        } else if resp.clicked()
            && let Some(s) = resp.interact_pointer_pos()
            && hit(&self.curve, s).is_none()
        {
            self.insert_curve_point(from_screen(s));
        }

        // Zeichnen: Raster, Diagonale, Kurve, Punkte.
        painter.rect_filled(r, 2.0, Color32::from_gray(28));
        for k in 1..4 {
            let t = k as f32 / 4.0;
            let g = Stroke::new(1.0, Color32::from_gray(55));
            painter.line_segment([to_screen(pos2(t, 0.0)), to_screen(pos2(t, 1.0))], g);
            painter.line_segment([to_screen(pos2(0.0, t)), to_screen(pos2(1.0, t))], g);
        }
        painter.line_segment(
            [to_screen(pos2(0.0, 0.0)), to_screen(pos2(1.0, 1.0))],
            Stroke::new(1.0, Color32::from_gray(80)),
        );
        let pts: Vec<Pos2> = sample_curve(&self.curve, 128)
            .into_iter()
            .map(to_screen)
            .collect();
        painter.line(pts, Stroke::new(2.0, Color32::from_gray(230)));
        let hovered = pointer.and_then(|s| hit(&self.curve, s));
        for (i, p) in self.curve.iter().enumerate() {
            let active = Some(i) == self.curve_drag || Some(i) == hovered;
            painter.circle(
                to_screen(*p),
                if active { 6.0 } else { 4.5 },
                Color32::from_gray(20),
                Stroke::new(2.0, Color32::WHITE),
            );
        }
        if hovered.is_some() {
            ui.ctx().set_cursor_icon(CursorIcon::Grab);
        }
    }

    fn insert_curve_point(&mut self, p: Pos2) -> usize {
        let i = self
            .curve
            .iter()
            .position(|q| q.x > p.x)
            .unwrap_or(self.curve.len() - 1)
            .max(1);
        let lo = self.curve[i - 1].x + 0.01;
        let hi = self.curve[i].x - 0.01;
        let x = if lo < hi { p.x.clamp(lo, hi) } else { (lo + hi) * 0.5 };
        self.curve.insert(i, pos2(x, p.y));
        i
    }

    pub fn canvas(&mut self, ui: &mut egui::Ui) {
        let avail = ui.available_rect_before_wrap();
        let Some(t) = &self.target else {
            ui.centered_and_justified(|ui| ui.label(&self.status));
            return;
        };
        let (w, h) = (t.size.0 as f32, t.size.1 as f32);
        let scale = ((avail.width() - 16.0) / w).min((avail.height() - 16.0) / h);
        let img_rect = Rect::from_center_size(avail.center(), vec2(w * scale, h * scale));
        let painter = ui.painter_at(avail);
        painter.image(
            t.id,
            img_rect,
            Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
            Color32::WHITE,
        );
        if self.crop_on {
            self.crop_ui(ui, img_rect);
        }
    }

    fn crop_ui(&mut self, ui: &mut egui::Ui, img: Rect) {
        let to_screen = |u: Pos2| pos2(img.left() + u.x * img.width(), img.top() + u.y * img.height());
        let to_uv = |s: Pos2| {
            pos2(
                ((s.x - img.left()) / img.width()).clamp(0.0, 1.0),
                ((s.y - img.top()) / img.height()).clamp(0.0, 1.0),
            )
        };
        let c = Rect::from_min_max(to_screen(self.crop.min), to_screen(self.crop.max));

        // Griffe: Ecken und Kantenmitten, dazu die Flaeche zum Verschieben.
        let mut handles: Vec<(Handle, Rect)> = Vec::new();
        for dy in -1i8..=1 {
            for dx in -1i8..=1 {
                if dx == 0 && dy == 0 {
                    continue;
                }
                let x = match dx {
                    -1 => c.left(),
                    0 => c.center().x,
                    _ => c.right(),
                };
                let y = match dy {
                    -1 => c.top(),
                    0 => c.center().y,
                    _ => c.bottom(),
                };
                handles.push((Handle::Edge(dx, dy), Rect::from_center_size(pos2(x, y), vec2(16.0, 16.0))));
            }
        }
        let move_resp = ui.interact(c.shrink(10.0), Id::NULL.with("crop-move"), Sense::drag());
        let mut hovered: Option<Handle> = None;
        let mut started: Option<(Handle, Pos2)> = None;
        let mut active_resp: Option<egui::Response> = None;
        if move_resp.drag_started()
            && let Some(p) = move_resp.interact_pointer_pos()
        {
            started = Some((Handle::Move, p));
        }
        if move_resp.hovered() {
            hovered = Some(Handle::Move);
        }
        if matches!(self.crop_drag, Some((Handle::Move, _, _))) {
            active_resp = Some(move_resp.clone());
        }
        // Griffe nach dem Verschiebe-Bereich: sie liegen oben (egui: spaeter = oben).
        for (h, r) in &handles {
            let resp = ui.interact(*r, Id::NULL.with(("crop-handle", *h)), Sense::drag());
            if resp.hovered() {
                hovered = Some(*h);
            }
            if resp.drag_started()
                && let Some(p) = resp.interact_pointer_pos()
            {
                started = Some((*h, p));
            }
            if matches!(self.crop_drag, Some((a, _, _)) if a == *h) {
                active_resp = Some(resp);
            }
        }
        if let Some((h, p)) = started {
            self.crop_drag = Some((h, self.crop, p));
        }
        if let (Some((h, start, p0)), Some(resp)) = (self.crop_drag, active_resp.as_ref()) {
            if let Some(p) = resp.interact_pointer_pos() {
                let d = to_uv(p) - to_uv(p0);
                let d = if h == Handle::Move {
                    // Raus aus dem Bild ist beim Verschieben gesperrt.
                    vec2(
                        d.x.clamp(-start.min.x, 1.0 - start.max.x),
                        d.y.clamp(-start.min.y, 1.0 - start.max.y),
                    )
                } else {
                    // to_uv klemmt; fuer Kanten reicht die rohe Differenz in UV.
                    vec2((p.x - p0.x) / img.width(), (p.y - p0.y) / img.height())
                };
                self.crop = apply_crop_drag(start, h, d);
            }
            if resp.drag_stopped() {
                self.crop_drag = None;
            }
        }
        if let Some(h) = self.crop_drag.map(|(h, _, _)| h).or(hovered) {
            ui.ctx().set_cursor_icon(match h {
                Handle::Move => CursorIcon::Grab,
                Handle::Edge(0, _) => CursorIcon::ResizeVertical,
                Handle::Edge(_, 0) => CursorIcon::ResizeHorizontal,
                Handle::Edge(dx, dy) if dx == dy => CursorIcon::ResizeNwSe,
                Handle::Edge(_, _) => CursorIcon::ResizeNeSw,
            });
        }

        // Zeichnen: abgedunkelter Rand, Drittel-Linien, Rahmen, Griffe.
        let c = Rect::from_min_max(to_screen(self.crop.min), to_screen(self.crop.max));
        let p = ui.painter_at(img);
        let dim = Color32::from_black_alpha(150);
        p.rect_filled(Rect::from_min_max(img.min, pos2(img.right(), c.top())), 0.0, dim);
        p.rect_filled(Rect::from_min_max(pos2(img.left(), c.bottom()), img.max), 0.0, dim);
        p.rect_filled(Rect::from_min_max(pos2(img.left(), c.top()), pos2(c.left(), c.bottom())), 0.0, dim);
        p.rect_filled(Rect::from_min_max(pos2(c.right(), c.top()), pos2(img.right(), c.bottom())), 0.0, dim);
        let thin = Stroke::new(1.0, Color32::from_white_alpha(110));
        for k in 1..3 {
            let t = k as f32 / 3.0;
            p.vline(c.left() + t * c.width(), c.y_range(), thin);
            p.hline(c.x_range(), c.top() + t * c.height(), thin);
        }
        p.rect_stroke(c, 0.0, Stroke::new(1.5, Color32::WHITE), StrokeKind::Inside);
        let p_all = ui.painter();
        for (h, _) in &handles {
            let Handle::Edge(dx, dy) = *h else { continue };
            let x = [c.left(), c.center().x, c.right()][(dx + 1) as usize];
            let y = [c.top(), c.center().y, c.bottom()][(dy + 1) as usize];
            let r = Rect::from_center_size(pos2(x, y), Vec2::splat(9.0));
            p_all.rect_filled(r, 1.0, Color32::WHITE);
            p_all.rect_stroke(r, 1.0, Stroke::new(1.0, Color32::BLACK), StrokeKind::Outside);
        }
        let px = (self.crop.width() * self.target.as_ref().map_or(0.0, |t| t.size.0 as f32)).round();
        let py = (self.crop.height() * self.target.as_ref().map_or(0.0, |t| t.size.1 as f32)).round();
        p_all.text(
            c.left_top() + vec2(0.0, -6.0),
            Align2::LEFT_BOTTOM,
            format!("{px:.0} × {py:.0} px"),
            FontId::proportional(13.0),
            Color32::WHITE,
        );
    }
}

/// Neuer Crop-Rahmen aus Startrahmen, Griff und Verschiebung (UV).
fn apply_crop_drag(start: Rect, h: Handle, d: Vec2) -> Rect {
    const MIN: f32 = 0.05;
    let mut r = start;
    match h {
        Handle::Move => {
            r = r.translate(d);
        }
        Handle::Edge(dx, dy) => {
            if dx < 0 {
                r.min.x = (start.min.x + d.x).clamp(0.0, start.max.x - MIN);
            }
            if dx > 0 {
                r.max.x = (start.max.x + d.x).clamp(start.min.x + MIN, 1.0);
            }
            if dy < 0 {
                r.min.y = (start.min.y + d.y).clamp(0.0, start.max.y - MIN);
            }
            if dy > 0 {
                r.max.y = (start.max.y + d.y).clamp(start.min.y + MIN, 1.0);
            }
        }
    }
    r
}

/// Catmull-Rom durch die Kurvenpunkte, auf 0..1 geklemmt (grob, wie erlaubt).
fn sample_curve(pts: &[Pos2], per_seg: usize) -> Vec<Pos2> {
    let n = pts.len();
    let mut out = Vec::with_capacity(n * per_seg);
    for i in 0..n - 1 {
        let p0 = pts[i.saturating_sub(1)];
        let p1 = pts[i];
        let p2 = pts[i + 1];
        let p3 = pts[(i + 2).min(n - 1)];
        for s in 0..per_seg {
            let t = s as f32 / per_seg as f32;
            let (t2, t3) = (t * t, t * t * t);
            let f = |a: f32, b: f32, c: f32, d: f32| {
                0.5 * (2.0 * b + (-a + c) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2
                    + (-a + 3.0 * b - 3.0 * c + d) * t3)
            };
            out.push(pos2(
                f(p0.x, p1.x, p2.x, p3.x).clamp(0.0, 1.0),
                f(p0.y, p1.y, p2.y, p3.y).clamp(0.0, 1.0),
            ));
        }
    }
    out.push(pts[n - 1]);
    out
}

/// Regler-Zeilen im Lightroom-Stil: Beschriftung links, Schiene rechts.
/// Doppelklick setzt auf 0 zurueck. Liefert (geaendert, Rechteck Belichtung).
pub fn slider_rows(ui: &mut egui::Ui, values: &mut [f32; 10], slider_width: f32) -> (bool, Option<Rect>) {
    let mut changed = false;
    let mut exp_rect = None;
    ui.spacing_mut().slider_width = slider_width;
    for (i, (_, label, min, max)) in SLIDERS.iter().enumerate() {
        ui.horizontal(|ui| {
            let l = ui.add_sized([80.0, 18.0], egui::Label::new(*label));
            let r = ui
                .add(
                    egui::Slider::new(&mut values[i], *min..=*max)
                        .step_by(0.01)
                        .fixed_decimals(2),
                )
                .labelled_by(l.id);
            if r.double_clicked() {
                values[i] = 0.0;
                changed = true;
            }
            if r.changed() {
                changed = true;
            }
            if i == 0 {
                exp_rect = Some(r.rect);
            }
        });
    }
    (changed, exp_rect)
}
