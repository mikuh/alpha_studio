# Codex Model Catalog Sync Design

Status: approved
Date: 2026-07-10

## Context

Alpha Studio currently builds its Codex subscription menu from the static
`BUILTIN_MODEL_PROFILES` list. Updating Codex therefore updates the CLI and its
account-scoped model catalog, but not Alpha Studio's menu. The current Codex
app-server already returns GPT-5.6 Sol, Terra, and Luna for the authorized
account through `model/list`, including each model's supported reasoning
efforts. Alpha Studio also keeps one global static reasoning-effort list, so it
cannot expose model-specific `max` or `ultra` support.

The usage-based Alpha Gateway catalog is a separate, administrator-managed
source with independent upstream routes and prices. It must remain unchanged by
this work.

## Goals

- Build the Codex subscription menu from the current authorized account's
  app-server `model/list` response.
- Refresh the catalog after startup authorization checks, successful device
  authorization, and an explicit runtime recheck.
- Render only the reasoning efforts supported by the selected model.
- Support the `max` and `ultra` reasoning-effort identifiers end to end.
- Preserve Alpha Gateway and local custom model profiles exactly as they are.
- Keep Alpha Studio usable when catalog discovery fails by retaining the static
  subscription catalog as a fallback.
- Avoid persisting account-scoped remote model metadata.

## Non-goals

- Adding GPT-5.6 routes, credentials, prices, or aliases to Alpha Gateway.
- Changing Codex installation, login, subscription, or account-selection
  behavior.
- Redesigning the model picker or changing its subscription/usage-based groups.
- Reading `models_cache.json` directly or depending on its private on-disk
  schema.
- Forcing GPT-5.6 to become the default when the CLI marks another model as the
  account default.

## Approaches considered

### 1. Query app-server `model/list` — selected

This is the authoritative account-aware interface already used by Codex. It
returns visibility, default selection, display name, pagination, and reasoning
metadata in one response. It avoids coupling Alpha Studio to a cache file or a
release-specific hardcoded catalog.

### 2. Read `models_cache.json`

This is simpler to implement but depends on an internal cache format, can be
stale, and can be absent even when app-server discovery works. It is not used.

### 3. Add GPT-5.6 to the static list

This would resolve only the current screenshot and would fail again on the next
catalog change. It also cannot safely represent account-specific availability.
The existing list remains only as a fallback.

## Architecture

### Rust/Tauri catalog command

Add a `codex_models` Tauri command with a `forceRefetch` request flag. It will:

1. Resolve the same working Codex binary used for chat.
2. Prepare and use Alpha Studio's private `CODEX_HOME`.
3. Require the existing Alpha Studio device authorization to be valid.
4. Start Codex app-server with the same safe process settings used by the other
   app-server commands.
5. Send `initialize`, then `initialized`, then paginated `model/list` requests.
6. Normalize the response into a small renderer-safe DTO and terminate the
   child process.

The startup request uses the cached catalog when it is still valid:

```json
{
  "id": 2,
  "method": "model/list",
  "params": {
    "limit": 100,
    "forceRefetch": false
  }
}
```

Additional pages pass the returned `nextCursor` as `params.cursor`. The command
will preserve the requested `forceRefetch` value on every page, consume pages
until `nextCursor` is null, deduplicate by model ID, preserve server order, and
reject an empty normalized catalog.

The renderer DTO contains only:

```ts
interface CodexModelCatalogItem {
  id: string;
  displayName: string;
  isDefault: boolean;
  hidden: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts: Array<{
    reasoningEffort: ReasoningEffort;
    description: string;
  }>;
}
```

Unknown reasoning identifiers are ignored rather than forwarded. Hidden models
are excluded from the effective subscription catalog. No auth data, account
identity, model instructions, or cached metadata is returned to the renderer.

The full operation has a bounded timeout. The child is killed and awaited on
success, timeout, or protocol failure.

### Frontend bridge and state

Add a typed `listCodexModels()` bridge function and a store action that refreshes
the catalog. The store keeps the remote catalog as ephemeral state; it is not
written to `model-providers.json` or Zustand persistence.

Refresh is triggered only from controlled runtime actions:

- after the initial Codex status check reports an authorized CLI, using
  `forceRefetch: false` so a valid Codex cache is reused;
- after device authorization becomes valid, using `forceRefetch: true` so the
  newly authorized account catalog is fetched;
- after the user clicks the existing runtime recheck action, using
  `forceRefetch: true` so an explicit refresh can discover newly released
  models immediately.

The store owns an in-flight/loading guard so React remounts and StrictMode do not
duplicate the app-server request. Rendering the model picker never performs I/O.

### Effective model profiles

The effective `modelProfiles` array remains the single list consumed by chat,
automations, settings, and the picker. A pure merge helper rebuilds it from
three sources:

1. dynamic Codex subscription profiles when a non-empty catalog is available;
2. the existing static built-ins when discovery is unavailable;
3. current Alpha Gateway and local custom profiles.

Dynamic Codex entries are marked `builtIn: true`, use provider `openai`, use the
Responses wire API, and send the exact app-server model ID. Gateway collision
handling and its `gateway:` ID prefix remain unchanged.

Catalog refresh must replace only subscription profiles. It must not delete,
reorder, disable, or rewrite usage-based or local custom profiles. License
gating remains unchanged: a tenant without Codex subscription access does not
see subscription profiles even if a local catalog is available.

### Selection behavior

- Preserve the selected model when its ID remains in the refreshed effective
  catalog.
- Otherwise choose the visible model marked `isDefault` by Codex.
- If no model is marked default, choose the first visible subscription model.
- If subscription models are not permitted, keep the existing Gateway/custom
  fallback behavior.
- Do not force GPT-5.6 as the default when the account currently marks GPT-5.5
  as default.

Remote catalog data is not persisted. The selected profile ID may continue to
be persisted; it is validated again after the next catalog refresh.

## Model-specific reasoning efforts

Extend the shared `ReasoningEffort` type and Rust sanitizer to accept:

- `low` → 低
- `medium` → 中
- `high` → 高
- `xhigh` → 超高
- `max` → Max
- `ultra` → Ultra

For a dynamic Codex model, the picker displays only its
`supportedReasoningEfforts`, in server order. For a Gateway or local profile
without model-specific metadata, Alpha Studio retains the current low through
xhigh options when reasoning effort is enabled.

Whenever the selected model or refreshed catalog makes the current effort
invalid, the store changes it atomically to:

1. the model's valid `defaultReasoningEffort`;
2. otherwise the first supported effort;
3. otherwise the existing global fallback.

This validation occurs in store/domain logic, not only in the picker, so chat
and automations cannot send an unsupported effort from stale persisted state.

## Error handling and fallback

- Missing or unauthorized Codex: skip remote discovery and preserve existing
  authorization messaging and model visibility rules.
- Spawn, timeout, JSON-RPC, pagination, malformed-entry, or empty-catalog
  failure: retain the static built-in catalog and keep Gateway/custom models
  available.
- Partial malformed entries: discard invalid entries; accept the catalog only
  when at least one visible valid model remains.
- Refresh failure after a previous successful refresh: retain the last
  successful in-memory catalog for the current process instead of replacing it
  with static data.
- Store the latest discovery error for diagnostics, but do not block the
  composer solely because model discovery failed.

## Testing strategy

Implementation follows red-green-refactor.

### Rust tests

- Parse a representative paginated `model/list` result.
- Preserve display name, default flag, supported efforts, and descriptions.
- Filter hidden and malformed models and deduplicate IDs.
- Accept `max` and `ultra`; reject unknown effort strings.
- Verify empty normalized results are errors.

### TypeScript/domain tests

- Convert catalog items into built-in model profiles.
- Replace only subscription profiles while preserving Gateway/custom entries.
- Use static built-ins when no dynamic catalog exists.
- Preserve a valid selection and fall back to CLI default when invalid.
- Clamp reasoning effort to the selected model's default or first supported
  effort.
- Retain the legacy low-through-xhigh behavior for profiles without metadata.

### Store and UI tests

- Successful refresh displays GPT-5.6 Sol, Terra, and Luna.
- Failed refresh keeps the fallback menu usable.
- Repeated startup/remount actions do not issue duplicate in-flight requests.
- Selecting Sol shows its returned efforts including Max and Ultra.
- Selecting a model without Ultra removes Ultra and normalizes the selection.
- The usage-based group remains unchanged.

### Verification

- Run the focused Rust and frontend regression tests during each TDD cycle.
- Run the full Rust test suite, frontend test suite, TypeScript build, and Vite
  production build.
- In the running Tauri development app, recheck the runtime and confirm the
  account-visible GPT-5.6 models and per-model effort menus.

## Acceptance criteria

- The current authorized account shows GPT-5.6 Sol, Terra, and Luna without a
  new Alpha Studio release containing their IDs.
- A future model returned by app-server appears after refresh without a source
  catalog edit.
- Hidden or unauthorized models are not displayed.
- Each selected Codex model exposes only its supported reasoning efforts, and
  `max`/`ultra` reach Codex unchanged when supported.
- Catalog discovery failure leaves the existing static subscription catalog and
  all Gateway/custom models usable.
- No account credentials or private app-server model instructions cross the
  Tauri boundary.
- Alpha Gateway routes and billing configuration are unchanged.
