//! WGSL-Port gegen die Goldens aus dem WebGL-Renderer (Task 1).
//!
//! Je Fixture-Ordner unter `tests-fixtures/goldens/` und je Set mit
//! `spike: true`: `source.rgb16` hochladen, entwickeln, gegen `<set>.png`
//! vergleichen. Fehlende PNGs (Ruling R7) werden uebersprungen.

use std::fs;
use std::path::PathBuf;

use lumen_gpu::{Developer, Gpu, SourceTexture, ToneParams};
use lumen_raw::Rgb16Image;
use serde_json::Value;

/// Toleranz laut Spike-Vorgabe: max. Kanalabweichung in 8-bit-Stufen.
const MAX_ABWEICHUNG: u8 = 2;

/// Wie die dE2000-Grenze angewendet wird (`LUMEN_DE_MODE`).
#[derive(Debug, Clone, Copy, PartialEq)]
enum DeModus {
    /// Mittelwert pro Bild und Set muss unter der Grenze liegen (Default).
    Mittel,
    /// Jedes einzelne Pixel muss unter der Grenze liegen.
    Pixel,
    /// Nur messen und ausgeben, nicht pruefen.
    Aus,
}

/// Default-Grenze fuer dE2000 (`LUMEN_DE_MAX` ueberschreibt).
const DE_GRENZE: f64 = 1.0;

fn de_modus_aus(wert: Option<&str>) -> DeModus {
    match wert.map(str::trim) {
        None | Some("") | Some("mean") | Some("mittel") => DeModus::Mittel,
        Some("pixel") => DeModus::Pixel,
        Some("off") | Some("aus") => DeModus::Aus,
        Some(other) => panic!("LUMEN_DE_MODE={other} unbekannt (mean|pixel|off)"),
    }
}

fn de_grenze_aus(wert: Option<&str>) -> f64 {
    match wert.map(str::trim) {
        None | Some("") => DE_GRENZE,
        Some(v) => v
            .parse()
            .unwrap_or_else(|_| panic!("LUMEN_DE_MAX={v} ist keine Zahl")),
    }
}

/// true = Set verletzt die dE-Grenze im gewaehlten Modus.
fn de_verletzt(modus: DeModus, grenze: f64, mean_de: f64, max_de: f64) -> bool {
    match modus {
        DeModus::Mittel => mean_de >= grenze,
        DeModus::Pixel => max_de >= grenze,
        DeModus::Aus => false,
    }
}

#[test]
fn de_modus_wird_aus_env_wert_gelesen() {
    assert_eq!(de_modus_aus(None), DeModus::Mittel);
    assert_eq!(de_modus_aus(Some("mean")), DeModus::Mittel);
    assert_eq!(de_modus_aus(Some("pixel")), DeModus::Pixel);
    assert_eq!(de_modus_aus(Some("off")), DeModus::Aus);
    assert_eq!(de_grenze_aus(None), 1.0);
    assert_eq!(de_grenze_aus(Some("1.5")), 1.5);
}

#[test]
fn de_grenze_greift_je_nach_modus() {
    // Messwert aus dem Spike: Mittel 0,08, einzelnes Pixel 1,25.
    assert!(!de_verletzt(DeModus::Mittel, 1.0, 0.08, 1.25));
    assert!(de_verletzt(DeModus::Pixel, 1.0, 0.08, 1.25));
    assert!(!de_verletzt(DeModus::Pixel, 1.5, 0.08, 1.25));
    assert!(de_verletzt(DeModus::Mittel, 1.0, 1.0, 1.0));
    assert!(!de_verletzt(DeModus::Aus, 1.0, 9.0, 9.0));
}

/// Repo-Wurzel; per `LUMEN_REPO_ROOT` ueberschreibbar (Testbinary auf einem anderen Rechner).
fn repo_root() -> PathBuf {
    match std::env::var_os("LUMEN_REPO_ROOT") {
        Some(p) => PathBuf::from(p),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
    }
}

fn read_source(dir: &std::path::Path) -> Rgb16Image {
    let meta: Value = serde_json::from_slice(&fs::read(dir.join("source.json")).unwrap()).unwrap();
    let width = meta["width"].as_u64().unwrap() as u32;
    let height = meta["height"].as_u64().unwrap() as u32;
    let bytes = fs::read(dir.join("source.rgb16")).unwrap();
    assert_eq!(
        bytes.len(),
        width as usize * height as usize * 6,
        "source.rgb16 Groesse"
    );
    let data = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|b| u16::from_le_bytes(*b))
        .collect();
    Rgb16Image {
        width,
        height,
        data,
    }
}

/// PNG -> RGBA8 (Golden-PNGs sind RGBA8; RGB wird mit Alpha 255 ergaenzt).
fn read_png(path: &std::path::Path) -> (u32, u32, Vec<u8>) {
    let decoder = png::Decoder::new(std::io::BufReader::new(fs::File::open(path).unwrap()));
    let mut reader = decoder.read_info().unwrap();
    let mut buf = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut buf).unwrap();
    assert_eq!(info.bit_depth, png::BitDepth::Eight, "{}", path.display());
    let data = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => data.to_vec(),
        png::ColorType::Rgb => data
            .as_chunks::<3>()
            .0
            .iter()
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        other => panic!("{}: Farbtyp {other:?} nicht erwartet", path.display()),
    };
    (info.width, info.height, rgba)
}

fn srgb8_to_lab(c: [u8; 3]) -> [f64; 3] {
    let lin = |v: u8| {
        let v = f64::from(v) / 255.0;
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    let (r, g, b) = (lin(c[0]), lin(c[1]), lin(c[2]));
    let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    let y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    let z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
    let f = |t: f64| {
        if t > (6.0f64 / 29.0).powi(3) {
            t.cbrt()
        } else {
            t / (3.0 * (6.0f64 / 29.0).powi(2)) + 4.0 / 29.0
        }
    };
    let (fx, fy, fz) = (f(x), f(y), f(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// CIEDE2000 (Sharma, Wu, Dalal 2005), kL = kC = kH = 1.
fn delta_e2000(a: [f64; 3], b: [f64; 3]) -> f64 {
    use std::f64::consts::PI;
    let [l1, a1, b1] = a;
    let [l2, a2, b2] = b;
    let c1 = a1.hypot(b1);
    let c2 = a2.hypot(b2);
    let cm = (c1 + c2) / 2.0;
    let g = 0.5 * (1.0 - (cm.powi(7) / (cm.powi(7) + 25f64.powi(7))).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = a1p.hypot(b1);
    let c2p = a2p.hypot(b2);
    let hue = |bb: f64, ap: f64| {
        if bb == 0.0 && ap == 0.0 {
            0.0
        } else {
            let h = bb.atan2(ap).to_degrees();
            if h < 0.0 { h + 360.0 } else { h }
        }
    };
    let h1p = hue(b1, a1p);
    let h2p = hue(b2, a2p);
    let dlp = l2 - l1;
    let dcp = c2p - c1p;
    let dhp = if c1p * c2p == 0.0 {
        0.0
    } else if (h2p - h1p).abs() <= 180.0 {
        h2p - h1p
    } else if h2p - h1p > 180.0 {
        h2p - h1p - 360.0
    } else {
        h2p - h1p + 360.0
    };
    let dhp_big = 2.0 * (c1p * c2p).sqrt() * (dhp.to_radians() / 2.0).sin();
    let lpm = (l1 + l2) / 2.0;
    let cpm = (c1p + c2p) / 2.0;
    let hpm = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) / 2.0
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) / 2.0
    } else {
        (h1p + h2p - 360.0) / 2.0
    };
    let t = 1.0 - 0.17 * (hpm - 30.0).to_radians().cos()
        + 0.24 * (2.0 * hpm).to_radians().cos()
        + 0.32 * (3.0 * hpm + 6.0).to_radians().cos()
        - 0.20 * (4.0 * hpm - 63.0).to_radians().cos();
    let dtheta = 30.0 * (-((hpm - 275.0) / 25.0).powi(2)).exp();
    let rc = 2.0 * (cpm.powi(7) / (cpm.powi(7) + 25f64.powi(7))).sqrt();
    let sl = 1.0 + 0.015 * (lpm - 50.0).powi(2) / (20.0 + (lpm - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * cpm;
    let sh = 1.0 + 0.015 * cpm * t;
    let rt = -(2.0 * dtheta * PI / 180.0).sin() * rc;
    ((dlp / sl).powi(2)
        + (dcp / sc).powi(2)
        + (dhp_big / sh).powi(2)
        + rt * (dcp / sc) * (dhp_big / sh))
        .sqrt()
}

#[test]
fn delta_e2000_referenzwerte_sharma() {
    // Testpaare aus Sharma et al. (2005), Tabelle 1.
    let cases = [
        ([50.0, 2.6772, -79.7751], [50.0, 0.0, -82.7485], 2.0425),
        ([50.0, -1.0, 2.0], [50.0, 0.0, 0.0], 2.3669),
        ([50.0, 2.5, 0.0], [73.0, 25.0, -18.0], 27.1492),
        (
            [60.2574, -34.0099, 36.2677],
            [60.4626, -34.1751, 39.4387],
            1.2644,
        ),
    ];
    for (a, b, want) in cases {
        let got = delta_e2000(a, b);
        assert!((got - want).abs() < 1e-4, "{a:?} {b:?}: {got} statt {want}");
    }
}

struct Ergebnis {
    fixture: String,
    set: String,
    max: u8,
    mean_de: f64,
    max_de: f64,
    over: usize,
}

#[test]
fn spike_sets_treffen_goldens() {
    let root = repo_root().join("tests-fixtures/goldens");
    let sets: Value = serde_json::from_slice(&fs::read(root.join("sets.json")).unwrap()).unwrap();
    let spike_sets: Vec<&Value> = sets
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["spike"].as_bool() == Some(true))
        .collect();
    assert!(!spike_sets.is_empty(), "keine Spike-Sets in sets.json");

    let de_modus = de_modus_aus(std::env::var("LUMEN_DE_MODE").ok().as_deref());
    let de_grenze = de_grenze_aus(std::env::var("LUMEN_DE_MAX").ok().as_deref());
    eprintln!("dE2000-Pruefung: {de_modus:?}, Grenze {de_grenze}");

    let gpu = Gpu::headless().expect("GPU fuer den Test noetig");
    eprintln!(
        "Adapter: {} ({:?}, Treiber {} {})",
        gpu.adapter_info.name,
        gpu.adapter_info.backend,
        gpu.adapter_info.driver,
        gpu.adapter_info.driver_info
    );
    let dev = Developer::new(&gpu, wgpu::TextureFormat::Rgba8Unorm);

    let mut dirs: Vec<PathBuf> = fs::read_dir(&root)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join("source.rgb16").is_file())
        .collect();
    dirs.sort();
    assert!(
        !dirs.is_empty(),
        "keine Golden-Fixtures unter {}",
        root.display()
    );

    let mut results = Vec::new();
    let mut portrait_checked = false;
    for dir in &dirs {
        let fixture = dir.file_name().unwrap().to_string_lossy().into_owned();
        let img = read_source(dir);
        let src = SourceTexture::upload(&gpu, &img).expect("Upload");
        for set in &spike_sets {
            let id = set["id"].as_str().unwrap();
            let png_path = dir.join(format!("{id}.png"));
            if !png_path.is_file() {
                continue;
            }
            let (gw, gh, golden) = read_png(&png_path);
            assert_eq!((gw, gh), (img.width, img.height), "{fixture}/{id}: Groesse");
            let params = ToneParams::from_adjustments_json(&set["adjustments"]);
            let out = dev.render_to_rgba8(&gpu, &src, &params);
            assert_eq!(out.len(), golden.len());

            let mut max = 0u8;
            let mut over = 0usize;
            let mut sum_de = 0.0;
            let mut max_de: f64 = 0.0;
            for (o, g) in out.as_chunks::<4>().0.iter().zip(golden.as_chunks::<4>().0) {
                let d = (0..3).map(|c| o[c].abs_diff(g[c])).max().unwrap();
                max = max.max(d);
                if d > MAX_ABWEICHUNG {
                    over += 1;
                }
                let de = delta_e2000(
                    srgb8_to_lab([o[0], o[1], o[2]]),
                    srgb8_to_lab([g[0], g[1], g[2]]),
                );
                sum_de += de;
                max_de = max_de.max(de);
            }
            let mean_de = sum_de / (out.len() / 4) as f64;
            if img.height > img.width {
                portrait_checked = true;
            }
            results.push(Ergebnis {
                fixture: fixture.clone(),
                set: id.to_owned(),
                max,
                mean_de,
                max_de,
                over,
            });
        }
    }

    eprintln!(
        "| Fixture | Set | max |d| | Pixel > {MAX_ABWEICHUNG} | mittl. dE2000 | max dE2000 |"
    );
    eprintln!("|---|---|---|---|---|---|");
    for r in &results {
        eprintln!(
            "| {} | {} | {} | {} | {:.4} | {:.3} |{}",
            r.fixture,
            r.set,
            r.max,
            r.over,
            r.mean_de,
            r.max_de,
            if r.max > MAX_ABWEICHUNG || de_verletzt(de_modus, de_grenze, r.mean_de, r.max_de) {
                " FAIL"
            } else {
                ""
            }
        );
    }
    assert!(portrait_checked, "kein Hochformat-Fixture geprueft");
    // CI-Pflicht: 8 Fixtures x 6 Spike-Sets = 48 Vergleiche (Spike-Ergebnis S4).
    assert!(
        results.len() >= 48 || !lumen_raw::testutil::require_fixtures(),
        "LUMEN_REQUIRE_FIXTURES: nur {} Vergleiche, erwartet >= 48",
        results.len()
    );
    let failed: Vec<String> = results
        .iter()
        .filter(|r| r.max > MAX_ABWEICHUNG)
        .map(|r| format!("{}/{} (max {})", r.fixture, r.set, r.max))
        .collect();
    assert!(
        failed.is_empty(),
        "{} von {} Sets ueber {MAX_ABWEICHUNG}/255: {}",
        failed.len(),
        results.len(),
        failed.join(", ")
    );
    let de_failed: Vec<String> = results
        .iter()
        .filter(|r| de_verletzt(de_modus, de_grenze, r.mean_de, r.max_de))
        .map(|r| {
            format!(
                "{}/{} (mittel {:.3}, max {:.3})",
                r.fixture, r.set, r.mean_de, r.max_de
            )
        })
        .collect();
    assert!(
        de_failed.is_empty(),
        "{} von {} Sets verletzen dE2000 < {de_grenze} ({de_modus:?}): {}",
        de_failed.len(),
        results.len(),
        de_failed.join(", ")
    );
}
