.PHONY: ci deny

ci:
	cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && $(MAKE) deny

deny:
	cargo deny check licenses bans
