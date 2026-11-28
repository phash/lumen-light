#![allow(dead_code)]
use lumen_plugin_manifest::spec_toml_block;

pub const SPEC: &str =
    include_str!("../../../../../docs/superpowers/specs/2026-11-28-plugin-system-design.md");
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

pub fn example() -> lumen_plugin_manifest::Manifest {
    lumen_plugin_manifest::parse_manifest(spec_toml_block(SPEC, FIRST).as_bytes()).unwrap()
}
