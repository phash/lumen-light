//! RAW-Decode fuer Lumen Desktop ueber LibRaw.
//!
//! Stufen: eingebettete JPEG-Vorschau, `half_size`-Decode, voller Decode.
//! Decode-Einstellungen entsprechen `RAW_DECODE_SETTINGS` im Web-Editor.

mod decode;
mod downscale;
mod error;
mod handle;
pub mod testutil;
mod thumb;

pub use decode::{decode, decode_bytes};
pub use downscale::box_downscale;
pub use error::RawError;
pub use thumb::embedded_preview;

/// 16-bit-RGB-Bild, `width * height * 3` Werte (RGB verschachtelt, kein Alpha).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgb16Image {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u16>,
}

/// Metadaten aus dem RAW.
#[derive(Debug, Clone, PartialEq)]
pub struct RawMeta {
    pub make: String,
    pub model: String,
    pub focal_len: Option<f32>,
    /// `true`, wenn LibRaw das Bild gemaess EXIF-Orientierung gedreht/gespiegelt hat.
    pub orientation_applied: bool,
}

/// Decode-Stufe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeMode {
    /// LibRaw `half_size`: halbe Kantenlaenge, ohne Demosaic.
    Half,
    /// Voller Decode mit Demosaic.
    Full,
}

/// Eingebettete JPEG-Vorschau aus dem RAW.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddedPreview {
    pub width: u32,
    pub height: u32,
    pub jpeg: Vec<u8>,
}
