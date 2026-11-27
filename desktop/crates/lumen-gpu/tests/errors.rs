//! Fehlerpfade: kein Adapter, Bild groesser als das Texturlimit.

use lumen_gpu::{Gpu, GpuError, SourceTexture};
use lumen_raw::Rgb16Image;

#[test]
fn zu_grosse_textur_gibt_fehler() {
    let gpu = Gpu::headless().expect("GPU fuer den Test noetig");
    let max = gpu.limits.max_texture_dimension_2d;
    let width = max + 1;
    let img = Rgb16Image {
        width,
        height: 1,
        data: vec![0; width as usize * 3],
    };
    match SourceTexture::upload(&gpu, &img) {
        Err(GpuError::TextureTooLarge {
            width: w,
            height: h,
            max: m,
        }) => {
            assert_eq!((w, h, m), (width, 1, max));
        }
        Err(e) => panic!("falscher Fehler: {e}"),
        Ok(_) => panic!("Upload ueber dem Texturlimit darf nicht gelingen"),
    }
    let msg = GpuError::TextureTooLarge {
        width,
        height: 1,
        max,
    }
    .to_string();
    assert!(
        msg.contains(&width.to_string()) && msg.contains(&max.to_string()),
        "{msg}"
    );
}

#[test]
fn ohne_adapter_lesbarer_fehler() {
    let err = match Gpu::headless_with(wgpu::Backends::empty()) {
        Err(e) => e,
        Ok(_) => panic!("ohne Backends darf es keinen Adapter geben"),
    };
    assert_eq!(err, GpuError::NoAdapter);
    let msg = err.to_string();
    assert!(!msg.is_empty());
    assert!(
        msg.contains("GPU-Adapter"),
        "Meldung nicht deutsch/lesbar: {msg}"
    );
}
