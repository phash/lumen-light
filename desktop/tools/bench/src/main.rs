//! Bench-Binary: Decode-Zeiten je Datei und GPU-Frame-Zeit auf dem Proxy.
//!
//! Aufruf: `lumen-bench [--runs N] [--out bench.json] <dateien...>`

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::time::Instant;

use lumen_gpu::{Developer, Gpu, SourceTexture, ToneParams};
use lumen_raw::{DecodeMode, Rgb16Image, box_downscale, decode, embedded_preview};
use serde_json::{Value, json};

const PROXY_LONG_EDGE: u32 = 2560;
const FRAME_RENDERS: usize = 200;
const FRAME_WARMUP: usize = 5;

/// Median (bei gerader Anzahl Mittel der beiden mittleren Werte).
fn median(v: &[f64]) -> f64 {
    percentile(v, 50.0)
}

/// Perzentil nach naechstem Rang (Nearest-Rank); leere Eingabe ergibt 0.
fn percentile(v: &[f64], p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    if (p - 50.0).abs() < f64::EPSILON && s.len().is_multiple_of(2) {
        let i = s.len() / 2;
        return (s[i - 1] + s[i]) / 2.0;
    }
    let rank = ((p / 100.0) * s.len() as f64).ceil() as usize;
    s[rank.clamp(1, s.len()) - 1]
}

fn ms(t: Instant) -> f64 {
    t.elapsed().as_secs_f64() * 1000.0
}

fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

/// JSON-Eintrag einer Datei; `error` nur bei Fehlern.
fn file_json(
    name: &str,
    bytes: u64,
    megapixels: f64,
    stages: [Option<f64>; 3],
    errors: &[String],
) -> Value {
    let mut o = json!({
        "name": name,
        "bytes": bytes,
        "megapixels": round2(megapixels),
        "preview_ms": stages[0].map(round2),
        "half_ms": stages[1].map(round2),
        "full_ms": stages[2].map(round2),
    });
    if !errors.is_empty() {
        o["error"] = json!(errors.join("; "));
    }
    o
}

/// Fuehrt `f` aus, faengt Panics ab und liefert Fehler als Text.
fn guarded<T>(f: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(f)).unwrap_or_else(|_| Err("Panic".to_string()))
}

/// Misst `runs` Laeufe von `f`, liefert Median in ms und das letzte Ergebnis.
fn time_runs<T>(runs: usize, mut f: impl FnMut() -> Result<T, String>) -> Result<(f64, T), String> {
    let mut times = Vec::with_capacity(runs);
    let mut last = None;
    for _ in 0..runs {
        let t = Instant::now();
        let r = guarded(&mut f)?;
        times.push(ms(t));
        last = Some(r);
    }
    last.map(|r| (median(&times), r))
        .ok_or_else(|| "runs=0".to_string())
}

struct FileResult {
    json: Value,
    /// Half-Bild fuer die Frame-Messung (nur wenn Decode klappte).
    half: Option<Rgb16Image>,
}

fn bench_file(path: &str, runs: usize) -> FileResult {
    let name = Path::new(path)
        .file_name()
        .map_or_else(|| path.to_string(), |n| n.to_string_lossy().into_owned());
    // Einmal lesen: Page-Cache warm wie beim echten Blaettern.
    let bytes = match std::fs::read(path) {
        Ok(b) => b.len() as u64,
        Err(e) => {
            let msg = if e.kind() == std::io::ErrorKind::NotFound {
                "fehlt".to_string()
            } else {
                e.to_string()
            };
            return FileResult {
                json: file_json(&name, 0, 0.0, [None; 3], &[msg]),
                half: None,
            };
        }
    };
    let mut errors = Vec::new();
    let mut stages = [None; 3];
    let mut mp = 0.0;
    let mut half_img = None;

    match time_runs(runs, || {
        embedded_preview(Path::new(path)).map_err(|e| e.to_string())
    }) {
        Ok((t, _)) => stages[0] = Some(t),
        Err(e) => errors.push(format!("preview: {e}")),
    }
    for (slot, mode, label) in [(1, DecodeMode::Half, "half"), (2, DecodeMode::Full, "full")] {
        match time_runs(runs, || {
            decode(Path::new(path), mode)
                .map(|(img, _)| img)
                .map_err(|e| e.to_string())
        }) {
            Ok((t, img)) => {
                stages[slot] = Some(t);
                if mode == DecodeMode::Full {
                    mp = f64::from(img.width) * f64::from(img.height) / 1e6;
                } else {
                    half_img = Some(img);
                }
            }
            Err(e) => errors.push(format!("{label}: {e}")),
        }
    }
    FileResult {
        json: file_json(&name, bytes, mp, stages, &errors),
        half: half_img,
    }
}

/// Frame-Messung: Wandzeit je Render inkl. `poll(Wait)` (Timestamp-Query ist
/// ueber die oeffentliche API von lumen-gpu nicht erreichbar, siehe `method`).
fn bench_frame(src_img: &Rgb16Image) -> Result<Value, String> {
    let proxy = box_downscale(src_img, PROXY_LONG_EDGE);
    let gpu = Gpu::headless().map_err(|e| e.to_string())?;
    let src = SourceTexture::upload(&gpu, &proxy).map_err(|e| e.to_string())?;
    let format = wgpu::TextureFormat::Rgba8Unorm;
    let dev = Developer::new(&gpu, format);
    let target = gpu.device.create_texture(&wgpu::TextureDescriptor {
        label: Some("bench-target"),
        size: wgpu::Extent3d {
            width: proxy.width,
            height: proxy.height,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        view_formats: &[],
    });
    let view = target.create_view(&wgpu::TextureViewDescriptor::default());
    let mut times = Vec::with_capacity(FRAME_RENDERS);
    for i in 0..FRAME_WARMUP + FRAME_RENDERS {
        let p = ToneParams {
            exposure: (i % 41) as f32 / 10.0 - 2.0,
            ..ToneParams::default()
        };
        let t = Instant::now();
        dev.render(&gpu, &src, &p, &view, (proxy.width, proxy.height));
        gpu.device
            .poll(wgpu::PollType::wait_indefinitely())
            .map_err(|e| e.to_string())?;
        if i >= FRAME_WARMUP {
            times.push(ms(t));
        }
    }
    Ok(json!({
        "proxy": [proxy.width, proxy.height],
        "renders": FRAME_RENDERS,
        "gpu_ms_p50": round2(median(&times)),
        "gpu_ms_p95": round2(percentile(&times, 95.0)),
        "method": "wandzeit: render + submit + device.poll(Wait); kein TIMESTAMP_QUERY (Developer::render kapselt den Encoder, Geraet ohne Feature)",
        "adapter": adapter_json(&gpu),
    }))
}

fn adapter_json(gpu: &Gpu) -> Value {
    let i = &gpu.adapter_info;
    json!({
        "name": i.name,
        "backend": format!("{:?}", i.backend),
        "device_type": format!("{:?}", i.device_type),
        "driver": i.driver,
        "driver_info": i.driver_info,
    })
}

fn host_json() -> Value {
    let read = |p: &str| std::fs::read_to_string(p).unwrap_or_default();
    let cpu = read("/proc/cpuinfo")
        .lines()
        .find(|l| l.starts_with("model name"))
        .and_then(|l| l.split_once(':'))
        .map(|(_, v)| v.trim().to_string())
        .unwrap_or_default();
    json!({
        "hostname": read("/proc/sys/kernel/hostname").trim(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "cpu": cpu,
    })
}

struct Args {
    runs: usize,
    out: Option<String>,
    files: Vec<String>,
}

fn parse_args(args: impl Iterator<Item = String>) -> Result<Args, String> {
    let mut a = Args {
        runs: 5,
        out: None,
        files: Vec::new(),
    };
    let mut it = args;
    while let Some(arg) = it.next() {
        match arg.as_str() {
            "--runs" => {
                a.runs = it
                    .next()
                    .and_then(|v| v.parse().ok())
                    .filter(|n| *n > 0)
                    .ok_or("--runs braucht eine Zahl > 0")?;
            }
            "--out" => a.out = Some(it.next().ok_or("--out braucht einen Pfad")?),
            s if s.starts_with("--") => return Err(format!("unbekannte Option {s}")),
            _ => a.files.push(arg),
        }
    }
    Ok(a)
}

fn main() {
    let args = match parse_args(std::env::args().skip(1)) {
        Ok(a) if !a.files.is_empty() => a,
        Ok(_) => {
            return eprintln!("Aufruf: lumen-bench [--runs N] [--out bench.json] <dateien...>");
        }
        Err(e) => return eprintln!("Fehler: {e}"),
    };
    let mut files = Vec::new();
    let mut biggest: Option<Rgb16Image> = None;
    for path in &args.files {
        eprintln!("[bench] {path}");
        let r = bench_file(path, args.runs);
        files.push(r.json);
        if let Some(h) = r.half {
            let px = |i: &Rgb16Image| u64::from(i.width) * u64::from(i.height);
            if biggest.as_ref().is_none_or(|b| px(&h) > px(b)) {
                biggest = Some(h);
            }
        }
    }
    let frame = match &biggest {
        Some(img) => guarded(|| bench_frame(img)).unwrap_or_else(|e| json!({ "error": e })),
        None => json!({ "error": "kein dekodiertes Bild fuer die Frame-Messung" }),
    };
    let adapter = frame.get("adapter").cloned().unwrap_or(Value::Null);
    let out = json!({
        "host": host_json(),
        "adapter": adapter,
        "runs": args.runs,
        "files": files,
        "frame": frame,
    });
    let text = serde_json::to_string_pretty(&out).unwrap_or_default();
    match &args.out {
        Some(p) => {
            if let Err(e) = std::fs::write(p, &text) {
                eprintln!("Schreiben nach {p} fehlgeschlagen: {e}");
            }
        }
        None => println!("{text}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_ungerade_und_gerade() {
        assert_eq!(median(&[3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(&[4.0, 1.0, 2.0, 3.0]), 2.5);
        assert_eq!(median(&[]), 0.0);
    }

    #[test]
    fn perzentil_nearest_rank() {
        let v: Vec<f64> = (1..=100).map(f64::from).collect();
        assert_eq!(percentile(&v, 95.0), 95.0);
        assert_eq!(percentile(&v, 100.0), 100.0);
        assert_eq!(percentile(&[7.0], 95.0), 7.0);
    }

    #[test]
    fn datei_json_form_mit_und_ohne_fehler() {
        let ok = file_json("a.nef", 10, 24.123, [Some(1.0), Some(2.0), Some(3.0)], &[]);
        assert_eq!(ok["megapixels"], 24.12);
        assert_eq!(ok["full_ms"], 3.0);
        assert!(ok.get("error").is_none());
        let bad = file_json("z.nef", 0, 0.0, [None; 3], &["fehlt".to_string()]);
        assert_eq!(bad["error"], "fehlt");
        assert!(bad["half_ms"].is_null());
    }

    #[test]
    fn argumente_werden_geparst() {
        let a = parse_args(
            ["--runs", "3", "--out", "x.json", "a", "b"]
                .into_iter()
                .map(String::from),
        )
        .unwrap();
        assert_eq!(
            (a.runs, a.out.as_deref(), a.files.len()),
            (3, Some("x.json"), 2)
        );
        assert!(parse_args(["--runs", "0"].into_iter().map(String::from)).is_err());
        assert!(parse_args(["--wat"].into_iter().map(String::from)).is_err());
    }

    #[test]
    fn fehlende_datei_meldet_fehlt() {
        let r = bench_file("/nicht/da/Nikon_Z6III_HE.NEF", 1);
        assert_eq!(r.json["error"], "fehlt");
        assert!(r.half.is_none());
    }
}
