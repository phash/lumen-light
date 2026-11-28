//! Pfad-Regeln fuer Paketeintraege (Spec "Pfad- und Zip-Regeln").

use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathRejection {
    Absolute,
    DotSegment,
    BadChar(char),
    LeadingDash,
    TrailingDotOrSpace,
    DeviceName(String),
    CaseDuplicate(String, String),
    TooLong,
    TooDeep,
    TooMany,
    ReservedName,
}

pub const MAX_PATH_LEN: usize = 128;
pub const MAX_DEPTH: usize = 4;
pub const MAX_FILES: usize = 64;

fn is_device_name(segment: &str) -> bool {
    let stem = segment.split('.').next().unwrap_or("").to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit())
}

pub fn check_package_path(p: &str) -> Result<(), PathRejection> {
    if p.starts_with('/') || p.starts_with('\\') || p.as_bytes().get(1) == Some(&b':') {
        return Err(PathRejection::Absolute);
    }
    if p.len() > MAX_PATH_LEN {
        return Err(PathRejection::TooLong);
    }
    let segments: Vec<&str> = p.split('/').collect();
    if segments
        .iter()
        .any(|s| s.is_empty() || *s == "." || *s == "..")
    {
        return Err(PathRejection::DotSegment);
    }
    if let Some(c) = p
        .chars()
        .find(|c| !(c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '/' | '-')))
    {
        return Err(PathRejection::BadChar(c));
    }
    if segments.len() > MAX_DEPTH {
        return Err(PathRejection::TooDeep);
    }
    for s in &segments {
        if s.starts_with('-') {
            return Err(PathRejection::LeadingDash);
        }
        if s.ends_with('.') {
            return Err(PathRejection::TrailingDotOrSpace);
        }
        if is_device_name(s) {
            return Err(PathRejection::DeviceName((*s).to_string()));
        }
    }
    Ok(())
}

/// Prueft eine Menge von Paketpfaden: jeder einzeln, keine Dubletten ohne
/// Gross-/Kleinschreibung, hoechstens `MAX_FILES`.
pub fn check_path_set<'a>(paths: impl IntoIterator<Item = &'a str>) -> Result<(), PathRejection> {
    let mut seen: HashMap<String, &'a str> = HashMap::new();
    for p in paths {
        check_package_path(p)?;
        if let Some(prev) = seen.insert(p.to_ascii_lowercase(), p) {
            return Err(PathRejection::CaseDuplicate(
                prev.to_string(),
                p.to_string(),
            ));
        }
        if seen.len() > MAX_FILES {
            return Err(PathRejection::TooMany);
        }
    }
    Ok(())
}
