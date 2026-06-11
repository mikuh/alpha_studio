use base64::Engine as _;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

const CODEX_CHAT_EVENT: &str = "codex-chat-event";
const TERMINAL_EVENT: &str = "terminal-event";

static RUN_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct CodexProcessState {
    children: Arc<Mutex<HashMap<String, Child>>>,
    // Run ids the user explicitly stopped. The driver checks this when its turn
    // ends so a user-initiated kill is reported as a single `stopped` event
    // rather than surfacing the torn-down stdio pipe as an `error`.
    stopped: Arc<Mutex<HashSet<String>>>,
    chat_reasoning_by_conversation: Arc<StdMutex<HashMap<String, HashMap<String, String>>>>,
}

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn PtyChild + Send + Sync>,
}

#[derive(Default, Clone)]
struct TerminalState {
    sessions: Arc<StdMutex<HashMap<String, TerminalSession>>>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexCheckResult {
    installed: bool,
    version: String,
    path: String,
    logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatRequest {
    conversation_id: String,
    prompt: String,
    codex_thread_id: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    provider_id: Option<String>,
    provider_base_url: Option<String>,
    provider_api_key: Option<String>,
    provider_wire_api: Option<String>,
    provider_thinking_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    sandbox_mode: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct ModelProviderConfig {
    id: String,
    base_url: String,
    api_key: Option<String>,
    wire_api: Option<String>,
    adapter: Option<ModelProviderAdapter>,
    show_raw_reasoning: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct ModelProviderAdapter {
    upstream_base_url: String,
    api_key: Option<String>,
    thinking_enabled: bool,
}

struct ChatAdapterHandle {
    base_url: String,
    shutdown: oneshot::Sender<()>,
}

#[derive(Clone)]
struct ChatAdapterState {
    conversation_id: String,
    reasoning_by_conversation: Arc<StdMutex<HashMap<String, HashMap<String, String>>>>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelProfileConfig {
    id: String,
    label: String,
    provider_id: String,
    model: String,
    wire_api: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    base_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    api_key: Option<String>,
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    supports_reasoning_effort: bool,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigSaveRequest {
    selected_model_profile_id: Option<String>,
    model_profiles: Vec<ModelProfileConfig>,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigLoadResult {
    #[serde(default = "default_model_config_version")]
    version: u32,
    selected_model_profile_id: Option<String>,
    #[serde(default)]
    model_profiles: Vec<ModelProfileConfig>,
    #[serde(default)]
    path: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelConfigSaveResult {
    path: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatStartResult {
    run_id: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatStopRequest {
    run_id: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatStopResult {
    stopped: bool,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenInAppRequest {
    app: String,
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrandDirectoryCreateRequest {
    parent: String,
    name: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BrandDirectoryCreateResult {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartRequest {
    cwd: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResult {
    session_id: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteRequest {
    session_id: String,
    data: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStopRequest {
    session_id: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeRequest {
    session_id: String,
    rows: u16,
    cols: u16,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalEvent {
    #[serde(rename = "type")]
    event_type: String,
    session_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    chunk: Option<String>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffStat {
    files_changed: u32,
    additions: u32,
    deletions: u32,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GhAuthStatus {
    installed: bool,
    authenticated: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    account: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCwdRequest {
    cwd: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffRequest {
    cwd: String,
    path: Option<String>,
    staged: Option<bool>,
    untracked: Option<bool>,
    context: Option<u32>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitPathsRequest {
    cwd: String,
    paths: Vec<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitApplyPatchRequest {
    cwd: String,
    patch: String,
    reverse: Option<bool>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitCommitRequest {
    cwd: String,
    message: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchRequest {
    cwd: String,
    name: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitPushRequest {
    cwd: String,
    set_upstream: Option<bool>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommandResult {
    stdout: String,
    stderr: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusResult {
    cwd: String,
    is_repository: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    clean: bool,
    changes: Vec<GitFileChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitFileChange {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    original_path: Option<String>,
    staged: bool,
    unstaged: bool,
    index_status: String,
    working_tree_status: String,
    status: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitBranch {
    name: String,
    current: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    upstream: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitRecentCommitsRequest {
    cwd: String,
    limit: Option<u32>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitCommit {
    sha: String,
    short_sha: String,
    subject: String,
    author: String,
    relative_date: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitRemote {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    fetch_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    push_url: Option<String>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatEvent {
    #[serde(rename = "type")]
    event_type: String,
    run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    conversation_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    thread_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    item_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    raw: Option<Value>,
}

#[tauri::command]
async fn codex_check() -> Result<CodexCheckResult, String> {
    Ok(check_codex())
}

#[tauri::command]
async fn model_config_load() -> Result<ModelConfigLoadResult, String> {
    let path = model_config_path()?;
    if !path.exists() {
        return Ok(ModelConfigLoadResult {
            version: 1,
            selected_model_profile_id: None,
            model_profiles: Vec::new(),
            path: path.to_string_lossy().to_string(),
        });
    }

    let text =
        fs::read_to_string(&path).map_err(|e| format!("Failed to read model config: {e}"))?;
    let mut config: ModelConfigLoadResult =
        serde_json::from_str(&text).map_err(|e| format!("Failed to parse model config: {e}"))?;
    config.path = path.to_string_lossy().to_string();
    Ok(config)
}

#[tauri::command]
async fn model_config_save(
    request: ModelConfigSaveRequest,
) -> Result<ModelConfigSaveResult, String> {
    let path = model_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create model config directory: {e}"))?;
    }
    let config = ModelConfigLoadResult {
        version: 1,
        selected_model_profile_id: request.selected_model_profile_id,
        model_profiles: request.model_profiles,
        path: path.to_string_lossy().to_string(),
    };
    let text = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to encode model config: {e}"))?;
    fs::write(&path, format!("{text}\n"))
        .map_err(|e| format!("Failed to write model config: {e}"))?;
    Ok(ModelConfigSaveResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn codex_chat_start(
    app: AppHandle,
    state: State<'_, CodexProcessState>,
    request: CodexChatRequest,
) -> Result<CodexChatStartResult, String> {
    let check = check_codex();
    if !check.installed {
        return Err(check
            .error
            .unwrap_or_else(|| "本地智能引擎未安装或无法执行。".to_string()));
    }
    if !check.logged_in {
        return Err(check
            .error
            .unwrap_or_else(|| "本地智能引擎已安装但尚未登录。".to_string()));
    }

    let run_id = generate_run_id();
    let cwd = resolve_cwd(request.cwd.as_deref())?;
    let sandbox_mode = sanitize_sandbox_mode(request.sandbox_mode.as_deref());
    let mut provider_config = sanitize_model_provider(&request)?;
    let adapter_shutdown = if let Some(provider) = provider_config.as_mut() {
        if let Some(adapter) = provider.adapter.clone() {
            let handle = start_chat_completions_adapter(
                adapter,
                state.chat_reasoning_by_conversation.clone(),
                request.conversation_id.clone(),
            )
            .await?;
            provider.base_url = handle.base_url;
            provider.wire_api = Some("responses".to_string());
            Some(handle.shutdown)
        } else {
            None
        }
    } else {
        None
    };
    // We talk to the long-running `codex app-server` over a JSON-RPC stdio
    // channel instead of `codex exec`. The exec JSONL stream only emits the
    // final assistant message in a single `item.completed`, so nothing renders
    // until the whole turn is done. The app-server protocol streams
    // `item/agentMessage/delta` notifications token-by-token, which is what
    // gives the UI a live, incremental response.
    let mut command = Command::new(&check.path);
    for arg in codex_app_server_args(provider_config.as_ref()) {
        command.arg(arg);
    }
    if let Some(provider) = &provider_config {
        if let Some(api_key) = &provider.api_key {
            command.env(provider_api_key_env(&provider.id), api_key);
        }
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.current_dir(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("NO_COLOR", "1");
    command.kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn Codex app-server: {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Codex stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open Codex stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open Codex stderr".to_string())?;

    {
        let mut children = state.children.lock().await;
        children.insert(run_id.clone(), child);
    }

    emit_event(
        &app,
        CodexChatEvent {
            event_type: "started".to_string(),
            run_id: run_id.clone(),
            conversation_id: Some(request.conversation_id.clone()),
            thread_id: request.codex_thread_id.clone(),
            item_id: None,
            title: None,
            text: None,
            message: None,
            raw: None,
        },
    );

    // Drain stderr into a bounded buffer so we can surface a useful message if
    // the app-server dies before the turn completes.
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_buffer_reader = stderr_buffer.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let mut buffer = stderr_buffer_reader.lock().await;
            if buffer.len() < 8192 {
                if !buffer.is_empty() {
                    buffer.push('\n');
                }
                buffer.push_str(trimmed);
            }
        }
    });

    let driver = CodexDriver {
        app: app.clone(),
        children: state.children.clone(),
        stopped: state.stopped.clone(),
        run_id: run_id.clone(),
        conversation_id: request.conversation_id.clone(),
        thread_id: request
            .codex_thread_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        cwd,
        sandbox_mode,
        model: request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        reasoning_effort: sanitize_reasoning_effort(request.reasoning_effort.as_deref()),
        prompt: request.prompt.clone(),
        stderr_buffer,
        adapter_shutdown,
    };

    tokio::spawn(driver.run(stdin, stdout));

    Ok(CodexChatStartResult { run_id })
}

/// Drives one Codex turn over the `codex app-server` JSON-RPC stdio protocol and
/// forwards streamed notifications to the frontend as `CodexChatEvent`s.
struct CodexDriver {
    app: AppHandle,
    children: Arc<Mutex<HashMap<String, Child>>>,
    stopped: Arc<Mutex<HashSet<String>>>,
    run_id: String,
    conversation_id: String,
    thread_id: Option<String>,
    cwd: String,
    sandbox_mode: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    prompt: String,
    stderr_buffer: Arc<Mutex<String>>,
    adapter_shutdown: Option<oneshot::Sender<()>>,
}

impl CodexDriver {
    async fn run(mut self, stdin: tokio::process::ChildStdin, stdout: tokio::process::ChildStdout) {
        let mut stdin = stdin;
        let mut reader = BufReader::new(stdout).lines();
        let outcome = self.drive(&mut stdin, &mut reader).await;

        // The app-server keeps running after the turn ends, so stop it now that
        // we are done streaming this turn.
        let child = { self.children.lock().await.remove(&self.run_id) };
        if let Some(mut child) = child {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        self.shutdown_adapter();

        // If the user stopped this run, close it out with a single `stopped`
        // event (targeted at the right conversation) and skip the error/completed
        // pair we would otherwise emit when the killed process drops its stdio.
        let was_stopped = self.stopped.lock().await.remove(&self.run_id);
        if was_stopped {
            emit_event(
                &self.app,
                event(
                    "stopped",
                    &self.run_id,
                    &self.conversation_id,
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                ),
            );
            return;
        }

        if let Err(message) = outcome {
            let stderr_text = self.stderr_buffer.lock().await.clone();
            let detail = if stderr_text.is_empty() {
                message
            } else {
                format!("{message}: {stderr_text}")
            };
            emit_event(
                &self.app,
                event(
                    "error",
                    &self.run_id,
                    &self.conversation_id,
                    None,
                    None,
                    None,
                    None,
                    Some(detail),
                    None,
                ),
            );
        }

        emit_event(
            &self.app,
            event(
                "completed",
                &self.run_id,
                &self.conversation_id,
                None,
                None,
                None,
                None,
                None,
                None,
            ),
        );
    }

    fn shutdown_adapter(&mut self) {
        if let Some(shutdown) = self.adapter_shutdown.take() {
            let _ = shutdown.send(());
        }
    }

    async fn drive(
        &self,
        stdin: &mut tokio::process::ChildStdin,
        reader: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    ) -> Result<(), String> {
        // 1. Handshake.
        send_jsonrpc(
            stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "clientInfo": {
                        "name": "alpha-studio",
                        "title": "Incuboot",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "capabilities": {
                        "experimentalApi": true,
                        "requestAttestation": false,
                    },
                },
            }),
        )
        .await?;
        await_response(reader, 1).await?;
        send_jsonrpc(
            stdin,
            &json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }),
        )
        .await?;

        // 2. Start a fresh thread, or resume the conversation's existing one.
        let mut thread_params = Map::new();
        thread_params.insert("cwd".to_string(), json!(self.cwd));
        thread_params.insert("sandbox".to_string(), json!(self.sandbox_mode));
        thread_params.insert("approvalPolicy".to_string(), json!("never"));
        if let Some(model) = &self.model {
            thread_params.insert("model".to_string(), json!(model));
        }
        let method = if let Some(thread_id) = &self.thread_id {
            thread_params.insert("threadId".to_string(), json!(thread_id));
            "thread/resume"
        } else {
            "thread/start"
        };
        send_jsonrpc(
            stdin,
            &json!({ "jsonrpc": "2.0", "id": 2, "method": method, "params": Value::Object(thread_params) }),
        )
        .await?;
        let thread_response = await_response(reader, 2).await?;
        let thread_id = self
            .thread_id
            .clone()
            .or_else(|| {
                thread_response
                    .get("result")
                    .and_then(|result| result.get("thread"))
                    .and_then(|thread| thread.get("id"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .ok_or_else(|| "Codex app-server did not return a thread id".to_string())?;

        emit_event(
            &self.app,
            event(
                "thread_started",
                &self.run_id,
                &self.conversation_id,
                Some(thread_id.clone()),
                None,
                None,
                None,
                None,
                None,
            ),
        );

        // 3. Kick off the turn with the user's prompt.
        let mut turn_params = Map::new();
        turn_params.insert("threadId".to_string(), json!(thread_id));
        turn_params.insert(
            "input".to_string(),
            json!([{ "type": "text", "text": self.prompt, "text_elements": [] }]),
        );
        if let Some(model) = &self.model {
            turn_params.insert("model".to_string(), json!(model));
        }
        if let Some(effort) = &self.reasoning_effort {
            turn_params.insert("effort".to_string(), json!(effort));
        }
        send_jsonrpc(
            stdin,
            &json!({ "jsonrpc": "2.0", "id": 3, "method": "turn/start", "params": Value::Object(turn_params) }),
        )
        .await?;

        // 4. Stream turn notifications until the turn finishes.
        let mut streamed: HashSet<String> = HashSet::new();
        loop {
            let line = match reader.next_line().await {
                Ok(Some(line)) => line,
                Ok(None) => return Err("Codex app-server closed during the turn".to_string()),
                Err(e) => return Err(format!("Failed to read from Codex app-server: {e}")),
            };
            let trimmed = line.trim();
            if trimmed.is_empty() || !trimmed.starts_with('{') {
                continue;
            }
            let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                continue;
            };

            if let Some(method) = message.get("method").and_then(Value::as_str) {
                // A message that carries both a `method` and an `id` is a
                // server-initiated JSON-RPC request (e.g. an approval or
                // elicitation prompt). The protocol blocks until we answer, so
                // failing to reply leaves the turn stuck on "正在思考" forever.
                // We approve approval/permission prompts (the user already chose
                // the sandbox/approval policy up front) and acknowledge anything
                // else, so the turn can always make progress.
                if let Some(request_id) = message.get("id").filter(|id| !id.is_null()) {
                    let lowered = method.to_ascii_lowercase();
                    let approval = lowered.contains("approv")
                        || lowered.contains("permission")
                        || lowered.contains("elicit");
                    let result = if approval {
                        json!({ "decision": "approved", "approved": true, "allow": true })
                    } else {
                        json!({})
                    };
                    let _ = send_jsonrpc(
                        stdin,
                        &json!({ "jsonrpc": "2.0", "id": request_id.clone(), "result": result }),
                    )
                    .await;
                    continue;
                }

                if method == "turn/completed" {
                    return Ok(());
                }
                let params = message.get("params").unwrap_or(&Value::Null);
                for chat_event in map_app_server_notification(
                    method,
                    params,
                    &self.run_id,
                    &self.conversation_id,
                    &mut streamed,
                ) {
                    emit_event(&self.app, chat_event);
                }
                if method == "error" {
                    if !is_retryable_app_server_error(params) {
                        return Ok(());
                    }
                }
            } else if message.get("id").is_some() {
                if let Some(error) = message.get("error") {
                    return Err(jsonrpc_error_message(error));
                }
            }
        }
    }
}

async fn send_jsonrpc(
    stdin: &mut tokio::process::ChildStdin,
    message: &Value,
) -> Result<(), String> {
    let mut bytes =
        serde_json::to_vec(message).map_err(|e| format!("Failed to encode request: {e}"))?;
    bytes.push(b'\n');
    stdin
        .write_all(&bytes)
        .await
        .map_err(|e| format!("Failed to write to Codex app-server: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush Codex app-server: {e}"))?;
    Ok(())
}

async fn await_response(
    reader: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    id: i64,
) -> Result<Value, String> {
    loop {
        match reader.next_line().await {
            Ok(Some(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() || !trimmed.starts_with('{') {
                    continue;
                }
                let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                    continue;
                };
                if message.get("id").and_then(Value::as_i64) == Some(id) {
                    if let Some(error) = message.get("error") {
                        return Err(jsonrpc_error_message(error));
                    }
                    return Ok(message);
                }
            }
            Ok(None) => return Err("Codex app-server closed before responding".to_string()),
            Err(e) => return Err(format!("Failed to read from Codex app-server: {e}")),
        }
    }
}

fn jsonrpc_error_message(error: &Value) -> String {
    first_string(error, &["message"]).unwrap_or_else(|| error.to_string())
}

/// Translates a single `codex app-server` JSON-RPC notification into zero or more
/// `CodexChatEvent`s the frontend already understands. Agent message and
/// reasoning items are streamed via their `*/delta` notifications; the matching
/// `item/completed` is only forwarded as a fallback when no deltas were seen, to
/// avoid duplicating the streamed text.
fn map_app_server_notification(
    method: &str,
    params: &Value,
    run_id: &str,
    conversation_id: &str,
    streamed: &mut HashSet<String>,
) -> Vec<CodexChatEvent> {
    match method {
        "item/agentMessage/delta" => {
            let Some(delta) = params.get("delta").and_then(Value::as_str) else {
                return Vec::new();
            };
            if delta.is_empty() {
                return Vec::new();
            }
            if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
                streamed.insert(format!("message:{item_id}"));
            }
            vec![event(
                "text_delta",
                run_id,
                conversation_id,
                None,
                None,
                None,
                Some(delta.to_string()),
                None,
                None,
            )]
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            let Some(delta) = params.get("delta").and_then(Value::as_str) else {
                return Vec::new();
            };
            if delta.is_empty() {
                return Vec::new();
            }
            if let Some(item_id) = params.get("itemId").and_then(Value::as_str) {
                streamed.insert(format!("reasoning:{item_id}"));
            }
            vec![event(
                "reasoning_delta",
                run_id,
                conversation_id,
                None,
                None,
                None,
                Some(delta.to_string()),
                None,
                None,
            )]
        }
        "item/commandExecution/outputDelta" => {
            let Some(delta) = params.get("delta").and_then(Value::as_str) else {
                return Vec::new();
            };
            if delta.is_empty() {
                return Vec::new();
            }
            let item_id = params
                .get("itemId")
                .and_then(Value::as_str)
                .map(str::to_string);
            vec![event(
                "tool_delta",
                run_id,
                conversation_id,
                None,
                item_id,
                Some("command_execution".to_string()),
                Some(delta.to_string()),
                None,
                None,
            )]
        }
        "item/started" => {
            let Some(item) = params.get("item") else {
                return Vec::new();
            };
            let item_type = normalized_item_type(item);
            if !is_tool_item(&item_type) {
                return Vec::new();
            }
            let synthetic = json!({ "type": "item.started", "item": item });
            parse_item_event("tool_started", &synthetic, run_id, conversation_id)
                .into_iter()
                .collect()
        }
        "item/completed" => {
            let Some(item) = params.get("item") else {
                return Vec::new();
            };
            let item_type = normalized_item_type(item);
            let item_id = first_string(item, &["id", "item_id", "itemId"]);

            if matches!(
                item_type.as_str(),
                "agentmessage" | "assistantmessage" | "message"
            ) {
                let already = item_id
                    .as_ref()
                    .map(|id| streamed.contains(&format!("message:{id}")))
                    .unwrap_or(false);
                if already {
                    return Vec::new();
                }
                let text = extract_text_content(item);
                if text.is_empty() {
                    return Vec::new();
                }
                return vec![event(
                    "text_delta",
                    run_id,
                    conversation_id,
                    None,
                    item_id,
                    None,
                    Some(text),
                    None,
                    None,
                )];
            }

            if matches!(item_type.as_str(), "reasoning" | "thought" | "analysis") {
                let already = item_id
                    .as_ref()
                    .map(|id| streamed.contains(&format!("reasoning:{id}")))
                    .unwrap_or(false);
                if already {
                    return Vec::new();
                }
                let text = extract_text_content(item);
                if text.is_empty() {
                    return Vec::new();
                }
                return vec![event(
                    "reasoning_delta",
                    run_id,
                    conversation_id,
                    None,
                    item_id,
                    None,
                    Some(text),
                    None,
                    None,
                )];
            }

            if is_tool_item(&item_type) {
                let synthetic = json!({ "type": "item.completed", "item": item });
                return parse_item_completed_event(&synthetic, run_id, conversation_id)
                    .into_iter()
                    .collect();
            }

            Vec::new()
        }
        "error" => {
            let error = params.get("error").unwrap_or(params);
            let message = first_string(error, &["message", "error"])
                .or_else(|| first_string(params, &["message"]))
                .unwrap_or_else(|| "Codex reported an error.".to_string());
            let event_type = if is_retryable_app_server_error(params) {
                "status"
            } else {
                "error"
            };
            vec![event(
                event_type,
                run_id,
                conversation_id,
                None,
                None,
                None,
                None,
                Some(message),
                None,
            )]
        }
        _ => Vec::new(),
    }
}

fn is_retryable_app_server_error(params: &Value) -> bool {
    params
        .get("willRetry")
        .and_then(Value::as_bool)
        .or_else(|| {
            params
                .get("error")
                .and_then(|error| error.get("willRetry"))
                .and_then(Value::as_bool)
        })
        .unwrap_or(false)
}

#[tauri::command]
async fn codex_chat_stop(
    state: State<'_, CodexProcessState>,
    request: CodexChatStopRequest,
) -> Result<CodexChatStopResult, String> {
    // Mark the run as stopped before killing so the driver task (which is racing
    // to read the about-to-close stdout) reports it as `stopped` instead of an
    // error. The driver emits the actual `stopped` event once it unwinds, which
    // carries the conversation id; the frontend also finalizes locally so a stale
    // run id (no live child to kill) still unsticks the conversation.
    state.stopped.lock().await.insert(request.run_id.clone());
    let mut children = state.children.lock().await;
    if let Some(child) = children.get_mut(&request.run_id) {
        let _ = child.kill().await;
        Ok(CodexChatStopResult { stopped: true })
    } else {
        drop(children);
        // Nothing to kill (already finished, or a run id left over from a
        // previous process). Drop the marker we just set so it can't leak.
        state.stopped.lock().await.remove(&request.run_id);
        Ok(CodexChatStopResult { stopped: false })
    }
}

#[tauri::command]
async fn list_open_apps() -> Result<Vec<String>, String> {
    // Finder and Terminal ship with macOS, so they are always offered there.
    let mut available: Vec<String> = Vec::new();
    #[cfg(target_os = "macos")]
    {
        available.push("finder".to_string());
        available.push("terminal".to_string());
        let candidates: &[(&str, &[&str])] = &[
            ("vscode", &["Visual Studio Code.app", "VSCode.app"]),
            ("cursor", &["Cursor.app"]),
            (
                "pycharm",
                &[
                    "PyCharm.app",
                    "PyCharm CE.app",
                    "PyCharm Community Edition.app",
                ],
            ),
        ];
        for (id, bundles) in candidates {
            if bundles.iter().any(|bundle| app_bundle_exists(bundle)) {
                available.push((*id).to_string());
            }
        }
    }
    Ok(available)
}

#[tauri::command]
async fn open_in_app(request: OpenInAppRequest) -> Result<(), String> {
    let path = validate_cwd(&request.path)?;
    #[cfg(target_os = "macos")]
    {
        let args: Vec<String> = match request.app.as_str() {
            "finder" => vec!["-R".to_string(), path.to_string()],
            "terminal" => vec!["-a".to_string(), "Terminal".to_string(), path.to_string()],
            "vscode" => vec![
                "-a".to_string(),
                "Visual Studio Code".to_string(),
                path.to_string(),
            ],
            "cursor" => vec!["-a".to_string(), "Cursor".to_string(), path.to_string()],
            "pycharm" => vec!["-a".to_string(), "PyCharm".to_string(), path.to_string()],
            other => return Err(format!("Unsupported app: {other}")),
        };
        let output = Command::new("open")
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("Failed to launch app: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() {
                format!("Failed to open in {}", request.app)
            } else {
                stderr
            })
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Opening in external apps is only supported on macOS in this build.".to_string())
    }
}

#[tauri::command]
async fn brand_directory_create(
    request: BrandDirectoryCreateRequest,
) -> Result<BrandDirectoryCreateResult, String> {
    let parent = validate_existing_directory(&request.parent, "父目录")?;
    let name = sanitize_brand_directory_name(&request.name)?;
    let target = Path::new(parent).join(name);
    if target.exists() {
        return Err(format!("品牌目录已存在：{}", target.to_string_lossy()));
    }
    fs::create_dir(&target).map_err(|e| format!("创建品牌目录失败：{e}"))?;
    Ok(BrandDirectoryCreateResult {
        path: target.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn terminal_start(
    app: AppHandle,
    state: State<'_, TerminalState>,
    request: TerminalStartRequest,
) -> Result<TerminalStartResult, String> {
    let cwd = resolve_cwd(request.cwd.as_deref())?;
    let session_id = generate_id("term");
    let rows = request.rows.filter(|r| *r > 0).unwrap_or(24);
    let cols = request.cols.filter(|c| *c > 0).unwrap_or(80);

    // A real PTY makes the shell behave exactly like one launched from an
    // external Terminal: it is an interactive login shell, so it sources the
    // user's full profile (.zprofile/.zshrc, conda, prompt theme, aliases, …)
    // and renders its own prompt and colors. We forward the raw bytes to the
    // frontend xterm.js emulator, which handles the escape sequences.
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open pty: {e}"))?;

    // `new_default_prog` launches the user's login shell with argv[0] prefixed
    // by `-` (e.g. `-zsh`), which is precisely how macOS Terminal starts it.
    let mut cmd = CommandBuilder::new_default_prog();
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to start shell: {e}"))?;
    // Drop the slave so the reader sees EOF once the shell process exits.
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to read from shell: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to write to shell: {e}"))?;

    {
        let mut sessions = state.sessions.lock().unwrap();
        sessions.insert(
            session_id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                child,
            },
        );
    }

    let reader_app = app.clone();
    let reader_session = session_id.clone();
    let reader_sessions = state.sessions.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buffer[..n]);
                    emit_terminal_event(
                        &reader_app,
                        TerminalEvent {
                            event_type: "output".to_string(),
                            session_id: reader_session.clone(),
                            chunk: Some(encoded),
                        },
                    );
                }
            }
        }
        reader_sessions.lock().unwrap().remove(&reader_session);
        emit_terminal_event(
            &reader_app,
            TerminalEvent {
                event_type: "exit".to_string(),
                session_id: reader_session.clone(),
                chunk: None,
            },
        );
    });

    Ok(TerminalStartResult { session_id })
}

#[tauri::command]
async fn terminal_write(
    state: State<'_, TerminalState>,
    request: TerminalWriteRequest,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| "Terminal session is no longer active.".to_string())?;
    session
        .writer
        .write_all(request.data.as_bytes())
        .map_err(|e| format!("Failed to write to terminal: {e}"))?;
    session
        .writer
        .flush()
        .map_err(|e| format!("Failed to flush terminal: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn terminal_resize(
    state: State<'_, TerminalState>,
    request: TerminalResizeRequest,
) -> Result<(), String> {
    let rows = request.rows.max(1);
    let cols = request.cols.max(1);
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(&request.session_id) {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize terminal: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn terminal_stop(
    app: AppHandle,
    state: State<'_, TerminalState>,
    request: TerminalStopRequest,
) -> Result<(), String> {
    let session = state.sessions.lock().unwrap().remove(&request.session_id);
    if let Some(mut session) = session {
        let _ = session.child.kill();
    }
    emit_terminal_event(
        &app,
        TerminalEvent {
            event_type: "exit".to_string(),
            session_id: request.session_id,
            chunk: None,
        },
    );
    Ok(())
}

#[tauri::command]
async fn git_diff_stat(request: GitCwdRequest) -> Result<GitDiffStat, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let output = match run_git(cwd, &["diff", "--numstat", "HEAD"]).await {
        Ok(value) => value,
        Err(_) => run_git(cwd, &["diff", "--numstat"]).await?,
    };
    Ok(parse_numstat(&output.stdout))
}

#[tauri::command]
async fn gh_auth_status() -> Result<GhAuthStatus, String> {
    let output = std::process::Command::new("gh")
        .args(["auth", "status"])
        .env("NO_COLOR", "1")
        .output();
    match output {
        Ok(output) => {
            let combined = format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            Ok(GhAuthStatus {
                installed: true,
                authenticated: output.status.success(),
                account: parse_gh_account(&combined),
            })
        }
        Err(_) => Ok(GhAuthStatus {
            installed: false,
            authenticated: false,
            account: None,
        }),
    }
}

#[tauri::command]
async fn git_status(request: GitCwdRequest) -> Result<GitStatusResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    match run_git(cwd, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok(_) => {
            let output = run_git(cwd, &["status", "--porcelain=v1", "--branch"]).await?;
            Ok(parse_git_status(cwd, &output.stdout))
        }
        Err(error) => Ok(GitStatusResult {
            cwd: cwd.to_string(),
            is_repository: false,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            clean: true,
            changes: Vec::new(),
            error: Some(error),
        }),
    }
}

#[tauri::command]
async fn git_diff(request: GitDiffRequest) -> Result<String, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let path = request
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    // Untracked files have no index entry, so `git diff` shows nothing. Compare
    // the file against /dev/null so the panel can preview the whole content as
    // additions, exactly like a freshly added file. `--no-index` exits 1 when the
    // files differ (which is always, here), so we tolerate a non-zero status.
    // Clamp the context window so a malicious/huge value can't be abused; large
    // values (e.g. 100000) effectively pull the whole file for "expand context".
    let context = request.context.map(|value| value.min(1_000_000));

    if request.untracked.unwrap_or(false) {
        let path = path
            .ok_or_else(|| "A file path is required to preview an untracked file.".to_string())?;
        let mut args = vec![
            "diff".to_string(),
            "--no-index".to_string(),
            "--no-color".to_string(),
        ];
        if let Some(context) = context {
            args.push(format!("-U{context}"));
        }
        args.push("--".to_string());
        args.push("/dev/null".to_string());
        args.push(path.to_string());
        return run_git_capture(cwd, args).await;
    }

    let mut args = vec!["diff".to_string()];
    if request.staged.unwrap_or(false) {
        args.push("--cached".to_string());
    }
    if let Some(context) = context {
        args.push(format!("-U{context}"));
    }
    if let Some(path) = path {
        args.push("--".to_string());
        args.push(path.to_string());
    }
    let output = run_git_owned(cwd, args).await?;
    Ok(output.stdout)
}

// Opens the "create pull request" page in the browser via the GitHub CLI. This
// is a side-effecting convenience that mirrors the reference review UI's
// "创建拉取请求" action; it relies on `gh` being installed and authenticated.
#[tauri::command]
async fn gh_pr_create_web(request: GitCwdRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let output = Command::new("gh")
        .args(["pr", "create", "--web"])
        .current_dir(cwd)
        .env("NO_COLOR", "1")
        .output()
        .await
        .map_err(|_| "未找到 GitHub CLI（gh）。请先安装并运行 `gh auth login`。".to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    let stderr = String::from_utf8_lossy(&output.stderr)
        .trim_end()
        .to_string();
    if output.status.success() {
        Ok(GitCommandResult { stdout, stderr })
    } else {
        let message = if stderr.is_empty() { stdout } else { stderr };
        Err(if message.is_empty() {
            "创建拉取请求失败。".to_string()
        } else {
            message
        })
    }
}

// Restores or removes files so the user can throw away local edits, mirroring
// VS Code's "Discard Changes". Each path is handled according to its current
// status so newly-added files are removed while tracked edits revert to HEAD.
#[tauri::command]
async fn git_discard(request: GitPathsRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let paths = sanitize_paths(&request.paths)?;

    let status = run_git(cwd, &["status", "--porcelain=v1"]).await?;
    let mut status_map: HashMap<String, (char, char)> = HashMap::new();
    for line in status.stdout.lines() {
        if line.len() < 3 {
            continue;
        }
        if let Some(change) = parse_git_change_line(line) {
            let mut chars = change.index_status.chars();
            let index = chars.next().unwrap_or(' ');
            let working = change.working_tree_status.chars().next().unwrap_or(' ');
            status_map.insert(change.path, (index, working));
        }
    }

    let mut to_restore: Vec<String> = Vec::new();
    let mut to_unstage_then_clean: Vec<String> = Vec::new();
    let mut to_clean: Vec<String> = Vec::new();
    for path in &paths {
        match status_map.get(path) {
            Some((index, _)) if *index == '?' => to_clean.push(path.clone()),
            Some((index, _)) if *index == 'A' => to_unstage_then_clean.push(path.clone()),
            Some(_) => to_restore.push(path.clone()),
            None => to_clean.push(path.clone()),
        }
    }

    let mut combined = GitCommandResult {
        stdout: String::new(),
        stderr: String::new(),
    };
    let mut append = |result: GitCommandResult| {
        if !result.stdout.is_empty() {
            combined.stdout.push_str(&result.stdout);
            combined.stdout.push('\n');
        }
        if !result.stderr.is_empty() {
            combined.stderr.push_str(&result.stderr);
            combined.stderr.push('\n');
        }
    };

    if !to_unstage_then_clean.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--staged".to_string(),
            "--".to_string(),
        ];
        args.extend(to_unstage_then_clean.iter().cloned());
        append(run_git_owned(cwd, args).await?);
        to_clean.extend(to_unstage_then_clean);
    }
    if !to_restore.is_empty() {
        let mut args = vec![
            "restore".to_string(),
            "--source=HEAD".to_string(),
            "--staged".to_string(),
            "--worktree".to_string(),
            "--".to_string(),
        ];
        args.extend(to_restore);
        append(run_git_owned(cwd, args).await?);
    }
    if !to_clean.is_empty() {
        let mut args = vec!["clean".to_string(), "-fd".to_string(), "--".to_string()];
        args.extend(to_clean);
        append(run_git_owned(cwd, args).await?);
    }

    Ok(GitCommandResult {
        stdout: combined.stdout.trim_end().to_string(),
        stderr: combined.stderr.trim_end().to_string(),
    })
}

// Applies a single diff hunk to the index so the panel can stage/unstage one
// block at a time. The frontend builds the patch from the file header plus one
// hunk; `--reverse` is used to peel a staged hunk back out of the index.
#[tauri::command]
async fn git_apply_patch(request: GitApplyPatchRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let mut patch = request.patch;
    if patch.trim().is_empty() {
        return Err("Patch is empty.".to_string());
    }
    if !patch.ends_with('\n') {
        patch.push('\n');
    }
    let mut args = vec![
        "apply".to_string(),
        "--cached".to_string(),
        "--whitespace=nowarn".to_string(),
    ];
    if request.reverse.unwrap_or(false) {
        args.push("--reverse".to_string());
    }
    args.push("-".to_string());
    run_git_stdin(cwd, args, &patch).await
}

#[tauri::command]
async fn git_stage(request: GitPathsRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let paths = sanitize_paths(&request.paths)?;
    let mut args = vec!["add".to_string(), "--".to_string()];
    args.extend(paths);
    run_git_owned(cwd, args).await
}

#[tauri::command]
async fn git_unstage(request: GitPathsRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let paths = sanitize_paths(&request.paths)?;
    let mut args = vec![
        "restore".to_string(),
        "--staged".to_string(),
        "--".to_string(),
    ];
    args.extend(paths);
    run_git_owned(cwd, args).await
}

#[tauri::command]
async fn git_commit(request: GitCommitRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let message = request.message.trim();
    if message.is_empty() {
        return Err("Commit message cannot be empty.".to_string());
    }
    run_git_owned(
        cwd,
        vec!["commit".to_string(), "-m".to_string(), message.to_string()],
    )
    .await
}

#[tauri::command]
async fn git_branch_list(request: GitCwdRequest) -> Result<Vec<GitBranch>, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let output = run_git(
        cwd,
        &[
            "branch",
            "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)",
        ],
    )
    .await?;
    Ok(parse_git_branches(&output.stdout))
}

#[tauri::command]
async fn git_recent_commits(request: GitRecentCommitsRequest) -> Result<Vec<GitCommit>, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let limit = request.limit.unwrap_or(20).clamp(1, 100);
    // %x1f is the unit separator; keeps fields unambiguous even when a subject
    // happens to contain other punctuation.
    let output = run_git_owned(
        cwd,
        vec![
            "log".to_string(),
            format!("-n{limit}"),
            "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%cr".to_string(),
        ],
    )
    .await?;
    Ok(parse_git_commits(&output.stdout))
}

#[tauri::command]
async fn git_create_branch(request: GitBranchRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let name = validate_branch_name(cwd, &request.name).await?;
    run_git_owned(cwd, vec!["switch".to_string(), "-c".to_string(), name]).await
}

#[tauri::command]
async fn git_checkout_branch(request: GitBranchRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let name = validate_branch_name(cwd, &request.name).await?;
    run_git_owned(cwd, vec!["switch".to_string(), name]).await
}

#[tauri::command]
async fn git_pull(request: GitCwdRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    run_git(cwd, &["pull", "--ff-only"]).await
}

#[tauri::command]
async fn git_push(request: GitPushRequest) -> Result<GitCommandResult, String> {
    let cwd = validate_cwd(&request.cwd)?;
    if request.set_upstream.unwrap_or(false) {
        let branch = run_git(cwd, &["branch", "--show-current"])
            .await?
            .stdout
            .trim()
            .to_string();
        if branch.is_empty() {
            return Err("Cannot set upstream while HEAD is detached.".to_string());
        }
        run_git_owned(
            cwd,
            vec![
                "push".to_string(),
                "-u".to_string(),
                "origin".to_string(),
                branch,
            ],
        )
        .await
    } else {
        run_git(cwd, &["push"]).await
    }
}

#[tauri::command]
async fn git_remotes(request: GitCwdRequest) -> Result<Vec<GitRemote>, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let output = run_git(cwd, &["remote", "-v"]).await?;
    Ok(parse_git_remotes(&output.stdout))
}

fn emit_event(app: &AppHandle, event: CodexChatEvent) {
    if let Err(e) = app.emit(CODEX_CHAT_EVENT, event) {
        eprintln!("failed to emit {CODEX_CHAT_EVENT}: {e}");
    }
}

fn emit_terminal_event(app: &AppHandle, event: TerminalEvent) {
    if let Err(e) = app.emit(TERMINAL_EVENT, event) {
        eprintln!("failed to emit {TERMINAL_EVENT}: {e}");
    }
}

fn generate_run_id() -> String {
    generate_id("codex")
}

fn generate_id(prefix: &str) -> String {
    let count = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    format!("{prefix}-{millis}-{count}")
}

fn default_model_config_version() -> u32 {
    1
}

fn default_true() -> bool {
    true
}

fn model_config_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Cannot resolve home directory.".to_string())?;
    Ok(Path::new(&home)
        .join(".alpha-studio")
        .join("model-providers.json"))
}

#[cfg(target_os = "macos")]
fn app_bundle_exists(bundle: &str) -> bool {
    if Path::new("/Applications").join(bundle).exists() {
        return true;
    }
    if let Some(home) = home_dir() {
        if Path::new(&home).join("Applications").join(bundle).exists() {
            return true;
        }
    }
    false
}

fn parse_numstat(output: &str) -> GitDiffStat {
    let mut files_changed = 0u32;
    let mut additions = 0u32;
    let mut deletions = 0u32;
    for line in output.lines() {
        let mut parts = line.split('\t');
        let added = parts.next().unwrap_or("").trim();
        let removed = parts.next().unwrap_or("").trim();
        let path = parts.next().unwrap_or("").trim();
        if path.is_empty() {
            continue;
        }
        files_changed += 1;
        additions += added.parse::<u32>().unwrap_or(0);
        deletions += removed.parse::<u32>().unwrap_or(0);
    }
    GitDiffStat {
        files_changed,
        additions,
        deletions,
    }
}

fn parse_gh_account(output: &str) -> Option<String> {
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Logged in to ") {
            if let Some((host, account)) = rest.split_once(" account ") {
                let account = account.split_whitespace().next().unwrap_or("").trim();
                if !account.is_empty() {
                    return Some(format!("{account} · {}", host.trim()));
                }
            }
            return non_empty_string(rest);
        }
    }
    None
}

fn sanitize_sandbox_mode(value: Option<&str>) -> String {
    match value.unwrap_or("read-only").trim() {
        "workspace-write" => "workspace-write".to_string(),
        "danger-full-access" => "danger-full-access".to_string(),
        _ => "read-only".to_string(),
    }
}

fn sanitize_reasoning_effort(value: Option<&str>) -> Option<String> {
    match value.map(str::trim).unwrap_or_default() {
        "minimal" => Some("minimal".to_string()),
        "low" => Some("low".to_string()),
        "medium" => Some("medium".to_string()),
        "high" => Some("high".to_string()),
        "xhigh" => Some("xhigh".to_string()),
        _ => None,
    }
}

fn sanitize_model_provider(
    request: &CodexChatRequest,
) -> Result<Option<ModelProviderConfig>, String> {
    let provider_id = request
        .provider_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("openai");

    if provider_id == "openai" {
        return Ok(None);
    }
    if !is_safe_provider_id(provider_id) {
        return Err("Provider ID 只能包含小写字母、数字、下划线和连字符。".to_string());
    }
    if matches!(provider_id, "ollama" | "lmstudio") {
        return Err(format!(
            "Provider ID `{provider_id}` 是 Codex 保留名称，请换一个自定义 ID。"
        ));
    }

    let base_url = request
        .provider_base_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "自定义模型需要配置 Base URL。".to_string())?;
    if !is_valid_provider_base_url(base_url) {
        return Err("Base URL 必须以 http:// 或 https:// 开头，且不能包含空白字符。".to_string());
    }

    let api_key = request
        .provider_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string);

    let (wire_api, adapter) = match request
        .provider_wire_api
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
    {
        "responses" | "" => (Some("responses".to_string()), None),
        "chat" => (
            Some("responses".to_string()),
            Some(ModelProviderAdapter {
                upstream_base_url: base_url.to_string(),
                api_key: api_key.clone(),
                thinking_enabled: request.provider_thinking_enabled.unwrap_or(false),
            }),
        ),
        other => return Err(format!("Unsupported provider wire API: {other}")),
    };

    Ok(Some(ModelProviderConfig {
        id: provider_id.to_string(),
        base_url: base_url.to_string(),
        api_key,
        wire_api,
        adapter,
        show_raw_reasoning: request.provider_thinking_enabled.unwrap_or(false)
            && sanitize_reasoning_effort(request.reasoning_effort.as_deref()).is_some(),
    }))
}

fn codex_app_server_args(provider: Option<&ModelProviderConfig>) -> Vec<String> {
    let mut args = vec!["app-server".to_string()];
    let Some(provider) = provider else {
        return args;
    };

    push_config_arg(&mut args, "model_provider", &provider.id);
    push_config_arg(
        &mut args,
        &format!("model_providers.{}.name", provider.id),
        &provider.id,
    );
    push_config_arg(
        &mut args,
        &format!("model_providers.{}.base_url", provider.id),
        &provider.base_url,
    );
    if provider.api_key.is_some() {
        push_config_arg(
            &mut args,
            &format!("model_providers.{}.env_key", provider.id),
            &provider_api_key_env(&provider.id),
        );
    }
    if let Some(wire_api) = &provider.wire_api {
        push_config_arg(
            &mut args,
            &format!("model_providers.{}.wire_api", provider.id),
            wire_api,
        );
    }
    if provider.show_raw_reasoning {
        push_raw_config_arg(&mut args, "show_raw_agent_reasoning", "true");
    }
    args
}

fn push_config_arg(args: &mut Vec<String>, key: &str, value: &str) {
    args.push("--config".to_string());
    args.push(format!("{key}={}", toml_string(value)));
}

fn push_raw_config_arg(args: &mut Vec<String>, key: &str, value: &str) {
    args.push("--config".to_string());
    args.push(format!("{key}={value}"));
}

fn provider_api_key_env(provider_id: &str) -> String {
    let normalized = provider_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect::<String>();
    format!("ALPHA_STUDIO_{}_API_KEY", normalized)
}

fn toml_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn is_safe_provider_id(value: &str) -> bool {
    !value.is_empty()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_' || byte == b'-'
        })
}

fn is_valid_provider_base_url(value: &str) -> bool {
    (value.starts_with("https://") || value.starts_with("http://"))
        && !value.chars().any(char::is_whitespace)
}

async fn start_chat_completions_adapter(
    config: ModelProviderAdapter,
    reasoning_by_conversation: Arc<StdMutex<HashMap<String, HashMap<String, String>>>>,
    conversation_id: String,
) -> Result<ChatAdapterHandle, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local model adapter: {e}"))?;
    let addr = listener
        .local_addr()
        .map_err(|e| format!("Failed to read local model adapter address: {e}"))?;
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
    let client = reqwest::Client::new();
    let state = ChatAdapterState {
        conversation_id,
        reasoning_by_conversation,
    };

    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else {
                        continue;
                    };
                    let connection_config = config.clone();
                    let connection_client = client.clone();
                    let connection_state = state.clone();
                    tokio::spawn(async move {
                        handle_chat_adapter_connection(
                            stream,
                            connection_config,
                            connection_client,
                            connection_state,
                        ).await;
                    });
                }
            }
        }
    });

    Ok(ChatAdapterHandle {
        base_url: format!("http://{}", addr),
        shutdown: shutdown_tx,
    })
}

#[derive(Debug)]
struct AdapterHttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

async fn handle_chat_adapter_connection(
    mut stream: TcpStream,
    config: ModelProviderAdapter,
    client: reqwest::Client,
    state: ChatAdapterState,
) {
    let response = match read_adapter_http_request(&mut stream).await {
        Ok(request) => handle_chat_adapter_request(request, config, client, state).await,
        Err(message) => adapter_json_response(400, json!({ "error": { "message": message } })),
    };
    let _ = write_adapter_http_response(&mut stream, response).await;
}

async fn handle_chat_adapter_request(
    request: AdapterHttpRequest,
    config: ModelProviderAdapter,
    client: reqwest::Client,
    state: ChatAdapterState,
) -> AdapterHttpResponse {
    if request.method == "OPTIONS" {
        return AdapterHttpResponse {
            status: 204,
            content_type: "text/plain; charset=utf-8".to_string(),
            body: String::new(),
        };
    }

    let route = request.path.split('?').next().unwrap_or_default();
    if request.method != "POST" || !route.ends_with("/responses") {
        return adapter_json_response(404, json!({ "error": { "message": "Not found" } }));
    }

    let responses_request = match serde_json::from_slice::<Value>(&request.body) {
        Ok(value) => value,
        Err(e) => {
            return adapter_json_response(
                400,
                json!({ "error": { "message": format!("Invalid Responses request JSON: {e}") } }),
            )
        }
    };
    let reasoning_by_call_id = adapter_reasoning_snapshot(&state);
    let chat_request = match build_chat_completion_request(
        &responses_request,
        config.thinking_enabled,
        &reasoning_by_call_id,
    ) {
        Ok(value) => value,
        Err(message) => {
            return adapter_json_response(400, json!({ "error": { "message": message } }))
        }
    };

    let upstream_url = chat_completions_url(&config.upstream_base_url);
    let mut builder = client
        .post(upstream_url)
        .header("content-type", "application/json")
        .json(&chat_request);
    if let Some(auth) = request
        .headers
        .get("authorization")
        .filter(|value| !value.is_empty())
    {
        builder = builder.header("authorization", auth);
    } else if let Some(api_key) = config.api_key.as_deref().filter(|value| !value.is_empty()) {
        builder = builder.bearer_auth(api_key);
    }

    let upstream_response = match builder.send().await {
        Ok(response) => response,
        Err(e) => {
            return adapter_json_response(
                502,
                json!({ "error": { "message": format!("Chat adapter upstream request failed: {e}") } }),
            )
        }
    };
    let status = upstream_response.status().as_u16();
    let upstream_text = match upstream_response.text().await {
        Ok(text) => text,
        Err(e) => {
            return adapter_json_response(
                502,
                json!({ "error": { "message": format!("Failed to read chat adapter upstream response: {e}") } }),
            )
        }
    };
    if !(200..300).contains(&status) {
        return AdapterHttpResponse {
            status,
            content_type: "application/json; charset=utf-8".to_string(),
            body: upstream_text,
        };
    }

    let chat_response = match serde_json::from_str::<Value>(&upstream_text) {
        Ok(value) => value,
        Err(e) => {
            return adapter_json_response(
                502,
                json!({ "error": { "message": format!("Invalid chat adapter upstream JSON: {e}") } }),
            )
        }
    };
    remember_chat_reasoning_for_tool_calls(&state, &chat_response);
    match responses_sse_from_chat_completion(&chat_response) {
        Ok(body) => AdapterHttpResponse {
            status: 200,
            content_type: "text/event-stream; charset=utf-8".to_string(),
            body,
        },
        Err(message) => adapter_json_response(502, json!({ "error": { "message": message } })),
    }
}

async fn read_adapter_http_request(stream: &mut TcpStream) -> Result<AdapterHttpRequest, String> {
    let mut buffer = Vec::new();
    let header_end = loop {
        if let Some(index) = find_header_end(&buffer) {
            break index;
        }
        if buffer.len() > 256 * 1024 {
            return Err("HTTP request headers are too large.".to_string());
        }
        let mut chunk = [0u8; 8192];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("Failed to read adapter request: {e}"))?;
        if read == 0 {
            return Err("HTTP connection closed before headers completed.".to_string());
        }
        buffer.extend_from_slice(&chunk[..read]);
    };

    let header_text = String::from_utf8_lossy(&buffer[..header_end]);
    let mut lines = header_text.split("\r\n");
    let request_line = lines
        .next()
        .ok_or_else(|| "Missing HTTP request line.".to_string())?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts
        .next()
        .ok_or_else(|| "Missing HTTP method.".to_string())?
        .to_ascii_uppercase();
    let path = request_parts
        .next()
        .ok_or_else(|| "Missing HTTP path.".to_string())?
        .to_string();

    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        if let Some((name, value)) = line.split_once(':') {
            headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(0);
    if content_length > 8 * 1024 * 1024 {
        return Err("HTTP request body is too large.".to_string());
    }

    let body_start = header_end + 4;
    let mut body = buffer.get(body_start..).unwrap_or_default().to_vec();
    while body.len() < content_length {
        let mut chunk = vec![0u8; (content_length - body.len()).min(8192)];
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("Failed to read adapter request body: {e}"))?;
        if read == 0 {
            return Err("HTTP connection closed before body completed.".to_string());
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(content_length);

    Ok(AdapterHttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

struct AdapterHttpResponse {
    status: u16,
    content_type: String,
    body: String,
}

async fn write_adapter_http_response(
    stream: &mut TcpStream,
    response: AdapterHttpResponse,
) -> Result<(), String> {
    let status_text = adapter_status_text(response.status);
    let head = format!(
        "HTTP/1.1 {} {}\r\ncontent-type: {}\r\ncontent-length: {}\r\nconnection: close\r\naccess-control-allow-origin: *\r\naccess-control-allow-headers: authorization, content-type\r\n\r\n",
        response.status,
        status_text,
        response.content_type,
        response.body.as_bytes().len()
    );
    stream
        .write_all(head.as_bytes())
        .await
        .map_err(|e| format!("Failed to write adapter response headers: {e}"))?;
    stream
        .write_all(response.body.as_bytes())
        .await
        .map_err(|e| format!("Failed to write adapter response body: {e}"))?;
    let _ = stream.shutdown().await;
    Ok(())
}

fn adapter_json_response(status: u16, body: Value) -> AdapterHttpResponse {
    AdapterHttpResponse {
        status,
        content_type: "application/json; charset=utf-8".to_string(),
        body: body.to_string(),
    }
}

fn adapter_status_text(status: u16) -> &'static str {
    match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        429 => "Too Many Requests",
        500 => "Internal Server Error",
        502 => "Bad Gateway",
        _ => "OK",
    }
}

fn chat_completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{trimmed}/chat/completions")
    }
}

fn adapter_reasoning_snapshot(state: &ChatAdapterState) -> HashMap<String, String> {
    match state.reasoning_by_conversation.lock() {
        Ok(guard) => guard
            .get(&state.conversation_id)
            .cloned()
            .unwrap_or_default(),
        Err(_) => HashMap::new(),
    }
}

fn remember_chat_reasoning_for_tool_calls(state: &ChatAdapterState, response: &Value) {
    let Some(message) = first_chat_choice_message(response) else {
        return;
    };
    let reasoning_content = chat_message_reasoning_content(message);
    if reasoning_content.trim().is_empty() {
        return;
    }
    let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) else {
        return;
    };
    let Ok(mut stored_by_conversation) = state.reasoning_by_conversation.lock() else {
        return;
    };
    let stored = stored_by_conversation
        .entry(state.conversation_id.clone())
        .or_default();
    for call in tool_calls {
        if let Some(call_id) = call.get("id").and_then(Value::as_str) {
            stored.insert(call_id.to_string(), reasoning_content.clone());
        }
    }
}

fn first_chat_choice_message(response: &Value) -> Option<&Value> {
    response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
}

fn build_chat_completion_request(
    request: &Value,
    thinking_enabled: bool,
    reasoning_by_call_id: &HashMap<String, String>,
) -> Result<Value, String> {
    let model = request
        .get("model")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Responses request is missing model.".to_string())?;

    let mut messages = Vec::new();
    if let Some(instructions) = request
        .get("instructions")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        push_chat_text_message(&mut messages, "system", instructions);
    }

    let mut pending_reasoning_content: Option<String> = None;
    let mut pending_tool_calls = PendingChatToolCalls::default();
    if let Some(input) = request.get("input").and_then(Value::as_array) {
        for item in input {
            append_responses_input_item_as_chat_message(
                &mut messages,
                item,
                &mut pending_reasoning_content,
                &mut pending_tool_calls,
                reasoning_by_call_id,
            );
        }
    }
    flush_pending_chat_tool_calls(&mut messages, &mut pending_tool_calls);
    if messages.is_empty() {
        push_chat_text_message(&mut messages, "user", "");
    }

    let mut body = Map::new();
    body.insert("model".to_string(), json!(model));
    body.insert("messages".to_string(), Value::Array(messages));
    body.insert("stream".to_string(), Value::Bool(false));

    if let Some(tools) = request.get("tools").and_then(Value::as_array) {
        let chat_tools = tools
            .iter()
            .filter_map(response_tool_to_chat_tool)
            .collect::<Vec<_>>();
        if !chat_tools.is_empty() {
            body.insert("tools".to_string(), Value::Array(chat_tools));
            if let Some(tool_choice) = request.get("tool_choice") {
                body.insert("tool_choice".to_string(), tool_choice.clone());
            }
        }
    }

    for key in ["temperature", "top_p", "parallel_tool_calls"] {
        if let Some(value) = request.get(key) {
            body.insert(key.to_string(), value.clone());
        }
    }
    if let Some(max_tokens) = request
        .get("max_output_tokens")
        .or_else(|| request.get("max_tokens"))
    {
        body.insert("max_tokens".to_string(), max_tokens.clone());
    }
    body.insert(
        "thinking".to_string(),
        json!({ "type": if thinking_enabled { "enabled" } else { "disabled" } }),
    );
    if thinking_enabled {
        let effort = response_reasoning_effort(request).unwrap_or("high");
        body.insert("reasoning_effort".to_string(), json!(effort));
    }

    Ok(Value::Object(body))
}

#[derive(Default)]
struct PendingChatToolCalls {
    reasoning_content: Option<String>,
    calls: Vec<Value>,
}

fn append_responses_input_item_as_chat_message(
    messages: &mut Vec<Value>,
    item: &Value,
    pending_reasoning_content: &mut Option<String>,
    pending_tool_calls: &mut PendingChatToolCalls,
    reasoning_by_call_id: &HashMap<String, String>,
) {
    match item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or("message")
    {
        "reasoning" | "thought" | "analysis" => {
            flush_pending_chat_tool_calls(messages, pending_tool_calls);
            *pending_reasoning_content = response_reasoning_item_to_text(item);
        }
        "message" => {
            flush_pending_chat_tool_calls(messages, pending_tool_calls);
            let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
            let chat_role = match role {
                "developer" | "system" => "system",
                "assistant" => "assistant",
                "tool" => "tool",
                _ => "user",
            };
            if let Some(text) =
                response_content_to_text(item.get("content").unwrap_or(&Value::Null))
            {
                push_chat_text_message(messages, chat_role, &text);
            }
            if chat_role == "assistant" || chat_role == "user" {
                pending_reasoning_content.take();
            }
        }
        "function_call" => {
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("call");
            let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
            let arguments = item
                .get("arguments")
                .map(value_to_string)
                .unwrap_or_else(|| "{}".to_string());
            if pending_tool_calls.reasoning_content.is_none() {
                pending_tool_calls.reasoning_content = pending_reasoning_content
                    .take()
                    .filter(|value| !value.trim().is_empty())
                    .or_else(|| reasoning_by_call_id.get(call_id).cloned());
            } else {
                pending_reasoning_content.take();
            }
            pending_tool_calls.calls.push(json!({
                "id": call_id,
                "type": "function",
                "function": { "name": name, "arguments": arguments }
            }));
        }
        "function_call_output" => {
            flush_pending_chat_tool_calls(messages, pending_tool_calls);
            let call_id = item
                .get("call_id")
                .or_else(|| item.get("id"))
                .and_then(Value::as_str)
                .unwrap_or("call");
            let output = item
                .get("output")
                .map(value_to_string)
                .or_else(|| response_content_to_text(item.get("content").unwrap_or(&Value::Null)))
                .unwrap_or_default();
            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": output
            }));
        }
        _ => {
            flush_pending_chat_tool_calls(messages, pending_tool_calls);
            if let Some(text) = response_content_to_text(item.get("content").unwrap_or(item)) {
                push_chat_text_message(messages, "user", &text);
            }
            pending_reasoning_content.take();
        }
    }
}

fn flush_pending_chat_tool_calls(
    messages: &mut Vec<Value>,
    pending_tool_calls: &mut PendingChatToolCalls,
) {
    if pending_tool_calls.calls.is_empty() {
        return;
    }

    let calls = std::mem::take(&mut pending_tool_calls.calls);
    let mut assistant = Map::new();
    assistant.insert("role".to_string(), json!("assistant"));
    assistant.insert("content".to_string(), Value::Null);
    if let Some(reasoning_content) = pending_tool_calls
        .reasoning_content
        .take()
        .filter(|value| !value.trim().is_empty())
    {
        assistant.insert("reasoning_content".to_string(), json!(reasoning_content));
    }
    assistant.insert("tool_calls".to_string(), Value::Array(calls));
    messages.push(Value::Object(assistant));
}

fn push_chat_text_message(messages: &mut Vec<Value>, role: &str, content: &str) {
    if let Some(last) = messages.last_mut() {
        let last_role = last.get("role").and_then(Value::as_str);
        let has_tool_calls = last.get("tool_calls").is_some();
        if last_role == Some(role) && !has_tool_calls && role != "tool" {
            if let Some(existing) = last
                .get("content")
                .and_then(Value::as_str)
                .map(str::to_string)
            {
                let joined = if existing.is_empty() {
                    content.to_string()
                } else if content.is_empty() {
                    existing
                } else {
                    format!("{existing}\n\n{content}")
                };
                last["content"] = json!(joined);
                return;
            }
        }
    }
    messages.push(json!({ "role": role, "content": content }));
}

fn response_content_to_text(content: &Value) -> Option<String> {
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts = items
                .iter()
                .filter_map(|item| match item {
                    Value::String(text) => Some(text.clone()),
                    Value::Object(map) => map
                        .get("text")
                        .or_else(|| map.get("content"))
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    _ => None,
                })
                .collect::<Vec<_>>();
            if parts.is_empty() {
                None
            } else {
                Some(parts.join("\n"))
            }
        }
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .and_then(Value::as_str)
            .map(str::to_string),
        _ => None,
    }
}

fn response_reasoning_item_to_text(item: &Value) -> Option<String> {
    response_content_to_text(item.get("summary").unwrap_or(&Value::Null))
        .or_else(|| response_content_to_text(item.get("content").unwrap_or(&Value::Null)))
        .or_else(|| first_string(item, &["text", "content", "summary"]))
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

fn response_tool_to_chat_tool(tool: &Value) -> Option<Value> {
    if tool.get("type").and_then(Value::as_str) != Some("function") {
        return None;
    }
    let name = tool.get("name").and_then(Value::as_str)?;
    let mut function = Map::new();
    function.insert("name".to_string(), json!(name));
    if let Some(description) = tool.get("description").and_then(Value::as_str) {
        function.insert("description".to_string(), json!(description));
    }
    if let Some(parameters) = tool.get("parameters") {
        function.insert("parameters".to_string(), parameters.clone());
    }
    Some(json!({ "type": "function", "function": Value::Object(function) }))
}

fn response_reasoning_effort(request: &Value) -> Option<&'static str> {
    let effort = request
        .get("reasoning")
        .and_then(|value| value.get("effort"))
        .and_then(Value::as_str)
        .or_else(|| request.get("reasoning_effort").and_then(Value::as_str))?;
    match effort {
        "xhigh" | "max" => Some("max"),
        "minimal" | "low" | "medium" | "high" => Some("high"),
        _ => None,
    }
}

fn responses_sse_from_chat_completion(response: &Value) -> Result<String, String> {
    let message = response
        .get("choices")
        .and_then(Value::as_array)
        .and_then(|choices| choices.first())
        .and_then(|choice| choice.get("message"))
        .ok_or_else(|| "Chat completion response is missing choices[0].message.".to_string())?;

    let response_id = response
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("resp_alpha_studio_adapter");
    let mut sse = String::new();
    let mut output = Vec::new();
    push_sse_event(
        &mut sse,
        "response.created",
        &json!({
            "type": "response.created",
            "response": { "id": response_id, "status": "in_progress", "output": [] }
        }),
    );

    let reasoning_content = chat_message_reasoning_content(message);
    if !reasoning_content.is_empty() {
        let item_id = format!("{response_id}_reasoning");
        let output_index = output.len();
        push_response_reasoning_events(&mut sse, output_index, &item_id, &reasoning_content);
        output.push(json!({
            "id": item_id,
            "type": "reasoning",
            "summary": [{ "type": "summary_text", "text": reasoning_content }]
        }));
    }

    let content = message
        .get("content")
        .map(chat_message_content_to_text)
        .unwrap_or_default();
    if !content.is_empty() {
        let item_id = format!("{response_id}_msg");
        let output_index = output.len();
        push_response_text_events(&mut sse, output_index, &item_id, &content);
        output.push(json!({
            "id": item_id,
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": content }]
        }));
    }

    if let Some(tool_calls) = message.get("tool_calls").and_then(Value::as_array) {
        for (index, call) in tool_calls.iter().enumerate() {
            let call_id = call
                .get("id")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("{response_id}_call_{index}"));
            let name = call
                .get("function")
                .and_then(|function| function.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let arguments = call
                .get("function")
                .and_then(|function| function.get("arguments"))
                .map(value_to_string)
                .unwrap_or_else(|| "{}".to_string());
            let output_index = output.len();
            push_response_function_call_events(
                &mut sse,
                output_index,
                &call_id,
                &call_id,
                name,
                &arguments,
            );
            output.push(json!({
                "id": call_id,
                "type": "function_call",
                "call_id": call_id,
                "name": name,
                "arguments": arguments
            }));
        }
    }

    if output.is_empty() {
        let item_id = format!("{response_id}_msg");
        let text = "（模型返回了空内容）";
        push_response_text_events(&mut sse, 0, &item_id, text);
        output.push(json!({
            "id": item_id,
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": text }]
        }));
    }

    push_sse_event(
        &mut sse,
        "response.completed",
        &json!({
            "type": "response.completed",
            "response": { "id": response_id, "status": "completed", "output": output }
        }),
    );
    sse.push_str("data: [DONE]\n\n");
    Ok(sse)
}

fn chat_message_content_to_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => Some(text.clone()),
                Value::Object(map) => map
                    .get("text")
                    .or_else(|| map.get("content"))
                    .and_then(Value::as_str)
                    .map(str::to_string),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn chat_message_reasoning_content(message: &Value) -> String {
    [
        "reasoning_content",
        "reasoningContent",
        "thinking_content",
        "thinkingContent",
    ]
    .iter()
    .find_map(|key| message.get(*key))
    .map(chat_message_content_to_text)
    .unwrap_or_default()
}

fn push_response_reasoning_events(
    sse: &mut String,
    output_index: usize,
    item_id: &str,
    text: &str,
) {
    push_sse_event(
        sse,
        "response.output_item.added",
        &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": { "id": item_id, "type": "reasoning", "summary": [] }
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_part.added",
        &json!({
            "type": "response.reasoning_summary_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": "" }
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_text.delta",
        &json!({
            "type": "response.reasoning_summary_text.delta",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "delta": text
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_text.done",
        &json!({
            "type": "response.reasoning_summary_text.done",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "text": text
        }),
    );
    push_sse_event(
        sse,
        "response.reasoning_summary_part.done",
        &json!({
            "type": "response.reasoning_summary_part.done",
            "item_id": item_id,
            "output_index": output_index,
            "summary_index": 0,
            "part": { "type": "summary_text", "text": text }
        }),
    );
    push_sse_event(
        sse,
        "response.output_item.done",
        &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": {
                "id": item_id,
                "type": "reasoning",
                "summary": [{ "type": "summary_text", "text": text }]
            }
        }),
    );
}

fn push_response_text_events(sse: &mut String, output_index: usize, item_id: &str, text: &str) {
    push_sse_event(
        sse,
        "response.output_item.added",
        &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": { "id": item_id, "type": "message", "role": "assistant", "content": [] }
        }),
    );
    push_sse_event(
        sse,
        "response.content_part.added",
        &json!({
            "type": "response.content_part.added",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": "" }
        }),
    );
    push_sse_event(
        sse,
        "response.output_text.delta",
        &json!({
            "type": "response.output_text.delta",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "delta": text
        }),
    );
    push_sse_event(
        sse,
        "response.output_text.done",
        &json!({
            "type": "response.output_text.done",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "text": text
        }),
    );
    push_sse_event(
        sse,
        "response.content_part.done",
        &json!({
            "type": "response.content_part.done",
            "item_id": item_id,
            "output_index": output_index,
            "content_index": 0,
            "part": { "type": "output_text", "text": text }
        }),
    );
    push_sse_event(
        sse,
        "response.output_item.done",
        &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": {
                "id": item_id,
                "type": "message",
                "role": "assistant",
                "content": [{ "type": "output_text", "text": text }]
            }
        }),
    );
}

fn push_response_function_call_events(
    sse: &mut String,
    output_index: usize,
    item_id: &str,
    call_id: &str,
    name: &str,
    arguments: &str,
) {
    push_sse_event(
        sse,
        "response.output_item.added",
        &json!({
            "type": "response.output_item.added",
            "output_index": output_index,
            "item": { "id": item_id, "type": "function_call", "call_id": call_id, "name": name, "arguments": "" }
        }),
    );
    if !arguments.is_empty() {
        push_sse_event(
            sse,
            "response.function_call_arguments.delta",
            &json!({
                "type": "response.function_call_arguments.delta",
                "item_id": item_id,
                "output_index": output_index,
                "delta": arguments
            }),
        );
    }
    push_sse_event(
        sse,
        "response.function_call_arguments.done",
        &json!({
            "type": "response.function_call_arguments.done",
            "item_id": item_id,
            "output_index": output_index,
            "arguments": arguments
        }),
    );
    push_sse_event(
        sse,
        "response.output_item.done",
        &json!({
            "type": "response.output_item.done",
            "output_index": output_index,
            "item": { "id": item_id, "type": "function_call", "call_id": call_id, "name": name, "arguments": arguments }
        }),
    );
}

fn push_sse_event(buffer: &mut String, event: &str, data: &Value) {
    buffer.push_str("event: ");
    buffer.push_str(event);
    buffer.push_str("\n");
    buffer.push_str("data: ");
    buffer.push_str(&data.to_string());
    buffer.push_str("\n\n");
}

fn value_to_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

fn check_codex() -> CodexCheckResult {
    match resolve_codex_binary() {
        Some((path, version)) => {
            let logged_in = codex_logged_in(&path);
            CodexCheckResult {
                installed: true,
                version,
                path,
                logged_in,
                error: if logged_in {
                    None
                } else {
                    Some("本地智能引擎已安装，但登录状态检查未发现可用会话。".to_string())
                },
            }
        }
        None => CodexCheckResult {
            installed: false,
            version: String::new(),
            path: String::new(),
            logged_in: false,
            error: Some(
                "没有找到可用的本地智能引擎，请先安装或修复后再试。".to_string(),
            ),
        },
    }
}

fn resolve_codex_binary() -> Option<(String, String)> {
    for candidate in codex_binary_candidates() {
        if let Some(version) = codex_version(&candidate) {
            return Some((candidate, version));
        }
    }
    None
}

fn codex_binary_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    candidates.push("/Applications/Codex.app/Contents/Resources/codex".to_string());

    if let Some(home) = home_dir() {
        candidates.push(format!("{home}/.mewclaw/npm-global/bin/codex"));
        candidates.push(format!("{home}/.npm-global/bin/codex"));
        candidates.push(format!("{home}/.local/bin/codex"));
    }

    candidates.push("/opt/homebrew/bin/codex".to_string());
    candidates.push("/usr/local/bin/codex".to_string());
    candidates.push("codex".to_string());

    let mut deduped = Vec::new();
    for candidate in candidates {
        if !deduped.contains(&candidate) {
            deduped.push(candidate);
        }
    }
    deduped
}

fn home_dir() -> Option<String> {
    std::env::var("HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn resolve_cwd(value: Option<&str>) -> Result<String, String> {
    if let Some(cwd) = value.map(str::trim).filter(|value| !value.is_empty()) {
        return Ok(cwd.to_string());
    }
    std::env::current_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to resolve current working directory: {e}"))
}

fn validate_cwd(cwd: &str) -> Result<&str, String> {
    validate_existing_directory(cwd, "工作目录")
}

fn validate_existing_directory<'a>(value: &'a str, label: &str) -> Result<&'a str, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(format!("{label}不能为空。"));
    }
    let path = Path::new(value);
    if !path.exists() {
        return Err(format!("{label}不存在：{value}"));
    }
    if !path.is_dir() {
        return Err(format!("{label}不是文件夹：{value}"));
    }
    Ok(value)
}

fn sanitize_brand_directory_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim().trim_matches('.');
    if trimmed.is_empty() {
        return Err("品牌目录名称不能为空。".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("品牌目录名称无效。".to_string());
    }
    let has_forbidden = trimmed
        .chars()
        .any(|ch| matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0'));
    if has_forbidden {
        return Err("品牌目录名称不能包含路径分隔符或特殊字符。".to_string());
    }
    Ok(trimmed.to_string())
}

fn sanitize_paths(paths: &[String]) -> Result<Vec<String>, String> {
    let sanitized = paths
        .iter()
        .map(|path| path.trim())
        .filter(|path| !path.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if sanitized.is_empty() {
        return Err("At least one path is required.".to_string());
    }
    Ok(sanitized)
}

async fn validate_branch_name(cwd: &str, name: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Branch name cannot be empty.".to_string());
    }
    run_git_owned(
        cwd,
        vec![
            "check-ref-format".to_string(),
            "--branch".to_string(),
            name.to_string(),
        ],
    )
    .await?;
    Ok(name.to_string())
}

async fn run_git(cwd: &str, args: &[&str]) -> Result<GitCommandResult, String> {
    run_git_owned(cwd, args.iter().map(|arg| arg.to_string()).collect()).await
}

async fn run_git_owned(cwd: &str, args: Vec<String>) -> Result<GitCommandResult, String> {
    let output = Command::new("git")
        .args(&args)
        .current_dir(cwd)
        .env("TERM", "xterm-256color")
        .env("NO_COLOR", "1")
        .output()
        .await
        .map_err(|e| format!("Failed to run git {}: {e}", args.join(" ")))?;
    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    let stderr = String::from_utf8_lossy(&output.stderr)
        .trim_end()
        .to_string();
    if output.status.success() {
        Ok(GitCommandResult { stdout, stderr })
    } else {
        let message = if stderr.is_empty() {
            stdout.clone()
        } else {
            stderr.clone()
        };
        Err(if message.is_empty() {
            format!("git {} exited with {}", args.join(" "), output.status)
        } else {
            message
        })
    }
}

// Like `run_git_owned` but returns stdout regardless of exit status. Used for
// commands such as `git diff --no-index` whose "differences found" result is a
// non-zero exit even though the output is exactly what we want.
async fn run_git_capture(cwd: &str, args: Vec<String>) -> Result<String, String> {
    let output = Command::new("git")
        .args(&args)
        .current_dir(cwd)
        .env("TERM", "xterm-256color")
        .env("NO_COLOR", "1")
        .output()
        .await
        .map_err(|e| format!("Failed to run git {}: {e}", args.join(" ")))?;
    // git uses exit code >1 for genuine errors; 0/1 are "no diff"/"diff".
    if let Some(code) = output.status.code() {
        if code > 1 {
            let stderr = String::from_utf8_lossy(&output.stderr)
                .trim_end()
                .to_string();
            return Err(if stderr.is_empty() {
                format!("git {} exited with {code}", args.join(" "))
            } else {
                stderr
            });
        }
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// Runs git with a patch piped to stdin (for `git apply`). Errors carry git's own
// stderr so the panel can surface why a hunk failed to apply.
async fn run_git_stdin(
    cwd: &str,
    args: Vec<String>,
    stdin: &str,
) -> Result<GitCommandResult, String> {
    let mut child = Command::new("git")
        .args(&args)
        .current_dir(cwd)
        .env("TERM", "xterm-256color")
        .env("NO_COLOR", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to run git {}: {e}", args.join(" ")))?;
    if let Some(mut handle) = child.stdin.take() {
        handle
            .write_all(stdin.as_bytes())
            .await
            .map_err(|e| format!("Failed to write patch to git: {e}"))?;
        handle
            .shutdown()
            .await
            .map_err(|e| format!("Failed to finish patch input: {e}"))?;
    }
    let output = child
        .wait_with_output()
        .await
        .map_err(|e| format!("Failed to run git {}: {e}", args.join(" ")))?;
    let stdout = String::from_utf8_lossy(&output.stdout)
        .trim_end()
        .to_string();
    let stderr = String::from_utf8_lossy(&output.stderr)
        .trim_end()
        .to_string();
    if output.status.success() {
        Ok(GitCommandResult { stdout, stderr })
    } else {
        let message = if stderr.is_empty() {
            stdout.clone()
        } else {
            stderr.clone()
        };
        Err(if message.is_empty() {
            format!("git {} exited with {}", args.join(" "), output.status)
        } else {
            message
        })
    }
}

fn parse_git_status(cwd: &str, output: &str) -> GitStatusResult {
    let mut branch = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut changes = Vec::new();

    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let parsed = parse_git_branch_header(header);
            branch = parsed.0;
            upstream = parsed.1;
            ahead = parsed.2;
            behind = parsed.3;
            continue;
        }
        if line.starts_with("!!") || line.len() < 3 {
            continue;
        }
        if let Some(change) = parse_git_change_line(line) {
            changes.push(change);
        }
    }

    GitStatusResult {
        cwd: cwd.to_string(),
        is_repository: true,
        branch,
        upstream,
        ahead,
        behind,
        clean: changes.is_empty(),
        changes,
        error: None,
    }
}

fn parse_git_branch_header(header: &str) -> (Option<String>, Option<String>, u32, u32) {
    let mut ahead = 0;
    let mut behind = 0;
    let (names, counts) = header.split_once(" [").unwrap_or((header, ""));
    for part in counts.trim_end_matches(']').split(',') {
        let part = part.trim();
        if let Some(value) = part.strip_prefix("ahead ") {
            ahead = value.parse().unwrap_or(0);
        } else if let Some(value) = part.strip_prefix("behind ") {
            behind = value.parse().unwrap_or(0);
        }
    }

    if let Some(rest) = names.strip_prefix("No commits yet on ") {
        return (Some(rest.trim().to_string()), None, ahead, behind);
    }
    if let Some((branch, upstream)) = names.split_once("...") {
        return (
            non_empty_string(branch),
            non_empty_string(upstream),
            ahead,
            behind,
        );
    }
    (non_empty_string(names), None, ahead, behind)
}

fn parse_git_change_line(line: &str) -> Option<GitFileChange> {
    let mut chars = line.chars();
    let index_status = chars.next()?;
    let working_tree_status = chars.next()?;
    let path_text = line.get(3..)?.trim();
    let (original_path, path) = if let Some((left, right)) = path_text.split_once(" -> ") {
        (Some(left.to_string()), right.to_string())
    } else {
        (None, path_text.to_string())
    };
    if path.is_empty() {
        return None;
    }

    let status = git_change_status(index_status, working_tree_status);
    let untracked = index_status == '?' && working_tree_status == '?';
    Some(GitFileChange {
        path,
        original_path,
        staged: !untracked && index_status != ' ',
        unstaged: !untracked && working_tree_status != ' ',
        index_status: index_status.to_string(),
        working_tree_status: working_tree_status.to_string(),
        status,
    })
}

fn git_change_status(index_status: char, working_tree_status: char) -> String {
    if index_status == '?' && working_tree_status == '?' {
        return "untracked".to_string();
    }
    if index_status == 'U'
        || working_tree_status == 'U'
        || matches!((index_status, working_tree_status), ('A', 'A') | ('D', 'D'))
    {
        return "conflicted".to_string();
    }
    let code = if index_status != ' ' {
        index_status
    } else {
        working_tree_status
    };
    match code {
        'A' => "added",
        'M' => "modified",
        'D' => "deleted",
        'R' => "renamed",
        'C' => "copied",
        'T' => "typechange",
        _ => "unknown",
    }
    .to_string()
}

fn parse_git_branches(output: &str) -> Vec<GitBranch> {
    output
        .lines()
        .filter_map(|line| {
            let parts = line.split('\t').collect::<Vec<_>>();
            let name = parts.first()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(GitBranch {
                name: name.to_string(),
                current: parts
                    .get(1)
                    .map(|value| value.trim() == "*")
                    .unwrap_or(false),
                upstream: parts.get(2).and_then(|value| non_empty_string(value)),
            })
        })
        .collect()
}

fn parse_git_commits(output: &str) -> Vec<GitCommit> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\u{1f}');
            let sha = parts.next()?.trim();
            if sha.is_empty() {
                return None;
            }
            Some(GitCommit {
                sha: sha.to_string(),
                short_sha: parts.next().unwrap_or("").trim().to_string(),
                subject: parts.next().unwrap_or("").trim().to_string(),
                author: parts.next().unwrap_or("").trim().to_string(),
                relative_date: parts.next().unwrap_or("").trim().to_string(),
            })
        })
        .collect()
}

fn parse_git_remotes(output: &str) -> Vec<GitRemote> {
    let mut remotes: Vec<GitRemote> = Vec::new();
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        let Some(name) = parts.next() else { continue };
        let Some(url) = parts.next() else { continue };
        let kind = parts.next().unwrap_or_default();
        let remote = match remotes.iter_mut().find(|remote| remote.name == name) {
            Some(remote) => remote,
            None => {
                remotes.push(GitRemote {
                    name: name.to_string(),
                    fetch_url: None,
                    push_url: None,
                });
                remotes.last_mut().expect("remote was just pushed")
            }
        };
        if kind.contains("fetch") {
            remote.fetch_url = Some(url.to_string());
        } else if kind.contains("push") {
            remote.push_url = Some(url.to_string());
        }
    }
    remotes
}

fn non_empty_string(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn codex_version(path: &str) -> Option<String> {
    if path.contains('/') && !PathBuf::from(path).is_file() {
        return None;
    }
    let output = std::process::Command::new(path)
        .arg("--version")
        .env("TERM", "xterm-256color")
        .env("NO_COLOR", "1")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    first_non_empty_line(&output.stdout)
        .or_else(|| first_non_empty_line(&output.stderr))
        .filter(|line| line.to_lowercase().contains("codex"))
}

fn codex_logged_in(path: &str) -> bool {
    let output = std::process::Command::new(path)
        .args(["login", "status"])
        .env("TERM", "xterm-256color")
        .env("NO_COLOR", "1")
        .output();
    match output {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

fn first_non_empty_line(bytes: &[u8]) -> Option<String> {
    String::from_utf8_lossy(bytes)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

pub fn parse_codex_json_event(
    line: &str,
    run_id: &str,
    conversation_id: &str,
) -> Option<CodexChatEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() || !trimmed.starts_with('{') {
        return None;
    }

    let raw: Value = serde_json::from_str(trimmed).ok()?;
    let event_type = raw.get("type").and_then(Value::as_str).unwrap_or_default();
    match event_type {
        "thread.started" => Some(event(
            "thread_started",
            run_id,
            conversation_id,
            raw.get("thread_id")
                .and_then(Value::as_str)
                .map(str::to_string),
            None,
            None,
            None,
            None,
            Some(raw),
        )),
        "agent_message_delta"
        | "response.output_text.delta"
        | "response.text.delta"
        | "output_text.delta"
        | "message.content.delta"
        | "content.delta"
        | "message.delta"
        | "agent_message"
        | "assistant_message" => {
            let text = first_string(&raw, &["delta", "text", "content"]);
            text.map(|text| {
                event(
                    "text_delta",
                    run_id,
                    conversation_id,
                    None,
                    None,
                    None,
                    Some(text),
                    None,
                    Some(raw),
                )
            })
        }
        "reasoning_delta"
        | "agent_reasoning_delta"
        | "response.reasoning.delta"
        | "response.reasoning_text.delta"
        | "response.reasoning_summary.delta"
        | "response.reasoning_summary_text.delta"
        | "reasoning.summary.delta"
        | "thought.delta" => {
            let text = first_string(&raw, &["delta", "text", "content"]);
            text.map(|text| {
                event(
                    "reasoning_delta",
                    run_id,
                    conversation_id,
                    None,
                    None,
                    None,
                    Some(text),
                    None,
                    Some(raw),
                )
            })
        }
        "exec_command.begin" | "exec_command.started" | "command_execution.started" => {
            parse_command_event("tool_started", &raw, run_id, conversation_id)
        }
        "exec_command.output_delta"
        | "exec_command.delta"
        | "command_execution.output_delta"
        | "command_execution.delta" => {
            parse_command_event("tool_delta", &raw, run_id, conversation_id)
        }
        "exec_command.end" | "exec_command.completed" | "command_execution.completed" => {
            parse_command_end_event(&raw, run_id, conversation_id)
        }
        "item.started" | "response.output_item.added" => {
            parse_item_event("tool_started", &raw, run_id, conversation_id)
        }
        "item.updated" => parse_item_update_event(&raw, run_id, conversation_id),
        "item.completed" | "response.output_item.done" => {
            parse_item_completed_event(&raw, run_id, conversation_id)
        }
        "turn.completed" | "response.completed" => Some(event(
            "completed",
            run_id,
            conversation_id,
            None,
            None,
            None,
            None,
            None,
            Some(raw),
        )),
        "turn.failed" | "response.failed" => {
            let message = first_string(&raw, &["message", "error"])
                .unwrap_or_else(|| "Codex turn failed.".to_string());
            Some(event(
                "error",
                run_id,
                conversation_id,
                None,
                None,
                None,
                None,
                Some(message),
                Some(raw),
            ))
        }
        "error" => {
            let message = first_string(&raw, &["message", "error"])
                .or_else(|| {
                    raw.get("error")
                        .and_then(|v| first_string(v, &["message", "code"]))
                })
                .unwrap_or_else(|| "Codex reported an error.".to_string());
            Some(event(
                "error",
                run_id,
                conversation_id,
                None,
                None,
                None,
                None,
                Some(message),
                Some(raw),
            ))
        }
        _ => None,
    }
}

fn parse_item_update_event(
    raw: &Value,
    run_id: &str,
    conversation_id: &str,
) -> Option<CodexChatEvent> {
    let item = raw.get("item").unwrap_or(raw);
    let item_type = normalized_item_type(item);
    let item_id = first_string(item, &["id", "item_id", "itemId"]);
    let text = first_string(
        raw,
        &["delta", "output_delta", "outputDelta", "text", "content"],
    )
    .or_else(|| {
        first_string(
            item,
            &["delta", "output_delta", "outputDelta", "text", "content"],
        )
    })
    .or_else(|| {
        let extracted = extract_text_content(item);
        if extracted.is_empty() {
            None
        } else {
            Some(extracted)
        }
    });

    if matches!(
        item_type.as_str(),
        "agentmessage" | "assistantmessage" | "message"
    ) {
        return text.map(|text| {
            event(
                "text_delta",
                run_id,
                conversation_id,
                None,
                item_id,
                None,
                Some(text),
                None,
                Some(raw.clone()),
            )
        });
    }

    if matches!(item_type.as_str(), "reasoning" | "thought" | "analysis") {
        return text.map(|text| {
            event(
                "reasoning_delta",
                run_id,
                conversation_id,
                None,
                item_id,
                None,
                Some(text),
                None,
                Some(raw.clone()),
            )
        });
    }

    if is_tool_item(&item_type) || item_type.is_empty() {
        return text.map(|text| {
            event(
                "tool_delta",
                run_id,
                conversation_id,
                None,
                item_id,
                item_title(item),
                Some(text),
                None,
                Some(raw.clone()),
            )
        });
    }

    None
}

fn parse_command_event(
    kind: &str,
    raw: &Value,
    run_id: &str,
    conversation_id: &str,
) -> Option<CodexChatEvent> {
    let item_id = first_string(raw, &["id", "item_id", "itemId", "call_id"])
        .or_else(|| Some("exec".to_string()));
    let text = command_text(
        raw,
        &[
            "command",
            "cmd",
            "delta",
            "output_delta",
            "outputDelta",
            "text",
            "content",
            "stdout",
            "stderr",
        ],
    );
    if kind == "tool_delta" && text.is_none() {
        return None;
    }
    Some(event(
        kind,
        run_id,
        conversation_id,
        None,
        item_id,
        Some("command_execution".to_string()),
        text,
        None,
        Some(raw.clone()),
    ))
}

fn parse_command_end_event(
    raw: &Value,
    run_id: &str,
    conversation_id: &str,
) -> Option<CodexChatEvent> {
    let item_id = first_string(raw, &["id", "item_id", "itemId", "call_id"])
        .or_else(|| Some("exec".to_string()));
    let status = first_string(raw, &["status", "outcome"])
        .unwrap_or_default()
        .to_lowercase();
    let exit_failed = raw
        .get("exit_code")
        .or_else(|| raw.get("exitCode"))
        .and_then(Value::as_i64)
        .map(|code| code != 0)
        .unwrap_or(false);
    let failed = exit_failed || status.contains("fail") || status.contains("error");
    let text = command_text(
        raw,
        &[
            "output",
            "aggregatedOutput",
            "result",
            "stdout",
            "stderr",
            "text",
            "message",
            "error",
        ],
    );
    Some(event(
        if failed {
            "tool_failed"
        } else {
            "tool_completed"
        },
        run_id,
        conversation_id,
        None,
        item_id,
        Some("command_execution".to_string()),
        text,
        None,
        Some(raw.clone()),
    ))
}

fn parse_item_completed_event(
    raw: &Value,
    run_id: &str,
    conversation_id: &str,
) -> Option<CodexChatEvent> {
    let item = raw.get("item").unwrap_or(raw);
    let item_type = normalized_item_type(item);
    let item_id = first_string(item, &["id", "item_id", "itemId"]);

    if matches!(
        item_type.as_str(),
        "agentmessage" | "assistantmessage" | "message"
    ) {
        let text = extract_text_content(item);
        if text.is_empty() {
            return None;
        }
        return Some(event(
            "text_delta",
            run_id,
            conversation_id,
            None,
            item_id,
            None,
            Some(text),
            None,
            Some(raw.clone()),
        ));
    }

    if matches!(item_type.as_str(), "reasoning" | "thought" | "analysis") {
        let text = extract_text_content(item);
        if text.is_empty() {
            return None;
        }
        return Some(event(
            "reasoning_delta",
            run_id,
            conversation_id,
            None,
            item_id,
            None,
            Some(text),
            None,
            Some(raw.clone()),
        ));
    }

    if is_tool_item(&item_type) {
        let status = first_string(item, &["status", "outcome"])
            .unwrap_or_default()
            .to_lowercase();
        let failed =
            status.contains("fail") || status.contains("error") || item.get("error").is_some();
        let output = extract_tool_output(item)
            // Fall back to the query/args so web/file search still shows what was searched.
            .or_else(|| extract_tool_input(item))
            .or_else(|| first_string(item, &["error", "message"]))
            .or_else(|| item.get("error").map(|value| value.to_string()));
        return Some(event(
            if failed {
                "tool_failed"
            } else {
                "tool_completed"
            },
            run_id,
            conversation_id,
            None,
            item_id,
            item_title(item),
            output,
            None,
            Some(raw.clone()),
        ));
    }

    None
}

fn parse_item_event(
    kind: &str,
    raw: &Value,
    run_id: &str,
    conversation_id: &str,
) -> Option<CodexChatEvent> {
    let item = raw.get("item").unwrap_or(raw);
    let item_type = normalized_item_type(item);
    if !is_tool_item(&item_type) {
        return None;
    }
    Some(event(
        kind,
        run_id,
        conversation_id,
        None,
        first_string(item, &["id", "item_id", "itemId"]),
        item_title(item),
        extract_tool_input(item),
        None,
        Some(raw.clone()),
    ))
}

fn is_tool_item(normalized_type: &str) -> bool {
    normalized_type.contains("tool")
        || normalized_type.contains("command")
        || normalized_type.contains("exec")
        || normalized_type.contains("shell")
        || normalized_type.contains("functioncall")
        || normalized_type.contains("mcpcall")
        || normalized_type.contains("filechange")
        || normalized_type.contains("websearch")
        || normalized_type.contains("filesearch")
        || normalized_type.contains("webfetch")
}

fn normalized_item_type(item: &Value) -> String {
    item.get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .replace('_', "")
        .replace('-', "")
        .to_lowercase()
}

fn item_title(item: &Value) -> Option<String> {
    first_string(item, &["title", "name", "tool", "toolName", "type"]).map(|value| {
        match value.as_str() {
            "command_execution" | "commandExecution" | "exec" | "shell" => "execute".to_string(),
            other => other.to_string(),
        }
    })
}

fn extract_tool_input(item: &Value) -> Option<String> {
    first_string(
        item,
        &["command", "query", "path", "input", "arguments", "args"],
    )
    // Web search items (web_search_call) carry the query under `action`.
    .or_else(|| {
        item.get("action")
            .and_then(|action| first_string(action, &["query", "url", "command"]))
    })
    .or_else(|| {
        item.get("input")
            .or_else(|| item.get("arguments"))
            .or_else(|| item.get("args"))
            .map(|value| value.to_string())
    })
}

fn extract_tool_output(item: &Value) -> Option<String> {
    first_string(
        item,
        &[
            "output",
            "aggregatedOutput",
            "result",
            "stdout",
            "stderr",
            "diff",
        ],
    )
    .or_else(|| item.get("content").map(|value| value.to_string()))
}

fn extract_text_content(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    if let Some(text) = first_string(value, &["text", "content", "summary", "message"]) {
        return text;
    }
    for key in ["content", "text", "summary", "message", "output_text"] {
        if let Some(child) = value.get(key) {
            let text = extract_text_content(child);
            if !text.is_empty() {
                return text;
            }
        }
    }
    if let Some(items) = value.as_array() {
        return items
            .iter()
            .map(extract_text_content)
            .collect::<Vec<_>>()
            .join("");
    }
    if let Some(summary) = value.get("summary").and_then(Value::as_array) {
        return summary
            .iter()
            .map(extract_text_content)
            .collect::<Vec<_>>()
            .join("");
    }
    String::new()
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(candidate) = value.get(*key) else {
            continue;
        };
        if let Some(text) = candidate
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return Some(text.to_string());
        }
    }
    None
}

fn command_text(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(candidate) = value.get(*key) else {
            continue;
        };
        if let Some(text) = candidate
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
        {
            return Some(text.to_string());
        }
        if let Some(items) = candidate.as_array() {
            let text = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !text.is_empty() {
                return Some(text);
            }
        }
        if candidate.is_object() {
            return Some(candidate.to_string());
        }
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn event(
    event_type: &str,
    run_id: &str,
    conversation_id: &str,
    thread_id: Option<String>,
    item_id: Option<String>,
    title: Option<String>,
    text: Option<String>,
    message: Option<String>,
    raw: Option<Value>,
) -> CodexChatEvent {
    CodexChatEvent {
        event_type: event_type.to_string(),
        run_id: run_id.to_string(),
        conversation_id: Some(conversation_id.to_string()),
        thread_id,
        item_id,
        title,
        text,
        message,
        raw,
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(CodexProcessState::default())
        .manage(TerminalState::default())
        .invoke_handler(tauri::generate_handler![
            codex_check,
            model_config_load,
            model_config_save,
            codex_chat_start,
            codex_chat_stop,
            list_open_apps,
            open_in_app,
            brand_directory_create,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_stop,
            git_diff_stat,
            gh_auth_status,
            git_status,
            git_diff,
            git_discard,
            git_apply_patch,
            git_stage,
            git_unstage,
            git_commit,
            git_branch_list,
            git_recent_commits,
            git_create_branch,
            git_checkout_branch,
            git_pull,
            git_push,
            git_remotes,
            gh_pr_create_web,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Incuboot");
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{
                        apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
                    };
                    let _ = apply_vibrancy(
                        &window,
                        NSVisualEffectMaterial::Sidebar,
                        Some(NSVisualEffectState::Active),
                        None,
                    );
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Incuboot");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_brand_directory_names() {
        assert_eq!(
            sanitize_brand_directory_name("  Acme Brand  ").unwrap(),
            "Acme Brand"
        );
        assert_eq!(sanitize_brand_directory_name("品牌").unwrap(), "品牌");
        assert!(sanitize_brand_directory_name("").is_err());
        assert!(sanitize_brand_directory_name("../Brand").is_err());
        assert!(sanitize_brand_directory_name("Brand/Assets").is_err());
        assert!(sanitize_brand_directory_name("Brand:Assets").is_err());
    }

    #[test]
    fn parses_thread_started() {
        let event = parse_codex_json_event(
            r#"{"type":"thread.started","thread_id":"abc"}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(event.event_type, "thread_started");
        assert_eq!(event.thread_id.as_deref(), Some("abc"));
    }

    #[test]
    fn parses_agent_message_completed_as_text_delta() {
        let event = parse_codex_json_event(
            r#"{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(event.event_type, "text_delta");
        assert_eq!(event.text.as_deref(), Some("ok"));
    }

    #[test]
    fn parses_agent_message_updates_as_text_delta() {
        let event = parse_codex_json_event(
            r#"{"type":"item.updated","item":{"id":"item_0","type":"assistant_message","content":[{"type":"output_text","text":"hello"}]}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(event.event_type, "text_delta");
        assert_eq!(event.text.as_deref(), Some("hello"));
    }

    #[test]
    fn parses_response_output_item_done_as_text_delta() {
        let event = parse_codex_json_event(
            r#"{"type":"response.output_item.done","item":{"id":"msg_1","type":"message","content":[{"type":"output_text","text":"done"}]}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(event.event_type, "text_delta");
        assert_eq!(event.text.as_deref(), Some("done"));
    }

    #[test]
    fn parses_reasoning_delta() {
        let event = parse_codex_json_event(
            r#"{"type":"reasoning_delta","delta":"thinking"}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(event.event_type, "reasoning_delta");
        assert_eq!(event.text.as_deref(), Some("thinking"));
    }

    #[test]
    fn parses_tool_start_and_completion() {
        let started = parse_codex_json_event(
            r#"{"type":"item.started","item":{"id":"tool_1","type":"command_execution","command":"ls"}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(started.event_type, "tool_started");
        assert_eq!(started.title.as_deref(), Some("execute"));
        assert_eq!(started.text.as_deref(), Some("ls"));

        let completed = parse_codex_json_event(
            r#"{"type":"item.completed","item":{"id":"tool_1","type":"command_execution","output":"done"}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(completed.event_type, "tool_completed");
        assert_eq!(completed.text.as_deref(), Some("done"));
    }

    #[test]
    fn parses_function_call_as_tool() {
        let started = parse_codex_json_event(
            r#"{"type":"response.output_item.added","item":{"id":"call_1","type":"function_call","name":"web.run","arguments":"{\"q\":\"test\"}"}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(started.event_type, "tool_started");
        assert_eq!(started.title.as_deref(), Some("web.run"));
        assert_eq!(started.text.as_deref(), Some("{\"q\":\"test\"}"));
    }

    #[test]
    fn parses_web_search_item() {
        let started = parse_codex_json_event(
            r#"{"type":"response.output_item.added","item":{"id":"ws_1","type":"web_search_call","action":{"type":"search","query":"hangzhou weather"}}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(started.event_type, "tool_started");
        assert_eq!(started.title.as_deref(), Some("web_search_call"));
        assert_eq!(started.text.as_deref(), Some("hangzhou weather"));

        let completed = parse_codex_json_event(
            r#"{"type":"item.completed","item":{"id":"ws_1","type":"web_search","action":{"query":"hangzhou weather"}}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(completed.event_type, "tool_completed");
    }

    #[test]
    fn parses_exec_command_events() {
        let started = parse_codex_json_event(
            r#"{"type":"exec_command.begin","id":"cmd_1","command":["npm","test"]}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(started.event_type, "tool_started");
        assert_eq!(started.item_id.as_deref(), Some("cmd_1"));
        assert_eq!(started.text.as_deref(), Some("npm test"));

        let delta = parse_codex_json_event(
            r#"{"type":"exec_command.output_delta","id":"cmd_1","delta":"running"}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(delta.event_type, "tool_delta");
        assert_eq!(delta.text.as_deref(), Some("running"));

        let failed = parse_codex_json_event(
            r#"{"type":"exec_command.end","id":"cmd_1","exit_code":1,"stderr":"failed"}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(failed.event_type, "tool_failed");
        assert_eq!(failed.text.as_deref(), Some("failed"));
    }

    #[test]
    fn parses_error_event() {
        let event =
            parse_codex_json_event(r#"{"type":"error","message":"bad"}"#, "run-1", "conv-1")
                .unwrap();
        assert_eq!(event.event_type, "error");
        assert_eq!(event.message.as_deref(), Some("bad"));
    }

    #[test]
    fn app_server_streams_agent_message_delta_and_suppresses_completed() {
        let mut streamed = HashSet::new();
        let delta = map_app_server_notification(
            "item/agentMessage/delta",
            &serde_json::json!({ "threadId": "t", "turnId": "u", "itemId": "item_0", "delta": "Hello" }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(delta.len(), 1);
        assert_eq!(delta[0].event_type, "text_delta");
        assert_eq!(delta[0].text.as_deref(), Some("Hello"));

        // The matching item.completed must not re-emit the full text.
        let completed = map_app_server_notification(
            "item/completed",
            &serde_json::json!({ "item": { "id": "item_0", "type": "agentMessage", "text": "Hello world" } }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert!(completed.is_empty());
    }

    #[test]
    fn app_server_falls_back_to_completed_message_without_deltas() {
        let mut streamed = HashSet::new();
        let completed = map_app_server_notification(
            "item/completed",
            &serde_json::json!({ "item": { "id": "item_0", "type": "agentMessage", "text": "Final" } }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].event_type, "text_delta");
        assert_eq!(completed[0].text.as_deref(), Some("Final"));
    }

    #[test]
    fn app_server_maps_reasoning_delta() {
        let mut streamed = HashSet::new();
        let events = map_app_server_notification(
            "item/reasoning/summaryTextDelta",
            &serde_json::json!({ "itemId": "r0", "delta": "thinking" }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "reasoning_delta");
        assert_eq!(events[0].text.as_deref(), Some("thinking"));
    }

    #[test]
    fn app_server_maps_command_execution_lifecycle() {
        let mut streamed = HashSet::new();
        let started = map_app_server_notification(
            "item/started",
            &serde_json::json!({ "item": { "id": "c1", "type": "commandExecution", "command": "ls -la", "status": "inProgress" } }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(started.len(), 1);
        assert_eq!(started[0].event_type, "tool_started");
        assert_eq!(started[0].title.as_deref(), Some("execute"));
        assert_eq!(started[0].text.as_deref(), Some("ls -la"));

        let delta = map_app_server_notification(
            "item/commandExecution/outputDelta",
            &serde_json::json!({ "itemId": "c1", "delta": "file.txt\n" }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(delta.len(), 1);
        assert_eq!(delta[0].event_type, "tool_delta");
        assert_eq!(delta[0].item_id.as_deref(), Some("c1"));
        assert_eq!(delta[0].text.as_deref(), Some("file.txt\n"));

        let failed = map_app_server_notification(
            "item/completed",
            &serde_json::json!({ "item": { "id": "c1", "type": "commandExecution", "status": "failed", "aggregatedOutput": "boom", "exitCode": 1 } }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(failed.len(), 1);
        assert_eq!(failed[0].event_type, "tool_failed");
        assert_eq!(failed[0].text.as_deref(), Some("boom"));
    }

    #[test]
    fn app_server_maps_error_notification() {
        let mut streamed = HashSet::new();
        let events = map_app_server_notification(
            "error",
            &serde_json::json!({ "error": { "message": "rate limited" }, "willRetry": false, "threadId": "t", "turnId": "u" }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "error");
        assert_eq!(events[0].message.as_deref(), Some("rate limited"));
    }

    #[test]
    fn app_server_maps_retryable_error_as_status_notification() {
        let mut streamed = HashSet::new();
        let events = map_app_server_notification(
            "error",
            &serde_json::json!({ "error": { "message": "Reconnecting... 2/5" }, "willRetry": true, "threadId": "t", "turnId": "u" }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "status");
        assert_eq!(events[0].message.as_deref(), Some("Reconnecting... 2/5"));

        let nested = map_app_server_notification(
            "error",
            &serde_json::json!({ "error": { "message": "Reconnecting... 2/5", "willRetry": true }, "threadId": "t", "turnId": "u" }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(nested.len(), 1);
        assert_eq!(nested[0].event_type, "status");
        assert_eq!(nested[0].message.as_deref(), Some("Reconnecting... 2/5"));
    }

    #[test]
    fn app_server_args_include_custom_provider_config() {
        let provider = ModelProviderConfig {
            id: "deepseek".to_string(),
            base_url: "https://api.deepseek.com/v1".to_string(),
            api_key: Some("sk-test".to_string()),
            wire_api: Some("responses".to_string()),
            adapter: None,
            show_raw_reasoning: true,
        };

        let args = codex_app_server_args(Some(&provider));

        assert_eq!(
            args,
            vec![
                "app-server",
                "--config",
                "model_provider=\"deepseek\"",
                "--config",
                "model_providers.deepseek.name=\"deepseek\"",
                "--config",
                "model_providers.deepseek.base_url=\"https://api.deepseek.com/v1\"",
                "--config",
                "model_providers.deepseek.env_key=\"ALPHA_STUDIO_DEEPSEEK_API_KEY\"",
                "--config",
                "model_providers.deepseek.wire_api=\"responses\"",
                "--config",
                "show_raw_agent_reasoning=true",
            ]
        );
    }

    #[test]
    fn app_server_args_fall_back_to_openai_without_provider_config() {
        assert_eq!(codex_app_server_args(None), vec!["app-server".to_string()]);
    }

    #[test]
    fn sanitizes_empty_provider_as_openai() {
        let request = codex_request_with_provider(None, None, None, None);

        assert_eq!(sanitize_model_provider(&request).unwrap(), None);
    }

    #[test]
    fn rejects_invalid_provider_id_and_base_url() {
        let bad_provider = codex_request_with_provider(
            Some("deep.seek"),
            Some("https://api.deepseek.com/v1"),
            None,
            None,
        );
        assert!(sanitize_model_provider(&bad_provider).is_err());

        let bad_url =
            codex_request_with_provider(Some("deepseek"), Some("file:///tmp/socket"), None, None);
        assert!(sanitize_model_provider(&bad_url).is_err());
    }

    #[test]
    fn sanitizes_custom_provider_with_api_key() {
        let request = codex_request_with_provider(
            Some("deepseek"),
            Some("https://api.deepseek.com/v1"),
            Some("sk-test"),
            Some("responses"),
        );

        let provider = sanitize_model_provider(&request).unwrap().unwrap();

        assert_eq!(provider.id, "deepseek");
        assert_eq!(provider.base_url, "https://api.deepseek.com/v1");
        assert_eq!(provider.api_key.as_deref(), Some("sk-test"));
        assert_eq!(provider.wire_api.as_deref(), Some("responses"));
    }

    #[test]
    fn sanitizes_chat_completions_provider_with_local_adapter() {
        let request = codex_request_with_provider(
            Some("deepseek"),
            Some("https://api.deepseek.com"),
            Some("sk-test"),
            Some("chat"),
        );

        let provider = sanitize_model_provider(&request).unwrap().unwrap();

        assert_eq!(provider.base_url, "https://api.deepseek.com");
        assert_eq!(provider.wire_api.as_deref(), Some("responses"));
        assert_eq!(provider.api_key.as_deref(), Some("sk-test"));
        assert_eq!(
            provider.adapter,
            Some(ModelProviderAdapter {
                upstream_base_url: "https://api.deepseek.com".to_string(),
                api_key: Some("sk-test".to_string()),
                thinking_enabled: true,
            })
        );
    }

    #[test]
    fn adapter_translates_responses_request_to_chat_completion() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "instructions": "system rules",
            "input": [
                { "type": "message", "role": "developer", "content": [{ "type": "input_text", "text": "dev rules" }] },
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "hello" }] },
                { "type": "function_call", "call_id": "call_1", "name": "exec_command", "arguments": "{\"cmd\":\"date\"}" },
                { "type": "function_call_output", "call_id": "call_1", "output": "today" }
            ],
            "tools": [
                { "type": "function", "name": "exec_command", "description": "run", "parameters": { "type": "object" } }
            ],
            "reasoning": { "effort": "xhigh" },
            "max_output_tokens": 123
        });

        let chat = build_chat_completion_request(&request, true, &HashMap::new()).unwrap();
        let messages = chat.get("messages").and_then(Value::as_array).unwrap();

        assert_eq!(
            chat.get("model").and_then(Value::as_str),
            Some("deepseek-v4-flash")
        );
        assert_eq!(chat.get("stream").and_then(Value::as_bool), Some(false));
        assert_eq!(
            chat.get("reasoning_effort").and_then(Value::as_str),
            Some("max")
        );
        assert_eq!(
            chat.get("thinking")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            Some("enabled")
        );
        assert_eq!(chat.get("max_tokens").and_then(Value::as_i64), Some(123));
        assert_eq!(
            messages[0].get("role").and_then(Value::as_str),
            Some("system")
        );
        assert!(messages[0]
            .get("content")
            .and_then(Value::as_str)
            .unwrap()
            .contains("system rules"));
        assert_eq!(
            messages[1].get("role").and_then(Value::as_str),
            Some("user")
        );
        assert_eq!(
            messages[2].get("role").and_then(Value::as_str),
            Some("assistant")
        );
        assert_eq!(
            messages[3].get("role").and_then(Value::as_str),
            Some("tool")
        );
        assert!(chat.get("tools").and_then(Value::as_array).unwrap()[0]
            .get("function")
            .is_some());
    }

    #[test]
    fn adapter_can_disable_chat_completion_thinking() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "hello" }] }
            ],
            "reasoning": { "effort": "xhigh" }
        });

        let chat = build_chat_completion_request(&request, false, &HashMap::new()).unwrap();

        assert_eq!(
            chat.get("thinking")
                .and_then(|value| value.get("type"))
                .and_then(Value::as_str),
            Some("disabled")
        );
        assert!(chat.get("reasoning_effort").is_none());
    }

    #[test]
    fn adapter_preserves_reasoning_content_for_tool_call_history() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "查一下项目结构" }] },
                { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "需要先读取文件列表" }] },
                { "type": "function_call", "call_id": "call_1", "name": "exec_command", "arguments": "{\"cmd\":\"find . -maxdepth 2\"}" },
                { "type": "function_call_output", "call_id": "call_1", "output": "package.json" }
            ],
            "tools": [
                { "type": "function", "name": "exec_command", "description": "run", "parameters": { "type": "object" } }
            ],
            "reasoning": { "effort": "high" }
        });

        let chat = build_chat_completion_request(&request, true, &HashMap::new()).unwrap();
        let messages = chat.get("messages").and_then(Value::as_array).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.get("tool_calls").is_some())
            .unwrap();

        assert_eq!(
            assistant.get("reasoning_content").and_then(Value::as_str),
            Some("需要先读取文件列表")
        );
        assert!(assistant
            .get("tool_calls")
            .and_then(Value::as_array)
            .is_some());
    }

    #[test]
    fn adapter_groups_parallel_function_calls_before_tool_outputs() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "调研一下项目" }] },
                { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "需要并行读取 package 和目录结构" }] },
                { "type": "function_call", "call_id": "call_1", "name": "exec_command", "arguments": "{\"cmd\":\"cat package.json\"}" },
                { "type": "function_call", "call_id": "call_2", "name": "exec_command", "arguments": "{\"cmd\":\"find . -maxdepth 2\"}" },
                { "type": "function_call_output", "call_id": "call_1", "output": "{\"scripts\":{}}" },
                { "type": "function_call_output", "call_id": "call_2", "output": "src\nsrc-tauri" }
            ],
            "tools": [
                { "type": "function", "name": "exec_command", "description": "run", "parameters": { "type": "object" } }
            ],
            "reasoning": { "effort": "high" }
        });

        let chat = build_chat_completion_request(&request, true, &HashMap::new()).unwrap();
        let messages = chat.get("messages").and_then(Value::as_array).unwrap();

        assert_eq!(messages.len(), 4);
        assert_eq!(
            messages[1].get("role").and_then(Value::as_str),
            Some("assistant")
        );
        assert_eq!(
            messages[1].get("reasoning_content").and_then(Value::as_str),
            Some("需要并行读取 package 和目录结构")
        );
        let tool_calls = messages[1]
            .get("tool_calls")
            .and_then(Value::as_array)
            .unwrap();
        assert_eq!(tool_calls.len(), 2);
        assert_eq!(
            tool_calls[0].get("id").and_then(Value::as_str),
            Some("call_1")
        );
        assert_eq!(
            tool_calls[1].get("id").and_then(Value::as_str),
            Some("call_2")
        );
        assert_eq!(
            messages[2].get("tool_call_id").and_then(Value::as_str),
            Some("call_1")
        );
        assert_eq!(
            messages[3].get("tool_call_id").and_then(Value::as_str),
            Some("call_2")
        );
    }

    #[test]
    fn adapter_restores_cached_reasoning_content_for_tool_call_history() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "查一下项目结构" }] },
                { "type": "function_call", "call_id": "call_1", "name": "exec_command", "arguments": "{\"cmd\":\"find . -maxdepth 2\"}" },
                { "type": "function_call_output", "call_id": "call_1", "output": "package.json" }
            ],
            "tools": [
                { "type": "function", "name": "exec_command", "description": "run", "parameters": { "type": "object" } }
            ],
            "reasoning": { "effort": "high" }
        });
        let reasoning_by_call_id =
            HashMap::from([("call_1".to_string(), "需要先读取文件列表".to_string())]);

        let chat = build_chat_completion_request(&request, true, &reasoning_by_call_id).unwrap();
        let messages = chat.get("messages").and_then(Value::as_array).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.get("tool_calls").is_some())
            .unwrap();

        assert_eq!(
            assistant.get("reasoning_content").and_then(Value::as_str),
            Some("需要先读取文件列表")
        );
    }

    #[test]
    fn adapter_caches_reasoning_content_by_tool_call_id() {
        let state = ChatAdapterState {
            conversation_id: "conv-1".to_string(),
            reasoning_by_conversation: Arc::new(StdMutex::new(HashMap::new())),
        };
        let response = serde_json::json!({
            "id": "chatcmpl_test",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "reasoning_content": "需要先读取文件列表",
                    "content": "",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{\"cmd\":\"find . -maxdepth 2\"}" }
                    }]
                }
            }]
        });

        remember_chat_reasoning_for_tool_calls(&state, &response);

        let stored = adapter_reasoning_snapshot(&state);
        assert_eq!(
            stored.get("call_1").map(String::as_str),
            Some("需要先读取文件列表")
        );
    }

    #[test]
    fn adapter_scopes_cached_reasoning_by_conversation() {
        let reasoning_by_conversation = Arc::new(StdMutex::new(HashMap::new()));
        let first = ChatAdapterState {
            conversation_id: "conv-1".to_string(),
            reasoning_by_conversation: reasoning_by_conversation.clone(),
        };
        let second = ChatAdapterState {
            conversation_id: "conv-2".to_string(),
            reasoning_by_conversation,
        };
        let response = serde_json::json!({
            "choices": [{
                "message": {
                    "reasoning_content": "conv one reasoning",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{}" }
                    }]
                }
            }]
        });

        remember_chat_reasoning_for_tool_calls(&first, &response);

        assert_eq!(
            adapter_reasoning_snapshot(&first)
                .get("call_1")
                .map(String::as_str),
            Some("conv one reasoning")
        );
        assert!(adapter_reasoning_snapshot(&second).get("call_1").is_none());
    }

    #[test]
    fn adapter_translates_chat_completion_to_responses_sse() {
        let chat = serde_json::json!({
            "id": "chatcmpl_test",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "reasoning_content": "先分析问题",
                    "content": "hello",
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{\"cmd\":\"date\"}" }
                    }]
                }
            }]
        });

        let sse = responses_sse_from_chat_completion(&chat).unwrap();

        assert!(sse.contains("event: response.output_text.delta"));
        assert!(sse.contains("\"delta\":\"hello\""));
        assert!(sse.contains("event: response.reasoning_summary_text.delta"));
        assert!(sse.contains("\"delta\":\"先分析问题\""));
        assert!(sse.contains("event: response.function_call_arguments.done"));
        assert!(sse.contains("\"name\":\"exec_command\""));
        assert!(sse.contains("data: [DONE]"));
    }

    #[test]
    fn model_config_json_can_be_edited_by_other_tools() {
        let config: ModelConfigLoadResult = serde_json::from_str(
            r#"{
              "version": 1,
              "selectedModelProfileId": "deepseek",
              "modelProfiles": [
                {
                  "id": "deepseek",
                  "label": "DeepSeek V4",
                  "providerId": "deepseek",
                  "model": "deepseek-chat",
                  "wireApi": "chat",
                  "baseUrl": "https://api.deepseek.com/v1",
                  "apiKey": "sk-test",
                  "enabled": true,
                  "supportsReasoningEffort": false
                }
              ]
            }"#,
        )
        .unwrap();

        assert_eq!(
            config.selected_model_profile_id.as_deref(),
            Some("deepseek")
        );
        assert_eq!(config.model_profiles[0].api_key.as_deref(), Some("sk-test"));
        assert!(config.path.is_empty());
    }

    fn codex_request_with_provider(
        provider_id: Option<&str>,
        provider_base_url: Option<&str>,
        provider_api_key: Option<&str>,
        provider_wire_api: Option<&str>,
    ) -> CodexChatRequest {
        CodexChatRequest {
            conversation_id: "conv-1".to_string(),
            prompt: "hello".to_string(),
            codex_thread_id: None,
            cwd: None,
            model: Some("gpt-5.5".to_string()),
            provider_id: provider_id.map(str::to_string),
            provider_base_url: provider_base_url.map(str::to_string),
            provider_api_key: provider_api_key.map(str::to_string),
            provider_wire_api: provider_wire_api.map(str::to_string),
            provider_thinking_enabled: Some(provider_wire_api == Some("chat")),
            reasoning_effort: None,
            sandbox_mode: None,
        }
    }

    #[test]
    fn ignores_unknown_and_non_json_lines() {
        assert!(parse_codex_json_event("WARN noisy line", "run-1", "conv-1").is_none());
        assert!(parse_codex_json_event(r#"{"type":"turn.started"}"#, "run-1", "conv-1").is_none());
    }

    #[test]
    fn parses_git_status_with_branch_and_changes() {
        let status = parse_git_status(
            "/repo",
            "## main...origin/main [ahead 1, behind 2]\n M src/App.tsx\nA  README.md\nR  old.ts -> new.ts\n?? scratch.txt\n",
        );

        assert!(status.is_repository);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!(status.ahead, 1);
        assert_eq!(status.behind, 2);
        assert!(!status.clean);
        assert_eq!(status.changes.len(), 4);
        assert_eq!(status.changes[0].status, "modified");
        assert!(status.changes[0].unstaged);
        assert_eq!(status.changes[2].original_path.as_deref(), Some("old.ts"));
        assert_eq!(status.changes[2].path, "new.ts");
        assert_eq!(status.changes[3].status, "untracked");
    }

    #[test]
    fn parses_git_branches_and_remotes() {
        let branches = parse_git_branches("main\t*\torigin/main\nfeature\t\torigin/feature\n");
        assert_eq!(branches.len(), 2);
        assert!(branches[0].current);
        assert_eq!(branches[0].upstream.as_deref(), Some("origin/main"));

        let remotes = parse_git_remotes(
            "origin\thttps://example.com/repo.git (fetch)\norigin\tgit@example.com:repo.git (push)\n",
        );
        assert_eq!(remotes.len(), 1);
        assert_eq!(remotes[0].name, "origin");
        assert_eq!(
            remotes[0].fetch_url.as_deref(),
            Some("https://example.com/repo.git")
        );
        assert_eq!(
            remotes[0].push_url.as_deref(),
            Some("git@example.com:repo.git")
        );
    }

    #[test]
    fn parses_recent_commits() {
        let raw = "abc123def\u{1f}abc123d\u{1f}Add review feature\u{1f}Ada\u{1f}2 hours ago\n\
                   999fedcba\u{1f}999fedc\u{1f}Fix branch checkout\u{1f}Lin\u{1f}yesterday";
        let commits = parse_git_commits(raw);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].sha, "abc123def");
        assert_eq!(commits[0].short_sha, "abc123d");
        assert_eq!(commits[0].subject, "Add review feature");
        assert_eq!(commits[0].author, "Ada");
        assert_eq!(commits[0].relative_date, "2 hours ago");
        assert_eq!(commits[1].subject, "Fix branch checkout");
    }
}
