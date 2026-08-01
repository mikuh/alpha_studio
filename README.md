# Alpha Studio

Alpha Studio is a source-available, noncommercial local GPT workspace in a desktop-style UI.

This public edition keeps the core product general-purpose: chats, projects, local work directories, GPT event streaming, archive-first history management, settings, and Git workflows. Vertical domain packs are intentionally separated so commercial editions can extend the same shell without changing the public core.

## License

This repository is licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE.md).

You may use, study, modify, and redistribute this software for noncommercial purposes under that license. Commercial use requires a separate commercial license from the licensor.

This is a source-available noncommercial project, not an OSI-approved open source project.

## Requirements

- Node.js and npm
- Rust toolchain for Tauri development
- GPT engine installed; authorize it from Alpha Studio with the GPT device authorization button
- Git for repository features

## Development

```bash
npm install
npm run dev
npm run tauri:dev
```

To run the development client against the production service configured in
`.env.production`:

```bash
npm run tauri:dev:prod
```

Production frontend builds, including the macOS DMG, load `.env.production`:

```bash
npm run tauri:build:dmg
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
- configure provider presets, upstream protocols/auth, discover models, and manage aliases, prices, and markup
- assign GPT subscription accounts to customers for monthly or yearly subscription access
- inspect audit logs and usage-ledger totals

See [Multi-model gateway setup](./docs/model-gateway.md) for OpenAI Responses,
Chat Completions, Anthropic Messages, Gemini, Azure, Ollama, and other
OpenAI-compatible provider configuration.

### Cloud market data

The securities console never calls a public market-data website from the
client. The Rust API owns the complete data path:

1. poll Eastmoney as the primary A-share stock and exchange-listed ETF snapshot source;
2. fail over to Tencent when the primary source is empty or unavailable;
3. normalize both providers into the same `MarketSnapshot` / `MarketQuote`
   schema and preserve the provider name on every quote;
4. keep the latest snapshot in memory and Redis;
5. serve an authenticated snapshot at `GET /api/market/snapshot` and broadcast
   updates as SSE `snapshot` events from `GET /api/market/stream`.

Both routes validate the activated tenant, device, and device fingerprint.
The frontend uses the snapshot for first paint and the SSE stream for later
updates. Configure the feed in `.env`:

```bash
MARKET_DATA_ENABLED=true
MARKET_REFRESH_SECONDS=45
MARKET_SNAPSHOT_LIMIT=8000
```

Eastmoney and Tencent are public web data sources, not contractual licensed
redistribution feeds. Before exposing this service to production customers,
obtain the required display/redistribution authorization or replace the
provider adapters with licensed feeds. `MARKET_DATA_ENABLED=false` disables
both cloud endpoints without changing the client contract.

## Product Shape

- GPT chat UI with local event streaming
- Project-bound working directories
- Archive-first conversations and projects
- Git status, diff, stage, unstage, commit, branch, pull, and push
- Settings sections for personal, integrations, coding, and archived content
- Light-first visual design for the GPT workspace

## Extension Model

The public edition ships with the `core-coding` domain in [`src/domain.ts`](./src/domain.ts). Commercial vertical editions can provide private domain packages that extend:

- prompt packs
- navigation entries
- settings sections
- right-side panels
- domain-specific commands or data sources

The public core should stay domain-neutral and avoid embedding vertical commercial logic.

## Notice

Alpha Studio uses its own brand, text, icons, and assets. The UI is a GPT workspace implementation and does not expose underlying engine branding to customers.
