use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

const CODEX_CHAT_EVENT: &str = "codex-chat-event";
const DEFAULT_CWD: &str = "/Users/geb/codes/alpha_studio";

static RUN_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Default)]
struct CodexProcessState {
    children: Arc<Mutex<HashMap<String, Child>>>,
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
    let cwd = request.cwd.clone().unwrap_or_else(|| DEFAULT_CWD.to_string());
    let sandbox_mode = sanitize_sandbox_mode(request.sandbox_mode.as_deref());
    let mut command = Command::new(&check.path);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    command.current_dir(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("NO_COLOR", "1");

    if let Some(thread_id) = request.codex_thread_id.as_deref().filter(|value| !value.trim().is_empty()) {
        command.arg("exec");
        command.arg("--skip-git-repo-check");
        command.arg("--sandbox").arg(&sandbox_mode);
        command.arg("-C").arg(&cwd);
        if let Some(model) = request.model.as_deref().filter(|value| !value.trim().is_empty()) {
            command.arg("--model").arg(model.trim());
        }
        if let Some(effort) = sanitize_reasoning_effort(request.reasoning_effort.as_deref()) {
            command.arg("-c").arg(format!("model_reasoning_effort=\"{effort}\""));
        }
        command.arg("resume");
        command.arg("--json");
        command.arg(thread_id.trim());
        command.arg("-");
    } else {
        command.arg("exec");
        command.arg("--json");
        command.arg("--skip-git-repo-check");
        command.arg("--sandbox").arg(&sandbox_mode);
        command.arg("-C").arg(&cwd);
        if let Some(model) = request.model.as_deref().filter(|value| !value.trim().is_empty()) {
            command.arg("--model").arg(model.trim());
        }
        if let Some(effort) = sanitize_reasoning_effort(request.reasoning_effort.as_deref()) {
            command.arg("-c").arg(format!("model_reasoning_effort=\"{effort}\""));
        }
        command.arg("-");
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to spawn Codex CLI: {e}"))?;

    let mut stdin = child
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

    let prompt = request.prompt.clone();
    tokio::spawn(async move {
        if let Err(e) = stdin.write_all(prompt.as_bytes()).await {
            eprintln!("failed to write prompt to Codex stdin: {e}");
        }
        let _ = stdin.shutdown().await;
    });

    let app_for_stderr = app.clone();
    let stderr_run_id = run_id.clone();
    let stderr_conversation_id = request.conversation_id.clone();
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
            if !buffer.is_empty() {
                buffer.push('\n');
            }
            buffer.push_str(trimmed);
            if trimmed.to_lowercase().contains("error") {
                emit_event(
                    &app_for_stderr,
                    CodexChatEvent {
                        event_type: "tool_delta".to_string(),
                        run_id: stderr_run_id.clone(),
                        conversation_id: Some(stderr_conversation_id.clone()),
                        thread_id: None,
                        item_id: Some("stderr".to_string()),
                        title: Some("codex stderr".to_string()),
                        text: Some(trimmed.to_string()),
                        message: None,
                        raw: None,
                    },
                );
            }
        }
    });

    let app_for_stdout = app.clone();
    let state_children = state.children.clone();
    let stdout_run_id = run_id.clone();
    let stdout_conversation_id = request.conversation_id.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(event) = parse_codex_json_event(&line, &stdout_run_id, &stdout_conversation_id) {
                emit_event(&app_for_stdout, event);
            }
        }

        let status = {
            let mut children = state_children.lock().await;
            if let Some(mut child) = children.remove(&stdout_run_id) {
                child.wait().await.ok()
            } else {
                None
            }
        };

        if let Some(status) = status {
            if !status.success() {
                let stderr_text = stderr_buffer.lock().await.clone();
                emit_event(
                    &app_for_stdout,
                    CodexChatEvent {
                        event_type: "error".to_string(),
                        run_id: stdout_run_id.clone(),
                        conversation_id: Some(stdout_conversation_id.clone()),
                        thread_id: None,
                        item_id: None,
                        title: None,
                        text: None,
                        message: Some(format!(
                            "Codex exited with status {}{}",
                            status,
                            if stderr_text.is_empty() {
                                String::new()
                            } else {
                                format!(": {stderr_text}")
                            }
                        )),
                        raw: None,
                    },
                );
            }
        }

        emit_event(
            &app_for_stdout,
            CodexChatEvent {
                event_type: "completed".to_string(),
                run_id: stdout_run_id,
                conversation_id: Some(stdout_conversation_id),
                thread_id: None,
                item_id: None,
                title: None,
                text: None,
                message: None,
                raw: None,
            },
        );
    });

    Ok(CodexChatStartResult { run_id })
}

#[tauri::command]
async fn codex_chat_stop(
    app: AppHandle,
    state: State<'_, CodexProcessState>,
    request: CodexChatStopRequest,
) -> Result<CodexChatStopResult, String> {
    let mut children = state.children.lock().await;
    if let Some(child) = children.get_mut(&request.run_id) {
        let _ = child.kill().await;
        emit_event(
            &app,
            CodexChatEvent {
                event_type: "stopped".to_string(),
                run_id: request.run_id,
                conversation_id: None,
                thread_id: None,
                item_id: None,
                title: None,
                text: None,
                message: None,
                raw: None,
            },
        );
        Ok(CodexChatStopResult { stopped: true })
    } else {
        Ok(CodexChatStopResult { stopped: false })
    }
}

fn emit_event(app: &AppHandle, event: CodexChatEvent) {
    if let Err(e) = app.emit(CODEX_CHAT_EVENT, event) {
        eprintln!("failed to emit {CODEX_CHAT_EVENT}: {e}");
    }
}

fn generate_run_id() -> String {
    let count = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or_default();
    format!("codex-{millis}-{count}")
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
        "agent_message_delta" | "response.output_text.delta" | "message.delta" => {
            let text = first_string(&raw, &["delta", "text", "content"]);
            text.map(|text| event("text_delta", run_id, conversation_id, None, None, None, Some(text), None, Some(raw)))
        }
        "reasoning_delta" | "response.reasoning.delta" | "thought.delta" => {
            let text = first_string(&raw, &["delta", "text", "content"]);
            text.map(|text| event("reasoning_delta", run_id, conversation_id, None, None, None, Some(text), None, Some(raw)))
        }
        "item.started" => parse_item_event("tool_started", &raw, run_id, conversation_id),
        "item.updated" => parse_item_update_event(&raw, run_id, conversation_id),
        "item.completed" => parse_item_completed_event(&raw, run_id, conversation_id),
        "turn.completed" => Some(event(
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
    let item_id = first_string(item, &["id", "item_id", "itemId"]);
    let text = first_string(raw, &["delta", "output_delta", "outputDelta", "text", "content"])
        .or_else(|| first_string(item, &["delta", "output_delta", "outputDelta", "text", "content"]));
    text.map(|text| event("tool_delta", run_id, conversation_id, None, item_id, item_title(item), Some(text), None, Some(raw.clone())))
}

fn parse_item_completed_event(raw: &Value, run_id: &str, conversation_id: &str) -> Option<CodexChatEvent> {
    let item = raw.get("item").unwrap_or(raw);
    let item_type = item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .replace('_', "")
        .replace('-', "")
        .to_lowercase();
    let item_id = first_string(item, &["id", "item_id", "itemId"]);

    if matches!(item_type.as_str(), "agentmessage" | "assistantmessage" | "message") {
        let text = first_string(item, &["text", "content", "message"]).unwrap_or_default();
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
        return Some(event("tool_completed", run_id, conversation_id, None, item_id, item_title(item), extract_tool_output(item), None, Some(raw.clone())));
    }

    None
}

fn parse_item_event(kind: &str, raw: &Value, run_id: &str, conversation_id: &str) -> Option<CodexChatEvent> {
    let item = raw.get("item").unwrap_or(raw);
    let item_type = item
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .replace('_', "")
        .replace('-', "")
        .to_lowercase();
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
        || normalized_type.contains("filechange")
}

fn item_title(item: &Value) -> Option<String> {
    first_string(item, &["title", "name", "tool", "toolName", "type"]).map(|value| {
        match value.as_str() {
            "command_execution" | "exec" | "shell" => "execute".to_string(),
            other => other.to_string(),
        }
    })
}

fn extract_tool_input(item: &Value) -> Option<String> {
    first_string(item, &["command", "query", "path", "name"]).or_else(|| {
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
        .manage(CodexProcessState::default())
        .invoke_handler(tauri::generate_handler![
            codex_check,
            codex_chat_start,
            codex_chat_stop,
        ])
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Alpha Studio");
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
    fn ignores_unknown_and_non_json_lines() {
        assert!(parse_codex_json_event("WARN noisy line", "run-1", "conv-1").is_none());
        assert!(parse_codex_json_event(r#"{"type":"turn.started"}"#, "run-1", "conv-1").is_none());
    }
}
