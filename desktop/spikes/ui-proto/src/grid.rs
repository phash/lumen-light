//! Raster der Bibliothek: 5 000 Kacheln, virtualisiert ueber `show_rows`.

use eframe::egui::{self, Align2, Color32, FontId, Key, Rect, Sense, Stroke, StrokeKind, pos2, vec2};

use crate::thumbs::Thumbs;

pub const TILE_COUNT: usize = 5000;
const TILE: f32 = 170.0;
const GAP: f32 = 8.0;

#[derive(Clone, Copy, Default)]
pub struct TileMeta {
    /// -1 abgelehnt, 0 ohne, 1 markiert.
    pub flag: i8,
    pub stars: u8,
}

pub struct Grid {
    pub meta: Vec<TileMeta>,
    pub focus: usize,
    pub cols: usize,
    thumbs: Thumbs,
    /// Bench setzt den Scroll-Offset direkt.
    pub force_offset: Option<f32>,
    /// Scroll-Ziel aus der Tastatur-Navigation.
    scroll_to: Option<f32>,
    pub offset: f32,
    pub max_offset: f32,
    viewport_h: f32,
}

impl Grid {
    pub fn new(ctx: &egui::Context) -> Grid {
        Grid {
            meta: vec![TileMeta::default(); TILE_COUNT],
            focus: 0,
            cols: 1,
            thumbs: Thumbs::new(ctx),
            force_offset: None,
            scroll_to: None,
            offset: 0.0,
            max_offset: 0.0,
            viewport_h: 0.0,
        }
    }

    pub fn uploads_last_frame(&self) -> usize {
        self.thumbs.uploads_last_frame
    }

    pub fn handle_keys(&mut self, ctx: &egui::Context) {
        let cols = self.cols.max(1);
        let mut moved = false;
        ctx.input(|i| {
            let f = &mut self.focus;
            if i.key_pressed(Key::ArrowRight) {
                *f = (*f + 1).min(TILE_COUNT - 1);
                moved = true;
            }
            if i.key_pressed(Key::ArrowLeft) {
                *f = f.saturating_sub(1);
                moved = true;
            }
            if i.key_pressed(Key::ArrowDown) {
                *f = (*f + cols).min(TILE_COUNT - 1);
                moved = true;
            }
            if i.key_pressed(Key::ArrowUp) {
                *f = f.saturating_sub(cols);
                moved = true;
            }
            let m = &mut self.meta[*f];
            if i.key_pressed(Key::P) {
                m.flag = 1;
            }
            if i.key_pressed(Key::X) {
                m.flag = -1;
            }
            if i.key_pressed(Key::U) {
                m.flag = 0;
            }
            for (k, s) in [
                (Key::Num0, 0),
                (Key::Num1, 1),
                (Key::Num2, 2),
                (Key::Num3, 3),
                (Key::Num4, 4),
                (Key::Num5, 5),
            ] {
                if i.key_pressed(k) {
                    m.stars = s;
                }
            }
        });
        if moved {
            // Fokus-Zeile sichtbar halten.
            let row_h = TILE + GAP;
            let top = (self.focus / cols) as f32 * row_h;
            if top < self.offset {
                self.scroll_to = Some(top);
            } else if top + row_h > self.offset + self.viewport_h {
                self.scroll_to = Some(top + row_h - self.viewport_h);
            }
        }
    }

    pub fn ui(&mut self, ui: &mut egui::Ui) {
        let width = ui.available_width();
        self.cols = (((width + GAP) / (TILE + GAP)).floor() as usize).max(1);
        let cols = self.cols;
        let rows = TILE_COUNT.div_ceil(cols);

        let mut area = egui::ScrollArea::vertical()
            .auto_shrink([false, false])
            .animated(false);
        if let Some(y) = self.force_offset.take().or(self.scroll_to.take()) {
            area = area.vertical_scroll_offset(y);
        }

        // Sichtbaren Bereich aus dem letzten Frame schaetzen (fuer die Wunschliste).
        let row_h = TILE + GAP;
        let first_row = (self.offset / row_h).floor() as usize;
        let vis_rows = (self.viewport_h / row_h).ceil() as usize + 2;
        let first = (first_row.saturating_sub(1) * cols).min(TILE_COUNT);
        let last = ((first_row + vis_rows) * cols).min(TILE_COUNT);
        self.thumbs.begin_frame(first..last);

        let spacing = ui.spacing().item_spacing.y;
        let out = area.show_rows(ui, row_h - spacing, rows, |ui, range| {
            for row in range {
                let (row_rect, _) =
                    ui.allocate_exact_size(vec2(width, row_h - spacing), Sense::hover());
                for c in 0..cols {
                    let i = row * cols + c;
                    if i >= TILE_COUNT {
                        break;
                    }
                    let min = pos2(row_rect.left() + c as f32 * (TILE + GAP), row_rect.top());
                    let rect = Rect::from_min_size(min, vec2(TILE, TILE));
                    self.tile(ui, i, rect);
                }
            }
        });
        self.offset = out.state.clamped_offset().y;
        self.viewport_h = out.inner_rect.height();
        self.max_offset = (out.content_size.y - self.viewport_h).max(0.0);
    }

    fn tile(&mut self, ui: &mut egui::Ui, i: usize, rect: Rect) {
        let resp = ui.interact(rect, ui.scope_id().with(("kachel", i)), Sense::click());
        if resp.clicked() {
            self.focus = i;
        }
        let painter = ui.painter_at(rect.expand(3.0));
        match self.thumbs.get(i) {
            Some(tex) => {
                painter.image(
                    tex,
                    rect,
                    Rect::from_min_max(pos2(0.0, 0.0), pos2(1.0, 1.0)),
                    Color32::WHITE,
                );
            }
            None => {
                painter.rect_filled(rect, 2.0, Color32::from_gray(45));
            }
        }
        let m = self.meta[i];
        // Abgelehnte Bilder abdunkeln wie in Lightroom.
        if m.flag < 0 {
            painter.rect_filled(rect, 0.0, Color32::from_black_alpha(150));
        }
        let strip = Rect::from_min_max(pos2(rect.left(), rect.bottom() - 22.0), rect.max);
        painter.rect_filled(strip, 0.0, Color32::from_black_alpha(160));
        // Sterne und Flaggen als Formen: die Glyphen (★ ⚑ ✖) fehlen in Noto
        // Sans und in den egui-Rueckfallschriften (Tofu im ersten Versuch).
        for s in 0..5u8 {
            let c = strip.left_center() + vec2(12.0 + f32::from(s) * 15.0, 0.0);
            draw_star(&painter, c, 6.0, s < m.stars);
        }
        let fc = strip.right_center() - vec2(12.0, 0.0);
        match m.flag {
            1 => {
                let w = Stroke::new(1.5, Color32::WHITE);
                painter.line_segment([fc + vec2(-4.0, 7.0), fc + vec2(-4.0, -7.0)], w);
                painter.add(egui::Shape::convex_polygon(
                    vec![fc + vec2(-4.0, -7.0), fc + vec2(6.0, -3.5), fc + vec2(-4.0, 0.0)],
                    Color32::WHITE,
                    Stroke::NONE,
                ));
            }
            -1 => {
                let r = Stroke::new(2.0, Color32::from_rgb(230, 80, 80));
                painter.line_segment([fc + vec2(-5.0, -5.0), fc + vec2(5.0, 5.0)], r);
                painter.line_segment([fc + vec2(-5.0, 5.0), fc + vec2(5.0, -5.0)], r);
            }
            _ => {}
        }
        painter.text(
            rect.left_top() + vec2(6.0, 4.0),
            Align2::LEFT_TOP,
            format!("#{}", i + 1),
            FontId::proportional(12.0),
            Color32::from_white_alpha(200),
        );
        if i == self.focus {
            painter.rect_stroke(
                rect,
                2.0,
                Stroke::new(3.0, Color32::from_rgb(90, 160, 255)),
                StrokeKind::Outside,
            );
        }
    }
}

/// Fuenfzackiger Stern: gefuellt aus Fuenfeck plus fuenf Spitzen (konvexe Teile).
fn draw_star(p: &egui::Painter, c: egui::Pos2, r: f32, filled: bool) {
    let pt = |k: usize, rad: f32| {
        let a = -std::f32::consts::FRAC_PI_2 + k as f32 * std::f32::consts::PI / 5.0;
        c + vec2(a.cos(), a.sin()) * rad
    };
    let gold = Color32::from_rgb(240, 200, 80);
    let outline: Vec<egui::Pos2> = (0..10).map(|k| pt(k, if k % 2 == 0 { r } else { r * 0.45 })).collect();
    if filled {
        let inner: Vec<egui::Pos2> = (0..5).map(|k| pt(2 * k + 1, r * 0.45)).collect();
        p.add(egui::Shape::convex_polygon(inner, gold, Stroke::NONE));
        for k in 0..5 {
            p.add(egui::Shape::convex_polygon(
                vec![pt(2 * k, r), pt(2 * k + 1, r * 0.45), pt((2 * k + 9) % 10, r * 0.45)],
                gold,
                Stroke::NONE,
            ));
        }
    } else {
        p.add(egui::Shape::closed_line(outline, Stroke::new(1.0, Color32::from_white_alpha(120))));
    }
}
