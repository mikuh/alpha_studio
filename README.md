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

## Backend Deployment

The commercial backend can run as a single-machine Docker Compose stack with
Rust API/model gateway, Postgres, Redis, the internal admin web app, and Caddy:

```bash
cp .env.example .env
docker compose build
docker compose up -d postgres redis
docker compose run --rm api migrate
docker compose up -d
```

Health checks:

```bash
curl http://localhost/healthz
curl http://localhost/readyz
open http://localhost/admin/
```

Keep deployment secrets such as `JWT_SECRET`, `RUN_TOKEN_SECRET`, and
`ADMIN_PASSWORD` in `.env` on the server; `.env` is intentionally ignored by
git. Upstream model provider keys are configured inside `/admin` under the
model gateway section, not through environment variables.

The admin app now covers the commercial operating loop:

- create and update customer tenants, balances, subscription dates, and machine limits
- generate customer authorization codes for first-device activation by company name
- configure upstream provider keys, model aliases, endpoint paths, prices, and markup
- assign Codex subscription accounts to customers for monthly or yearly subscription access
- inspect audit logs and usage-ledger totals

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
