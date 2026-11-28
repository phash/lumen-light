//! Rechte-Namen und ihre erlaubten Stufen (Spec-Tabelle "Rechte (Capabilities)").

use crate::model::Tier;

/// Alle Rechte, die ein Manifest anfordern kann. `process.exec` steht hier,
/// damit es mit klarer Meldung abgelehnt wird: keine Stufe bekommt es.
pub const CAPABILITIES: &[(&str, &[Tier])] = &[
    ("log", &[Tier::Shader, Tier::Wasm, Tier::Native]),
    ("storage.private", &[Tier::Wasm]),
    ("settings", &[Tier::Wasm]),
    ("ui.panel", &[Tier::Shader, Tier::Wasm]),
    ("ui.menu", &[Tier::Shader, Tier::Wasm]),
    ("ui.shortcut", &[Tier::Shader, Tier::Wasm]),
    ("image.process", &[Tier::Shader, Tier::Wasm, Tier::Native]),
    ("raw.decode", &[Tier::Wasm, Tier::Native]),
    ("metadata", &[Tier::Wasm, Tier::Native]),
    ("originals.read", &[Tier::Wasm]),
    ("catalog.read", &[Tier::Wasm]),
    ("catalog.read.location", &[Tier::Wasm]),
    ("catalog.write", &[Tier::Wasm]),
    ("edit.write", &[Tier::Wasm]),
    ("fs.pick", &[Tier::Wasm]),
    ("export.encoder", &[Tier::Wasm, Tier::Native]),
    ("export.post", &[Tier::Wasm]),
    ("import.hook", &[Tier::Wasm]),
    ("net", &[Tier::Wasm]),
    ("clipboard.write", &[Tier::Wasm]),
    ("process.exec", &[]),
];

pub fn is_capability(name: &str) -> bool {
    CAPABILITIES.iter().any(|(n, _)| *n == name)
}

pub fn tiers_for(name: &str) -> Option<&'static [Tier]> {
    CAPABILITIES
        .iter()
        .find(|(n, _)| *n == name)
        .map(|(_, t)| *t)
}
