//! Korpus: alle Fixtures aus `tests-fixtures/manifest.json` dekodieren.

use lumen_raw::{DecodeMode, decode, embedded_preview, testutil};

fn manifest_samples() -> Vec<serde_json::Value> {
    let path = testutil::repo_path("tests-fixtures/manifest.json");
    let text = std::fs::read_to_string(path).expect("manifest.json lesbar");
    let json: serde_json::Value = serde_json::from_str(&text).expect("manifest.json gueltig");
    json["samples"].as_array().expect("samples-Array").clone()
}

fn field<'a>(sample: &'a serde_json::Value, key: &str) -> &'a str {
    sample[key]
        .as_str()
        .unwrap_or_else(|| panic!("Feld {key} fehlt"))
}

#[test]
fn jedes_fixture_dekodiert_mit_hersteller_und_modell() {
    let mut checked = 0;
    for sample in manifest_samples() {
        let name = field(&sample, "filename");
        let Some(path) = testutil::fixture(name) else {
            continue;
        };
        checked += 1;
        let (img, meta) = decode(&path, DecodeMode::Full)
            .unwrap_or_else(|e| panic!("{name}: Decode fehlgeschlagen: {e}"));
        assert_eq!(meta.make, field(&sample, "expectedMake"), "{name}: make");
        let model_part = field(&sample, "expectedModelContains");
        assert!(
            meta.model.contains(model_part),
            "{name}: model {:?} enthaelt nicht {model_part:?}",
            meta.model
        );
        assert_eq!(
            img.data.len(),
            img.width as usize * img.height as usize * 3,
            "{name}: Pufferlaenge"
        );
        eprintln!(
            "{name}: {}x{} {} {}",
            img.width, img.height, meta.make, meta.model
        );
    }
    assert!(
        checked > 0 || !testutil::require_fixtures(),
        "LUMEN_REQUIRE_FIXTURES gesetzt, aber kein Fixture gefunden (scripts/fetch-test-images.sh)"
    );
}

#[test]
fn half_size_halbiert_kanten() {
    let Some(path) = testutil::fixture("Nikon_D7100.NEF") else {
        assert!(!testutil::require_fixtures(), "Nikon_D7100.NEF fehlt");
        return;
    };
    let (full, _) = decode(&path, DecodeMode::Full).expect("Full");
    let (half, _) = decode(&path, DecodeMode::Half).expect("Half");
    let close = |h: u32, f: u32| h.abs_diff(f.div_ceil(2)) <= 1;
    assert!(
        close(half.width, full.width) && close(half.height, full.height),
        "Half {}x{} passt nicht zu Full {}x{}",
        half.width,
        half.height,
        full.width,
        full.height
    );
    assert_eq!(
        half.data.len(),
        half.width as usize * half.height as usize * 3
    );
}

#[test]
fn hochformat_ist_gedreht() {
    let Some(path) = testutil::fixture("Nikon_1_S2_portrait.NEF") else {
        assert!(
            !testutil::require_fixtures(),
            "Nikon_1_S2_portrait.NEF fehlt"
        );
        return;
    };
    let (img, meta) = decode(&path, DecodeMode::Full).expect("Decode");
    assert!(
        img.height > img.width,
        "Hochformat erwartet, bekommen {}x{}",
        img.width,
        img.height
    );
    assert!(
        meta.orientation_applied,
        "Orientierung nicht als angewendet gemeldet"
    );
}

#[test]
fn eingebettete_vorschau_ist_jpeg() {
    let mut checked = 0;
    for name in ["Nikon_D7100.NEF", "Sony_A7M3.ARW", "Canon_EOS_600D.CR2"] {
        let Some(path) = testutil::fixture(name) else {
            continue;
        };
        checked += 1;
        let preview = embedded_preview(&path)
            .unwrap_or_else(|e| panic!("{name}: {e}"))
            .unwrap_or_else(|| panic!("{name}: keine JPEG-Vorschau"));
        assert!(
            preview.jpeg.starts_with(&[0xFF, 0xD8]),
            "{name}: kein JPEG-SOI"
        );
        assert!(preview.width > 0 && preview.height > 0, "{name}: Masse");
        eprintln!(
            "{name}: Vorschau {}x{}, {} Bytes",
            preview.width,
            preview.height,
            preview.jpeg.len()
        );
    }
    assert!(
        checked > 0 || !testutil::require_fixtures(),
        "LUMEN_REQUIRE_FIXTURES gesetzt, aber keine Vorschau-Fixture gefunden"
    );
}
