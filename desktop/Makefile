.PHONY: ci

ci:
	cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
