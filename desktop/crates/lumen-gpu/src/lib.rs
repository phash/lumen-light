//! GPU-Entwicklung fuer Lumen Desktop ueber wgpu.
//!
//! WGSL-Port der Ton-Stufe aus `frontend/src/editor/shaders.ts`
//! (Weissabgleich, Belichtung, Prozessversion 1 und 2). Die uebrigen
//! Stufen (HSL, Kurve, Masken, Linse, Detail) folgen in N2.

mod device;
mod error;
mod half;
mod params;
mod pipeline;

pub use device::{Gpu, SourceTexture};
pub use error::GpuError;
pub use params::ToneParams;
pub use pipeline::Developer;
