//! Unicode-Pruefungen fuer Anzeigetexte.

use unicode_security::confusable_detection::skeleton;

use crate::ManifestError;

/// Woerter, die ein Plugin-Name nicht (auch nicht verwechselbar) enthalten darf.
pub const RESERVED_WORDS: &[&str] = &["Lumen", "Offiziell", "Official", "Update", "System"];

fn is_invisible(c: char) -> bool {
    matches!(c as u32, 0x200B..=0x200F | 0x202A..=0x202E | 0x2066..=0x2069 | 0xE0000..=0xE007F)
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

/// Liefert das reservierte Wort, das `name` (als Wort, per UTS-#39-Skeleton) enthaelt.
pub fn confusable_with_reserved(name: &str) -> Option<&'static str> {
    let words: Vec<String> = name
        .split(|c: char| c.is_whitespace() || c == '-')
        .map(skel)
        .collect();
    RESERVED_WORDS
        .iter()
        .copied()
        .find(|r| words.iter().any(|w| *w == skel(r)))
}
