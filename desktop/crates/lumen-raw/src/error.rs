//! Fehlertyp fuer alle Decode-Pfade.

use thiserror::Error;

/// Fehler beim Lesen oder Dekodieren einer RAW-Datei.
#[derive(Debug, Error)]
pub enum RawError {
    #[error("Datei nicht lesbar: {0}")]
    Io(#[from] std::io::Error),
    #[error("Format nicht unterstuetzt: {detail}")]
    Unsupported { detail: String },
    #[error("RAW-Datei beschaedigt (LibRaw-Code {code}): {detail}")]
    Corrupt { code: i32, detail: String },
    #[error("Zu wenig Speicher fuer den RAW-Decode")]
    OutOfMemory,
}
