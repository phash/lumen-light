//! Fake-Vorschaubilder: 400 px, prozedural in Worker-Threads erzeugt,
//! auf dem UI-Thread als egui-Textur hochgeladen (LRU-Cache).
//!
//! Nachbildung der echten Lage: Thumbnails kommen aus Decodern im
//! Hintergrund, der UI-Thread laedt nur hoch, mit Budget pro Frame.

use std::collections::HashMap;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use eframe::egui;

pub const THUMB_PX: usize = 400;
const CACHE_MAX: usize = 320;
const UPLOADS_PER_FRAME: usize = 16;
const WORKERS: usize = 3;

pub struct Thumbs {
    cache: HashMap<usize, (egui::TextureHandle, u64)>,
    wanted: Arc<Mutex<Vec<usize>>>,
    rx: mpsc::Receiver<(usize, egui::ColorImage)>,
    frame: u64,
    pub uploads_last_frame: usize,
    pub uploads_total: usize,
    ctx: egui::Context,
}

impl Thumbs {
    pub fn new(ctx: &egui::Context) -> Thumbs {
        let wanted: Arc<Mutex<Vec<usize>>> = Arc::default();
        let (tx, rx) = mpsc::channel();
        for _ in 0..WORKERS {
            let wanted = wanted.clone();
            let tx = tx.clone();
            let ctx = ctx.clone();
            std::thread::spawn(move || {
                loop {
                    // LIFO: zuletzt gewuenschte (sichtbare) Kachel zuerst.
                    let job = wanted.lock().unwrap().pop();
                    match job {
                        Some(i) => {
                            if tx.send((i, make_thumb(i))).is_err() {
                                return;
                            }
                            ctx.request_repaint();
                        }
                        None => std::thread::sleep(Duration::from_millis(2)),
                    }
                }
            });
        }
        Thumbs {
            cache: HashMap::new(),
            wanted,
            rx,
            frame: 0,
            uploads_last_frame: 0,
            uploads_total: 0,
            ctx: ctx.clone(),
        }
    }

    /// Einmal pro Frame vor dem Zeichnen: fertige Bilder hochladen,
    /// Wunschliste auf die sichtbaren Kacheln setzen.
    pub fn begin_frame(&mut self, visible: std::ops::Range<usize>) {
        self.frame += 1;
        let mut n = 0;
        while n < UPLOADS_PER_FRAME {
            let Ok((i, img)) = self.rx.try_recv() else {
                break;
            };
            if self.cache.contains_key(&i) {
                continue;
            }
            let tex = self
                .ctx
                .load_texture(format!("thumb-{i}"), img, egui::TextureOptions::LINEAR);
            self.cache.insert(i, (tex, self.frame));
            n += 1;
        }
        self.uploads_last_frame = n;
        self.uploads_total += n;

        let mut w = self.wanted.lock().unwrap();
        w.clear();
        // Rueckwaerts eintragen, damit pop() oben links beginnt.
        for i in visible.rev() {
            if !self.cache.contains_key(&i) {
                w.push(i);
            }
        }
        drop(w);

        if self.cache.len() > CACHE_MAX {
            let mut by_age: Vec<(usize, u64)> =
                self.cache.iter().map(|(k, (_, f))| (*k, *f)).collect();
            by_age.sort_by_key(|(_, f)| *f);
            for (k, _) in by_age.iter().take(self.cache.len() - CACHE_MAX) {
                self.cache.remove(k);
            }
        }
    }

    pub fn get(&mut self, i: usize) -> Option<egui::TextureId> {
        let frame = self.frame;
        self.cache.get_mut(&i).map(|(t, f)| {
            *f = frame;
            t.id()
        })
    }
}

/// Prozedurales Testbild: Farbverlauf pro Index plus Kreis.
fn make_thumb(i: usize) -> egui::ColorImage {
    let h = (i as u32).wrapping_mul(2_654_435_761);
    let hue = (h % 360) as f32 / 360.0;
    let (cx, cy) = (
        100.0 + (h >> 8) as f32 % 200.0,
        100.0 + (h >> 16) as f32 % 200.0,
    );
    let mut px = Vec::with_capacity(THUMB_PX * THUMB_PX);
    for y in 0..THUMB_PX {
        for x in 0..THUMB_PX {
            let t = (x + y) as f32 / (2 * THUMB_PX) as f32;
            let d = ((x as f32 - cx).powi(2) + (y as f32 - cy).powi(2)).sqrt();
            let light = if d < 70.0 { 0.85 } else { 0.25 + 0.5 * t };
            let c = egui::ecolor::Hsva::new((hue + 0.15 * t) % 1.0, 0.6, light, 1.0);
            px.push(egui::Color32::from(c));
        }
    }
    egui::ColorImage::new([THUMB_PX, THUMB_PX], px)
}
