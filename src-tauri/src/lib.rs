use base64::Engine as _;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

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
    reasoning_effort: Option<String>,
    sandbox_mode: Option<String>,
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
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct GitPathsRequest {
    cwd: String,
    paths: Vec<String>,
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
async fn codex_chat_start(
    app: AppHandle,
    state: State<'_, CodexProcessState>,
    request: CodexChatRequest,
) -> Result<CodexChatStartResult, String> {
    let check = check_codex();
    if !check.installed {
        return Err(check
            .error
            .unwrap_or_else(|| "Codex CLI is not installed or cannot be executed.".to_string()));
    }
    if !check.logged_in {
        return Err(check
            .error
            .unwrap_or_else(|| "Codex CLI is installed but not logged in.".to_string()));
    }

    let run_id = generate_run_id();
    let cwd = resolve_cwd(request.cwd.as_deref())?;
    let sandbox_mode = sanitize_sandbox_mode(request.sandbox_mode.as_deref());
    // We talk to the long-running `codex app-server` over a JSON-RPC stdio
    // channel instead of `codex exec`. The exec JSONL stream only emits the
    // final assistant message in a single `item.completed`, so nothing renders
    // until the whole turn is done. The app-server protocol streams
    // `item/agentMessage/delta` notifications token-by-token, which is what
    // gives the UI a live, incremental response.
    let mut command = Command::new(&check.path);
    command.arg("app-server");
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
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
}

impl CodexDriver {
    async fn run(
        self,
        stdin: tokio::process::ChildStdin,
        stdout: tokio::process::ChildStdout,
    ) {
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
                        "title": "Alpha Studio",
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
                    let will_retry = params
                        .get("willRetry")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    if !will_retry {
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

async fn send_jsonrpc(stdin: &mut tokio::process::ChildStdin, message: &Value) -> Result<(), String> {
    let mut bytes = serde_json::to_vec(message).map_err(|e| format!("Failed to encode request: {e}"))?;
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
            vec![event("text_delta", run_id, conversation_id, None, None, None, Some(delta.to_string()), None, None)]
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
            vec![event("reasoning_delta", run_id, conversation_id, None, None, None, Some(delta.to_string()), None, None)]
        }
        "item/commandExecution/outputDelta" => {
            let Some(delta) = params.get("delta").and_then(Value::as_str) else {
                return Vec::new();
            };
            if delta.is_empty() {
                return Vec::new();
            }
            let item_id = params.get("itemId").and_then(Value::as_str).map(str::to_string);
            vec![event("tool_delta", run_id, conversation_id, None, item_id, Some("command_execution".to_string()), Some(delta.to_string()), None, None)]
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

            if matches!(item_type.as_str(), "agentmessage" | "assistantmessage" | "message") {
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
                return vec![event("text_delta", run_id, conversation_id, None, item_id, None, Some(text), None, None)];
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
                return vec![event("reasoning_delta", run_id, conversation_id, None, item_id, None, Some(text), None, None)];
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
            vec![event("error", run_id, conversation_id, None, None, None, None, Some(message), None)]
        }
        _ => Vec::new(),
    }
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
            ("pycharm", &["PyCharm.app", "PyCharm CE.app", "PyCharm Community Edition.app"]),
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
            "vscode" => vec!["-a".to_string(), "Visual Studio Code".to_string(), path.to_string()],
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
    let mut args = vec!["diff".to_string()];
    if request.staged.unwrap_or(false) {
        args.push("--cached".to_string());
    }
    if let Some(path) = request.path.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        args.push("--".to_string());
        args.push(path.to_string());
    }
    let output = run_git_owned(cwd, args).await?;
    Ok(output.stdout)
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
    let mut args = vec!["restore".to_string(), "--staged".to_string(), "--".to_string()];
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
    run_git_owned(cwd, vec!["commit".to_string(), "-m".to_string(), message.to_string()]).await
}

#[tauri::command]
async fn git_branch_list(request: GitCwdRequest) -> Result<Vec<GitBranch>, String> {
    let cwd = validate_cwd(&request.cwd)?;
    let output = run_git(cwd, &["branch", "--format=%(refname:short)%09%(HEAD)%09%(upstream:short)"]).await?;
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
        let branch = run_git(cwd, &["branch", "--show-current"]).await?.stdout.trim().to_string();
        if branch.is_empty() {
            return Err("Cannot set upstream while HEAD is detached.".to_string());
        }
        run_git_owned(cwd, vec!["push".to_string(), "-u".to_string(), "origin".to_string(), branch]).await
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
                    Some("Codex CLI is installed but `codex login status` did not report an active login.".to_string())
                },
            }
        }
        None => CodexCheckResult {
            installed: false,
            version: String::new(),
            path: String::new(),
            logged_in: false,
            error: Some("No working Codex CLI was found. Install or repair Codex first.".to_string()),
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
    std::env::var("HOME").ok().filter(|value| !value.trim().is_empty())
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
    let cwd = cwd.trim();
    if cwd.is_empty() {
        return Err("Working directory is required for Git operations.".to_string());
    }
    let path = Path::new(cwd);
    if !path.exists() {
        return Err(format!("Working directory does not exist: {cwd}"));
    }
    if !path.is_dir() {
        return Err(format!("Working directory is not a directory: {cwd}"));
    }
    Ok(cwd)
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
    run_git_owned(cwd, vec!["check-ref-format".to_string(), "--branch".to_string(), name.to_string()]).await?;
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
    let stdout = String::from_utf8_lossy(&output.stdout).trim_end().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim_end().to_string();
    if output.status.success() {
        Ok(GitCommandResult { stdout, stderr })
    } else {
        let message = if stderr.is_empty() { stdout.clone() } else { stderr.clone() };
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
    let code = if index_status != ' ' { index_status } else { working_tree_status };
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
                current: parts.get(1).map(|value| value.trim() == "*").unwrap_or(false),
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
            raw.get("thread_id").and_then(Value::as_str).map(str::to_string),
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
            text.map(|text| event("text_delta", run_id, conversation_id, None, None, None, Some(text), None, Some(raw)))
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
            text.map(|text| event("reasoning_delta", run_id, conversation_id, None, None, None, Some(text), None, Some(raw)))
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
        "item.started" | "response.output_item.added" => parse_item_event("tool_started", &raw, run_id, conversation_id),
        "item.updated" => parse_item_update_event(&raw, run_id, conversation_id),
        "item.completed" | "response.output_item.done" => parse_item_completed_event(&raw, run_id, conversation_id),
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
            let message = first_string(&raw, &["message", "error"]).unwrap_or_else(|| "Codex turn failed.".to_string());
            Some(event("error", run_id, conversation_id, None, None, None, None, Some(message), Some(raw)))
        }
        "error" => {
            let message = first_string(&raw, &["message", "error"])
                .or_else(|| raw.get("error").and_then(|v| first_string(v, &["message", "code"])))
                .unwrap_or_else(|| "Codex reported an error.".to_string());
            Some(event("error", run_id, conversation_id, None, None, None, None, Some(message), Some(raw)))
        }
        _ => None,
    }
}

fn parse_item_update_event(raw: &Value, run_id: &str, conversation_id: &str) -> Option<CodexChatEvent> {
    let item = raw.get("item").unwrap_or(raw);
    let item_type = normalized_item_type(item);
    let item_id = first_string(item, &["id", "item_id", "itemId"]);
    let text = first_string(raw, &["delta", "output_delta", "outputDelta", "text", "content"])
        .or_else(|| first_string(item, &["delta", "output_delta", "outputDelta", "text", "content"]))
        .or_else(|| {
            let extracted = extract_text_content(item);
            if extracted.is_empty() {
                None
            } else {
                Some(extracted)
            }
        });

    if matches!(item_type.as_str(), "agentmessage" | "assistantmessage" | "message") {
        return text.map(|text| event("text_delta", run_id, conversation_id, None, item_id, None, Some(text), None, Some(raw.clone())));
    }

    if matches!(item_type.as_str(), "reasoning" | "thought" | "analysis") {
        return text.map(|text| event("reasoning_delta", run_id, conversation_id, None, item_id, None, Some(text), None, Some(raw.clone())));
    }

    if is_tool_item(&item_type) || item_type.is_empty() {
        return text.map(|text| event("tool_delta", run_id, conversation_id, None, item_id, item_title(item), Some(text), None, Some(raw.clone())));
    }

    None
}

fn parse_command_event(kind: &str, raw: &Value, run_id: &str, conversation_id: &str) -> Option<CodexChatEvent> {
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

fn parse_command_end_event(raw: &Value, run_id: &str, conversation_id: &str) -> Option<CodexChatEvent> {
    let item_id = first_string(raw, &["id", "item_id", "itemId", "call_id"])
        .or_else(|| Some("exec".to_string()));
    let status = first_string(raw, &["status", "outcome"]).unwrap_or_default().to_lowercase();
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
        if failed { "tool_failed" } else { "tool_completed" },
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

fn parse_item_completed_event(raw: &Value, run_id: &str, conversation_id: &str) -> Option<CodexChatEvent> {
    let item = raw.get("item").unwrap_or(raw);
    let item_type = normalized_item_type(item);
    let item_id = first_string(item, &["id", "item_id", "itemId"]);

    if matches!(item_type.as_str(), "agentmessage" | "assistantmessage" | "message") {
        let text = extract_text_content(item);
        if text.is_empty() {
            return None;
        }
        return Some(event("text_delta", run_id, conversation_id, None, item_id, None, Some(text), None, Some(raw.clone())));
    }

    if matches!(item_type.as_str(), "reasoning" | "thought" | "analysis") {
        let text = extract_text_content(item);
        if text.is_empty() {
            return None;
        }
        return Some(event("reasoning_delta", run_id, conversation_id, None, item_id, None, Some(text), None, Some(raw.clone())));
    }

    if is_tool_item(&item_type) {
        let status = first_string(item, &["status", "outcome"]).unwrap_or_default().to_lowercase();
        let failed = status.contains("fail") || status.contains("error") || item.get("error").is_some();
        let output = extract_tool_output(item)
            // Fall back to the query/args so web/file search still shows what was searched.
            .or_else(|| extract_tool_input(item))
            .or_else(|| first_string(item, &["error", "message"]))
            .or_else(|| item.get("error").map(|value| value.to_string()));
        return Some(event(
            if failed { "tool_failed" } else { "tool_completed" },
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

fn parse_item_event(kind: &str, raw: &Value, run_id: &str, conversation_id: &str) -> Option<CodexChatEvent> {
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
    first_string(item, &["command", "query", "path", "input", "arguments", "args"])
        // Web search items (web_search_call) carry the query under `action`.
        .or_else(|| item.get("action").and_then(|action| first_string(action, &["query", "url", "command"])))
        .or_else(|| {
            item.get("input")
                .or_else(|| item.get("arguments"))
                .or_else(|| item.get("args"))
                .map(|value| value.to_string())
        })
}

fn extract_tool_output(item: &Value) -> Option<String> {
    first_string(item, &["output", "aggregatedOutput", "result", "stdout", "stderr", "diff"])
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
        return items.iter().map(extract_text_content).collect::<Vec<_>>().join("");
    }
    if let Some(summary) = value.get("summary").and_then(Value::as_array) {
        return summary.iter().map(extract_text_content).collect::<Vec<_>>().join("");
    }
    String::new()
}

fn first_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        let Some(candidate) = value.get(*key) else {
            continue;
        };
        if let Some(text) = candidate.as_str().map(str::trim).filter(|text| !text.is_empty()) {
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
        if let Some(text) = candidate.as_str().map(str::trim).filter(|text| !text.is_empty()) {
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
            codex_chat_start,
            codex_chat_stop,
            list_open_apps,
            open_in_app,
            terminal_start,
            terminal_write,
            terminal_resize,
            terminal_stop,
            git_diff_stat,
            gh_auth_status,
            git_status,
            git_diff,
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
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Alpha Studio");
                #[cfg(target_os = "macos")]
                {
                    use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};
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
        .expect("error while running Alpha Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let event = parse_codex_json_event(
            r#"{"type":"error","message":"bad"}"#,
            "run-1",
            "conv-1",
        )
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
        assert_eq!(remotes[0].fetch_url.as_deref(), Some("https://example.com/repo.git"));
        assert_eq!(remotes[0].push_url.as_deref(), Some("git@example.com:repo.git"));
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
