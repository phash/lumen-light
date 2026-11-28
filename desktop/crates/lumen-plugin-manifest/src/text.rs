//! Unicode-Pruefungen fuer Anzeigetexte.

use unicode_security::confusable_detection::skeleton;

use crate::ManifestError;

/// Woerter, die ein Plugin-Name nicht (auch nicht verwechselbar) enthalten darf.
pub const RESERVED_WORDS: &[&str] = &["Lumen", "Offiziell", "Official", "Update", "System"];

/// Unsichtbare Formatzeichen (Unicode General_Category=Cf) und Bidi-Steuerzeichen.
fn is_invisible(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2
        | 0x180E | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F
        | 0xFEFF | 0xFFF9..=0xFFFB | 0x110BD | 0x110CD | 0x13430..=0x1343F
        | 0x1BCA0..=0x1BCA3 | 0x1D173..=0x1D17A | 0xE0000..=0xE007F)
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

fn skel(s: &str) -> String {
    skeleton(&s.to_lowercase())
        .collect::<String>()
        .to_lowercase()
}

fn letters(s: &str) -> String {
    skel(s).chars().filter(|c| c.is_alphanumeric()).collect()
}

/// Liefert das reservierte Wort, das `name` (auch als Wortteil, per UTS-#39-Skeleton) enthaelt.
pub fn confusable_with_reserved(name: &str) -> Option<&'static str> {
    let n = letters(name);
    RESERVED_WORDS
        .iter()
        .copied()
        .find(|r| n.contains(&letters(r)))
}
