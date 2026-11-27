//! Baut LibRaw statisch aus `vendor/LibRaw` und erzeugt die Bindings.
//!
//! Dateiliste = `LIB_MT_OBJECTS` aus `vendor/LibRaw/Makefile.dist`
//! (thread-sichere Variante, also ohne `LIBRAW_NOTHREADS`). Ohne zlib,
//! libjpeg, LCMS, RawSpeed, DNG-SDK und X3F-Tools.

use std::env;
use std::path::{Path, PathBuf};

const SOURCES: &[&str] = &[
    "src/libraw_datastream.cpp",
    "src/libraw_c_api.cpp",
    "src/tables/cameralist.cpp",
    "src/decoders/fuji_compressed.cpp",
    "src/decoders/crx.cpp",
    "src/decoders/pana8.cpp",
    "src/decoders/fp_dng.cpp",
    "src/decoders/decoders_libraw.cpp",
    "src/decoders/olympus14.cpp",
    "src/decoders/sonycc.cpp",
    "src/decompressors/losslessjpeg.cpp",
    "src/decoders/unpack.cpp",
    "src/decoders/unpack_thumb.cpp",
    "src/integration/rawspeed_glue.cpp",
    "src/integration/dngsdk_glue.cpp",
    "src/tables/colorconst.cpp",
    "src/utils/utils_libraw.cpp",
    "src/utils/init_close_utils.cpp",
    "src/utils/decoder_info.cpp",
    "src/utils/open.cpp",
    "src/utils/phaseone_processing.cpp",
    "src/utils/thumb_utils.cpp",
    "src/write/tiff_writer.cpp",
    "src/preprocessing/subtract_black.cpp",
    "src/postprocessing/postprocessing_utils.cpp",
    "src/postprocessing/dcraw_process.cpp",
    "src/preprocessing/raw2image.cpp",
    "src/postprocessing/mem_image.cpp",
    "src/x3f/x3f_utils_patched.cpp",
    "src/x3f/x3f_parse_process.cpp",
    "src/utils/read_utils.cpp",
    "src/utils/curves.cpp",
    "src/utils/utils_dcraw.cpp",
    "src/tables/colordata.cpp",
    "src/decoders/canon_600.cpp",
    "src/decoders/decoders_dcraw.cpp",
    "src/decoders/decoders_libraw_dcrdefs.cpp",
    "src/decoders/generic.cpp",
    "src/decoders/kodak_decoders.cpp",
    "src/decoders/dng.cpp",
    "src/decoders/smal.cpp",
    "src/decoders/load_mfbacks.cpp",
    "src/metadata/sony.cpp",
    "src/metadata/nikon.cpp",
    "src/metadata/samsung.cpp",
    "src/metadata/cr3_parser.cpp",
    "src/metadata/canon.cpp",
    "src/metadata/epson.cpp",
    "src/metadata/olympus.cpp",
    "src/metadata/leica.cpp",
    "src/metadata/fuji.cpp",
    "src/metadata/adobepano.cpp",
    "src/metadata/pentax.cpp",
    "src/metadata/p1.cpp",
    "src/metadata/makernotes.cpp",
    "src/metadata/exif_gps.cpp",
    "src/metadata/kodak.cpp",
    "src/metadata/tiff.cpp",
    "src/metadata/ciff.cpp",
    "src/metadata/mediumformat.cpp",
    "src/metadata/minolta.cpp",
    "src/metadata/identify_tools.cpp",
    "src/metadata/hasselblad_model.cpp",
    "src/metadata/normalize_model.cpp",
    "src/metadata/identify.cpp",
    "src/metadata/misc_parsers.cpp",
    "src/tables/wblists.cpp",
    "src/postprocessing/postprocessing_aux.cpp",
    "src/postprocessing/postprocessing_utils_dcrdefs.cpp",
    "src/postprocessing/aspect_ratio.cpp",
    "src/demosaic/misc_demosaic.cpp",
    "src/demosaic/xtrans_demosaic.cpp",
    "src/demosaic/ahd_demosaic.cpp",
    "src/demosaic/dht_demosaic.cpp",
    "src/demosaic/aahd_demosaic.cpp",
    "src/demosaic/dcb_demosaic.cpp",
    "src/write/file_write.cpp",
    "src/preprocessing/ext_preprocess.cpp",
    "src/write/apply_profile.cpp",
];

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let vendor = manifest.join("vendor/LibRaw");
    if !vendor.join("libraw/libraw.h").exists() {
        panic!(
            "LibRaw-Quellen fehlen unter {}. Bitte `git submodule update --init` ausfuehren.",
            vendor.display()
        );
    }

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=wrapper.h");
    println!("cargo:rerun-if-changed=vendor/LibRaw/libraw");
    println!("cargo:rerun-if-changed=vendor/LibRaw/src");

    build_libraw(&vendor);
    generate_bindings(&manifest, &vendor);
}

fn build_libraw(vendor: &Path) {
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_env = env::var("CARGO_CFG_TARGET_ENV").unwrap_or_default();

    let mut build = cc::Build::new();
    build
        .cpp(true)
        .std("c++17")
        .include(vendor)
        // Statisch linken: kein dllimport/dllexport.
        .define("LIBRAW_NODLL", None)
        // LibRaw immer optimiert, auch im Debug-Profil (Demosaic sonst sehr langsam).
        .opt_level(3)
        .debug(false)
        .warnings(false)
        .files(SOURCES.iter().map(|s| vendor.join(s)));

    if target_env == "msvc" {
        build
            .define("_CRT_SECURE_NO_WARNINGS", None)
            .flag_if_supported("/EHsc");
    }

    build.compile("raw");

    if target_os == "windows" {
        // LibRaw nutzt htonl/ntohl aus Winsock.
        println!("cargo:rustc-link-lib=ws2_32");
    }
}

fn generate_bindings(manifest: &Path, vendor: &Path) {
    let bindings = bindgen::Builder::default()
        .header(manifest.join("wrapper.h").to_string_lossy())
        .clang_arg(format!("-I{}", vendor.display()))
        .clang_arg("-DLIBRAW_NODLL")
        .allowlist_function("libraw_.*")
        .allowlist_type("libraw_.*")
        .allowlist_type("LibRaw_.*")
        .allowlist_var("LIBRAW_.*")
        // Enum-Konstanten ohne Typ-Praefix: `LIBRAW_SUCCESS` statt `LibRaw_errors_LIBRAW_SUCCESS`.
        .prepend_enum_name(false)
        .rust_edition(bindgen::RustEdition::Edition2024)
        .layout_tests(false)
        .generate()
        .expect("bindgen konnte libraw.h nicht verarbeiten");

    let out = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("bindings.rs");
    bindings
        .write_to_file(&out)
        .expect("bindings.rs nicht schreibbar");
}
