//! Paritaet: nativer Decode gegen die eingefrorene libraw-wasm-Quelle
//! (`tests-fixtures/goldens/<stem>/source.rgb16`, lange Kante 512).

use lumen_raw::{DecodeMode, box_downscale, decode, testutil};

/// Mittlere absolute Abweichung (16 bit), Grenze = 1/255.
const MAX_MAE: f64 = 256.0;
/// Abweichung des Kanal-Mittelwerts relativ zum Referenz-Mittelwert.
const MAX_CHANNEL_MEAN_REL: f64 = 0.005;

fn read_rgb16_le(path: &std::path::Path) -> Vec<u16> {
    let bytes = std::fs::read(path).expect("source.rgb16 lesbar");
    let (pairs, _) = bytes.as_chunks::<2>();
    pairs.iter().map(|c| u16::from_le_bytes(*c)).collect()
}

fn channel_means(data: &[u16]) -> [f64; 3] {
    let mut sum = [0f64; 3];
    for px in data.as_chunks::<3>().0 {
        for c in 0..3 {
            sum[c] += f64::from(px[c]);
        }
    }
    let n = (data.len() / 3) as f64;
    sum.map(|s| s / n)
}

#[test]
fn nativer_decode_trifft_libraw_wasm_quelle() {
    let goldens = testutil::repo_path("tests-fixtures/goldens");
    let text = std::fs::read_to_string(testutil::repo_path("tests-fixtures/manifest.json"))
        .expect("manifest.json lesbar");
    let manifest: serde_json::Value = serde_json::from_str(&text).expect("manifest.json gueltig");
    let mut failures = Vec::new();
    let mut checked = 0;

    for sample in manifest["samples"].as_array().expect("samples") {
        let name = sample["filename"].as_str().expect("filename");
        let stem = name.rsplit_once('.').map_or(name, |(s, _)| s);
        let dir = goldens.join(stem);
        let source = dir.join("source.rgb16");
        if !source.exists() {
            eprintln!("SKIP {name}: keine Quelle {}", source.display());
            continue;
        }
        let Some(path) = testutil::fixture(name) else {
            continue;
        };
        let meta: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(dir.join("source.json")).expect("source.json lesbar"),
        )
        .expect("source.json gueltig");
        let ref_w = meta["width"].as_u64().expect("width") as u32;
        let ref_h = meta["height"].as_u64().expect("height") as u32;
        let reference = read_rgb16_le(&source);

        let (full, _) = decode(&path, DecodeMode::Full).expect("Decode");
        let small = box_downscale(&full, 512);
        checked += 1;

        if (small.width, small.height) != (ref_w, ref_h) {
            let msg = format!(
                "{name}: Masse {}x{} (voll {}x{}) != Referenz {ref_w}x{ref_h} (voll {}x{})",
                small.width,
                small.height,
                full.width,
                full.height,
                meta["srcWidth"],
                meta["srcHeight"]
            );
            eprintln!("{msg}");
            failures.push(msg);
            continue;
        }
        assert_eq!(reference.len(), small.data.len(), "{name}: Referenzlaenge");

        let mae = small
            .data
            .iter()
            .zip(&reference)
            .map(|(a, b)| f64::from(a.abs_diff(*b)))
            .sum::<f64>()
            / small.data.len() as f64;
        let max_abs = small
            .data
            .iter()
            .zip(&reference)
            .map(|(a, b)| a.abs_diff(*b))
            .max()
            .unwrap_or(0);
        let ours = channel_means(&small.data);
        let theirs = channel_means(&reference);
        let rel: Vec<f64> = (0..3)
            .map(|c| (ours[c] - theirs[c]).abs() / theirs[c].max(1.0))
            .collect();
        eprintln!(
            "PARITAET {name}: MAE {mae:.1} | max {max_abs} | Mittel nativ R{:.0} G{:.0} B{:.0} \
             wasm R{:.0} G{:.0} B{:.0} | rel. Abw. R{:.3}% G{:.3}% B{:.3}%",
            ours[0],
            ours[1],
            ours[2],
            theirs[0],
            theirs[1],
            theirs[2],
            rel[0] * 100.0,
            rel[1] * 100.0,
            rel[2] * 100.0
        );
        if mae > MAX_MAE || rel.iter().any(|r| *r > MAX_CHANNEL_MEAN_REL) {
            failures.push(format!("{name}: MAE {mae:.1}, rel {rel:?}"));
        }
    }
    eprintln!("Paritaet: {checked} Fixtures geprueft");
    assert!(
        failures.is_empty(),
        "Paritaet verfehlt:\n{}",
        failures.join("\n")
    );
}
