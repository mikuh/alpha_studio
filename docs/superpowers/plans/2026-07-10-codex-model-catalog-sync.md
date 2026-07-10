# Codex Model Catalog Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Alpha Studio discover the authorized Codex account's current model catalog and model-specific reasoning efforts at runtime, including GPT-5.6 Sol/Terra/Luna and `max`/`ultra`, while preserving static fallback, Gateway models, custom models, and existing automation tasks.

**Architecture:** A new Tauri command starts the already-resolved Codex app-server against Alpha Studio's private `CODEX_HOME`, performs the JSON-RPC handshake, consumes every `model/list` page, and returns a renderer-safe catalog. Pure TypeScript domain helpers turn that ephemeral catalog into effective subscription profiles, reconcile selection and effort atomically, and merge them with license-provided Gateway profiles and local profiles. Store actions own refresh timing and persistence boundaries; both chat UI surfaces and automations consume the same effective profiles and effort helpers.

**Tech Stack:** Rust 2021, Tokio, Serde/serde_json, Tauri 2, TypeScript 5.9, React 19, Zustand 5, Vitest 4, Testing Library.

## Global Constraints

- Use the working Codex binary selected by `resolve_codex_binary()` and Alpha Studio's private `CODEX_HOME`; do not read `models_cache.json`.
- Preserve the existing `/Applications/ChatGPT.app/Contents/Resources/codex` candidate before the legacy `/Applications/Codex.app/Contents/Resources/codex` candidate and keep its regression test.
- The local target `/Applications/ChatGPT.app/Contents/Resources/codex` was wire-tested on 2026-07-10: `model/list` accepts `forceRefetch: true` and returns `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`.
- Return only `id`, `displayName`, `isDefault`, `hidden`, `defaultReasoningEffort`, and `supportedReasoningEfforts` across the Tauri boundary.
- Bound catalog discovery to 30 seconds and kill plus await the app-server child on success, timeout, and protocol failure.
- Dynamic account-scoped catalog metadata is memory-only. It must not enter `model-providers.json`, Zustand persistence, or the local-store snapshot.
- Keep `BUILTIN_MODEL_PROFILES` as the discovery-failure fallback; do not add GPT-5.6 IDs to that static list.
- Alpha Gateway routes, aliases, credentials, prices, ordering, and billing behavior are out of scope and must not change.
- A tenant with `codexSubscriptionEnabled: false` must not see dynamic or fallback subscription profiles.
- Dynamic Codex models expose server-ordered efforts. Static fallback, Gateway, and local profiles without metadata retain only `low`, `medium`, `high`, and `xhigh`.
- Accept `max` and `ultra` end to end. Keep Rust's existing `minimal` acceptance for callers that already use it, but never expose `minimal` through the renderer catalog type.
- Preserve old automation JSON containing strings such as `GPT-5.5 超高`; new saves add stable `modelProfileId` and `reasoningEffort` fields without persisting remote catalog metadata.
- The worktree already contains unrelated user edits. Before every commit, use `git add -p` for modified existing files, stage only task-owned hunks, inspect `git diff --cached`, and leave every unrelated hunk unstaged.
- Follow red-green-refactor: each implementation step begins with a focused failing test and ends with that focused test passing.

---

## File Structure

- Modify `src-tauri/src/lib.rs`: renderer-safe Rust DTOs, effort sanitizer, JSON-RPC pagination, process lifecycle, Tauri command, and Rust regression tests.
- Modify `src/types.ts`: shared `ReasoningEffort` union and renderer catalog DTOs.
- Modify `src/models.ts`: dynamic catalog-to-profile conversion, model selection reconciliation, effort option derivation, and effort clamping.
- Create `src/models.test.ts`: pure catalog, selection, and effort tests.
- Modify `src/license.ts`: accept an injected subscription profile list while leaving Gateway mapping intact.
- Modify `src/license.test.ts`: dynamic subscription/Gateway merge and license-gating tests.
- Modify `src/codexBridge.ts`: typed `codex_models` bridge.
- Create `src/codexBridge.test.ts`: bridge request-shape and browser fallback tests.
- Modify `src/store.ts`: ephemeral catalog state, refresh orchestration, persistence filtering, atomic model/effort updates, and safe request-time clamping.
- Create `src/store.catalog.test.ts`: isolated catalog refresh, concurrency, fallback, retention, and persistence tests.
- Modify `src/App.tsx`: dynamic effort menus, explicit refresh trigger, catalog-backed automation controls, and actual automation model application.
- Modify `src/App.test.tsx`: catalog UI, per-model effort, Gateway preservation, refresh failure, and automation migration integration tests.
- Modify `src/automation.ts`: backward-compatible stable model selection fields.
- Modify `src/automation.test.ts`: new-task metadata and old-task compatibility tests.
- Modify `docs/superpowers/specs/2026-07-10-codex-model-catalog-sync-design.md`: mark the user-reviewed design approved.

---

### Task 1: Normalize the Codex catalog and extend Rust effort support

**Files:**
- Modify: `src-tauri/src/lib.rs:71-104`
- Modify: `src-tauri/src/lib.rs:4196-4206`
- Test: `src-tauri/src/lib.rs:7266-end`

**Interfaces:**
- Consumes: raw `serde_json::Value` objects shaped like app-server `model/list` responses.
- Produces: `CodexModelsRequest`, `CodexModelReasoningEffort`, `CodexModelCatalogItem`, `normalize_codex_model_page()`, `normalize_codex_model()`, and `sanitize_catalog_reasoning_effort()` for Task 2.

- [ ] **Step 1: Add failing normalization and sanitizer tests**

Add these tests inside the existing `#[cfg(test)] mod tests`:

```rust
#[test]
fn codex_model_catalog_preserves_renderer_safe_fields() {
    let response = json!({
        "result": {
            "data": [{
                "id": "gpt-5.6-sol",
                "displayName": "GPT-5.6 Sol",
                "isDefault": true,
                "hidden": false,
                "defaultReasoningEffort": "max",
                "supportedReasoningEfforts": [
                    { "reasoningEffort": "high", "description": "Thorough" },
                    { "reasoningEffort": "max", "description": "Maximum" },
                    { "reasoningEffort": "ultra", "description": "Ultra" }
                ],
                "instructions": "must not cross the Tauri boundary",
                "authToken": "must not cross the Tauri boundary"
            }],
            "nextCursor": null
        }
    });
    let mut seen_ids = HashSet::new();
    let mut catalog = Vec::new();

    let cursor = normalize_codex_model_page(&response, &mut seen_ids, &mut catalog).unwrap();

    assert_eq!(cursor, None);
    assert_eq!(catalog.len(), 1);
    assert_eq!(catalog[0].id, "gpt-5.6-sol");
    assert_eq!(catalog[0].display_name, "GPT-5.6 Sol");
    assert!(catalog[0].is_default);
    assert_eq!(catalog[0].default_reasoning_effort.as_deref(), Some("max"));
    assert_eq!(
        catalog[0]
            .supported_reasoning_efforts
            .iter()
            .map(|item| (item.reasoning_effort.as_str(), item.description.as_str()))
            .collect::<Vec<_>>(),
        vec![("high", "Thorough"), ("max", "Maximum"), ("ultra", "Ultra")]
    );
    let serialized = serde_json::to_value(&catalog[0]).unwrap();
    assert!(serialized.get("instructions").is_none());
    assert!(serialized.get("authToken").is_none());
}

#[test]
fn codex_model_catalog_filters_hidden_malformed_and_duplicate_models() {
    let response = json!({
        "result": {
            "data": [
                {
                    "id": "hidden-model",
                    "displayName": "Hidden",
                    "isDefault": false,
                    "hidden": true,
                    "supportedReasoningEfforts": []
                },
                {
                    "id": "",
                    "displayName": "Missing id",
                    "isDefault": false,
                    "hidden": false,
                    "supportedReasoningEfforts": []
                },
                {
                    "id": "gpt-5.6-terra",
                    "displayName": "GPT-5.6 Terra",
                    "isDefault": false,
                    "hidden": false,
                    "supportedReasoningEfforts": [
                        { "reasoningEffort": "low", "description": "Fast" },
                        { "reasoningEffort": "future", "description": "Unknown" },
                        { "reasoningEffort": "max", "description": 7 }
                    ]
                },
                {
                    "id": "gpt-5.6-terra",
                    "displayName": "Duplicate",
                    "isDefault": true,
                    "hidden": false,
                    "supportedReasoningEfforts": []
                }
            ],
            "nextCursor": "page-2"
        }
    });
    let mut seen_ids = HashSet::new();
    let mut catalog = Vec::new();

    let cursor = normalize_codex_model_page(&response, &mut seen_ids, &mut catalog).unwrap();

    assert_eq!(cursor.as_deref(), Some("page-2"));
    assert_eq!(catalog.len(), 1);
    assert_eq!(catalog[0].display_name, "GPT-5.6 Terra");
    assert_eq!(catalog[0].supported_reasoning_efforts.len(), 1);
    assert_eq!(catalog[0].supported_reasoning_efforts[0].reasoning_effort, "low");
}

#[test]
fn sanitize_reasoning_effort_accepts_max_and_ultra() {
    assert_eq!(sanitize_reasoning_effort(Some("max")).as_deref(), Some("max"));
    assert_eq!(sanitize_reasoning_effort(Some("ultra")).as_deref(), Some("ultra"));
    assert_eq!(sanitize_reasoning_effort(Some("minimal")).as_deref(), Some("minimal"));
    assert_eq!(sanitize_reasoning_effort(Some("future")), None);
    assert_eq!(sanitize_catalog_reasoning_effort(Some("minimal")), None);
    assert_eq!(sanitize_catalog_reasoning_effort(Some("ultra")).as_deref(), Some("ultra"));
}
```

- [ ] **Step 2: Run the focused tests and confirm the red state**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib codex_model_catalog -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib sanitize_reasoning_effort_accepts_max_and_ultra -- --exact --nocapture
```

Expected: compilation fails because the catalog DTOs and normalization functions do not exist, and the sanitizer test fails until `max` and `ultra` are accepted.

- [ ] **Step 3: Add the renderer-safe DTOs and strict normalizers**

Insert after `CodexLoginResult`:

```rust
#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelsRequest {
    #[serde(default)]
    force_refetch: bool,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelReasoningEffort {
    reasoning_effort: String,
    description: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexModelCatalogItem {
    id: String,
    display_name: String,
    is_default: bool,
    hidden: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    default_reasoning_effort: Option<String>,
    supported_reasoning_efforts: Vec<CodexModelReasoningEffort>,
}
```

Add the parser beside the app-server helpers:

```rust
fn normalize_codex_model_page(
    response: &Value,
    seen_ids: &mut HashSet<String>,
    catalog: &mut Vec<CodexModelCatalogItem>,
) -> Result<Option<String>, String> {
    let result = response
        .get("result")
        .and_then(Value::as_object)
        .ok_or_else(|| "Codex app-server returned malformed model list data.".to_string())?;
    let data = result
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "Codex app-server returned malformed model list data.".to_string())?;

    for raw in data {
        if let Some(model) = normalize_codex_model(raw) {
            if seen_ids.insert(model.id.clone()) {
                catalog.push(model);
            }
        }
    }

    match result.get("nextCursor") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(cursor)) if !cursor.trim().is_empty() => {
            Ok(Some(cursor.trim().to_string()))
        }
        Some(_) => Err("Codex app-server returned an invalid model pagination cursor.".to_string()),
    }
}

fn normalize_codex_model(value: &Value) -> Option<CodexModelCatalogItem> {
    let object = value.as_object()?;
    let id = object.get("id")?.as_str()?.trim();
    let display_name = object.get("displayName")?.as_str()?.trim();
    let is_default = object.get("isDefault")?.as_bool()?;
    let hidden = object.get("hidden")?.as_bool()?;
    let supported = object.get("supportedReasoningEfforts")?.as_array()?;
    if id.is_empty() || display_name.is_empty() || hidden {
        return None;
    }

    let supported_reasoning_efforts = supported
        .iter()
        .filter_map(|item| {
            let object = item.as_object()?;
            let reasoning_effort = sanitize_catalog_reasoning_effort(
                object.get("reasoningEffort").and_then(Value::as_str),
            )?;
            let description = object.get("description")?.as_str()?.trim().to_string();
            Some(CodexModelReasoningEffort {
                reasoning_effort,
                description,
            })
        })
        .collect();

    Some(CodexModelCatalogItem {
        id: id.to_string(),
        display_name: display_name.to_string(),
        is_default,
        hidden,
        default_reasoning_effort: sanitize_catalog_reasoning_effort(
            object.get("defaultReasoningEffort").and_then(Value::as_str),
        ),
        supported_reasoning_efforts,
    })
}

fn sanitize_catalog_reasoning_effort(value: Option<&str>) -> Option<String> {
    sanitize_reasoning_effort(value).filter(|effort| {
        matches!(
            effort.as_str(),
            "low" | "medium" | "high" | "xhigh" | "max" | "ultra"
        )
    })
}
```

Extend `sanitize_reasoning_effort()` without removing `minimal`:

```rust
fn sanitize_reasoning_effort(value: Option<&str>) -> Option<String> {
    match value.map(str::trim).unwrap_or_default() {
        "minimal" => Some("minimal".to_string()),
        "low" => Some("low".to_string()),
        "medium" => Some("medium".to_string()),
        "high" => Some("high".to_string()),
        "xhigh" => Some("xhigh".to_string()),
        "max" => Some("max".to_string()),
        "ultra" => Some("ultra".to_string()),
        _ => None,
    }
}
```

- [ ] **Step 4: Run the focused tests and confirm green**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib codex_model_catalog -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib sanitize_reasoning_effort -- --nocapture
```

Expected: all matching catalog and sanitizer tests pass.

- [ ] **Step 5: Commit only Task 1 hunks**

```bash
git add -p src-tauri/src/lib.rs
git diff --cached --check
git diff --cached -- src-tauri/src/lib.rs
git commit -m "feat: normalize Codex model catalog data"
```

Expected: the staged diff contains only DTO/parser/sanitizer code and its tests; the existing ChatGPT app-path hunk and unrelated Rust hunks remain unstaged.

---

### Task 2: Add the paginated `codex_models` Tauri command with guaranteed cleanup

**Files:**
- Modify: `src-tauri/src/lib.rs:838-910`
- Modify: `src-tauri/src/lib.rs:1401-1427`
- Modify: `src-tauri/src/lib.rs:1709-1765`
- Modify: `src-tauri/src/lib.rs:5573-5677`
- Modify: `src-tauri/src/lib.rs:5690-5692`
- Modify: `src-tauri/src/lib.rs:7191-7200`
- Test: `src-tauri/src/lib.rs:7266-end`

**Interfaces:**
- Consumes: Task 1's DTOs and normalizers, `send_jsonrpc()`, `await_response()`, `resolve_codex_binary()`, `prepare_alpha_studio_codex_home()`, and `codex_logged_in()`.
- Produces: Tauri command `codex_models(app, request) -> Result<Vec<CodexModelCatalogItem>, String>` consumed by Task 4's bridge.

- [ ] **Step 1: Add a failing wire-level pagination test**

Add this async test to the Rust test module:

```rust
#[tokio::test]
async fn codex_model_catalog_paginates_and_preserves_force_refetch() {
    let (client, server) = tokio::io::duplex(32 * 1024);
    let (client_read, mut client_write) = tokio::io::split(client);
    let (server_read, mut server_write) = tokio::io::split(server);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_read).lines();

        let initialize: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(initialize.get("method").and_then(Value::as_str), Some("initialize"));
        server_write
            .write_all(format!("{}\n", json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).as_bytes())
            .await
            .unwrap();

        let initialized: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(initialized.get("method").and_then(Value::as_str), Some("initialized"));

        let first: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(first.get("method").and_then(Value::as_str), Some("model/list"));
        assert_eq!(first.pointer("/params/limit").and_then(Value::as_i64), Some(100));
        assert_eq!(first.pointer("/params/forceRefetch").and_then(Value::as_bool), Some(true));
        assert!(first.pointer("/params/cursor").is_none());
        server_write
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "jsonrpc": "2.0",
                        "id": 2,
                        "result": {
                            "data": [{
                                "id": "gpt-5.6-sol",
                                "displayName": "GPT-5.6 Sol",
                                "isDefault": true,
                                "hidden": false,
                                "supportedReasoningEfforts": []
                            }],
                            "nextCursor": "next-page"
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();

        let second: Value = serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
        assert_eq!(second.pointer("/params/cursor").and_then(Value::as_str), Some("next-page"));
        assert_eq!(second.pointer("/params/forceRefetch").and_then(Value::as_bool), Some(true));
        server_write
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "jsonrpc": "2.0",
                        "id": 3,
                        "result": {
                            "data": [{
                                "id": "gpt-5.6-terra",
                                "displayName": "GPT-5.6 Terra",
                                "isDefault": false,
                                "hidden": false,
                                "supportedReasoningEfforts": []
                            }],
                            "nextCursor": null
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });

    let mut reader = BufReader::new(client_read).lines();
    let catalog = fetch_codex_model_catalog(&mut client_write, &mut reader, true)
        .await
        .unwrap();
    server_task.await.unwrap();

    assert_eq!(
        catalog.iter().map(|item| item.id.as_str()).collect::<Vec<_>>(),
        vec!["gpt-5.6-sol", "gpt-5.6-terra"]
    );
}

#[tokio::test]
async fn codex_model_catalog_rejects_repeated_pagination_cursor() {
    let (client, server) = tokio::io::duplex(32 * 1024);
    let (client_read, mut client_write) = tokio::io::split(client);
    let (server_read, mut server_write) = tokio::io::split(server);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_read).lines();
        let _initialize = lines.next_line().await.unwrap().unwrap();
        server_write
            .write_all(format!("{}\n", json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).as_bytes())
            .await
            .unwrap();
        let _initialized = lines.next_line().await.unwrap().unwrap();
        for id in [2, 3] {
            let _request = lines.next_line().await.unwrap().unwrap();
            server_write
                .write_all(
                    format!(
                        "{}\n",
                        json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "data": [{
                                    "id": format!("model-{id}"),
                                    "displayName": format!("Model {id}"),
                                    "isDefault": false,
                                    "hidden": false,
                                    "supportedReasoningEfforts": []
                                }],
                                "nextCursor": "same-cursor"
                            }
                        })
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        }
    });
    let mut reader = BufReader::new(client_read).lines();

    let error = fetch_codex_model_catalog(&mut client_write, &mut reader, false)
        .await
        .unwrap_err();
    server_task.await.unwrap();

    assert_eq!(error, "Codex app-server returned a repeated model pagination cursor.");
}
```

- [ ] **Step 2: Run the wire test and confirm it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib tests::codex_model_catalog_paginates_and_preserves_force_refetch -- --exact --nocapture
```

Expected: compilation fails because `fetch_codex_model_catalog()` is not defined.

- [ ] **Step 3: Extract the shared handshake and implement pagination**

Add before `send_jsonrpc()`:

```rust
async fn initialize_codex_app_server<W, R>(
    stdin: &mut W,
    reader: &mut tokio::io::Lines<R>,
) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
    R: AsyncBufRead + Unpin,
{
    send_jsonrpc(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": {
                    "name": "alpha-studio",
                    "title": "Alpha Studio",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false
                }
            }
        }),
    )
    .await?;
    await_response(stdin, reader, 1).await?;
    send_jsonrpc(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "method": "initialized",
            "params": {}
        }),
    )
    .await
}

async fn fetch_codex_model_catalog<W, R>(
    stdin: &mut W,
    reader: &mut tokio::io::Lines<R>,
    force_refetch: bool,
) -> Result<Vec<CodexModelCatalogItem>, String>
where
    W: AsyncWrite + Unpin,
    R: AsyncBufRead + Unpin,
{
    initialize_codex_app_server(stdin, reader).await?;
    let mut request_id = 2_i64;
    let mut cursor: Option<String> = None;
    let mut seen_ids = HashSet::new();
    let mut seen_cursors = HashSet::new();
    let mut catalog = Vec::new();

    loop {
        let mut params = Map::new();
        params.insert("limit".to_string(), json!(100));
        params.insert("forceRefetch".to_string(), json!(force_refetch));
        if let Some(cursor) = &cursor {
            params.insert("cursor".to_string(), json!(cursor));
        }
        send_jsonrpc(
            stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": request_id,
                "method": "model/list",
                "params": Value::Object(params)
            }),
        )
        .await?;
        let response = await_response(stdin, reader, request_id).await?;
        cursor = normalize_codex_model_page(&response, &mut seen_ids, &mut catalog)?;
        let Some(next_cursor) = cursor.as_ref() else {
            break;
        };
        if !seen_cursors.insert(next_cursor.clone()) {
            return Err("Codex app-server returned a repeated model pagination cursor.".to_string());
        }
        request_id += 1;
    }

    if catalog.is_empty() {
        return Err("Codex app-server returned no visible valid models.".to_string());
    }
    Ok(catalog)
}
```

Replace the duplicated initialize/initialized sequences in chat startup and `read_codex_account_rate_limits()` with:

```rust
initialize_codex_app_server(&mut stdin, &mut reader).await?;
```

Leave each caller's next request ID at `2`.

- [ ] **Step 4: Add the command and process lifecycle**

Add after `codex_subscription_usage()`:

```rust
#[tauri::command]
async fn codex_models(
    app: AppHandle,
    request: CodexModelsRequest,
) -> Result<Vec<CodexModelCatalogItem>, String> {
    let check = check_codex(Some(&app));
    if !check.installed {
        return Err(check.error.unwrap_or_else(|| {
            "Codex CLI is not installed or cannot be executed.".to_string()
        }));
    }
    let codex_home = prepare_alpha_studio_codex_home(Some(&app))?;
    if !codex_logged_in(&check.path, &codex_home) {
        return Err(check.error.unwrap_or_else(|| {
            "Codex CLI is installed but Alpha Studio has not completed device authorization."
                .to_string()
        }));
    }
    read_codex_models(&check.path, &codex_home, request.force_refetch).await
}
```

Add beside `read_codex_account_rate_limits()`:

```rust
async fn read_codex_models(
    path: &str,
    codex_home: &Path,
    force_refetch: bool,
) -> Result<Vec<CodexModelCatalogItem>, String> {
    let mut command = Command::new(path);
    for arg in codex_app_server_args(None) {
        command.arg(arg);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.env("TERM", "xterm-256color");
    command.env("NO_COLOR", "1");
    command.env("CODEX_HOME", codex_home);
    command.kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn Codex app-server: {error}"))?;
    let request_result = match (
        child.stdin.take(),
        child.stdout.take(),
        child.stderr.take(),
    ) {
        (Some(mut stdin), Some(stdout), Some(stderr)) => {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(_line)) = lines.next_line().await {}
            });
            let mut reader = BufReader::new(stdout).lines();
            match tokio::time::timeout(
                Duration::from_secs(30),
                fetch_codex_model_catalog(&mut stdin, &mut reader, force_refetch),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => Err("Timed out reading Codex model catalog from Codex CLI.".to_string()),
            }
        }
        _ => Err("Failed to open Codex app-server stdio.".to_string()),
    };

    let _ = child.kill().await;
    let _ = child.wait().await;

    request_result
}
```

The catalog command drains stderr to avoid a blocked child but does not return raw stderr to the renderer; only fixed Alpha Studio protocol/lifecycle messages become `codexModelCatalogError` diagnostics.

Register `codex_models` immediately after `codex_subscription_usage` in `tauri::generate_handler!`.

- [ ] **Step 5: Lock the empty-catalog error and preserve the bundled ChatGPT path fix**

Add:

```rust
#[tokio::test]
async fn codex_model_catalog_rejects_empty_visible_results() {
    let (client, server) = tokio::io::duplex(8192);
    let (client_read, mut client_write) = tokio::io::split(client);
    let (server_read, mut server_write) = tokio::io::split(server);
    let server_task = tokio::spawn(async move {
        let mut lines = BufReader::new(server_read).lines();
        let _initialize = lines.next_line().await.unwrap().unwrap();
        server_write
            .write_all(format!("{}\n", json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).as_bytes())
            .await
            .unwrap();
        let _initialized = lines.next_line().await.unwrap().unwrap();
        let _request = lines.next_line().await.unwrap().unwrap();
        server_write
            .write_all(
                format!(
                    "{}\n",
                    json!({
                        "jsonrpc": "2.0",
                        "id": 2,
                        "result": {
                            "data": [{
                                "id": "hidden",
                                "displayName": "Hidden",
                                "isDefault": false,
                                "hidden": true,
                                "supportedReasoningEfforts": []
                            }],
                            "nextCursor": null
                        }
                    })
                )
                .as_bytes(),
            )
            .await
            .unwrap();
    });
    let mut reader = BufReader::new(client_read).lines();

    let error = fetch_codex_model_catalog(&mut client_write, &mut reader, false)
        .await
        .unwrap_err();
    server_task.await.unwrap();

    assert_eq!(error, "Codex app-server returned no visible valid models.");
}
```

Confirm these existing lines remain present and unchanged:

```rust
candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex".to_string());
candidates.push("/Applications/Codex.app/Contents/Resources/codex".to_string());
```

Confirm `includes_current_chatgpt_bundled_codex_before_legacy_app_path` remains in the Rust tests.

- [ ] **Step 6: Run the focused and full Rust suites**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib codex_model_catalog -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib includes_current_chatgpt_bundled_codex_before_legacy_app_path -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: catalog tests pass, the ChatGPT bundled-path regression passes, and the full Rust suite passes.

- [ ] **Step 7: Commit only the runtime command and bundled-path hunks**

```bash
git add -p src-tauri/src/lib.rs
git diff --cached --check
git diff --cached -- src-tauri/src/lib.rs
git commit -m "feat: discover account Codex models at runtime"
```

Expected: the staged diff contains the handshake refactor, pagination, command, handler registration, process cleanup, related tests, and the ChatGPT bundled-path candidate/test; unrelated Rust hunks remain unstaged.

---

### Task 3: Build pure TypeScript catalog, selection, effort, and license-domain helpers

**Files:**
- Modify: `src/types.ts:217-225`
- Modify: `src/models.ts:1-205`
- Create: `src/models.test.ts`
- Modify: `src/license.ts:255-274`
- Modify: `src/license.test.ts:78-122`

**Interfaces:**
- Consumes: Task 2's camelCase Tauri DTO.
- Produces: `CodexModelCatalogItem`, expanded `ReasoningEffort`, enriched `ModelProfile`, `modelProfilesFromCodexCatalog()`, `reasoningEffortOptionsForProfile()`, `resolveReasoningEffortForProfile()`, `reconcileModelSelection()`, and injectable `modelProfilesFromClientLicense()` for Task 4 and Task 5.

- [ ] **Step 1: Create failing pure-domain tests**

Create `src/models.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EFFORT_OPTIONS,
  effortLabel,
  modelProfilesFromCodexCatalog,
  reasoningEffortOptionsForProfile,
  reconcileModelSelection,
  resolveReasoningEffortForProfile,
  type ModelProfile,
} from './models';
import type { CodexModelCatalogItem } from './types';

const catalog: CodexModelCatalogItem[] = [
  {
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    isDefault: true,
    hidden: false,
    defaultReasoningEffort: 'max',
    supportedReasoningEfforts: [
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
      { reasoningEffort: 'ultra', description: 'Ultra' },
    ],
  },
  {
    id: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    isDefault: false,
    hidden: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
    ],
  },
];

describe('Codex model catalog domain', () => {
  it('converts visible catalog items into built-in response profiles in server order', () => {
    const profiles = modelProfilesFromCodexCatalog(catalog);

    expect(profiles.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
    ]);
    expect(profiles[0]).toMatchObject({
      providerId: 'openai',
      model: 'gpt-5.6-sol',
      wireApi: 'responses',
      builtIn: true,
      isDefault: true,
      defaultReasoningEffort: 'max',
    });
    expect(profiles[0].supportedReasoningEfforts).not.toBe(catalog[0].supportedReasoningEfforts);
  });

  it('filters hidden entries and falls back to static profiles when no visible entry remains', () => {
    const hidden = catalog.map((item) => ({ ...item, hidden: true }));
    const profiles = modelProfilesFromCodexCatalog(hidden);

    expect(profiles[0].id).toBe('gpt-5.5');
    expect(profiles.some((profile) => profile.id === 'gpt-5.6-sol')).toBe(false);
  });

  it('preserves a valid selection and otherwise uses the Codex default', () => {
    const profiles = modelProfilesFromCodexCatalog(catalog);

    expect(reconcileModelSelection({
      profiles,
      selectedModelProfileId: 'gpt-5.6-terra',
      reasoningEffort: 'max',
    })).toEqual({ selectedModelProfileId: 'gpt-5.6-terra', reasoningEffort: 'max' });
    expect(reconcileModelSelection({
      profiles,
      selectedModelProfileId: 'missing',
      reasoningEffort: 'ultra',
    })).toEqual({ selectedModelProfileId: 'gpt-5.6-sol', reasoningEffort: 'ultra' });
  });

  it('preserves provider identity when a Gateway collision changes profile ids', () => {
    const previousGateway: ModelProfile = {
      id: 'gpt-5.6-sol',
      label: 'Sol API',
      providerId: 'alpha-gateway',
      model: 'gpt-5.6-sol',
      wireApi: 'responses',
      enabled: true,
      supportsReasoningEffort: true,
    };
    const profiles = [
      ...modelProfilesFromCodexCatalog(catalog),
      { ...previousGateway, id: 'gateway:gpt-5.6-sol' },
    ];

    expect(reconcileModelSelection({
      profiles,
      selectedModelProfileId: previousGateway.id,
      previousSelectedProfile: previousGateway,
      reasoningEffort: 'xhigh',
    }).selectedModelProfileId).toBe('gateway:gpt-5.6-sol');
  });

  it('clamps unsupported effort to the model default and then first supported effort', () => {
    const profiles = modelProfilesFromCodexCatalog(catalog);

    expect(resolveReasoningEffortForProfile(profiles[1], 'ultra')).toBe('high');
    expect(resolveReasoningEffortForProfile({
      ...profiles[1],
      defaultReasoningEffort: 'ultra',
    }, 'ultra')).toBe('low');
  });

  it('keeps low through xhigh for legacy profiles and labels max and ultra', () => {
    const legacy: ModelProfile = {
      id: 'gateway',
      label: 'Gateway',
      providerId: 'alpha-gateway',
      model: 'gateway',
      wireApi: 'responses',
      enabled: true,
      supportsReasoningEffort: true,
    };

    expect(reasoningEffortOptionsForProfile(legacy)).toEqual(EFFORT_OPTIONS);
    expect(reasoningEffortOptionsForProfile(legacy).map((item) => item.id)).toEqual([
      'low', 'medium', 'high', 'xhigh',
    ]);
    expect(effortLabel('max')).toBe('Max');
    expect(effortLabel('ultra')).toBe('Ultra');
  });
});
```

- [ ] **Step 2: Run the new test and confirm red**

Run:

```bash
npm run test:run -- src/models.test.ts
```

Expected: compilation fails because the catalog DTO and helper exports do not exist.

- [ ] **Step 3: Add shared DTOs and catalog metadata to model profiles**

Add to `src/types.ts` near `CodexStatus`:

```ts
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';

export interface CodexModelReasoningEffort {
  reasoningEffort: ReasoningEffort;
  description: string;
}

export interface CodexModelCatalogItem {
  id: string;
  displayName: string;
  isDefault: boolean;
  hidden: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts: CodexModelReasoningEffort[];
}
```

Change the top of `src/models.ts` to import and re-export the shared effort type, then use this complete profile shape:

```ts
import type {
  CodexModelCatalogItem,
  CodexModelReasoningEffort,
  ReasoningEffort,
  SandboxMode,
} from './types';

export type { ReasoningEffort } from './types';

export interface ModelProfile {
  id: string;
  label: string;
  providerId: string;
  model: string;
  wireApi: ModelWireApi;
  baseUrl?: string;
  apiKey?: string;
  enabled: boolean;
  supportsReasoningEffort: boolean;
  builtIn?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: ReasoningEffort;
  supportedReasoningEfforts?: CodexModelReasoningEffort[];
}

export type ModelProfileDraft = Omit<
  ModelProfile,
  'id' | 'builtIn' | 'isDefault' | 'defaultReasoningEffort' | 'supportedReasoningEfforts'
>;
```

- [ ] **Step 4: Implement conversion, reconciliation, and effort helpers**

Add to `src/models.ts`:

```ts
export function modelProfilesFromCodexCatalog(
  catalog: readonly CodexModelCatalogItem[] | null | undefined,
): ModelProfile[] {
  const dynamic = (catalog ?? [])
    .filter((item) => !item.hidden && item.id.trim() && item.displayName.trim())
    .map((item) => ({
      id: item.id.trim(),
      label: item.displayName.trim(),
      providerId: 'openai',
      model: item.id.trim(),
      wireApi: 'responses' as const,
      enabled: true,
      supportsReasoningEffort: item.supportedReasoningEfforts.length > 0,
      builtIn: true,
      isDefault: item.isDefault,
      defaultReasoningEffort: item.defaultReasoningEffort,
      supportedReasoningEfforts: item.supportedReasoningEfforts.map((effort) => ({ ...effort })),
    }));
  return dynamic.length > 0 ? dynamic : defaultModelProfiles();
}

export interface ReconciledModelSelection {
  selectedModelProfileId: string;
  reasoningEffort: ReasoningEffort;
}

export function reconcileModelSelection(input: {
  profiles: readonly ModelProfile[];
  selectedModelProfileId: string;
  reasoningEffort: ReasoningEffort;
  previousSelectedProfile?: ModelProfile;
}): ReconciledModelSelection {
  const enabled = input.profiles.filter((profile) => profile.enabled);
  const previous = input.previousSelectedProfile;
  const identityMatch = previous
    ? enabled.find((profile) => (
        profile.providerId === previous.providerId
        && profile.model === previous.model
        && profile.wireApi === previous.wireApi
      ))
    : undefined;
  const idMatch = enabled.find((profile) => profile.id === input.selectedModelProfileId);
  const idStillHasSameIdentity = !previous || Boolean(
    idMatch
    && idMatch.providerId === previous.providerId
    && idMatch.model === previous.model
    && idMatch.wireApi === previous.wireApi,
  );
  const selected = identityMatch
    ?? (idStillHasSameIdentity ? idMatch : undefined)
    ?? enabled.find((profile) => profile.isDefault)
    ?? enabled.find((profile) => profile.builtIn)
    ?? enabled[0]
    ?? BUILTIN_MODEL_PROFILES[0];
  return {
    selectedModelProfileId: selected.id,
    reasoningEffort: resolveReasoningEffortForProfile(selected, input.reasoningEffort),
  };
}
```

Replace the effort definitions with:

```ts
export interface EffortOption {
  id: ReasoningEffort;
  label: string;
}

export const EFFORT_OPTIONS: EffortOption[] = [
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '超高' },
];

export const ALL_EFFORT_OPTIONS: EffortOption[] = [
  ...EFFORT_OPTIONS,
  { id: 'max', label: 'Max' },
  { id: 'ultra', label: 'Ultra' },
];

export const DEFAULT_EFFORT: ReasoningEffort = 'xhigh';

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return ALL_EFFORT_OPTIONS.some((option) => option.id === value);
}

export function reasoningEffortOptionsForProfile(profile: ModelProfile): EffortOption[] {
  if (!profile.supportsReasoningEffort) return [];
  if (profile.supportedReasoningEfforts !== undefined) {
    const seen = new Set<ReasoningEffort>();
    return profile.supportedReasoningEfforts.flatMap(({ reasoningEffort }) => {
      if (seen.has(reasoningEffort) || !isReasoningEffort(reasoningEffort)) return [];
      seen.add(reasoningEffort);
      return [{ id: reasoningEffort, label: effortLabel(reasoningEffort) }];
    });
  }
  return EFFORT_OPTIONS.map((option) => ({ ...option }));
}

export function resolveReasoningEffortForProfile(
  profile: ModelProfile,
  requested: ReasoningEffort,
): ReasoningEffort {
  const options = reasoningEffortOptionsForProfile(profile);
  if (options.some((option) => option.id === requested)) return requested;
  if (
    profile.defaultReasoningEffort
    && options.some((option) => option.id === profile.defaultReasoningEffort)
  ) {
    return profile.defaultReasoningEffort;
  }
  return options[0]?.id ?? DEFAULT_EFFORT;
}

export function effortLabel(id: string): string {
  return ALL_EFFORT_OPTIONS.find((effort) => effort.id === id)?.label ?? id;
}
```

Update `selectedModelProfileId()` so its final order is current enabled ID, legacy match, enabled `isDefault`, first enabled built-in, first enabled profile, then `DEFAULT_MODEL_PROFILE_ID`.

- [ ] **Step 5: Add failing license merge tests**

Extend `src/license.test.ts` with a catalog-derived subscription profile list and these assertions:

```ts
it('uses the supplied Codex subscription catalog without changing gateway order', () => {
  const session = loadClientLicenseSession()!;
  const dynamic = modelProfilesFromCodexCatalog(catalog);

  const profiles = modelProfilesFromClientLicense(session, dynamic);

  expect(profiles.slice(0, 2).map((profile) => profile.id)).toEqual([
    'gpt-5.6-sol', 'gpt-5.6-terra',
  ]);
  expect(profiles.filter((profile) => profile.providerId === ALPHA_GATEWAY_PROVIDER_ID).map((profile) => profile.model))
    .toEqual(session.models.filter((model) => model.enabled && model.mode === 'gateway_api').map((model) => model.id));
});

it('prefixes a gateway id that collides with the dynamic subscription catalog', () => {
  const session = loadClientLicenseSession()!;
  session.models = [{
    id: 'gpt-5.6-sol',
    label: 'GPT-5.6 Sol API',
    provider: 'openai',
    mode: 'gateway_api',
    enabled: true,
  }];

  const profiles = modelProfilesFromClientLicense(session, modelProfilesFromCodexCatalog(catalog));

  expect(profiles.map((profile) => profile.id)).toContain('gateway:gpt-5.6-sol');
});

it('ignores supplied subscription profiles when the tenant lacks subscription access', () => {
  const session = loadClientLicenseSession()!;
  session.tenant.codexSubscriptionEnabled = false;

  const profiles = modelProfilesFromClientLicense(session, modelProfilesFromCodexCatalog(catalog));

  expect(profiles.some((profile) => profile.builtIn)).toBe(false);
  expect(profiles.some((profile) => profile.providerId === ALPHA_GATEWAY_PROVIDER_ID)).toBe(true);
});
```

Import the shared `catalog` fixture from a small exported test constant in `src/models.test.ts` is not allowed because tests should not depend on another test module. Define the same two-item typed fixture locally in `src/license.test.ts`.

- [ ] **Step 6: Inject subscription profiles without changing Gateway mapping**

Replace the license helper signature and first line with:

```ts
export function modelProfilesFromClientLicense(
  session: ClientLicenseSession,
  availableSubscriptionProfiles: readonly ModelProfile[] = defaultModelProfiles(),
): ModelProfile[] {
  const subscriptionProfiles = session.tenant.codexSubscriptionEnabled
    ? availableSubscriptionProfiles.map((profile) => ({ ...profile }))
    : [];
```

Keep the existing `occupied` set, `session.models` filter, Gateway order, `gateway:` prefix, provider ID, wire API, and return concatenation unchanged.

- [ ] **Step 7: Run domain and license tests**

Run:

```bash
npm run test:run -- src/models.test.ts
npm run test:run -- src/license.test.ts
```

Expected: all model-domain and license tests pass.

- [ ] **Step 8: Commit only Task 3 files and hunks**

```bash
git add src/models.test.ts
git add -p src/types.ts src/models.ts src/license.ts src/license.test.ts
git diff --cached --check
git diff --cached -- src/types.ts src/models.ts src/models.test.ts src/license.ts src/license.test.ts
git commit -m "feat: derive model profiles from Codex catalog"
```

Expected: only the catalog domain, effort domain, license injection, and their tests are staged.

---

### Task 4: Add the bridge and ephemeral store refresh lifecycle

**Files:**
- Modify: `src/codexBridge.ts:83-115`
- Create: `src/codexBridge.test.ts`
- Modify: `src/store.ts:14-1806`
- Create: `src/store.catalog.test.ts`

**Interfaces:**
- Consumes: Task 2's `codex_models` command and Task 3's DTO/domain helpers.
- Produces: `listCodexModels(forceRefetch)`, ephemeral catalog state, `refreshCodexModels()`, option-aware `refreshCodexStatus()`, and atomic `setModelSelection()` for Task 5 and Task 6.

- [ ] **Step 1: Create the failing bridge tests**

Create `src/codexBridge.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listCodexModels } from './codexBridge';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

describe('Codex model catalog bridge', () => {
  beforeEach(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    vi.mocked(invoke).mockResolvedValue([]);
  });

  afterEach(() => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    vi.clearAllMocks();
  });

  it('invokes codex_models with the requested forceRefetch flag', async () => {
    await listCodexModels(true);

    expect(invoke).toHaveBeenCalledWith('codex_models', {
      request: { forceRefetch: true },
    });
  });

  it('returns an empty catalog outside the Tauri runtime', async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    await expect(listCodexModels(false)).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the bridge test and confirm red**

Run:

```bash
npm run test:run -- src/codexBridge.test.ts
```

Expected: compilation fails because `listCodexModels()` is not exported.

- [ ] **Step 3: Add the typed bridge**

Import `CodexModelCatalogItem` from `./types` and add:

```ts
export async function listCodexModels(
  forceRefetch: boolean,
): Promise<CodexModelCatalogItem[]> {
  if (!isTauriRuntime()) return [];
  return invoke<CodexModelCatalogItem[]>('codex_models', {
    request: { forceRefetch },
  });
}
```

Run `npm run test:run -- src/codexBridge.test.ts`; expected: 2 tests pass.

- [ ] **Step 4: Create isolated failing store catalog tests**

Create `src/store.catalog.test.ts` with a hoisted bridge mock and the critical lifecycle cases:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ALPHA_GATEWAY_PROVIDER_ID, type ClientLicenseSession } from './license';
import { defaultModelProfiles } from './models';
import type { CodexModelCatalogItem, CodexStatus } from './types';

const bridge = vi.hoisted(() => ({
  checkCodex: vi.fn<() => Promise<CodexStatus>>(),
  listCodexModels: vi.fn<(forceRefetch: boolean) => Promise<CodexModelCatalogItem[]>>(),
}));

vi.mock('./codexBridge', () => ({
  checkCodex: bridge.checkCodex,
  listCodexModels: bridge.listCodexModels,
  isTauriRuntime: () => false,
  loadModelConfig: vi.fn().mockResolvedValue(null),
  saveModelConfig: vi.fn().mockResolvedValue(null),
  startCodexChat: vi.fn(),
  stopCodexChat: vi.fn(),
  subscribeCodexEvents: vi.fn().mockResolvedValue(() => undefined),
}));

import { useChatStore } from './store';

const catalog: CodexModelCatalogItem[] = [{
  id: 'gpt-5.6-sol',
  displayName: 'GPT-5.6 Sol',
  isDefault: true,
  hidden: false,
  defaultReasoningEffort: 'max',
  supportedReasoningEfforts: [
    { reasoningEffort: 'high', description: 'Thorough' },
    { reasoningEffort: 'max', description: 'Maximum' },
    { reasoningEffort: 'ultra', description: 'Ultra' },
  ],
}];

const authorized: CodexStatus = {
  installed: true,
  version: 'test',
  path: '/usr/bin/codex',
  loggedIn: true,
};

function gatewaySession(): ClientLicenseSession {
  return {
    apiBaseUrl: 'https://gateway.example.test',
    activatedAt: 1,
    tenant: {
      id: 'tenant',
      name: 'Tenant',
      maxDevices: 1,
      codexSubscriptionEnabled: true,
    },
    user: { id: 'user', email: 'user@example.test', name: 'User' },
    device: { id: 'device', leaseExpiresAt: '2099-01-01T00:00:00Z' },
    models: [{
      id: 'gpt-5.5',
      label: 'GPT-5.5 API',
      provider: 'openai',
      mode: 'gateway_api',
      enabled: true,
    }],
    codexAccounts: [],
  };
}

describe('Codex model catalog store lifecycle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    bridge.checkCodex.mockReset();
    bridge.listCodexModels.mockReset();
    useChatStore.setState({
      codexStatus: null,
      clientLicenseSession: gatewaySession(),
      codexModelCatalog: null,
      codexModelCatalogError: null,
      isRefreshingCodexModels: false,
      modelProfiles: defaultModelProfiles(),
      selectedModelProfileId: 'gpt-5.5',
      reasoningEffort: 'xhigh',
    });
  });

  it('loads the authorized startup catalog with forceRefetch false', async () => {
    bridge.checkCodex.mockResolvedValue(authorized);
    bridge.listCodexModels.mockResolvedValue(catalog);

    await useChatStore.getState().refreshCodexStatus();

    expect(bridge.listCodexModels).toHaveBeenCalledWith(false);
    expect(useChatStore.getState().modelProfiles.map((profile) => profile.id)).toEqual([
      'gpt-5.6-sol', 'gpt-5.5',
    ]);
    expect(useChatStore.getState()).toMatchObject({
      selectedModelProfileId: 'gpt-5.6-sol',
      reasoningEffort: 'max',
    });
  });

  it('forces refresh when authorization changes and on explicit recheck', async () => {
    useChatStore.setState({ codexStatus: { ...authorized, loggedIn: false } });
    bridge.checkCodex.mockResolvedValue(authorized);
    bridge.listCodexModels.mockResolvedValue(catalog);

    await useChatStore.getState().refreshCodexStatus();
    await useChatStore.getState().refreshCodexStatus({ forceModelRefetch: true });

    expect(bridge.listCodexModels).toHaveBeenNthCalledWith(1, true);
    expect(bridge.listCodexModels).toHaveBeenNthCalledWith(2, true);
  });

  it('does not issue duplicate model requests while a refresh is in flight', async () => {
    let resolveCatalog!: (value: CodexModelCatalogItem[]) => void;
    bridge.listCodexModels.mockReturnValue(new Promise((resolve) => {
      resolveCatalog = resolve;
    }));

    const first = useChatStore.getState().refreshCodexModels(false);
    const second = useChatStore.getState().refreshCodexModels(false);
    expect(bridge.listCodexModels).toHaveBeenCalledTimes(1);
    resolveCatalog(catalog);
    await Promise.all([first, second]);
  });

  it('keeps the last successful catalog and Gateway profile after a later failure', async () => {
    bridge.listCodexModels.mockResolvedValueOnce(catalog);
    await useChatStore.getState().refreshCodexModels(false);
    bridge.listCodexModels.mockRejectedValueOnce(new Error('offline'));

    await useChatStore.getState().refreshCodexModels(true);

    expect(useChatStore.getState().codexModelCatalog).toEqual(catalog);
    expect(useChatStore.getState().modelProfiles.some((profile) => profile.id === 'gpt-5.6-sol')).toBe(true);
    expect(useChatStore.getState().modelProfiles.some((profile) => profile.providerId === ALPHA_GATEWAY_PROVIDER_ID)).toBe(true);
    expect(useChatStore.getState().codexModelCatalogError).toBe('offline');
  });

  it('keeps static profiles usable when the first catalog refresh fails', async () => {
    bridge.listCodexModels.mockRejectedValue(new Error('offline'));

    await useChatStore.getState().refreshCodexModels(false);

    expect(useChatStore.getState().modelProfiles.some((profile) => profile.id === 'gpt-5.5')).toBe(true);
    expect(useChatStore.getState().codexModelCatalog).toBeNull();
  });

  it('selects an available Gateway profile when Codex is unauthorized', async () => {
    bridge.checkCodex.mockResolvedValue({ ...authorized, loggedIn: false });

    await useChatStore.getState().refreshCodexStatus();

    expect(useChatStore.getState().selectedModelProfileId).toBe('gateway:gpt-5.5');
    expect(useChatStore.getState().modelProfiles.find(
      (profile) => profile.id === useChatStore.getState().selectedModelProfileId,
    )?.providerId).toBe(ALPHA_GATEWAY_PROVIDER_ID);
  });

  it('does not persist remote subscription profiles', async () => {
    bridge.listCodexModels.mockResolvedValue(catalog);
    await useChatStore.getState().refreshCodexModels(false);

    const persisted = JSON.parse(window.localStorage.getItem('alpha-studio.chat.v2') ?? '{}');
    const profiles = persisted.state?.modelProfiles ?? [];
    expect(profiles.some((profile: { id: string }) => profile.id === 'gpt-5.6-sol')).toBe(false);
  });
});
```

- [ ] **Step 5: Run the isolated store test and confirm red**

Run:

```bash
npm run test:run -- src/store.catalog.test.ts
```

Expected: compilation fails because the catalog state/actions and option-aware status refresh do not exist.

- [ ] **Step 6: Add store state, merge, refresh, and atomic selection interfaces**

Import `listCodexModels`, the Task 3 helpers, and `CodexModelCatalogItem`. Add:

```ts
interface RefreshCodexStatusOptions {
  forceModelRefetch?: boolean;
}

interface ChatState {
  codexModelCatalog: CodexModelCatalogItem[] | null;
  codexModelCatalogError: string | null;
  isRefreshingCodexModels: boolean;
  setModelSelection: (id: string, requestedEffort?: ReasoningEffort) => void;
  refreshCodexModels: (forceRefetch: boolean) => Promise<void>;
  refreshCodexStatus: (options?: RefreshCodexStatusOptions) => Promise<void>;
}
```

Add initial values beside the existing Codex status state:

```ts
codexModelCatalog: null,
codexModelCatalogError: null,
isRefreshingCodexModels: false,
```

Replace the merge helper with this exported pure function:

```ts
export function modelProfilesForCurrentLicense(
  session: ClientLicenseSession | null,
  configuredProfiles: readonly ModelProfile[],
  catalog: readonly CodexModelCatalogItem[] | null,
): ModelProfile[] {
  const subscriptionProfiles = modelProfilesFromCodexCatalog(catalog);
  if (!session) {
    return mergeUniqueModelProfiles(
      subscriptionProfiles,
      configuredProfiles.filter((profile) => !profile.builtIn),
    );
  }
  return mergeUniqueModelProfiles(
    modelProfilesFromClientLicense(session, subscriptionProfiles),
    configuredProfiles.filter(isLocalModelProfile),
  );
}

function profilesSelectableForCodexStatus(
  profiles: readonly ModelProfile[],
  loggedIn: boolean,
): ModelProfile[] {
  if (loggedIn) return [...profiles];
  const withoutSubscription = profiles.filter((profile) => !profile.builtIn);
  return withoutSubscription.length > 0 ? withoutSubscription : [...profiles];
}
```

Implement atomic selection actions:

```ts
setModelSelection: (id, requestedEffort) => {
  set((state) => {
    const profile = state.modelProfiles.find((item) => item.id === id && item.enabled);
    if (!profile) return {};
    return {
      selectedModelProfileId: profile.id,
      reasoningEffort: resolveReasoningEffortForProfile(
        profile,
        requestedEffort ?? state.reasoningEffort,
      ),
    };
  });
  persistModelConfig();
},

setModelProfile: (id) => {
  get().setModelSelection(id, get().reasoningEffort);
},

setReasoningEffort: (effort) => set((state) => {
  const profile = resolveModelProfile(state.modelProfiles, state.selectedModelProfileId);
  return { reasoningEffort: resolveReasoningEffortForProfile(profile, effort) };
}),
```

Use `reconcileModelSelection()` in delete/toggle fallback and after every effective profile rebuild so the selected ID and effort are written in the same `set()` call. In `setClientLicenseSession()`, preserve a non-empty unknown selected ID only when all three conditions hold: the catalog is still `null`, the new tenant does not explicitly disable Codex subscription access, and the ID is absent from the fallback profiles. This preserves a persisted future/dynamic ID until startup discovery; otherwise reconcile immediately.

Use this exact selection branch in `setClientLicenseSession()` after building `modelProfiles`:

```ts
const preservePendingRemoteSelection = state.codexModelCatalog === null
  && session?.tenant.codexSubscriptionEnabled !== false
  && state.selectedModelProfileId.trim().length > 0
  && !modelProfiles.some((profile) => profile.id === state.selectedModelProfileId);
const selection = preservePendingRemoteSelection
  ? {
      selectedModelProfileId: state.selectedModelProfileId,
      reasoningEffort: state.reasoningEffort,
    }
  : reconcileModelSelection({
      profiles: modelProfiles,
      selectedModelProfileId: state.selectedModelProfileId,
      reasoningEffort: state.reasoningEffort,
      previousSelectedProfile: state.modelProfiles.find(
        (profile) => profile.id === state.selectedModelProfileId,
      ),
    });
```

- [ ] **Step 7: Implement refresh timing, retention, logout clearing, and diagnostics**

Add these store actions:

```ts
refreshCodexModels: async (forceRefetch) => {
  if (get().isRefreshingCodexModels) return;
  set({ isRefreshingCodexModels: true, codexModelCatalogError: null });
  try {
    const catalog = await listCodexModels(forceRefetch);
    if (catalog.length === 0) {
      throw new Error('Codex app-server returned no visible valid models.');
    }
    set((state) => {
      const previousSelectedProfile = state.modelProfiles.find(
        (profile) => profile.id === state.selectedModelProfileId,
      );
      const modelProfiles = modelProfilesForCurrentLicense(
        state.clientLicenseSession,
        state.modelProfiles,
        catalog,
      );
      const selection = reconcileModelSelection({
        profiles: modelProfiles,
        selectedModelProfileId: state.selectedModelProfileId,
        reasoningEffort: state.reasoningEffort,
        previousSelectedProfile,
      });
      return {
        codexModelCatalog: catalog,
        codexModelCatalogError: null,
        isRefreshingCodexModels: false,
        modelProfiles,
        ...selection,
      };
    });
  } catch (error) {
    set({
      codexModelCatalogError: stringifyError(error),
      isRefreshingCodexModels: false,
    });
  }
},

refreshCodexStatus: async (options = {}) => {
  const previous = get().codexStatus;
  set({ isCheckingCodex: true, error: null });
  try {
    const status = await checkCodex();
    if (!status.loggedIn) {
      set((state) => {
        const previousSelectedProfile = state.modelProfiles.find(
          (profile) => profile.id === state.selectedModelProfileId,
        );
        const modelProfiles = modelProfilesForCurrentLicense(
          state.clientLicenseSession,
          state.modelProfiles,
          null,
        );
        const selection = reconcileModelSelection({
          profiles: profilesSelectableForCodexStatus(modelProfiles, false),
          selectedModelProfileId: state.selectedModelProfileId,
          reasoningEffort: state.reasoningEffort,
          previousSelectedProfile,
        });
        return {
          codexStatus: status,
          isCheckingCodex: false,
          codexModelCatalog: null,
          codexModelCatalogError: null,
          modelProfiles,
          ...selection,
        };
      });
      return;
    }
    set({ codexStatus: status, isCheckingCodex: false });
    const startupAuthorized = previous === null;
    const newlyAuthorized = previous?.loggedIn === false;
    if (startupAuthorized || newlyAuthorized || options.forceModelRefetch === true) {
      await get().refreshCodexModels(newlyAuthorized || options.forceModelRefetch === true);
    }
  } catch (error) {
    set((state) => {
      const previousSelectedProfile = state.modelProfiles.find(
        (profile) => profile.id === state.selectedModelProfileId,
      );
      const modelProfiles = modelProfilesForCurrentLicense(
        state.clientLicenseSession,
        state.modelProfiles,
        null,
      );
      const selection = reconcileModelSelection({
        profiles: profilesSelectableForCodexStatus(modelProfiles, false),
        selectedModelProfileId: state.selectedModelProfileId,
        reasoningEffort: state.reasoningEffort,
        previousSelectedProfile,
      });
      return {
        codexStatus: {
          installed: false,
          version: '',
          path: '',
          loggedIn: false,
          error: stringifyError(error),
        },
        isCheckingCodex: false,
        codexModelCatalog: null,
        modelProfiles,
        ...selection,
      };
    });
  }
},
```

The explicit request always uses `true`; authorized startup uses `false`; the false-to-true authorization transition uses `true`.

- [ ] **Step 8: Prevent remote metadata persistence and premature fallback**

Change `persistedChatState()` to persist only non-built-in profiles:

```ts
modelProfiles: stripModelProfileSecrets(
  state.modelProfiles.filter((profile) => !profile.builtIn),
),
```

Do not add catalog/loading/error fields to `PersistedChatState`.

In `migratePersistedState()`, preserve a non-empty stored selected ID until catalog reconciliation:

```ts
const persistedSelectedModelProfileId = typeof source.selectedModelProfileId === 'string'
  ? source.selectedModelProfileId.trim()
  : '';
const selectedModelProfileId = persistedSelectedModelProfileId || resolveSelectedModelProfileId(
  undefined,
  modelProfiles,
  source.model,
);
```

Replace the local `isReasoningEffort()` with Task 3's exported helper so `max` and `ultra` survive migration.

In `loadModelConfig()`, preserve a non-empty configured selection when the catalog is still `null`; reconcile it immediately only when `get().codexModelCatalog` exists. Rebuild profiles using `modelProfilesForCurrentLicense(session, configuredProfiles, catalog)`.

At the final send boundary, clamp before forwarding:

```ts
async function codexModelRequest(profile: ModelProfile, reasoningEffort: ReasoningEffort) {
  const validatedEffort = resolveReasoningEffortForProfile(profile, reasoningEffort);
```

Use `validatedEffort` in both Gateway and non-Gateway `reasoningEffort` fields. Unsupported profiles still send `undefined`.

- [ ] **Step 9: Run focused and existing store regressions**

Run:

```bash
npm run test:run -- src/codexBridge.test.ts
npm run test:run -- src/store.catalog.test.ts
npm run test:run -- src/store.test.ts
```

Expected: bridge tests, catalog lifecycle tests, and the existing store suite all pass.

- [ ] **Step 10: Commit only Task 4 files and hunks**

```bash
git add src/codexBridge.test.ts src/store.catalog.test.ts
git add -p src/codexBridge.ts src/store.ts
git diff --cached --check
git diff --cached -- src/codexBridge.ts src/codexBridge.test.ts src/store.ts src/store.catalog.test.ts
git commit -m "feat: refresh Codex models in ephemeral state"
```

Expected: no unrelated store, prompt, event, context-window, or theme-research changes are staged.

---

### Task 5: Render catalog-specific models and reasoning efforts in chat and settings

**Files:**
- Modify: `src/App.tsx:1215-1235`
- Modify: `src/App.tsx:7576-7733`
- Modify: `src/App.tsx:9870-9965`
- Modify: `src/App.tsx:10100-10145`
- Modify: `src/App.test.tsx:12-217`
- Modify: `src/App.test.tsx:330-360`
- Modify: `src/App.test.tsx:1328-1455`

**Interfaces:**
- Consumes: Task 3's `reasoningEffortOptionsForProfile()` and Task 4's effective profiles plus refresh actions.
- Produces: catalog-backed chat picker and model settings with no render-time I/O.

- [ ] **Step 1: Add failing catalog UI fixtures and tests**

Add a hoisted mock state to `src/App.test.tsx` and handle `codex_check` plus `codex_models` in the existing `invoke` mock:

```ts
const codexCatalogMockState = vi.hoisted(() => ({
  status: {
    installed: true,
    version: 'test',
    path: '/usr/bin/codex',
    loggedIn: false,
    error: 'Alpha Studio 的 Codex CLI 尚未完成设备授权。',
  },
  models: [] as CodexModelCatalogItem[],
  error: null as Error | null,
}));

if (command === 'codex_check') {
  return Promise.resolve({ ...codexCatalogMockState.status });
}
if (command === 'codex_models') {
  if (codexCatalogMockState.error) return Promise.reject(codexCatalogMockState.error);
  return Promise.resolve(codexCatalogMockState.models);
}
```

Reset all three mock fields and Task 4's three store fields in `beforeEach`.

Define this typed fixture in the test file:

```ts
const CODEX_MODEL_CATALOG: CodexModelCatalogItem[] = [
  {
    id: 'gpt-5.6-sol',
    displayName: 'GPT-5.6 Sol',
    isDefault: true,
    hidden: false,
    defaultReasoningEffort: 'max',
    supportedReasoningEfforts: [
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
      { reasoningEffort: 'ultra', description: 'Ultra' },
    ],
  },
  {
    id: 'gpt-5.6-terra',
    displayName: 'GPT-5.6 Terra',
    isDefault: false,
    hidden: false,
    defaultReasoningEffort: 'high',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
      { reasoningEffort: 'high', description: 'Thorough' },
      { reasoningEffort: 'max', description: 'Maximum' },
    ],
  },
  {
    id: 'gpt-5.6-luna',
    displayName: 'GPT-5.6 Luna',
    isDefault: false,
    hidden: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Fast' },
      { reasoningEffort: 'medium', description: 'Balanced' },
    ],
  },
];
```

Add integration tests with these exact assertions:

```ts
it('loads authorized Codex models into the picker without changing usage-based models', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  codexCatalogMockState.status.loggedIn = true;
  codexCatalogMockState.models = CODEX_MODEL_CATALOG;
  seedClientLicenseSession(true);
  const user = userEvent.setup();
  render(<App />);

  await waitFor(() => expect(invoke).toHaveBeenCalledWith('codex_models', {
    request: { forceRefetch: false },
  }));
  await user.click(screen.getByTitle('选择模型与推理强度'));
  await user.hover(screen.getByRole('button', { name: /GPT-5.6 Sol/ }));

  expect(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Sol' })).toBeInTheDocument();
  expect(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Terra' })).toBeInTheDocument();
  expect(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Luna' })).toBeInTheDocument();
  expect(screen.getByText('GPT-5.5 API')).toBeInTheDocument();
});

it('limits efforts to the selected catalog model and clamps an invalid effort', async () => {
  useChatStore.setState({
    modelProfiles: modelProfilesFromCodexCatalog(CODEX_MODEL_CATALOG),
    selectedModelProfileId: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
  });
  const user = userEvent.setup();
  render(<App />);

  await user.click(screen.getByTitle('选择模型与推理强度'));
  expect(screen.getByRole('menuitemradio', { name: 'Ultra' })).toBeInTheDocument();
  await user.hover(screen.getByRole('button', { name: /GPT-5.6 Sol/ }));
  await user.click(screen.getByRole('menuitemradio', { name: 'GPT-5.6 Terra' }));

  expect(useChatStore.getState().reasoningEffort).toBe('high');
  await user.click(screen.getByTitle('选择模型与推理强度'));
  expect(screen.queryByRole('menuitemradio', { name: 'Ultra' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('menuitemradio').map((item) => item.textContent)).toEqual(
    expect.arrayContaining(['低', '中', '高', 'Max']),
  );
});

it('keeps the fallback picker usable when catalog refresh fails', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });
  codexCatalogMockState.status.loggedIn = true;
  codexCatalogMockState.error = new Error('catalog offline');
  const user = userEvent.setup();
  render(<App />);

  await waitFor(() => expect(useChatStore.getState().codexModelCatalogError).toBe('catalog offline'));
  await user.click(screen.getByTitle('选择模型与推理强度'));
  await user.hover(screen.getByRole('button', { name: /GPT-5.5/ }));
  expect(screen.getByRole('menuitemradio', { name: 'GPT-5.5' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused App tests and confirm red**

Run:

```bash
npm run test:run -- src/App.test.tsx -t 'loads authorized Codex models into the picker|limits efforts to the selected catalog model|keeps the fallback picker usable'
```

Expected: the dynamic models and per-model effort assertions fail against the static UI.

- [ ] **Step 3: Make the picker use the selected profile's effort list**

Import `reasoningEffortOptionsForProfile`. In `ModelPicker`, derive:

```ts
const effortOptions = useMemo(
  () => reasoningEffortOptionsForProfile(selectedModelProfile),
  [selectedModelProfile],
);
```

Delete the effect that writes the visible fallback profile back to the store before the catalog arrives. Replace the trigger effort text with:

```tsx
{effortOptions.length > 0 && (
  <span className="model-pill-effort">{effortLabel(reasoningEffort)}</span>
)}
```

Replace `EFFORT_OPTIONS.map(...)` with:

```tsx
{effortOptions.length > 0 && (
  <>
    <div className="model-menu-label">智能</div>
    {effortOptions.map((option) => (
      <button
        key={option.id}
        type="button"
        role="menuitemradio"
        aria-checked={option.id === reasoningEffort}
        className="model-menu-item"
        onMouseEnter={() => setSubmenu(null)}
        onClick={() => {
          setReasoningEffort(option.id);
          close();
        }}
      >
        <span>{option.label}</span>
        {option.id === reasoningEffort && <Check size={14} className="model-menu-check" />}
      </button>
    ))}
    <div className="model-menu-divider" />
  </>
)}
```

Add `effortOptions` to the menu-position layout effect dependency list.

- [ ] **Step 4: Apply the same effort rules in model settings and wire explicit refresh**

In the model settings component, derive:

```ts
const effortOptions = selectedProfile
  ? reasoningEffortOptionsForProfile(selectedProfile)
  : [];
```

Delete its effect that writes `visibleEnabledProfiles[0]` into the store before catalog reconciliation. Replace the unconditional settings row with:

```tsx
{effortOptions.length > 0 && (
  <SettingsRow
    title="推理强度"
    description="更高的强度更细致，但响应更慢；这里只显示当前模型支持的档位。"
  >
    <SettingsSegment
      value={reasoningEffort}
      onChange={setReasoningEffort}
      options={effortOptions}
    />
  </SettingsRow>
)}
```

Change only the existing “重新检测” button to:

```tsx
onClick={() => void refreshCodexStatus({ forceModelRefetch: true })}
```

Keep startup and authorization polling calls parameterless. The store detects initial authorization and false-to-true transitions.

- [ ] **Step 5: Run the focused and full App tests**

Run:

```bash
npm run test:run -- src/App.test.tsx -t 'loads authorized Codex models into the picker|limits efforts to the selected catalog model|keeps the fallback picker usable'
npm run test:run -- src/App.test.tsx
```

Expected: focused catalog tests and every existing App test pass.

- [ ] **Step 6: Commit only Task 5 UI and test hunks**

```bash
git add -p src/App.tsx src/App.test.tsx
git diff --cached --check
git diff --cached -- src/App.tsx src/App.test.tsx
git commit -m "feat: show model-specific Codex reasoning options"
```

Expected: unrelated App UI and CSS changes remain unstaged.

---

### Task 6: Migrate automations to stable profile IDs and apply their real model selection

**Files:**
- Modify: `src/automation.ts:1-165`
- Modify: `src/automation.test.ts:1-75`
- Modify: `src/store.ts:340-365`
- Modify: `src/App.tsx:4490-5040`
- Modify: `src/App.test.tsx:935-1085`

**Interfaces:**
- Consumes: Task 3's profile/effort helpers and Task 4's atomic `setModelSelection()`.
- Produces: backward-compatible automation records with `model`, optional `modelProfileId`, and optional `reasoningEffort`; dynamic automation model/effort controls; real selection application before `sendMessage()`.

- [ ] **Step 1: Add failing automation schema and compatibility tests**

Extend `src/automation.test.ts`:

```ts
it('stores stable default model metadata for new tasks', () => {
  const task = addScheduledAutomationTask({
    title: '',
    prompt: '提醒我喝水。',
    environment: '当前对话',
    project: '选择项目',
    schedule: '每 5 分钟',
    model: 'GPT-5.5',
    modelProfileId: 'gpt-5.5',
    reasoningEffort: 'xhigh',
  });

  expect(task).toMatchObject({
    model: 'GPT-5.5',
    modelProfileId: 'gpt-5.5',
    reasoningEffort: 'xhigh',
  });
});

it('keeps legacy model-only tasks loadable', () => {
  window.localStorage.setItem(AUTOMATION_TASKS_KEY, JSON.stringify([{
    id: 'legacy',
    title: '旧任务',
    prompt: '执行旧任务',
    environment: '当前对话',
    project: '选择项目',
    schedule: '每天 9:00',
    model: 'GPT-5.5 超高',
    createdAt: 1,
  }]));

  expect(loadScheduledAutomationTasks()).toEqual([
    expect.objectContaining({ id: 'legacy', model: 'GPT-5.5 超高' }),
  ]);
});
```

Add App tests:

```ts
it('offers dynamic catalog profiles and model-specific efforts in automation editor', async () => {
  useChatStore.setState({
    modelProfiles: modelProfilesFromCodexCatalog(CODEX_MODEL_CATALOG),
    selectedModelProfileId: 'gpt-5.6-sol',
    reasoningEffort: 'ultra',
  });
  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole('button', { name: '自动化' }));
  const page = container.querySelector('.automation-page') as HTMLElement;
  await user.click(within(page).getByRole('button', { name: '手动创建' }));
  const editor = within(page).getByRole('complementary', { name: '手动创建自动化任务' });
  const model = within(editor).getByLabelText('模型') as HTMLSelectElement;
  const effort = within(editor).getByLabelText('推理强度') as HTMLSelectElement;

  expect(Array.from(model.options).map((option) => option.value)).toEqual([
    'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna',
  ]);
  expect(Array.from(effort.options).map((option) => option.value)).toEqual([
    'high', 'max', 'ultra',
  ]);
  await user.selectOptions(model, 'gpt-5.6-terra');
  expect(effort).toHaveValue('high');
  expect(Array.from(effort.options).map((option) => option.value)).not.toContain('ultra');
});

it('migrates a legacy automation model string before running', async () => {
  window.localStorage.setItem(AUTOMATION_TASKS_KEY, JSON.stringify([{
    id: 'legacy',
    title: '旧任务',
    prompt: '执行旧任务',
    environment: '当前对话',
    project: '选择项目',
    schedule: '每天 9:00',
    model: 'GPT-5.5 超高',
    createdAt: 1,
  }]));
  useChatStore.setState({
    modelProfiles: defaultModelProfiles(),
    selectedModelProfileId: 'gpt-5.4',
    reasoningEffort: 'low',
    sendMessage: vi.fn().mockResolvedValue(undefined),
  });
  const user = userEvent.setup();
  const { container } = render(<App />);
  await user.click(screen.getByRole('button', { name: '自动化' }));
  const row = within(container.querySelector('.automation-page') as HTMLElement)
    .getByRole('button', { name: /旧任务/ })
    .closest('.automation-task-row') as HTMLElement;

  await user.click(within(row).getByRole('button', { name: '立即执行' }));

  expect(useChatStore.getState()).toMatchObject({
    selectedModelProfileId: 'gpt-5.5',
    reasoningEffort: 'xhigh',
  });
  expect(useChatStore.getState().sendMessage).toHaveBeenCalledWith(expect.stringContaining('模型：GPT-5.5'));
});
```

- [ ] **Step 2: Run the focused automation tests and confirm red**

Run:

```bash
npm run test:run -- src/automation.test.ts
npm run test:run -- src/App.test.tsx -t 'offers dynamic catalog profiles and model-specific efforts in automation editor|migrates a legacy automation model string before running'
```

Expected: the schema metadata, dynamic options, effort select, and real model application assertions fail.

- [ ] **Step 3: Extend automation records without invalidating old JSON**

Import `DEFAULT_EFFORT`, `DEFAULT_MODEL_PROFILE_ID`, `isReasoningEffort`, and `ReasoningEffort` into `src/automation.ts`. Use:

```ts
export const DEFAULT_AUTOMATION_MODEL = 'GPT-5.5';

export interface AutomationFormState {
  title: string;
  prompt: string;
  environment: string;
  project: string;
  schedule: string;
  model: string;
  modelProfileId?: string;
  reasoningEffort?: ReasoningEffort;
  conversationId?: string;
}
```

Set these fields in `blankAutomationForm()` and `detectAutomationIntent()`:

```ts
model: DEFAULT_AUTOMATION_MODEL,
modelProfileId: DEFAULT_MODEL_PROFILE_ID,
reasoningEffort: DEFAULT_EFFORT,
```

Extend `isScheduledAutomationTask()` with:

```ts
(task.modelProfileId === undefined || typeof task.modelProfileId === 'string') &&
(task.reasoningEffort === undefined || isReasoningEffort(task.reasoningEffort)) &&
```

Keep `model: string` required so every old record remains readable and every new record retains a human-readable snapshot.

- [ ] **Step 4: Add one compatibility resolver and dynamic automation option groups**

Add to `src/App.tsx`:

```ts
function resolveAutomationSelection(
  form: Pick<AutomationFormState, 'model' | 'modelProfileId' | 'reasoningEffort'>,
  profiles: ModelProfile[],
  fallbackProfileId: string,
  fallbackEffort: ReasoningEffort,
) {
  const legacyEffort: ReasoningEffort | undefined = form.model.endsWith(' 超高')
    ? 'xhigh'
    : form.model.endsWith(' 高')
      ? 'high'
      : form.model.endsWith(' 标准')
        ? 'medium'
        : undefined;
  const legacyLabel = form.model.replace(/\s+(超高|高|标准)$/, '');
  const profile = profiles.find((item) => item.id === form.modelProfileId)
    ?? profiles.find((item) => item.label === legacyLabel)
    ?? resolveModelProfile(profiles, fallbackProfileId);
  return {
    profile,
    reasoningEffort: resolveReasoningEffortForProfile(
      profile,
      form.reasoningEffort ?? legacyEffort ?? fallbackEffort,
    ),
  };
}
```

Replace the static automation option helper with:

```ts
function automationModelOptionGroups(
  modelProfiles: ModelProfile[],
  codexStatus: { loggedIn: boolean } | null,
  session: ClientLicenseSession | null,
): AutomationSelectGroup[] {
  const visible = visibleModelProfilesForCodexStatus(
    modelProfiles.filter((profile) => profile.enabled),
    codexStatus,
    session,
  );
  return [
    {
      label: '订阅模型',
      options: visible
        .filter((profile) => profile.builtIn)
        .map((profile) => ({ value: profile.id, label: profile.label })),
    },
    {
      label: '按量付费模型',
      options: visible
        .filter((profile) => !profile.builtIn)
        .map((profile) => ({ value: profile.id, label: profile.label })),
    },
  ].filter((group) => group.options.length > 0);
}
```

Remove `AUTOMATION_MODEL_OPTIONS`, `automationSubscriptionModelLabel()`, and `isAutomationSubscriptionModelOption()` from App imports and helpers.

- [ ] **Step 5: Render separate stable model and model-specific effort controls**

In `AutomationsPage`, resolve the form against visible profiles and current store fallback:

```ts
const selectedModelProfileId = useChatStore((state) => state.selectedModelProfileId);
const currentReasoningEffort = useChatStore((state) => state.reasoningEffort);
const visibleAutomationProfiles = visibleModelProfilesForCodexStatus(
  modelProfiles.filter((profile) => profile.enabled),
  codexStatus,
  clientLicenseSession,
);
const automationSelection = resolveAutomationSelection(
  form,
  visibleAutomationProfiles,
  selectedModelProfileId,
  currentReasoningEffort,
);
const automationEffortOptions = reasoningEffortOptionsForProfile(automationSelection.profile);
```

On model change, update all compatibility fields atomically:

```ts
const updateAutomationModel = (id: string) => {
  const profile = visibleAutomationProfiles.find((item) => item.id === id);
  if (!profile) return;
  setForm((current) => ({
    ...current,
    model: profile.label,
    modelProfileId: profile.id,
    reasoningEffort: resolveReasoningEffortForProfile(
      profile,
      current.reasoningEffort ?? currentReasoningEffort,
    ),
  }));
};
```

Pass `modelValue`, `effortValue`, `effortOptions`, `onModelChange`, and `onEffortChange` into `AutomationManualEditor`. Set `modelValue` to `automationSelection.profile.id` and `effortValue` to `automationSelection.reasoningEffort`. Render:

```tsx
<AutomationEditorSelect
  label="模型"
  value={modelValue}
  options={modelOptions}
  onChange={onModelChange}
/>
{effortOptions.length > 0 && (
  <AutomationEditorSelect
    label="推理强度"
    value={effortValue}
    options={effortOptions.map(({ id, label }) => ({ value: id, label }))}
    onChange={(value) => onEffortChange(value as ReasoningEffort)}
  />
)}
```

When opening a template, call `blankAutomationForm()` and overlay the template's title, prompt, environment, and schedule. When inspecting a task, resolve it once and put its stable ID, label, and clamped effort into the form. When saving, always write the resolved `model`, `modelProfileId`, and `reasoningEffort` fields.

- [ ] **Step 6: Apply an automation's selection before sending**

In `runTaskNow()` resolve against `state.modelProfiles`, then apply the atomic store action before calling `sendMessage()`:

```ts
const selection = resolveAutomationSelection(
  task,
  state.modelProfiles,
  state.selectedModelProfileId,
  state.reasoningEffort,
);
state.setModelSelection(selection.profile.id, selection.reasoningEffort);
void sendMessage(automationRunPrompt(
  task,
  selection.profile.label,
  selection.profile.supportsReasoningEffort ? selection.reasoningEffort : undefined,
));
```

Change the prompt helper to:

```ts
function automationRunPrompt(
  task: ScheduledAutomationTask,
  modelLabel: string,
  reasoningEffort?: ReasoningEffort,
): string {
  const lines = [
    `请立即执行已安排任务「${task.title}」。`,
    `运行环境：${task.environment}`,
    task.project === '选择项目' ? null : `项目：${task.project}`,
    `原计划：${task.schedule}`,
    `模型：${modelLabel}`,
    reasoningEffort ? `推理强度：${effortLabel(reasoningEffort)}` : null,
    '',
    task.prompt,
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}
```

In `src/store.ts`, when `detectAutomationIntent()` succeeds, attach the current real selection before saving:

```ts
const profile = resolveModelProfile(get().modelProfiles, get().selectedModelProfileId);
const task = addScheduledAutomationTask({
  ...automationIntent,
  model: profile.label,
  modelProfileId: profile.id,
  reasoningEffort: resolveReasoningEffortForProfile(profile, get().reasoningEffort),
  conversationId,
});
```

Update the existing `offers richer automation schedules and usage-based models` App test for stable option values:

```ts
const modelSelect = within(editor).getByLabelText('模型') as HTMLSelectElement;
expect(Array.from(modelSelect.options).map((option) => option.value)).toContain('gateway:gpt-5.5');
expect(Array.from(modelSelect.options).map((option) => option.textContent)).toContain('GPT-5.5 API');
await user.selectOptions(modelSelect, 'gateway:gpt-5.5');
expect(modelSelect).toHaveValue('gateway:gpt-5.5');
```

- [ ] **Step 7: Run automation, App, and store regressions**

Run:

```bash
npm run test:run -- src/automation.test.ts
npm run test:run -- src/App.test.tsx -t 'offers dynamic catalog profiles and model-specific efforts in automation editor|migrates a legacy automation model string before running|offers richer automation schedules and usage-based models'
npm run test:run -- src/store.test.ts -t 'automation'
npm run test:run -- src/App.test.tsx
```

Expected: new and old automation records work, dynamic options and effort clamping pass, immediate runs use the real profile, and existing automation/App tests pass.

- [ ] **Step 8: Commit only Task 6 automation hunks**

```bash
git add -p src/automation.ts src/automation.test.ts src/store.ts src/App.tsx src/App.test.tsx
git diff --cached --check
git diff --cached -- src/automation.ts src/automation.test.ts src/store.ts src/App.tsx src/App.test.tsx
git commit -m "feat: use runtime model profiles in automations"
```

Expected: only automation schema, resolution, UI, execution, and tests are staged; unrelated worktree changes remain untouched.

---

### Task 7: Verify the complete runtime fix and document the handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-07-10-codex-model-catalog-sync-design.md:3`
- Verify: `src-tauri/src/lib.rs`
- Verify: `src/types.ts`
- Verify: `src/models.ts`
- Verify: `src/license.ts`
- Verify: `src/codexBridge.ts`
- Verify: `src/store.ts`
- Verify: `src/automation.ts`
- Verify: `src/App.tsx`

**Interfaces:**
- Consumes: all Task 1-6 deliverables.
- Produces: evidence that both the CLI detection fix and dynamic GPT-5.6 catalog fix work without Gateway regressions or persisted account metadata.

- [ ] **Step 1: Run formatting/diff hygiene checks**

Run:

```bash
git diff --check
git status --short --branch
```

Expected: `git diff --check` prints nothing. Status still lists unrelated user changes as unstaged, and only task commits are ahead of the branch base.

- [ ] **Step 2: Run the complete Rust suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Expected: every Rust test passes, including bundled ChatGPT path detection, JSON-RPC pagination, strict catalog normalization, repeated-cursor rejection, empty-catalog rejection, and max/ultra sanitization.

- [ ] **Step 3: Run the complete frontend suite and production build**

Run:

```bash
npm run test:run
npm run build
```

Expected: all Vitest tests pass; TypeScript compilation and Vite production build complete successfully. Existing Vite chunk-size or dynamic-import warnings are acceptable only if they match the pre-change baseline and do not fail the build.

- [ ] **Step 4: Inspect persistence artifacts in tests**

Run:

```bash
npm run test:run -- src/store.catalog.test.ts -t 'does not persist remote subscription profiles'
```

Expected: the persisted `modelProfiles` array contains no `gpt-5.6-sol`, `gpt-5.6-terra`, or `gpt-5.6-luna` built-in profile and no effort descriptions.

- [ ] **Step 5: Perform the live Tauri acceptance check**

Run:

```bash
npm run tauri:dev
```

In the opened Alpha Studio window:

1. Open model settings and click “重新检测”.
2. Confirm runtime status is ready and the subscription group contains GPT-5.6 Sol, Terra, and Luna.
3. Select Sol and confirm its menu includes the server-returned `Max` and `Ultra` entries.
4. Select Terra and confirm `Ultra` disappears and the effort atomically becomes Terra's default `高` when necessary.
5. Confirm the usage-based group still shows the same Gateway models in the same order.
6. Open Automations, confirm the same three GPT-5.6 models appear, and confirm each model's effort selector is constrained to its catalog metadata.
7. Revoke authorization and confirm account-scoped dynamic entries disappear; reauthorize and confirm they refresh again.

Expected: all seven observations match without editing the static built-in array or Alpha Gateway catalog.

- [ ] **Step 6: Review the final diff against the approved spec**

Run:

```bash
git log --oneline --decorate -8
git diff origin/alpha_studio...HEAD -- docs/superpowers src-tauri/src/lib.rs src/types.ts src/models.ts src/license.ts src/codexBridge.ts src/store.ts src/automation.ts src/App.tsx
git status --short
```

Expected: committed changes cover the approved design and this plan; unrelated pre-existing files/hunks remain unstaged and unmodified by task commits.

- [ ] **Step 7: Commit the approved-status documentation hunk if it was not included earlier**

```bash
git add -p docs/superpowers/specs/2026-07-10-codex-model-catalog-sync-design.md
git diff --cached --check
git diff --cached -- docs/superpowers/specs/2026-07-10-codex-model-catalog-sync-design.md
git commit -m "docs: mark Codex catalog design approved"
```

Expected: the only staged change is `Status: approved`; skip this commit if that exact hunk is already committed with the plan.
