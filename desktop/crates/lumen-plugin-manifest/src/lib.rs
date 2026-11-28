//! Manifest-, Paket- und Signaturformat fuer Lumen-Plugins (ohne Host).

pub mod caps;
mod error;
pub mod model;

pub use error::{HINT_QUOTE_CAPS, ManifestError};
pub use model::*;

/// Parst `lumen-plugin.toml` (nur Syntax und Struktur, keine Semantik).
pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, ManifestError> {
    let text = std::str::from_utf8(bytes).map_err(|_| ManifestError::NotUtf8)?;
    let m: Manifest = toml::from_str(text).map_err(|e| ManifestError::Toml {
        msg: e.message().to_string(),
        hint: None,
    })?;
    // Ungequotete Rechte-Namen werden in TOML zu Untertabellen (`image = { process = … }`).
    for (k, v) in &m.capabilities {
        if v.is_table() && !caps::is_capability(k) {
            return Err(ManifestError::Toml {
                msg: format!("unbekanntes Recht `{k}`"),
                hint: Some(HINT_QUOTE_CAPS),
            });
        }
    }
    Ok(m)
}

/// Liefert den ```toml-Block der Spec, dessen erste Zeile `first_line` ist
/// (Sync-Tests zwischen Spec und Code).
#[doc(hidden)]
pub fn spec_toml_block(spec: &str, first_line: &str) -> String {
    spec_block(spec, "toml", first_line)
}

/// Wie `spec_toml_block`, fuer beliebige Sprache (`wit`, `toml`).
#[doc(hidden)]
pub fn spec_block(spec: &str, lang: &str, first_line: &str) -> String {
    let fence = format!("```{lang}");
    let mut lines = spec.lines();
    while let Some(l) = lines.next() {
        if l.trim_end() == fence {
            let body: Vec<&str> = lines
                .by_ref()
                .take_while(|l| !l.starts_with("```"))
                .collect();
            if body.first().map(|f| f.trim_end()) == Some(first_line) {
                return body.join("\n") + "\n";
            }
        }
    }
    panic!("kein ```{lang}-Block mit erster Zeile {first_line:?} in der Spec");
}
