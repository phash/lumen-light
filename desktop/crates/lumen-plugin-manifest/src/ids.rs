//! ID-Regeln (Plugin, Param, Befehl) und reservierte Praefixe.

pub const RESERVED_PREFIXES: &[&str] = &["lumen", "builtin", "core", "plugin", "system", "mrd"];

fn seg_ok(s: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&s.len())
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// `^[a-z0-9-]{2,32}\.[a-z0-9-]{2,48}$`
pub fn is_plugin_id(id: &str) -> bool {
    match id.split_once('.') {
        Some((p, n)) => seg_ok(p, 2, 32) && seg_ok(n, 2, 48),
        None => false,
    }
}

/// Herausgeber-Praefix einer gueltigen Plugin-ID.
pub fn prefix(id: &str) -> &str {
    id.split_once('.').map_or(id, |(p, _)| p)
}

/// `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`
pub fn is_param_id(id: &str) -> bool {
    let mut parts = id.split('-');
    let first = parts.next().unwrap_or("");
    let alnum = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
    };
    first.as_bytes().first().is_some_and(u8::is_ascii_lowercase) && alnum(first) && parts.all(alnum)
}
