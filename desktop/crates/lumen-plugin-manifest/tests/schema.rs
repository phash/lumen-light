use std::path::PathBuf;

fn schema_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../schemas/lumen-plugin.schema.json")
}

fn rendered() -> String {
    serde_json::to_string_pretty(&lumen_plugin_manifest::json_schema()).unwrap() + "\n"
}

#[test]
fn schema_ist_aktuell() {
    let p = schema_path();
    if std::env::var_os("LUMEN_BLESS").is_some() {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, rendered()).unwrap();
        return;
    }
    let on_disk = std::fs::read_to_string(&p)
        .expect("schemas/lumen-plugin.schema.json fehlt (LUMEN_BLESS=1)");
    assert_eq!(
        on_disk,
        rendered(),
        "Schema veraltet: LUMEN_BLESS=1 cargo test -p lumen-plugin-manifest --test schema"
    );
}

#[test]
fn schema_kennt_alle_felder() {
    let s = lumen_plugin_manifest::json_schema();
    assert_eq!(s["additionalProperties"], serde_json::json!(false));
    assert!(s["properties"]["capabilities"].is_object());
    assert!(s["properties"]["edit-state"].is_object());
}
