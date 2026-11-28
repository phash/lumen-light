use std::path::PathBuf;

use lumen_plugin_api::WIT_DIR_0_1;
use wit_parser::{Resolve, WorldItem, WorldKey};

const SPEC: &str =
    include_str!("../../../../docs/superpowers/specs/2026-11-28-plugin-system-design.md");

fn dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(WIT_DIR_0_1)
}

fn resolve() -> Resolve {
    let mut r = Resolve::default();
    r.push_dir(dir()).expect("WIT parst");
    r
}

fn imports(r: &Resolve, world: &str) -> Vec<String> {
    let (_, w) = r
        .worlds
        .iter()
        .find(|(_, w)| w.name == world)
        .unwrap_or_else(|| panic!("Welt {world} fehlt"));
    w.imports
        .iter()
        .filter_map(|(k, item)| match (k, item) {
            (WorldKey::Interface(id), WorldItem::Interface { .. }) => {
                r.interfaces[*id].name.clone()
            }
            (WorldKey::Name(n), _) => Some(n.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn wit_parst() {
    let r = resolve();
    let names: Vec<String> = r.packages.iter().map(|(_, p)| p.name.to_string()).collect();
    assert!(
        names.contains(&"lumen:plugin@0.1.0".to_string()),
        "{names:?}"
    );
}

#[test]
fn welten_vorhanden() {
    let r = resolve();
    for w in [
        "decoder-plugin",
        "metadata-plugin",
        "image-op-plugin",
        "encoder-plugin",
        "workflow-plugin",
    ] {
        assert!(r.worlds.iter().any(|(_, x)| x.name == w), "Welt {w} fehlt");
    }
}

#[test]
fn decoder_kann_kein_http() {
    let r = resolve();
    let i = imports(&r, "decoder-plugin");
    assert!(i.iter().any(|n| n == "types"), "Basis-Importe fehlen: {i:?}");
    assert!(!i.iter().any(|n| n == "http" || n == "catalog"), "{i:?}");
}

#[test]
fn spec_und_datei_gleich() {
    let spec = lumen_plugin_manifest::spec_block(SPEC, "wit", "package lumen:plugin@0.1.0;");
    let file = std::fs::read_to_string(dir().join("lumen-plugin.wit")).unwrap();
    assert_eq!(file, spec, "WIT-Datei und Spec-Block weichen ab");
}
