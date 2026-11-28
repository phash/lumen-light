mod common;
use common::{example, uncommented};
use lumen_plugin_manifest::{
    LayoutItem, ManifestError, Origin, PathRejection, check_package_path, check_path_set,
    parse_manifest, validate,
};

fn errs(m: &lumen_plugin_manifest::Manifest, o: Origin) -> Vec<ManifestError> {
    validate(m, o).err().unwrap_or_default()
}

#[test]
fn beispiel_gueltig_im_dev_modus() {
    assert_eq!(validate(&example(), Origin::Dev), Ok(()));
    assert_eq!(
        validate(
            &example(),
            Origin::File {
                builtin_signed: true
            }
        ),
        Ok(())
    );
}

#[test]
fn reserviertes_praefix_bei_unsignierter_datei() {
    let e = errs(
        &example(),
        Origin::File {
            builtin_signed: false,
        },
    );
    assert!(
        e.contains(&ManifestError::ReservedPrefix("mrd".into())),
        "{e:?}"
    );
    let e = errs(
        &example(),
        Origin::Marketplace {
            builtin_signed: false,
        },
    );
    assert!(
        e.contains(&ManifestError::ReservedPrefix("mrd".into())),
        "{e:?}"
    );
}

#[test]
fn auskommentierte_fassung_wird_abgelehnt() {
    let m = parse_manifest(uncommented().as_bytes()).unwrap();
    let e = errs(&m, Origin::Dev);
    assert!(e.contains(&ManifestError::TierArtifactMismatch), "{e:?}");
    let mut n = m.clone();
    n.tier = lumen_plugin_manifest::Tier::Native;
    let e = errs(&n, Origin::Dev);
    assert!(
        e.iter()
            .any(|x| matches!(x, ManifestError::LeakRule { cap, .. } if cap == "net")),
        "{e:?}"
    );
}

#[test]
fn pfade_werden_abgelehnt() {
    use PathRejection::*;
    assert_eq!(check_package_path("/abs"), Err(Absolute));
    assert_eq!(check_package_path("a/../b"), Err(DotSegment));
    assert_eq!(check_package_path("a//b"), Err(DotSegment));
    assert_eq!(check_package_path("a/./b"), Err(DotSegment));
    assert_eq!(check_package_path("-x"), Err(LeadingDash));
    assert_eq!(check_package_path("x.dll."), Err(TrailingDotOrSpace));
    assert_eq!(check_package_path("x "), Err(BadChar(' ')));
    assert_eq!(
        check_package_path("shaders/NUL.wgsl"),
        Err(DeviceName("NUL.wgsl".into()))
    );
    assert_eq!(check_package_path("COM1"), Err(DeviceName("COM1".into())));
    assert_eq!(
        check_package_path("lpt9.txt"),
        Err(DeviceName("lpt9.txt".into()))
    );
    assert_eq!(check_package_path("ä.wgsl"), Err(BadChar('ä')));
    assert_eq!(check_package_path("a/b/c/d/e"), Err(TooDeep));
    assert_eq!(check_package_path(&"a".repeat(129)), Err(TooLong));
    assert_eq!(check_package_path("shaders/denoise_h.wgsl"), Ok(()));
    assert_eq!(
        check_path_set(["a.wgsl", "A.wgsl"]),
        Err(CaseDuplicate("a.wgsl".into(), "A.wgsl".into()))
    );
    let many: Vec<String> = (0..65).map(|i| format!("f{i}")).collect();
    assert_eq!(
        check_path_set(many.iter().map(String::as_str)),
        Err(TooMany)
    );
}

#[test]
fn unsichtbare_zeichen() {
    for cp in [0x200Bu32, 0x202E, 0x2066, 0xE0041] {
        let mut m = example();
        m.name.en = format!("Den{}oise", char::from_u32(cp).unwrap());
        let e = errs(&m, Origin::Dev);
        assert!(
            e.contains(&ManifestError::Invisible {
                field: "name",
                codepoint: cp
            }),
            "{cp:x}: {e:?}"
        );
    }
}

#[test]
fn verwechselbarer_name() {
    let mut m = example();
    m.name.en = "Lum\u{0435}n".into();
    let e = errs(&m, Origin::Dev);
    assert!(
        e.contains(&ManifestError::Confusable {
            field: "name",
            with: "Lumen"
        }),
        "{e:?}"
    );
}

#[test]
fn befehls_id_ohne_praefix() {
    let mut m = example();
    m.contributes.command[0].id = "reset".into();
    let e = errs(&m, Origin::Dev);
    assert!(
        e.contains(&ManifestError::CommandPrefix("reset".into())),
        "{e:?}"
    );
}

#[test]
fn param_grenzen() {
    use lumen_plugin_manifest::{Number, ParamValue};
    let mut m = example();
    m.params.get_mut("strength").unwrap().min = Some(Number::Float(200.0));
    assert!(errs(&m, Origin::Dev).contains(&ManifestError::ParamRange("strength".into())));

    let mut m = example();
    m.params.get_mut("radius").unwrap().default = Some(ParamValue::Number(Number::Int(99)));
    assert!(errs(&m, Origin::Dev).contains(&ManifestError::ParamRange("radius".into())));

    let mut m = example();
    let mut p = m.params.remove("chroma-only").unwrap();
    p.kind = lumen_plugin_manifest::ParamKind::Curve;
    p.default = None;
    p.points_max = Some(17);
    m.params.insert("chroma-only".into(), p);
    assert!(errs(&m, Origin::Dev).contains(&ManifestError::ParamRange("chroma-only".into())));

    let mut m = example();
    let p = m.params.remove("chroma-only").unwrap();
    m.params.insert("chromaOnly".into(), p);
    if let LayoutItem::Section(s) = &mut m.contributes.panel[0].layout[2] {
        s.items = vec!["chromaOnly".into()];
    }
    assert!(errs(&m, Origin::Dev).contains(&ManifestError::InvalidParamId("chromaOnly".into())));
}

#[test]
fn shader_nicht_in_files() {
    let mut m = example();
    m.contributes.gpu_chain[0].pass[0].shader = "shaders/x.wgsl".into();
    let e = errs(&m, Origin::Dev);
    assert!(
        e.contains(&ManifestError::ShaderNotListed("shaders/x.wgsl".into())),
        "{e:?}"
    );
}

#[test]
fn ausleitung_wasm() {
    let wasm = |caps: &str| {
        let src = lumen_plugin_manifest::spec_toml_block(common::SPEC, common::FIRST)
            .replace("tier    = \"shader\"", "tier    = \"wasm\"")
            .replace(
                "# S2 (tier = \"wasm\"):    wasm = \"plugin.wasm\"",
                "wasm = \"plugin.wasm\"",
            )
            .replace(
                "\"ui.panel\"      = [\"main\"]",
                &format!("\"ui.panel\" = [\"main\"]\n{caps}"),
            )
            .replace(
                "[files]\n",
                &format!("[files]\n\"plugin.wasm\" = \"{}\"\n", "0".repeat(64)),
            );
        parse_manifest(src.as_bytes()).unwrap()
    };
    let m = wasm("\"raw.decode\" = { magic = [\"49492a00\"] }\nnet = { hosts = [\"a.example\"] }");
    let e = errs(&m, Origin::Dev);
    assert!(
        e.iter()
            .any(|x| matches!(x, ManifestError::LeakRule { cap, .. } if cap == "net")),
        "{e:?}"
    );
    let m = wasm("net = { hosts = [\"a.example\"] }");
    let e = errs(&m, Origin::Dev);
    assert!(
        !e.iter()
            .any(|x| matches!(x, ManifestError::LeakRule { .. })),
        "{e:?}"
    );
}

#[test]
fn ungueltige_plugin_id_und_unbekanntes_recht() {
    let mut m = example();
    m.id = "Mrd.Denoise".into();
    assert!(errs(&m, Origin::Dev).contains(&ManifestError::InvalidPluginId("Mrd.Denoise".into())));
    let mut m = example();
    m.capabilities
        .insert("process.exec".into(), toml::Value::Boolean(true));
    m.capabilities
        .insert("telepathy".into(), toml::Value::Boolean(true));
    let e = errs(&m, Origin::Dev);
    assert!(e.iter().any(|x| matches!(x, ManifestError::CapabilityNotForTier { cap, .. } if cap == "process.exec")), "{e:?}");
    assert!(
        e.contains(&ManifestError::UnknownCapability("telepathy".into())),
        "{e:?}"
    );
}
