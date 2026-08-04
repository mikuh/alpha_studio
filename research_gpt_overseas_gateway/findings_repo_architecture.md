# Alpha Studio repository findings: overseas GPT gateway

## Executive finding

Technically, yes. For API-backed GPT models, Alpha Studio already has almost the exact topology needed: the desktop asks the Alpha backend for a short-lived run token, starts Codex with the Alpha backend as a custom Responses provider, and the Rust backend calls OpenAI with a server-held API key. If that backend is deployed in an overseas region reachable by the customer, end users do not need a device VPN for those model calls.

The important exception is the product's built-in GPT subscription path. Built-in `openai` profiles still start the local Codex app-server with its normal OpenAI/ChatGPT login and no custom base URL, so chat, model-catalog, rate-limit, and login-related network activity originates on the user's machine. The existing Alpha gateway does **not** relay those subscription credentials or requests. A central reverse proxy for ChatGPT subscription traffic would be a materially different and much riskier design. The clean product architecture is therefore:

1. make the existing Alpha API gateway the default/no-VPN path for GPT API models;
2. keep GPT subscription models as a separately labeled local-login path, or omit them from the domestic no-VPN edition;
3. only if subscription support is mandatory, evaluate a TLS-preserving, authenticated forward proxy with per-device short-lived credentials, knowing that browser login is still a gap and product/policy eligibility must be assessed separately.

Before exposing the backend as a public overseas gateway, several current security issues are release blockers—most notably forgeable admin tokens, plaintext upstream keys, permissive provider URLs/SSRF potential, and weak client device authentication.

## Current client/server boundaries and request paths

### 1. Built-in GPT subscription path: still direct from the desktop

The built-in profiles are `providerId: 'openai'` and intentionally have no configurable base URL or API key (`/Users/geb/codes/alpha_studio/src/models.ts:38-45`). The main chat flow resolves the selected profile and calls `startCodexChat`, passing the result of `codexModelRequest` (`/Users/geb/codes/alpha_studio/src/store.ts:528-555`). For a normal built-in profile, `codexModelRequest` simply returns the model, provider ID, and any local profile fields; it does not contact the Alpha gateway (`/Users/geb/codes/alpha_studio/src/store.ts:1967-1988`).

The TypeScript/Tauri boundary is a Tauri command: `startCodexChat` invokes `codex_chat_start` and can carry a provider base URL/key only when a custom provider is selected (`/Users/geb/codes/alpha_studio/src/codexBridge.ts:26-42`, `/Users/geb/codes/alpha_studio/src/codexBridge.ts:127-129`). In Rust, `sanitize_model_provider` returns `None` whenever `provider_id == "openai"` (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:4110-4122`). `codex_chat_start` consequently launches local `codex app-server` without a custom model provider; the child only gets `TERM`, `NO_COLOR`, and `CODEX_HOME` explicitly, with no proxy configuration (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:987-1054`). The child inherits the desktop process environment, but a GUI-launched macOS app normally cannot rely on shell proxy variables being present.

Live UI streaming comes from local JSON-RPC stdio notifications. The code explicitly chooses `codex app-server` because it emits `item/agentMessage/delta` incrementally (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:1027-1032`), then forwards events to the Tauri frontend (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:1150-1176`). Thus this streaming leg is local process IPC; the OpenAI network leg remains owned by the local Codex process.

Other subscription-related paths also start local Codex without a custom provider or proxy:

- subscription usage uses `account/rateLimits/read` through another `codex app-server` child (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:5484-5550`);
- model discovery starts the same default app-server and calls the model catalog protocol (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:5565-5609`);
- login opens `codex login` in Terminal on macOS (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:6425-6455`), so even setting a proxy only on chat children would not cover login;
- account status is read from the private Codex home and `auth.json` is parsed locally for the email (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:6476-6504`). The private home is `~/.alpha-studio/codex-home` (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:5651-5673`).

The backend's “GPT account” feature does not change this network boundary. It authorizes a locally signed-in account by matching the locally decoded email to an assigned database record (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:403-465`). Although `codex_accounts.login_secret` exists and is saved in plaintext (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:1551-1617`), no runtime path uses it to authenticate upstream GPT requests. Actual ChatGPT/Codex tokens stay in the desktop's private `auth.json`.

### 2. Alpha gateway API path: already server-relayed

Activated customers receive model routes from the backend. The frontend maps enabled `gateway_api` models to provider `alpha-gateway` (`/Users/geb/codes/alpha_studio/src/license.ts:362-385`). For each agent run, it calls `/api/runs/create`, then uses the returned signed run token as the custom provider API key and `${session.apiBaseUrl}/v1` as the provider base URL (`/Users/geb/codes/alpha_studio/src/license.ts:325-345`). Production builds point the client at `https://api.yuanliu.ai` (`/Users/geb/codes/alpha_studio/.env.production:1-2`).

`codexModelRequest` detects `alpha-gateway`, obtains that run token, and passes the provider settings into Tauri (`/Users/geb/codes/alpha_studio/src/store.ts:1967-1978`). Rust validates the custom provider, sets Codex `model_provider`, `base_url`, `env_key`, and `wire_api = "responses"` arguments, and passes the run token through a child-only environment variable (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:4110-4175`, `/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:4178-4237`). This is the desired customer-to-Alpha-to-OpenAI path.

On the server, Axum exposes `/api/runs/create`, `/v1/responses`, and `/v1/models` (`/Users/geb/codes/alpha_studio/backend/src/app.rs:35-38`, `/Users/geb/codes/alpha_studio/backend/src/app.rs:90-91`). Run creation verifies an active device lease, model availability, and prepaid balance, creates `model_runs`, and issues a 20-minute signed token bound to tenant/user/device/run/model (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:608-654`; claims are defined in `/Users/geb/codes/alpha_studio/backend/src/tokens.rs:10-43`).

`POST /v1/responses` verifies that bearer token, ignores any client attempt to choose a different route by loading the route from `claims.model_id`, loads the server-side provider configuration, and sends the request upstream (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:1812-1837`). Provider routing supports Responses, Chat Completions, Anthropic Messages, and Gemini, several auth forms, custom headers/query parameters, timeout, retry, and model aliasing (`/Users/geb/codes/alpha_studio/backend/src/gateway.rs:22-145`, `/Users/geb/codes/alpha_studio/backend/src/gateway.rs:217-279`). Upstream auth is constructed from the server-side provider key (`/Users/geb/codes/alpha_studio/backend/src/gateway.rs:620-655`).

Therefore, simply deploying this API/backend in an overseas region and making gateway models the default gives the requested no-device-VPN topology for OpenAI API traffic. It does not require tunneling the whole desktop or changing Codex itself.

### 3. Custom direct-provider path: also still originates on the desktop

Non-built-in model profiles can contain a provider base URL and API key (`/Users/geb/codes/alpha_studio/src/models.ts:17-31`). They are persisted to `~/.alpha-studio/model-providers.json` by a plain JSON write (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:825-846`, path at `/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:3901-3906`).

Responses-compatible custom providers are called by the local Codex child directly. Chat-Completions providers are converted by a loopback Tauri adapter; that adapter creates a local `reqwest::Client`, calls the configured upstream URL from the user's machine, forwards/binds the API key, buffers the complete response, and synthesizes Responses SSE (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:4256-4301`, `/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:4325-4424`). These profiles must either remain an explicitly unsupported/advanced direct mode or be moved behind the Alpha gateway if “all GPT traffic” is a hard guarantee.

## Existing gateway streaming behavior

The server gateway is protocol-compatible but not truly streaming. It records whether the Codex request asked for streaming, then forces the upstream Responses request to `stream: false`; Chat Completions is also always built with `stream: false` (`/Users/geb/codes/alpha_studio/backend/src/gateway.rs:217-248`, `/Users/geb/codes/alpha_studio/backend/src/gateway.rs:670-705`). The route waits for `upstream.text().await`, parses the complete JSON body, settles billing, then emits an in-memory SSE string (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:1831-1877`). `responses_body_to_sse` generates `response.created`, output/tool events, `response.completed`, and `[DONE]` only after the complete response exists (`/Users/geb/codes/alpha_studio/backend/src/gateway.rs:422-528`). The repository documentation states this boundary explicitly (`/Users/geb/codes/alpha_studio/docs/model-gateway.md:112-117`).

This works functionally but gives no upstream time-to-first-token, increases end-to-end timeout risk, buffers large responses twice, and makes cancellation less useful. A production overseas hop should implement real upstream SSE passthrough/transformation before being presented as a high-quality chat experience.

## Auth and secret handling: current strengths and blockers

### Useful existing pieces

- Run tokens are signed JWTs with expiry and are bound to a single model and run (`/Users/geb/codes/alpha_studio/backend/src/tokens.rs:10-66`).
- `/v1/models` only returns the token-bound model (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:1788-1810`).
- Provider keys are not returned in full by the admin listing; only configured state and a mask are returned (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:1090-1150`).
- Gateway audit/usage storage records identifiers, token counts, price, status, and latency rather than request/response bodies (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:2292-2351`). No prompt-body logging was found in the gateway path.

### Public-release blockers

1. **Admin authentication is forgeable.** Login checks the configured email/password and returns a random string prefixed `admin-` (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:229-245`), but every admin route accepts *any* bearer token whose text starts with `admin-` (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:2753-2760`). The configured `JWT_SECRET` is not used for admin sessions. Caddy publicly proxies `/admin*` and `/api/*` (`/Users/geb/codes/alpha_studio/deploy/caddy/Caddyfile:14-18`, `/Users/geb/codes/alpha_studio/deploy/caddy/Caddyfile:32-34`). This must be replaced with verified, expiring sessions/JWTs and preferably an admin network/access boundary before internet exposure.

2. **Provider keys and recorded GPT login secrets are plaintext at rest.** `provider_configs.api_key` and `codex_accounts.login_secret` are plain `text` columns (`/Users/geb/codes/alpha_studio/migrations/0002_admin_gateway_authorization.sql:17-24`, `/Users/geb/codes/alpha_studio/migrations/0002_admin_gateway_authorization.sql:47-58`), and save routes bind plaintext directly (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:1180-1231`, `/Users/geb/codes/alpha_studio/backend/src/routes.rs:1586-1617`). Use a cloud secret manager/envelope encryption and remove `login_secret` if it has no runtime need. Local direct-provider keys are likewise plaintext JSON.

3. **SSRF/egress control is insufficient for a public gateway.** Provider `baseUrl` only has to start with `http://` or `https://` (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:2840-2845`). Model discovery and gateway calls then make server-side requests to that URL. Combined with forgeable admin auth, an attacker could configure/probe internal endpoints. Production needs a provider-domain allowlist or DNS/IP validation that rejects loopback, private, link-local, metadata, and DNS-rebinding targets, plus outbound firewall rules.

4. **Client activation IDs act as weak bearer credentials.** `createGatewayRun` sends tenant/user/device IDs with no Authorization header (`/Users/geb/codes/alpha_studio/src/license.ts:325-337`). The server checks only tenant/device lease and does not validate a signed device session, fingerprint, or that the submitted user belongs to the tenant/device (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:619-649`, `/Users/geb/codes/alpha_studio/backend/src/routes.rs:2241-2259`). Device IDs are high-entropy UUIDs, but production should still issue a revocable device access token and validate the full tenant/user/device relationship.

5. **Run tokens can be replayed for their 20-minute lifetime.** `/v1/responses` verifies claims but does not require an allowed run status, enforce a request count, or atomically reserve budget before calling upstream (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:1812-1829`). Agent tool loops legitimately need multiple Responses calls, so the fix is not necessarily single-use; it should be per-run concurrency/rate control and cumulative budget enforcement. Current settlement subtracts only after a completed response (`/Users/geb/codes/alpha_studio/backend/src/routes.rs:2292-2351`).

6. **No visible gateway rate limiting or body-level quotas.** The router has permissive CORS, compression, and tracing but no rate-limit layer (`/Users/geb/codes/alpha_studio/backend/src/app.rs:90-95`). Caddy caps request bodies at 25 MB (`/Users/geb/codes/alpha_studio/deploy/caddy/Caddyfile:10-12`), but production still needs per-device/run/tenant request and concurrency limits.

7. **Caddy does not route `/v1/models`.** Axum exposes it, and the docs promise it, but Caddy only proxies the exact `/v1/responses` path (`/Users/geb/codes/alpha_studio/deploy/caddy/Caddyfile:20-22`). Proxy `/v1/*` or add `/v1/models` before relying on the remote public contract.

## Egress/proxy implementation fit

The backend currently has one shared `reqwest::Client` in `AppState` (`/Users/geb/codes/alpha_studio/backend/src/state.rs:12-37`). It is used both for model gateway/model discovery and cloud market feeds (`/Users/geb/codes/alpha_studio/backend/src/state.rs:40-53`, `/Users/geb/codes/alpha_studio/backend/src/routes.rs:1289-1295`, `/Users/geb/codes/alpha_studio/backend/src/routes.rs:1831-1833`). Docker Compose only supplies `NO_PROXY/no_proxy`; there is no explicit GPT upstream proxy configuration (`/Users/geb/codes/alpha_studio/docker-compose.yml:30-53`).

If the Rust backend itself runs overseas, no extra egress proxy is needed: it already is the overseas gateway. If the backend must remain elsewhere and use a separate overseas outbound proxy, do **not** solve this with a global `HTTPS_PROXY` alone because that can affect market data and other shared-client traffic. Add a dedicated `gateway_http` client to `AppState`, build it from a server-only `GPT_UPSTREAM_PROXY_URL`/secret, and use it only in `admin_discover_provider_models`, `gateway_responses`, and their upstream send helpers. Keep market HTTP separate. Proxy credentials must never be returned to the desktop.

An explicit backend client also provides a natural place for connect/read timeout policy, egress allowlists, certificate policy, connection pooling, proxy health telemetry, and a circuit breaker. Do not implement TLS interception: the gateway already terminates the application request by design and talks HTTPS to OpenAI; an additional egress proxy should use normal CONNECT/TLS semantics.

## Recommended target architectures

### Recommended default: overseas Alpha API gateway

```text
Alpha Studio desktop
  -> HTTPS api.yuanliu.ai: /api/runs/create
  -> HTTPS api.yuanliu.ai: /v1/responses (short-lived run bearer)
       -> overseas Rust gateway
       -> HTTPS api.openai.com/v1/responses (server-held API key)
```

This aligns with the existing provider abstraction and billing model. The desktop never receives the OpenAI key, model switching is constrained by run claims, and only Alpha's domain must be reachable. Make `alpha-gateway` models the default group for the no-VPN product. Either hide direct custom-provider profiles in that edition or clearly mark them as direct network paths.

This route sends prompts, code snippets, file-derived input, tool schemas/results, model output, and usage metadata through Alpha's overseas backend. Privacy notices, retention rules, regional data placement, and any cross-border assessment must match that fact; the repository currently avoids prompt-body persistence but the data is still processed in memory and transit.

### Optional and higher-risk: subscription traffic through a forward proxy

If the business insists on retaining locally authenticated GPT subscription models, the least invasive technical design is an authenticated overseas HTTPS CONNECT proxy that preserves end-to-end TLS between the Codex client and OpenAI. The Alpha backend would mint short-lived, per-device proxy credentials; the desktop would inject them only into Codex-related processes/clients.

Coverage must include all of these code paths, not just chat:

- `codex_chat_start` child creation (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:1033-1050`);
- subscription usage child (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:5484-5496`);
- model-catalog child (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:5565-5581`);
- login command (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:6425-6464`);
- local Chat-Completions adapter's `reqwest::Client` if direct custom providers are included (`/Users/geb/codes/alpha_studio/src-tauri/src/lib.rs:4256-4269`).

Even then, macOS system-browser OAuth navigation is outside the spawned CLI's HTTP environment, so “works without VPN from first login” cannot be guaranteed by merely setting `HTTPS_PROXY` on the child. Shared long-lived proxy credentials embedded in the app or sent to JavaScript/localStorage are unacceptable because users can extract and reuse them. A reverse proxy that receives/stores users' ChatGPT OAuth tokens is not supported by the current code and should not be built as an incidental extension of the API gateway.

## Staged repository implementation plan

### Phase 0 — security gate before public exposure

1. Replace the `admin-` prefix check with verified expiring auth using `JWT_SECRET` (or an external identity-aware proxy); restrict `/admin` operationally.
2. Issue signed/revocable client device sessions at activation and require them for lease renewal, run creation, billing, and model catalog refresh.
3. Encrypt provider credentials at rest; remove or encrypt `codex_accounts.login_secret`; set restrictive file permissions for local model-provider config.
4. Add provider egress allowlisting/private-IP rejection and outbound firewall rules.
5. Add per-tenant/device/run rate, concurrency, cumulative budget, and replay controls.
6. Route `/v1/*` in Caddy, restrict CORS, and add structured request IDs without logging prompts or Authorization headers.

### Phase 1 — ship the no-VPN API gateway

1. Deploy the existing backend/Caddy/Postgres/Redis stack in an overseas region with stable connectivity to customers and OpenAI.
2. Configure OpenAI in `/admin` and expose only approved `gateway_api` model routes.
3. Make gateway profiles the default for the relevant edition/tenant; hide or label built-in subscription and direct-provider profiles.
4. Split the shared backend HTTP client into gateway and market clients. If a further egress proxy is required, configure it only on the gateway client through server secrets.
5. Add health checks that test customer-to-gateway and gateway-to-OpenAI separately; do not expose provider failure details containing secrets.

### Phase 2 — true streaming and cancellation

1. Enable streaming support in the backend HTTP client and consume upstream SSE incrementally.
2. For OpenAI Responses, pass through validated events while preserving/model-normalizing IDs and usage. For other protocols, add incremental adapters rather than synthesizing one giant final delta.
3. Stop retries after any downstream bytes have been emitted; propagate client disconnect cancellation upstream.
4. Settle usage on `response.completed`, and define auditable behavior for disconnects/partial responses where usage is absent.
5. Verify Caddy does not buffer the SSE path and use explicit SSE/cache headers.

### Phase 3 — only if subscription proxying remains required

1. Add a backend proxy-lease endpoint returning short-lived, device-bound credentials to the native layer (not persisted in frontend localStorage).
2. Add one native helper that applies proxy configuration consistently to every Codex child and native GPT adapter listed above.
3. Add proxy endpoint allowlists so the credential can reach only required OpenAI authentication/API hosts, and deny general web proxy use.
4. Test first login separately; if the system browser cannot use the scoped proxy, do not claim zero-VPN onboarding.

## Verification matrix

- A network-capture/integration test should prove gateway-mode desktops contact only the configured Alpha API host for model requests and never `api.openai.com` directly.
- Mock-upstream tests should cover Responses SSE event order, first-byte latency, tool-call deltas, normalized errors, retry-before-stream only, cancellation, and final usage settlement.
- Security tests should reject forged `admin-*` tokens, expired/wrong-tenant device sessions, expired/cross-model run tokens, private/link-local provider URLs, over-budget parallel requests, and reused proxy leases.
- Secret tests should prove provider keys, run tokens, proxy credentials, and Authorization headers do not appear in API responses, logs, audit payloads, or persisted frontend state.
- Deployment tests should cover `/v1/responses` and `/v1/models` through Caddy, not just by calling Axum directly.
- Subscription-forward-proxy tests, if built, must cover chat, tool loops/subagents, model catalog, rate limits, login token exchange, logout/revocation, and behavior when the proxy is unavailable.

## Bottom line

For OpenAI API models, this is not a speculative rewrite: the core gateway already exists. The smallest sound change is primarily deployment plus product-mode selection and security hardening. For ChatGPT/Codex subscription accounts, the current architecture is intentionally local and an overseas gateway is not a drop-in switch; treat it as a separate product decision, not as part of the straightforward API-gateway rollout.
