//! Unicode-Pruefungen fuer Anzeigetexte.

use unicode_security::confusable_detection::skeleton;

use crate::ManifestError;

/// Woerter, die ein Plugin-Name nicht (auch nicht verwechselbar) enthalten darf.
pub const RESERVED_WORDS: &[&str] = &["Lumen", "Offiziell", "Official", "Update", "System"];

/// Unsichtbare Zeichen: Default_Ignorable_Code_Point, Formatzeichen (Cf), Bidi-Steuerung,
/// Fuellzeichen (Hangul, Braille leer) und private Nutzung.
fn is_invisible(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x034F | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2
        | 0x115F..=0x1160 | 0x17B4..=0x17B5 | 0x180B..=0x180F | 0x200B..=0x200F
        | 0x202A..=0x202E | 0x2060..=0x206F | 0x2800 | 0x3164 | 0xE000..=0xF8FF
        | 0xFE00..=0xFE0F | 0xFEFF | 0xFFA0 | 0xFFF0..=0xFFFB | 0x110BD | 0x110CD
        | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF
        | 0xF0000..=0xFFFFD | 0x100000..=0x10FFFD)
}

pub fn check_text(field: &'static str, s: &str) -> Result<(), ManifestError> {
    match s
        .chars()
        .find(|c| is_invisible(*c) || (c.is_control() && *c != '\n'))
    {
        Some(c) => Err(ManifestError::Invisible {
            field,
            codepoint: c as u32,
        }),
        None => Ok(()),
    }
}

/// Skeleton, kleinschreiben, nochmal Skeleton: `I` -> `l` bleibt erhalten, und Gross-
/// und Kleinbuchstaben landen in derselben Form (`M` und `m` -> `rn`).
fn letters(s: &str) -> String {
    let once: String = skeleton(s).collect::<String>().to_lowercase();
    skeleton(&once)
        .collect::<String>()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// Liefert das reservierte Wort, das `name` (auch als Wortteil, per UTS-#39-Skeleton) enthaelt.
pub fn confusable_with_reserved(name: &str) -> Option<&'static str> {
    let n = letters(name);
    RESERVED_WORDS
        .iter()
        .copied()
        .find(|r| n.contains(&letters(r)))
}
