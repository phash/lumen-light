//! Serde-Typen fuer `lumen-plugin.toml` (Feldtabelle der Spec, Abschnitt
//! "Manifest-Felder"). Keine Semantik, die prueft `validate`.

use std::collections::BTreeMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Manifest {
    pub schema: u32,
    pub id: String,
    pub version: semver::Version,
    pub tier: Tier,
    pub api: String,
    #[schemars(with = "String")]
    pub lumen: semver::VersionReq,
    pub license: Option<String>,
    pub source: Option<String>,
    pub name: LocalizedStr,
    pub description: Option<LocalizedStr>,
    #[serde(default)]
    pub api_experimental: Vec<String>,
    #[serde(default)]
    pub files: BTreeMap<String, String>,
    #[serde(default)]
    pub artifacts: Artifacts,
    #[serde(default)]
    #[schemars(with = "BTreeMap<String, serde_json::Value>")]
    pub capabilities: BTreeMap<String, toml::Value>,
    #[serde(default)]
    pub params: BTreeMap<String, ParamDecl>,
    #[serde(default)]
    pub contributes: Contributes,
    pub native: Option<NativeSection>,
    pub edit_state: Option<EditStateSection>,
    #[serde(default)]
    pub migrate: Vec<Migrate>,
    pub activation: Option<Activation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Tier {
    Shader,
    Wasm,
    Native,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LocalizedStr {
    pub en: String,
    pub de: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Artifacts {
    pub wasm: Option<String>,
    pub native: Option<NativeArtifacts>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct NativeArtifacts {
    #[serde(rename = "linux-x86_64")]
    pub linux_x86_64: Option<String>,
    #[serde(rename = "windows-x86_64")]
    pub windows_x86_64: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ParamKind {
    Float,
    Int,
    Bool,
    Choice,
    Curve,
}

/// Zahl im Manifest; TOML trennt Ganzzahl und Gleitkomma.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum Number {
    Int(i64),
    Float(f64),
}

impl Number {
    pub fn as_f64(self) -> f64 {
        match self {
            Number::Int(i) => i as f64,
            Number::Float(f) => f,
        }
    }
}

/// Standardwert eines Params (je nach `kind`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum ParamValue {
    Bool(bool),
    Number(Number),
    Choice(String),
    Points(Vec<[f64; 2]>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct ParamDecl {
    pub kind: ParamKind,
    pub min: Option<Number>,
    pub max: Option<Number>,
    pub default: Option<ParamValue>,
    pub step: Option<Number>,
    pub label: LocalizedStr,
    pub loop_bound: Option<bool>,
    pub choices: Option<Vec<Choice>>,
    pub points_max: Option<u32>,
    pub log: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Choice {
    pub id: String,
    pub label: LocalizedStr,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Contributes {
    #[serde(default)]
    pub panel: Vec<Panel>,
    #[serde(default)]
    pub gpu_chain: Vec<GpuChain>,
    #[serde(default)]
    pub command: Vec<Command>,
    #[serde(default)]
    pub decoder: Vec<Decoder>,
    #[serde(default)]
    pub cpu_op: Vec<CpuOp>,
    #[serde(default)]
    pub encoder: Vec<Encoder>,
    #[serde(default)]
    pub library_action: Vec<LibraryAction>,
    #[serde(default)]
    pub import_hook: Vec<ImportHook>,
    #[serde(default)]
    pub export_hook: Vec<ExportHook>,
    #[serde(default)]
    pub metadata: Vec<Metadata>,
    #[serde(default)]
    pub event: Vec<Event>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Panel {
    pub id: String,
    pub location: String,
    pub after: Option<String>,
    pub title: LocalizedStr,
    #[serde(default)]
    pub layout: Vec<LayoutItem>,
    pub notify_on_change: Option<bool>,
    pub describe_affects: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum LayoutItem {
    Param(String),
    Section(LayoutSection),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LayoutSection {
    pub section: String,
    pub collapsed: Option<bool>,
    pub items: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum Hook {
    Source,
    Output,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct GpuChain {
    pub hook: Hook,
    pub skip_when: Option<String>,
    #[serde(default)]
    pub pass: Vec<Pass>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum PassKind {
    Fragment,
    Compute,
}

/// Halo in Pixeln: Konstante oder Param-ID.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged)]
pub enum RadiusRef {
    Const(u32),
    Param(String),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Pass {
    pub name: String,
    pub kind: PassKind,
    pub shader: String,
    pub entry: String,
    #[serde(default)]
    pub inputs: Vec<String>,
    pub save_as: Option<String>,
    pub scale: Option<f64>,
    pub radius_px: Option<RadiusRef>,
    pub workgroup_cache_radius: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CommandContext {
    Library,
    Editor,
    Both,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Command {
    pub id: String,
    pub title: LocalizedStr,
    #[serde(default)]
    pub menu: Vec<LocalizedStr>,
    pub context: Option<CommandContext>,
    pub key: Option<String>,
    pub enabled_when: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DecoderRole {
    Fallback,
    Primary,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct Decoder {
    #[serde(default)]
    pub magic: Vec<String>,
    #[serde(default)]
    pub extensions: Vec<String>,
    pub role: DecoderRole,
    pub priority: Option<u8>,
    #[serde(default)]
    pub modes: Vec<String>,
    pub embedded_preview: Option<bool>,
    pub maker: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CpuSlot {
    Bake,
    ExportPreEncode,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct CpuOp {
    pub id: String,
    pub slot: CpuSlot,
    pub title: LocalizedStr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Encoder {
    pub id: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    pub title: LocalizedStr,
    pub mime: Option<String>,
    #[serde(default)]
    pub params: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct LibraryAction {
    pub command: String,
    pub selection: Option<Selection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub min: u32,
    pub max: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ImportHook {
    pub extensions: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ExportHook {
    #[serde(default)]
    pub formats: Vec<String>,
    pub title: Option<LocalizedStr>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub keys: Vec<String>,
    pub badge: Option<String>,
    pub filterable: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub names: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct NativeSection {
    pub memory_mib: Option<u32>,
    pub uses_openmp: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "kebab-case")]
pub struct EditStateSection {
    pub param_version: u32,
    pub default_enabled_in_batch: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Migrate {
    pub from: u32,
    #[serde(default)]
    pub rename: BTreeMap<String, String>,
    #[serde(default)]
    pub scale: BTreeMap<String, f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Activation {
    pub on: Vec<String>,
}
