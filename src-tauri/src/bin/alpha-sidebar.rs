use keyring_core::Entry as KeyringEntry;
use mail_parser::MessageParser;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::json;
use std::env;
use std::path::{Path, PathBuf};

const KOL_TEXT_FIELDS: &[&str] = &[
    "name",
    "email",
    "country",
    "relationship",
    "collaboration_status",
    "stage",
    "owner",
    "priority",
    "tags",
    "risk_note",
    "agent_notes",
    "human_notes",
];
const KOL_INT_FIELDS: &[&str] = &["archived", "brand_fit_score", "next_follow_up_at"];
const LEAD_SELECT: &str = "SELECT id, account_id, imap_uid, message_id, thread_id, from_name, from_email, raw_from, subject, snippet, received_at, category, hidden, confidence, kol_id, created_at, updated_at FROM marketing_email_leads";
const KOL_SELECT: &str = "SELECT id, name, email, country, relationship, collaboration_status, stage, owner, priority, tags, source, archived, brand_fit_score, risk_note, next_follow_up_at, last_contacted_at, agent_notes, human_notes, created_at, updated_at FROM kol_profiles";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliEnvelope<T: Serialize> {
    ok: bool,
    action: &'static str,
    data: T,
    meta: CliMeta,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliMeta {
    db_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CliError {
    ok: bool,
    code: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<serde_json::Value>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct KolRow {
    id: String,
    name: String,
    email: String,
    country: Option<String>,
    relationship: String,
    collaboration_status: String,
    stage: String,
    owner: Option<String>,
    priority: String,
    tags: String,
    source: String,
    archived: bool,
    brand_fit_score: Option<i64>,
    risk_note: Option<String>,
    next_follow_up_at: Option<i64>,
    last_contacted_at: Option<i64>,
    agent_notes: Option<String>,
    human_notes: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LeadRow {
    id: String,
    account_id: String,
    imap_uid: String,
    message_id: Option<String>,
    thread_id: Option<String>,
    from_name: Option<String>,
    from_email: String,
    raw_from: String,
    subject: String,
    snippet: String,
    received_at: Option<i64>,
    category: String,
    hidden: bool,
    confidence: f64,
    kol_id: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountRow {
    id: String,
    label: String,
    host: String,
    port: u16,
    tls: bool,
    username: String,
    mailbox: String,
    scan_limit: u32,
    sync_interval_minutes: u32,
    enabled: bool,
    last_synced_at: Option<i64>,
    updated_at: i64,
}

#[derive(Clone, Debug)]
struct AccountConfig {
    id: String,
    label: String,
    host: String,
    port: u16,
    tls: bool,
    username: String,
    mailbox: String,
    scan_limit: u32,
    enabled: bool,
}

#[derive(Clone, Debug)]
struct RawMarketingEmail {
    imap_uid: String,
    message_id: Option<String>,
    thread_id: Option<String>,
    from_name: Option<String>,
    from_email: String,
    raw_from: String,
    subject: String,
    snippet: String,
    received_at: Option<i64>,
}

#[derive(Clone, Debug)]
struct MarketingClassification {
    category: String,
    confidence: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    account_id: String,
    account_label: String,
    synced: u32,
    inserted: u32,
    updated: u32,
    hidden: u32,
    kol_created: u32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AuditLogRow {
    id: String,
    actor: String,
    target_table: String,
    target_id: String,
    field: String,
    old_value: Option<String>,
    new_value: Option<String>,
    reason: String,
    created_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateResult {
    changed: bool,
    table: String,
    id: String,
    field: String,
    old_value: Option<String>,
    new_value: Option<String>,
}

struct Args {
    db_path: PathBuf,
    parts: Vec<String>,
}

fn main() {
    if let Err(error) = run() {
        print_error(&error);
        std::process::exit(error.exit_code());
    }
}

fn run() -> Result<(), AppError> {
    let args = parse_args()?;
    if args.parts.is_empty() || args.parts[0] == "help" || args.parts[0] == "--help" {
        print_help();
        return Ok(());
    }
    match args.parts.as_slice() {
        [domain, rest @ ..] if domain == "marketing" => run_marketing(&args.db_path, rest),
        _ => Err(AppError::usage(
            "Expected command: alpha-sidebar marketing ...",
        )),
    }
}

fn run_marketing(db_path: &Path, parts: &[String]) -> Result<(), AppError> {
    match parts {
        [command] if command == "snapshot" => marketing_snapshot(db_path),
        [group, command, rest @ ..] if group == "accounts" && command == "list" => {
            marketing_accounts_list(db_path, rest)
        }
        [group, command, rest @ ..] if group == "accounts" && command == "get" => {
            marketing_account_get(db_path, rest)
        }
        [group, command, rest @ ..] if group == "email" && command == "test" => {
            marketing_email_test(db_path, rest)
        }
        [group, command, rest @ ..] if group == "email" && command == "sync" => {
            marketing_email_sync(db_path, rest)
        }
        [group, command] if group == "leads" && command == "count" => marketing_leads_count(db_path),
        [group, command, rest @ ..] if group == "leads" && command == "get" => marketing_lead_get(db_path, rest),
        [group, command, rest @ ..] if group == "leads" && command == "list" => marketing_leads_list(db_path, rest),
        [group, command, rest @ ..] if group == "leads" && command == "update" => marketing_lead_update(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "get" => marketing_kol_get(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "list" => marketing_kol_list(db_path, rest),
        [group, command, query, rest @ ..] if is_kol_group(group) && command == "find" => {
            marketing_kol_find(db_path, query, rest)
        }
        [group, command, rest @ ..] if is_kol_group(group) && command == "update" => marketing_kol_update(db_path, rest),
        [group, command, rest @ ..] if group == "logs" && command == "list" => marketing_logs_list(db_path, rest),
        _ => Err(AppError::usage(
            "Expected: marketing snapshot | marketing accounts list|get | marketing email test|sync | marketing leads count|get|list|update | marketing kols get|list|find|update | marketing logs list",
        )),
    }
}

fn is_kol_group(value: &str) -> bool {
    value == "kols" || value == "kol"
}

fn marketing_accounts_list(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let include_disabled = options.flag("include-disabled");
    let conn = connect(db_path)?;
    let accounts = query_accounts(&conn, include_disabled)?;
    print_ok(
        "marketing.accounts.list",
        db_path,
        json!({ "accounts": accounts }),
    )
}

fn marketing_account_get(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let account_id = options.required("id")?;
    let conn = connect(db_path)?;
    let account = get_account_row(&conn, &account_id)?;
    print_ok(
        "marketing.accounts.get",
        db_path,
        json!({ "account": account }),
    )
}

fn marketing_email_test(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let conn = connect(db_path)?;
    let account = resolve_account(&conn, options.optional("account-id"))?;
    let password = marketing_email_password(&account)?;
    test_marketing_imap_connection(&account, &password)?;
    print_ok(
        "marketing.email.test",
        db_path,
        json!({ "accountId": account.id, "accountLabel": account.label, "host": account.host, "mailbox": account.mailbox }),
    )
}

fn marketing_email_sync(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let sync_all = options.flag("all");
    let conn = connect(db_path)?;
    let accounts = if sync_all {
        query_account_configs(&conn, true)?
            .into_iter()
            .filter(|account| account.enabled)
            .collect::<Vec<_>>()
    } else {
        vec![resolve_account(&conn, options.optional("account-id"))?]
    };
    if accounts.is_empty() {
        return Err(AppError::not_found(
            "No enabled marketing email accounts found",
        ));
    }
    let mut results = Vec::new();
    for account in accounts {
        let password = marketing_email_password(&account)?;
        let emails = fetch_marketing_emails_readonly(&account, &password)?;
        let result = upsert_marketing_email_leads(&conn, &account, emails)?;
        results.push(result);
    }
    print_ok(
        "marketing.email.sync",
        db_path,
        json!({ "results": results }),
    )
}

fn marketing_snapshot(db_path: &Path) -> Result<(), AppError> {
    let conn = connect(db_path)?;
    let email_leads = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 0 AND category != 'ad'",
        [],
    )?;
    let all_email_records = scalar_i64(&conn, "SELECT COUNT(*) FROM marketing_email_leads", [])?;
    let hidden = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 1",
        [],
    )?;
    let visible_ads = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 0 AND category = 'ad'",
        [],
    )?;
    let kol_profiles = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM kol_profiles WHERE archived = 0",
        [],
    )?;
    let audit_logs = scalar_i64(&conn, "SELECT COUNT(*) FROM automation_audit_logs", [])?;
    let latest_leads_sql = format!(
        "{LEAD_SELECT} WHERE hidden = 0 AND category != 'ad' ORDER BY COALESCE(received_at, updated_at) DESC LIMIT 8"
    );
    let latest_leads = query_leads(&conn, &latest_leads_sql, [])?;
    print_ok(
        "marketing.snapshot",
        db_path,
        json!({
            "emailLeads": email_leads,
            "allEmailRecords": all_email_records,
            "hidden": hidden,
            "visibleAds": visible_ads,
            "kolProfiles": kol_profiles,
            "auditLogs": audit_logs,
            "latestLeads": latest_leads,
        }),
    )
}

fn marketing_leads_count(db_path: &Path) -> Result<(), AppError> {
    let conn = connect(db_path)?;
    let email_leads = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 0 AND category != 'ad'",
        [],
    )?;
    print_ok(
        "marketing.leads.count",
        db_path,
        json!({ "emailLeads": email_leads }),
    )
}

fn marketing_lead_get(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let conn = connect(db_path)?;
    let sql = format!("{LEAD_SELECT} WHERE id = ?");
    let lead = query_leads(&conn, &sql, params![id])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::not_found("Lead not found"))?;
    print_ok("marketing.leads.get", db_path, json!({ "lead": lead }))
}

fn marketing_leads_list(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let limit = options.optional_i64("limit")?.unwrap_or(25).clamp(1, 200);
    let query = options
        .optional("query")
        .map(|value| format!("%{}%", value.to_lowercase()));
    let category = options.optional("category");
    let hidden = options.optional_bool("hidden")?;
    let conn = connect(db_path)?;
    let mut sql = format!("{LEAD_SELECT} WHERE 1=1");
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(hidden) = hidden {
        sql.push_str(" AND hidden = ?");
        values.push((if hidden { 1_i64 } else { 0_i64 }).into());
    }
    if let Some(category) = category {
        sql.push_str(" AND category = ?");
        values.push(category.into());
    }
    if let Some(query) = query {
        sql.push_str(
            " AND (lower(raw_from) LIKE ? OR lower(subject) LIKE ? OR lower(snippet) LIKE ?)",
        );
        values.push(query.clone().into());
        values.push(query.clone().into());
        values.push(query.into());
    }
    sql.push_str(" ORDER BY COALESCE(received_at, updated_at) DESC LIMIT ?");
    values.push(limit.into());
    let rows = query_leads_dyn(&conn, &sql, values)?;
    print_ok("marketing.leads.list", db_path, json!({ "leads": rows }))
}

fn marketing_lead_update(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let field = options.required("field")?;
    let value = options.required("value")?;
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| format!("Update marketing_email_leads.{field} via alpha-sidebar"));
    if field != "hidden" && field != "category" {
        return Err(AppError::usage(
            "marketing leads update field must be hidden or category",
        ));
    }
    if field == "category" && !matches!(value.as_str(), "influencer" | "affiliate" | "ad" | "other")
    {
        return Err(AppError::usage(
            "category must be influencer, affiliate, ad, or other",
        ));
    }
    let parsed = if field == "hidden" {
        FieldValue::Int(parse_bool_int(&value)?)
    } else {
        FieldValue::Text(Some(value))
    };
    let conn = connect(db_path)?;
    let result = update_field(&conn, "marketing_email_leads", &id, &field, parsed, &reason)?;
    print_ok(
        "marketing.leads.update",
        db_path,
        json!({ "updated": [result] }),
    )
}

fn marketing_kol_get(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let conn = connect(db_path)?;
    let sql = format!("{KOL_SELECT} WHERE id = ?");
    let kol = query_kols(&conn, &sql, params![id])?
        .into_iter()
        .next()
        .ok_or_else(|| AppError::not_found("KOL not found"))?;
    print_ok("marketing.kols.get", db_path, json!({ "kol": kol }))
}

fn marketing_kol_list(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let limit = options.optional_i64("limit")?.unwrap_or(50).clamp(1, 500);
    let archived = options.optional_bool("archived")?;
    let status = options.optional("status");
    let query = options
        .optional("query")
        .map(|value| format!("%{}%", value.to_lowercase()));
    let conn = connect(db_path)?;
    let mut sql = format!("{KOL_SELECT} WHERE 1=1");
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(archived) = archived {
        sql.push_str(" AND archived = ?");
        values.push((if archived { 1_i64 } else { 0_i64 }).into());
    }
    if let Some(status) = status {
        sql.push_str(" AND collaboration_status = ?");
        values.push(status.into());
    }
    if let Some(query) = query {
        sql.push_str(" AND (lower(name) LIKE ? OR lower(email) LIKE ? OR lower(tags) LIKE ?)");
        values.push(query.clone().into());
        values.push(query.clone().into());
        values.push(query.into());
    }
    sql.push_str(" ORDER BY updated_at DESC LIMIT ?");
    values.push(limit.into());
    let kols = query_kols_dyn(&conn, &sql, values)?;
    print_ok("marketing.kols.list", db_path, json!({ "kols": kols }))
}

fn marketing_kol_find(db_path: &Path, query: &str, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let limit = options.optional_i64("limit")?.unwrap_or(20).clamp(1, 200);
    let conn = connect(db_path)?;
    let matches = find_kols(&conn, query, limit)?;
    print_ok(
        "marketing.kols.find",
        db_path,
        json!({ "query": query, "count": matches.len(), "matches": matches }),
    )
}

fn marketing_kol_update(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.optional("id");
    let query = options.optional("query");
    if id.is_none() && query.is_none() {
        return Err(AppError::usage(
            "marketing kols update requires --id or --query",
        ));
    }
    let update_all = options.flag("all");
    let field = options.required("field")?;
    let value = options.required("value")?;
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| format!("Update kol_profiles.{field} via alpha-sidebar"));
    let parsed = parse_kol_value(&field, &value)?;
    let conn = connect(db_path)?;
    let target_ids = if let Some(id) = id {
        ensure_kol_exists(&conn, &id)?;
        vec![id]
    } else {
        let query = query.unwrap_or_default();
        let matches = find_kols(&conn, &query, 200)?;
        if matches.is_empty() {
            return Err(AppError::not_found(format!(
                "No KOL matched query={query:?}"
            )));
        }
        if matches.len() > 1 && !update_all {
            return Err(AppError::ambiguous(
                "Multiple KOLs matched. Ask the user which id to update, or rerun with --all only if the user explicitly requested all matches.",
                json!({ "matches": matches }),
            ));
        }
        matches.into_iter().map(|item| item.id).collect()
    };
    let mut results = Vec::new();
    for target_id in target_ids {
        results.push(update_field(
            &conn,
            "kol_profiles",
            &target_id,
            &field,
            parsed.clone(),
            &reason,
        )?);
    }
    print_ok(
        "marketing.kols.update",
        db_path,
        json!({ "updated": results }),
    )
}

fn marketing_logs_list(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let limit = options.optional_i64("limit")?.unwrap_or(50).clamp(1, 500);
    let target_table = options.optional("target-table");
    let target_id = options.optional("target-id");
    let conn = connect(db_path)?;
    let mut sql = String::from(
        "SELECT id, actor, target_table, target_id, field, old_value, new_value, reason, created_at FROM automation_audit_logs WHERE 1=1",
    );
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(target_table) = target_table {
        sql.push_str(" AND target_table = ?");
        values.push(target_table.into());
    }
    if let Some(target_id) = target_id {
        sql.push_str(" AND target_id = ?");
        values.push(target_id.into());
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT ?");
    values.push(limit.into());
    let logs = query_logs_dyn(&conn, &sql, values)?;
    print_ok("marketing.logs.list", db_path, json!({ "logs": logs }))
}

#[derive(Clone)]
enum FieldValue {
    Text(Option<String>),
    Int(Option<i64>),
}

fn parse_kol_value(field: &str, value: &str) -> Result<FieldValue, AppError> {
    if KOL_TEXT_FIELDS.contains(&field) {
        Ok(FieldValue::Text(empty_to_none(value)))
    } else if KOL_INT_FIELDS.contains(&field) {
        Ok(FieldValue::Int(parse_optional_i64(value)?))
    } else {
        Err(AppError::usage(format!(
            "Field not allowed for kol_profiles: {field}"
        )))
    }
}

fn empty_to_none(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("null") {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn parse_optional_i64(value: &str) -> Result<Option<i64>, AppError> {
    if value.trim().is_empty() || value.eq_ignore_ascii_case("null") {
        return Ok(None);
    }
    value
        .parse::<i64>()
        .map(Some)
        .map_err(|_| AppError::usage(format!("{value} is not a valid integer")))
}

fn parse_bool_int(value: &str) -> Result<Option<i64>, AppError> {
    match value.trim().to_lowercase().as_str() {
        "" | "null" => Ok(None),
        "1" | "true" | "yes" => Ok(Some(1)),
        "0" | "false" | "no" => Ok(Some(0)),
        _ => Err(AppError::usage(format!("{value} is not a valid boolean"))),
    }
}

fn ensure_kol_exists(conn: &Connection, id: &str) -> Result<(), AppError> {
    let exists: Option<String> = conn
        .query_row(
            "SELECT id FROM kol_profiles WHERE id = ?",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    if exists.is_none() {
        return Err(AppError::not_found(format!("No KOL with id={id}")));
    }
    Ok(())
}

fn find_kols(conn: &Connection, query: &str, limit: i64) -> Result<Vec<KolRow>, AppError> {
    let q = query.trim().to_lowercase();
    let exact_sql = format!(
        "{KOL_SELECT} WHERE lower(name) = ? OR lower(email) = ? ORDER BY updated_at DESC LIMIT ?"
    );
    let exact = query_kols(conn, &exact_sql, params![q, q, limit])?;
    if !exact.is_empty() {
        return Ok(exact);
    }
    let like = format!("%{}%", query.trim().to_lowercase());
    let like_sql = format!(
        "{KOL_SELECT} WHERE lower(name) LIKE ? OR lower(email) LIKE ? OR lower(tags) LIKE ? ORDER BY CASE WHEN lower(name) LIKE ? THEN 0 WHEN lower(email) LIKE ? THEN 1 ELSE 2 END, updated_at DESC LIMIT ?"
    );
    query_kols(
        conn,
        &like_sql,
        params![like, like, like, like, like, limit],
    )
}

fn query_kols<P: rusqlite::Params>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> Result<Vec<KolRow>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, row_to_kol)?;
    collect_rows(rows)
}

fn query_kols_dyn(
    conn: &Connection,
    sql: &str,
    values: Vec<rusqlite::types::Value>,
) -> Result<Vec<KolRow>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), row_to_kol)?;
    collect_rows(rows)
}

fn row_to_kol(row: &Row<'_>) -> rusqlite::Result<KolRow> {
    Ok(KolRow {
        id: row.get(0)?,
        name: row.get(1)?,
        email: row.get(2)?,
        country: row.get(3)?,
        relationship: row.get(4)?,
        collaboration_status: row.get(5)?,
        stage: row.get(6)?,
        owner: row.get(7)?,
        priority: row.get(8)?,
        tags: row.get(9)?,
        source: row.get(10)?,
        archived: int_to_bool(row.get(11)?),
        brand_fit_score: row.get(12)?,
        risk_note: row.get(13)?,
        next_follow_up_at: row.get(14)?,
        last_contacted_at: row.get(15)?,
        agent_notes: row.get(16)?,
        human_notes: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
    })
}

fn query_leads<P: rusqlite::Params>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> Result<Vec<LeadRow>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params, row_to_lead)?;
    collect_rows(rows)
}

fn query_leads_dyn(
    conn: &Connection,
    sql: &str,
    values: Vec<rusqlite::types::Value>,
) -> Result<Vec<LeadRow>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), row_to_lead)?;
    collect_rows(rows)
}

fn query_accounts(conn: &Connection, include_disabled: bool) -> Result<Vec<AccountRow>, AppError> {
    let sql = if include_disabled {
        "SELECT id, label, host, port, tls, username, mailbox, scan_limit, sync_interval_minutes, enabled, last_synced_at, updated_at FROM marketing_email_accounts ORDER BY updated_at DESC"
    } else {
        "SELECT id, label, host, port, tls, username, mailbox, scan_limit, sync_interval_minutes, enabled, last_synced_at, updated_at FROM marketing_email_accounts WHERE enabled = 1 ORDER BY updated_at DESC"
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], row_to_account)?;
    collect_rows(rows)
}

fn get_account_row(conn: &Connection, account_id: &str) -> Result<AccountRow, AppError> {
    conn.query_row(
        "SELECT id, label, host, port, tls, username, mailbox, scan_limit, sync_interval_minutes, enabled, last_synced_at, updated_at FROM marketing_email_accounts WHERE id = ?",
        params![account_id],
        row_to_account,
    )
    .optional()?
    .ok_or_else(|| AppError::not_found(format!("No email account with id={account_id}")))
}

fn row_to_account(row: &Row<'_>) -> rusqlite::Result<AccountRow> {
    Ok(AccountRow {
        id: row.get(0)?,
        label: row.get(1)?,
        host: row.get(2)?,
        port: row.get::<_, i64>(3)? as u16,
        tls: int_to_bool(row.get(4)?),
        username: row.get(5)?,
        mailbox: row.get(6)?,
        scan_limit: row.get::<_, i64>(7)? as u32,
        sync_interval_minutes: row.get::<_, i64>(8)? as u32,
        enabled: int_to_bool(row.get(9)?),
        last_synced_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn query_account_configs(
    conn: &Connection,
    include_disabled: bool,
) -> Result<Vec<AccountConfig>, AppError> {
    Ok(query_accounts(conn, include_disabled)?
        .into_iter()
        .map(|account| AccountConfig {
            id: account.id,
            label: account.label,
            host: account.host,
            port: account.port,
            tls: account.tls,
            username: account.username,
            mailbox: account.mailbox,
            scan_limit: account.scan_limit,
            enabled: account.enabled,
        })
        .collect())
}

fn resolve_account(
    conn: &Connection,
    account_id: Option<String>,
) -> Result<AccountConfig, AppError> {
    if let Some(account_id) = account_id {
        let account = get_account_row(conn, &account_id)?;
        return Ok(AccountConfig {
            id: account.id,
            label: account.label,
            host: account.host,
            port: account.port,
            tls: account.tls,
            username: account.username,
            mailbox: account.mailbox,
            scan_limit: account.scan_limit,
            enabled: account.enabled,
        });
    }
    let accounts = query_account_configs(conn, false)?;
    match accounts.as_slice() {
        [account] => Ok(account.clone()),
        [] => Err(AppError::not_found(
            "No enabled marketing email account found",
        )),
        _ => Err(AppError::ambiguous(
            "Multiple enabled email accounts found. Rerun with --account-id.",
            json!({ "accounts": accounts.iter().map(|account| json!({
                "id": account.id,
                "label": account.label,
                "username": account.username,
                "host": account.host,
                "mailbox": account.mailbox,
            })).collect::<Vec<_>>() }),
        )),
    }
}

fn query_logs_dyn(
    conn: &Connection,
    sql: &str,
    values: Vec<rusqlite::types::Value>,
) -> Result<Vec<AuditLogRow>, AppError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(values), |row| {
        Ok(AuditLogRow {
            id: row.get(0)?,
            actor: row.get(1)?,
            target_table: row.get(2)?,
            target_id: row.get(3)?,
            field: row.get(4)?,
            old_value: row.get(5)?,
            new_value: row.get(6)?,
            reason: row.get(7)?,
            created_at: row.get(8)?,
        })
    })?;
    collect_rows(rows)
}

fn row_to_lead(row: &Row<'_>) -> rusqlite::Result<LeadRow> {
    Ok(LeadRow {
        id: row.get(0)?,
        account_id: row.get(1)?,
        imap_uid: row.get(2)?,
        message_id: row.get(3)?,
        thread_id: row.get(4)?,
        from_name: row.get(5)?,
        from_email: row.get(6)?,
        raw_from: row.get(7)?,
        subject: row.get(8)?,
        snippet: row.get(9)?,
        received_at: row.get(10)?,
        category: row.get(11)?,
        hidden: int_to_bool(row.get(12)?),
        confidence: row.get(13)?,
        kol_id: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

fn update_field(
    conn: &Connection,
    table: &str,
    id: &str,
    field: &str,
    value: FieldValue,
    reason: &str,
) -> Result<UpdateResult, AppError> {
    let old_value = db_text_value(conn, table, id, field)?;
    let new_value = match value.clone() {
        FieldValue::Text(value) => value,
        FieldValue::Int(value) => value.map(|item| item.to_string()),
    };
    if old_value == new_value {
        return Ok(UpdateResult {
            changed: false,
            table: table.to_string(),
            id: id.to_string(),
            field: field.to_string(),
            old_value,
            new_value,
        });
    }
    let now = now_millis();
    match value {
        FieldValue::Text(value) => {
            let sql = format!("UPDATE {table} SET {field} = ?1, updated_at = ?2 WHERE id = ?3");
            conn.execute(&sql, params![value, now, id])?;
        }
        FieldValue::Int(value) => {
            let sql = format!("UPDATE {table} SET {field} = ?1, updated_at = ?2 WHERE id = ?3");
            conn.execute(&sql, params![value, now, id])?;
        }
    }
    insert_audit(
        conn,
        table,
        id,
        field,
        old_value.as_deref(),
        new_value.as_deref(),
        reason,
    )?;
    Ok(UpdateResult {
        changed: true,
        table: table.to_string(),
        id: id.to_string(),
        field: field.to_string(),
        old_value,
        new_value,
    })
}

fn db_text_value(
    conn: &Connection,
    table: &str,
    id: &str,
    field: &str,
) -> Result<Option<String>, AppError> {
    let sql = format!("SELECT CAST({field} AS TEXT) FROM {table} WHERE id = ?1");
    let value = conn
        .query_row(&sql, params![id], |row| row.get(0))
        .optional()?;
    if value.is_none() {
        let exists: Option<String> = conn
            .query_row(
                &format!("SELECT id FROM {table} WHERE id = ?1"),
                params![id],
                |row| row.get(0),
            )
            .optional()?;
        if exists.is_none() {
            return Err(AppError::not_found(format!(
                "No row in {table} with id={id}"
            )));
        }
    }
    Ok(value)
}

fn insert_audit(
    conn: &Connection,
    table: &str,
    id: &str,
    field: &str,
    old_value: Option<&str>,
    new_value: Option<&str>,
    reason: &str,
) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO automation_audit_logs (id, actor, target_table, target_id, field, old_value, new_value, reason, created_at) VALUES (?1, 'agent', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            generate_id("audit"),
            table,
            id,
            field,
            old_value,
            new_value,
            reason,
            now_millis(),
        ],
    )?;
    Ok(())
}

fn marketing_email_password(account: &AccountConfig) -> Result<String, AppError> {
    keyring::use_native_store(false)
        .map_err(|error| AppError::secret(format!("Failed to open system keyring: {error}")))?;
    let entry = KeyringEntry::new("com.alpha-studio.marketing.email", &account.id)
        .map_err(|error| AppError::secret(format!("Failed to create keyring entry: {error}")))?;
    entry.get_password().map_err(|_| {
        AppError::secret("No password found for this email account. Save it from Marketing Email settings first.")
    })
}

fn test_marketing_imap_connection(account: &AccountConfig, password: &str) -> Result<(), AppError> {
    if !account.tls {
        return Err(AppError::usage("Only TLS IMAP is supported."));
    }
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|error| AppError::external(format!("Failed to build TLS connector: {error}")))?;
    let client = imap::connect((account.host.as_str(), account.port), &account.host, &tls)
        .map_err(|error| AppError::external(format!("Failed to connect IMAP server: {error}")))?;
    let mut session = client
        .login(&account.username, password)
        .map_err(|(error, _)| {
            AppError::external(format!("Failed to login IMAP account: {error}"))
        })?;
    session.select(&account.mailbox).map_err(|error| {
        AppError::external(format!(
            "Failed to open mailbox {}: {error}",
            account.mailbox
        ))
    })?;
    session.logout().ok();
    Ok(())
}

fn fetch_marketing_emails_readonly(
    account: &AccountConfig,
    password: &str,
) -> Result<Vec<RawMarketingEmail>, AppError> {
    if !account.tls {
        return Err(AppError::usage("Only TLS IMAP is supported."));
    }
    let tls = native_tls::TlsConnector::builder()
        .build()
        .map_err(|error| AppError::external(format!("Failed to build TLS connector: {error}")))?;
    let client = imap::connect((account.host.as_str(), account.port), &account.host, &tls)
        .map_err(|error| AppError::external(format!("Failed to connect IMAP server: {error}")))?;
    let mut session = client
        .login(&account.username, password)
        .map_err(|(error, _)| {
            AppError::external(format!("Failed to login IMAP account: {error}"))
        })?;
    session.select(&account.mailbox).map_err(|error| {
        AppError::external(format!(
            "Failed to open mailbox {}: {error}",
            account.mailbox
        ))
    })?;

    let mut uids: Vec<u32> = session
        .uid_search("ALL")
        .map_err(|error| AppError::external(format!("Failed to search mailbox: {error}")))?
        .into_iter()
        .collect();
    uids.sort_unstable();
    uids.reverse();
    uids.truncate(account.scan_limit as usize);

    let uid_set = uids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let mut emails = Vec::new();
    if !uid_set.is_empty() {
        let fetches = session
            .uid_fetch(uid_set, "(UID BODY.PEEK[])")
            .map_err(|error| {
                AppError::external(format!("Failed to fetch mailbox messages: {error}"))
            })?;
        for fetch in fetches.iter() {
            let body: &[u8] = match fetch.body() {
                Some(body) => body,
                None => continue,
            };
            let uid = fetch.uid.unwrap_or(fetch.message).to_string();
            if let Some(email) = parse_marketing_email(uid, body) {
                emails.push(email);
            }
        }
    }

    session.logout().ok();
    emails.sort_by(|a, b| b.received_at.cmp(&a.received_at));
    Ok(emails)
}

fn parse_marketing_email(imap_uid: String, body: &[u8]) -> Option<RawMarketingEmail> {
    let message = MessageParser::default().parse(body)?;
    let from = message.from().and_then(|address| address.first());
    let from_name = from.and_then(|item| item.name()).map(str::to_string);
    let from_email = from
        .and_then(|item| item.address())
        .map(str::to_string)
        .unwrap_or_else(|| "unknown@example.local".to_string());
    let raw_from = match (&from_name, &from_email) {
        (Some(name), email) if !name.is_empty() => format!("{name} <{email}>"),
        (_, email) => email.clone(),
    };
    let subject = message.subject().unwrap_or("(无主题)").trim().to_string();
    let snippet = message
        .body_preview(480)
        .map(|value| value.to_string())
        .or_else(|| message.body_text(0).map(|value| value.to_string()))
        .unwrap_or_default();
    Some(RawMarketingEmail {
        imap_uid,
        message_id: message.message_id().map(str::to_string),
        thread_id: message.thread_name().map(str::to_string),
        from_name,
        from_email,
        raw_from,
        subject,
        snippet: compact_text(&snippet, 600),
        received_at: message.date().map(|date| date.to_timestamp() * 1000),
    })
}

fn compact_text(value: &str, limit: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if compact.chars().count() <= limit {
        compact
    } else {
        format!("{}...", compact.chars().take(limit).collect::<String>())
    }
}

fn classify_marketing_email(email: &RawMarketingEmail) -> MarketingClassification {
    let text = format!(
        "{} {} {}",
        email.subject.to_lowercase(),
        email.snippet.to_lowercase(),
        email.from_email.to_lowercase()
    );
    let ad_terms = [
        "seo",
        "guest post",
        "lead generation",
        "crypto",
        "casino",
        "discount",
        "limited offer",
        "unsubscribe",
        "广告",
        "推广服务",
        "建站",
        "外链",
        "发票",
    ];
    if ad_terms.iter().any(|term| text.contains(term)) {
        return MarketingClassification {
            category: "ad".to_string(),
            confidence: 0.78,
        };
    }
    let affiliate_terms = [
        "affiliate",
        "commission",
        "partner program",
        "referral",
        "cps",
        "联盟",
        "佣金",
        "分销",
        "返佣",
    ];
    if affiliate_terms.iter().any(|term| text.contains(term)) {
        return MarketingClassification {
            category: "affiliate".to_string(),
            confidence: 0.74,
        };
    }
    let influencer_terms = [
        "influencer",
        "creator",
        "tiktok",
        "instagram",
        "ig reel",
        "youtube",
        "followers",
        "kol",
        "达人",
        "博主",
        "测评",
        "种草",
    ];
    if influencer_terms.iter().any(|term| text.contains(term)) {
        return MarketingClassification {
            category: "influencer".to_string(),
            confidence: 0.7,
        };
    }
    MarketingClassification {
        category: "other".to_string(),
        confidence: 0.42,
    }
}

fn upsert_marketing_email_leads(
    conn: &Connection,
    account: &AccountConfig,
    emails: Vec<RawMarketingEmail>,
) -> Result<SyncResult, AppError> {
    let mut inserted = 0_u32;
    let mut updated = 0_u32;
    let mut hidden = 0_u32;
    let mut kol_created = 0_u32;
    for email in emails.iter() {
        let existing_id: Option<String> = conn
            .query_row(
                "SELECT id FROM marketing_email_leads WHERE account_id = ?1 AND imap_uid = ?2",
                params![account.id, email.imap_uid],
                |row| row.get(0),
            )
            .optional()?;
        let classification = classify_marketing_email(email);
        let is_hidden = classification.category == "ad";
        let mut kol_id = None;
        if classification.category == "influencer" {
            let (id, created) = upsert_kol_from_email(conn, email)?;
            kol_id = Some(id);
            if created {
                kol_created += 1;
            }
        }
        let now = now_millis();
        let id = existing_id.clone().unwrap_or_else(|| generate_id("lead"));
        conn.execute(
            r#"
            INSERT INTO marketing_email_leads
              (id, account_id, imap_uid, message_id, thread_id, from_name, from_email, raw_from, subject, snippet, received_at, category, hidden, confidence, kol_id, created_at, updated_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)
            ON CONFLICT(account_id, imap_uid) DO UPDATE SET
              message_id=excluded.message_id,
              thread_id=excluded.thread_id,
              from_name=excluded.from_name,
              from_email=excluded.from_email,
              raw_from=excluded.raw_from,
              subject=excluded.subject,
              snippet=excluded.snippet,
              received_at=excluded.received_at,
              category=excluded.category,
              hidden=excluded.hidden,
              confidence=excluded.confidence,
              kol_id=excluded.kol_id,
              updated_at=excluded.updated_at
            "#,
            params![
                id,
                account.id,
                email.imap_uid,
                email.message_id,
                email.thread_id,
                email.from_name,
                email.from_email.to_lowercase(),
                email.raw_from,
                email.subject,
                email.snippet,
                email.received_at,
                classification.category,
                bool_to_int(is_hidden),
                classification.confidence,
                kol_id,
                now,
            ],
        )?;
        if existing_id.is_some() {
            updated += 1;
        } else {
            inserted += 1;
        }
        if is_hidden {
            hidden += 1;
        }
    }
    let now = now_millis();
    conn.execute(
        "UPDATE marketing_email_accounts SET last_synced_at = ?1, updated_at = ?1 WHERE id = ?2",
        params![now, account.id],
    )?;
    let sync_value = format!("{} emails", emails.len());
    insert_audit(
        conn,
        "marketing_email_leads",
        &account.id,
        "sync",
        None,
        Some(&sync_value),
        "只读同步邮件并写入本地营销库",
    )?;
    Ok(SyncResult {
        account_id: account.id.clone(),
        account_label: account.label.clone(),
        synced: emails.len() as u32,
        inserted,
        updated,
        hidden,
        kol_created,
    })
}

fn upsert_kol_from_email(
    conn: &Connection,
    email: &RawMarketingEmail,
) -> Result<(String, bool), AppError> {
    let normalized_email = email.from_email.to_lowercase();
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM kol_profiles WHERE lower(email) = lower(?1)",
            params![normalized_email],
            |row| row.get(0),
        )
        .optional()?;
    let now = now_millis();
    if let Some(id) = existing {
        conn.execute(
            "UPDATE kol_profiles SET last_contacted_at = COALESCE(?1, last_contacted_at), updated_at = ?2 WHERE id = ?3",
            params![email.received_at, now, id],
        )?;
        return Ok((id, false));
    }
    let id = generate_id("kol");
    let fallback_name = normalized_email
        .split('@')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("未命名达人")
        .to_string();
    let name = email.from_name.clone().unwrap_or(fallback_name);
    conn.execute(
        r#"
        INSERT INTO kol_profiles
          (id, name, email, relationship, collaboration_status, stage, priority, tags, source, archived, last_contacted_at, agent_notes, created_at, updated_at)
        VALUES
          (?1, ?2, ?3, '达人', '待分配', '线索', 'normal', '', 'Email', 0, ?4, ?5, ?6, ?6)
        "#,
        params![
            id,
            name,
            normalized_email,
            email.received_at,
            format!(
                "由邮件线索自动创建：{}；来自：{}；摘要：{}",
                email.subject, email.raw_from, email.snippet
            ),
            now,
        ],
    )?;
    insert_audit(
        conn,
        "kol_profiles",
        &id,
        "created",
        None,
        Some(&normalized_email),
        "达人邮件自动创建 KOL 档案",
    )?;
    Ok((id, true))
}

fn connect(db_path: &Path) -> Result<Connection, AppError> {
    if !db_path.exists() {
        return Err(AppError::not_found(format!(
            "Marketing database not found: {}",
            db_path.display()
        )));
    }
    let conn = Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

fn scalar_i64<P: rusqlite::Params>(
    conn: &Connection,
    sql: &str,
    params: P,
) -> Result<i64, AppError> {
    conn.query_row(sql, params, |row| row.get(0))
        .map_err(AppError::from)
}

fn collect_rows<T>(
    rows: rusqlite::MappedRows<'_, impl FnMut(&Row<'_>) -> rusqlite::Result<T>>,
) -> Result<Vec<T>, AppError> {
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn print_ok<T: Serialize>(action: &'static str, db_path: &Path, data: T) -> Result<(), AppError> {
    let envelope = CliEnvelope {
        ok: true,
        action,
        data,
        meta: CliMeta {
            db_path: db_path.to_string_lossy().to_string(),
        },
    };
    println!("{}", serde_json::to_string_pretty(&envelope)?);
    Ok(())
}

fn print_error(error: &AppError) {
    let envelope = CliError {
        ok: false,
        code: error.code().to_string(),
        message: error.message.clone(),
        details: error.details.clone(),
    };
    eprintln!(
        "{}",
        serde_json::to_string_pretty(&envelope).unwrap_or_else(|_| "{\"ok\":false}".to_string())
    );
}

fn parse_args() -> Result<Args, AppError> {
    let mut raw: Vec<String> = env::args().skip(1).collect();
    let mut db_path = env::var("ALPHA_MARKETING_DB")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(default_db_path);
    let mut parts = Vec::new();
    while let Some(arg) = raw.first().cloned() {
        raw.remove(0);
        if arg == "--db" {
            let value = raw
                .first()
                .cloned()
                .ok_or_else(|| AppError::usage("--db requires a path"))?;
            raw.remove(0);
            db_path = expand_home(&value);
        } else {
            parts.push(arg);
            parts.extend(raw);
            break;
        }
    }
    Ok(Args { db_path, parts })
}

#[derive(Default)]
struct ParsedOptions {
    entries: Vec<(String, Option<String>)>,
}

impl ParsedOptions {
    fn parse(args: &[String]) -> Result<Self, AppError> {
        let mut entries = Vec::new();
        let mut index = 0;
        while index < args.len() {
            let key = &args[index];
            if !key.starts_with("--") {
                return Err(AppError::usage(format!("Unexpected argument: {key}")));
            }
            let key = key.trim_start_matches("--").to_string();
            if key == "all" {
                entries.push((key, None));
                index += 1;
                continue;
            }
            let value = args
                .get(index + 1)
                .cloned()
                .ok_or_else(|| AppError::usage(format!("--{key} requires a value")))?;
            entries.push((key, Some(value)));
            index += 2;
        }
        Ok(Self { entries })
    }

    fn optional(&self, key: &str) -> Option<String> {
        self.entries
            .iter()
            .rev()
            .find(|(item, _)| item == key)
            .and_then(|(_, value)| value.clone())
    }

    fn required(&self, key: &str) -> Result<String, AppError> {
        self.optional(key)
            .ok_or_else(|| AppError::usage(format!("Missing required --{key}")))
    }

    fn flag(&self, key: &str) -> bool {
        self.entries
            .iter()
            .any(|(item, value)| item == key && value.is_none())
    }

    fn optional_i64(&self, key: &str) -> Result<Option<i64>, AppError> {
        self.optional(key)
            .map(|value| {
                value
                    .parse::<i64>()
                    .map_err(|_| AppError::usage(format!("--{key} must be an integer")))
            })
            .transpose()
    }

    fn optional_bool(&self, key: &str) -> Result<Option<bool>, AppError> {
        self.optional(key)
            .map(|value| match value.to_lowercase().as_str() {
                "1" | "true" | "yes" => Ok(true),
                "0" | "false" | "no" => Ok(false),
                _ => Err(AppError::usage(format!("--{key} must be true or false"))),
            })
            .transpose()
    }
}

#[derive(Debug)]
struct AppError {
    kind: ErrorKind,
    message: String,
    details: Option<serde_json::Value>,
}

#[derive(Debug)]
enum ErrorKind {
    Usage,
    NotFound,
    Ambiguous,
    Secret,
    External,
    Db,
    Json,
}

impl AppError {
    fn usage(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Usage,
            message: message.into(),
            details: None,
        }
    }

    fn not_found(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::NotFound,
            message: message.into(),
            details: None,
        }
    }

    fn ambiguous(message: impl Into<String>, details: serde_json::Value) -> Self {
        Self {
            kind: ErrorKind::Ambiguous,
            message: message.into(),
            details: Some(details),
        }
    }

    fn secret(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Secret,
            message: message.into(),
            details: None,
        }
    }

    fn external(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::External,
            message: message.into(),
            details: None,
        }
    }

    fn code(&self) -> &'static str {
        match self.kind {
            ErrorKind::Usage => "usage_error",
            ErrorKind::NotFound => "not_found",
            ErrorKind::Ambiguous => "ambiguous_match",
            ErrorKind::Secret => "secret_unavailable",
            ErrorKind::External => "external_error",
            ErrorKind::Db => "database_error",
            ErrorKind::Json => "json_error",
        }
    }

    fn exit_code(&self) -> i32 {
        match self.kind {
            ErrorKind::Usage => 64,
            ErrorKind::NotFound => 66,
            ErrorKind::Ambiguous => 2,
            ErrorKind::Secret => 69,
            ErrorKind::External => 70,
            ErrorKind::Db | ErrorKind::Json => 1,
        }
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(value: rusqlite::Error) -> Self {
        Self {
            kind: ErrorKind::Db,
            message: value.to_string(),
            details: None,
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(value: serde_json::Error) -> Self {
        Self {
            kind: ErrorKind::Json,
            message: value.to_string(),
            details: None,
        }
    }
}

fn generate_id(prefix: &str) -> String {
    format!("{prefix}-{}-{}", now_millis(), std::process::id())
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

fn int_to_bool(value: i64) -> bool {
    value != 0
}

fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn default_db_path() -> PathBuf {
    home_dir()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".alpha-studio")
        .join("marketing.sqlite")
}

fn expand_home(path: &str) -> PathBuf {
    if path == "~" {
        return home_dir()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(path));
    }
    if let Some(stripped) = path.strip_prefix("~/") {
        return home_dir()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("."))
            .join(stripped);
    }
    PathBuf::from(path)
}

fn home_dir() -> Option<String> {
    env::var("HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
}

fn print_help() {
    println!(
        "{}",
        r#"alpha-sidebar

Usage:
  alpha-sidebar [--db PATH] marketing snapshot
  alpha-sidebar [--db PATH] marketing accounts list [--include-disabled]
  alpha-sidebar [--db PATH] marketing accounts get --id ID
  alpha-sidebar [--db PATH] marketing email test [--account-id ID]
  alpha-sidebar [--db PATH] marketing email sync [--account-id ID | --all]
  alpha-sidebar [--db PATH] marketing leads count
  alpha-sidebar [--db PATH] marketing leads get --id ID
  alpha-sidebar [--db PATH] marketing leads list [--query TEXT] [--category influencer|affiliate|ad|other] [--hidden true|false] [--limit N]
  alpha-sidebar [--db PATH] marketing leads update --id ID --field hidden|category --value VALUE --reason REASON
  alpha-sidebar [--db PATH] marketing kols get --id ID
  alpha-sidebar [--db PATH] marketing kols list [--query TEXT] [--status STATUS] [--archived true|false] [--limit N]
  alpha-sidebar [--db PATH] marketing kols find QUERY [--limit N]
  alpha-sidebar [--db PATH] marketing kols update (--id ID | --query TEXT) --field FIELD --value VALUE [--all] --reason REASON
  alpha-sidebar [--db PATH] marketing logs list [--target-table TABLE] [--target-id ID] [--limit N]

All successful commands print { ok: true, action, data, meta } JSON.
Errors print { ok: false, code, message, details? } JSON to stderr.
"#
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.execute_batch(
            r#"
            CREATE TABLE marketing_email_accounts (
              id TEXT PRIMARY KEY,
              label TEXT NOT NULL,
              host TEXT NOT NULL,
              port INTEGER NOT NULL,
              tls INTEGER NOT NULL,
              username TEXT NOT NULL,
              mailbox TEXT NOT NULL,
              scan_limit INTEGER NOT NULL,
              sync_interval_minutes INTEGER NOT NULL,
              enabled INTEGER NOT NULL,
              last_synced_at INTEGER,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE marketing_email_leads (
              id TEXT PRIMARY KEY,
              account_id TEXT NOT NULL,
              imap_uid TEXT NOT NULL,
              message_id TEXT,
              thread_id TEXT,
              from_name TEXT,
              from_email TEXT NOT NULL,
              raw_from TEXT NOT NULL,
              subject TEXT NOT NULL,
              snippet TEXT NOT NULL,
              received_at INTEGER,
              category TEXT NOT NULL,
              hidden INTEGER NOT NULL,
              confidence REAL NOT NULL,
              kol_id TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE kol_profiles (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              email TEXT NOT NULL,
              country TEXT,
              relationship TEXT NOT NULL,
              collaboration_status TEXT NOT NULL,
              stage TEXT NOT NULL,
              owner TEXT,
              priority TEXT NOT NULL,
              tags TEXT NOT NULL,
              source TEXT NOT NULL,
              archived INTEGER NOT NULL,
              brand_fit_score INTEGER,
              risk_note TEXT,
              next_follow_up_at INTEGER,
              last_contacted_at INTEGER,
              agent_notes TEXT,
              human_notes TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            );
            CREATE TABLE automation_audit_logs (
              id TEXT PRIMARY KEY,
              actor TEXT NOT NULL,
              target_table TEXT NOT NULL,
              target_id TEXT NOT NULL,
              field TEXT NOT NULL,
              old_value TEXT,
              new_value TEXT,
              reason TEXT NOT NULL,
              created_at INTEGER NOT NULL
            );
            "#,
        )
        .expect("create schema");
        conn
    }

    #[test]
    fn lead_queries_return_detail_fields_used_by_sidebar() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO marketing_email_leads (id, account_id, imap_uid, message_id, thread_id, from_name, from_email, raw_from, subject, snippet, received_at, category, hidden, confidence, kol_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                "lead_1",
                "account_1",
                "uid_1",
                "<message_1>",
                "thread_1",
                "Mia",
                "mia@example.com",
                "Mia <mia@example.com>",
                "Collab",
                "Snippet",
                10_i64,
                "influencer",
                0_i64,
                0.88_f64,
                "kol_1",
                1_i64,
                2_i64,
            ],
        )
        .expect("insert lead");

        let sql = format!("{LEAD_SELECT} WHERE id = ?");
        let rows = query_leads(&conn, &sql, params!["lead_1"]).expect("query leads");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].account_id, "account_1");
        assert_eq!(rows[0].message_id.as_deref(), Some("<message_1>"));
        assert_eq!(rows[0].from_email, "mia@example.com");
        assert_eq!(rows[0].confidence, 0.88);
    }

    #[test]
    fn kol_queries_return_detail_fields_used_by_sidebar() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO kol_profiles (id, name, email, country, relationship, collaboration_status, stage, owner, priority, tags, source, archived, brand_fit_score, risk_note, next_follow_up_at, last_contacted_at, agent_notes, human_notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            params![
                "kol_1",
                "Mia",
                "mia@example.com",
                "US",
                "influencer",
                "active",
                "negotiation",
                "Luna",
                "high",
                "beauty,tiktok",
                "Email",
                0_i64,
                88_i64,
                "risk",
                20_i64,
                10_i64,
                "agent notes",
                "human notes",
                1_i64,
                2_i64,
            ],
        )
        .expect("insert kol");

        let sql = format!("{KOL_SELECT} WHERE id = ?");
        let rows = query_kols(&conn, &sql, params!["kol_1"]).expect("query kols");

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].brand_fit_score, Some(88));
        assert_eq!(rows[0].risk_note.as_deref(), Some("risk"));
        assert_eq!(rows[0].human_notes.as_deref(), Some("human notes"));
        assert_eq!(rows[0].owner.as_deref(), Some("Luna"));
    }

    #[test]
    fn sync_without_account_id_is_ambiguous_for_multiple_enabled_accounts() {
        let conn = test_conn();
        for id in ["account_1", "account_2"] {
            conn.execute(
                "INSERT INTO marketing_email_accounts (id, label, host, port, tls, username, mailbox, scan_limit, sync_interval_minutes, enabled, updated_at) VALUES (?1, ?2, 'imap.example.com', 993, 1, ?3, 'INBOX', 50, 15, 1, 1)",
                params![id, id, format!("{id}@example.com")],
            )
            .expect("insert account");
        }

        let error =
            resolve_account(&conn, None).expect_err("multiple accounts should be ambiguous");

        assert_eq!(error.code(), "ambiguous_match");
    }
}
