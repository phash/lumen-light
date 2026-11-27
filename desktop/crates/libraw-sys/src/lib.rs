//! Rohe FFI-Bindings an LibRaw (C-API aus `libraw/libraw.h`).
//!
//! LibRaw wird in `build.rs` aus dem Submodul `vendor/LibRaw` statisch
//! gebaut. Sichere Huellen liegen in `lumen-raw`.
#![allow(
    non_upper_case_globals,
    non_camel_case_types,
    non_snake_case,
    dead_code,
    unnecessary_transmutes,
    clippy::all
)]

include!(concat!(env!("OUT_DIR"), "/bindings.rs"));
