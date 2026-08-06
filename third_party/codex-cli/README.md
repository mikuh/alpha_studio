# Codex CLI

Alpha Studio redistributes the unmodified, platform-specific Codex CLI runtime
published by OpenAI in the locked `@openai/codex` npm dependency. The desktop
build validates the package version and native entrypoint before copying the
complete runtime layout into the installer.

Codex CLI source: <https://github.com/openai/codex>

License: Apache License 2.0. The complete license text is stored in `LICENSE`
and copied into every generated desktop package as
`LICENSE-CODEX-CLI.txt`.
