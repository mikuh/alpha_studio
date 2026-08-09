use base64::Engine as _;
use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::io::{Read, Write};
use std::path::Path;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{
    AsyncBufRead, AsyncBufReadExt, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader,
};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::{oneshot, Mutex};

mod builtin_skills;
mod jqdata_http;
mod keychain;
mod local_store;
mod managed_skills;
mod skill_codec;

const CODEX_CHAT_EVENT: &str = "codex-chat-event";
const TERMINAL_EVENT: &str = "terminal-event";
const BROWSER_WEBVIEW_EVENT: &str = "browser-webview-event";
const CODEX_DEVICE_AUTHORIZATION_MARKER: &str = ".alpha-studio-device-authorized";
#[cfg(target_os = "windows")]
const CODEX_EXECUTABLE_NAME: &str = "codex.exe";
#[cfg(not(target_os = "windows"))]
const CODEX_EXECUTABLE_NAME: &str = "codex";
const FALLBACK_REASONING_CONTENT: &str =
    "Reasoning content was not available in the persisted transcript.";

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
    account_email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginResult {
    codex_home: String,
}

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

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CodexChatRequest {
    conversation_id: String,
    prompt: String,
    developer_instructions: Option<String>,
    selected_skill: Option<CodexSelectedSkill>,
    attachments: Option<Vec<CodexChatAttachment>>,
    codex_thread_id: Option<String>,
    cwd: Option<String>,
    model: Option<String>,
    provider_id: Option<String>,
    provider_base_url: Option<String>,
    provider_api_key: Option<String>,
    provider_wire_api: Option<String>,
    provider_context_window_tokens: Option<u32>,
    provider_thinking_enabled: Option<bool>,
    reasoning_effort: Option<String>,
    service_tier: Option<String>,
    sandbox_mode: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CodexSelectedSkill {
    id: String,
    title: String,
    #[serde(rename = "description")]
    _description: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct CodexChatAttachment {
    name: String,
    kind: String,
    path: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
struct NativeSkillInput {
    name: String,
    path: String,
}

#[derive(Clone, Debug, PartialEq)]
struct ModelProviderConfig {
    id: String,
    base_url: String,
    api_key: Option<String>,
    wire_api: Option<String>,
    adapter: Option<ModelProviderAdapter>,
    show_raw_reasoning: bool,
    context_window_tokens: Option<u32>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    context_window_tokens: Option<u32>,
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

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderCreateRequest {
    name: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderRenameRequest {
    current_path: String,
    name: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFolderCreateResult {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardAttachmentSaveRequest {
    name: String,
    data: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JqDataConfigFile {
    #[serde(default = "default_jqdata_config_version")]
    version: u32,
    #[serde(default)]
    enabled: bool,
    #[serde(default)]
    username: String,
    #[serde(default)]
    #[serde(skip_serializing)]
    password: String,
    #[serde(default = "default_jqdata_api_url")]
    api_url: String,
    #[serde(default)]
    updated_at: String,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JqDataConfigLoadResult {
    version: u32,
    enabled: bool,
    username: String,
    password_configured: bool,
    api_url: String,
    updated_at: String,
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JqDataConfigSaveRequest {
    enabled: bool,
    username: String,
    password: Option<String>,
    api_url: Option<String>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JqDataConfigSaveResult {
    path: String,
}

#[derive(Clone, Serialize, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct JqDataProbeResult {
    ok: bool,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    query_count: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sample: Option<Value>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JqDataQueryRequest {
    method: String,
    #[serde(default)]
    params: Map<String, Value>,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct JqDataQueryResult {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rows: Option<Value>,
}

#[derive(Default)]
struct JqDataQueryState {
    http: jqdata_http::JqDataHttpClient,
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

// One AI coworker materialized as a Codex custom agent definition
// (CODEX_HOME/agents/<id>.toml). Mirrors src/coworkers.ts.
#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CoworkerAgentDefinition {
    id: String,
    display_name: String,
    description: String,
    instructions: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    sandbox_mode: Option<String>,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CoworkersSyncRequest {
    definitions: Vec<CoworkerAgentDefinition>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoworkersSyncResult {
    agents_dir: String,
    written: usize,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenInAppRequest {
    app: String,
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalTargetRequest {
    target: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CopyFileToClipboardRequest {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalImageDataUrlRequest {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalFileExistsRequest {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalTextFileReadRequest {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryListRequest {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LocalPdfFileReadRequest {
    path: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewCreateRequest {
    id: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewTargetRequest {
    id: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewNavigateRequest {
    id: String,
    url: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewBoundsRequest {
    id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    visible: bool,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewActionRequest {
    id: String,
    action: String,
}

#[derive(Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HtmlToPdfRequest {
    html_path: String,
    pdf_path: Option<String>,
    open_when_done: Option<bool>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalTextFileReadResult {
    path: String,
    content: String,
    bytes: u64,
    truncated: bool,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalDirectoryEntry {
    name: String,
    path: String,
    is_directory: bool,
    is_symlink: bool,
    bytes: u64,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalPdfFileReadResult {
    path: String,
    data: String,
    bytes: u64,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BrowserWebviewEvent {
    id: String,
    #[serde(rename = "type")]
    event_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    success: Option<bool>,
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HtmlToPdfResult {
    pdf_path: String,
    engine: String,
    attempts: Vec<String>,
    warnings: Vec<String>,
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
async fn codex_check(app: AppHandle) -> Result<CodexCheckResult, String> {
    Ok(check_codex(Some(&app)))
}

#[tauri::command]
async fn codex_login(app: AppHandle) -> Result<CodexLoginResult, String> {
    let (path, _) = resolve_codex_binary(Some(&app)).ok_or_else(|| {
        "No working GPT engine was found. Reinstall Alpha Studio or install/repair Codex CLI."
            .to_string()
    })?;
    let codex_home = prepare_alpha_studio_codex_home(Some(&app))?;
    mark_codex_device_authorized(&codex_home)?;
    launch_codex_login(&path, &codex_home).await?;
    Ok(CodexLoginResult {
        codex_home: codex_home.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn codex_revoke_authorization() -> Result<CodexLoginResult, String> {
    let codex_home = revoke_alpha_studio_codex_authorization()?;
    Ok(CodexLoginResult {
        codex_home: codex_home.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn codex_subscription_usage(app: AppHandle) -> Result<Value, String> {
    let check = check_codex(Some(&app));
    if !check.installed {
        return Err(check
            .error
            .unwrap_or_else(|| "GPT is not installed or cannot be executed.".to_string()));
    }
    let codex_home = prepare_alpha_studio_codex_home(Some(&app))?;
    if !codex_logged_in(&check.path, &codex_home) {
        return Err(check.error.unwrap_or_else(|| {
            "GPT is installed but Alpha Studio has not completed device authorization.".to_string()
        }));
    }

    let mut result = tokio::time::timeout(
        Duration::from_secs(30),
        read_codex_account_rate_limits(&check.path, &codex_home),
    )
    .await
    .map_err(|_| "Timed out reading GPT subscription usage.".to_string())??;

    if let Value::Object(object) = &mut result {
        object.insert("source".to_string(), json!("codex-cli"));
        object.insert(
            "generatedAt".to_string(),
            json!(chrono::Utc::now().to_rfc3339()),
        );
    }
    Ok(result)
}

#[tauri::command]
async fn codex_models(
    app: AppHandle,
    request: CodexModelsRequest,
) -> Result<Vec<CodexModelCatalogItem>, String> {
    let check = check_codex(Some(&app));
    if !check.installed {
        return Err(check
            .error
            .unwrap_or_else(|| "GPT is not installed or cannot be executed.".to_string()));
    }
    let codex_home = prepare_alpha_studio_codex_home(Some(&app))?;
    if !codex_logged_in(&check.path, &codex_home) {
        return Err(check.error.unwrap_or_else(|| {
            "GPT is installed but Alpha Studio has not completed device authorization.".to_string()
        }));
    }
    read_codex_models(&check.path, &codex_home, request.force_refetch).await
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

    let mut config = read_model_config_file(&path)?;
    let mut migrated_plaintext = false;
    for profile in &mut config.model_profiles {
        let account = keychain::model_provider_account(&profile.id);
        let legacy_secret = profile
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        profile.api_key = if let Some(secret) = legacy_secret {
            keychain::set_secret(account, secret.clone()).await?;
            migrated_plaintext = true;
            Some(secret)
        } else {
            keychain::get_secret(account).await?
        };
    }
    config.path = path.to_string_lossy().to_string();
    if migrated_plaintext {
        let mut sanitized = config.clone();
        for profile in &mut sanitized.model_profiles {
            profile.api_key = None;
        }
        write_model_config_file(&path, &sanitized)?;
    }
    Ok(config)
}

#[tauri::command]
async fn model_config_save(
    request: ModelConfigSaveRequest,
) -> Result<ModelConfigSaveResult, String> {
    let path = model_config_path()?;
    let existing_ids = read_model_config_file(&path)
        .map(|config| {
            config
                .model_profiles
                .into_iter()
                .map(|profile| profile.id)
                .collect::<HashSet<_>>()
        })
        .unwrap_or_default();
    let retained_ids = request
        .model_profiles
        .iter()
        .map(|profile| profile.id.clone())
        .collect::<HashSet<_>>();
    for removed_id in existing_ids.difference(&retained_ids) {
        keychain::delete_secret(keychain::model_provider_account(removed_id)).await?;
    }
    for profile in &request.model_profiles {
        if let Some(secret) = profile
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            keychain::set_secret(keychain::model_provider_account(&profile.id), secret).await?;
        }
    }
    let mut config = ModelConfigLoadResult {
        version: 1,
        selected_model_profile_id: request.selected_model_profile_id,
        model_profiles: request.model_profiles,
        path: path.to_string_lossy().to_string(),
    };
    for profile in &mut config.model_profiles {
        profile.api_key = None;
    }
    write_model_config_file(&path, &config)?;
    Ok(ModelConfigSaveResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn project_folder_create(
    request: ProjectFolderCreateRequest,
) -> Result<ProjectFolderCreateResult, String> {
    let root = project_folder_root()?;
    let path = create_unique_project_folder(&root, &request.name)?;
    Ok(ProjectFolderCreateResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn project_folder_rename(
    request: ProjectFolderRenameRequest,
) -> Result<ProjectFolderCreateResult, String> {
    let root = project_folder_root()?;
    let path = rename_project_folder(&root, &request.current_path, &request.name)?;
    Ok(ProjectFolderCreateResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn clipboard_attachment_save(request: ClipboardAttachmentSaveRequest) -> Result<String, String> {
    let home = home_dir().ok_or_else(|| "Cannot resolve home directory.".to_string())?;
    let root = Path::new(&home)
        .join(".alpha-studio")
        .join("attachments")
        .join("clipboard");
    save_clipboard_attachment(&root, &request.name, &request.data)
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn jqdata_config_load() -> Result<JqDataConfigLoadResult, String> {
    let path = jqdata_config_path()?;
    if !path.exists() {
        return Ok(jqdata_config_load_result(JqDataConfigFile::default(), path));
    }

    let config = read_jqdata_config_secure(&path).await?;
    Ok(jqdata_config_load_result(config, path))
}

#[tauri::command]
async fn jqdata_config_save(
    state: State<'_, JqDataQueryState>,
    request: JqDataConfigSaveRequest,
) -> Result<JqDataConfigSaveResult, String> {
    let path = jqdata_config_path()?;
    let existing = if path.exists() {
        read_jqdata_config_secure(&path).await?
    } else {
        JqDataConfigFile::default()
    };
    let password = request
        .password
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or(existing.password);
    if !password.trim().is_empty() {
        keychain::set_secret(keychain::JQDATA_PASSWORD_ACCOUNT, password.clone()).await?;
    }
    let api_url = request
        .api_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            let existing_url = existing.api_url.trim();
            if existing_url.is_empty() {
                None
            } else {
                Some(existing_url.to_string())
            }
        })
        .unwrap_or_else(default_jqdata_api_url);
    let config = JqDataConfigFile {
        version: 1,
        enabled: request.enabled,
        username: request.username.trim().to_string(),
        password,
        api_url,
        updated_at: unix_millis_string(),
    };
    write_jqdata_config_file(&path, &config)?;
    state.http.clear_token().await;
    Ok(JqDataConfigSaveResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn jqdata_test_connection(
    state: State<'_, JqDataQueryState>,
) -> Result<JqDataProbeResult, String> {
    let path = jqdata_config_path()?;
    let config = read_jqdata_config_secure(&path).await?;
    if !config.enabled {
        return Ok(JqDataProbeResult {
            ok: false,
            message: "JQData 数据源尚未启用。".to_string(),
            query_count: None,
            sample: None,
        });
    }
    if config.username.trim().is_empty() || config.password.trim().is_empty() {
        return Ok(JqDataProbeResult {
            ok: false,
            message: "请先配置聚宽账号和密码。".to_string(),
            query_count: None,
            sample: None,
        });
    }

    run_jqdata_probe(config, &state).await
}

#[tauri::command]
async fn jqdata_query(
    state: State<'_, JqDataQueryState>,
    request: JqDataQueryRequest,
) -> Result<JqDataQueryResult, String> {
    let path = jqdata_config_path()?;
    let config: JqDataConfigFile = read_jqdata_config_secure(&path).await.unwrap_or_default();
    if !config.enabled || config.username.trim().is_empty() || config.password.trim().is_empty() {
        return Ok(JqDataQueryResult {
            ok: false,
            message: Some("JQData 数据源尚未配置或未启用。".to_string()),
            rows: None,
        });
    }
    run_jqdata_http_query(&config, &request, &state).await
}

#[tauri::command]
async fn codex_chat_start(
    app: AppHandle,
    state: State<'_, CodexProcessState>,
    request: CodexChatRequest,
) -> Result<CodexChatStartResult, String> {
    let mut provider_config = sanitize_model_provider(&request)?;
    let check = check_codex(Some(&app));
    if !check.installed {
        return Err(check
            .error
            .unwrap_or_else(|| "GPT is not installed or cannot be executed.".to_string()));
    }
    if !check.logged_in && provider_config.is_none() {
        return Err(check.error.unwrap_or_else(|| {
            "GPT is installed but Alpha Studio has not completed device authorization.".to_string()
        }));
    }

    let run_id = generate_run_id();
    let cwd = resolve_cwd(request.cwd.as_deref())?;
    let codex_home = prepare_alpha_studio_codex_home(Some(&app))?;
    let runtime_skills_root = codex_home.join("skills").to_string_lossy().into_owned();
    let sandbox_mode = sanitize_sandbox_mode(request.sandbox_mode.as_deref());
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
    let service_tier = sanitize_service_tier(request.service_tier.as_deref());
    for arg in codex_app_server_args(provider_config.as_ref(), service_tier.as_deref()) {
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
    command.env("CODEX_HOME", &codex_home);
    command.kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start GPT service: {e}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open GPT input".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open GPT output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open GPT error output".to_string())?;

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
        runtime_skills_root,
        sandbox_mode,
        model: request
            .model
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        developer_instructions: request
            .developer_instructions
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        selected_skill: request.selected_skill.clone(),
        attachments: request.attachments.clone().unwrap_or_default(),
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
    runtime_skills_root: String,
    sandbox_mode: String,
    model: Option<String>,
    developer_instructions: Option<String>,
    selected_skill: Option<CodexSelectedSkill>,
    attachments: Vec<CodexChatAttachment>,
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

    async fn resolve_selected_skill<W, R>(
        &self,
        stdin: &mut W,
        reader: &mut tokio::io::Lines<R>,
    ) -> Result<Option<NativeSkillInput>, String>
    where
        W: AsyncWrite + Unpin,
        R: AsyncBufRead + Unpin,
    {
        let Some(selection) = self.selected_skill.as_ref() else {
            return Ok(None);
        };
        send_jsonrpc(
            stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 20,
                "method": "skills/list",
                "params": {
                    "cwds": [self.cwd.clone()],
                    "forceReload": false,
                },
            }),
        )
        .await?;
        let response = await_response(stdin, reader, 20).await?;
        Ok(response
            .get("result")
            .and_then(|result| find_native_skill_input(result, selection)))
    }

    async fn register_skill_roots<W, R>(
        &self,
        stdin: &mut W,
        reader: &mut tokio::io::Lines<R>,
    ) -> Result<(), String>
    where
        W: AsyncWrite + Unpin,
        R: AsyncBufRead + Unpin,
    {
        let extra_roots = runtime_skill_extra_roots(&self.cwd, &self.runtime_skills_root);
        if extra_roots.is_empty() {
            return Err("No runtime Skill root is available for registration".to_string());
        }
        send_jsonrpc(
            stdin,
            &json!({
                "jsonrpc": "2.0",
                "id": 19,
                "method": "skills/extraRoots/set",
                "params": {
                    "extraRoots": extra_roots,
                },
            }),
        )
        .await?;
        await_response(stdin, reader, 19).await?;
        Ok(())
    }

    async fn drive(
        &self,
        stdin: &mut tokio::process::ChildStdin,
        reader: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    ) -> Result<(), String> {
        // 1. Handshake.
        initialize_codex_app_server(stdin, reader).await?;
        self.register_skill_roots(stdin, reader).await?;
        let native_skill: Option<NativeSkillInput> = self
            .resolve_selected_skill(stdin, reader)
            .await
            .unwrap_or_default();

        // 2. Start a fresh thread, or resume the conversation's existing one.
        let mut thread_params = Map::new();
        thread_params.insert("cwd".to_string(), json!(self.cwd));
        thread_params.insert("sandbox".to_string(), json!(self.sandbox_mode));
        thread_params.insert("approvalPolicy".to_string(), json!("never"));
        if let Some(model) = &self.model {
            thread_params.insert("model".to_string(), json!(model));
        }
        if let Some(instructions) = &self.developer_instructions {
            thread_params.insert("developerInstructions".to_string(), json!(instructions));
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
        let thread_response = await_response(stdin, reader, 2).await?;
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
            .ok_or_else(|| "GPT service did not return a thread id".to_string())?;

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
            Value::Array(build_turn_input(
                &self.prompt,
                &self.attachments,
                native_skill.as_ref(),
            )),
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
                Ok(None) => return Err("GPT service closed during the turn".to_string()),
                Err(e) => return Err(format!("Failed to read from GPT service: {e}")),
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
                    let _ = answer_app_server_request(stdin, request_id, method).await;
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
                if method == "error" && !is_retryable_app_server_error(params) {
                    return Ok(());
                }
            } else if message.get("id").is_some() {
                if let Some(error) = message.get("error") {
                    return Err(jsonrpc_error_message(error));
                }
            }
        }
    }
}

fn build_turn_input(
    prompt: &str,
    attachments: &[CodexChatAttachment],
    native_skill: Option<&NativeSkillInput>,
) -> Vec<Value> {
    let mut input = Vec::new();
    if let Some(skill) = native_skill {
        input.push(json!({
            "type": "skill",
            "name": &skill.name,
            "path": &skill.path,
        }));
    }
    if !prompt.trim().is_empty() {
        input.push(json!({
            "type": "text",
            "text": prompt,
            "text_elements": [],
        }));
    }
    for attachment in attachments {
        if let Some(item) = native_attachment_input(attachment) {
            input.push(item);
        }
    }
    if input.is_empty() {
        input.push(json!({
            "type": "text",
            "text": prompt,
            "text_elements": [],
        }));
    }
    input
}

fn native_attachment_input(attachment: &CodexChatAttachment) -> Option<Value> {
    let path = attachment
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    if attachment.kind.trim().eq_ignore_ascii_case("image") {
        return Some(json!({
            "type": "localImage",
            "path": path,
        }));
    }
    let name = attachment.name.trim();
    Some(json!({
        "type": "mention",
        "name": if name.is_empty() { path } else { name },
        "path": path,
    }))
}

fn runtime_skill_extra_roots(cwd: &str, runtime_skills_root: &str) -> Vec<String> {
    let mut roots = Vec::new();
    let runtime_root = Path::new(runtime_skills_root);
    if runtime_root.is_dir() {
        roots.push(runtime_root.to_string_lossy().into_owned());
    }
    let workspace_root = Path::new(cwd).join("skills");
    if workspace_root.is_dir()
        && fs::canonicalize(&workspace_root).ok() != fs::canonicalize(runtime_root).ok()
    {
        roots.push(workspace_root.to_string_lossy().into_owned());
    }
    roots
}

fn find_native_skill_input(
    result: &Value,
    selection: &CodexSelectedSkill,
) -> Option<NativeSkillInput> {
    let mut best: Option<(i32, NativeSkillInput)> = None;
    for entry in result.get("data").and_then(Value::as_array)? {
        let Some(skills) = entry.get("skills").and_then(Value::as_array) else {
            continue;
        };
        for skill in skills {
            if skill.get("enabled").and_then(Value::as_bool) == Some(false) {
                continue;
            }
            let Some(name) = skill.get("name").and_then(Value::as_str) else {
                continue;
            };
            let Some(path) = skill.get("path").and_then(Value::as_str) else {
                continue;
            };
            let score = native_skill_match_score(selection, name, path);
            if score <= 0 {
                continue;
            }
            let candidate = NativeSkillInput {
                name: name.to_string(),
                path: path.to_string(),
            };
            match best {
                Some((best_score, _)) if best_score >= score => {}
                _ => best = Some((score, candidate)),
            }
        }
    }
    best.map(|(_, skill)| skill)
}

fn native_skill_match_score(selection: &CodexSelectedSkill, name: &str, path: &str) -> i32 {
    let id = selection.id.trim();
    if id.is_empty() {
        return 0;
    }
    let title = selection.title.trim();
    let id_lower = id.to_ascii_lowercase();
    let name_lower = name.to_ascii_lowercase();
    let path_lower = path.replace('\\', "/").to_ascii_lowercase();
    let title_key = normalized_skill_key(title);
    let id_key = normalized_skill_key(id);
    let name_key = normalized_skill_key(name);
    let first_name_part = name_lower.split(':').next().unwrap_or_default();
    let last_name_part = name_lower.rsplit(':').next().unwrap_or_default();

    if name_lower == id_lower {
        return 100;
    }
    if name_key == id_key {
        return 95;
    }
    if name_lower.starts_with(&format!("{id_lower}:")) {
        return 90;
    }
    if path_lower.ends_with(&format!("/{id_lower}/skill.md")) {
        return 85;
    }
    if first_name_part == id_lower || last_name_part == id_lower {
        return 80;
    }
    if !title_key.is_empty() && title_key == name_key {
        return 70;
    }
    if !title_key.is_empty() && name_key.starts_with(&title_key) {
        return 60;
    }
    0
}

fn normalized_skill_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .map(|ch| ch.to_ascii_lowercase())
        .collect()
}

fn normalize_codex_model_page(
    response: &Value,
    seen_ids: &mut HashSet<String>,
    catalog: &mut Vec<CodexModelCatalogItem>,
) -> Result<Option<String>, String> {
    let result = response
        .get("result")
        .and_then(Value::as_object)
        .ok_or_else(|| "GPT service returned malformed model list data.".to_string())?;
    let data = result
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "GPT service returned malformed model list data.".to_string())?;

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
        Some(_) => Err("GPT service returned an invalid model pagination cursor.".to_string()),
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
            return Err("GPT service returned a repeated model pagination cursor.".to_string());
        }
        request_id += 1;
    }

    if catalog.is_empty() {
        return Err("GPT service returned no visible valid models.".to_string());
    }
    Ok(catalog)
}

async fn send_jsonrpc<W>(stdin: &mut W, message: &Value) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    let mut bytes =
        serde_json::to_vec(message).map_err(|e| format!("Failed to encode request: {e}"))?;
    bytes.push(b'\n');
    stdin
        .write_all(&bytes)
        .await
        .map_err(|e| format!("Failed to write to GPT service: {e}"))?;
    stdin
        .flush()
        .await
        .map_err(|e| format!("Failed to flush GPT service: {e}"))?;
    Ok(())
}

async fn await_response<W, R>(
    stdin: &mut W,
    reader: &mut tokio::io::Lines<R>,
    id: i64,
) -> Result<Value, String>
where
    W: AsyncWrite + Unpin,
    R: AsyncBufRead + Unpin,
{
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
                if let Some(method) = message.get("method").and_then(Value::as_str) {
                    if let Some(request_id) =
                        message.get("id").filter(|request_id| !request_id.is_null())
                    {
                        answer_app_server_request(stdin, request_id, method).await?;
                        continue;
                    }
                }
                if message.get("id").and_then(Value::as_i64) == Some(id) {
                    if let Some(error) = message.get("error") {
                        return Err(jsonrpc_error_message(error));
                    }
                    return Ok(message);
                }
            }
            Ok(None) => return Err("GPT service closed before responding".to_string()),
            Err(e) => return Err(format!("Failed to read from GPT service: {e}")),
        }
    }
}

async fn answer_app_server_request<W>(
    stdin: &mut W,
    request_id: &Value,
    method: &str,
) -> Result<(), String>
where
    W: AsyncWrite + Unpin,
{
    send_jsonrpc(
        stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": request_id.clone(),
            "result": app_server_request_result(method),
        }),
    )
    .await
}

fn app_server_request_result(method: &str) -> Value {
    let lowered = method.to_ascii_lowercase();
    if lowered.contains("approv") || lowered.contains("permission") || lowered.contains("elicit") {
        json!({ "decision": "approved", "approved": true, "allow": true })
    } else {
        json!({})
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
            streamed.insert("message:*".to_string());
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
            streamed.insert("reasoning:*".to_string());
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
            if is_context_compaction_item(&item_type) {
                return vec![event(
                    "tool_started",
                    run_id,
                    conversation_id,
                    params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    first_string(item, &["id", "item_id", "itemId"]),
                    Some("context_compaction".to_string()),
                    None,
                    None,
                    Some(params.clone()),
                )];
            }
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

            if is_context_compaction_item(&item_type) {
                return vec![event(
                    "context_compacted",
                    run_id,
                    conversation_id,
                    params
                        .get("threadId")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                    item_id,
                    Some("context_compaction".to_string()),
                    None,
                    None,
                    Some(params.clone()),
                )];
            }

            if matches!(
                item_type.as_str(),
                "agentmessage" | "assistantmessage" | "message"
            ) {
                let already = streamed.contains("message:*")
                    || item_id
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
                let already = streamed.contains("reasoning:*")
                    || item_id
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
        "thread/tokenUsage/updated" => vec![event(
            "token_usage",
            run_id,
            conversation_id,
            params
                .get("threadId")
                .and_then(Value::as_str)
                .map(str::to_string),
            None,
            None,
            None,
            None,
            Some(params.clone()),
        )],
        "thread/compacted" => vec![event(
            "context_compacted",
            run_id,
            conversation_id,
            params
                .get("threadId")
                .and_then(Value::as_str)
                .map(str::to_string),
            None,
            None,
            None,
            None,
            Some(params.clone()),
        )],
        "error" => {
            let error = params.get("error").unwrap_or(params);
            let message = first_string(error, &["message", "error"])
                .or_else(|| first_string(params, &["message"]))
                .unwrap_or_else(|| "GPT reported an error.".to_string());
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
        available.push("preview".to_string());
        available.push("terminal".to_string());
        let candidates: &[(&str, &[&str])] = &[
            ("vscode", &["Visual Studio Code.app", "VSCode.app"]),
            ("cursor", &["Cursor.app"]),
            ("xcode", &["Xcode.app"]),
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
    let path = validate_open_path(&request.path)?;
    #[cfg(target_os = "macos")]
    {
        let terminal_path = terminal_open_target(path);
        let args: Vec<String> = match request.app.as_str() {
            "finder" => vec!["-R".to_string(), path.to_string()],
            "preview" => vec!["-a".to_string(), "Preview".to_string(), path.to_string()],
            "terminal" => vec![
                "-a".to_string(),
                "Terminal".to_string(),
                terminal_path.to_string_lossy().to_string(),
            ],
            "vscode" => vec![
                "-a".to_string(),
                "Visual Studio Code".to_string(),
                path.to_string(),
            ],
            "cursor" => vec!["-a".to_string(), "Cursor".to_string(), path.to_string()],
            "pycharm" => vec!["-a".to_string(), "PyCharm".to_string(), path.to_string()],
            "xcode" => vec!["-a".to_string(), "Xcode".to_string(), path.to_string()],
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
async fn copy_file_to_clipboard(request: CopyFileToClipboardRequest) -> Result<(), String> {
    let path = validate_open_path(&request.path)?;
    #[cfg(target_os = "macos")]
    {
        let script = r#"on run argv
set the clipboard to (POSIX file (item 1 of argv))
end run"#;
        let output = Command::new("osascript")
            .args(["-e", script, "--", path])
            .output()
            .await
            .map_err(|e| format!("Failed to copy file to clipboard: {e}"))?;
        if output.status.success() {
            return Ok(());
        }
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            "Failed to copy file to clipboard.".to_string()
        } else {
            stderr
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Copying files to the clipboard is only supported on macOS in this build.".to_string())
    }
}

#[tauri::command]
async fn open_external_target(request: OpenExternalTargetRequest) -> Result<(), String> {
    let target = validate_external_target(&request.target)?;
    open_target_with_system(&target).await
}

#[tauri::command]
async fn reveal_local_path(request: LocalFileExistsRequest) -> Result<(), String> {
    let path = validate_open_path(&request.path)?;
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .args(["-R", path])
            .output()
            .await
            .map_err(|error| format!("Failed to reveal local path: {error}"))?;
        if output.status.success() {
            return Ok(());
        }
        Err(command_failure_summary(&output.stdout, &output.stderr))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Err("Revealing local paths is only supported on macOS in this build.".to_string())
    }
}

#[tauri::command]
async fn local_image_data_url(request: LocalImageDataUrlRequest) -> Result<String, String> {
    let path = request.path.trim();
    if path.is_empty() {
        return Err("Image path is required.".to_string());
    }

    let path_ref = Path::new(path);
    let metadata =
        fs::metadata(path_ref).map_err(|e| format!("Failed to read image metadata: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {path}"));
    }
    const MAX_IMAGE_BYTES: u64 = 25 * 1024 * 1024;
    if metadata.len() > MAX_IMAGE_BYTES {
        return Err("Image is too large to preview.".to_string());
    }

    let ext = path_ref
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        _ => return Err("Unsupported image type.".to_string()),
    };

    let bytes = fs::read(path_ref).map_err(|e| format!("Failed to read image: {e}"))?;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Ok(format!("data:{mime};base64,{encoded}"))
}

#[tauri::command]
fn local_file_exists(request: LocalFileExistsRequest) -> bool {
    let path = request.path.trim();
    !path.is_empty()
        && fs::metadata(path)
            .map(|metadata| metadata.is_file())
            .unwrap_or(false)
}

#[tauri::command]
async fn local_text_file_read(
    request: LocalTextFileReadRequest,
) -> Result<LocalTextFileReadResult, String> {
    let path = request.path.trim();
    if path.is_empty() {
        return Err("File path is required.".to_string());
    }

    let path_ref = Path::new(path);
    let metadata =
        fs::metadata(path_ref).map_err(|e| format!("Failed to read file metadata: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {path}"));
    }

    const MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;
    let mut file = fs::File::open(path_ref).map_err(|e| format!("Failed to read file: {e}"))?;
    let mut bytes = Vec::new();
    std::io::Read::by_ref(&mut file)
        .take(MAX_TEXT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read file: {e}"))?;
    let truncated =
        bytes.len() as u64 > MAX_TEXT_FILE_BYTES || metadata.len() > MAX_TEXT_FILE_BYTES;
    if bytes.len() as u64 > MAX_TEXT_FILE_BYTES {
        bytes.truncate(MAX_TEXT_FILE_BYTES as usize);
    }

    Ok(LocalTextFileReadResult {
        path: path_ref.to_string_lossy().to_string(),
        content: String::from_utf8_lossy(&bytes).to_string(),
        bytes: metadata.len(),
        truncated,
    })
}

fn list_local_directory_entries(path: &Path) -> Result<Vec<LocalDirectoryEntry>, String> {
    let metadata =
        fs::metadata(path).map_err(|e| format!("Failed to read directory metadata: {e}"))?;
    if !metadata.is_dir() {
        return Err(format!("Path is not a directory: {}", path.display()));
    }

    let mut entries = fs::read_dir(path)
        .map_err(|e| format!("Failed to read directory: {e}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            let entry_metadata = entry.metadata().ok();
            Some(LocalDirectoryEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                path: entry.path().to_string_lossy().into_owned(),
                is_directory: file_type.is_dir(),
                is_symlink: file_type.is_symlink(),
                bytes: entry_metadata
                    .filter(|value| value.is_file())
                    .map(|value| value.len())
                    .unwrap_or(0),
            })
        })
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(entries)
}

#[tauri::command]
fn local_directory_list(
    request: LocalDirectoryListRequest,
) -> Result<Vec<LocalDirectoryEntry>, String> {
    let path = request.path.trim();
    if path.is_empty() {
        return Err("Directory path is required.".to_string());
    }
    list_local_directory_entries(Path::new(path))
}

#[tauri::command]
async fn local_pdf_file_read(
    request: LocalPdfFileReadRequest,
) -> Result<LocalPdfFileReadResult, String> {
    let path = request.path.trim();
    if path.is_empty() {
        return Err("PDF path is required.".to_string());
    }

    let path_ref = Path::new(path);
    let metadata =
        fs::metadata(path_ref).map_err(|e| format!("Failed to read PDF metadata: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {path}"));
    }
    if path_ref
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| !value.eq_ignore_ascii_case("pdf"))
        .unwrap_or(true)
    {
        return Err("Only PDF files can be opened by the PDF reader.".to_string());
    }

    const MAX_PDF_BYTES: u64 = 80 * 1024 * 1024;
    if metadata.len() > MAX_PDF_BYTES {
        return Err("PDF is larger than the 80 MB in-app preview limit.".to_string());
    }

    let bytes = fs::read(path_ref).map_err(|e| format!("Failed to read PDF: {e}"))?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("The selected file does not have a valid PDF header.".to_string());
    }

    Ok(LocalPdfFileReadResult {
        path: path_ref.to_string_lossy().to_string(),
        data: base64::engine::general_purpose::STANDARD.encode(bytes),
        bytes: metadata.len(),
    })
}

fn browser_webview_label(id: &str) -> Result<String, String> {
    let id = id.trim();
    if id.is_empty()
        || id.len() > 96
        || !id
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || value == '-' || value == '_')
    {
        return Err("Invalid browser webview id.".to_string());
    }
    Ok(format!("browser-{id}"))
}

fn browser_webview_url(value: &str) -> Result<tauri::Url, String> {
    let url = value
        .trim()
        .parse::<tauri::Url>()
        .map_err(|e| format!("Invalid browser URL: {e}"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("Native browser only supports HTTP and HTTPS URLs.".to_string());
    }
    Ok(url)
}

fn emit_browser_webview_event(app: &AppHandle, event: BrowserWebviewEvent) {
    let _ = app.emit(BROWSER_WEBVIEW_EVENT, event);
}

#[tauri::command]
fn browser_webview_create(
    app: AppHandle,
    request: BrowserWebviewCreateRequest,
) -> Result<(), String> {
    let label = browser_webview_label(&request.id)?;
    let url = browser_webview_url(&request.url)?;
    let width = request.width.max(1.0);
    let height = request.height.max(1.0);

    if let Some(webview) = app.get_webview(&label) {
        webview
            .set_position(tauri::LogicalPosition::new(request.x, request.y))
            .map_err(|e| format!("Failed to position browser: {e}"))?;
        webview
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| format!("Failed to size browser: {e}"))?;
        if request.visible {
            webview
                .show()
                .map_err(|e| format!("Failed to show browser: {e}"))?;
        } else {
            webview
                .hide()
                .map_err(|e| format!("Failed to hide browser: {e}"))?;
        }
        return Ok(());
    }

    let window = app
        .get_window("main")
        .ok_or_else(|| "Main window is unavailable.".to_string())?;

    let page_app = app.clone();
    let page_id = request.id.clone();
    let title_app = app.clone();
    let title_id = request.id.clone();
    let download_app = app.clone();
    let download_id = request.id.clone();
    let popup_app = app.clone();
    let popup_id = request.id.clone();

    let builder = tauri::WebviewBuilder::new(label, tauri::WebviewUrl::External(url))
        .on_page_load(move |_webview, payload| {
            let event_type = match payload.event() {
                tauri::webview::PageLoadEvent::Started => "load-started",
                tauri::webview::PageLoadEvent::Finished => "load-finished",
            };
            emit_browser_webview_event(
                &page_app,
                BrowserWebviewEvent {
                    id: page_id.clone(),
                    event_type: event_type.to_string(),
                    url: Some(payload.url().to_string()),
                    title: None,
                    path: None,
                    success: None,
                },
            );
        })
        .on_document_title_changed(move |_webview, title| {
            emit_browser_webview_event(
                &title_app,
                BrowserWebviewEvent {
                    id: title_id.clone(),
                    event_type: "title-changed".to_string(),
                    url: None,
                    title: Some(title),
                    path: None,
                    success: None,
                },
            );
        })
        .on_download(move |_webview, event| {
            match event {
                tauri::webview::DownloadEvent::Requested { url, destination } => {
                    emit_browser_webview_event(
                        &download_app,
                        BrowserWebviewEvent {
                            id: download_id.clone(),
                            event_type: "download-started".to_string(),
                            url: Some(url.to_string()),
                            title: None,
                            path: Some(destination.to_string_lossy().to_string()),
                            success: None,
                        },
                    );
                }
                tauri::webview::DownloadEvent::Finished { url, path, success } => {
                    emit_browser_webview_event(
                        &download_app,
                        BrowserWebviewEvent {
                            id: download_id.clone(),
                            event_type: "download-finished".to_string(),
                            url: Some(url.to_string()),
                            title: None,
                            path: path.map(|value| value.to_string_lossy().to_string()),
                            success: Some(success),
                        },
                    );
                }
                _ => {}
            }
            true
        })
        .on_new_window(move |url, _features| {
            emit_browser_webview_event(
                &popup_app,
                BrowserWebviewEvent {
                    id: popup_id.clone(),
                    event_type: "new-window".to_string(),
                    url: Some(url.to_string()),
                    title: None,
                    path: None,
                    success: None,
                },
            );
            tauri::webview::NewWindowResponse::Deny
        });

    let webview = window
        .add_child(
            builder,
            tauri::LogicalPosition::new(request.x, request.y),
            tauri::LogicalSize::new(width, height),
        )
        .map_err(|e| format!("Failed to create native browser: {e}"))?;
    if !request.visible {
        webview
            .hide()
            .map_err(|e| format!("Failed to hide browser: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn browser_webview_navigate(
    app: AppHandle,
    request: BrowserWebviewNavigateRequest,
) -> Result<(), String> {
    let label = browser_webview_label(&request.id)?;
    let url = browser_webview_url(&request.url)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Browser webview is unavailable.".to_string())?;
    webview
        .navigate(url)
        .map_err(|e| format!("Failed to navigate browser: {e}"))
}

#[tauri::command]
fn browser_webview_set_bounds(
    app: AppHandle,
    request: BrowserWebviewBoundsRequest,
) -> Result<(), String> {
    let label = browser_webview_label(&request.id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Browser webview is unavailable.".to_string())?;
    webview
        .set_position(tauri::LogicalPosition::new(request.x, request.y))
        .map_err(|e| format!("Failed to position browser: {e}"))?;
    webview
        .set_size(tauri::LogicalSize::new(
            request.width.max(1.0),
            request.height.max(1.0),
        ))
        .map_err(|e| format!("Failed to size browser: {e}"))?;
    if request.visible {
        webview
            .show()
            .map_err(|e| format!("Failed to show browser: {e}"))?;
    } else {
        webview
            .hide()
            .map_err(|e| format!("Failed to hide browser: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
fn browser_webview_action(
    app: AppHandle,
    request: BrowserWebviewActionRequest,
) -> Result<(), String> {
    let label = browser_webview_label(&request.id)?;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| "Browser webview is unavailable.".to_string())?;
    match request.action.as_str() {
        "back" => webview.eval("window.history.back()"),
        "forward" => webview.eval("window.history.forward()"),
        "reload" => webview.reload(),
        "stop" => webview.eval("window.stop()"),
        "focus" => webview.set_focus(),
        "print" => webview.print(),
        "show" => webview.show(),
        "hide" => webview.hide(),
        other => return Err(format!("Unsupported browser action: {other}")),
    }
    .map_err(|e| format!("Browser action failed: {e}"))
}

#[tauri::command]
fn browser_webview_close(
    app: AppHandle,
    request: BrowserWebviewTargetRequest,
) -> Result<(), String> {
    let label = browser_webview_label(&request.id)?;
    if let Some(webview) = app.get_webview(&label) {
        webview
            .close()
            .map_err(|e| format!("Failed to close browser: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
async fn html_to_pdf(request: HtmlToPdfRequest) -> Result<HtmlToPdfResult, String> {
    let html_input = request.html_path.trim();
    if html_input.is_empty() {
        return Err("HTML path is required.".to_string());
    }

    let html_path = PathBuf::from(html_input)
        .canonicalize()
        .map_err(|e| format!("Failed to locate HTML file: {e}"))?;
    let metadata =
        fs::metadata(&html_path).map_err(|e| format!("Failed to read HTML metadata: {e}"))?;
    if !metadata.is_file() {
        return Err(format!("Path is not a file: {}", html_path.display()));
    }
    let ext = html_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "html" && ext != "htm" {
        return Err("PDF export expects an .html or .htm file.".to_string());
    }

    let pdf_path = resolve_pdf_output_path(&html_path, request.pdf_path.as_deref())?;
    if let Some(parent) = pdf_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create PDF output directory: {e}"))?;
    }

    let mut attempts = Vec::new();
    for candidate in chrome_pdf_candidates() {
        match try_chrome_pdf(&candidate, &html_path, &pdf_path, &mut attempts).await {
            Ok(()) => {
                if request.open_when_done.unwrap_or(false) {
                    let _ = open_path_with_system(&pdf_path).await;
                }
                return Ok(HtmlToPdfResult {
                    pdf_path: pdf_path.to_string_lossy().to_string(),
                    engine: candidate.to_string_lossy().to_string(),
                    attempts,
                    warnings: Vec::new(),
                });
            }
            Err(_) => continue,
        }
    }

    for candidate in wkhtmltopdf_candidates() {
        match try_wkhtmltopdf(&candidate, &html_path, &pdf_path, &mut attempts).await {
            Ok(()) => {
                if request.open_when_done.unwrap_or(false) {
                    let _ = open_path_with_system(&pdf_path).await;
                }
                return Ok(HtmlToPdfResult {
                    pdf_path: pdf_path.to_string_lossy().to_string(),
                    engine: candidate.to_string_lossy().to_string(),
                    attempts,
                    warnings: Vec::new(),
                });
            }
            Err(_) => continue,
        }
    }

    if let Some(candidate) = find_in_path("cupsfilter") {
        if try_cupsfilter_pdf(&candidate, &html_path, &pdf_path, &mut attempts)
            .await
            .is_ok()
        {
            if request.open_when_done.unwrap_or(false) {
                let _ = open_path_with_system(&pdf_path).await;
            }
            return Ok(HtmlToPdfResult {
                pdf_path: pdf_path.to_string_lossy().to_string(),
                engine: candidate.to_string_lossy().to_string(),
                attempts,
                warnings: vec![
                    "Used the system print filter fallback; browser-based output is usually more faithful for complex CSS.".to_string(),
                ],
            });
        }
    }

    Err(format!(
        "PDF export failed. Tried: {}. Install Google Chrome, Chromium, Microsoft Edge, Brave, or wkhtmltopdf, then retry.",
        if attempts.is_empty() {
            "no supported PDF engines were found".to_string()
        } else {
            attempts.join(" | ")
        }
    ))
}

fn resolve_pdf_output_path(html_path: &Path, requested: Option<&str>) -> Result<PathBuf, String> {
    let trimmed = requested.unwrap_or("").trim();
    let path = if trimmed.is_empty() {
        html_path.with_extension("pdf")
    } else {
        let candidate = PathBuf::from(trimmed);
        if candidate.is_absolute() {
            candidate
        } else {
            html_path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join(candidate)
        }
    };
    if path == html_path {
        return Err("PDF output path must differ from the HTML input path.".to_string());
    }
    Ok(path)
}

fn chrome_pdf_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for key in ["CHROME", "CHROME_PATH", "CHROMIUM_PATH"] {
        if let Some(value) = env::var_os(key) {
            push_unique_path(&mut candidates, PathBuf::from(value));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let bundles = [
            "Google Chrome.app/Contents/MacOS/Google Chrome",
            "Chromium.app/Contents/MacOS/Chromium",
            "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "Brave Browser.app/Contents/MacOS/Brave Browser",
        ];
        for bundle in bundles {
            push_unique_path(&mut candidates, PathBuf::from("/Applications").join(bundle));
            if let Some(home) = env::var_os("HOME") {
                push_unique_path(
                    &mut candidates,
                    PathBuf::from(home).join("Applications").join(bundle),
                );
            }
        }
    }

    for command in [
        "google-chrome",
        "google-chrome-stable",
        "chrome",
        "chromium",
        "chromium-browser",
        "msedge",
        "microsoft-edge",
        "brave-browser",
        "brave",
    ] {
        if let Some(path) = find_in_path(command) {
            push_unique_path(&mut candidates, path);
        }
    }
    candidates
}

fn wkhtmltopdf_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    for path in [
        "/opt/homebrew/bin/wkhtmltopdf",
        "/usr/local/bin/wkhtmltopdf",
        "/usr/bin/wkhtmltopdf",
    ] {
        push_unique_path(&mut candidates, PathBuf::from(path));
    }
    if let Some(path) = find_in_path("wkhtmltopdf") {
        push_unique_path(&mut candidates, path);
    }
    candidates
}

fn push_unique_path(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    if !candidates.iter().any(|candidate| candidate == &path) {
        candidates.push(path);
    }
}

fn find_in_path(command: &str) -> Option<PathBuf> {
    let paths = env::var_os("PATH")?;
    for dir in env::split_paths(&paths) {
        let direct = dir.join(command);
        if executable_exists(&direct) {
            return Some(direct);
        }
        #[cfg(target_os = "windows")]
        {
            for ext in ["exe", "cmd", "bat"] {
                let candidate = dir.join(format!("{command}.{ext}"));
                if executable_exists(&candidate) {
                    return Some(candidate);
                }
            }
        }
    }
    None
}

fn executable_exists(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
}

async fn try_chrome_pdf(
    executable: &Path,
    html_path: &Path,
    pdf_path: &Path,
    attempts: &mut Vec<String>,
) -> Result<(), String> {
    if !executable_exists(executable) {
        attempts.push(format!("{}: not found", executable.display()));
        return Err("Chrome candidate not found.".to_string());
    }

    let mut last_error = String::new();
    for headless_flag in ["--headless=new", "--headless"] {
        let temp_pdf = temp_pdf_path(pdf_path);
        let profile_dir = env::temp_dir().join(format!(
            "alpha-studio-chrome-profile-{}",
            RUN_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_file(&temp_pdf);
        let _ = fs::create_dir_all(&profile_dir);
        let args = vec![
            headless_flag.to_string(),
            "--no-first-run".to_string(),
            "--no-default-browser-check".to_string(),
            "--disable-background-networking".to_string(),
            "--disable-component-update".to_string(),
            "--disable-extensions".to_string(),
            "--disable-sync".to_string(),
            "--disable-gpu".to_string(),
            "--disable-dev-shm-usage".to_string(),
            "--allow-file-access-from-files".to_string(),
            "--no-pdf-header-footer".to_string(),
            "--print-to-pdf-no-header".to_string(),
            format!("--user-data-dir={}", profile_dir.display()),
            format!("--print-to-pdf={}", temp_pdf.display()),
            path_to_file_url(html_path),
        ];
        let mut command = Command::new(executable);
        command
            .args(&args)
            .current_dir(html_path.parent().unwrap_or_else(|| Path::new(".")));
        let output = match command_output_with_timeout(
            &mut command,
            &format!("{} {headless_flag}", executable.display()),
        )
        .await
        {
            Ok(output) => output,
            Err(error) => {
                let _ = fs::remove_dir_all(&profile_dir);
                if ensure_pdf_written(&temp_pdf).is_ok() {
                    replace_pdf(&temp_pdf, pdf_path)?;
                    attempts.push(format!(
                        "{} {headless_flag}: PDF written before timeout",
                        executable.display()
                    ));
                    return Ok(());
                }
                let _ = fs::remove_file(&temp_pdf);
                attempts.push(error.clone());
                last_error = error;
                continue;
            }
        };
        let _ = fs::remove_dir_all(&profile_dir);
        if output.status.success() && ensure_pdf_written(&temp_pdf).is_ok() {
            replace_pdf(&temp_pdf, pdf_path)?;
            attempts.push(format!("{} {headless_flag}: ok", executable.display()));
            return Ok(());
        }
        let _ = fs::remove_file(&temp_pdf);
        last_error = command_failure_summary(&output.stdout, &output.stderr);
        attempts.push(format!(
            "{} {headless_flag}: {}",
            executable.display(),
            if last_error.is_empty() {
                format!("exit {}", output.status)
            } else {
                last_error.clone()
            }
        ));
    }
    Err(last_error)
}

async fn try_wkhtmltopdf(
    executable: &Path,
    html_path: &Path,
    pdf_path: &Path,
    attempts: &mut Vec<String>,
) -> Result<(), String> {
    if !executable_exists(executable) {
        attempts.push(format!("{}: not found", executable.display()));
        return Err("wkhtmltopdf candidate not found.".to_string());
    }
    let temp_pdf = temp_pdf_path(pdf_path);
    let _ = fs::remove_file(&temp_pdf);
    let mut command = Command::new(executable);
    command
        .args([
            "--enable-local-file-access",
            "--print-media-type",
            "--page-size",
            "A4",
        ])
        .arg(html_path)
        .arg(&temp_pdf)
        .current_dir(html_path.parent().unwrap_or_else(|| Path::new(".")));
    let output =
        match command_output_with_timeout(&mut command, &executable.display().to_string()).await {
            Ok(output) => output,
            Err(error) => {
                let _ = fs::remove_file(&temp_pdf);
                attempts.push(error.clone());
                return Err(error);
            }
        };
    if output.status.success() && ensure_pdf_written(&temp_pdf).is_ok() {
        replace_pdf(&temp_pdf, pdf_path)?;
        attempts.push(format!("{}: ok", executable.display()));
        return Ok(());
    }
    let _ = fs::remove_file(&temp_pdf);
    let summary = command_failure_summary(&output.stdout, &output.stderr);
    attempts.push(format!(
        "{}: {}",
        executable.display(),
        if summary.is_empty() {
            format!("exit {}", output.status)
        } else {
            summary.clone()
        }
    ));
    Err(summary)
}

async fn try_cupsfilter_pdf(
    executable: &Path,
    html_path: &Path,
    pdf_path: &Path,
    attempts: &mut Vec<String>,
) -> Result<(), String> {
    let mut command = Command::new(executable);
    command
        .args(["-m", "application/pdf"])
        .arg(html_path)
        .current_dir(html_path.parent().unwrap_or_else(|| Path::new(".")));
    let output =
        match command_output_with_timeout(&mut command, &executable.display().to_string()).await {
            Ok(output) => output,
            Err(error) => {
                attempts.push(error.clone());
                return Err(error);
            }
        };
    if output.status.success() && !output.stdout.is_empty() {
        let temp_pdf = temp_pdf_path(pdf_path);
        fs::write(&temp_pdf, &output.stdout)
            .map_err(|e| format!("Failed to write cupsfilter PDF: {e}"))?;
        ensure_pdf_written(&temp_pdf)?;
        replace_pdf(&temp_pdf, pdf_path)?;
        attempts.push(format!("{}: ok", executable.display()));
        return Ok(());
    }
    let summary = command_failure_summary(&output.stdout, &output.stderr);
    attempts.push(format!(
        "{}: {}",
        executable.display(),
        if summary.is_empty() {
            format!("exit {}", output.status)
        } else {
            summary.clone()
        }
    ));
    Err(summary)
}

async fn command_output_with_timeout(
    command: &mut Command,
    label: &str,
) -> Result<std::process::Output, String> {
    command.kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(45), command.output()).await {
        Ok(Ok(output)) => Ok(output),
        Ok(Err(error)) => Err(format!("{label}: {error}")),
        Err(_) => Err(format!("{label}: timed out after 45s")),
    }
}

fn temp_pdf_path(pdf_path: &Path) -> PathBuf {
    let id = RUN_COUNTER.fetch_add(1, Ordering::Relaxed);
    let name = pdf_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("alpha-studio-report");
    pdf_path.with_file_name(format!("{name}.tmp-{id}.pdf"))
}

fn ensure_pdf_written(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path).map_err(|e| format!("PDF was not created: {e}"))?;
    if metadata.len() == 0 {
        return Err("PDF output is empty.".to_string());
    }
    let bytes = fs::read(path).map_err(|e| format!("Failed to inspect PDF output: {e}"))?;
    if !bytes.starts_with(b"%PDF-") {
        return Err("PDF output does not have a valid header.".to_string());
    }
    if !bytes.windows(5).any(|window| window == b"%%EOF") {
        return Err("PDF output does not appear complete.".to_string());
    }
    Ok(())
}

fn replace_pdf(temp_pdf: &Path, pdf_path: &Path) -> Result<(), String> {
    if pdf_path.exists() {
        fs::remove_file(pdf_path).map_err(|e| format!("Failed to replace existing PDF: {e}"))?;
    }
    fs::rename(temp_pdf, pdf_path).map_err(|e| format!("Failed to move PDF into place: {e}"))
}

fn path_to_file_url(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('\\', "/");
    let prefixed = if raw.starts_with('/') {
        raw
    } else {
        format!("/{raw}")
    };
    format!("file://{}", percent_encode_url_path(&prefixed))
}

fn percent_encode_url_path(value: &str) -> String {
    let mut out = String::new();
    for byte in value.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'.' | b'-' | b'_' | b'~' | b':' => {
                out.push(*byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

fn command_failure_summary(stdout: &[u8], stderr: &[u8]) -> String {
    let text = [stderr, stdout]
        .iter()
        .map(|bytes| String::from_utf8_lossy(bytes).trim().to_string())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    text.chars().take(500).collect()
}

async fn open_path_with_system(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg(path)
            .output()
            .await
            .map_err(|e| format!("Failed to open PDF: {e}"))?;
        if output.status.success() {
            return Ok(());
        }
        Err(command_failure_summary(&output.stdout, &output.stderr))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = path;
        Ok(())
    }
}

async fn open_target_with_system(target: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("open")
            .arg(target)
            .output()
            .await
            .map_err(|e| format!("Failed to open external target: {e}"))?;
        if output.status.success() {
            return Ok(());
        }
        Err(command_failure_summary(&output.stdout, &output.stderr))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err(
            "Opening external browser targets is only supported on macOS in this build."
                .to_string(),
        )
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
    cmd.env("SHELL_SESSIONS_DISABLE", "1");
    cmd.env_remove("TERM_SESSION_ID");
    cmd.env_remove("SHELL_SESSION_DIR");
    cmd.env_remove("SHELL_SESSION_FILE");
    cmd.env_remove("SHELL_SESSION_DID_INIT");
    cmd.env_remove("SHELL_SESSION_DID_HISTORY_CHECK");

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

fn default_jqdata_config_version() -> u32 {
    1
}

fn default_jqdata_api_url() -> String {
    "https://dataapi.joinquant.com/v2/apis".to_string()
}

fn project_folder_root() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Cannot resolve home directory.".to_string())?;
    Ok(Path::new(&home).join(".alphastudio").join("projects"))
}

fn create_unique_project_folder(root: &Path, name: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(root)
        .map_err(|e| format!("Failed to create research topics directory: {e}"))?;
    let base_name = sanitize_project_folder_name(name);
    for index in 0..1000 {
        let folder_name = if index == 0 {
            base_name.clone()
        } else {
            format!("{base_name} {}", index + 1)
        };
        let path = root.join(folder_name);
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Failed to create research topic folder: {error}")),
        }
    }
    Err("Failed to create a unique research topic folder.".to_string())
}

fn rename_project_folder(root: &Path, current_path: &str, name: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(root)
        .map_err(|e| format!("Failed to create Alpha Studio project directory: {e}"))?;
    let current = PathBuf::from(current_path.trim());
    if current.as_os_str().is_empty() {
        return create_unique_project_folder(root, name);
    }
    let root_canonical = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Alpha Studio project directory: {e}"))?;
    let current_canonical = match current.canonicalize() {
        Ok(path) => path,
        Err(_) => return create_unique_project_folder(root, name),
    };
    if !current_canonical.starts_with(&root_canonical) {
        return Ok(current);
    }

    let base_name = sanitize_project_folder_name(name);
    for index in 0..1000 {
        let folder_name = if index == 0 {
            base_name.clone()
        } else {
            format!("{base_name} {}", index + 1)
        };
        let target = root.join(folder_name);
        if target == current || target.canonicalize().ok().as_ref() == Some(&current_canonical) {
            return Ok(current);
        }
        if target.exists() {
            continue;
        }
        fs::rename(&current, &target)
            .map_err(|e| format!("Failed to rename Alpha Studio project folder: {e}"))?;
        return Ok(target);
    }
    Err("Failed to find a unique project folder name.".to_string())
}

fn sanitize_project_folder_name(name: &str) -> String {
    let mut output = String::new();
    let mut last_was_space = false;
    for ch in name.trim().chars() {
        let next = if ch.is_control()
            || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        {
            '-'
        } else if ch.is_whitespace() {
            ' '
        } else {
            ch
        };
        if next == ' ' {
            if !last_was_space {
                output.push(next);
            }
            last_was_space = true;
        } else {
            output.push(next);
            last_was_space = false;
        }
    }
    let sanitized = output.trim_matches(|ch| matches!(ch, ' ' | '.' | '-'));
    if sanitized.is_empty() {
        "Research Topic".to_string()
    } else {
        sanitized.to_string()
    }
}

fn save_clipboard_attachment(root: &Path, name: &str, data: &str) -> Result<PathBuf, String> {
    const MAX_CLIPBOARD_ATTACHMENT_BYTES: usize = 100 * 1024 * 1024;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|error| format!("Failed to decode clipboard attachment: {error}"))?;
    if bytes.len() > MAX_CLIPBOARD_ATTACHMENT_BYTES {
        return Err("Clipboard attachment exceeds the 100 MB limit.".to_string());
    }
    fs::create_dir_all(root)
        .map_err(|error| format!("Failed to create clipboard attachment directory: {error}"))?;
    let source_name = Path::new(name.trim())
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment.bin");
    let safe_name = sanitize_project_folder_name(source_name);
    let safe_name = if safe_name.is_empty() {
        "attachment.bin".to_string()
    } else {
        safe_name
    };
    let path = root.join(format!("{}-{safe_name}", generate_id("clipboard")));
    fs::write(&path, bytes)
        .map_err(|error| format!("Failed to save clipboard attachment: {error}"))?;
    Ok(path)
}

impl Default for JqDataConfigFile {
    fn default() -> Self {
        Self {
            version: default_jqdata_config_version(),
            enabled: false,
            username: String::new(),
            password: String::new(),
            api_url: default_jqdata_api_url(),
            updated_at: String::new(),
        }
    }
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

fn read_model_config_file(path: &Path) -> Result<ModelConfigLoadResult, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("Failed to read model config: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse model config: {e}"))
}

fn write_model_config_file(path: &Path, config: &ModelConfigLoadResult) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create model config directory: {e}"))?;
    }
    let text = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to encode model config: {e}"))?;
    fs::write(path, format!("{text}\n")).map_err(|e| format!("Failed to write model config: {e}"))
}

fn jqdata_config_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Cannot resolve home directory.".to_string())?;
    Ok(Path::new(&home)
        .join(".alpha-studio")
        .join("jqdata-config.json"))
}

fn read_jqdata_config_file(path: &Path) -> Result<JqDataConfigFile, String> {
    let text =
        fs::read_to_string(path).map_err(|e| format!("Failed to read JQData config: {e}"))?;
    serde_json::from_str(&text).map_err(|e| format!("Failed to parse JQData config: {e}"))
}

async fn read_jqdata_config_secure(path: &Path) -> Result<JqDataConfigFile, String> {
    let mut config = read_jqdata_config_file(path)?;
    let legacy_password = config.password.trim().to_string();
    if !legacy_password.is_empty() {
        keychain::set_secret(keychain::JQDATA_PASSWORD_ACCOUNT, legacy_password.clone()).await?;
        config.password = legacy_password;
        write_jqdata_config_file(path, &config)?;
    } else {
        config.password = keychain::get_secret(keychain::JQDATA_PASSWORD_ACCOUNT)
            .await?
            .unwrap_or_default();
    }
    Ok(config)
}

fn write_jqdata_config_file(path: &Path, config: &JqDataConfigFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create JQData config directory: {e}"))?;
    }
    let text = serde_json::to_string_pretty(config)
        .map_err(|e| format!("Failed to encode JQData config: {e}"))?;
    fs::write(path, format!("{text}\n")).map_err(|e| format!("Failed to write JQData config: {e}"))
}

fn jqdata_config_load_result(config: JqDataConfigFile, path: PathBuf) -> JqDataConfigLoadResult {
    JqDataConfigLoadResult {
        version: config.version,
        enabled: config.enabled,
        username: config.username,
        password_configured: !config.password.trim().is_empty(),
        api_url: upgrade_legacy_jqdata_api_url(&config.api_url),
        updated_at: config.updated_at,
        path: path.to_string_lossy().to_string(),
    }
}

fn unix_millis_string() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

async fn run_jqdata_probe(
    config: JqDataConfigFile,
    state: &JqDataQueryState,
) -> Result<JqDataProbeResult, String> {
    match state
        .http
        .probe(
            &upgrade_legacy_jqdata_api_url(&config.api_url),
            config.username.trim(),
            config.password.trim(),
        )
        .await
    {
        Ok(result) => Ok(JqDataProbeResult {
            ok: true,
            message: "JQData 原生 HTTP 连接成功；安装包无需额外数据运行时。".to_string(),
            query_count: Some(result.query_count),
            sample: Some(json!({
                "transport": "native_http",
                "priceRows": result.price_rows,
            })),
        }),
        Err(error) => Ok(JqDataProbeResult {
            ok: false,
            message: scrub_jqdata_secret(&config, &error),
            query_count: None,
            sample: None,
        }),
    }
}

async fn run_jqdata_http_query(
    config: &JqDataConfigFile,
    request: &JqDataQueryRequest,
    state: &JqDataQueryState,
) -> Result<JqDataQueryResult, String> {
    match state
        .http
        .query(
            &upgrade_legacy_jqdata_api_url(&config.api_url),
            config.username.trim(),
            config.password.trim(),
            &request.method,
            &request.params,
        )
        .await
    {
        Ok(rows) => Ok(JqDataQueryResult {
            ok: true,
            message: None,
            rows: Some(Value::Array(rows)),
        }),
        Err(error) => Ok(JqDataQueryResult {
            ok: false,
            message: Some(scrub_jqdata_secret(config, &error)),
            rows: None,
        }),
    }
}

fn scrub_jqdata_secret(config: &JqDataConfigFile, text: &str) -> String {
    let mut scrubbed = text.to_string();
    let username = config.username.trim();
    if !username.is_empty() {
        scrubbed = scrubbed.replace(username, "[jqdata-user]");
    }
    let password = config.password.trim();
    if !password.is_empty() {
        scrubbed = scrubbed.replace(password, "[jqdata-password]");
    }
    scrubbed
}

fn upgrade_legacy_jqdata_api_url(value: &str) -> String {
    let url = value.trim().trim_end_matches('/');
    if url == "https://dataapi.joinquant.com/apis" {
        return default_jqdata_api_url();
    }
    if url == "http://dataapi.joinquant.com/apis" {
        return "http://dataapi.joinquant.com/v2/apis".to_string();
    }
    if url.is_empty() {
        return default_jqdata_api_url();
    }
    url.to_string()
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
        "none" => Some("none".to_string()),
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

fn sanitize_service_tier(value: Option<&str>) -> Option<String> {
    match value.map(str::trim).unwrap_or_default() {
        "fast" => Some("fast".to_string()),
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
            "Provider ID `{provider_id}` 是 GPT 保留名称，请换一个自定义 ID。"
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
        context_window_tokens: request
            .provider_context_window_tokens
            .map(sanitize_custom_model_context_window),
    }))
}

fn sanitize_custom_model_context_window(value: u32) -> u32 {
    const MIN_TOKENS: u32 = 16_000;
    const MAX_TOKENS: u32 = 2_000_000;
    value.clamp(MIN_TOKENS, MAX_TOKENS)
}

fn codex_app_server_args(
    provider: Option<&ModelProviderConfig>,
    service_tier: Option<&str>,
) -> Vec<String> {
    let mut args = vec!["app-server".to_string()];
    if service_tier == Some("fast") {
        push_config_arg(&mut args, "service_tier", "fast");
    }
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
    if let Some(context_window_tokens) = provider.context_window_tokens {
        push_raw_config_arg(
            &mut args,
            "model_context_window",
            &context_window_tokens.to_string(),
        );
        let compact_token_limit = context_window_tokens.saturating_mul(3) / 4;
        push_raw_config_arg(
            &mut args,
            "model_auto_compact_token_limit",
            &compact_token_limit.to_string(),
        );
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
        response.body.len()
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
        for key in chat_tool_call_reasoning_keys(call) {
            stored.insert(key, reasoning_content.clone());
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
    if thinking_enabled {
        ensure_assistant_reasoning_content(&mut messages, reasoning_by_call_id);
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
            let reasoning_content = if chat_role == "assistant" {
                response_message_reasoning_content(item)
                    .or_else(|| pending_reasoning_content.take())
            } else {
                None
            };
            if let Some(text) =
                response_content_to_text(item.get("content").unwrap_or(&Value::Null))
            {
                push_chat_text_message_with_reasoning(
                    messages,
                    chat_role,
                    &text,
                    reasoning_content,
                );
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
                    .or_else(|| {
                        lookup_reasoning_for_function_call(
                            reasoning_by_call_id,
                            item,
                            call_id,
                            name,
                            &arguments,
                        )
                    });
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

fn ensure_assistant_reasoning_content(
    messages: &mut [Value],
    reasoning_by_call_id: &HashMap<String, String>,
) {
    for message in messages {
        let Some(map) = message.as_object_mut() else {
            continue;
        };
        if map.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }
        if map_has_reasoning_content(map) {
            continue;
        }
        let reasoning_content = map
            .get("tool_calls")
            .and_then(Value::as_array)
            .and_then(|tool_calls| {
                tool_calls.iter().find_map(|call| {
                    lookup_reasoning_for_chat_tool_call(reasoning_by_call_id, call)
                })
            })
            .unwrap_or_else(|| FALLBACK_REASONING_CONTENT.to_string());
        map.insert("reasoning_content".to_string(), json!(reasoning_content));
    }
}

fn map_has_reasoning_content(map: &Map<String, Value>) -> bool {
    [
        "reasoning_content",
        "reasoningContent",
        "thinking_content",
        "thinkingContent",
        "reasoning",
    ]
    .iter()
    .filter_map(|key| map.get(*key))
    .map(chat_message_content_to_text)
    .any(|text| !text.trim().is_empty())
}

fn lookup_reasoning_for_function_call(
    reasoning_by_call_id: &HashMap<String, String>,
    item: &Value,
    call_id: &str,
    name: &str,
    arguments: &str,
) -> Option<String> {
    let mut keys = Vec::new();
    push_unique_non_empty(&mut keys, call_id);
    if let Some(item_id) = item.get("id").and_then(Value::as_str) {
        push_unique_non_empty(&mut keys, item_id);
    }
    if let Some(item_call_id) = item.get("call_id").and_then(Value::as_str) {
        push_unique_non_empty(&mut keys, item_call_id);
    }
    if !name.trim().is_empty() {
        push_unique_non_empty(&mut keys, &format!("fn:{name}:{arguments}"));
    }
    keys.into_iter().find_map(|key| {
        reasoning_by_call_id
            .get(&key)
            .filter(|value| !value.trim().is_empty())
            .cloned()
    })
}

fn lookup_reasoning_for_chat_tool_call(
    reasoning_by_call_id: &HashMap<String, String>,
    call: &Value,
) -> Option<String> {
    chat_tool_call_reasoning_keys(call)
        .into_iter()
        .find_map(|key| {
            reasoning_by_call_id
                .get(&key)
                .filter(|value| !value.trim().is_empty())
                .cloned()
        })
}

fn chat_tool_call_reasoning_keys(call: &Value) -> Vec<String> {
    let mut keys = Vec::new();
    if let Some(id) = call.get("id").and_then(Value::as_str) {
        push_unique_non_empty(&mut keys, id);
    }
    if let Some(call_id) = call.get("call_id").and_then(Value::as_str) {
        push_unique_non_empty(&mut keys, call_id);
    }
    let name = call
        .get("function")
        .and_then(|function| function.get("name"))
        .or_else(|| call.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let arguments = call
        .get("function")
        .and_then(|function| function.get("arguments"))
        .or_else(|| call.get("arguments"))
        .map(value_to_string)
        .unwrap_or_default();
    if !name.trim().is_empty() {
        push_unique_non_empty(&mut keys, &format!("fn:{name}:{arguments}"));
    }
    keys
}

fn push_unique_non_empty(keys: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return;
    }
    if !keys.iter().any(|key| key == trimmed) {
        keys.push(trimmed.to_string());
    }
}

fn push_chat_text_message(messages: &mut Vec<Value>, role: &str, content: &str) {
    push_chat_text_message_with_reasoning(messages, role, content, None);
}

fn push_chat_text_message_with_reasoning(
    messages: &mut Vec<Value>,
    role: &str,
    content: &str,
    reasoning_content: Option<String>,
) {
    let reasoning_content = reasoning_content.filter(|value| !value.trim().is_empty());
    if let Some(last) = messages.last_mut() {
        let last_role = last.get("role").and_then(Value::as_str);
        let has_tool_calls = last.get("tool_calls").is_some();
        let has_reasoning_content = last
            .as_object()
            .map(map_has_reasoning_content)
            .unwrap_or(false);
        if last_role == Some(role)
            && !has_tool_calls
            && role != "tool"
            && reasoning_content.is_none()
            && !has_reasoning_content
        {
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
    let mut message = Map::new();
    message.insert("role".to_string(), json!(role));
    message.insert("content".to_string(), json!(content));
    if role == "assistant" {
        if let Some(reasoning_content) = reasoning_content {
            message.insert("reasoning_content".to_string(), json!(reasoning_content));
        }
    }
    messages.push(Value::Object(message));
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

fn response_message_reasoning_content(item: &Value) -> Option<String> {
    [
        "reasoning_content",
        "reasoningContent",
        "thinking_content",
        "thinkingContent",
        "reasoning",
    ]
    .iter()
    .find_map(|key| item.get(*key))
    .and_then(response_content_to_text)
    .map(|text| text.trim().to_string())
    .filter(|text| !text.is_empty())
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
        "reasoning",
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
    buffer.push('\n');
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

fn check_codex(app: Option<&AppHandle>) -> CodexCheckResult {
    match resolve_codex_binary(app) {
        Some((path, version)) => {
            let codex_home = match prepare_alpha_studio_codex_home(app) {
                Ok(path) => path,
                Err(error) => {
                    return CodexCheckResult {
                        installed: true,
                        version,
                        path,
                        logged_in: false,
                        account_email: None,
                        error: Some(error),
                    };
                }
            };
            let logged_in = codex_logged_in(&path, &codex_home);
            let account_email = if logged_in {
                codex_account_email(&codex_home)
            } else {
                None
            };
            CodexCheckResult {
                installed: true,
                version,
                path,
                logged_in,
                account_email,
                error: if logged_in {
                    None
                } else {
                    Some("GPT is installed, but Alpha Studio has not completed device authorization. Click \"Authorize GPT\" to sign in.".to_string())
                },
            }
        }
        None => CodexCheckResult {
            installed: false,
            version: String::new(),
            path: String::new(),
            logged_in: false,
            account_email: None,
            error: Some(
                "No working GPT engine was found. Reinstall Alpha Studio or install/repair Codex CLI."
                    .to_string(),
            ),
        },
    }
}

async fn read_codex_account_rate_limits(path: &str, codex_home: &Path) -> Result<Value, String> {
    let mut command = Command::new(path);
    for arg in codex_app_server_args(None, None) {
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
        .map_err(|e| format!("Failed to start GPT service: {e}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open GPT input".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to open GPT output".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to open GPT error output".to_string())?;

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
            if buffer.len() < 4096 {
                if !buffer.is_empty() {
                    buffer.push('\n');
                }
                buffer.push_str(trimmed);
            }
        }
    });

    let mut reader = BufReader::new(stdout).lines();
    let request_result = async {
        initialize_codex_app_server(&mut stdin, &mut reader).await?;
        send_jsonrpc(
            &mut stdin,
            &json!({ "jsonrpc": "2.0", "id": 2, "method": "account/rateLimits/read" }),
        )
        .await?;
        let response = await_response(&mut stdin, &mut reader, 2).await?;
        response
            .get("result")
            .cloned()
            .ok_or_else(|| "GPT service did not return rate limit data".to_string())
    }
    .await;

    let _ = child.kill().await;
    let _ = child.wait().await;

    match request_result {
        Ok(value) => Ok(value),
        Err(message) => {
            let stderr_text = stderr_buffer.lock().await.clone();
            if stderr_text.is_empty() {
                Err(message)
            } else {
                Err(format!("{message}: {stderr_text}"))
            }
        }
    }
}

async fn read_codex_models(
    path: &str,
    codex_home: &Path,
    force_refetch: bool,
) -> Result<Vec<CodexModelCatalogItem>, String> {
    let mut command = Command::new(path);
    for arg in codex_app_server_args(None, None) {
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
        .map_err(|error| format!("Failed to start GPT service: {error}"))?;
    let request_result = match (child.stdin.take(), child.stdout.take(), child.stderr.take()) {
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
                Err(_) => Err("Timed out reading the GPT model catalog.".to_string()),
            }
        }
        _ => Err("Failed to open GPT service I/O.".to_string()),
    };

    let _ = child.kill().await;
    let _ = child.wait().await;

    request_result
}

fn resolve_codex_binary(app: Option<&AppHandle>) -> Option<(String, String)> {
    for candidate in codex_binary_candidates(app) {
        if let Some(version) = codex_version(&candidate) {
            return Some((candidate, version));
        }
    }
    None
}

fn codex_binary_candidates(app: Option<&AppHandle>) -> Vec<String> {
    let mut candidates = Vec::new();
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            candidates.extend(codex_bundled_binary_candidates(&resource_dir));
        }
    }
    candidates.push("/Applications/ChatGPT.app/Contents/Resources/codex".to_string());
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

fn codex_bundled_binary_candidates(resource_dir: &Path) -> Vec<String> {
    [".alpha-codex", "_up_/.alpha-codex"]
        .into_iter()
        .map(|relative_path| {
            resource_dir
                .join(relative_path)
                .join("bin")
                .join(CODEX_EXECUTABLE_NAME)
                .to_string_lossy()
                .to_string()
        })
        .collect()
}

pub(crate) fn home_dir() -> Option<String> {
    // Unix shells typically set HOME; Windows installed apps usually only have USERPROFILE.
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            let drive = std::env::var("HOMEDRIVE").ok()?;
            let path = std::env::var("HOMEPATH").ok()?;
            let combined = format!("{drive}{path}");
            (!combined.trim().is_empty()).then_some(combined)
        })
}

fn prepare_alpha_studio_codex_home(app: Option<&AppHandle>) -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Failed to resolve HOME for GPT config.".to_string())?;
    let source = PathBuf::from(&home).join(".codex");
    let target = alpha_studio_codex_home_path_from(&home);
    let preserve_authorization = target.join(CODEX_DEVICE_AUTHORIZATION_MARKER).is_file();
    let encoded_skills = alpha_studio_encoded_skills_path(app);
    prepare_alpha_studio_codex_home_from_with_builtin(
        &source,
        &target,
        preserve_authorization,
        encoded_skills.as_deref(),
    )?;
    Ok(target)
}

fn alpha_studio_codex_home_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Failed to resolve HOME for GPT config.".to_string())?;
    Ok(alpha_studio_codex_home_path_from(&home))
}

fn alpha_studio_codex_home_path_from(home: &str) -> PathBuf {
    PathBuf::from(home).join(".alpha-studio").join("codex-home")
}

#[cfg(test)]
fn prepare_alpha_studio_codex_home_from(
    source: &Path,
    target: &Path,
    preserve_authorization: bool,
) -> Result<(), String> {
    let encoded_skills = alpha_studio_encoded_skills_path(None);
    prepare_alpha_studio_codex_home_from_with_builtin(
        source,
        target,
        preserve_authorization,
        encoded_skills.as_deref(),
    )
}

fn prepare_alpha_studio_codex_home_from_with_builtin(
    source: &Path,
    target: &Path,
    preserve_authorization: bool,
    encoded_skills: Option<&Path>,
) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create Alpha Studio GPT workspace: {e}"))?;

    if !preserve_authorization {
        for file_name in ["auth.json", "installation_id"] {
            remove_existing_path(&target.join(file_name))?;
        }
    }

    for file_name in ["config.toml", "AGENTS.md"] {
        let source_path = source.join(file_name);
        if source_path.is_file() {
            copy_codex_home_file(&source_path, &target.join(file_name))?;
        }
    }

    prepare_alpha_studio_skills_directory(
        &source.join("skills"),
        &target.join("skills"),
        encoded_skills,
    )?;

    for dir_name in ["plugins", "vendor_imports", "cache", "rules"] {
        let source_path = source.join(dir_name);
        if source_path.is_dir() {
            link_codex_home_directory(&source_path, &target.join(dir_name))?;
        }
    }

    // The coworker sub-agents (agents/*.toml, written by `coworkers_sync`)
    // need enough concurrent threads for all nine coworkers. config.toml is
    // re-copied from the user's ~/.codex on every rebuild, so re-apply the
    // [agents] section here unless the user already configured one.
    ensure_agents_config_section(&target.join("config.toml"))?;

    Ok(())
}

fn alpha_studio_encoded_skills_path(app: Option<&AppHandle>) -> Option<PathBuf> {
    // Development always follows the repository source that predev/prebuild
    // just encoded. Managed releases only take precedence in packaged builds.
    if cfg!(debug_assertions) {
        let development = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.alpha-encoded");
        if development.is_dir() {
            return Some(development);
        }
    }
    if let Some(managed) = managed_skills::active_encoded_skills_path() {
        return Some(managed);
    }
    if let Some(app) = app {
        if let Ok(resource_dir) = app.path().resource_dir() {
            for relative_path in [".alpha-encoded", "_up_/.alpha-encoded"] {
                let encoded_skills = resource_dir.join(relative_path);
                if encoded_skills.is_dir() {
                    return Some(encoded_skills);
                }
            }
        }
    }
    let encoded_skills = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.alpha-encoded");
    encoded_skills.is_dir().then_some(encoded_skills)
}

fn prepare_alpha_studio_skills_directory(
    source: &Path,
    target: &Path,
    encoded_skills: Option<&Path>,
) -> Result<(), String> {
    remove_existing_path(target)?;
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create Alpha Studio skills directory: {e}"))?;
    if source.is_dir() {
        copy_codex_home_directory_contents(source, target)?;
    }
    let encoded_skills = encoded_skills.ok_or_else(|| {
        "Alpha Studio built-in Skill bundle is missing; run `npm run skills:encode` and rebuild."
            .to_string()
    })?;
    let installed = builtin_skills::install_builtin_skills(encoded_skills, target, source)?;
    if installed.skill_names.is_empty() || installed.encoded_file_count == 0 {
        return Err("Alpha Studio built-in Skill bundle decoded no usable Skills".to_string());
    }
    Ok(())
}

const COWORKER_AGENTS_MAX_THREADS: u32 = 9;

fn ensure_agents_config_section(config_path: &Path) -> Result<(), String> {
    let existing = match fs::read_to_string(config_path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(format!(
                "Failed to read GPT config {}: {e}",
                config_path.display(),
                e = error
            ))
        }
    };
    let has_agents_table = existing
        .lines()
        .map(str::trim)
        .any(|line| line == "[agents]" || line.starts_with("[agents."));
    if has_agents_table {
        return Ok(());
    }
    let mut content = existing;
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }
    content.push_str(&format!(
        "\n[agents]\n# Added by Alpha Studio: allow all AI coworkers to run in parallel.\nmax_threads = {COWORKER_AGENTS_MAX_THREADS}\n",
    ));
    fs::write(config_path, content)
        .map_err(|e| format!("Failed to update GPT config {}: {e}", config_path.display()))
}

/// Materializes the AI coworker catalog into Codex custom agent definitions
/// under the private CODEX_HOME (agents/<id>.toml). The directory is fully
/// owned by Alpha Studio and rewritten on every sync so removed coworkers
/// disappear as well.
#[tauri::command]
async fn coworkers_sync(request: CoworkersSyncRequest) -> Result<CoworkersSyncResult, String> {
    let codex_home = alpha_studio_codex_home_path()?;
    let agents_dir = codex_home.join("agents");
    let written = sync_coworker_agents(&agents_dir, &request.definitions)?;
    Ok(CoworkersSyncResult {
        agents_dir: agents_dir.to_string_lossy().to_string(),
        written,
    })
}

fn sync_coworker_agents(
    agents_dir: &Path,
    definitions: &[CoworkerAgentDefinition],
) -> Result<usize, String> {
    remove_existing_path(agents_dir)?;
    fs::create_dir_all(agents_dir)
        .map_err(|e| format!("Failed to create GPT agents directory: {e}"))?;
    let mut written = 0;
    for definition in definitions {
        if !is_valid_coworker_agent_id(&definition.id) {
            return Err(format!(
                "Invalid coworker agent id `{}`: only ASCII letters, digits, `-` and `_` are allowed.",
                definition.id
            ));
        }
        let path = agents_dir.join(format!("{}.toml", definition.id));
        fs::write(&path, coworker_agent_toml(definition))
            .map_err(|e| format!("Failed to write agent file {}: {e}", path.display()))?;
        written += 1;
    }
    Ok(written)
}

fn is_valid_coworker_agent_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn coworker_agent_toml(definition: &CoworkerAgentDefinition) -> String {
    let mut lines = vec![
        format!("# {} · generated by Alpha Studio", definition.display_name),
        "# 请勿手工编辑:应用启动时会根据同事目录重写此文件。".to_string(),
        format!("name = {}", toml_basic_string(&definition.id)),
        format!(
            "description = {}",
            toml_basic_string(&definition.description)
        ),
        format!(
            "developer_instructions = {}",
            toml_basic_string(&definition.instructions)
        ),
    ];
    if let Some(model) = definition
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!("model = {}", toml_basic_string(model)));
    }
    if let Some(effort) = sanitize_reasoning_effort(definition.reasoning_effort.as_deref()) {
        lines.push(format!(
            "model_reasoning_effort = {}",
            toml_basic_string(&effort)
        ));
    }
    if let Some(sandbox) = definition
        .sandbox_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        lines.push(format!(
            "sandbox_mode = {}",
            toml_basic_string(&sanitize_sandbox_mode(Some(sandbox)))
        ));
    }
    let mut content = lines.join("\n");
    content.push('\n');
    content
}

/// Escapes a string as a single-line TOML basic string ("..."), folding
/// newlines into `\n` escapes so multi-line personas stay valid TOML.
fn toml_basic_string(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04X}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn revoke_alpha_studio_codex_authorization() -> Result<PathBuf, String> {
    let target = alpha_studio_codex_home_path()?;
    revoke_alpha_studio_codex_authorization_from(&target)?;
    Ok(target)
}

fn revoke_alpha_studio_codex_authorization_from(target: &Path) -> Result<(), String> {
    for file_name in [
        "auth.json",
        "installation_id",
        CODEX_DEVICE_AUTHORIZATION_MARKER,
    ] {
        remove_existing_path(&target.join(file_name))?;
    }
    Ok(())
}

fn mark_codex_device_authorized(target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create Alpha Studio GPT workspace: {e}"))?;
    fs::write(
        target.join(CODEX_DEVICE_AUTHORIZATION_MARKER),
        "GPT device authorization was started from Alpha Studio.\n",
    )
    .map_err(|e| format!("Failed to save GPT authorization marker: {e}"))
}

fn copy_codex_home_file(source: &Path, target: &Path) -> Result<(), String> {
    remove_existing_path(target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create GPT config directory: {e}"))?;
    }
    fs::copy(source, target)
        .map(|_| ())
        .map_err(|e| format!("Failed to copy GPT config file {}: {e}", source.display()))
}

fn link_codex_home_directory(source: &Path, target: &Path) -> Result<(), String> {
    remove_existing_path(target)?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(source, target)
            .map_err(|e| format!("Failed to link GPT directory {}: {e}", source.display()))
    }
    #[cfg(not(unix))]
    {
        copy_codex_home_directory(source, target)
    }
}

#[cfg(not(unix))]
fn copy_codex_home_directory(source: &Path, target: &Path) -> Result<(), String> {
    copy_codex_home_directory_contents(source, target)
}

fn copy_codex_home_directory_contents(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|e| format!("Failed to create GPT directory {}: {e}", target.display()))?;
    for entry in fs::read_dir(source)
        .map_err(|e| format!("Failed to read GPT directory {}: {e}", source.display()))?
    {
        let entry = entry.map_err(|e| format!("Failed to read GPT directory entry: {e}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_codex_home_directory_contents(&source_path, &target_path)?;
        } else if source_path.is_file() {
            copy_codex_home_file(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn remove_existing_path(path: &Path) -> Result<(), String> {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return Ok(());
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path).map_err(|e| {
            format!(
                "Failed to remove existing directory {}: {e}",
                path.display()
            )
        })
    } else {
        fs::remove_file(path)
            .map_err(|e| format!("Failed to remove existing file {}: {e}", path.display()))
    }
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

fn validate_open_path(path: &str) -> Result<&str, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Path is required.".to_string());
    }
    if !Path::new(path).exists() {
        return Err(format!("Path does not exist: {path}"));
    }
    Ok(path)
}

fn validate_external_target(target: &str) -> Result<String, String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("External target is required.".to_string());
    }
    if target.starts_with('/') {
        validate_open_path(target)?;
        return Ok(target.to_string());
    }
    let lower = target.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(target.to_string());
    }
    Err("Unsupported external target.".to_string())
}

fn terminal_open_target(path: &str) -> PathBuf {
    let path_ref = Path::new(path);
    if path_ref.is_dir() {
        return path_ref.to_path_buf();
    }
    path_ref
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(path))
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

async fn launch_codex_login(path: &str, codex_home: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let login_command = format!(
            "env CODEX_HOME={} {} login; echo; echo {}",
            shell_quote(&codex_home.to_string_lossy()),
            shell_quote(path),
            shell_quote("Return to Alpha Studio after GPT login finishes."),
        );
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            escape_applescript_string(&login_command)
        );
        let output = Command::new("osascript")
            .arg("-e")
            .arg(script)
            .arg("-e")
            .arg("tell application \"Terminal\" to activate")
            .output()
            .await
            .map_err(|e| format!("Failed to launch GPT login: {e}"))?;
        if output.status.success() {
            Ok(())
        } else {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            Err(if stderr.is_empty() {
                "Failed to launch GPT login in Terminal.".to_string()
            } else {
                stderr
            })
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        Command::new(path)
            .arg("login")
            .env("CODEX_HOME", codex_home)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("Failed to launch GPT login: {e}"))
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn escape_applescript_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn codex_logged_in(path: &str, codex_home: &Path) -> bool {
    let output = std::process::Command::new(path)
        .args(["login", "status"])
        .env("CODEX_HOME", codex_home)
        .env("TERM", "xterm-256color")
        .env("NO_COLOR", "1")
        .output();
    match output {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

fn codex_account_email(codex_home: &Path) -> Option<String> {
    let text = fs::read_to_string(codex_home.join("auth.json")).ok()?;
    let auth = serde_json::from_str::<Value>(&text).ok()?;
    let id_token = auth.get("tokens")?.get("id_token")?.as_str()?.trim();
    let payload = id_token.split('.').nth(1)?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(payload)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(payload))
        .ok()?;
    let claims = serde_json::from_slice::<Value>(&bytes).ok()?;
    claims
        .get("email")?
        .as_str()
        .map(str::trim)
        .filter(|email| !email.is_empty())
        .map(str::to_string)
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
        "token_count" => Some(event(
            "token_usage",
            run_id,
            conversation_id,
            None,
            None,
            None,
            None,
            None,
            Some(raw),
        )),
        "context_compacted" | "thread.compacted" => Some(event(
            "context_compacted",
            run_id,
            conversation_id,
            raw.get("thread_id")
                .or_else(|| raw.get("threadId"))
                .and_then(Value::as_str)
                .map(str::to_string),
            None,
            None,
            None,
            None,
            Some(raw),
        )),
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
                .unwrap_or_else(|| "GPT turn failed.".to_string());
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
                .unwrap_or_else(|| "GPT reported an error.".to_string());
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

    if is_context_compaction_item(&item_type) {
        return Some(event(
            "context_compacted",
            run_id,
            conversation_id,
            raw.get("threadId")
                .or_else(|| raw.get("thread_id"))
                .and_then(Value::as_str)
                .map(str::to_string),
            item_id,
            Some("context_compaction".to_string()),
            None,
            None,
            Some(raw.clone()),
        ));
    }

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
        || normalized_type.contains("imagegeneration")
        || normalized_type.contains("filechange")
        || normalized_type.contains("websearch")
        || normalized_type.contains("filesearch")
        || normalized_type.contains("webfetch")
}

fn is_context_compaction_item(normalized_type: &str) -> bool {
    matches!(normalized_type, "contextcompaction" | "compaction")
}

fn normalized_item_type(item: &Value) -> String {
    item.get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .replace(['_', '-'], "")
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
    .or_else(|| extract_file_change_details(item))
}

fn extract_tool_output(item: &Value) -> Option<String> {
    first_string(
        item,
        &[
            "output",
            "aggregatedOutput",
            "savedPath",
            "saved_path",
            "result",
            "stdout",
            "stderr",
            "diff",
        ],
    )
    .or_else(|| item.get("content").map(|value| value.to_string()))
    .or_else(|| extract_file_change_details(item))
}

fn extract_file_change_details(item: &Value) -> Option<String> {
    let changes = item.get("changes")?;
    if changes.is_null() || changes.as_array().is_some_and(Vec::is_empty) {
        return None;
    }
    serde_json::to_string(changes).ok()
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
        .manage(CodexProcessState::default())
        .manage(TerminalState::default())
        .manage(JqDataQueryState::default())
        .invoke_handler(tauri::generate_handler![
            codex_check,
            codex_login,
            codex_revoke_authorization,
            codex_subscription_usage,
            codex_models,
            model_config_load,
            model_config_save,
            managed_skills::managed_skills_sync,
            project_folder_create,
            project_folder_rename,
            clipboard_attachment_save,
            jqdata_config_load,
            jqdata_config_save,
            jqdata_test_connection,
            jqdata_query,
            local_store::local_store_info,
            local_store::local_store_load,
            local_store::local_store_commit,
            local_store::local_store_import_legacy,
            local_store::local_store_export,
            local_store::local_store_backup_now,
            local_store::market_cache_get,
            local_store::market_cache_put,
            codex_chat_start,
            codex_chat_stop,
            coworkers_sync,
            list_open_apps,
            open_in_app,
            copy_file_to_clipboard,
            open_external_target,
            reveal_local_path,
            local_image_data_url,
            local_file_exists,
            local_text_file_read,
            local_directory_list,
            local_pdf_file_read,
            browser_webview_create,
            browser_webview_navigate,
            browser_webview_set_bounds,
            browser_webview_action,
            browser_webview_close,
            html_to_pdf,
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
            // Materialize the protected official Skills as soon as
            // the desktop client starts. This is independent of GPT login, so
            // a fresh installation has its official Skill runtime
            // before the first authorization or chat request.
            prepare_alpha_studio_codex_home(Some(app.handle())).map_err(std::io::Error::other)?;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Alpha Studio");
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
        .expect("error while running Alpha Studio");
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert_eq!(
            catalog[0].supported_reasoning_efforts[0].reasoning_effort,
            "low"
        );
    }

    #[test]
    fn sanitize_reasoning_effort_accepts_max_and_ultra() {
        assert_eq!(
            sanitize_reasoning_effort(Some("max")).as_deref(),
            Some("max")
        );
        assert_eq!(
            sanitize_reasoning_effort(Some("ultra")).as_deref(),
            Some("ultra")
        );
        assert_eq!(
            sanitize_reasoning_effort(Some("minimal")).as_deref(),
            Some("minimal")
        );
        assert_eq!(sanitize_reasoning_effort(Some("future")), None);
        assert_eq!(sanitize_catalog_reasoning_effort(Some("minimal")), None);
        assert_eq!(
            sanitize_catalog_reasoning_effort(Some("ultra")).as_deref(),
            Some("ultra")
        );
    }

    #[tokio::test]
    async fn codex_model_catalog_paginates_and_preserves_force_refetch() {
        let (client, server) = tokio::io::duplex(32 * 1024);
        let (client_read, mut client_write) = tokio::io::split(client);
        let (server_read, mut server_write) = tokio::io::split(server);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_read).lines();

            let initialize: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(
                initialize.get("method").and_then(Value::as_str),
                Some("initialize")
            );
            server_write
                .write_all(
                    format!("{}\n", json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).as_bytes(),
                )
                .await
                .unwrap();

            let initialized: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(
                initialized.get("method").and_then(Value::as_str),
                Some("initialized")
            );

            let first: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(
                first.get("method").and_then(Value::as_str),
                Some("model/list")
            );
            assert_eq!(
                first.pointer("/params/limit").and_then(Value::as_i64),
                Some(100)
            );
            assert_eq!(
                first
                    .pointer("/params/forceRefetch")
                    .and_then(Value::as_bool),
                Some(true)
            );
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

            let second: Value =
                serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap();
            assert_eq!(
                second.pointer("/params/cursor").and_then(Value::as_str),
                Some("next-page")
            );
            assert_eq!(
                second
                    .pointer("/params/forceRefetch")
                    .and_then(Value::as_bool),
                Some(true)
            );
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
            catalog
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
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
                .write_all(
                    format!("{}\n", json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).as_bytes(),
                )
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

        assert_eq!(
            error,
            "GPT service returned a repeated model pagination cursor."
        );
    }

    #[tokio::test]
    async fn codex_model_catalog_rejects_empty_visible_results() {
        let (client, server) = tokio::io::duplex(8192);
        let (client_read, mut client_write) = tokio::io::split(client);
        let (server_read, mut server_write) = tokio::io::split(server);
        let server_task = tokio::spawn(async move {
            let mut lines = BufReader::new(server_read).lines();
            let _initialize = lines.next_line().await.unwrap().unwrap();
            server_write
                .write_all(
                    format!("{}\n", json!({ "jsonrpc": "2.0", "id": 1, "result": {} })).as_bytes(),
                )
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

        assert_eq!(error, "GPT service returned no visible valid models.");
    }

    #[test]
    fn includes_current_chatgpt_bundled_codex_before_legacy_app_path() {
        let candidates = codex_binary_candidates(None);
        let current = "/Applications/ChatGPT.app/Contents/Resources/codex";
        let legacy = "/Applications/Codex.app/Contents/Resources/codex";

        let current_index = candidates
            .iter()
            .position(|candidate| candidate == current)
            .expect("current ChatGPT bundled Codex candidate");
        let legacy_index = candidates
            .iter()
            .position(|candidate| candidate == legacy)
            .expect("legacy Codex app candidate");

        assert!(current_index < legacy_index);
    }

    #[test]
    fn alpha_studio_bundled_codex_is_the_first_runtime_candidate() {
        let resource_dir = PathBuf::from("/Applications/Alpha Studio.app/Contents/Resources");
        let candidates = codex_bundled_binary_candidates(&resource_dir);
        let expected = resource_dir
            .join(".alpha-codex")
            .join("bin")
            .join(CODEX_EXECUTABLE_NAME)
            .to_string_lossy()
            .to_string();

        assert_eq!(candidates.first(), Some(&expected));
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
    fn parses_token_count_event() {
        let event = parse_codex_json_event(
            r#"{"type":"token_count","info":{"total_token_usage":{"input_tokens":34498,"cached_input_tokens":19712,"output_tokens":910,"reasoning_output_tokens":418,"total_tokens":35408},"last_token_usage":{"input_tokens":19770,"cached_input_tokens":14720,"output_tokens":659,"reasoning_output_tokens":288,"total_tokens":20429},"model_context_window":258400}}"#,
            "run-1",
            "conv-1",
        )
        .unwrap();
        assert_eq!(event.event_type, "token_usage");
        assert_eq!(
            event
                .raw
                .as_ref()
                .and_then(|raw| raw.get("info"))
                .and_then(|info| info.get("last_token_usage"))
                .and_then(|usage| usage.get("total_tokens"))
                .and_then(Value::as_i64),
            Some(20429),
        );
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
    fn app_server_suppresses_completed_message_after_any_delta_when_id_is_missing() {
        let mut streamed = HashSet::new();
        let delta = map_app_server_notification(
            "item/agentMessage/delta",
            &serde_json::json!({ "threadId": "t", "turnId": "u", "itemId": "item_0", "delta": "你好。" }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        assert_eq!(delta.len(), 1);

        let completed = map_app_server_notification(
            "item/completed",
            &serde_json::json!({ "item": { "type": "agentMessage", "text": "你好。我在。" } }),
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
    fn app_server_maps_thread_token_usage() {
        let mut streamed = HashSet::new();
        let events = map_app_server_notification(
            "thread/tokenUsage/updated",
            &serde_json::json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "tokenUsage": {
                    "total": {
                        "totalTokens": 34498,
                        "inputTokens": 34000,
                        "cachedInputTokens": 14720,
                        "outputTokens": 498,
                        "reasoningOutputTokens": 120
                    },
                    "last": {
                        "totalTokens": 20429,
                        "inputTokens": 19770,
                        "cachedInputTokens": 14720,
                        "outputTokens": 659,
                        "reasoningOutputTokens": 288
                    },
                    "modelContextWindow": 258400
                }
            }),
            "run-1",
            "conv-1",
            &mut streamed,
        );

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "token_usage");
        assert_eq!(events[0].thread_id.as_deref(), Some("thread-1"));
        assert_eq!(
            events[0]
                .raw
                .as_ref()
                .and_then(|raw| raw.get("tokenUsage"))
                .and_then(|usage| usage.get("last"))
                .and_then(|last| last.get("totalTokens"))
                .and_then(Value::as_i64),
            Some(20429),
        );
    }

    #[test]
    fn app_server_maps_context_compaction_items() {
        let mut streamed = HashSet::new();
        let started = map_app_server_notification(
            "item/started",
            &serde_json::json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": { "id": "compact-1", "type": "contextCompaction" }
            }),
            "run-1",
            "conv-1",
            &mut streamed,
        );
        let completed = map_app_server_notification(
            "item/completed",
            &serde_json::json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": { "id": "compact-1", "type": "contextCompaction" }
            }),
            "run-1",
            "conv-1",
            &mut streamed,
        );

        assert_eq!(started.len(), 1);
        assert_eq!(started[0].event_type, "tool_started");
        assert_eq!(started[0].title.as_deref(), Some("context_compaction"));
        assert_eq!(completed.len(), 1);
        assert_eq!(completed[0].event_type, "context_compacted");
        assert_eq!(completed[0].item_id.as_deref(), Some("compact-1"));
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
    fn app_server_preserves_file_change_details() {
        let mut streamed = HashSet::new();
        let changes = serde_json::json!([
            { "path": "/tmp/src/App.tsx", "kind": "update" },
            { "path": "/tmp/src/styles.css", "kind": "update" }
        ]);
        let events = map_app_server_notification(
            "item/completed",
            &serde_json::json!({
                "item": {
                    "id": "edit-1",
                    "type": "fileChange",
                    "status": "completed",
                    "changes": changes
                }
            }),
            "run-1",
            "conv-1",
            &mut streamed,
        );

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "tool_completed");
        assert_eq!(events[0].title.as_deref(), Some("fileChange"));
        let rendered_changes: Value =
            serde_json::from_str(events[0].text.as_deref().expect("file change details")).unwrap();
        assert_eq!(rendered_changes, changes);
    }

    #[test]
    fn app_server_maps_native_image_generation_completion() {
        let mut streamed = HashSet::new();
        let events = map_app_server_notification(
            "item/completed",
            &serde_json::json!({
                "threadId": "thread-1",
                "turnId": "turn-1",
                "item": {
                    "id": "image-generation-1",
                    "type": "imageGeneration",
                    "status": "completed",
                    "revisedPrompt": "one orange cat",
                    "result": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
                    "savedPath": "/tmp/generated_images/image-generation-1.png"
                }
            }),
            "run-1",
            "conv-1",
            &mut streamed,
        );

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].event_type, "tool_completed");
        assert_eq!(events[0].item_id.as_deref(), Some("image-generation-1"));
        assert_eq!(events[0].title.as_deref(), Some("imageGeneration"));
        assert_eq!(
            events[0].text.as_deref(),
            Some("/tmp/generated_images/image-generation-1.png")
        );
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

    #[tokio::test]
    async fn await_response_answers_server_requests_before_target_response() {
        let input = [
            r#"{"jsonrpc":"2.0","id":"approval-1","method":"elicitation/create","params":{"message":"Continue?"}}"#,
            r#"{"jsonrpc":"2.0","id":1,"result":{"ok":true}}"#,
        ]
        .join("\n")
            + "\n";
        let mut reader =
            tokio::io::BufReader::new(std::io::Cursor::new(input.into_bytes())).lines();
        let (mut writer, mut written) = tokio::io::duplex(1024);

        let response = await_response(&mut writer, &mut reader, 1).await.unwrap();
        drop(writer);

        let mut replies = String::new();
        written.read_to_string(&mut replies).await.unwrap();

        assert_eq!(
            response.get("result").and_then(|value| value.get("ok")),
            Some(&Value::Bool(true)),
        );
        assert!(replies.contains(r#""id":"approval-1""#));
        assert!(replies.contains(r#""approved":true"#));
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
            context_window_tokens: Some(64_000),
        };

        let args = codex_app_server_args(Some(&provider), Some("fast"));

        assert_eq!(
            args,
            vec![
                "app-server",
                "--config",
                "service_tier=\"fast\"",
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
                "--config",
                "model_context_window=64000",
                "--config",
                "model_auto_compact_token_limit=48000",
            ]
        );
    }

    #[test]
    fn app_server_args_fall_back_to_openai_without_provider_config() {
        assert_eq!(
            codex_app_server_args(None, None),
            vec!["app-server".to_string()]
        );
        assert_eq!(
            codex_app_server_args(None, Some("fast")),
            vec![
                "app-server".to_string(),
                "--config".to_string(),
                "service_tier=\"fast\"".to_string(),
            ]
        );
    }

    #[test]
    fn creates_unique_project_folders_from_sanitized_names() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-project-folder-test-{}",
            generate_run_id()
        ));
        fs::create_dir_all(root.join("Research Plan")).unwrap();

        let duplicate = create_unique_project_folder(&root, "Research Plan").unwrap();
        let sanitized = create_unique_project_folder(&root, " /Risk:Plan? ").unwrap();
        let fallback = create_unique_project_folder(&root, "///").unwrap();

        assert_eq!(duplicate.file_name().unwrap(), "Research Plan 2");
        assert_eq!(sanitized.file_name().unwrap(), "Risk-Plan");
        assert_eq!(fallback.file_name().unwrap(), "Research Topic");
        assert!(duplicate.is_dir());
        assert!(sanitized.is_dir());
        assert!(fallback.is_dir());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saves_clipboard_attachments_with_safe_unique_paths() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-clipboard-attachment-test-{}",
            generate_run_id()
        ));

        let first = save_clipboard_attachment(&root, "../chart.png", "iVBORw==").unwrap();
        let second = save_clipboard_attachment(&root, "../chart.png", "bm90ZXM=").unwrap();

        assert_eq!(fs::read(&first).unwrap(), vec![137, 80, 78, 71]);
        assert_eq!(fs::read(&second).unwrap(), b"notes");
        assert_ne!(first, second);
        assert_eq!(first.parent(), Some(root.as_path()));
        assert!(first
            .file_name()
            .unwrap()
            .to_string_lossy()
            .ends_with("-chart.png"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lists_local_directories_before_files_in_name_order() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-directory-list-test-{}",
            generate_run_id()
        ));
        fs::create_dir_all(root.join("Beta")).unwrap();
        fs::create_dir_all(root.join("alpha")).unwrap();
        fs::write(root.join("zeta.md"), "research").unwrap();
        fs::write(root.join("Notes.txt"), "notes").unwrap();

        let entries = list_local_directory_entries(&root).unwrap();

        assert_eq!(
            entries
                .iter()
                .map(|entry| (entry.name.as_str(), entry.is_directory))
                .collect::<Vec<_>>(),
            vec![
                ("alpha", true),
                ("Beta", true),
                ("Notes.txt", false),
                ("zeta.md", false),
            ]
        );
        assert_eq!(entries[2].bytes, 5);
        assert_eq!(entries[3].bytes, 8);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn renames_only_alpha_studio_project_folders() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-project-folder-rename-test-{}",
            generate_run_id()
        ));
        let external_root = std::env::temp_dir().join(format!(
            "alpha-studio-external-folder-test-{}",
            generate_run_id()
        ));
        let source = root.join("新研究主题 1");
        let external = external_root.join("手动资料");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&external).unwrap();

        let renamed = rename_project_folder(&root, &source.to_string_lossy(), "投资研究").unwrap();
        let unchanged =
            rename_project_folder(&root, &external.to_string_lossy(), "不应改名").unwrap();

        assert_eq!(renamed.file_name().unwrap(), "投资研究");
        assert!(renamed.is_dir());
        assert!(!source.exists());
        assert_eq!(unchanged, external);
        assert!(unchanged.is_dir());

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(external_root);
    }

    #[test]
    fn prepares_private_codex_home_without_copying_user_history_or_authorization() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-codex-home-test-{}",
            generate_run_id()
        ));
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(source.join("sessions")).unwrap();
        fs::create_dir_all(source.join("skills").join("custom-skill")).unwrap();
        fs::write(source.join("auth.json"), "{}").unwrap();
        fs::write(source.join("config.toml"), "model = \"gpt-5.5\"\n").unwrap();
        fs::write(source.join("installation_id"), "user-installation").unwrap();
        fs::write(source.join("session_index.jsonl"), "{}\n").unwrap();
        fs::write(
            source.join("skills").join("custom-skill").join("SKILL.md"),
            "---\nname: custom-skill\n---\n",
        )
        .unwrap();

        prepare_alpha_studio_codex_home_from(&source, &target, false).unwrap();

        assert!(!target.join("auth.json").exists());
        assert!(target.join("config.toml").exists());
        assert!(!target.join("installation_id").exists());
        assert!(!target.join("session_index.jsonl").exists());
        assert!(!target.join("sessions").exists());
        assert!(target.join("skills").is_dir());
        assert!(!fs::symlink_metadata(target.join("skills"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(target
            .join("skills")
            .join("custom-skill")
            .join("SKILL.md")
            .exists());
        let builtin_skill_roots = fs::read_dir(target.join("skills"))
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry.path().is_dir()
                    && entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(builtin_skills::RESERVED_SKILL_PREFIX)
            })
            .map(|entry| entry.path())
            .collect::<Vec<_>>();
        assert!(!builtin_skill_roots.is_empty());
        assert!(builtin_skill_roots
            .iter()
            .all(|skill_root| skill_root.join("SKILL.md").is_file()));

        let config = fs::read_to_string(target.join("config.toml")).unwrap();
        assert!(config.contains("model = \"gpt-5.5\""));
        assert!(config.contains("[agents]"));
        assert!(config.contains("max_threads = 9"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reads_codex_account_email_from_the_private_auth_token() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-codex-identity-test-{}",
            generate_run_id()
        ));
        fs::create_dir_all(&root).unwrap();
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(br#"{"email":"managed@example.com","sub":"user_1"}"#);
        fs::write(
            root.join("auth.json"),
            json!({
                "auth_mode": "chatgpt",
                "tokens": { "id_token": format!("header.{payload}.signature") }
            })
            .to_string(),
        )
        .unwrap();

        assert_eq!(
            codex_account_email(&root).as_deref(),
            Some("managed@example.com")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ensure_agents_config_section_respects_existing_user_settings() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-agents-config-test-{}",
            generate_run_id()
        ));
        fs::create_dir_all(&root).unwrap();
        let config_path = root.join("config.toml");

        // Missing file: created with the [agents] section.
        ensure_agents_config_section(&config_path).unwrap();
        let created = fs::read_to_string(&config_path).unwrap();
        assert!(created.contains("[agents]"));
        assert!(created.contains("max_threads = 9"));

        // Re-running must not duplicate the section.
        ensure_agents_config_section(&config_path).unwrap();
        let unchanged = fs::read_to_string(&config_path).unwrap();
        assert_eq!(unchanged.matches("[agents]").count(), 1);

        // A user-provided [agents] table is left untouched.
        fs::write(&config_path, "[agents]\nmax_threads = 3\n").unwrap();
        ensure_agents_config_section(&config_path).unwrap();
        assert_eq!(
            fs::read_to_string(&config_path).unwrap(),
            "[agents]\nmax_threads = 3\n"
        );

        let _ = fs::remove_dir_all(root);
    }

    fn coworker_definition(id: &str) -> CoworkerAgentDefinition {
        CoworkerAgentDefinition {
            id: id.to_string(),
            display_name: format!("① {id}"),
            description: "主线判断与龙头跟踪".to_string(),
            instructions: "你是「主线交易官」。\n结论先行,附\"关键依据\"与 C:\\path 反斜杠。"
                .to_string(),
            model: None,
            reasoning_effort: Some("high".to_string()),
            sandbox_mode: Some("read-only".to_string()),
        }
    }

    #[test]
    fn sync_coworker_agents_rewrites_the_agents_directory() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-coworker-sync-test-{}",
            generate_run_id()
        ));
        let agents_dir = root.join("agents");
        fs::create_dir_all(&agents_dir).unwrap();
        fs::write(agents_dir.join("stale.toml"), "name = \"stale\"\n").unwrap();

        let written = sync_coworker_agents(
            &agents_dir,
            &[coworker_definition("mainline"), coworker_definition("risk")],
        )
        .unwrap();

        assert_eq!(written, 2);
        assert!(!agents_dir.join("stale.toml").exists());
        assert!(agents_dir.join("risk.toml").exists());

        let toml = fs::read_to_string(agents_dir.join("mainline.toml")).unwrap();
        assert!(toml.contains("name = \"mainline\""));
        assert!(toml.contains("description = \"主线判断与龙头跟踪\""));
        assert!(toml.contains("developer_instructions = \"你是「主线交易官」。\\n结论先行,附\\\"关键依据\\\"与 C:\\\\path 反斜杠。\""));
        assert!(toml.contains("model_reasoning_effort = \"high\""));
        assert!(toml.contains("sandbox_mode = \"read-only\""));
        assert!(!toml.contains("\nmodel = "));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sync_coworker_agents_rejects_unsafe_agent_ids() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-coworker-id-test-{}",
            generate_run_id()
        ));
        let agents_dir = root.join("agents");

        for bad_id in ["", "../escape", "值A", "a b"] {
            let error =
                sync_coworker_agents(&agents_dir, &[coworker_definition(bad_id)]).unwrap_err();
            assert!(error.contains("Invalid coworker agent id"), "{error}");
        }
        assert!(is_valid_coworker_agent_id("value_a"));
        assert!(is_valid_coworker_agent_id("pm-deputy"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn toml_basic_string_escapes_control_and_quote_characters() {
        assert_eq!(toml_basic_string("plain"), "\"plain\"");
        assert_eq!(
            toml_basic_string("a\"b\\c\nd\te\r"),
            "\"a\\\"b\\\\c\\nd\\te\""
        );
        assert_eq!(toml_basic_string("bell\u{7}"), "\"bell\\u0007\"");
    }

    #[test]
    fn preserves_private_codex_authorization_after_explicit_device_authorization() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-codex-home-test-{}",
            generate_run_id()
        ));
        let source = root.join("source");
        let target = root.join("target");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&target).unwrap();
        fs::write(source.join("auth.json"), "{\"source\":true}").unwrap();
        fs::write(source.join("config.toml"), "model = \"gpt-5.5\"\n").unwrap();
        fs::write(
            target.join(CODEX_DEVICE_AUTHORIZATION_MARKER),
            "authorized\n",
        )
        .unwrap();
        fs::write(target.join("auth.json"), "{\"private\":true}").unwrap();

        prepare_alpha_studio_codex_home_from(&source, &target, true).unwrap();

        assert_eq!(
            fs::read_to_string(target.join("auth.json")).unwrap(),
            "{\"private\":true}"
        );
        assert!(target.join("config.toml").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn revokes_private_codex_authorization_without_removing_config() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-codex-home-test-{}",
            generate_run_id()
        ));
        let target = root.join("target");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("auth.json"), "{\"private\":true}").unwrap();
        fs::write(target.join("installation_id"), "private-installation").unwrap();
        fs::write(
            target.join(CODEX_DEVICE_AUTHORIZATION_MARKER),
            "authorized\n",
        )
        .unwrap();
        fs::write(target.join("config.toml"), "model = \"gpt-5.5\"\n").unwrap();

        revoke_alpha_studio_codex_authorization_from(&target).unwrap();

        assert!(!target.join("auth.json").exists());
        assert!(!target.join("installation_id").exists());
        assert!(!target.join(CODEX_DEVICE_AUTHORIZATION_MARKER).exists());
        assert!(target.join("config.toml").exists());

        let _ = fs::remove_dir_all(root);
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
    fn adapter_attaches_reasoning_to_following_assistant_message() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "创建一个提醒" }] },
                { "type": "reasoning", "summary": [{ "type": "summary_text", "text": "需要先判断是否有自动化工具" }] },
                { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "好的，我先看看当前环境。" }] }
            ],
            "reasoning": { "effort": "high" }
        });

        let chat = build_chat_completion_request(&request, true, &HashMap::new()).unwrap();
        let messages = chat.get("messages").and_then(Value::as_array).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
            .unwrap();

        assert_eq!(
            assistant.get("reasoning_content").and_then(Value::as_str),
            Some("需要先判断是否有自动化工具")
        );
    }

    #[test]
    fn adapter_adds_fallback_reasoning_for_plain_assistant_history_in_thinking_mode() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "创建一个提醒" }] },
                { "type": "message", "role": "assistant", "content": [{ "type": "output_text", "text": "好的，我先看看当前环境。" }] }
            ],
            "reasoning": { "effort": "high" }
        });

        let chat = build_chat_completion_request(&request, true, &HashMap::new()).unwrap();
        let messages = chat.get("messages").and_then(Value::as_array).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.get("role").and_then(Value::as_str) == Some("assistant"))
            .unwrap();

        assert_eq!(
            assistant.get("reasoning_content").and_then(Value::as_str),
            Some(FALLBACK_REASONING_CONTENT)
        );
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
    fn adapter_restores_cached_reasoning_by_function_signature() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "查一下项目结构" }] },
                { "type": "function_call", "id": "different_response_item", "call_id": "different_call_id", "name": "exec_command", "arguments": "{\"cmd\":\"find . -maxdepth 2\"}" },
                { "type": "function_call_output", "call_id": "different_call_id", "output": "package.json" }
            ],
            "tools": [
                { "type": "function", "name": "exec_command", "description": "run", "parameters": { "type": "object" } }
            ],
            "reasoning": { "effort": "high" }
        });
        let reasoning_by_call_id = HashMap::from([(
            "fn:exec_command:{\"cmd\":\"find . -maxdepth 2\"}".to_string(),
            "需要先读取文件列表".to_string(),
        )]);

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
    fn adapter_adds_fallback_reasoning_for_thinking_tool_call_history() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "创建一个提醒" }] },
                { "type": "function_call", "call_id": "call_1", "name": "automation_update", "arguments": "{\"mode\":\"create\"}" },
                { "type": "function_call_output", "call_id": "call_1", "output": "{\"ok\":true}" }
            ],
            "tools": [
                { "type": "function", "name": "automation_update", "description": "schedule", "parameters": { "type": "object" } }
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
            Some(FALLBACK_REASONING_CONTENT)
        );
    }

    #[test]
    fn adapter_does_not_add_fallback_reasoning_when_thinking_is_disabled() {
        let request = serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": [
                { "type": "message", "role": "user", "content": [{ "type": "input_text", "text": "创建一个提醒" }] },
                { "type": "function_call", "call_id": "call_1", "name": "automation_update", "arguments": "{\"mode\":\"create\"}" },
                { "type": "function_call_output", "call_id": "call_1", "output": "{\"ok\":true}" }
            ],
            "tools": [
                { "type": "function", "name": "automation_update", "description": "schedule", "parameters": { "type": "object" } }
            ],
            "reasoning": { "effort": "high" }
        });

        let chat = build_chat_completion_request(&request, false, &HashMap::new()).unwrap();
        let messages = chat.get("messages").and_then(Value::as_array).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.get("tool_calls").is_some())
            .unwrap();

        assert!(assistant.get("reasoning_content").is_none());
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
    fn adapter_caches_reasoning_field_by_function_signature() {
        let state = ChatAdapterState {
            conversation_id: "conv-1".to_string(),
            reasoning_by_conversation: Arc::new(StdMutex::new(HashMap::new())),
        };
        let response = serde_json::json!({
            "id": "chatcmpl_test",
            "choices": [{
                "message": {
                    "role": "assistant",
                    "reasoning": "需要先读取文件列表",
                    "content": "",
                    "tool_calls": [{
                        "type": "function",
                        "function": { "name": "exec_command", "arguments": "{\"cmd\":\"find . -maxdepth 2\"}" }
                    }]
                }
            }]
        });

        remember_chat_reasoning_for_tool_calls(&state, &response);

        let stored = adapter_reasoning_snapshot(&state);
        assert_eq!(
            stored
                .get("fn:exec_command:{\"cmd\":\"find . -maxdepth 2\"}")
                .map(String::as_str),
            Some("需要先读取文件列表")
        );
    }

    #[test]
    fn adapter_reads_reasoning_field_from_chat_completion() {
        let chat = serde_json::json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "reasoning": "先分析问题",
                    "content": "hello"
                }
            }]
        });

        let message = first_chat_choice_message(&chat).unwrap();

        assert_eq!(chat_message_reasoning_content(message), "先分析问题");
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
        assert!(!adapter_reasoning_snapshot(&second).contains_key("call_1"));
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
            provider_context_window_tokens: Some(64_000),
            provider_thinking_enabled: Some(provider_wire_api == Some("chat")),
            reasoning_effort: None,
            service_tier: None,
            sandbox_mode: None,
            developer_instructions: None,
            selected_skill: None,
            attachments: None,
        }
    }

    #[test]
    fn finds_native_skill_from_codex_skills_list_response() {
        let response = json!({
            "data": [
                {
                    "cwd": "/repo",
                    "errors": [],
                    "skills": [
                        {
                            "name": "browser:control-in-app-browser",
                            "description": "Control the in-app browser.",
                            "path": "/Users/geb/.codex/plugins/cache/openai-bundled/browser/skills/control-in-app-browser/SKILL.md",
                            "scope": "plugin",
                            "enabled": true
                        },
                        {
                            "name": "chrome",
                            "description": "Disabled skill should not match.",
                            "path": "/Users/geb/.codex/skills/chrome/SKILL.md",
                            "scope": "user",
                            "enabled": false
                        }
                    ]
                }
            ]
        });
        let selection = CodexSelectedSkill {
            id: "browser".to_string(),
            title: "Browser".to_string(),
            _description: None,
        };

        let native = find_native_skill_input(&response, &selection).expect("native skill");

        assert_eq!(native.name, "browser:control-in-app-browser");
        assert!(native.path.ends_with("/control-in-app-browser/SKILL.md"));
    }

    #[test]
    fn registers_the_unified_runtime_skills_root_before_workspace_skills() {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-runtime-skill-roots-test-{}",
            generate_run_id()
        ));
        let runtime_root = root.join("private").join("skills");
        let workspace_root = root.join("workspace");
        fs::create_dir_all(&runtime_root).unwrap();
        fs::create_dir_all(workspace_root.join("skills")).unwrap();

        let roots = runtime_skill_extra_roots(
            &workspace_root.to_string_lossy(),
            &runtime_root.to_string_lossy(),
        );

        assert_eq!(roots.len(), 2);
        assert_eq!(Path::new(&roots[0]), runtime_root);
        assert_eq!(Path::new(&roots[1]), workspace_root.join("skills"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn builds_codex_native_turn_input_for_skill_and_attachments() {
        let attachments = vec![
            CodexChatAttachment {
                name: "chart.png".to_string(),
                kind: "image".to_string(),
                path: Some("/tmp/chart.png".to_string()),
            },
            CodexChatAttachment {
                name: "notes.md".to_string(),
                kind: "file".to_string(),
                path: Some("/tmp/notes.md".to_string()),
            },
            CodexChatAttachment {
                name: "research".to_string(),
                kind: "directory".to_string(),
                path: Some("/tmp/research".to_string()),
            },
        ];
        let skill = NativeSkillInput {
            name: "imagegen".to_string(),
            path: "/Users/geb/.codex/skills/.system/imagegen/SKILL.md".to_string(),
        };

        let input = build_turn_input("处理附件", &attachments, Some(&skill));

        assert_eq!(input[0].get("type").and_then(Value::as_str), Some("skill"));
        assert_eq!(
            input[0].get("name").and_then(Value::as_str),
            Some("imagegen")
        );
        assert_eq!(input[1].get("type").and_then(Value::as_str), Some("text"));
        assert_eq!(
            input[2].get("type").and_then(Value::as_str),
            Some("localImage")
        );
        assert_eq!(
            input[2].get("path").and_then(Value::as_str),
            Some("/tmp/chart.png")
        );
        assert_eq!(
            input[3].get("type").and_then(Value::as_str),
            Some("mention")
        );
        assert_eq!(
            input[3].get("path").and_then(Value::as_str),
            Some("/tmp/notes.md")
        );
        assert_eq!(
            input[4].get("type").and_then(Value::as_str),
            Some("mention")
        );
        assert_eq!(
            input[4].get("path").and_then(Value::as_str),
            Some("/tmp/research")
        );
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

    #[test]
    fn validates_native_browser_labels_and_urls() {
        assert_eq!(
            browser_webview_label("dock-12").as_deref(),
            Ok("browser-dock-12")
        );
        assert!(browser_webview_label("../main").is_err());
        assert!(browser_webview_label("").is_err());

        assert_eq!(
            browser_webview_url("https://example.com/path")
                .expect("https URL")
                .as_str(),
            "https://example.com/path",
        );
        assert!(browser_webview_url("file:///tmp/report.pdf").is_err());
        assert!(browser_webview_url("javascript:alert(1)").is_err());
    }
}
