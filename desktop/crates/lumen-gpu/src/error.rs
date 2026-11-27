//! Fehlertyp fuer GPU-Initialisierung und Upload.

use thiserror::Error;

/// Fehler beim Anlegen des GPU-Geraets oder beim Hochladen der Quelle.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum GpuError {
    #[error("Kein passender GPU-Adapter gefunden (Vulkan/DX12/GL-Treiber pruefen)")]
    NoAdapter,
    #[error("GPU-Geraet konnte nicht angelegt werden: {0}")]
    RequestDevice(String),
    #[error("Bild {width}x{height} ist groesser als das Texturlimit der GPU ({max} px)")]
    TextureTooLarge { width: u32, height: u32, max: u32 },
}
