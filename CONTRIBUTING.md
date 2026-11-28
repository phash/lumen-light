# Mitmachen bei Lumen

## Lizenz deiner Beiträge

- Beiträge zur App stehen unter **AGPL-3.0-or-later mit der Lumen-Plugin-Ausnahme**
  (`LICENSES/AdditionRef-Lumen-Plugin-Exception.txt`). Mit deinem Beitrag erteilst du
  diese Ausnahme auch für deinen Code.
- Die Plugin-Schnittstelle (`desktop/crates/lumen-plugin-abi`, `-api`, `-sdk`,
  `-manifest`) steht unter **MIT OR Apache-2.0**, damit Plugins jede Lizenz wählen können.

## Developer Certificate of Origin (DCO 1.1)

Jeder Commit braucht eine `Signed-off-by`-Zeile (`git commit -s`). Damit bestätigst du
das [Developer Certificate of Origin 1.1](https://developercertificate.org/): Du hast das
Recht, den Beitrag unter der Lizenz des Projekts einzureichen.

## Bauen und testen

Siehe `README.md`. Vor einem Pull Request muss `make -C desktop ci` grün sein
(fmt, clippy `-D warnings`, Tests, Lizenzprüfung). Die Lizenzprüfung braucht
`cargo install --locked cargo-deny@0.22.2`. Commit-Stil: Conventional Commits
(`feat(…)`, `fix(…)`, `docs(…)`, `chore(…)`).

## Plugins

Plugins entstehen außerhalb dieses Repos. Die Schnittstelle beschreibt
`docs/superpowers/specs/2026-11-28-plugin-system-design.md`.
