//! IEEE-754 binary16 fuer die Quelltextur, Port von `frontend/src/editor/float16.ts`.
//!
//! Die Abbildung unorm16 -> Half laeuft wie im Web ueber eine 64k-LUT von
//! `v / 65535`, korrekt gerundet direkt aus dem Double (keine Doppelrundung).

use std::sync::OnceLock;

/// Double -> Half-Bits, round-to-nearest-even (wie `floatToHalfBits`).
pub(crate) fn f64_to_half_bits(value: f64) -> u16 {
    if value.is_nan() {
        return 0x7e00;
    }
    let sign: u16 = if value.is_sign_negative() { 0x8000 } else { 0 };
    let x = value.abs();
    if x == 0.0 {
        return sign;
    }
    if x.is_infinite() {
        return sign | 0x7c00;
    }
    if x < 2f64.powi(-14) {
        // Subnormal: Einheit 2^-24, rundet ggf. auf die kleinste Normale.
        return sign | (x * 2f64.powi(24)).round_ties_even() as u16;
    }
    let mut e = x.log2().floor() as i32;
    // log2 kann um eine Stelle daneben liegen -> korrigieren.
    let mut m = x / 2f64.powi(e);
    if m >= 2.0 {
        e += 1;
        m /= 2.0;
    } else if m < 1.0 {
        e -= 1;
        m *= 2.0;
    }
    let mut frac = ((m - 1.0) * 1024.0).round_ties_even() as u16;
    if frac == 1024 {
        frac = 0;
        e += 1;
    }
    if e > 15 {
        return sign | 0x7c00;
    }
    sign | (((e + 15) as u16) << 10) | frac
}

/// LUT unorm16 -> Half-Bits von `v / 65535` (einmal gebaut, 128 KB).
pub(crate) fn unorm16_half_lut() -> &'static [u16; 65536] {
    static LUT: OnceLock<Box<[u16; 65536]>> = OnceLock::new();
    LUT.get_or_init(|| {
        let mut lut = Box::new([0u16; 65536]);
        for (i, slot) in lut.iter_mut().enumerate() {
            *slot = f64_to_half_bits(i as f64 / 65535.0);
        }
        lut
    })
}

/// Half-Bits fuer 1.0 (Alpha-Kanal der RGBA-Textur).
pub(crate) const HALF_ONE: u16 = 0x3c00;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eckwerte_wie_float16_ts() {
        let lut = unorm16_half_lut();
        assert_eq!(lut[0], 0x0000);
        assert_eq!(lut[65535], HALF_ONE);
        // 1/65535 ~ 1.526e-5 ist subnormal: 256 * 2^-24.
        assert_eq!(lut[1], 0x0100);
        // 32768/65535 = 0.5000076 rundet auf exakt 0.5.
        assert_eq!(lut[32768], 0x3800);
    }

    #[test]
    fn rundung_ist_round_to_nearest_even() {
        // 1 + 1/2048 liegt genau zwischen 0x3c00 und 0x3c01 -> gerade.
        assert_eq!(f64_to_half_bits(1.0 + 1.0 / 2048.0), 0x3c00);
        // 1 + 3/2048 liegt zwischen 0x3c01 und 0x3c02 -> gerade.
        assert_eq!(f64_to_half_bits(1.0 + 3.0 / 2048.0), 0x3c02);
        assert_eq!(f64_to_half_bits(65504.0), 0x7bff);
        assert_eq!(f64_to_half_bits(1.0e6), 0x7c00);
    }

    #[test]
    fn lut_ist_monoton() {
        let lut = unorm16_half_lut();
        assert!(lut.windows(2).all(|w| w[0] <= w[1]));
    }
}
