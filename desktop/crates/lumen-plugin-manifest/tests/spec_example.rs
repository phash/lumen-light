use lumen_plugin_manifest::{
    HINT_QUOTE_CAPS, ManifestError, Tier, parse_manifest, spec_toml_block,
};

pub const SPEC: &str =
    include_str!("../../../../docs/superpowers/specs/2026-11-28-plugin-system-design.md");
pub const FIRST: &str = "#:schema https://lumen.mr-development.de/schemas/lumen-plugin-1.json";

/// Spec-Beispiel mit allen auskommentierten S2-/Nativ-Zeilen aktiviert.
pub fn uncommented() -> String {
    spec_toml_block(SPEC, FIRST)
        .lines()
        .map(|l| {
            let t = l.trim_start();
            for p in [
                "# S2 ohne Dateibyte-/Bildinhalts-Rollen, nie nativ: ",
                "# S2: ",
                "# S2 (tier = \"wasm\"):    ",
                "# nativ (tier = \"native\"): ",
            ] {
                if let Some(rest) = t.strip_prefix(p) {
                    return rest.to_string();
                }
            }
            l.to_string()
        })
        .collect::<Vec<_>>()
        .join("\n")
}

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
