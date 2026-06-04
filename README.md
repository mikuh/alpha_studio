# Alpha Studio

Alpha Studio is a source-available, noncommercial local coding workspace that wraps the OpenAI Codex CLI in a desktop-style UI.

This public edition keeps the core product general-purpose: chats, projects, local work directories, Codex event streaming, archive-first history management, settings, and Git workflows. Vertical domain packs are intentionally separated so commercial editions can extend the same shell without changing the public core.

## License

This repository is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE.md).

You may use, study, modify, and redistribute this software for noncommercial purposes under that license. Commercial use requires a separate commercial license from the licensor.

This is a source-available noncommercial project, not an OSI-approved open source project.

## Requirements

- Node.js and npm
- Rust toolchain for Tauri development
- OpenAI Codex CLI installed and logged in locally
- Git for repository features

## Development

```bash
npm install
npm run dev
npm run tauri:dev
```

Useful checks:

```bash
npm run test:run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

## Product Shape

- Codex-style chat UI with local CLI event streaming
- Project-bound working directories
- Archive-first conversations and projects
- Git status, diff, stage, unstage, commit, branch, pull, and push
- Settings sections for personal, integrations, coding, and archived content
- Light-first visual design inspired by Codex settings screenshots

## Extension Model

The public edition ships with the `core-coding` domain in [`src/domain.ts`](./src/domain.ts). Commercial vertical editions can provide private domain packages that extend:

- prompt packs
- navigation entries
- settings sections
- right-side panels
- domain-specific commands or data sources

The public core should stay domain-neutral and avoid embedding vertical commercial logic.

## Notice

Alpha Studio uses its own brand, text, icons, and assets. The UI is a Codex-style reference implementation intended to feel familiar to Codex users, but it does not copy Codex trademarks, logos, or proprietary assets.
