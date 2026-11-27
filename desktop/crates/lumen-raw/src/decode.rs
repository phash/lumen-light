//! Decode in Stufen: `half_size` oder voll, immer 16 bit sRGB.

use std::path::Path;

use libraw_sys as sys;

use crate::handle::Handle;
use crate::{DecodeMode, RawError, RawMeta, Rgb16Image};

/// Dekodiert eine RAW-Datei von der Platte.
pub fn decode(path: &Path, mode: DecodeMode) -> Result<(Rgb16Image, RawMeta), RawError> {
    let bytes = std::fs::read(path)?;
    decode_bytes(&bytes, mode)
}

/// Dekodiert eine RAW-Datei aus dem Speicher.
pub fn decode_bytes(bytes: &[u8], mode: DecodeMode) -> Result<(Rgb16Image, RawMeta), RawError> {
    let mut handle = Handle::open(bytes, mode == DecodeMode::Half)?;
    handle.unpack()?;
    handle.dcraw_process()?;
    let mem = handle.make_mem_image()?;

    if mem.kind() != sys::LIBRAW_IMAGE_BITMAP || mem.colors() != 3 || mem.bits() != 16 {
        return Err(RawError::Corrupt {
            code: sys::LIBRAW_UNSPECIFIED_ERROR,
            detail: format!(
                "unerwartetes Bildformat: Typ {}, {} Kanaele, {} bit",
                mem.kind(),
                mem.colors(),
                mem.bits()
            ),
        });
    }
    let (width, height) = (mem.width(), mem.height());
    let expected = width as usize * height as usize * 3;
    let bytes = mem.bytes();
    if bytes.len() < expected * 2 {
        return Err(RawError::Corrupt {
            code: sys::LIBRAW_UNSPECIFIED_ERROR,
            detail: format!(
                "Bildpuffer zu kurz: {} Bytes fuer {width}x{height}",
                bytes.len()
            ),
        });
    }
    // LibRaw liefert 16 bit in nativer Byte-Reihenfolge.
    let (pairs, _) = bytes[..expected * 2].as_chunks::<2>();
    let data: Vec<u16> = pairs.iter().map(|c| u16::from_ne_bytes(*c)).collect();

    let meta = RawMeta {
        make: handle.make(),
        model: handle.model(),
        focal_len: handle.focal_len(),
        orientation_applied: handle.flip() != 0,
    };
    Ok((
        Rgb16Image {
            width,
            height,
            data,
        },
        meta,
    ))
}
