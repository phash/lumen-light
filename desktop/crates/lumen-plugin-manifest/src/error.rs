use thiserror::Error;

use crate::expr::ExprError;
use crate::model::Tier;
use crate::paths::PathRejection;

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
    #[error("Plugin-ID `{0}` ungültig (erwartet `herausgeber.name`, nur a-z, 0-9, -)")]
    InvalidPluginId(String),
    #[error("Param-ID `{0}` ungültig (erwartet kebab-case, z. B. `chroma-only`)")]
    InvalidParamId(String),
    #[error("Param `{0}` wird verwendet, ist aber nicht deklariert")]
    UnknownParamRef(String),
    #[error("Präfix `{0}` ist reserviert")]
    ReservedPrefix(String),
    #[error("Befehls-ID `{0}` muss mit der Plugin-ID und einem Punkt beginnen")]
    CommandPrefix(String),
    #[error("unsichtbares oder Steuerzeichen U+{codepoint:04X} in `{field}`")]
    Invisible { field: &'static str, codepoint: u32 },
    #[error("`{field}` ist mit „{with}“ verwechselbar")]
    Confusable {
        field: &'static str,
        with: &'static str,
    },
    #[error("Pfad `{path}` abgelehnt: {why:?}")]
    Path { path: String, why: PathRejection },
    #[error("Hash für `{0}` ist kein SHA-256 (64 Hex-Zeichen, klein)")]
    BadHash(String),
    #[error("Recht `{0}` ist unbekannt")]
    UnknownCapability(String),
    #[error("Recht `{cap}` ist für Stufe {tier:?} nicht erlaubt")]
    CapabilityNotForTier { cap: String, tier: Tier },
    #[error("Artefakte passen nicht zur Stufe (`tier`)")]
    TierArtifactMismatch,
    #[error("Recht `{cap}` ist zusammen mit {because} nicht erlaubt (Ausleitungs-Regel)")]
    LeakRule { cap: String, because: String },
    #[error("Param `{0}`: Grenzen oder Standardwert ungültig")]
    ParamRange(String),
    #[error("Shader `{0}` fehlt in [files]")]
    ShaderNotListed(String),
    #[error("Datei `{0}` fehlt in [files]")]
    FileNotListed(String),
    #[error("Ausdruck in `{field}`: {err}")]
    Expr { field: &'static str, err: ExprError },
}
