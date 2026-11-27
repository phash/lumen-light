//! Eingebettete Kamera-Vorschau (nur JPEG).

use std::path::Path;

use libraw_sys as sys;

use crate::handle::Handle;
use crate::{EmbeddedPreview, RawError};

/// Liest die eingebettete JPEG-Vorschau. `None` bei fehlender oder
/// Bitmap-Vorschau.
pub fn embedded_preview(path: &Path) -> Result<Option<EmbeddedPreview>, RawError> {
    let bytes = std::fs::read(path)?;
    let mut handle = Handle::open(&bytes, false)?;
    if !handle.unpack_thumb()? {
        return Ok(None);
    }
    let mem = handle.make_mem_thumb()?;
    if mem.kind() != sys::LIBRAW_IMAGE_JPEG {
        return Ok(None);
    }
    let (tw, th) = handle.thumb_size();
    let width = if mem.width() > 0 { mem.width() } else { tw };
    let height = if mem.height() > 0 { mem.height() } else { th };
    Ok(Some(EmbeddedPreview {
        width,
        height,
        jpeg: mem.bytes().to_vec(),
    }))
}
