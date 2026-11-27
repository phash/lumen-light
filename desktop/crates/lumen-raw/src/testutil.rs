//! Test-Helfer: Pfade zu den RAW-Fixtures im Repo.

use std::path::PathBuf;

/// Pfad relativ zur Repo-Wurzel (drei Ebenen ueber diesem Crate).
/// Per `LUMEN_REPO_ROOT` ueberschreibbar (Testbinary auf einem anderen Rechner).
pub fn repo_path(rel: &str) -> PathBuf {
    let root = match std::env::var_os("LUMEN_REPO_ROOT") {
        Some(p) => PathBuf::from(p),
        None => PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../.."),
    };
    root.join(rel)
}

/// RAW-Fixture aus `tests-fixtures/raw-samples/`; `None` mit SKIP-Meldung, wenn sie fehlt.
pub fn fixture(name: &str) -> Option<PathBuf> {
    let path = repo_path("tests-fixtures/raw-samples").join(name);
    if path.is_file() {
        Some(path)
    } else {
        eprintln!(
            "SKIP {name}: Fixture fehlt unter {} (scripts/fetch-test-images.sh)",
            path.display()
        );
        None
    }
}

/// `LUMEN_REQUIRE_FIXTURES=1` (CI): fehlende Fixtures sind ein Fehler statt SKIP.
pub fn require_fixtures() -> bool {
    std::env::var_os("LUMEN_REQUIRE_FIXTURES").is_some_and(|v| !v.is_empty() && v != "0")
}
