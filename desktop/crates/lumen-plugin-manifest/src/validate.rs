//! Semantische Pruefung eines geparsten Manifests.

use std::collections::BTreeSet;

use crate::ManifestError;
use crate::caps::tiers_for;
use crate::ids::{RESERVED_PREFIXES, is_param_id, is_plugin_id, prefix};
use crate::model::*;
use crate::paths::{PathRejection, check_package_path, check_path_set};
use crate::text::{check_text, confusable_with_reserved};

/// Woher ein Manifest kommt; bestimmt, ob reservierte Praefixe erlaubt sind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// Datei-Installation; `builtin_signed` = mit einkompiliertem, Root-zertifiziertem Schluessel signiert.
    File {
        builtin_signed: bool,
    },
    /// `--dev-plugins` mit Dev-Signatur.
    Dev,
    Marketplace {
        builtin_signed: bool,
    },
}

/// Rechte mit Vollzugriff auf Dateibytes oder Bildinhalte.
const CONTENT_CAPS: &[&str] = &["raw.decode", "metadata", "originals.read", "export.encoder"];
/// Ausleitungswege.
const EXFIL_CAPS: &[&str] = &["net", "clipboard.write"];

pub fn validate(m: &Manifest, origin: Origin) -> Result<(), Vec<ManifestError>> {
    let mut e = Vec::new();
    check_identity(m, origin, &mut e);
    check_texts(m, &mut e);
    check_files(m, &mut e);
    check_caps(m, &mut e);
    check_params(m, &mut e);
    check_contributes(m, &mut e);
    if e.is_empty() { Ok(()) } else { Err(e) }
}

fn check_identity(m: &Manifest, origin: Origin, e: &mut Vec<ManifestError>) {
    if !is_plugin_id(&m.id) {
        e.push(ManifestError::InvalidPluginId(m.id.clone()));
        return;
    }
    let p = prefix(&m.id);
    let allowed = match origin {
        Origin::Dev => true,
        Origin::File { builtin_signed } | Origin::Marketplace { builtin_signed } => builtin_signed,
    };
    if RESERVED_PREFIXES.contains(&p) && !allowed {
        e.push(ManifestError::ReservedPrefix(p.to_string()));
    }
}

fn each_localized(m: &Manifest) -> Vec<(&'static str, &LocalizedStr)> {
    let mut v = vec![("name", &m.name)];
    v.extend(m.description.iter().map(|d| ("description", d)));
    v.extend(m.params.values().map(|p| ("label", &p.label)));
    v.extend(
        m.params
            .values()
            .flat_map(|p| p.choices.iter().flatten())
            .map(|c| ("label", &c.label)),
    );
    let c = &m.contributes;
    v.extend(c.panel.iter().map(|p| ("title", &p.title)));
    v.extend(c.command.iter().map(|x| ("title", &x.title)));
    v.extend(
        c.command
            .iter()
            .flat_map(|x| x.menu.iter())
            .map(|x| ("menu", x)),
    );
    v.extend(c.cpu_op.iter().map(|x| ("title", &x.title)));
    v.extend(c.encoder.iter().map(|x| ("title", &x.title)));
    v.extend(
        c.export_hook
            .iter()
            .filter_map(|x| x.title.as_ref())
            .map(|x| ("title", x)),
    );
    v
}

fn check_texts(m: &Manifest, e: &mut Vec<ManifestError>) {
    for (field, s) in each_localized(m) {
        for t in std::iter::once(&s.en).chain(s.de.iter()) {
            if let Err(x) = check_text(field, t) {
                e.push(x);
            }
        }
    }
    for t in std::iter::once(&m.name.en).chain(m.name.de.iter()) {
        if let Some(w) = confusable_with_reserved(t) {
            e.push(ManifestError::Confusable {
                field: "name",
                with: w,
            });
        }
    }
}

fn check_files(m: &Manifest, e: &mut Vec<ManifestError>) {
    for p in m.files.keys() {
        if let Err(why) = check_package_path(p) {
            e.push(ManifestError::Path {
                path: p.clone(),
                why,
            });
        }
    }
    // Einzelpfade sind oben gemeldet; hier nur Mengenregeln.
    if let Err(why @ (PathRejection::CaseDuplicate(..) | PathRejection::TooMany)) =
        check_path_set(m.files.keys().map(String::as_str))
    {
        e.push(ManifestError::Path {
            path: String::new(),
            why,
        });
    }
    for (p, h) in &m.files {
        if h.len() != 64
            || !h
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
        {
            e.push(ManifestError::BadHash(p.clone()));
        }
    }
    let a = &m.artifacts;
    let native = a
        .native
        .as_ref()
        .map(|n| n.linux_x86_64.is_some() || n.windows_x86_64.is_some())
        .unwrap_or(false);
    let ok = match m.tier {
        Tier::Shader => a.wasm.is_none() && !native,
        Tier::Wasm => a.wasm.is_some() && !native,
        Tier::Native => a.wasm.is_none() && native,
    };
    if !ok {
        e.push(ManifestError::TierArtifactMismatch);
    }
    let mut artifacts: Vec<&String> = a.wasm.iter().collect();
    if let Some(n) = &a.native {
        artifacts.extend(n.linux_x86_64.iter().chain(n.windows_x86_64.iter()));
    }
    for f in artifacts {
        if !m.files.contains_key(f) {
            e.push(ManifestError::FileNotListed(f.clone()));
        }
    }
    for pass in m.contributes.gpu_chain.iter().flat_map(|c| &c.pass) {
        if !m.files.contains_key(&pass.shader) {
            e.push(ManifestError::ShaderNotListed(pass.shader.clone()));
        }
    }
}

fn value_has_str(v: &toml::Value, needle: &str) -> bool {
    match v {
        toml::Value::String(s) => s == needle,
        toml::Value::Array(a) => a.iter().any(|x| value_has_str(x, needle)),
        toml::Value::Table(t) => t.values().any(|x| value_has_str(x, needle)),
        _ => false,
    }
}

fn check_caps(m: &Manifest, e: &mut Vec<ManifestError>) {
    for name in m.capabilities.keys() {
        match tiers_for(name) {
            None => e.push(ManifestError::UnknownCapability(name.clone())),
            Some(t) if !t.contains(&m.tier) => e.push(ManifestError::CapabilityNotForTier {
                cap: name.clone(),
                tier: m.tier,
            }),
            Some(_) => {}
        }
    }
    let has = |n: &str| m.capabilities.contains_key(n);
    if m.tier == Tier::Native {
        let fs_write = m
            .capabilities
            .get("fs.pick")
            .is_some_and(|v| value_has_str(v, "write"));
        for cap in ["net", "clipboard.write", "export.post"]
            .into_iter()
            .filter(|c| has(c))
        {
            e.push(ManifestError::LeakRule {
                cap: cap.into(),
                because: "nativem Code".into(),
            });
        }
        if fs_write {
            e.push(ManifestError::LeakRule {
                cap: "fs.pick".into(),
                because: "nativem Code".into(),
            });
        }
    }
    let cpu_op = m
        .capabilities
        .get("image.process")
        .is_some_and(|v| value_has_str(v, "cpu-op"));
    let content: Vec<&str> = CONTENT_CAPS
        .iter()
        .copied()
        .filter(|c| has(c))
        .chain(cpu_op.then_some("image.process cpu-op"))
        .collect();
    if let Some(first) = content.first() {
        for cap in EXFIL_CAPS.iter().filter(|c| has(c)) {
            let already = e
                .iter()
                .any(|x| matches!(x, ManifestError::LeakRule { cap: c, .. } if c == cap));
            if !already {
                e.push(ManifestError::LeakRule {
                    cap: (*cap).into(),
                    because: format!("`{first}`"),
                });
            }
        }
    }
}

fn in_range(v: f64, min: Option<Number>, max: Option<Number>) -> bool {
    min.is_none_or(|n| v >= n.as_f64()) && max.is_none_or(|n| v <= n.as_f64())
}

fn check_params(m: &Manifest, e: &mut Vec<ManifestError>) {
    for (id, p) in &m.params {
        if !is_param_id(id) {
            e.push(ManifestError::InvalidParamId(id.clone()));
        }
        let mut ok = true;
        if let (Some(a), Some(b)) = (p.min, p.max) {
            ok &= a.as_f64() <= b.as_f64();
        }
        if let Some(s) = p.step {
            ok &= s.as_f64() > 0.0;
        }
        ok &= match (&p.kind, &p.default) {
            (_, None) => true,
            (ParamKind::Float | ParamKind::Int, Some(ParamValue::Number(n))) => {
                in_range(n.as_f64(), p.min, p.max)
            }
            (ParamKind::Int, _) | (ParamKind::Float, _) => false,
            (ParamKind::Bool, Some(ParamValue::Bool(_))) => true,
            (ParamKind::Choice, Some(ParamValue::Choice(c))) => {
                p.choices.iter().flatten().any(|x| &x.id == c)
            }
            (ParamKind::Curve, Some(ParamValue::Points(pts))) => pts.len() <= 16,
            _ => false,
        };
        if p.kind == ParamKind::Int {
            ok &= [p.min, p.max, p.step]
                .iter()
                .flatten()
                .all(|n| matches!(n, Number::Int(_)));
        }
        if p.kind == ParamKind::Curve {
            ok &= p.points_max.is_none_or(|n| (2..=16).contains(&n));
        }
        if p.kind == ParamKind::Choice {
            ok &= p.choices.as_ref().is_some_and(|c| !c.is_empty());
        }
        if p.loop_bound == Some(true) {
            ok &= p.kind == ParamKind::Int && p.max.is_some();
        }
        if !ok {
            e.push(ManifestError::ParamRange(id.clone()));
        }
    }
}

fn check_contributes(m: &Manifest, e: &mut Vec<ManifestError>) {
    let c = &m.contributes;
    let mut refs: BTreeSet<&str> = BTreeSet::new();
    for item in c.panel.iter().flat_map(|p| &p.layout) {
        match item {
            LayoutItem::Param(p) => {
                refs.insert(p);
            }
            LayoutItem::Section(s) => refs.extend(s.items.iter().map(String::as_str)),
        }
    }
    for pass in c.gpu_chain.iter().flat_map(|g| &g.pass) {
        if let Some(RadiusRef::Param(p)) = &pass.radius_px {
            refs.insert(p);
        }
    }
    refs.extend(
        c.encoder
            .iter()
            .flat_map(|x| x.params.iter().map(String::as_str)),
    );
    for r in refs {
        if !m.params.contains_key(r) {
            e.push(ManifestError::UnknownParamRef(r.to_string()));
        }
    }
    let want = format!("{}.", m.id);
    for cmd in &c.command {
        if !cmd.id.starts_with(&want) || cmd.id.len() == want.len() {
            e.push(ManifestError::CommandPrefix(cmd.id.clone()));
        }
    }
}
