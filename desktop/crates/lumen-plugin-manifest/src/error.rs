use thiserror::Error;

pub const HINT_QUOTE_CAPS: &str =
    "Rechte-Namen in Anführungszeichen setzen, z. B. \"image.process\" = …";

#[derive(Debug, Clone, PartialEq, Error)]
pub enum ManifestError {
    #[error("Manifest ist kein gültiges UTF-8")]
    NotUtf8,
    #[error("Manifest ungültig: {msg}{}", hint.map(|h| format!(" ({h})")).unwrap_or_default())]
    Toml {
        msg: String,
        hint: Option<&'static str>,
    },
}
