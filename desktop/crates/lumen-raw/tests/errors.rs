//! Fehlerpfade: kaputte, leere und fremde Dateien liefern `RawError`, kein Absturz.

use lumen_raw::{DecodeMode, RawError, decode, decode_bytes, testutil};

#[test]
fn leere_datei_gibt_fehler() {
    let res = decode_bytes(&[], DecodeMode::Full);
    assert!(res.is_err(), "leere Eingabe muss Err liefern");
}

#[test]
fn abgeschnittene_datei_gibt_fehler_ohne_absturz() {
    let Some(path) = testutil::fixture("Nikon_D7100.NEF") else {
        return;
    };
    let bytes = std::fs::read(path).expect("Fixture lesbar");
    let cut = &bytes[..64 * 1024];
    match decode_bytes(cut, DecodeMode::Full) {
        Err(e @ (RawError::Corrupt { .. } | RawError::Unsupported { .. })) => {
            eprintln!("abgeschnitten: {e}");
        }
        other => panic!("erwartet Corrupt|Unsupported, bekommen {other:?}"),
    }
}

#[test]
fn jpeg_ist_kein_raw() {
    let path = testutil::repo_path("tests-fixtures/test-samples/gradient.jpg");
    match decode(&path, DecodeMode::Full) {
        Err(RawError::Unsupported { detail }) => {
            assert!(!detail.is_empty());
            eprintln!("JPEG: {detail}");
        }
        other => panic!("erwartet Unsupported, bekommen {other:?}"),
    }
}

#[test]
fn z6iii_he_klar_gemeldet() {
    // Es gibt kein oeffentliches HE-NEF im Korpus: Pfad per LUMEN_HE_NEF angeben,
    // sonst SKIP.
    let Some(path) = std::env::var_os("LUMEN_HE_NEF").map(std::path::PathBuf::from) else {
        eprintln!("SKIP z6iii_he: LUMEN_HE_NEF nicht gesetzt");
        return;
    };
    match decode(&path, DecodeMode::Full) {
        Ok((img, meta)) => eprintln!(
            "Z6III HE: dekodiert {}x{} ({} {})",
            img.width, img.height, meta.make, meta.model
        ),
        Err(RawError::Unsupported { detail }) => {
            assert!(!detail.is_empty(), "Unsupported ohne Detail");
            eprintln!("Z6III HE: nicht unterstuetzt: {detail}");
        }
        Err(other) => panic!("erwartet Ok oder Unsupported, bekommen {other:?}"),
    }
}
