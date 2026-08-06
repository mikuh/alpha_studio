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
- GPT device authorization for subscription models; desktop builds bundle the pinned official Codex CLI automatically
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

Desktop builds stage the platform-specific Codex CLI from the locked
`@openai/codex` dependency and include its complete native runtime in the
installer. End users do not need Node.js, npm, Homebrew, or a separate Codex
installation. Alpha Studio prefers this bundled runtime and falls back to a
working system installation only if the bundled copy is unavailable.

### Windows MSI

On a Windows 10/11 build machine, install Node.js LTS, Rust with the default
MSVC toolchain, and Visual Studio Build Tools with the C++ workload. Then
double-click [`build-windows-msi.cmd`](./build-windows-msi.cmd). The script
installs the locked dependencies, builds only the MSI bundle, copies it to
`artifacts/releases/windows/`, prints its SHA-256 checksum, and opens the output
folder.

The equivalent terminal command is:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-windows-msi.ps1
```

Use `-SkipInstall` to reuse the current `node_modules`; it must already contain
the matching platform package for the pinned Codex version. The first build
needs network access for npm, Cargo, and Tauri's WiX tooling. The generated MSI
is unsigned unless Windows code-signing settings are configured separately.

Useful checks:

```bash
npm run test:run
npm run build:desktop
cargo test --manifest-path src-tauri/Cargo.toml
```

## Backend Deployment

The commercial backend can run as a single-machine Docker Compose stack with
Rust API/model gateway, Postgres, Redis, the internal admin web app, and Caddy:

```bash
cp .env.example .env
docker compose build
docker compose up -d postgres redis
docker compose run --rm api alpha-studio-backend migrate
docker compose up -d
```

Health checks:

```bash
curl http://localhost/healthz
curl http://localhost/readyz
open http://localhost/admin/
```

Keep deployment secrets such as `JWT_SECRET`, `RUN_TOKEN_SECRET`,
`AUTHORIZATION_CODE_ENCRYPTION_KEY`, `ADMIN_PASSWORD`, and `ADMIN_TOTP_SECRET`
outside source control. `.env` is intentionally ignored by git. Generate the
Base32 TOTP secret with a cryptographically secure generator, enroll it in the
administrator's authenticator, and enter the current six-digit code on every
admin login. Five failed login attempts within 15 minutes lock the account for
15 minutes; successful admin JWTs expire after two hours.

Upstream model provider keys are configured inside `/admin`. They are encrypted
with AES-256-GCM using a dedicated deployment KMS master key before being stored
in PostgreSQL; legacy plaintext rows are migrated and cleared automatically at
backend startup. Development may set `PROVIDER_KMS_MASTER_KEY` directly. With
`APP_ENV=production`, the backend requires `PROVIDER_KMS_MASTER_KEY_FILE` so the
key can be mounted from the production KMS/secret manager instead of living in
the environment or database.
`MIN_GATEWAY_MARKUP_BPS` defaults to `500` (5%) and blocks enabled pay-as-you-go
routes whose markup is below that deployment-level safety floor.

The backend fails closed when those secrets are missing, weak, still use the
example placeholders, or when the JWT and run-token secrets are identical.
Protected client routes require the signed device Bearer token returned by
activation; admin routes require an expiring signed admin JWT; model gateway
routes require a 48-hour, task-scoped, model-bound run token. The token supports
the multiple sequential Responses calls required by agent tool loops while each
call is metered independently against one cumulative task budget. Existing
desktop activation sessions created before this authentication hardening must
be activated once again to receive a device token.
Browser cross-origin access is restricted to the explicit
`CORS_ALLOWED_ORIGINS` list; wildcard origins are rejected at startup and a
request carrying an unlisted `Origin` is rejected before route handling. In
production the API base URL must use HTTPS, loopback development origins are
rejected, and the CORS list must be supplied explicitly.

On desktop, JQData passwords and custom model API keys are stored in the native
OS credential vault (macOS Keychain, Windows Credential Manager, or Linux Secret
Service). Existing plaintext JSON values are moved on first load and then
removed from the local configuration file. The Tauri webview uses an explicit
CSP, has no asset-protocol filesystem scope, and opens/reveals files only
through the validated Rust commands.

The admin app now covers the commercial operating loop:

- create and update customer tenants, subscription dates, and machine limits; balances change only through immutable usage and offline-receipt ledger records
- generate customer authorization codes for first-device activation by company name
- configure provider presets, upstream protocols/auth, discover models, and manage aliases, prices, and markup
- assign GPT subscription accounts to customers for monthly or yearly subscription access
- inspect audit logs and usage-ledger totals
- upload, publish, and roll back authenticated Skill release bundles

See [Multi-model gateway setup](./docs/model-gateway.md) for OpenAI Responses,
Chat Completions, Anthropic Messages, Gemini, Azure, Ollama, and other
OpenAI-compatible provider configuration.

See [Managed Skill releases](./docs/managed-skills.md) for the protected build,
admin publishing, client synchronization, offline fallback, and rollback flow.

Customer and operator references:

- [Customer guide](./docs/customer-guide.md)
- [Release checklist](./docs/operations/release-checklist.md)
- [Database backup and restore](./docs/operations/database-backup-and-restore.md)
- [Monitoring and incident response](./docs/operations/monitoring-and-incidents.md)

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
