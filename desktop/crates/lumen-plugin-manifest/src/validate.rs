//! Semantische Pruefung eines geparsten Manifests.

use std::collections::BTreeSet;

use crate::ManifestError;
use crate::caps::tiers_for;
use crate::expr::{ExprContext, parse_expr, typecheck};
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

/// Feldname fuer Fehlermeldungen: oberster Schluessel des Manifests.
fn field_name(top: &str) -> &'static str {
    const KEYS: &[&str] = &[
        "id",
        "version",
        "api",
        "lumen",
        "license",
        "source",
        "name",
        "description",
        "api-experimental",
        "files",
        "artifacts",
        "capabilities",
        "params",
        "contributes",
        "native",
        "edit-state",
        "migrate",
        "activation",
    ];
    KEYS.iter()
        .copied()
        .find(|k| *k == top)
        .unwrap_or("manifest")
}

fn walk_strings(field: &'static str, v: &toml::Value, e: &mut Vec<ManifestError>) {
    match v {
        toml::Value::String(s) => {
            if let Err(x) = check_text(field, s) {
                e.push(x);
            }
        }
        toml::Value::Array(a) => a.iter().for_each(|x| walk_strings(field, x, e)),
        toml::Value::Table(t) => {
            for (k, x) in t {
                if let Err(x) = check_text(field, k) {
                    e.push(x);
                }
                walk_strings(field, x, e);
            }
        }
        _ => {}
    }
}

/// Prueft jede Zeichenkette (auch Schluessel und Rechte-Werte) auf unsichtbare Zeichen.
fn check_texts(m: &Manifest, e: &mut Vec<ManifestError>) {
    if let Ok(toml::Value::Table(t)) = toml::Value::try_from(m) {
        for (k, v) in &t {
            walk_strings(field_name(k), v, e);
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
    for p in m.files.keys() {
        let l = p.to_ascii_lowercase();
        if l == "lumen-plugin.toml" || l == "signatures" {
            e.push(ManifestError::Path {
                path: p.clone(),
                why: PathRejection::ReservedName,
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
    let has_scope = |n: &str, scope: &str| {
        m.capabilities
            .get(n)
            .is_some_and(|v| value_has_str(v, scope))
    };

    // Form der Werte, soweit die Spec sie festlegt: Listen von Bereichs-IDs.
    for (cap, scopes) in [
        ("image.process", Some(&["gpu-pass", "cpu-op"][..])),
        ("ui.panel", None),
        ("ui.menu", None),
        ("ui.shortcut", None),
    ] {
        if let Some(v) = m.capabilities.get(cap) {
            let ok = v.as_array().is_some_and(|a| {
                !a.is_empty()
                    && a.iter().all(|x| {
                        x.as_str()
                            .is_some_and(|s| scopes.is_none_or(|sc| sc.contains(&s)))
                    })
            });
            if !ok {
                e.push(ManifestError::BadCapabilityValue(cap.into()));
            }
        }
    }

    // Jeder Beitrag braucht sein Recht.
    let c = &m.contributes;
    // Beitragsarten je Stufe: Shader-Pakete beschreiben nur Panels, GPU-Ketten und Befehle.
    if m.tier == Tier::Shader {
        let code_only = [
            ("decoder", c.decoder.is_empty()),
            ("cpu-op", c.cpu_op.is_empty()),
            ("encoder", c.encoder.is_empty()),
            ("library-action", c.library_action.is_empty()),
            ("import-hook", c.import_hook.is_empty()),
            ("export-hook", c.export_hook.is_empty()),
            ("metadata", c.metadata.is_empty()),
            ("event", c.event.is_empty()),
        ];
        for (contribution, empty) in code_only {
            if !empty {
                e.push(ManifestError::ContributionNotForTier {
                    contribution,
                    tier: m.tier,
                });
            }
        }
    }
    // Tastenkuerzel sind nur Vorschlaege (standardmaessig aus) und brauchen kein Recht;
    // Untermenues unterhalb "Plugins -> Name" brauchen `ui.menu`.
    let submenu = c.command.iter().any(|x| !x.menu.is_empty());
    let needs: [(&'static str, bool, &'static str, Option<&str>); 9] = [
        ("command menu", submenu, "ui.menu", None),
        (
            "gpu-chain",
            !c.gpu_chain.is_empty(),
            "image.process",
            Some("gpu-pass"),
        ),
        (
            "cpu-op",
            !c.cpu_op.is_empty(),
            "image.process",
            Some("cpu-op"),
        ),
        ("decoder", !c.decoder.is_empty(), "raw.decode", None),
        ("encoder", !c.encoder.is_empty(), "export.encoder", None),
        ("metadata", !c.metadata.is_empty(), "metadata", None),
        (
            "import-hook",
            !c.import_hook.is_empty(),
            "import.hook",
            None,
        ),
        (
            "export-hook",
            !c.export_hook.is_empty(),
            "export.post",
            None,
        ),
        ("panel", !c.panel.is_empty(), "ui.panel", None),
    ];
    for (contribution, present, cap, scope) in needs {
        let granted = match scope {
            Some(sc) => has_scope(cap, sc),
            None => has(cap),
        };
        if present && !granted {
            e.push(ManifestError::MissingCapability { contribution, cap });
        }
    }

    if m.tier == Tier::Native {
        for cap in ["net", "clipboard.write", "export.post"]
            .into_iter()
            .filter(|c| has(c))
        {
            e.push(ManifestError::LeakRule {
                cap: cap.into(),
                because: "nativem Code".into(),
            });
        }
        if has_scope("fs.pick", "write") {
            e.push(ManifestError::LeakRule {
                cap: "fs.pick".into(),
                because: "nativem Code".into(),
            });
        }
    }

    // Inhaltszugriff ergibt sich aus Rechten UND Beitraegen.
    let content: Vec<&str> = CONTENT_CAPS
        .iter()
        .copied()
        .filter(|c| has(c))
        .chain(has_scope("image.process", "cpu-op").then_some("image.process cpu-op"))
        .chain((!c.decoder.is_empty()).then_some("decoder"))
        .chain((!c.encoder.is_empty()).then_some("encoder"))
        .chain((!c.metadata.is_empty()).then_some("metadata"))
        .chain((!c.cpu_op.is_empty()).then_some("cpu-op"))
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
    let mut exprs: Vec<(&'static str, &str, ExprContext)> = Vec::new();
    exprs.extend(
        c.gpu_chain
            .iter()
            .filter_map(|g| g.skip_when.as_deref())
            .map(|s| ("skip-when", s, ExprContext::SkipWhen)),
    );
    exprs.extend(
        c.command
            .iter()
            .filter_map(|x| x.enabled_when.as_deref())
            .map(|s| ("enabled-when", s, ExprContext::EnabledWhen)),
    );
    for (field, src, ctx) in exprs {
        if let Err(err) = parse_expr(src).and_then(|x| typecheck(&x, &m.params, ctx)) {
            e.push(ManifestError::Expr { field, err });
        }
    }
    check_limits(m, e);
    let want = format!("{}.", m.id);
    for cmd in &c.command {
        if !cmd.id.starts_with(&want) || cmd.id.len() == want.len() {
            e.push(ManifestError::CommandPrefix(cmd.id.clone()));
        }
    }
}

/// Halo-Grenze je Pass (Spec: Konstante oder Param-ID, max. 64).
pub const MAX_HALO_PX: u32 = 64;
/// Hoechste Schleifenschranke eines `loop-bound`-Params (Kostenregel: 4096 Iterationen).
pub const MAX_LOOP_BOUND: f64 = 4096.0;
/// `workgroup-cache-radius` (16-KiB-Grenze).
pub const MAX_WORKGROUP_CACHE_RADIUS: u32 = 8;

fn check_limits(m: &Manifest, e: &mut Vec<ManifestError>) {
    let mut lim = |s: String| e.push(ManifestError::LimitExceeded(s));
    for (id, p) in &m.params {
        if p.loop_bound == Some(true) && p.max.is_some_and(|x| x.as_f64() > MAX_LOOP_BOUND) {
            lim(format!("loop-bound-Param `{id}`: max > {MAX_LOOP_BOUND}"));
        }
    }
    for pass in m.contributes.gpu_chain.iter().flat_map(|g| &g.pass) {
        match &pass.radius_px {
            Some(RadiusRef::Const(r)) if *r > MAX_HALO_PX => {
                lim(format!("radius-px von `{}` > {MAX_HALO_PX}", pass.name))
            }
            Some(RadiusRef::Param(p))
                if m.params
                    .get(p)
                    .and_then(|d| d.max)
                    .is_none_or(|x| x.as_f64() > MAX_HALO_PX as f64) =>
            {
                lim(format!(
                    "radius-px-Param `{p}` braucht max <= {MAX_HALO_PX}"
                ));
            }
            _ => {}
        }
        if pass
            .workgroup_cache_radius
            .is_some_and(|r| r > MAX_WORKGROUP_CACHE_RADIUS)
        {
            lim(format!(
                "workgroup-cache-radius von `{}` > {MAX_WORKGROUP_CACHE_RADIUS}",
                pass.name
            ));
        }
    }
    for d in &m.contributes.decoder {
        let hex_ok = |h: &str| {
            !h.is_empty()
                && h.len().is_multiple_of(2)
                && h.len() <= 32
                && h.bytes().all(|b| b.is_ascii_hexdigit())
        };
        if d.magic.is_empty() || d.magic.len() > 8 || !d.magic.iter().all(|h| hex_ok(h)) {
            lim("decoder.magic: 1-8 Hex-Einträge, je höchstens 16 Byte".into());
        }
        if d.priority.is_some_and(|p| p > 100) {
            lim("decoder.priority: 0-100".into());
        }
        if !d.modes.iter().all(|x| x == "half" || x == "full") {
            lim("decoder.modes: nur `half`, `full`".into());
        }
    }
    for md in &m.contributes.metadata {
        if md.keys.is_empty() || !md.keys.iter().all(|k| k.len() > 2 && k.starts_with("x.")) {
            lim("metadata.keys: Präfix `x.`".into());
        }
    }
}
