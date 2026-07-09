use chrono::{Datelike, Utc};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const CURRENT_SCHEMA_VERSION: i64 = 1;
const DB_FILE_NAME: &str = "alpha-studio.sqlite3";

#[derive(Debug, Clone)]
struct StorePaths {
    data_dir: PathBuf,
    db_path: PathBuf,
    backup_dir: PathBuf,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreInfo {
    db_path: String,
    backup_dir: String,
    schema_version: i64,
    has_data: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreLoadResult {
    db_path: String,
    backup_dir: String,
    schema_version: i64,
    chat: Option<Value>,
    research: Option<Value>,
    premarket_theme_runs: Vec<Value>,
    automation_tasks: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreCommitRequest {
    chat: Option<Value>,
    research: Option<Value>,
    premarket_theme_runs: Option<Vec<Value>>,
    automation_tasks: Option<Vec<Value>>,
    audit: Option<LocalAuditInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAuditInput {
    domain: String,
    action: String,
    entity_id: Option<String>,
    payload: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreImportLegacyRequest {
    chat: Option<Value>,
    research: Option<Value>,
    premarket_theme_runs: Option<Vec<Value>>,
    automation_tasks: Option<Vec<Value>>,
    source_keys: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreBackupResult {
    path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalStoreExportResult {
    exported_at: String,
    schema_version: i64,
    db_path: String,
    chat: Option<Value>,
    research: Option<Value>,
    premarket_theme_runs: Vec<Value>,
    automation_tasks: Vec<Value>,
    audit_events: Vec<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketCacheGetRequest {
    source: String,
    scope: String,
    cache_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketCachePutRequest {
    source: String,
    scope: String,
    cache_key: String,
    code: Option<String>,
    universe: Option<Vec<String>>,
    params_hash: Option<String>,
    raw_payload: Option<Value>,
    normalized_payload: Option<Value>,
    trade_date: Option<String>,
    as_of: Option<String>,
    fetched_at: String,
    expires_at: String,
    status: String,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketCacheEntry {
    source: String,
    scope: String,
    cache_key: String,
    code: Option<String>,
    universe: Option<Vec<String>>,
    params_hash: Option<String>,
    raw_payload: Option<Value>,
    normalized_payload: Option<Value>,
    trade_date: Option<String>,
    as_of: Option<String>,
    fetched_at: String,
    expires_at: String,
    status: String,
    error: Option<String>,
    updated_at: String,
}

#[tauri::command]
pub fn local_store_info(app: AppHandle) -> Result<LocalStoreInfo, String> {
    let (paths, conn) = open_store_for_app(&app)?;
    Ok(LocalStoreInfo {
        db_path: path_string(&paths.db_path),
        backup_dir: path_string(&paths.backup_dir),
        schema_version: schema_version(&conn)?,
        has_data: has_data(&conn)?,
    })
}

#[tauri::command]
pub fn local_store_load(app: AppHandle) -> Result<LocalStoreLoadResult, String> {
    let (paths, conn) = open_store_for_app(&app)?;
    load_snapshot(&paths, &conn)
}

#[tauri::command]
pub fn local_store_commit(app: AppHandle, request: LocalStoreCommitRequest) -> Result<(), String> {
    let (_, mut conn) = open_store_for_app(&app)?;
    commit_snapshot(&mut conn, request)
}

#[tauri::command]
pub fn local_store_import_legacy(
    app: AppHandle,
    request: LocalStoreImportLegacyRequest,
) -> Result<LocalStoreLoadResult, String> {
    let (paths, mut conn) = open_store_for_app(&app)?;
    import_legacy(&mut conn, request)?;
    load_snapshot(&paths, &conn)
}

#[tauri::command]
pub fn local_store_export(app: AppHandle) -> Result<LocalStoreExportResult, String> {
    let (paths, conn) = open_store_for_app(&app)?;
    let loaded = load_snapshot(&paths, &conn)?;
    Ok(LocalStoreExportResult {
        exported_at: now_rfc3339(),
        schema_version: loaded.schema_version,
        db_path: loaded.db_path,
        chat: loaded.chat,
        research: loaded.research,
        premarket_theme_runs: loaded.premarket_theme_runs,
        automation_tasks: loaded.automation_tasks,
        audit_events: load_recent_audit_events(&conn, 500)?,
    })
}

#[tauri::command]
pub fn local_store_backup_now(app: AppHandle) -> Result<LocalStoreBackupResult, String> {
    let (paths, conn) = open_store_for_app(&app)?;
    let path = backup_database(&conn, &paths, "manual")?;
    prune_backups(&paths)?;
    Ok(LocalStoreBackupResult {
        path: path_string(&path),
    })
}

#[tauri::command]
pub fn market_cache_get(
    app: AppHandle,
    request: MarketCacheGetRequest,
) -> Result<Option<MarketCacheEntry>, String> {
    let (_, conn) = open_store_for_app(&app)?;
    load_market_cache_entry(&conn, &request.source, &request.scope, &request.cache_key)
}

#[tauri::command]
pub fn market_cache_put(app: AppHandle, request: MarketCachePutRequest) -> Result<(), String> {
    let (_, conn) = open_store_for_app(&app)?;
    save_market_cache_entry(&conn, request)
}

fn app_store_paths(app: &AppHandle) -> Result<StorePaths, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve Alpha Studio app data directory: {e}"))?;
    store_paths_from_dir(data_dir)
}

fn store_paths_from_dir(data_dir: PathBuf) -> Result<StorePaths, String> {
    let backup_dir = data_dir.join("backups");
    Ok(StorePaths {
        db_path: data_dir.join(DB_FILE_NAME),
        data_dir,
        backup_dir,
    })
}

fn open_store_for_app(app: &AppHandle) -> Result<(StorePaths, Connection), String> {
    let paths = app_store_paths(app)?;
    let conn = open_store_at_paths(&paths)?;
    Ok((paths, conn))
}

fn open_store_at_paths(paths: &StorePaths) -> Result<Connection, String> {
    fs::create_dir_all(&paths.data_dir)
        .map_err(|e| format!("Failed to create Alpha Studio data directory: {e}"))?;
    fs::create_dir_all(&paths.backup_dir)
        .map_err(|e| format!("Failed to create Alpha Studio backup directory: {e}"))?;

    let existed = paths.db_path.exists();
    let conn = Connection::open(&paths.db_path)
        .map_err(|e| format!("Failed to open Alpha Studio local database: {e}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|e| format!("Failed to configure SQLite busy timeout: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("Failed to enable SQLite WAL mode: {e}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| format!("Failed to enable SQLite foreign keys: {e}"))?;

    let version = schema_version(&conn)?;
    if existed && version > 0 && version < CURRENT_SCHEMA_VERSION {
        let label = format!("pre-migration-v{version}-to-v{CURRENT_SCHEMA_VERSION}");
        backup_database(&conn, paths, &label)?;
    }
    migrate(&conn, version)?;
    ensure_automatic_backups(&conn, paths)?;
    prune_backups(paths)?;
    Ok(conn)
}

fn migrate(conn: &Connection, version: i64) -> Result<(), String> {
    if version > CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Alpha Studio local database schema v{version} is newer than this app supports."
        ));
    }
    if version == CURRENT_SCHEMA_VERSION {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        begin;

        create table if not exists meta_kv (
          key text primary key,
          value text not null,
          updated_at text not null
        );

        create table if not exists projects (
          id text primary key,
          name text not null,
          cwd text not null default '',
          created_at integer not null,
          updated_at integer not null,
          pinned integer not null default 0,
          archived_at integer,
          deleted_at text,
          payload text not null
        );

        create table if not exists conversations (
          id text primary key,
          title text not null,
          cwd text not null default '',
          project_id text,
          created_at integer not null,
          updated_at integer not null,
          status text not null,
          run_id text,
          codex_thread_id text,
          pinned integer not null default 0,
          archived_at integer,
          deleted_at text,
          payload text not null
        );

        create table if not exists messages (
          id text primary key,
          conversation_id text not null,
          role text not null,
          timestamp integer not null,
          is_streaming integer not null default 0,
          deleted_at text,
          superseded_at text,
          payload text not null
        );

        create table if not exists queued_messages (
          id text primary key,
          conversation_id text not null,
          queue_kind text not null,
          created_at integer not null,
          deleted_at text,
          payload text not null
        );

        create table if not exists conversation_events (
          id text primary key,
          conversation_id text not null,
          event_type text not null,
          payload text not null,
          created_at text not null
        );

        create table if not exists research_accounts (
          id text primary key,
          cash real not null,
          net_deposits real not null,
          updated_at text not null,
          payload text not null
        );

        create table if not exists research_cash_ledger (
          id text primary key,
          kind text not null,
          amount real not null,
          created_at integer not null,
          payload text not null
        );

        create table if not exists research_holdings (
          code text primary key,
          quantity real not null,
          avg_cost real not null,
          opened_at integer not null,
          deleted_at text,
          payload text not null
        );

        create table if not exists research_watchlist (
          code text primary key,
          sort_order integer not null,
          deleted_at text
        );

        create table if not exists research_portfolios (
          id text primary key,
          name text not null,
          note text not null,
          created_at integer not null,
          deleted_at text,
          payload text not null
        );

        create table if not exists research_portfolio_items (
          portfolio_id text not null,
          code text not null,
          sort_order integer not null,
          primary key (portfolio_id, code)
        );

        create table if not exists research_custom_securities (
          code text primary key,
          name text not null,
          sector text,
          base_price real,
          deleted_at text,
          payload text not null
        );

        create table if not exists research_trades (
          id text primary key,
          kind text not null,
          code text,
          name text,
          price real,
          quantity real,
          amount real not null,
          created_at integer not null,
          deleted_at text,
          payload text not null
        );

        create table if not exists premarket_theme_runs (
          id text primary key,
          schema_name text not null,
          generated_at text,
          imported_at text,
          report_markdown text,
          deleted_at text,
          payload text not null
        );

        create table if not exists automation_tasks (
          id text primary key,
          title text not null,
          prompt text not null,
          schedule text not null,
          model text not null,
          created_at integer not null,
          deleted_at text,
          payload text not null
        );

        create table if not exists audit_events (
          id text primary key,
          domain text not null,
          action text not null,
          entity_id text,
          payload text not null,
          created_at text not null
        );

        create table if not exists legacy_imports (
          id text primary key,
          imported_at text not null,
          source_keys text not null,
          payload text not null
        );

        create table if not exists market_cache_entries (
          id text primary key,
          source text not null,
          scope text not null,
          cache_key text not null,
          code text,
          universe text,
          params_hash text,
          raw_payload text,
          normalized_payload text,
          trade_date text,
          as_of text,
          fetched_at text not null,
          expires_at text not null,
          status text not null,
          error text,
          updated_at text not null,
          unique (source, scope, cache_key)
        );

        create index if not exists idx_conversations_project on conversations(project_id);
        create index if not exists idx_messages_conversation on messages(conversation_id, timestamp);
        create index if not exists idx_audit_events_created on audit_events(created_at desc);
        create index if not exists idx_market_cache_lookup on market_cache_entries(source, scope, cache_key);

        pragma user_version = 1;
        commit;
        "#,
    )
    .map_err(|e| format!("Failed to migrate Alpha Studio local database: {e}"))?;
    Ok(())
}

fn schema_version(conn: &Connection) -> Result<i64, String> {
    conn.query_row("pragma user_version", [], |row| row.get(0))
        .map_err(|e| format!("Failed to read local database schema version: {e}"))
}

fn has_data(conn: &Connection) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            r#"
            select
              (select count(*) from meta_kv)
              + (select count(*) from conversations)
              + (select count(*) from research_trades)
              + (select count(*) from premarket_theme_runs)
              + (select count(*) from automation_tasks)
            "#,
            [],
            |row| row.get(0),
        )
        .map_err(|e| format!("Failed to inspect local database contents: {e}"))?;
    Ok(count > 0)
}

fn load_snapshot(paths: &StorePaths, conn: &Connection) -> Result<LocalStoreLoadResult, String> {
    Ok(LocalStoreLoadResult {
        db_path: path_string(&paths.db_path),
        backup_dir: path_string(&paths.backup_dir),
        schema_version: schema_version(conn)?,
        chat: load_meta_json(conn, "chat_state")?,
        research: load_meta_json(conn, "research_state")?,
        premarket_theme_runs: load_payload_rows(
            conn,
            "select payload from premarket_theme_runs where deleted_at is null order by imported_at desc, generated_at desc",
        )?,
        automation_tasks: load_payload_rows(
            conn,
            "select payload from automation_tasks where deleted_at is null order by created_at desc",
        )?,
    })
}

fn commit_snapshot(conn: &mut Connection, request: LocalStoreCommitRequest) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start local store transaction: {e}"))?;
    if let Some(chat) = request.chat {
        save_chat_snapshot(&tx, &chat)?;
    }
    if let Some(research) = request.research {
        save_research_snapshot(&tx, &research)?;
    }
    if let Some(runs) = request.premarket_theme_runs {
        save_premarket_theme_runs(&tx, &runs)?;
    }
    if let Some(tasks) = request.automation_tasks {
        save_automation_tasks(&tx, &tasks)?;
    }
    if let Some(audit) = request.audit {
        write_audit(
            &tx,
            &audit.domain,
            &audit.action,
            audit.entity_id.as_deref(),
            audit.payload.as_ref().unwrap_or(&Value::Null),
        )?;
    }
    tx.commit()
        .map_err(|e| format!("Failed to commit local store transaction: {e}"))
}

fn import_legacy(
    conn: &mut Connection,
    request: LocalStoreImportLegacyRequest,
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start legacy import transaction: {e}"))?;
    let mut imported_domains = Vec::new();
    if let Some(chat) = request.chat.as_ref() {
        save_chat_snapshot(&tx, chat)?;
        imported_domains.push("chat");
    }
    if let Some(research) = request.research.as_ref() {
        save_research_snapshot(&tx, research)?;
        imported_domains.push("research");
    }
    if let Some(runs) = request.premarket_theme_runs.as_ref() {
        save_premarket_theme_runs(&tx, runs)?;
        imported_domains.push("premarket_theme_runs");
    }
    if let Some(tasks) = request.automation_tasks.as_ref() {
        save_automation_tasks(&tx, tasks)?;
        imported_domains.push("automation_tasks");
    }
    tx.execute(
        "insert into legacy_imports (id, imported_at, source_keys, payload) values (?1, ?2, ?3, ?4)",
        params![
            generated_id("legacy"),
            now_rfc3339(),
            json_string(&request.source_keys)?,
            json_string(&json!({ "domains": imported_domains }))?,
        ],
    )
    .map_err(|e| format!("Failed to record legacy import: {e}"))?;
    write_audit(
        &tx,
        "local_store",
        "legacy.import",
        None,
        &json!({ "sourceKeys": request.source_keys, "domains": imported_domains }),
    )?;
    tx.commit()
        .map_err(|e| format!("Failed to commit legacy import: {e}"))
}

fn save_chat_snapshot(tx: &Transaction<'_>, chat: &Value) -> Result<(), String> {
    save_meta_json(tx, "chat_state", chat)?;
    save_projects(
        tx,
        chat.get("projects")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new()),
    )?;
    save_conversations(
        tx,
        chat.get("conversations")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new()),
    )?;
    write_audit(tx, "chat", "snapshot.commit", None, &json!({}))?;
    Ok(())
}

fn save_projects(tx: &Transaction<'_>, projects: &[Value]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = projects
        .iter()
        .filter_map(|project| string_field(project, "id"))
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "projects", &incoming, &now)?;
    for project in projects {
        let id = string_field(project, "id").unwrap_or_else(|| generated_id("proj"));
        tx.execute(
            r#"
            insert into projects (id, name, cwd, created_at, updated_at, pinned, archived_at, deleted_at, payload)
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, null, ?8)
            on conflict(id) do update set
              name = excluded.name,
              cwd = excluded.cwd,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              pinned = excluded.pinned,
              archived_at = excluded.archived_at,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                string_field(project, "name").unwrap_or_else(|| "未命名研究主题".to_string()),
                string_field(project, "cwd").unwrap_or_default(),
                i64_field(project, "createdAt").unwrap_or_else(now_millis),
                i64_field(project, "updatedAt").unwrap_or_else(now_millis),
                bool_field(project, "pinned") as i64,
                i64_field(project, "archivedAt"),
                json_string(project)?,
            ],
        )
        .map_err(|e| format!("Failed to save project: {e}"))?;
    }
    Ok(())
}

fn save_conversations(tx: &Transaction<'_>, conversations: &[Value]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = conversations
        .iter()
        .filter_map(|conversation| string_field(conversation, "id"))
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "conversations", &incoming, &now)?;
    for conversation in conversations {
        let id = string_field(conversation, "id").unwrap_or_else(|| generated_id("conv"));
        tx.execute(
            r#"
            insert into conversations (
              id, title, cwd, project_id, created_at, updated_at, status, run_id,
              codex_thread_id, pinned, archived_at, deleted_at, payload
            )
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, null, ?12)
            on conflict(id) do update set
              title = excluded.title,
              cwd = excluded.cwd,
              project_id = excluded.project_id,
              created_at = excluded.created_at,
              updated_at = excluded.updated_at,
              status = excluded.status,
              run_id = excluded.run_id,
              codex_thread_id = excluded.codex_thread_id,
              pinned = excluded.pinned,
              archived_at = excluded.archived_at,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                string_field(conversation, "title").unwrap_or_else(|| "新对话".to_string()),
                string_field(conversation, "cwd").unwrap_or_default(),
                string_field(conversation, "projectId"),
                i64_field(conversation, "createdAt").unwrap_or_else(now_millis),
                i64_field(conversation, "updatedAt").unwrap_or_else(now_millis),
                string_field(conversation, "status").unwrap_or_else(|| "idle".to_string()),
                string_field(conversation, "runId"),
                string_field(conversation, "codexThreadId"),
                bool_field(conversation, "pinned") as i64,
                i64_field(conversation, "archivedAt"),
                json_string(conversation)?,
            ],
        )
        .map_err(|e| format!("Failed to save conversation: {e}"))?;
        save_messages_for_conversation(
            tx,
            &id,
            conversation
                .get("messages")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new()),
        )?;
        save_queued_messages_for_conversation(
            tx,
            &id,
            "queued",
            conversation
                .get("queuedMessages")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new()),
        )?;
        save_queued_messages_for_conversation(
            tx,
            &id,
            "guided",
            conversation
                .get("guidedQueuedMessages")
                .and_then(Value::as_array)
                .unwrap_or(&Vec::new()),
        )?;
    }
    Ok(())
}

fn save_messages_for_conversation(
    tx: &Transaction<'_>,
    conversation_id: &str,
    messages: &[Value],
) -> Result<(), String> {
    let incoming = messages
        .iter()
        .filter_map(|message| string_field(message, "id"))
        .collect::<HashSet<_>>();
    let existing = active_child_ids(tx, "messages", "conversation_id", conversation_id)?;
    let now = now_rfc3339();
    for id in existing.difference(&incoming) {
        tx.execute(
            "update messages set superseded_at = coalesce(superseded_at, ?1) where id = ?2",
            params![now, id],
        )
        .map_err(|e| format!("Failed to supersede message: {e}"))?;
    }
    for message in messages {
        let id = string_field(message, "id").unwrap_or_else(|| generated_id("msg"));
        tx.execute(
            r#"
            insert into messages (id, conversation_id, role, timestamp, is_streaming, deleted_at, superseded_at, payload)
            values (?1, ?2, ?3, ?4, ?5, null, null, ?6)
            on conflict(id) do update set
              conversation_id = excluded.conversation_id,
              role = excluded.role,
              timestamp = excluded.timestamp,
              is_streaming = excluded.is_streaming,
              deleted_at = null,
              superseded_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                conversation_id,
                string_field(message, "role").unwrap_or_else(|| "assistant".to_string()),
                i64_field(message, "timestamp").unwrap_or_else(now_millis),
                bool_field(message, "isStreaming") as i64,
                json_string(message)?,
            ],
        )
        .map_err(|e| format!("Failed to save message: {e}"))?;
    }
    Ok(())
}

fn save_queued_messages_for_conversation(
    tx: &Transaction<'_>,
    conversation_id: &str,
    queue_kind: &str,
    queued: &[Value],
) -> Result<(), String> {
    tx.execute(
        "update queued_messages set deleted_at = ?1 where conversation_id = ?2 and queue_kind = ?3 and deleted_at is null",
        params![now_rfc3339(), conversation_id, queue_kind],
    )
    .map_err(|e| format!("Failed to mark queued messages stale: {e}"))?;
    for message in queued {
        let id = string_field(message, "id").unwrap_or_else(|| generated_id("queue"));
        tx.execute(
            r#"
            insert into queued_messages (id, conversation_id, queue_kind, created_at, deleted_at, payload)
            values (?1, ?2, ?3, ?4, null, ?5)
            on conflict(id) do update set
              conversation_id = excluded.conversation_id,
              queue_kind = excluded.queue_kind,
              created_at = excluded.created_at,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                conversation_id,
                queue_kind,
                i64_field(message, "createdAt").unwrap_or_else(now_millis),
                json_string(message)?,
            ],
        )
        .map_err(|e| format!("Failed to save queued message: {e}"))?;
    }
    Ok(())
}

fn save_research_snapshot(tx: &Transaction<'_>, research: &Value) -> Result<(), String> {
    save_meta_json(tx, "research_state", research)?;
    tx.execute(
        r#"
        insert into research_accounts (id, cash, net_deposits, updated_at, payload)
        values ('default', ?1, ?2, ?3, ?4)
        on conflict(id) do update set
          cash = excluded.cash,
          net_deposits = excluded.net_deposits,
          updated_at = excluded.updated_at,
          payload = excluded.payload
        "#,
        params![
            f64_field(research, "cash").unwrap_or(0.0),
            f64_field(research, "netDeposits").unwrap_or(0.0),
            now_rfc3339(),
            json_string(research)?,
        ],
    )
    .map_err(|e| format!("Failed to save research account: {e}"))?;
    save_research_holdings(
        tx,
        research
            .get("holdings")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new()),
    )?;
    save_research_watchlist(
        tx,
        research
            .get("watchlist")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new()),
    )?;
    save_research_portfolios(
        tx,
        research
            .get("portfolios")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new()),
    )?;
    save_research_trades(
        tx,
        research
            .get("trades")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new()),
    )?;
    save_custom_securities(
        tx,
        research
            .get("customSecurities")
            .and_then(Value::as_object)
            .map(|object| {
                object
                    .iter()
                    .map(|(code, payload)| (code.as_str(), payload))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
            .as_slice(),
    )?;
    write_audit(tx, "research", "snapshot.commit", None, &json!({}))?;
    Ok(())
}

fn save_research_holdings(tx: &Transaction<'_>, holdings: &[Value]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = holdings
        .iter()
        .filter_map(|holding| string_field(holding, "code"))
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "research_holdings", &incoming, &now)?;
    for holding in holdings {
        let code = string_field(holding, "code").unwrap_or_default();
        if code.is_empty() {
            continue;
        }
        tx.execute(
            r#"
            insert into research_holdings (code, quantity, avg_cost, opened_at, deleted_at, payload)
            values (?1, ?2, ?3, ?4, null, ?5)
            on conflict(code) do update set
              quantity = excluded.quantity,
              avg_cost = excluded.avg_cost,
              opened_at = excluded.opened_at,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                code,
                f64_field(holding, "quantity").unwrap_or(0.0),
                f64_field(holding, "avgCost").unwrap_or(0.0),
                i64_field(holding, "openedAt").unwrap_or_else(now_millis),
                json_string(holding)?,
            ],
        )
        .map_err(|e| format!("Failed to save research holding: {e}"))?;
    }
    Ok(())
}

fn save_research_watchlist(tx: &Transaction<'_>, watchlist: &[Value]) -> Result<(), String> {
    tx.execute(
        "update research_watchlist set deleted_at = ?1 where deleted_at is null",
        params![now_rfc3339()],
    )
    .map_err(|e| format!("Failed to mark watchlist stale: {e}"))?;
    for (index, code_value) in watchlist.iter().enumerate() {
        let code = code_value.as_str().unwrap_or_default().trim();
        if code.is_empty() {
            continue;
        }
        tx.execute(
            r#"
            insert into research_watchlist (code, sort_order, deleted_at)
            values (?1, ?2, null)
            on conflict(code) do update set sort_order = excluded.sort_order, deleted_at = null
            "#,
            params![code, index as i64],
        )
        .map_err(|e| format!("Failed to save watchlist item: {e}"))?;
    }
    Ok(())
}

fn save_research_portfolios(tx: &Transaction<'_>, portfolios: &[Value]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = portfolios
        .iter()
        .filter_map(|portfolio| string_field(portfolio, "id"))
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "research_portfolios", &incoming, &now)?;
    tx.execute("delete from research_portfolio_items", [])
        .map_err(|e| format!("Failed to clear portfolio items: {e}"))?;
    for portfolio in portfolios {
        let id = string_field(portfolio, "id").unwrap_or_else(|| generated_id("portfolio"));
        tx.execute(
            r#"
            insert into research_portfolios (id, name, note, created_at, deleted_at, payload)
            values (?1, ?2, ?3, ?4, null, ?5)
            on conflict(id) do update set
              name = excluded.name,
              note = excluded.note,
              created_at = excluded.created_at,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                string_field(portfolio, "name").unwrap_or_else(|| "未命名组合".to_string()),
                string_field(portfolio, "note").unwrap_or_default(),
                i64_field(portfolio, "createdAt").unwrap_or_else(now_millis),
                json_string(portfolio)?,
            ],
        )
        .map_err(|e| format!("Failed to save research portfolio: {e}"))?;
        for (index, code_value) in portfolio
            .get("codes")
            .and_then(Value::as_array)
            .unwrap_or(&Vec::new())
            .iter()
            .enumerate()
        {
            if let Some(code) = code_value
                .as_str()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                tx.execute(
                    "insert or replace into research_portfolio_items (portfolio_id, code, sort_order) values (?1, ?2, ?3)",
                    params![id, code, index as i64],
                )
                .map_err(|e| format!("Failed to save portfolio item: {e}"))?;
            }
        }
    }
    Ok(())
}

fn save_research_trades(tx: &Transaction<'_>, trades: &[Value]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = trades
        .iter()
        .filter_map(|trade| string_field(trade, "id"))
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "research_trades", &incoming, &now)?;
    tx.execute("delete from research_cash_ledger", [])
        .map_err(|e| format!("Failed to clear cash ledger projection: {e}"))?;
    for trade in trades {
        let id = string_field(trade, "id").unwrap_or_else(|| generated_id("trade"));
        let kind = string_field(trade, "kind").unwrap_or_else(|| "buy".to_string());
        tx.execute(
            r#"
            insert into research_trades (
              id, kind, code, name, price, quantity, amount, created_at, deleted_at, payload
            )
            values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, null, ?9)
            on conflict(id) do update set
              kind = excluded.kind,
              code = excluded.code,
              name = excluded.name,
              price = excluded.price,
              quantity = excluded.quantity,
              amount = excluded.amount,
              created_at = excluded.created_at,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                kind,
                string_field(trade, "code"),
                string_field(trade, "name"),
                f64_field(trade, "price"),
                f64_field(trade, "quantity"),
                f64_field(trade, "amount").unwrap_or(0.0),
                i64_field(trade, "createdAt").unwrap_or_else(now_millis),
                json_string(trade)?,
            ],
        )
        .map_err(|e| format!("Failed to save research trade: {e}"))?;
        if matches!(kind.as_str(), "deposit" | "withdraw") {
            tx.execute(
                "insert or replace into research_cash_ledger (id, kind, amount, created_at, payload) values (?1, ?2, ?3, ?4, ?5)",
                params![
                    id,
                    kind,
                    f64_field(trade, "amount").unwrap_or(0.0),
                    i64_field(trade, "createdAt").unwrap_or_else(now_millis),
                    json_string(trade)?,
                ],
            )
            .map_err(|e| format!("Failed to save cash ledger item: {e}"))?;
        }
    }
    Ok(())
}

fn save_custom_securities(tx: &Transaction<'_>, custom: &[(&str, &Value)]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = custom
        .iter()
        .map(|(code, _)| (*code).to_string())
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "research_custom_securities", &incoming, &now)?;
    for (code, payload) in custom {
        if code.trim().is_empty() {
            continue;
        }
        tx.execute(
            r#"
            insert into research_custom_securities (code, name, sector, base_price, deleted_at, payload)
            values (?1, ?2, ?3, ?4, null, ?5)
            on conflict(code) do update set
              name = excluded.name,
              sector = excluded.sector,
              base_price = excluded.base_price,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                code,
                string_field(payload, "name").unwrap_or_else(|| (*code).to_string()),
                string_field(payload, "sector"),
                f64_field(payload, "basePrice"),
                json_string(payload)?,
            ],
        )
        .map_err(|e| format!("Failed to save custom security: {e}"))?;
    }
    Ok(())
}

fn save_premarket_theme_runs(tx: &Transaction<'_>, runs: &[Value]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = runs
        .iter()
        .filter_map(|run| string_field(run, "id"))
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "premarket_theme_runs", &incoming, &now)?;
    for run in runs {
        let id = string_field(run, "id").unwrap_or_else(|| generated_id("theme"));
        tx.execute(
            r#"
            insert into premarket_theme_runs (
              id, schema_name, generated_at, imported_at, report_markdown, deleted_at, payload
            )
            values (?1, ?2, ?3, ?4, ?5, null, ?6)
            on conflict(id) do update set
              schema_name = excluded.schema_name,
              generated_at = excluded.generated_at,
              imported_at = excluded.imported_at,
              report_markdown = excluded.report_markdown,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                string_field(run, "schema")
                    .unwrap_or_else(|| "alpha.premarket_theme.v1".to_string()),
                string_field(run, "generatedAt"),
                string_field(run, "importedAt"),
                string_field(run, "reportMarkdown"),
                json_string(run)?,
            ],
        )
        .map_err(|e| format!("Failed to save premarket theme run: {e}"))?;
    }
    write_audit(
        tx,
        "theme_research",
        "snapshot.commit",
        None,
        &json!({ "count": runs.len() }),
    )?;
    Ok(())
}

fn save_automation_tasks(tx: &Transaction<'_>, tasks: &[Value]) -> Result<(), String> {
    let now = now_rfc3339();
    let incoming = tasks
        .iter()
        .filter_map(|task| string_field(task, "id"))
        .collect::<HashSet<_>>();
    soft_delete_missing(tx, "automation_tasks", &incoming, &now)?;
    for task in tasks {
        let id = string_field(task, "id").unwrap_or_else(|| generated_id("automation"));
        tx.execute(
            r#"
            insert into automation_tasks (id, title, prompt, schedule, model, created_at, deleted_at, payload)
            values (?1, ?2, ?3, ?4, ?5, ?6, null, ?7)
            on conflict(id) do update set
              title = excluded.title,
              prompt = excluded.prompt,
              schedule = excluded.schedule,
              model = excluded.model,
              created_at = excluded.created_at,
              deleted_at = null,
              payload = excluded.payload
            "#,
            params![
                id,
                string_field(task, "title").unwrap_or_else(|| "未命名自动化任务".to_string()),
                string_field(task, "prompt").unwrap_or_default(),
                string_field(task, "schedule").unwrap_or_default(),
                string_field(task, "model").unwrap_or_default(),
                i64_field(task, "createdAt").unwrap_or_else(now_millis),
                json_string(task)?,
            ],
        )
        .map_err(|e| format!("Failed to save automation task: {e}"))?;
    }
    write_audit(
        tx,
        "automation",
        "snapshot.commit",
        None,
        &json!({ "count": tasks.len() }),
    )?;
    Ok(())
}

fn save_market_cache_entry(
    conn: &Connection,
    request: MarketCachePutRequest,
) -> Result<(), String> {
    if request.status != "success" {
        let existing_success: Option<String> = conn
            .query_row(
                "select id from market_cache_entries where source = ?1 and scope = ?2 and cache_key = ?3 and status = 'success'",
                params![request.source, request.scope, request.cache_key],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to inspect market cache: {e}"))?;
        if existing_success.is_some() {
            return Ok(());
        }
    }
    let id = market_cache_id(&request.source, &request.scope, &request.cache_key);
    conn.execute(
        r#"
        insert into market_cache_entries (
          id, source, scope, cache_key, code, universe, params_hash, raw_payload,
          normalized_payload, trade_date, as_of, fetched_at, expires_at, status, error, updated_at
        )
        values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
        on conflict(source, scope, cache_key) do update set
          code = excluded.code,
          universe = excluded.universe,
          params_hash = excluded.params_hash,
          raw_payload = excluded.raw_payload,
          normalized_payload = excluded.normalized_payload,
          trade_date = excluded.trade_date,
          as_of = excluded.as_of,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at,
          status = excluded.status,
          error = excluded.error,
          updated_at = excluded.updated_at
        "#,
        params![
            id,
            request.source,
            request.scope,
            request.cache_key,
            request.code,
            request.universe.as_ref().map(json_string).transpose()?,
            request.params_hash,
            request.raw_payload.as_ref().map(json_string).transpose()?,
            request
                .normalized_payload
                .as_ref()
                .map(json_string)
                .transpose()?,
            request.trade_date,
            request.as_of,
            request.fetched_at,
            request.expires_at,
            request.status,
            request.error,
            now_rfc3339(),
        ],
    )
    .map_err(|e| format!("Failed to save market cache entry: {e}"))?;
    Ok(())
}

fn load_market_cache_entry(
    conn: &Connection,
    source: &str,
    scope: &str,
    cache_key: &str,
) -> Result<Option<MarketCacheEntry>, String> {
    conn.query_row(
        r#"
        select source, scope, cache_key, code, universe, params_hash, raw_payload,
          normalized_payload, trade_date, as_of, fetched_at, expires_at, status, error, updated_at
        from market_cache_entries
        where source = ?1 and scope = ?2 and cache_key = ?3
        "#,
        params![source, scope, cache_key],
        |row| {
            let universe: Option<String> = row.get(4)?;
            let raw_payload: Option<String> = row.get(6)?;
            let normalized_payload: Option<String> = row.get(7)?;
            Ok(MarketCacheEntry {
                source: row.get(0)?,
                scope: row.get(1)?,
                cache_key: row.get(2)?,
                code: row.get(3)?,
                universe: universe
                    .as_deref()
                    .and_then(|text| serde_json::from_str::<Vec<String>>(text).ok()),
                params_hash: row.get(5)?,
                raw_payload: raw_payload
                    .as_deref()
                    .and_then(|text| serde_json::from_str::<Value>(text).ok()),
                normalized_payload: normalized_payload
                    .as_deref()
                    .and_then(|text| serde_json::from_str::<Value>(text).ok()),
                trade_date: row.get(8)?,
                as_of: row.get(9)?,
                fetched_at: row.get(10)?,
                expires_at: row.get(11)?,
                status: row.get(12)?,
                error: row.get(13)?,
                updated_at: row.get(14)?,
            })
        },
    )
    .optional()
    .map_err(|e| format!("Failed to load market cache entry: {e}"))
}

fn save_meta_json(tx: &Transaction<'_>, key: &str, value: &Value) -> Result<(), String> {
    tx.execute(
        r#"
        insert into meta_kv (key, value, updated_at)
        values (?1, ?2, ?3)
        on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
        "#,
        params![key, json_string(value)?, now_rfc3339()],
    )
    .map_err(|e| format!("Failed to save local metadata {key}: {e}"))?;
    Ok(())
}

fn load_meta_json(conn: &Connection, key: &str) -> Result<Option<Value>, String> {
    let text: Option<String> = conn
        .query_row(
            "select value from meta_kv where key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| format!("Failed to load local metadata {key}: {e}"))?;
    text.map(|value| {
        serde_json::from_str::<Value>(&value)
            .map_err(|e| format!("Failed to parse local metadata {key}: {e}"))
    })
    .transpose()
}

fn load_payload_rows(conn: &Connection, sql: &str) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare(sql)
        .map_err(|e| format!("Failed to prepare local payload query: {e}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query local payloads: {e}"))?;
    let mut values = Vec::new();
    for row in rows {
        let text = row.map_err(|e| format!("Failed to read local payload: {e}"))?;
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            values.push(value);
        }
    }
    Ok(values)
}

fn load_recent_audit_events(conn: &Connection, limit: usize) -> Result<Vec<Value>, String> {
    let mut statement = conn
        .prepare(
            "select id, domain, action, entity_id, payload, created_at from audit_events order by created_at desc limit ?1",
        )
        .map_err(|e| format!("Failed to prepare audit export query: {e}"))?;
    let rows = statement
        .query_map(params![limit as i64], |row| {
            let payload: String = row.get(4)?;
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "domain": row.get::<_, String>(1)?,
                "action": row.get::<_, String>(2)?,
                "entityId": row.get::<_, Option<String>>(3)?,
                "payload": serde_json::from_str::<Value>(&payload).unwrap_or(Value::Null),
                "createdAt": row.get::<_, String>(5)?,
            }))
        })
        .map_err(|e| format!("Failed to query audit export rows: {e}"))?;
    let mut values = Vec::new();
    for row in rows {
        values.push(row.map_err(|e| format!("Failed to read audit export row: {e}"))?);
    }
    Ok(values)
}

fn write_audit(
    tx: &Transaction<'_>,
    domain: &str,
    action: &str,
    entity_id: Option<&str>,
    payload: &Value,
) -> Result<(), String> {
    tx.execute(
        "insert into audit_events (id, domain, action, entity_id, payload, created_at) values (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            generated_id("audit"),
            domain,
            action,
            entity_id,
            json_string(payload)?,
            now_rfc3339(),
        ],
    )
    .map_err(|e| format!("Failed to write audit event: {e}"))?;
    Ok(())
}

fn soft_delete_missing(
    tx: &Transaction<'_>,
    table: &str,
    incoming: &HashSet<String>,
    timestamp: &str,
) -> Result<(), String> {
    let mut statement = tx
        .prepare(&format!(
            "select id_or_code from ({})",
            active_ids_sql(table)?
        ))
        .map_err(|e| format!("Failed to prepare soft-delete scan for {table}: {e}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to scan active rows for {table}: {e}"))?;
    for row in rows {
        let id = row.map_err(|e| format!("Failed to read active row for {table}: {e}"))?;
        if !incoming.contains(&id) {
            tx.execute(
                &format!(
                    "update {table} set deleted_at = ?1 where {} = ?2 and deleted_at is null",
                    id_column(table)?
                ),
                params![timestamp, id],
            )
            .map_err(|e| format!("Failed to soft-delete row in {table}: {e}"))?;
        }
    }
    Ok(())
}

fn active_ids_sql(table: &str) -> Result<String, String> {
    let id_column = id_column(table)?;
    Ok(format!(
        "select {id_column} as id_or_code from {table} where deleted_at is null"
    ))
}

fn id_column(table: &str) -> Result<&'static str, String> {
    match table {
        "projects"
        | "conversations"
        | "research_portfolios"
        | "research_trades"
        | "premarket_theme_runs"
        | "automation_tasks" => Ok("id"),
        "research_holdings" | "research_custom_securities" => Ok("code"),
        other => Err(format!("Unsupported soft-delete table: {other}")),
    }
}

fn active_child_ids(
    tx: &Transaction<'_>,
    table: &str,
    parent_column: &str,
    parent_id: &str,
) -> Result<HashSet<String>, String> {
    let mut statement = tx
        .prepare(&format!(
            "select id from {table} where {parent_column} = ?1 and deleted_at is null and superseded_at is null"
        ))
        .map_err(|e| format!("Failed to prepare child id query: {e}"))?;
    let rows = statement
        .query_map(params![parent_id], |row| row.get::<_, String>(0))
        .map_err(|e| format!("Failed to query child ids: {e}"))?;
    let mut ids = HashSet::new();
    for row in rows {
        ids.insert(row.map_err(|e| format!("Failed to read child id: {e}"))?);
    }
    Ok(ids)
}

fn ensure_automatic_backups(conn: &Connection, paths: &StorePaths) -> Result<(), String> {
    if !paths.db_path.exists() {
        return Ok(());
    }
    let now = Utc::now();
    let daily = paths.backup_dir.join(format!(
        "alpha-studio-daily-{}.sqlite3",
        now.format("%Y%m%d")
    ));
    if !daily.exists() {
        backup_database_to(conn, paths, &daily)?;
    }
    let monthly = paths.backup_dir.join(format!(
        "alpha-studio-monthly-{:04}{:02}.sqlite3",
        now.year(),
        now.month()
    ));
    if !monthly.exists() {
        backup_database_to(conn, paths, &monthly)?;
    }
    Ok(())
}

fn backup_database(conn: &Connection, paths: &StorePaths, label: &str) -> Result<PathBuf, String> {
    let safe_label = label
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let target = paths.backup_dir.join(format!(
        "alpha-studio-{safe_label}-{}.sqlite3",
        Utc::now().format("%Y%m%d%H%M%S")
    ));
    backup_database_to(conn, paths, &target)?;
    Ok(target)
}

fn backup_database_to(conn: &Connection, paths: &StorePaths, target: &Path) -> Result<(), String> {
    if !paths.db_path.exists() {
        return Ok(());
    }
    let _ = conn.execute_batch("pragma wal_checkpoint(full);");
    fs::copy(&paths.db_path, target)
        .map_err(|e| format!("Failed to create Alpha Studio database backup: {e}"))?;
    Ok(())
}

fn prune_backups(paths: &StorePaths) -> Result<(), String> {
    prune_backup_prefix(paths, "alpha-studio-daily-", 30)?;
    prune_backup_prefix(paths, "alpha-studio-monthly-", 12)?;
    Ok(())
}

fn prune_backup_prefix(paths: &StorePaths, prefix: &str, keep: usize) -> Result<(), String> {
    let mut entries = fs::read_dir(&paths.backup_dir)
        .map_err(|e| format!("Failed to read backup directory: {e}"))?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with(prefix))
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    let remove_count = entries.len().saturating_sub(keep);
    for entry in entries.into_iter().take(remove_count) {
        let _ = fs::remove_file(entry.path());
    }
    Ok(())
}

fn json_string<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| format!("Failed to encode local JSON payload: {e}"))
}

fn string_field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn i64_field(value: &Value, key: &str) -> Option<i64> {
    value.get(key).and_then(|item| {
        item.as_i64()
            .or_else(|| item.as_u64().and_then(|number| i64::try_from(number).ok()))
            .or_else(|| item.as_f64().map(|number| number as i64))
    })
}

fn f64_field(value: &Value, key: &str) -> Option<f64> {
    value.get(key).and_then(Value::as_f64)
}

fn bool_field(value: &Value, key: &str) -> bool {
    value.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn market_cache_id(source: &str, scope: &str, cache_key: &str) -> String {
    format!("{source}:{scope}:{cache_key}")
}

fn generated_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{prefix}-{nanos}")
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_paths(name: &str) -> StorePaths {
        let root = std::env::temp_dir().join(format!(
            "alpha-studio-local-store-test-{name}-{}",
            now_millis()
        ));
        store_paths_from_dir(root).unwrap()
    }

    #[test]
    fn commits_and_loads_snapshots() {
        let paths = temp_paths("commit-load");
        let mut conn = open_store_at_paths(&paths).unwrap();
        commit_snapshot(
            &mut conn,
            LocalStoreCommitRequest {
                chat: Some(json!({
                    "conversations": [{
                        "id": "conv-1",
                        "title": "研究",
                        "messages": [{"id": "msg-1", "role": "user", "timestamp": 1, "blocks": [{"type": "text", "content": "hi"}]}],
                        "cwd": "/tmp",
                        "createdAt": 1,
                        "updatedAt": 1,
                        "status": "idle"
                    }],
                    "projects": [],
                    "currentConversationId": "conv-1"
                })),
                research: Some(json!({
                    "version": 2,
                    "cash": 1000,
                    "netDeposits": 1000,
                    "watchlist": ["600519.XSHG"],
                    "holdings": [],
                    "portfolios": [],
                    "trades": [],
                    "customSecurities": {}
                })),
                premarket_theme_runs: None,
                automation_tasks: None,
                audit: None,
            },
        )
        .unwrap();
        let loaded = load_snapshot(&paths, &conn).unwrap();
        assert_eq!(loaded.chat.unwrap()["conversations"][0]["id"], "conv-1");
        assert_eq!(loaded.research.unwrap()["cash"], 1000);
    }

    #[test]
    fn import_legacy_records_audit() {
        let paths = temp_paths("legacy");
        let mut conn = open_store_at_paths(&paths).unwrap();
        import_legacy(
            &mut conn,
            LocalStoreImportLegacyRequest {
                chat: None,
                research: Some(json!({
                    "version": 2,
                    "cash": 42,
                    "netDeposits": 42,
                    "watchlist": [],
                    "holdings": [],
                    "portfolios": [],
                    "trades": [],
                    "customSecurities": {}
                })),
                premarket_theme_runs: None,
                automation_tasks: None,
                source_keys: vec!["alpha-studio.research-state.v2".to_string()],
            },
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "select count(*) from audit_events where action = 'legacy.import'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn failed_market_cache_write_does_not_replace_success() {
        let paths = temp_paths("cache");
        let conn = open_store_at_paths(&paths).unwrap();
        save_market_cache_entry(
            &conn,
            MarketCachePutRequest {
                source: "eastmoney".to_string(),
                scope: "full_market".to_string(),
                cache_key: "6000".to_string(),
                code: None,
                universe: Some(vec!["600519.XSHG".to_string()]),
                params_hash: None,
                raw_payload: None,
                normalized_payload: Some(json!([{"code": "600519.XSHG"}])),
                trade_date: Some("2026-07-08".to_string()),
                as_of: Some("15:05:00".to_string()),
                fetched_at: "2026-07-08T07:05:00Z".to_string(),
                expires_at: "2026-07-09T01:15:00Z".to_string(),
                status: "success".to_string(),
                error: None,
            },
        )
        .unwrap();
        save_market_cache_entry(
            &conn,
            MarketCachePutRequest {
                source: "eastmoney".to_string(),
                scope: "full_market".to_string(),
                cache_key: "6000".to_string(),
                code: None,
                universe: None,
                params_hash: None,
                raw_payload: None,
                normalized_payload: None,
                trade_date: None,
                as_of: None,
                fetched_at: "2026-07-08T07:06:00Z".to_string(),
                expires_at: "2026-07-08T07:07:00Z".to_string(),
                status: "error".to_string(),
                error: Some("network".to_string()),
            },
        )
        .unwrap();
        let loaded = load_market_cache_entry(&conn, "eastmoney", "full_market", "6000")
            .unwrap()
            .unwrap();
        assert_eq!(loaded.status, "success");
        assert!(loaded.normalized_payload.unwrap().as_array().unwrap().len() == 1);
    }
}
