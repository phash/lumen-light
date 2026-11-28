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
                "[files]",
                &format!("[files]\n\"plugin.wasm\" = \"{}\"\n#", "0".repeat(64)),
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
    assert_eq!(validate(&m, Origin::Dev), Ok(()));
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

#[test]
fn verwechselbar_auch_als_wortteil() {
    for n in ["MyLumen", "Lumen_Pro", "LUMENfx", "0fficial Denoise"] {
        let mut m = example();
        m.name.en = n.into();
        let e = errs(&m, Origin::Dev);
        assert!(
            e.iter()
                .any(|x| matches!(x, ManifestError::Confusable { .. })),
            "{n}: {e:?}"
        );
    }
}

#[test]
fn beitrag_ohne_recht_und_ausleitung_ueber_beitrag() {
    // cpu-op-Beitrag ohne passendes Recht: fehlendes Recht melden.
    let src = lumen_plugin_manifest::spec_toml_block(common::SPEC, common::FIRST)
        .replace("tier    = \"shader\"", "tier    = \"wasm\"")
        .replace(
            "# S2 (tier = \"wasm\"):    wasm = \"plugin.wasm\"",
            "wasm = \"plugin.wasm\"",
        )
        .replace(
            "\"ui.panel\"      = [\"main\"]",
            "\"ui.panel\" = [\"main\"]\nnet = { hosts = [\"a.example\"] }",
        )
        .replace(
            "[files]",
            &format!("[files]\n\"plugin.wasm\" = \"{}\"\n#", "0".repeat(64)),
        )
        + "\n[[contributes.cpu-op]]\nid = \"bake\"\nslot = \"bake\"\ntitle = { en = \"Bake\" }\n";
    let m = parse_manifest(src.as_bytes()).unwrap();
    let e = errs(&m, Origin::Dev);
    assert!(
        e.iter().any(|x| matches!(
            x,
            ManifestError::MissingCapability {
                cap: "image.process",
                ..
            }
        )),
        "{e:?}"
    );
    assert!(
        e.iter()
            .any(|x| matches!(x, ManifestError::LeakRule { cap, .. } if cap == "net")),
        "{e:?}"
    );
}

#[test]
fn rechte_wert_in_falscher_form() {
    let mut m = example();
    m.capabilities
        .insert("image.process".into(), toml::Value::Boolean(true));
    let e = errs(&m, Origin::Dev);
    assert!(
        e.iter()
            .any(|x| matches!(x, ManifestError::BadCapabilityValue(c) if c == "image.process")),
        "{e:?}"
    );
}

#[test]
fn unsichtbare_zeichen_ueberall() {
    let mut m = example();
    m.capabilities.insert(
        "ui.panel".into(),
        toml::Value::Array(vec![toml::Value::String("ma\u{2060}in".into())]),
    );
    let e = errs(&m, Origin::Dev);
    assert!(
        e.iter().any(|x| matches!(
            x,
            ManifestError::Invisible {
                codepoint: 0x2060,
                ..
            }
        )),
        "{e:?}"
    );
    for cp in [0x00ADu32, 0x061C, 0xFEFF, 0x180E] {
        let mut m = example();
        m.contributes.panel[0].title.en = format!("x{}y", char::from_u32(cp).unwrap());
        let e = errs(&m, Origin::Dev);
        assert!(
            e.iter().any(
                |x| matches!(x, ManifestError::Invisible { codepoint, .. } if *codepoint == cp)
            ),
            "{cp:x}: {e:?}"
        );
    }
}

#[test]
fn untermenue_braucht_ui_menu_und_beitragsart_passt_zur_stufe() {
    let mut m = example();
    m.contributes.command[0].menu = vec![lumen_plugin_manifest::LocalizedStr {
        en: "Tools".into(),
        de: None,
    }];
    let e = errs(&m, Origin::Dev);
    assert!(
        e.iter()
            .any(|x| matches!(x, ManifestError::MissingCapability { cap: "ui.menu", .. })),
        "{e:?}"
    );

    let src = lumen_plugin_manifest::spec_toml_block(common::SPEC, common::FIRST)
        + "\n[[contributes.event]]\nnames = [\"export-done\"]\n";
    let m = parse_manifest(src.as_bytes()).unwrap();
    let e = errs(&m, Origin::Dev);
    assert!(
        e.iter().any(|x| matches!(
            x,
            ManifestError::ContributionNotForTier {
                contribution: "event",
                ..
            }
        )),
        "{e:?}"
    );
    // Tastenkuerzel ist nur ein Vorschlag (standardmaessig aus) und braucht kein Recht.
    assert_eq!(validate(&example(), Origin::Dev), Ok(()));
}

#[test]
fn verwechselbar_mit_grossem_i() {
    for n in [
        "Iumen",
        "IUMEN",
        "\u{0399}umen",
        "OfficiaI Denoise",
        "OffizieII",
    ] {
        let mut m = example();
        m.name.en = n.into();
        let e = errs(&m, Origin::Dev);
        assert!(
            e.iter()
                .any(|x| matches!(x, ManifestError::Confusable { .. })),
            "{n}: {e:?}"
        );
    }
}

#[test]
fn ignorierbare_und_private_zeichen() {
    for cp in [
        0x3164u32, 0x115F, 0xFFA0, 0x034F, 0xFE0F, 0xE0100, 0x2800, 0xE000, 0x17B4, 0xF0000,
    ] {
        let mut m = example();
        m.name.en = format!("Den{}oise", char::from_u32(cp).unwrap());
        let e = errs(&m, Origin::Dev);
        assert!(
            e.iter().any(
                |x| matches!(x, ManifestError::Invisible { codepoint, .. } if *codepoint == cp)
            ),
            "{cp:x}: {e:?}"
        );
    }
}

#[test]
fn halo_und_schleifen_grenzen() {
    use lumen_plugin_manifest::{Number, RadiusRef};
    let mut m = example();
    m.contributes.gpu_chain[0].pass[0].radius_px = Some(RadiusRef::Const(65));
    assert!(
        errs(&m, Origin::Dev)
            .iter()
            .any(|x| matches!(x, ManifestError::LimitExceeded(_)))
    );
    let mut m = example();
    m.params.get_mut("radius").unwrap().max = Some(Number::Int(65));
    assert!(
        errs(&m, Origin::Dev)
            .iter()
            .any(|x| matches!(x, ManifestError::LimitExceeded(_))),
        "Halo-Param > 64"
    );
    let mut m = example();
    m.contributes.gpu_chain[0].pass[0].radius_px = Some(RadiusRef::Const(2));
    m.contributes.gpu_chain[0].pass[1].radius_px = Some(RadiusRef::Const(2));
    m.params.get_mut("radius").unwrap().max = Some(Number::Int(4097));
    assert!(
        errs(&m, Origin::Dev)
            .iter()
            .any(|x| matches!(x, ManifestError::LimitExceeded(_))),
        "loop-bound > 4096"
    );
    let mut m = example();
    m.contributes.gpu_chain[0].pass[0].workgroup_cache_radius = Some(9);
    assert!(
        errs(&m, Origin::Dev)
            .iter()
            .any(|x| matches!(x, ManifestError::LimitExceeded(_)))
    );
}

fn wasm_with(extra: &str) -> lumen_plugin_manifest::Manifest {
    let src = lumen_plugin_manifest::spec_toml_block(common::SPEC, common::FIRST)
        .replace("tier    = \"shader\"", "tier    = \"wasm\"")
        .replace("# S2 (tier = \"wasm\"):    wasm = \"plugin.wasm\"", "wasm = \"plugin.wasm\"")
        .replace("\"ui.panel\"      = [\"main\"]", "\"ui.panel\" = [\"main\"]\n\"raw.decode\" = { magic = [\"49492a00\"] }\nmetadata = { keys = [\"x.foo\"] }")
        .replace("[files]", &format!("[files]\n\"plugin.wasm\" = \"{}\"\n#", "0".repeat(64)))
        + extra;
    parse_manifest(src.as_bytes()).unwrap()
}

#[test]
fn decoder_und_metadaten_grenzen() {
    let ok = wasm_with(
        "\n[[contributes.decoder]]\nmagic = [\"49492a00\"]\nrole = \"fallback\"\npriority = 50\nmodes = [\"half\", \"full\"]\n\n[[contributes.metadata]]\nkeys = [\"x.foo\"]\n",
    );
    assert_eq!(validate(&ok, Origin::Dev), Ok(()));
    for bad in [
        "\n[[contributes.decoder]]\nmagic = [\"zz\"]\nrole = \"fallback\"\n",
        "\n[[contributes.decoder]]\nmagic = [\"00112233445566778899aabbccddeeff00\"]\nrole = \"fallback\"\n",
        "\n[[contributes.decoder]]\nmagic = [\"00\",\"01\",\"02\",\"03\",\"04\",\"05\",\"06\",\"07\",\"08\"]\nrole = \"fallback\"\n",
        "\n[[contributes.decoder]]\nmagic = [\"49492a00\"]\nrole = \"fallback\"\npriority = 101\n",
        "\n[[contributes.decoder]]\nmagic = [\"49492a00\"]\nrole = \"fallback\"\nmodes = [\"turbo\"]\n",
        "\n[[contributes.metadata]]\nkeys = [\"gps.lat\"]\n",
    ] {
        let m = wasm_with(bad);
        assert!(
            errs(&m, Origin::Dev)
                .iter()
                .any(|x| matches!(x, ManifestError::LimitExceeded(_))),
            "{bad}"
        );
    }
}

#[test]
fn files_darf_manifest_und_signatures_nicht_listen() {
    for name in [
        "Lumen-Plugin.toml",
        "lumen-plugin.toml",
        "signatures",
        "SIGNATURES",
    ] {
        let mut m = example();
        m.files.insert(name.into(), "0".repeat(64));
        let e = errs(&m, Origin::Dev);
        assert!(
            e.iter().any(|x| matches!(
                x,
                ManifestError::Path {
                    why: PathRejection::ReservedName,
                    ..
                }
            )),
            "{name}: {e:?}"
        );
    }
}

#[test]
fn nan_und_unendlich_werden_abgelehnt() {
    use lumen_plugin_manifest::Number;
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let mut m = example();
        m.params.get_mut("radius").unwrap().max = Some(Number::Float(bad));
        let e = errs(&m, Origin::Dev);
        assert!(
            e.iter()
                .any(|x| matches!(x, ManifestError::LimitExceeded(_))),
            "radius max {bad}: {e:?}"
        );
        assert!(
            e.contains(&ManifestError::ParamRange("radius".into())),
            "{bad}: {e:?}"
        );
        let mut m = example();
        m.params.get_mut("strength").unwrap().default = Some(
            lumen_plugin_manifest::ParamValue::Number(Number::Float(bad)),
        );
        m.params.get_mut("strength").unwrap().min = None;
        m.params.get_mut("strength").unwrap().max = None;
        assert!(
            errs(&m, Origin::Dev).contains(&ManifestError::ParamRange("strength".into())),
            "default {bad}"
        );
    }
}
