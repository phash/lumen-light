//! Regler der Ton-Stufe und ihr Uniform-Puffer.

use bytemuck::{Pod, Zeroable};
use serde_json::Value;

/// Regler, die die Ton-Stufe des Shaders lesen (Spike-Umfang).
///
/// Uebrige Regler (Dynamik, Saettigung, Detail, HSL, Kurve, Masken, Linse)
/// bleiben im Spike unberuecksichtigt (N2).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ToneParams {
    pub process_version: u32,
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub temperature: f32,
    pub tint: f32,
}

impl Default for ToneParams {
    /// Neutrale Regler mit Prozessversion 2 (wie `defaultAdjustments()`).
    fn default() -> Self {
        Self {
            process_version: 2,
            exposure: 0.0,
            contrast: 0.0,
            highlights: 0.0,
            shadows: 0.0,
            whites: 0.0,
            blacks: 0.0,
            temperature: 0.0,
            tint: 0.0,
        }
    }
}

impl ToneParams {
    /// Liest die Regler aus einem Adjustments-Objekt (camelCase wie im
    /// Wireformat). Fehlende Regler gelten als 0. Prozessversion wie
    /// `normalizeProcessVersion`: nur exakt 2 ergibt 2, sonst 1.
    pub fn from_adjustments_json(v: &Value) -> Self {
        let num = |key: &str| v.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32;
        let process_version = match v.get("processVersion").and_then(Value::as_f64) {
            Some(2.0) => 2,
            _ => 1,
        };
        Self {
            process_version,
            exposure: num("exposure"),
            contrast: num("contrast"),
            highlights: num("highlights"),
            shadows: num("shadows"),
            whites: num("whites"),
            blacks: num("blacks"),
            temperature: num("temperature"),
            tint: num("tint"),
        }
    }
}

/// Uniform-Puffer fuer `develop.wgsl` (`struct Params`). Layout nach den
/// WGSL-Uniform-Regeln (std140-kompatibel): Skalare 4-Byte-ausgerichtet,
/// `vec2<f32>` 8-Byte-ausgerichtet, Gesamtgroesse Vielfaches von 16.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub(crate) struct Uniforms {
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub temperature: f32,
    pub tint: f32,
    pub process_version: u32,
    pub _pad0: u32,
    /// Zielgroesse in Pixeln: uv = Fragment-Position / target_size.
    pub target_size: [f32; 2],
}

impl Uniforms {
    pub(crate) fn new(p: &ToneParams, size: (u32, u32)) -> Self {
        Self {
            exposure: p.exposure,
            contrast: p.contrast,
            highlights: p.highlights,
            shadows: p.shadows,
            whites: p.whites,
            blacks: p.blacks,
            temperature: p.temperature,
            tint: p.tint,
            process_version: p.process_version,
            _pad0: 0,
            target_size: [size.0 as f32, size.1 as f32],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{offset_of, size_of};

    #[test]
    fn uniform_offsets_folgen_std140() {
        // Erwartete Offsets: 8 Skalare a 4 Byte, dann u32, Padding, vec2 auf 8.
        assert_eq!(offset_of!(Uniforms, exposure), 0);
        assert_eq!(offset_of!(Uniforms, contrast), 4);
        assert_eq!(offset_of!(Uniforms, highlights), 8);
        assert_eq!(offset_of!(Uniforms, shadows), 12);
        assert_eq!(offset_of!(Uniforms, whites), 16);
        assert_eq!(offset_of!(Uniforms, blacks), 20);
        assert_eq!(offset_of!(Uniforms, temperature), 24);
        assert_eq!(offset_of!(Uniforms, tint), 28);
        assert_eq!(offset_of!(Uniforms, process_version), 32);
        assert_eq!(offset_of!(Uniforms, target_size), 40);
        assert_eq!(offset_of!(Uniforms, target_size) % 8, 0);
        assert_eq!(size_of::<Uniforms>(), 48);
        assert_eq!(size_of::<Uniforms>() % 16, 0);
    }

    #[test]
    fn uniform_layout_passt_zum_wgsl_struct() {
        // Offsets per naga-freier Reflexion: Feldreihenfolge im WGSL-Text.
        let src = include_str!("shaders/develop.wgsl");
        let start = src.find("struct Params {").expect("struct Params fehlt");
        let body = &src[start..src[start..].find('}').unwrap() + start];
        let fields: Vec<&str> = body
            .lines()
            .skip(1)
            .filter_map(|l| l.trim().split(':').next())
            .filter(|n| !n.is_empty() && !n.starts_with("//"))
            .collect();
        assert_eq!(
            fields,
            [
                "exposure",
                "contrast",
                "highlights",
                "shadows",
                "whites",
                "blacks",
                "temperature",
                "tint",
                "process_version",
                "_pad0",
                "target_size"
            ]
        );
    }

    #[test]
    fn adjustments_json_wird_gelesen() {
        let v = serde_json::json!({
            "exposure": 0.7, "contrast": 0.3, "highlights": -0.6, "shadows": 0.4,
            "whites": 0, "blacks": 0, "temperature": 0.2, "tint": -0.1,
            "processVersion": 2, "hsl": null, "toneCurve": null
        });
        let p = ToneParams::from_adjustments_json(&v);
        assert_eq!(p.process_version, 2);
        assert_eq!(p.exposure, 0.7);
        assert_eq!(p.highlights, -0.6);
        assert_eq!(p.tint, -0.1);
    }

    #[test]
    fn fehlende_prozessversion_ist_eins() {
        let p = ToneParams::from_adjustments_json(&serde_json::json!({ "processVersion": null }));
        assert_eq!(p.process_version, 1);
        assert_eq!(p.exposure, 0.0);
        let p = ToneParams::from_adjustments_json(&serde_json::json!({}));
        assert_eq!(p.process_version, 1);
    }
}
