use lumen_plugin_manifest::{
    HINT_QUOTE_CAPS, ManifestError, Tier, parse_manifest, spec_toml_block,
};

mod common;
use common::{FIRST, SPEC, uncommented};

#[test]
fn beispiel_aus_spec_parst() {
    let m = parse_manifest(spec_toml_block(SPEC, FIRST).as_bytes()).expect("parst");
    assert_eq!(m.id, "mrd.guided-denoise");
    assert_eq!(m.tier, Tier::Shader);
    assert_eq!(m.params.len(), 3);
    assert_eq!(m.contributes.gpu_chain[0].pass.len(), 2);
    assert_eq!(m.params["radius"].loop_bound, Some(true));
}

#[test]
fn auskommentierte_zeilen_parsen_per_serde() {
    let src = uncommented();
    assert!(src.contains("wasm = \"plugin.wasm\""));
    assert!(src.contains("net = {"));
    let m = parse_manifest(src.as_bytes()).expect("parst");
    assert!(m.artifacts.wasm.is_some());
    assert!(m.artifacts.native.is_some());
}

#[test]
fn unbekannter_schluessel_ist_fehler() {
    let src = format!("colour = 1\n{}", spec_toml_block(SPEC, FIRST));
    assert!(matches!(
        parse_manifest(src.as_bytes()),
        Err(ManifestError::Toml { .. })
    ));
}

#[test]
fn ungequotetes_recht_gibt_hinweis() {
    let src = spec_toml_block(SPEC, FIRST).replace(
        "\"image.process\" = [\"gpu-pass\"]",
        "image.process = [\"gpu-pass\"]",
    );
    match parse_manifest(src.as_bytes()) {
        Err(ManifestError::Toml { hint, .. }) => assert_eq!(hint, Some(HINT_QUOTE_CAPS)),
        other => panic!("erwartet Toml-Fehler mit Hinweis, bekam {other:?}"),
    }
}
