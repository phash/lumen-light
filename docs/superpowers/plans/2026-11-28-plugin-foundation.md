# Plugin-Fundament (Aufgabe L + N1-Plugin-Crates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lizenz-Ausnahme ins Repo bringen und die host-freien Plugin-Grundlagen bauen: Manifest-Crate (Typen, Validator, Minisprache, Signaturformat, JSON-Schema) und WIT-0.1-Paket, beide gegen die Spec getestet.

**Architecture:** Zwei neue, host-freie Crates unter `desktop/crates/` mit MIT OR Apache-2.0. `lumen-plugin-manifest` parst `lumen-plugin.toml` und `SIGNATURES` per serde/toml (`deny_unknown_fields`), prüft alles Statische (IDs, Pfade, Unicode, Rechte, Ausleitungs-Regel, Ausdrücke, Signaturen). `lumen-plugin-api` hält die WIT-Dateien; ein Test parst sie mit `wit-parser`. Sync-Tests lesen die Codeblöcke direkt aus der Spec, damit Spec und Code nicht auseinanderlaufen.

**Tech Stack:** Rust 1.100 (`desktop/rust-toolchain.toml`), edition 2024, serde, toml, semver, schemars, sha2, ed25519-dalek, unicode-security, wit-parser, base64, cargo-deny. Alle neuen Versionen beim Hinzufügen per `cargo search` auf testbox exakt `=x.y.z` pinnen und in `[workspace.dependencies]` eintragen.

**Spec:** `docs/superpowers/specs/2026-11-28-plugin-system-design.md` (freigegeben 2026-11-28). Abschnitte: „Plugin-Paket und Manifest“, „Rechte (Capabilities)“, „WIT-World-Skizze“, „Versionierung und Kompatibilität“ (Lizenz), „Crate-Aufbau“, „Einordnung in N0–N10“.

## Umfang dieses Plans

Die Spec umfasst N1–N10-Nähte und N11a–c. Dieser Plan deckt nur, was **heute ohne andere Meilensteine** baubar ist: Aufgabe L und die beiden host-freien Crates aus der N1-Zeile. Alles andere landet im Plan des jeweiligen Meilensteins (Nähte-Register unten); N11a, N11b, N11c bekommen je einen eigenen Plan nach der Parität.

## Global Constraints

- Neue Plugin-Crates: `license = "MIT OR Apache-2.0"` (überschreibt den Workspace-Wert), `publish = false`, `edition.workspace = true`.
- Kein wasmtime, wgpu, naga oder Netzwerk-Crate in `lumen-plugin-manifest` und `lumen-plugin-api`.
- Versionen exakt gepinnt (`=x.y.z`), Eintrag in `desktop/Cargo.toml [workspace.dependencies]`.
- Plugin-ID: `^[a-z0-9-]{2,32}\.[a-z0-9-]{2,48}$`. Param-ID: `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`. Befehls-ID beginnt mit `<plugin-id>.`.
- Reservierte Publisher-Präfixe: `lumen`, `builtin`, `core`, `plugin`, `system`, `mrd`.
- Unbekannte Manifest-Schlüssel sind Fehler (`#[serde(deny_unknown_fields)]` auf jeder Struktur).
- Code-Kommentare und Testnamen deutsch ohne Umlaute; Fehlermeldungen an Nutzer mit echten Umlauten.
- `make -C desktop ci` grün (fmt, clippy `-D warnings`, test). Läufe auf testbox über `tb-run` (rsync vorher, siehe CLAUDE.md).
- Conventional Commits, Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. Manifest mit ungequotetem Rechte-Namen (`image.process = [...]`) — erwartet: Fehler mit Hinweis „Rechte-Namen in Anführungszeichen“, nicht stilles Ignorieren. Test in Task 2.
2. Spec-Beispiel nutzt Präfix `mrd` (reserviert) — erwartet: gültig mit `Origin::Dev` und `Origin::File { builtin_signed: true }`, abgelehnt mit `Origin::File { builtin_signed: false }`. Test in Task 3.
3. Pfad `shaders/NUL.wgsl`, `A.wgsl` neben `a.wgsl`, `x.dll.` — erwartet: alle abgelehnt, auch wenn auf Linux harmlos. Test in Task 3.
4. `SIGNATURES` mit `key-id`, das nicht zu `pubkey` passt, oder `published-at` mit Zeitzone `+01:00` — erwartet: abgelehnt, auch wenn die Signatur selbst stimmt. Test in Task 5.
5. `skip-when = "selection > 0"` — erwartet: Manifest-Fehler (in `skip-when` nur Param-IDs und Literale). Test in Task 4.

---

### Task 1: Aufgabe L — Lizenz-Ausnahme nach AGPL §7

**Files:**
- Create: `LICENSES/AdditionRef-Lumen-Plugin-Exception.txt`
- Modify: `LICENSE` (Hinweisblock vor dem AGPL-Text)
- Create: `CONTRIBUTING.md`
- Create: `desktop/deny.toml`
- Modify: `desktop/Cargo.toml` (`[workspace.package] license`)
- Modify: `desktop/Makefile` (Ziel `deny`)
- Modify: `README.md` (Abschnitt „Lizenz“: ein Satz zur Ausnahme mit Link)

**Interfaces:**
- Produces: SPDX-Ausdruck `AGPL-3.0-or-later WITH AdditionRef-Lumen-Plugin-Exception` für alle App-Crates.

- [ ] **Step 1:** `LICENSES/AdditionRef-Lumen-Plugin-Exception.txt` mit dem Text aus der Spec („Versionierung und Kompatibilität“ → Lizenz, Zitatblock) wortgleich auf Deutsch, darunter eine englische Arbeitsübersetzung mit dem Vermerk „Bei Abweichungen gilt die deutsche Fassung.“ Kopfzeile: `SPDX-License-Identifier: AdditionRef-Lumen-Plugin-Exception`, Rechteinhaber `Copyright (C) 2026 Manuel Rödig`.
- [ ] **Step 2:** `LICENSE`: oben Block „Zusätzliche Erlaubnis nach §7: siehe LICENSES/AdditionRef-Lumen-Plugin-Exception.txt“, AGPL-Text bleibt unverändert darunter.
- [ ] **Step 3:** `CONTRIBUTING.md`: DCO 1.1 (`Signed-off-by` Pflicht), Satz „Beiträge stehen unter AGPL-3.0-or-later mit derselben Plugin-Ausnahme“, Plugin-Crates (`lumen-plugin-abi/-api/-sdk/-manifest`) unter MIT OR Apache-2.0, Hinweis auf testbox/`make -C desktop ci`.
- [ ] **Step 4:** `desktop/Cargo.toml`: `license = "AGPL-3.0-or-later WITH AdditionRef-Lumen-Plugin-Exception"`. `desktop/deny.toml` mit `[licenses] allow = ["AGPL-3.0-or-later WITH AdditionRef-Lumen-Plugin-Exception", "MIT", "Apache-2.0", "LGPL-2.1-only", …]` (Rest aus der tatsächlichen `cargo deny list`-Ausgabe), `[bans] multiple-versions = "warn"`. Makefile: `deny: ; cargo deny check licenses bans`.
- [ ] **Step 5:** cargo-deny auf testbox gepinnt installieren (`cargo install --locked cargo-deny@<aktuelle Version>`), dann:
  Run: `ssh testbox "tb-run 'lumen:deny (cachytop)' -- bash -lc 'cd ~/work/lumen/desktop && make deny'"`
  Expected: `licenses ok`. **Rückfall laut Spec**, wenn die gepinnte Version `AdditionRef-` ablehnt: `license = "AGPL-3.0-or-later"` + Klartext-Hinweis in `LICENSE` (nicht `license-file`), `deny.toml` entsprechend; Rückfall im Commit-Text nennen.
- [ ] **Step 6: STOPP — Manuel prüft den Lizenztext.** Zeigen: Ausnahme-Text (de + en), Diff von `LICENSE` und `CONTRIBUTING.md`. Erst nach seinem OK committen. Hinweis mitgeben: Wirksamkeit vor Einladung fremder Autoren anwaltlich prüfen lassen.
- [ ] **Step 7: Commit** `chore(license): AGPL-3.0 §7 Plugin-Ausnahme, DCO, cargo-deny`

### Task 2: `lumen-plugin-manifest` — Typen und Parsen

**Files:**
- Create: `desktop/crates/lumen-plugin-manifest/{Cargo.toml, src/lib.rs, src/model.rs, src/error.rs}`
- Create: `desktop/crates/lumen-plugin-manifest/tests/spec_example.rs`
- Modify: `desktop/Cargo.toml` (`[workspace.dependencies]`: `lumen-plugin-manifest`, `serde`, `toml`, `semver`)

**Interfaces:**
- Produces:
  - `pub fn parse_manifest(bytes: &[u8]) -> Result<Manifest, ManifestError>` (UTF-8, toml, serde; keine Semantik)
  - `pub struct Manifest` mit Feldern exakt laut Tabelle „Manifest-Felder (Referenz)“ der Spec; Tabellen-/Feldnamen per `#[serde(rename_all = "kebab-case")]`; `capabilities: BTreeMap<String, toml::Value>`, `params: BTreeMap<String, ParamDecl>`, `files: BTreeMap<String, String>`, `contributes: Contributes` (alle Listen `#[serde(default)]`).
  - `pub enum Tier { Shader, Wasm, Native }`, `pub enum ParamKind { Float, Int, Bool, Choice, Curve }`, `pub struct LocalizedStr { pub en: String, pub de: Option<String> }`.
  - `pub enum ManifestError` (thiserror): `Toml { msg: String, hint: Option<&'static str> }`, `NotUtf8`, plus die Varianten aus Task 3–5. Hilfstext-Konstante `HINT_QUOTE_CAPS = "Rechte-Namen in Anführungszeichen setzen, z. B. \"image.process\" = …"`.
  - Test-Helfer (pub, `#[doc(hidden)]`): `pub fn spec_toml_block(spec: &str, first_line: &str) -> String` — liefert den ```` ```toml ````-Block, dessen erste Zeile `first_line` ist.

- [ ] **Step 1: Failing tests** in `tests/spec_example.rs`:
  - `beispiel_aus_spec_parst`: liest `../../../docs/superpowers/specs/2026-11-28-plugin-system-design.md`, `spec_toml_block(.., "#:schema https://lumen.mr-development.de/schemas/lumen-plugin-1.json")`, `parse_manifest` ok; `m.id == "mrd.guided-denoise"`, `m.tier == Tier::Shader`, `m.params.len() == 3`, `m.contributes.gpu_chain[0].pass.len() == 2`, `m.params["radius"].loop_bound == Some(true)`.
  - `auskommentierte_zeilen_parsen_per_serde`: Block mit entfernten führenden `# ` vor Zeilen, die mit `# S2`, `# nativ`, `# S2 ohne` beginnen (Präfix bis `: ` mit abschneiden) → `parse_manifest` ok.
  - `unbekannter_schluessel_ist_fehler`: Beispiel + Zeile `colour = 1` oben → `ManifestError::Toml`.
  - `ungequotetes_recht_gibt_hinweis`: `[capabilities]` mit `image.process = ["gpu-pass"]` → `Toml { hint: Some(HINT_QUOTE_CAPS), .. }`.
- [ ] **Step 2:** Run `cargo test -p lumen-plugin-manifest` → FAIL (Crate fehlt).
- [ ] **Step 3:** Implementieren. Hinweis-Erkennung: Tritt der Fehler in `[capabilities]` auf und ist der Wert eine Tabelle (ungequotet = Untertabelle), Hinweis setzen. Weil `capabilities` als `BTreeMap<String, toml::Value>` sonst still Untertabellen schluckt: nach dem Parsen jeden Wert prüfen, der eine Tabelle ist und dessen Schlüssel kein bekannter Rechte-Name ist (Liste aus Task 3) → Fehler mit Hinweis.
- [ ] **Step 4:** Run `cargo test -p lumen-plugin-manifest` → PASS.
- [ ] **Step 5: Commit** `feat(plugin): lumen-plugin-manifest parst lumen-plugin.toml`

### Task 3: Validator — IDs, Pfade, Unicode, Rechte, Ausleitungs-Regel

**Files:**
- Create: `src/{ids.rs, paths.rs, text.rs, caps.rs, validate.rs}`, `tests/validate.rs`
- Modify: `desktop/Cargo.toml` (`unicode-security`)

**Interfaces:**
- Consumes: `Manifest`, `ManifestError` (Task 2).
- Produces:
  - `pub enum Origin { File { builtin_signed: bool }, Dev, Marketplace }`
  - `pub fn validate(m: &Manifest, origin: Origin) -> Result<(), Vec<ManifestError>>` (sammelt alle Fehler)
  - `pub fn check_package_path(p: &str) -> Result<(), PathRejection>`; `pub fn check_path_set<'a>(paths: impl IntoIterator<Item = &'a str>) -> Result<(), PathRejection>` (Dubletten ohne Groß/klein, max. 64 Dateien)
  - `pub enum PathRejection { Absolute, DotSegment, BadChar(char), LeadingDash, TrailingDotOrSpace, DeviceName(String), CaseDuplicate(String, String), TooLong, TooDeep, TooMany }`
  - `pub fn check_text(field: &'static str, s: &str) -> Result<(), ManifestError>` (Bidi/unsichtbar), `pub fn confusable_with_reserved(name: &str) -> Option<&'static str>` (UTS-#39-Skeleton gegen „Lumen“, „Offiziell“, „Official“, „Update“, „System“ und Namen eingebauter Panels)
  - `pub enum Capability` mit allen Namen der Spec-Tabelle „Rechte (Capabilities)“; `pub fn parse_capabilities(&BTreeMap<String, toml::Value>) -> Result<Vec<(Capability, toml::Value)>, ManifestError>`
  - Neue `ManifestError`-Varianten: `InvalidPluginId(String)`, `InvalidParamId(String)`, `ReservedPrefix(String)`, `CommandPrefix(String)`, `Invisible { field: &'static str, codepoint: u32 }`, `Confusable { field: &'static str, with: &'static str }`, `Path { path: String, why: PathRejection }`, `UnknownCapability(String)`, `CapabilityNotForTier { cap: String, tier: Tier }`, `TierArtifactMismatch`, `LeakRule { cap: String, because: String }`, `ParamRange(String)`, `ShaderNotListed(String)`.

- [ ] **Step 1: Failing tests** in `tests/validate.rs` (Fixture = Spec-Beispiel über `spec_toml_block`):
  - `beispiel_gueltig_im_dev_modus`: `validate(&m, Origin::Dev)` ok; ebenso `Origin::File { builtin_signed: true }`.
  - `reserviertes_praefix_bei_unsignierter_datei`: `Origin::File { builtin_signed: false }` → enthält `ReservedPrefix("mrd")`.
  - `auskommentierte_fassung_wird_abgelehnt`: Fassung aus Task 2 (`tier = "shader"` mit `wasm`/`native`, nativ + `net`) → enthält `TierArtifactMismatch` und `LeakRule { cap: "net", .. }`.
  - `pfade_werden_abgelehnt`: je ein Assert für `/abs`, `a/../b`, `a//b`, `-x`, `x.dll.`, `x `, `shaders/NUL.wgsl`, `COM1`, `lpt9.txt`, `ä.wgsl`, Tiefe 5, Name 129 Zeichen; `check_path_set(["a.wgsl","A.wgsl"])` → `CaseDuplicate`.
  - `unsichtbare_zeichen`: `name.en = "Den\u{200B}oise"` → `Invisible { codepoint: 0x200B }`; je ein Fall U+202E, U+2066, U+E0041.
  - `verwechselbarer_name`: `name.en = "Lumеn"` (kyrillisches е) → `Confusable { with: "Lumen" }`.
  - `befehls_id_ohne_praefix`: `contributes.command[0].id = "reset"` → `CommandPrefix`.
  - `param_grenzen`: `min > max`, `default` außerhalb, `curve` mit `points-max = 17`, Param-ID `chromaOnly` → je passender Fehler.
  - `shader_nicht_in_files`: Pass verweist auf `shaders/x.wgsl`, fehlt in `[files]` → `ShaderNotListed`.
  - `ausleitung_wasm`: `tier = "wasm"` mit `raw.decode` und `net` → `LeakRule`; nur `net` → ok.
- [ ] **Step 2:** Run `cargo test -p lumen-plugin-manifest --test validate` → FAIL.
- [ ] **Step 3:** Implementieren. Ausleitungs-Regel genau laut Spec-Entscheidung 2 des Builders: Tier `native` darf `net`, `clipboard.write`, `fs.pick` mit Schreibmodus, `export.post` nicht anfordern; jedes Paket mit `raw.decode`, `metadata`, `originals.read`, `export.encoder` oder `image.process` mit `cpu-op` darf kein `net`/`clipboard.write`. Tier-Zuordnung je Recht aus Spalte „Stufe“. Gerätenamen-Prüfung auf den Stamm vor dem ersten Punkt, ohne Groß/klein.
- [ ] **Step 4:** Run → PASS. `cargo clippy -p lumen-plugin-manifest -- -D warnings` sauber.
- [ ] **Step 5: Commit** `feat(plugin): Manifest-Validator mit Pfad-, Unicode- und Rechteregeln`

### Task 4: Ausdrucks-Minisprache (`skip-when`, `enabled-when`)

**Files:**
- Create: `src/expr.rs`, `tests/expr.rs`
- Modify: `src/validate.rs` (Ausdrücke prüfen)

**Interfaces:**
- Produces:
  - `pub fn parse_expr(s: &str) -> Result<Expr, ExprError>` (Grammatik EBNF der Spec, ≤ 256 Zeichen, Tiefe ≤ 8)
  - `pub enum ExprContext { SkipWhen, EnabledWhen }`
  - `pub fn typecheck(e: &Expr, params: &BTreeMap<String, ParamDecl>, ctx: ExprContext) -> Result<(), ExprError>`
  - `pub enum Value { Num(f64), Bool(bool), Str(String) }`; `pub struct EvalEnv<'a> { pub params: &'a dyn Fn(&str) -> Option<Value>, pub selection: u32, pub editor: bool, pub library: bool }`
  - `pub fn eval(e: &Expr, env: &EvalEnv) -> bool`
  - `ManifestError::Expr { field: &'static str, err: ExprError }`

- [ ] **Step 1: Failing tests:**
  - `beispiel_ausdruecke`: `strength == 0` mit strength 0 → true; `strength > 0` mit 35 → true.
  - `vorrang`: `!a || b && c` parst als `(!a) || (b && c)`.
  - `skip_when_nur_params`: `typecheck(parse("selection > 0"), .., SkipWhen)` → Err; mit `EnabledWhen` → Ok.
  - `typfehler`: `chroma-only > 3` (bool vs Zahl) → Err; String nur gegen `choice`-Param.
  - `grenzen`: 257 Zeichen → Err; 9 Klammerebenen → Err; unbekannter Ident → Err.
  - `param_ids_mit_bindestrich`: `chroma-only == true` parst als ein Ident (Param-IDs dürfen `-` enthalten; Minus nur als Vorzeichen direkt vor einer Ziffer am Atom-Anfang).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Rekursiver Abstieg, kein Crate. Lexer: Ident = Param-ID-Regex; `-` vor Ziffer nach Operator oder am Anfang = Zahl.
- [ ] **Step 4:** Run → PASS. Spec-Beispiel weiterhin gültig (`cargo test -p lumen-plugin-manifest`).
- [ ] **Step 5: Commit** `feat(plugin): Ausdrucks-Minisprache fuer skip-when/enabled-when`

### Task 5: `SIGNATURES`-Format und Publisher-Prüfung

**Files:**
- Create: `src/signatures.rs`, `tests/signatures.rs`
- Modify: `desktop/Cargo.toml` (`sha2`, `ed25519-dalek`, `base64`)

**Interfaces:**
- Produces:
  - `pub fn parse_signatures(bytes: &[u8]) -> Result<Signatures, SigError>`; `Signatures { publisher: Option<PublisherSig>, marketplace: Option<MarketplaceSig>, dev: Option<DevSig> }` laut Spec-Format, `deny_unknown_fields`.
  - `pub struct KeyId(pub [u8; 32])` (voller sha256 des Schlüssels; Textform `ed25519:<64 hex>`).
  - Nachrichten: `pub fn publisher_message(manifest: &[u8], id: &str, version: &str) -> Vec<u8>`, `marketplace_message(manifest, id, version, tier, review_id, published_at: u64, publisher_sig: &[u8; 64])`, `cert_message(role, key: &[u8; 32], not_before: u64, not_after: u64)`, `dev_message(manifest, id, version, dev_pubkey: &[u8; 32])` — Byte-Layout exakt laut Spec (Präfixe `lumen-plugin-v1\0` usw., Strings mit `\0`, Zeiten u64 big-endian).
  - `pub fn parse_time(s: &str) -> Result<u64, SigError>` (nur `^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$`, eigener Parser ohne Zeit-Crate).
  - `pub fn verify_publisher(manifest: &[u8], id: &str, version: &str, s: &PublisherSig) -> Result<KeyId, SigError>`
  - `pub fn verify_cert(c: &Cert, root: &[u8; 32]) -> Result<(), SigError>`; `pub fn verify_marketplace(manifest, id, version, tier, s: &Signatures, root: &[u8; 32]) -> Result<(), SigError>` (inkl. `published-at ∈ [not-before, not-after]`)
  - `pub enum SigError { Format(String), KeyIdMismatch, BadTime(String), BadSignature, CertExpiredAt(u64), MissingPublisher }`

- [ ] **Step 1: Failing tests** (Schlüssel deterministisch: `SigningKey::from_bytes(&[7u8; 32])` Publisher, `[9u8; 32]` Root, `[11u8; 32]` Gegensignatur):
  - `publisher_signatur_rundlauf`: Manifest-Bytes = Spec-Beispiel; signieren, `SIGNATURES` als TOML schreiben, parsen, `verify_publisher` → `KeyId` = sha256(pubkey).
  - `ein_byte_im_manifest_geaendert`: → `BadSignature`.
  - `key_id_passt_nicht`: → `KeyIdMismatch` (auch bei gültiger Signatur).
  - `zeitformat_streng`: `2026-12-01T10:00:00+01:00`, `2026-12-01 10:00:00Z`, `2026-12-01T10:00:00.5Z` → `BadTime`; `1970-01-01T00:00:00Z` → 0; `2026-12-01T10:00:00Z` → 1796119200.
  - `marketplace_kette`: Cert von Root signiert, Gegensignatur ok → ok; `published-at` nach `not-after` → `CertExpiredAt`; Cert mit falschem Root → `BadSignature`.
  - `nachricht_layout`: `publisher_message(b"x", "a.b", "1.0.0")` == `b"lumen-plugin-v1\0" ++ sha256(b"x") ++ b"a.b\0" ++ b"1.0.0\0"`.
  - `spec_signatures_block_parst`: TOML-Block der Spec, der mit `[publisher]` beginnt, parst per `toml` als Struktur (Platzhalter-Base64 → `Format`-Fehler erst bei `verify`, nicht beim Parsen).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementieren. `verify_strict` von ed25519-dalek nutzen.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(plugin): SIGNATURES-Format und Ed25519-Pruefung`

### Task 6: JSON-Schema erzeugen und diff-prüfen

**Files:**
- Modify: `src/model.rs` (`#[derive(schemars::JsonSchema)]`), `desktop/Cargo.toml` (`schemars`)
- Create: `tests/schema.rs`, `schemas/lumen-plugin.schema.json` (Repo-Wurzel, erzeugt)

**Interfaces:**
- Produces: `pub fn json_schema() -> serde_json::Value`; eingecheckte Datei `schemas/lumen-plugin.schema.json`.

- [ ] **Step 1: Failing test** `schema_ist_aktuell`: `json_schema()` pretty mit `\n` am Ende == Inhalt der Datei; bei `LUMEN_BLESS=1` schreibt der Test die Datei statt zu vergleichen. Zweiter Test `schema_kennt_alle_felder`: Schema enthält `additionalProperties: false` auf der Wurzel und Property `capabilities`.
- [ ] **Step 2:** Run → FAIL (Datei fehlt).
- [ ] **Step 3:** Implementieren; einmal `LUMEN_BLESS=1 cargo test -p lumen-plugin-manifest --test schema`.
- [ ] **Step 4:** Run ohne BLESS → PASS. Ergänzung in `README.md` Abschnitt Tests: „Manifest-Schema neu erzeugen: `LUMEN_BLESS=1 cargo test -p lumen-plugin-manifest --test schema`“.
- [ ] **Step 5: Commit** `feat(plugin): JSON-Schema fuer lumen-plugin.toml`

### Task 7: `lumen-plugin-api` — WIT 0.1

**Files:**
- Create: `desktop/crates/lumen-plugin-api/{Cargo.toml, src/lib.rs, wit/since_v0.1.0/lumen-plugin.wit, tests/wit.rs}`
- Modify: `desktop/Cargo.toml` (`wit-parser` als dev-dependency)

**Interfaces:**
- Produces: `pub const WIT_DIR_0_1: &str` (Pfad relativ zum Crate), WIT-Paket `lumen:plugin@0.1.0` mit allen Welten der Spec. Gemeinsame Rust-Typen (`ParamDecl` usw.) kommen erst mit N11a — hier bewusst nicht.

- [ ] **Step 1:** `lumen-plugin.wit` = der ```` ```wit ````-Block der Spec (Abschnitt „WIT-World-Skizze“) wortgleich.
- [ ] **Step 2: Failing tests** in `tests/wit.rs`:
  - `wit_parst`: `wit_parser::Resolve::default().push_dir(WIT_DIR_0_1)` ok; Paketname `lumen:plugin@0.1.0`.
  - `welten_vorhanden`: Welten `decoder-plugin`, `metadata-plugin`, `image-op-plugin`, `encoder-plugin`, `workflow-plugin` existieren.
  - `decoder_kann_kein_http`: Die Welt `decoder-plugin` importiert weder `http` noch `catalog` (über `Resolve.worlds[..].imports` alle Interface-Namen prüfen).
  - `spec_und_datei_gleich`: Datei == Spec-Block (gleicher Helfer-Ansatz wie `spec_toml_block`, hier für `wit`). Ändert jemand nur eine Seite, schlägt der Test fehl.
- [ ] **Step 3:** Run `cargo test -p lumen-plugin-api` → zuerst FAIL bis Crate/Datei vollständig, dann PASS. Parst der Spec-Block nicht, Fehler in **Spec und Datei** gleich beheben (Spec-Commit separat: `docs(plugin): WIT-Block korrigiert`).
- [ ] **Step 4: Commit** `feat(plugin): WIT-Paket lumen:plugin@0.1.0`

### Task 8: CI und Abschluss

**Files:**
- Modify: `desktop/Makefile` (`ci` ruft zusätzlich `deny` auf, falls Task 1 cargo-deny eingeführt hat), `CLAUDE.md` (Abschnitt Desktop: neue Crates, Schema-Bless, Sync-Tests mit der Spec)

- [ ] **Step 1:** rsync, dann `ssh testbox "tb-run 'lumen:ci (cachytop)' -- bash -lc 'cd ~/work/lumen && ./ci.sh'"` → Expected: Exit 0.
- [ ] **Step 2:** `CLAUDE.md`: Gotcha „Plugin-Sync-Tests lesen Codeblöcke aus `docs/superpowers/specs/2026-11-28-plugin-system-design.md` — Spec-Beispiele ändern bricht Tests; Schema per `LUMEN_BLESS=1`“.
- [ ] **Step 3: Commit** `chore(desktop): Plugin-Crates in CI, Doku`; push; PR für `feat/desktop-n1-prep` öffnen (tb-ci grün abwarten).

## Nähte-Register (gehören in die Pläne der jeweiligen Meilensteine)

Nicht Teil dieses Plans. Wer den Plan für N1…N10 schreibt, übernimmt die Zeile aus der Spec-Tabelle „Einordnung in N0–N10“ als Aufgaben:

- **N1 (lumen-core):** `plugins`-Map in Edit-State/Preset-Typen mit Round-Trip unbekannter Einträge (8 KiB/Plugin, Tiefe 4, 64 Plugins); dynamische Gruppen `plugin:<id>`; `library_keys` liefert Befehls-IDs; YAML `plugins:`/`requires:` + Toleranz-Test. Nutzt `lumen-plugin-manifest::PluginId`-Prüfung aus Task 3.
- **N2:** `Decoder`-/`MetadataReader`-Trait + `DecoderRegistry`; `RawMeta.compression`; `TIMESTAMP_QUERY` + `core_p95`; Device lost.
- **N3:** `CommandBus`, leeres „Plugins“-Menü, `DeclarativePanel`, Keymap-Konflikte, Stufen-Abzeichen.
- **N5:** leere Hooks `source`/`output`, `render_graph` mit fremdem Encoder, Identitäts-Paritätstest.
- **N6:** interne Registries, Job-System, GPU-Scheduler, `CpuBudget`.
- **N7:** Kachel-Schnittstelle der 1:1-Ansicht. **N8:** `Encoder`-Registry, gekachelter Export, Ortsdaten-Schalter. **N9:** Migration 015 (`PresetIn.plugins`, `PresetOut.requiresPlugins`). **N10:** Root-Key, `--safe-mode`, DLL-Ladeflags.
- **N11a/b/c:** je ein eigener Plan nach der Parität.
