//! Test-Helfer: Pfade zu den RAW-Fixtures im Repo.

use std::path::PathBuf;

/// Pfad relativ zur Repo-Wurzel (drei Ebenen ueber diesem Crate).
pub fn repo_path(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(rel)
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
