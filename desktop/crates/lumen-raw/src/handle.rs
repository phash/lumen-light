//! RAII-Huelle um `libraw_data_t`. Einzige Stelle mit `unsafe` FFI-Aufrufen.

use std::ffi::CStr;
use std::marker::PhantomData;
use std::os::raw::{c_char, c_int};
use std::ptr::NonNull;

use libraw_sys as sys;

use crate::RawError;

/// Geoeffnetes LibRaw-Handle. Leiht sich den Eingabepuffer fuer `'a`:
/// `libraw_open_buffer` kopiert nicht, der Puffer muss leben bis `Drop`.
pub(crate) struct Handle<'a> {
    ptr: NonNull<sys::libraw_data_t>,
    _buf: PhantomData<&'a [u8]>,
}

/// Ergebnis von `dcraw_make_mem_*`, freigegeben in `Drop`.
pub(crate) struct MemImage {
    ptr: NonNull<sys::libraw_processed_image_t>,
}

impl<'a> Handle<'a> {
    /// `libraw_init(0)` mit den Decode-Einstellungen, dann `libraw_open_buffer`.
    pub(crate) fn open(bytes: &'a [u8], half_size: bool) -> Result<Self, RawError> {
        if bytes.is_empty() {
            return Err(RawError::Unsupported {
                detail: "leere Datei".to_owned(),
            });
        }
        // SAFETY: libraw_init allokiert ein neues Handle oder liefert NULL.
        let raw = unsafe { sys::libraw_init(0) };
        let ptr = NonNull::new(raw).ok_or(RawError::OutOfMemory)?;
        let handle = Handle {
            ptr,
            _buf: PhantomData,
        };
        {
            // SAFETY: ptr ist gueltig und exklusiv; Parameter vor open setzen.
            let params = unsafe { &mut (*handle.ptr.as_ptr()).params };
            // = RAW_DECODE_SETTINGS (frontend/src/editor/raw.ts) + outputBps 16.
            params.use_camera_wb = 1;
            params.output_color = 1;
            params.output_bps = 16;
            params.auto_bright_thr = 0.005;
            params.no_auto_bright = 0;
            params.half_size = c_int::from(half_size);
        }
        // SAFETY: Puffer lebt laut PhantomData mindestens so lange wie das Handle.
        let code = unsafe {
            sys::libraw_open_buffer(handle.ptr.as_ptr(), bytes.as_ptr().cast(), bytes.len())
        };
        handle.check(code, "open_buffer")?;
        Ok(handle)
    }

    pub(crate) fn unpack(&mut self) -> Result<(), RawError> {
        // SAFETY: gueltiges, geoeffnetes Handle.
        let code = unsafe { sys::libraw_unpack(self.ptr.as_ptr()) };
        self.check(code, "unpack")
    }

    pub(crate) fn dcraw_process(&mut self) -> Result<(), RawError> {
        // SAFETY: gueltiges Handle nach unpack.
        let code = unsafe { sys::libraw_dcraw_process(self.ptr.as_ptr()) };
        self.check(code, "dcraw_process")
    }

    pub(crate) fn make_mem_image(&mut self) -> Result<MemImage, RawError> {
        let mut code: c_int = 0;
        // SAFETY: gueltiges Handle nach dcraw_process; code ist ein gueltiger Zeiger.
        let raw = unsafe { sys::libraw_dcraw_make_mem_image(self.ptr.as_ptr(), &mut code) };
        self.mem_result(raw, code, "dcraw_make_mem_image")
    }

    /// `Ok(false)`, wenn die Datei keine (oder keine lesbare) Vorschau hat.
    pub(crate) fn unpack_thumb(&mut self) -> Result<bool, RawError> {
        // SAFETY: gueltiges, geoeffnetes Handle.
        let code = unsafe { sys::libraw_unpack_thumb(self.ptr.as_ptr()) };
        match code {
            sys::LIBRAW_NO_THUMBNAIL
            | sys::LIBRAW_UNSUPPORTED_THUMBNAIL
            | sys::LIBRAW_REQUEST_FOR_NONEXISTENT_THUMBNAIL => Ok(false),
            _ => self.check(code, "unpack_thumb").map(|()| true),
        }
    }

    pub(crate) fn make_mem_thumb(&mut self) -> Result<MemImage, RawError> {
        let mut code: c_int = 0;
        // SAFETY: gueltiges Handle nach unpack_thumb; code ist ein gueltiger Zeiger.
        let raw = unsafe { sys::libraw_dcraw_make_mem_thumb(self.ptr.as_ptr(), &mut code) };
        self.mem_result(raw, code, "dcraw_make_mem_thumb")
    }

    fn data(&self) -> &sys::libraw_data_t {
        // SAFETY: ptr bleibt bis Drop gueltig; nur lesender Zugriff.
        unsafe { self.ptr.as_ref() }
    }

    pub(crate) fn make(&self) -> String {
        c_chars_to_string(&self.data().idata.make)
    }

    pub(crate) fn model(&self) -> String {
        c_chars_to_string(&self.data().idata.model)
    }

    pub(crate) fn focal_len(&self) -> Option<f32> {
        let f = self.data().other.focal_len;
        (f.is_finite() && f > 0.0).then_some(f)
    }

    /// LibRaw-Flip-Code (0 = keine Drehung/Spiegelung).
    pub(crate) fn flip(&self) -> i32 {
        self.data().sizes.flip
    }

    pub(crate) fn thumb_size(&self) -> (u32, u32) {
        let t = &self.data().thumbnail;
        (u32::from(t.twidth), u32::from(t.theight))
    }

    fn mem_result(
        &self,
        raw: *mut sys::libraw_processed_image_t,
        code: c_int,
        step: &str,
    ) -> Result<MemImage, RawError> {
        NonNull::new(raw)
            .map(|ptr| MemImage { ptr })
            .ok_or_else(|| {
                // NULL ohne Fehlercode: trotzdem als Fehler melden.
                let code = if code == sys::LIBRAW_SUCCESS {
                    sys::LIBRAW_UNSPECIFIED_ERROR
                } else {
                    code
                };
                self.error_for(code, step)
            })
    }

    /// Prueft einen LibRaw-Rueckgabecode.
    fn check(&self, code: c_int, step: &str) -> Result<(), RawError> {
        if code == sys::LIBRAW_SUCCESS {
            Ok(())
        } else {
            Err(self.error_for(code, step))
        }
    }

    /// Bildet einen LibRaw-Fehlercode (!= SUCCESS) auf `RawError` ab.
    fn error_for(&self, code: c_int, step: &str) -> RawError {
        let camera = format!("{} {}", self.make(), self.model());
        let camera = camera.trim();
        let mut detail = format!("{step}: {}", strerror(code));
        if !camera.is_empty() {
            detail.push_str(&format!(" ({camera})"));
        }
        match code {
            sys::LIBRAW_FILE_UNSUPPORTED | sys::LIBRAW_NOT_IMPLEMENTED => {
                RawError::Unsupported { detail }
            }
            sys::LIBRAW_UNSUFFICIENT_MEMORY => RawError::OutOfMemory,
            _ => RawError::Corrupt { code, detail },
        }
    }
}

impl Drop for Handle<'_> {
    fn drop(&mut self) {
        // SAFETY: ptr stammt aus libraw_init und wird genau einmal freigegeben.
        unsafe { sys::libraw_close(self.ptr.as_ptr()) };
    }
}

impl MemImage {
    /// Bindgen-Typ des C-Enums: unter Linux `u32`, unter MSVC `i32`.
    pub(crate) fn kind(&self) -> sys::LibRaw_image_formats {
        self.header().type_
    }

    pub(crate) fn width(&self) -> u32 {
        u32::from(self.header().width)
    }

    pub(crate) fn height(&self) -> u32 {
        u32::from(self.header().height)
    }

    pub(crate) fn colors(&self) -> u32 {
        u32::from(self.header().colors)
    }

    pub(crate) fn bits(&self) -> u32 {
        u32::from(self.header().bits)
    }

    /// Nutzdaten (`data_size` Bytes hinter dem Kopf).
    pub(crate) fn bytes(&self) -> &[u8] {
        let len = self.header().data_size as usize;
        // Zeiger direkt aus dem Rohzeiger ableiten, nicht aus `&header.data`:
        // eine Referenz auf `[u8; 1]` deckt nur 1 Byte ab (Provenienz).
        // SAFETY: ptr ist gueltig bis Drop; LibRaw allokiert data_size Bytes
        // ab `data` (flexibles Array-Member) in derselben Allokation.
        unsafe {
            let data = std::ptr::addr_of!((*self.ptr.as_ptr()).data).cast::<u8>();
            std::slice::from_raw_parts(data, len)
        }
    }

    fn header(&self) -> &sys::libraw_processed_image_t {
        // SAFETY: ptr bleibt bis Drop gueltig.
        unsafe { self.ptr.as_ref() }
    }
}

impl Drop for MemImage {
    fn drop(&mut self) {
        // SAFETY: ptr stammt aus dcraw_make_mem_* und wird genau einmal freigegeben.
        unsafe { sys::libraw_dcraw_clear_mem(self.ptr.as_ptr()) };
    }
}

fn strerror(code: c_int) -> String {
    // SAFETY: libraw_strerror liefert immer einen statischen, nullterminierten String.
    let msg = unsafe { sys::libraw_strerror(code) };
    if msg.is_null() {
        return format!("LibRaw-Fehler {code}");
    }
    // SAFETY: siehe oben.
    unsafe { CStr::from_ptr(msg) }
        .to_string_lossy()
        .into_owned()
}

fn c_chars_to_string(chars: &[c_char]) -> String {
    let bytes: Vec<u8> = chars
        .iter()
        .take_while(|c| **c != 0)
        .map(|c| *c as u8)
        .collect();
    String::from_utf8_lossy(&bytes).trim().to_owned()
}
