use keyring_core::Entry as KeyringEntry;
use mail_parser::MessageParser;
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::json;
use std::env;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;

static ID_COUNTER: AtomicU64 = AtomicU64::new(0);

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
    "pipeline_stage",
];
const KOL_INT_FIELDS: &[&str] = &["archived", "brand_fit_score", "next_follow_up_at"];
const LEAD_SELECT: &str = "SELECT id, account_id, imap_uid, message_id, thread_id, from_name, from_email, raw_from, subject, snippet, received_at, category, hidden, confidence, kol_id, agent_reviewed_at, agent_review_note, human_confirmed, created_at, updated_at FROM marketing_email_leads";
const KOL_SELECT: &str = "SELECT id, name, email, country, relationship, collaboration_status, stage, owner, priority, tags, source, archived, brand_fit_score, risk_note, next_follow_up_at, last_contacted_at, agent_notes, human_notes, pipeline_stage, evaluation, outreach, intake, collaboration, shipment, created_at, updated_at FROM kol_profiles";

const EVAL_CRITERIA_KEYS: [&str; 6] = [
    "vertical",
    "language",
    "followers",
    "views",
    "engagement",
    "recency",
];

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
    pipeline_stage: String,
    evaluation: Option<String>,
    outreach: Option<String>,
    intake: Option<String>,
    collaboration: Option<String>,
    shipment: Option<String>,
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
    agent_reviewed_at: Option<i64>,
    agent_review_note: String,
    human_confirmed: bool,
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
    review_note: String,
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
    other: u32,
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
        [group, command, rest @ ..] if group == "leads" && command == "classify" => marketing_lead_classify(db_path, rest),
        [group, command, rest @ ..] if group == "leads" && command == "confirm" => marketing_lead_confirm(db_path, rest),
        [group, command, rest @ ..] if group == "leads" && command == "add" => marketing_lead_add(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "get" => marketing_kol_get(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "list" => marketing_kol_list(db_path, rest),
        [group, command, query, rest @ ..] if is_kol_group(group) && command == "find" => {
            marketing_kol_find(db_path, query, rest)
        }
        [group, command, rest @ ..] if is_kol_group(group) && command == "update" => marketing_kol_update(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "evaluate" => marketing_kol_evaluate(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "outreach" => marketing_kol_outreach(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "reply" => marketing_kol_reply(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "intake" => marketing_kol_intake(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "collaborate" => marketing_kol_collaborate(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "ship" => marketing_kol_ship(db_path, rest),
        [group, command, rest @ ..] if is_kol_group(group) && command == "delete" => marketing_kol_delete(db_path, rest),
        [group, command] if group == "settings" && command == "get" => marketing_settings_get(db_path),
        [group, command, rest @ ..] if group == "settings" && command == "set" => marketing_settings_set(db_path, rest),
        [group, command, rest @ ..] if group == "logs" && command == "list" => marketing_logs_list(db_path, rest),
        _ => Err(AppError::usage(
            "Expected: marketing snapshot | marketing accounts list|get | marketing email test|sync | marketing leads count|get|list|update|classify|confirm|add | marketing kols get|list|find|update|evaluate|outreach|reply|intake|collaborate|ship|delete | marketing settings get|set | marketing logs list",
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
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 0 AND category IN ('influencer', 'affiliate')",
        [],
    )?;
    let all_email_records = scalar_i64(&conn, "SELECT COUNT(*) FROM marketing_email_leads", [])?;
    let hidden = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 1",
        [],
    )?;
    let other_emails = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 1 OR category NOT IN ('influencer', 'affiliate')",
        [],
    )?;
    let kol_profiles = scalar_i64(
        &conn,
        "SELECT COUNT(*) FROM kol_profiles WHERE archived = 0",
        [],
    )?;
    let audit_logs = scalar_i64(&conn, "SELECT COUNT(*) FROM automation_audit_logs", [])?;
    let latest_leads_sql = format!(
        "{LEAD_SELECT} WHERE hidden = 0 AND category IN ('influencer', 'affiliate') ORDER BY COALESCE(received_at, updated_at) DESC LIMIT 8"
    );
    let latest_leads = query_leads(&conn, &latest_leads_sql, [])?;
    print_ok(
        "marketing.snapshot",
        db_path,
        json!({
            "emailLeads": email_leads,
            "allEmailRecords": all_email_records,
            "hidden": hidden,
            "otherEmails": other_emails,
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
        "SELECT COUNT(*) FROM marketing_email_leads WHERE hidden = 0 AND category IN ('influencer', 'affiliate')",
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
    let parsed = if field == "hidden" {
        FieldValue::Int(parse_bool_int(&value)?)
    } else {
        FieldValue::Text(Some(normalize_email_category_value(&value)?))
    };
    let conn = connect(db_path)?;
    let result = update_field(&conn, "marketing_email_leads", &id, &field, parsed, &reason)?;
    print_ok(
        "marketing.leads.update",
        db_path,
        json!({ "updated": [result] }),
    )
}

/// Step 1 初步分类：confirm/override a lead's category, optionally hide it, mark it
/// human-confirmed, and (for 达人) ensure a linked KOL profile exists.
fn marketing_lead_classify(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let category = normalize_email_category_value(&options.required("category")?)?;
    let hide = options.optional_bool("hide")?;
    let confirm = options.optional_bool("confirm")?.unwrap_or(true);
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 1 初步分类：确认邮件类别".to_string());
    let conn = connect(db_path)?;
    let lead = get_lead_email(&conn, &id)?;
    let mut updates = Vec::new();
    updates.push(update_field(
        &conn,
        "marketing_email_leads",
        &id,
        "category",
        FieldValue::Text(Some(category.clone())),
        &reason,
    )?);
    if let Some(hide) = hide {
        updates.push(update_field(
            &conn,
            "marketing_email_leads",
            &id,
            "hidden",
            FieldValue::Int(Some(bool_to_int(hide))),
            &reason,
        )?);
    }
    if confirm {
        updates.push(update_field(
            &conn,
            "marketing_email_leads",
            &id,
            "human_confirmed",
            FieldValue::Int(Some(1)),
            &reason,
        )?);
    }
    let mut kol_id = None;
    if category == "influencer" {
        let (kol_record_id, _created) = upsert_kol_from_email(&conn, &lead)?;
        updates.push(update_field(
            &conn,
            "marketing_email_leads",
            &id,
            "kol_id",
            FieldValue::Text(Some(kol_record_id.clone())),
            &reason,
        )?);
        kol_id = Some(kol_record_id);
    }
    print_ok(
        "marketing.leads.classify",
        db_path,
        json!({ "id": id, "category": category, "kolId": kol_id, "updated": updates }),
    )
}

fn marketing_lead_confirm(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 1 初步分类：人工确认分类".to_string());
    let conn = connect(db_path)?;
    let result = update_field(
        &conn,
        "marketing_email_leads",
        &id,
        "human_confirmed",
        FieldValue::Int(Some(1)),
        &reason,
    )?;
    print_ok(
        "marketing.leads.confirm",
        db_path,
        json!({ "updated": [result] }),
    )
}

/// Parse an RFC 5322 style `From` header (`Name <email>` or bare `email`) into
/// its display name, address, and the original raw string.
fn parse_from_header(raw: &str) -> (Option<String>, String, String) {
    let raw_from = raw.trim().to_string();
    if let (Some(start), Some(end)) = (raw_from.find('<'), raw_from.rfind('>')) {
        if start < end {
            let email = raw_from[start + 1..end].trim().to_string();
            let name = raw_from[..start].trim().trim_matches('"').trim().to_string();
            if !email.is_empty() {
                let name = if name.is_empty() { None } else { Some(name) };
                return (name, email, raw_from);
            }
        }
    }
    (None, raw_from.clone(), raw_from)
}

/// Seed a synthetic email lead for testing Step 1/Step 2 without a live IMAP
/// sync. Runs the same classifier + KOL linking path as a real sync so the lead
/// behaves exactly like one fetched from the mailbox.
fn marketing_lead_add(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let from = options.required("from")?;
    let subject = compact_text(&options.required("subject")?, 400);
    let snippet = compact_text(&options.required("snippet")?, 1200);
    let received_at = options.optional_i64("received-at")?.or_else(|| Some(now_millis()));
    let imap_uid = options
        .optional("uid")
        .unwrap_or_else(|| generate_id("seed"));
    let conn = connect(db_path)?;
    let account = resolve_seed_account(&conn, options.optional("account-id"))?;
    let (from_name, from_email, raw_from) = parse_from_header(&from);
    let email = RawMarketingEmail {
        imap_uid,
        message_id: options.optional("message-id"),
        thread_id: options.optional("thread-id"),
        from_name,
        from_email,
        raw_from,
        subject,
        snippet,
        received_at,
    };
    let imap_uid = email.imap_uid.clone();
    let result = upsert_marketing_email_leads(&conn, &account, vec![email])?;
    let sql = format!("{LEAD_SELECT} WHERE account_id = ?1 AND imap_uid = ?2");
    let lead = query_leads(&conn, &sql, params![account.id, imap_uid])?
        .into_iter()
        .next();
    print_ok(
        "marketing.leads.add",
        db_path,
        json!({
            "accountId": account.id,
            "inserted": result.inserted,
            "updated": result.updated,
            "kolCreated": result.kol_created,
            "lead": lead,
        }),
    )
}

/// Pick the account a seeded lead should belong to: the requested id, otherwise
/// the first known account (enabled or not), otherwise a synthetic placeholder.
fn resolve_seed_account(
    conn: &Connection,
    account_id: Option<String>,
) -> Result<AccountConfig, AppError> {
    if let Some(account_id) = account_id {
        if let Ok(account) = get_account_row(conn, &account_id) {
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
        return Ok(synthetic_seed_account(&account_id));
    }
    if let Some(account) = query_account_configs(conn, true)?.into_iter().next() {
        return Ok(account);
    }
    Ok(synthetic_seed_account("seed-demo"))
}

fn synthetic_seed_account(id: &str) -> AccountConfig {
    AccountConfig {
        id: id.to_string(),
        label: "测试邮箱".to_string(),
        host: String::new(),
        port: 993,
        tls: true,
        username: String::new(),
        mailbox: "INBOX".to_string(),
        scan_limit: 0,
        enabled: false,
    }
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

/// Permanently remove KOL profiles (and cascade their accounts/collaborations/
/// posts via FK). Referencing email leads are unlinked first so the inbox keeps
/// its history. Use `--all` to purge every KOL when starting from a clean slate.
fn marketing_kol_delete(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.optional("id");
    let query = options.optional("query");
    let purge_all = options.flag("all");
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "删除网红档案（agent 执行）".to_string());
    let conn = connect(db_path)?;
    let target_ids: Vec<String> = if let Some(id) = id {
        ensure_kol_exists(&conn, &id)?;
        vec![id]
    } else if let Some(query) = query {
        let matches = find_kols(&conn, &query, 500)?;
        if matches.is_empty() {
            return Err(AppError::not_found(format!("No KOL matched query={query:?}")));
        }
        if matches.len() > 1 && !purge_all {
            return Err(AppError::ambiguous(
                "Multiple KOLs matched. Rerun with --all to delete every match, or pass --id for a single record.",
                json!({ "matches": matches }),
            ));
        }
        matches.into_iter().map(|item| item.id).collect()
    } else if purge_all {
        let mut stmt = conn.prepare("SELECT id FROM kol_profiles ORDER BY created_at")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        collect_rows(rows)?
    } else {
        return Err(AppError::usage(
            "marketing kols delete requires --id, --query, or --all",
        ));
    };
    let mut deleted = Vec::new();
    for target_id in target_ids {
        let label: Option<String> = conn
            .query_row(
                "SELECT COALESCE(NULLIF(email, ''), name) FROM kol_profiles WHERE id = ?1",
                params![target_id],
                |row| row.get(0),
            )
            .optional()?;
        let now = now_millis();
        let unlinked = conn.execute(
            "UPDATE marketing_email_leads SET kol_id = NULL, updated_at = ?1 WHERE kol_id = ?2",
            params![now, target_id],
        )?;
        let removed = conn.execute(
            "DELETE FROM kol_profiles WHERE id = ?1",
            params![target_id],
        )?;
        if removed == 0 {
            continue;
        }
        insert_audit(
            &conn,
            "kol_profiles",
            &target_id,
            "deleted",
            label.as_deref(),
            None,
            &reason,
        )?;
        deleted.push(json!({
            "id": target_id,
            "label": label,
            "unlinkedLeads": unlinked,
        }));
    }
    print_ok(
        "marketing.kols.delete",
        db_path,
        json!({ "deletedCount": deleted.len(), "deleted": deleted }),
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvalCriterionInput {
    key: String,
    #[serde(default)]
    label: Option<String>,
    // Accepted for API symmetry; the canonical hard/soft kind comes from the rubric catalog.
    #[serde(default)]
    #[allow(dead_code)]
    kind: Option<String>,
    status: String,
    #[serde(default)]
    detail: Option<String>,
}

#[derive(Clone)]
struct NormalizedCriterion {
    key: String,
    label: String,
    kind: String,
    status: String,
    detail: String,
}

fn eval_criterion_meta(key: &str) -> (&'static str, &'static str) {
    match key {
        "vertical" => ("应用场景与 ZERO BREEZE 垂直", "hard"),
        "language" => ("国家/语言合适（非西/德语）", "hard"),
        "followers" => ("粉丝量 ≥ 10k", "soft"),
        "views" => ("播放量 ≥ 粉丝数 30%", "soft"),
        "engagement" => ("平均点赞/评论 ≥ 100", "soft"),
        "recency" => ("近 30 天持续更新", "soft"),
        _ => ("其他指标", "soft"),
    }
}

fn normalize_eval_status(value: &str) -> String {
    match value.trim().to_lowercase().as_str() {
        "pass" | "yes" | "true" | "1" | "ok" => "pass".to_string(),
        "fail" | "no" | "false" | "0" => "fail".to_string(),
        _ => "unknown".to_string(),
    }
}

fn normalize_eval_criteria(inputs: &[EvalCriterionInput]) -> Vec<NormalizedCriterion> {
    EVAL_CRITERIA_KEYS
        .iter()
        .map(|key| {
            let (default_label, kind) = eval_criterion_meta(key);
            let provided = inputs.iter().find(|item| item.key.trim() == *key);
            let status = provided
                .map(|item| normalize_eval_status(&item.status))
                .unwrap_or_else(|| "unknown".to_string());
            let label = provided
                .and_then(|item| item.label.clone())
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(|| default_label.to_string());
            let detail = provided
                .and_then(|item| item.detail.clone())
                .unwrap_or_default();
            NormalizedCriterion {
                key: (*key).to_string(),
                label,
                kind: kind.to_string(),
                status,
                detail: compact_text(&detail, 400),
            }
        })
        .collect()
}

fn compute_eval_verdict(criteria: &[NormalizedCriterion]) -> String {
    if criteria.is_empty() {
        return "pending".to_string();
    }
    let hard: Vec<&NormalizedCriterion> = criteria.iter().filter(|c| c.kind == "hard").collect();
    let soft: Vec<&NormalizedCriterion> = criteria.iter().filter(|c| c.kind == "soft").collect();
    // Hard requirements gate everything: any fail is an immediate reject; any
    // unknown hard criterion leaves the outcome undecidable (pending).
    if hard.iter().any(|c| c.status == "fail") {
        return "fail".to_string();
    }
    if hard.iter().any(|c| c.status == "unknown") {
        return "pending".to_string();
    }
    // All hard criteria pass. Need at least two soft passes.
    let soft_pass = soft.iter().filter(|c| c.status == "pass").count();
    let soft_unknown = soft.iter().filter(|c| c.status == "unknown").count();
    if soft_pass >= 2 {
        "pass".to_string()
    } else if soft_pass + soft_unknown >= 2 {
        // Could still reach the threshold once the unknown soft metrics are resolved.
        "pending".to_string()
    } else {
        "fail".to_string()
    }
}

fn compute_eval_score(criteria: &[NormalizedCriterion]) -> i64 {
    if criteria.is_empty() {
        return 0;
    }
    let pass = criteria.iter().filter(|c| c.status == "pass").count() as i64;
    ((pass * 100) / criteria.len() as i64).clamp(0, 100)
}

fn default_recommendation(verdict: &str) -> String {
    match verdict {
        "pass" => "proposal".to_string(),
        "fail" => "reject".to_string(),
        _ => "hold".to_string(),
    }
}

/// Step 2 网红评估：persist the structured evaluation JSON and advance the pipeline.
fn marketing_kol_evaluate(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let criteria_json = options.required("criteria")?;
    let summary = compact_text(&options.optional("summary").unwrap_or_default(), 1200);
    let confirm_override = options.optional_bool("confirm")?;
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 2 网红评估：写入评估结论".to_string());
    let inputs: Vec<EvalCriterionInput> = serde_json::from_str(&criteria_json)
        .map_err(|error| AppError::usage(format!("--criteria must be a JSON array: {error}")))?;
    let conn = connect(db_path)?;
    // When --confirm is omitted, follow the persisted agent_auto_confirm switch:
    // on → finalize automatically, off → save as a draft for human confirmation.
    let confirm = confirm_override.unwrap_or_else(|| agent_auto_confirm(&conn));
    ensure_kol_exists(&conn, &id)?;
    let criteria = normalize_eval_criteria(&inputs);
    let verdict = compute_eval_verdict(&criteria);
    let score = compute_eval_score(&criteria);
    let recommendation = options
        .optional("recommendation")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| default_recommendation(&verdict));
    let now = now_millis();
    let evaluation = json!({
        "status": verdict,
        "confirmed": confirm,
        "by": "agent",
        "at": now,
        "score": score,
        "summary": summary,
        "recommendation": recommendation,
        "criteria": criteria.iter().map(|c| json!({
            "key": c.key,
            "label": c.label,
            "kind": c.kind,
            "status": c.status,
            "detail": c.detail,
        })).collect::<Vec<_>>(),
    });
    let evaluation_text = serde_json::to_string(&evaluation)?;
    let mut updates = Vec::new();
    updates.push(update_field(
        &conn,
        "kol_profiles",
        &id,
        "evaluation",
        FieldValue::Text(Some(evaluation_text)),
        &reason,
    )?);
    let stage = if confirm {
        match verdict.as_str() {
            "pass" => "qualified",
            "fail" => "rejected",
            _ => "evaluate",
        }
    } else {
        "evaluate"
    };
    updates.push(update_field(
        &conn,
        "kol_profiles",
        &id,
        "pipeline_stage",
        FieldValue::Text(Some(stage.to_string())),
        &reason,
    )?);
    if confirm {
        let status = match verdict.as_str() {
            "pass" => "跟进中",
            "fail" => "不适合",
            _ => "待分配",
        };
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "collaboration_status",
            FieldValue::Text(Some(status.to_string())),
            &reason,
        )?);
    }
    print_ok(
        "marketing.kols.evaluate",
        db_path,
        json!({
            "id": id,
            "verdict": verdict,
            "score": score,
            "recommendation": recommendation,
            "confirmed": confirm,
            "criteria": criteria.iter().map(|c| json!({
                "key": c.key,
                "label": c.label,
                "kind": c.kind,
                "status": c.status,
                "detail": c.detail,
            })).collect::<Vec<_>>(),
            "updated": updates,
        }),
    )
}

/// Step 3 评估后处理：record the outreach action for an evaluated KOL. Sending a
/// proposal to a qualified KOL advances it to onboarding (推进合作); rejections
/// stay rejected. Pass --skip to log that no message was sent.
fn marketing_kol_outreach(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let status = if options.flag("skip")
        || matches!(
            options.optional("status").as_deref().map(str::trim),
            Some("skipped") | Some("skip")
        ) {
        "skipped"
    } else {
        "sent"
    };
    let conn = connect(db_path)?;
    ensure_kol_exists(&conn, &id)?;
    let stage: String = conn.query_row(
        "SELECT pipeline_stage FROM kol_profiles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let kind = options
        .optional("kind")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if status == "skipped" {
                "skip".to_string()
            } else if stage == "rejected" {
                "reject".to_string()
            } else {
                "proposal".to_string()
            }
        });
    let script_id = options
        .optional("script-id")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let channel = options
        .optional("channel")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let note = compact_text(&options.optional("note").unwrap_or_default(), 600);
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 3 评估后处理：记录外联动作".to_string());
    let (new_stage, updates) = record_outreach(
        &conn,
        &id,
        status,
        &kind,
        script_id.as_deref(),
        channel.as_deref(),
        &note,
        &reason,
    )?;
    print_ok(
        "marketing.kols.outreach",
        db_path,
        json!({
            "id": id,
            "status": status,
            "kind": kind,
            "stage": new_stage,
            "updated": updates,
        }),
    )
}

/// Write the Step 3 outreach JSON and advance the pipeline. Shared by both
/// `kols outreach` (record only) and `kols reply` (send + record). Returns the
/// resulting pipeline stage and the list of field updates for the response.
fn record_outreach(
    conn: &Connection,
    id: &str,
    status: &str,
    kind: &str,
    script_id: Option<&str>,
    channel: Option<&str>,
    note: &str,
    reason: &str,
) -> Result<(String, Vec<UpdateResult>), AppError> {
    let stage: String = conn.query_row(
        "SELECT pipeline_stage FROM kol_profiles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let now = now_millis();
    let outreach = json!({
        "status": status,
        "kind": kind,
        "scriptId": script_id,
        "channel": channel,
        "note": if note.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(note.to_string()) },
        "by": "agent",
        "at": now,
    });
    let outreach_text = serde_json::to_string(&outreach)?;
    let mut updates = Vec::new();
    updates.push(update_field(
        conn,
        "kol_profiles",
        id,
        "outreach",
        FieldValue::Text(Some(outreach_text)),
        reason,
    )?);
    let mut new_stage = stage.clone();
    if status == "sent" {
        updates.push(update_field(
            conn,
            "kol_profiles",
            id,
            "last_contacted_at",
            FieldValue::Int(Some(now)),
            reason,
        )?);
        if let Some(next) = outreach_stage_after(&stage, status) {
            new_stage = next.to_string();
            updates.push(update_field(
                conn,
                "kol_profiles",
                id,
                "pipeline_stage",
                FieldValue::Text(Some(next.to_string())),
                reason,
            )?);
            updates.push(update_field(
                conn,
                "kol_profiles",
                id,
                "collaboration_status",
                FieldValue::Text(Some("已发提案".to_string())),
                reason,
            )?);
        }
    }
    Ok((new_stage, updates))
}

/// Step 3 stage transition: sending a proposal to a qualified KOL advances it to
/// onboarding (推进合作). Everything else (rejections, skips) keeps the stage.
fn outreach_stage_after(current: &str, status: &str) -> Option<&'static str> {
    if status == "sent" && current == "qualified" {
        Some("onboarding")
    } else {
        None
    }
}

/// Step 3 一键回复 (agent path): send the reply email via SMTP, then record the
/// outreach exactly like `kols outreach`. `--send` defaults to the
/// agent_auto_reply setting; pass `--send false` to record without sending.
fn marketing_kol_reply(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let body = options.required("body")?;
    if body.trim().is_empty() {
        return Err(AppError::usage("--body 不能为空"));
    }
    let conn = connect(db_path)?;
    ensure_kol_exists(&conn, &id)?;
    let auto = agent_auto_reply(&conn);
    let do_send = options.optional_bool("send")?.unwrap_or(auto);
    let stage: String = conn.query_row(
        "SELECT pipeline_stage FROM kol_profiles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let kind = options
        .optional("kind")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            if stage == "rejected" {
                "reject".to_string()
            } else {
                "proposal".to_string()
            }
        });
    let script_id = options
        .optional("script-id")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let channel = options
        .optional("channel")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "Email".to_string());
    let note = compact_text(&options.optional("note").unwrap_or_default(), 600);
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 3 评估后处理：一键回复".to_string());

    let (kol_name, kol_email): (String, String) = conn.query_row(
        "SELECT name, email FROM kol_profiles WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let lead = latest_lead_for_kol(&conn, &id)?;
    let to = options
        .optional("to")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| lead.as_ref().map(|item| item.0.clone()))
        .unwrap_or(kol_email);
    let subject = options
        .optional("subject")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            ensure_reply_subject(
                lead.as_ref()
                    .map(|item| item.1.as_str())
                    .unwrap_or("Partnership with ZERO BREEZE"),
            )
        });
    let in_reply_to = lead.as_ref().and_then(|item| item.2.clone());
    let account_id = lead.as_ref().map(|item| item.3.clone());

    let mut sent = false;
    if do_send {
        let account = match account_id {
            Some(ref account_id) => resolve_account(&conn, Some(account_id.clone()))?,
            None => resolve_account(&conn, None)?,
        };
        let password = marketing_email_password(&account)?;
        send_marketing_email_reply(
            &account,
            &password,
            &to,
            Some(&kol_name),
            &subject,
            body.trim(),
            in_reply_to.as_deref(),
        )?;
        sent = true;
    }

    let (new_stage, updates) = record_outreach(
        &conn,
        &id,
        "sent",
        &kind,
        script_id.as_deref(),
        Some(&channel),
        &note,
        &reason,
    )?;
    print_ok(
        "marketing.kols.reply",
        db_path,
        json!({
            "id": id,
            "sent": sent,
            "to": to,
            "subject": subject,
            "kind": kind,
            "stage": new_stage,
            "updated": updates,
        }),
    )
}

/// Linear position of a KOL in the 6-step funnel; advance the pipeline only forward.
fn stage_rank(stage: &str) -> i32 {
    match stage {
        "classify" => 0,
        "evaluate" => 1,
        "qualified" | "rejected" => 2,
        "onboarding" => 3,
        "intake" => 4,
        "signed" => 5,
        "shipped" => 6,
        "completed" => 7,
        _ => 1,
    }
}

/// Send an email to a KOL (Step 5 合同 / Step 6 发货通知) reusing the linked lead
/// for recipient/subject/thread and the saved account (→ SMTP). Returns the `to`.
fn send_kol_email(
    conn: &Connection,
    kol_id: &str,
    kol_name: &str,
    kol_email: &str,
    to_override: Option<&str>,
    subject_override: Option<&str>,
    body: &str,
    default_subject: &str,
) -> Result<String, AppError> {
    let lead = latest_lead_for_kol(conn, kol_id)?;
    let to = to_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| lead.as_ref().map(|item| item.0.clone()))
        .unwrap_or_else(|| kol_email.to_string());
    let subject = subject_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            ensure_reply_subject(
                lead.as_ref()
                    .map(|item| item.1.as_str())
                    .unwrap_or(default_subject),
            )
        });
    let in_reply_to = lead.as_ref().and_then(|item| item.2.clone());
    let account = match lead.as_ref().map(|item| item.3.clone()) {
        Some(account_id) => resolve_account(conn, Some(account_id))?,
        None => resolve_account(conn, None)?,
    };
    let password = marketing_email_password(&account)?;
    send_marketing_email_reply(
        &account,
        &password,
        &to,
        Some(kol_name),
        &subject,
        body,
        in_reply_to.as_deref(),
    )?;
    Ok(to)
}

/// Step 4 录入系统: store the structured intake JSON, mirror owner/relationship to
/// the real columns, and advance onboarding → intake when status=done.
fn marketing_kol_intake(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let conn = connect(db_path)?;
    ensure_kol_exists(&conn, &id)?;
    let stage: String = conn.query_row(
        "SELECT pipeline_stage FROM kol_profiles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let status = match options.optional("status").as_deref().map(str::trim) {
        Some("draft") => "draft",
        _ => "done",
    };
    let opt = |key: &str| {
        options
            .optional(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let owner = opt("owner");
    let relationship = opt("relationship");
    let note = compact_text(&options.optional("note").unwrap_or_default(), 800);
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 4 录入系统".to_string());
    let now = now_millis();
    let intake = json!({
        "status": status,
        "username": opt("username"),
        "owner": owner.clone(),
        "channel": opt("channel"),
        "relationship": relationship.clone(),
        "phone": opt("phone"),
        "platforms": opt("platforms"),
        "links": opt("links"),
        "contentType": opt("content-type"),
        "language": opt("language"),
        "metrics": opt("metrics"),
        "note": if note.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(note) },
        "by": "agent",
        "at": now,
    });
    let mut updates = Vec::new();
    updates.push(update_field(
        &conn,
        "kol_profiles",
        &id,
        "intake",
        FieldValue::Text(Some(serde_json::to_string(&intake)?)),
        &reason,
    )?);
    if let Some(owner) = owner {
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "owner",
            FieldValue::Text(Some(owner)),
            &reason,
        )?);
    }
    if let Some(relationship) = relationship {
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "relationship",
            FieldValue::Text(Some(relationship)),
            &reason,
        )?);
    }
    let mut new_stage = stage.clone();
    if status == "done" && stage == "onboarding" {
        new_stage = "intake".to_string();
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "pipeline_stage",
            FieldValue::Text(Some("intake".to_string())),
            &reason,
        )?);
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "collaboration_status",
            FieldValue::Text(Some("已录入系统".to_string())),
            &reason,
        )?);
    }
    print_ok(
        "marketing.kols.intake",
        db_path,
        json!({ "id": id, "status": status, "stage": new_stage, "updated": updates }),
    )
}

/// Step 5 合作推进: optionally send the contract email, then record the contract
/// push / signing; status=signed advances the pipeline to `signed`.
fn marketing_kol_collaborate(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let conn = connect(db_path)?;
    ensure_kol_exists(&conn, &id)?;
    let stage: String = conn.query_row(
        "SELECT pipeline_stage FROM kol_profiles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let status = match options.optional("status").as_deref().map(str::trim) {
        Some("signed") => "signed",
        Some("declined") => "declined",
        _ => "sent",
    };
    let script_id = options
        .optional("script-id")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let contract_url = options
        .optional("contract-url")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let video_count = options.optional_i64("video-count")?;
    let note = compact_text(&options.optional("note").unwrap_or_default(), 800);
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 5 合作推进".to_string());

    let do_send = options.optional_bool("send")?.unwrap_or(false);
    let mut sent = false;
    if do_send {
        let body = options.required("body")?;
        if body.trim().is_empty() {
            return Err(AppError::usage("--body 不能为空"));
        }
        let (kol_name, kol_email): (String, String) = conn.query_row(
            "SELECT name, email FROM kol_profiles WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let to_opt = options.optional("to");
        let subject_opt = options.optional("subject");
        send_kol_email(
            &conn,
            &id,
            &kol_name,
            &kol_email,
            to_opt.as_deref(),
            subject_opt.as_deref(),
            body.trim(),
            "Your ZERO BREEZE collaboration contract",
        )?;
        sent = true;
    }

    let now = now_millis();
    let collab = json!({
        "status": status,
        "scriptId": script_id,
        "contractUrl": contract_url,
        "videoCount": video_count,
        "note": if note.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(note) },
        "by": "agent",
        "at": now,
    });
    let mut updates = Vec::new();
    updates.push(update_field(
        &conn,
        "kol_profiles",
        &id,
        "collaboration",
        FieldValue::Text(Some(serde_json::to_string(&collab)?)),
        &reason,
    )?);
    if sent {
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "last_contacted_at",
            FieldValue::Int(Some(now)),
            &reason,
        )?);
    }
    let collaboration_status = match status {
        "signed" => "已签约",
        "declined" => "已流失",
        _ => "已发合同",
    };
    updates.push(update_field(
        &conn,
        "kol_profiles",
        &id,
        "collaboration_status",
        FieldValue::Text(Some(collaboration_status.to_string())),
        &reason,
    )?);
    let mut new_stage = stage.clone();
    if status == "signed" && stage_rank(&stage) < stage_rank("signed") {
        new_stage = "signed".to_string();
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "pipeline_stage",
            FieldValue::Text(Some("signed".to_string())),
            &reason,
        )?);
    }
    print_ok(
        "marketing.kols.collaborate",
        db_path,
        json!({ "id": id, "status": status, "sent": sent, "stage": new_stage, "updated": updates }),
    )
}

/// Step 6 发货流程: optionally send the shipping notice, then record fulfillment;
/// shipped → `shipped`, delivered → `completed`.
fn marketing_kol_ship(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let id = options.required("id")?;
    let conn = connect(db_path)?;
    ensure_kol_exists(&conn, &id)?;
    let stage: String = conn.query_row(
        "SELECT pipeline_stage FROM kol_profiles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let status = match options.optional("status").as_deref().map(str::trim) {
        Some("delivered") => "delivered",
        Some("issue") => "issue",
        _ => "shipped",
    };
    let opt = |key: &str| {
        options
            .optional(key)
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let note = compact_text(&options.optional("note").unwrap_or_default(), 800);
    let expected_post_at = options.optional_i64("expected-post-at")?;
    let reason = options
        .optional("reason")
        .unwrap_or_else(|| "Step 6 发货流程".to_string());

    let do_send = options.optional_bool("send")?.unwrap_or(false);
    let mut sent = false;
    if do_send {
        let body = options.required("body")?;
        if body.trim().is_empty() {
            return Err(AppError::usage("--body 不能为空"));
        }
        let (kol_name, kol_email): (String, String) = conn.query_row(
            "SELECT name, email FROM kol_profiles WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let to_opt = options.optional("to");
        let subject_opt = options.optional("subject");
        send_kol_email(
            &conn,
            &id,
            &kol_name,
            &kol_email,
            to_opt.as_deref(),
            subject_opt.as_deref(),
            body.trim(),
            "Your ZERO BREEZE shipment",
        )?;
        sent = true;
    }

    let now = now_millis();
    let shipment = json!({
        "status": status,
        "carrier": opt("carrier"),
        "tracking": opt("tracking"),
        "trackingUrl": opt("tracking-url"),
        "address": opt("address"),
        "units": opt("units"),
        "expectedPostAt": expected_post_at,
        "note": if note.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(note) },
        "by": "agent",
        "at": now,
    });
    let mut updates = Vec::new();
    updates.push(update_field(
        &conn,
        "kol_profiles",
        &id,
        "shipment",
        FieldValue::Text(Some(serde_json::to_string(&shipment)?)),
        &reason,
    )?);
    if sent {
        updates.push(update_field(
            &conn,
            "kol_profiles",
            &id,
            "last_contacted_at",
            FieldValue::Int(Some(now)),
            &reason,
        )?);
    }
    let collaboration_status = match status {
        "delivered" => "已完成",
        "issue" => "物流异常",
        _ => "已发货",
    };
    updates.push(update_field(
        &conn,
        "kol_profiles",
        &id,
        "collaboration_status",
        FieldValue::Text(Some(collaboration_status.to_string())),
        &reason,
    )?);
    let target = match status {
        "delivered" => Some("completed"),
        "shipped" => Some("shipped"),
        _ => None,
    };
    let mut new_stage = stage.clone();
    if let Some(target) = target {
        if stage_rank(&stage) < stage_rank(target) {
            new_stage = target.to_string();
            updates.push(update_field(
                &conn,
                "kol_profiles",
                &id,
                "pipeline_stage",
                FieldValue::Text(Some(target.to_string())),
                &reason,
            )?);
        }
    }
    print_ok(
        "marketing.kols.ship",
        db_path,
        json!({ "id": id, "status": status, "sent": sent, "stage": new_stage, "updated": updates }),
    )
}

/// Returns (from_email, subject, message_id, account_id) of the most recent
/// email lead linked to a KOL, so a reply can target the original thread.
fn latest_lead_for_kol(
    conn: &Connection,
    kol_id: &str,
) -> Result<Option<(String, String, Option<String>, String)>, AppError> {
    conn.query_row(
        "SELECT from_email, subject, message_id, account_id FROM marketing_email_leads WHERE kol_id = ?1 ORDER BY COALESCE(received_at, updated_at) DESC LIMIT 1",
        params![kol_id],
        |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        },
    )
    .optional()
    .map_err(AppError::from)
}

fn ensure_reply_subject(subject: &str) -> String {
    let trimmed = subject.trim();
    if trimmed.is_empty() {
        "Re: Partnership with ZERO BREEZE".to_string()
    } else if trimmed.to_ascii_lowercase().starts_with("re:") {
        trimmed.to_string()
    } else {
        format!("Re: {trimmed}")
    }
}

/// Gmail-style SMTP host derivation: imap.gmail.com -> smtp.gmail.com.
fn smtp_host_for(host: &str) -> String {
    let host = host.trim();
    match host.strip_prefix("imap.") {
        Some(rest) => format!("smtp.{rest}"),
        None => host.to_string(),
    }
}

fn send_marketing_email_reply(
    account: &AccountConfig,
    password: &str,
    to_addr: &str,
    to_name: Option<&str>,
    subject: &str,
    body: &str,
    in_reply_to: Option<&str>,
) -> Result<(), AppError> {
    use lettre::message::{header::ContentType, Mailbox, Message};
    use lettre::transport::smtp::authentication::Credentials;
    use lettre::{Address, SmtpTransport, Transport};

    let from_address: Address = account
        .username
        .parse()
        .map_err(|_| AppError::usage(format!("发件邮箱地址无效：{}", account.username)))?;
    let from = Mailbox::new(Some(account.label.clone()), from_address);
    let to_address: Address = to_addr
        .parse()
        .map_err(|_| AppError::usage(format!("收件邮箱地址无效：{to_addr}")))?;
    let to = Mailbox::new(
        to_name
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        to_address,
    );
    let mut builder = Message::builder()
        .from(from)
        .to(to)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN);
    if let Some(message_id) = in_reply_to.map(str::trim).filter(|value| !value.is_empty()) {
        let normalized = message_id
            .trim_start_matches('<')
            .trim_end_matches('>')
            .to_string();
        builder = builder
            .in_reply_to(normalized.clone())
            .references(normalized);
    }
    let email = builder
        .body(body.to_string())
        .map_err(|e| AppError::external(format!("构建邮件失败：{e}")))?;

    let smtp_host = smtp_host_for(&account.host);
    let credentials = Credentials::new(account.username.clone(), password.to_string());
    let mailer = SmtpTransport::relay(&smtp_host)
        .map_err(|e| AppError::external(format!("无法连接 SMTP 服务器 {smtp_host}：{e}")))?
        .credentials(credentials)
        .build();
    mailer
        .send(&email)
        .map_err(|e| AppError::external(format!("发送邮件失败：{e}")))?;
    Ok(())
}

fn settings_json(conn: &Connection) -> serde_json::Value {
    json!({
        "agentAutoConfirm": agent_auto_confirm(conn),
        "agentAutoReply": agent_auto_reply(conn),
    })
}

fn marketing_settings_get(db_path: &Path) -> Result<(), AppError> {
    let conn = connect(db_path)?;
    print_ok("marketing.settings.get", db_path, settings_json(&conn))
}

/// Toggle workflow preferences. `--agent-auto-confirm true` lets the agent
/// finalize evaluations without waiting for a human to click 确认结论.
fn marketing_settings_set(db_path: &Path, args: &[String]) -> Result<(), AppError> {
    let options = ParsedOptions::parse(args)?;
    let conn = connect(db_path)?;
    let mut changed = Vec::new();
    if let Some(value) = options.optional_bool("agent-auto-confirm")? {
        let text = if value { "true" } else { "false" };
        set_setting(&conn, SETTING_AGENT_AUTO_CONFIRM, text)?;
        insert_audit(
            &conn,
            "marketing_settings",
            SETTING_AGENT_AUTO_CONFIRM,
            "agent_auto_confirm",
            None,
            Some(text),
            "更新 Agent 自动确认开关",
        )?;
        changed.push("agentAutoConfirm");
    }
    if let Some(value) = options.optional_bool("agent-auto-reply")? {
        let text = if value { "true" } else { "false" };
        set_setting(&conn, SETTING_AGENT_AUTO_REPLY, text)?;
        insert_audit(
            &conn,
            "marketing_settings",
            SETTING_AGENT_AUTO_REPLY,
            "agent_auto_reply",
            None,
            Some(text),
            "更新 Agent 自主回复开关",
        )?;
        changed.push("agentAutoReply");
    }
    if changed.is_empty() {
        return Err(AppError::usage(
            "marketing settings set requires --agent-auto-confirm true|false or --agent-auto-reply true|false",
        ));
    }
    print_ok(
        "marketing.settings.set",
        db_path,
        json!({ "changed": changed, "settings": settings_json(&conn) }),
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

fn normalize_email_category_value(value: &str) -> Result<String, AppError> {
    match value.trim() {
        "influencer" | "affiliate" | "other" => Ok(value.trim().to_string()),
        "ad" => Ok("other".to_string()),
        _ => Err(AppError::usage(
            "category must be influencer, affiliate, or other",
        )),
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

fn get_lead_email(conn: &Connection, lead_id: &str) -> Result<RawMarketingEmail, AppError> {
    conn.query_row(
        "SELECT from_name, from_email, raw_from, subject, snippet, received_at, message_id, thread_id, imap_uid FROM marketing_email_leads WHERE id = ?1",
        params![lead_id],
        |row| {
            Ok(RawMarketingEmail {
                from_name: row.get(0)?,
                from_email: row.get(1)?,
                raw_from: row.get(2)?,
                subject: row.get(3)?,
                snippet: row.get(4)?,
                received_at: row.get(5)?,
                message_id: row.get(6)?,
                thread_id: row.get(7)?,
                imap_uid: row.get(8)?,
            })
        },
    )
    .optional()?
    .ok_or_else(|| AppError::not_found(format!("No lead with id={lead_id}")))
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
        pipeline_stage: row.get(18)?,
        evaluation: row.get(19)?,
        outreach: row.get(20)?,
        intake: row.get(21)?,
        collaboration: row.get(22)?,
        shipment: row.get(23)?,
        created_at: row.get(24)?,
        updated_at: row.get(25)?,
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
        agent_reviewed_at: row.get(15)?,
        agent_review_note: row.get(16)?,
        human_confirmed: int_to_bool(row.get(17)?),
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
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
        .query_row(&sql, params![id], |row| row.get::<_, Option<String>>(0))
        .optional()?
        .flatten();
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
    let affiliate_hits = matching_terms(&text, &affiliate_terms);
    if !affiliate_hits.is_empty() {
        return MarketingClassification {
            category: "affiliate".to_string(),
            confidence: 0.82,
            review_note: marketing_review_note(email, "联盟", &affiliate_hits),
        };
    }
    let strong_influencer_terms = [
        "influencer",
        "content creator",
        "tiktok creator",
        "instagram creator",
        "youtube creator",
        "ugc creator",
        "网红",
        "达人",
        "博主",
    ];
    let influencer_terms = [
        "creator",
        "ugc",
        "tiktok",
        "instagram",
        "youtube",
        "xiao hong shu",
        "小红书",
        "抖音",
        "followers",
        "粉丝",
        "ig reel",
        "reel",
        "shorts",
        "unboxing",
        "product review",
        "collaboration",
        "collab",
        "合作",
        "种草",
        "带货",
    ];
    let strong_hits = matching_terms(&text, &strong_influencer_terms);
    let influencer_hits = matching_terms(&text, &influencer_terms);
    if !strong_hits.is_empty() || influencer_hits.len() >= 2 {
        let mut evidence = strong_hits;
        for hit in influencer_hits {
            if !evidence.contains(&hit) {
                evidence.push(hit);
            }
        }
        return MarketingClassification {
            category: "influencer".to_string(),
            confidence: if evidence.len() >= 3 { 0.88 } else { 0.76 },
            review_note: marketing_review_note(email, "达人", &evidence),
        };
    }
    let other_terms = [
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
    let other_hits = matching_terms(&text, &other_terms);
    if !other_hits.is_empty() {
        return MarketingClassification {
            category: "other".to_string(),
            confidence: 0.72,
            review_note: marketing_review_note(email, "其他", &other_hits),
        };
    }
    MarketingClassification {
        category: "other".to_string(),
        confidence: 0.58,
        review_note: marketing_review_note(email, "其他", &[]),
    }
}

fn matching_terms(text: &str, terms: &[&str]) -> Vec<String> {
    terms
        .iter()
        .filter(|term| text.contains(**term))
        .map(|term| (*term).to_string())
        .collect()
}

fn marketing_review_note(email: &RawMarketingEmail, label: &str, evidence: &[String]) -> String {
    let basis = if evidence.is_empty() {
        "未发现明确达人或联盟合作证据".to_string()
    } else {
        format!("命中 {}", evidence.join(", "))
    };
    compact_text(
        &format!(
            "Agent 已阅读邮件内容；分类：{label}；依据：{basis}；发件人：{}；主题：{}；摘要：{}",
            email.raw_from, email.subject, email.snippet
        ),
        900,
    )
}

fn upsert_marketing_email_leads(
    conn: &Connection,
    account: &AccountConfig,
    emails: Vec<RawMarketingEmail>,
) -> Result<SyncResult, AppError> {
    let mut inserted = 0_u32;
    let mut updated = 0_u32;
    let mut hidden = 0_u32;
    let mut other = 0_u32;
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
        let is_hidden = false;
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
              (id, account_id, imap_uid, message_id, thread_id, from_name, from_email, raw_from, subject, snippet, received_at, category, hidden, confidence, kol_id, agent_reviewed_at, agent_review_note, created_at, updated_at)
            VALUES
              (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?16, ?16)
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
              hidden=CASE WHEN marketing_email_leads.hidden = 1 THEN 1 ELSE excluded.hidden END,
              confidence=excluded.confidence,
              kol_id=excluded.kol_id,
              agent_reviewed_at=excluded.agent_reviewed_at,
              agent_review_note=excluded.agent_review_note,
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
                classification.category.as_str(),
                bool_to_int(is_hidden),
                classification.confidence,
                kol_id,
                now,
                classification.review_note,
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
        if classification.category == "other" {
            other += 1;
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
        other,
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
            "UPDATE kol_profiles SET last_contacted_at = COALESCE(?1, last_contacted_at), agent_notes = CASE WHEN COALESCE(agent_notes, '') = '' THEN ?2 ELSE agent_notes END, updated_at = ?3 WHERE id = ?4",
            params![email.received_at, kol_agent_notes_from_email(email), now, id],
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
            kol_agent_notes_from_email(email),
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

fn kol_agent_notes_from_email(email: &RawMarketingEmail) -> String {
    compact_text(
        &format!(
            "由邮件内容创建。发件人：{}；主题：{}；邮件摘要：{}",
            email.raw_from, email.subject, email.snippet
        ),
        900,
    )
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
    migrate_marketing_email_leads(&conn)?;
    Ok(conn)
}

fn migrate_marketing_email_leads(conn: &Connection) -> Result<(), AppError> {
    if !table_has_column(conn, "marketing_email_leads", "agent_reviewed_at")? {
        conn.execute(
            "ALTER TABLE marketing_email_leads ADD COLUMN agent_reviewed_at INTEGER",
            [],
        )?;
    }
    if !table_has_column(conn, "marketing_email_leads", "agent_review_note")? {
        conn.execute(
            "ALTER TABLE marketing_email_leads ADD COLUMN agent_review_note TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }
    if !table_has_column(conn, "marketing_email_leads", "human_confirmed")? {
        conn.execute(
            "ALTER TABLE marketing_email_leads ADD COLUMN human_confirmed INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }
    if !table_has_column(conn, "kol_profiles", "pipeline_stage")? {
        conn.execute(
            "ALTER TABLE kol_profiles ADD COLUMN pipeline_stage TEXT NOT NULL DEFAULT 'evaluate'",
            [],
        )?;
    }
    if !table_has_column(conn, "kol_profiles", "evaluation")? {
        conn.execute("ALTER TABLE kol_profiles ADD COLUMN evaluation TEXT", [])?;
    }
    if !table_has_column(conn, "kol_profiles", "outreach")? {
        conn.execute("ALTER TABLE kol_profiles ADD COLUMN outreach TEXT", [])?;
    }
    if !table_has_column(conn, "kol_profiles", "intake")? {
        conn.execute("ALTER TABLE kol_profiles ADD COLUMN intake TEXT", [])?;
    }
    if !table_has_column(conn, "kol_profiles", "collaboration")? {
        conn.execute("ALTER TABLE kol_profiles ADD COLUMN collaboration TEXT", [])?;
    }
    if !table_has_column(conn, "kol_profiles", "shipment")? {
        conn.execute("ALTER TABLE kol_profiles ADD COLUMN shipment TEXT", [])?;
    }
    conn.execute(
        "CREATE TABLE IF NOT EXISTS marketing_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)",
        [],
    )?;
    conn.execute(
        "UPDATE marketing_email_leads SET category = 'other', hidden = 0, kol_id = NULL WHERE category = 'ad' OR category NOT IN ('influencer', 'affiliate', 'other')",
        [],
    )?;
    review_cached_marketing_email_leads(conn)?;
    Ok(())
}

const SETTING_AGENT_AUTO_CONFIRM: &str = "agent_auto_confirm";
const SETTING_AGENT_AUTO_REPLY: &str = "agent_auto_reply";

fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>, AppError> {
    conn.query_row(
        "SELECT value FROM marketing_settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(AppError::from)
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    conn.execute(
        "INSERT INTO marketing_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now_millis()],
    )?;
    Ok(())
}

fn setting_is_true(value: Option<String>) -> bool {
    matches!(
        value.as_deref().map(|v| v.trim().to_ascii_lowercase()).as_deref(),
        Some("1") | Some("true") | Some("yes")
    )
}

fn agent_auto_confirm(conn: &Connection) -> bool {
    get_setting(conn, SETTING_AGENT_AUTO_CONFIRM)
        .map(setting_is_true)
        .unwrap_or(false)
}

fn agent_auto_reply(conn: &Connection) -> bool {
    get_setting(conn, SETTING_AGENT_AUTO_REPLY)
        .map(setting_is_true)
        .unwrap_or(false)
}

fn review_cached_marketing_email_leads(conn: &Connection) -> Result<(), AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, imap_uid, message_id, thread_id, from_name, from_email, raw_from, subject, snippet, received_at FROM marketing_email_leads WHERE agent_reviewed_at IS NULL OR COALESCE(agent_review_note, '') = ''",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            RawMarketingEmail {
                imap_uid: row.get(1)?,
                message_id: row.get(2)?,
                thread_id: row.get(3)?,
                from_name: row.get(4)?,
                from_email: row.get(5)?,
                raw_from: row.get(6)?,
                subject: row.get(7)?,
                snippet: row.get(8)?,
                received_at: row.get(9)?,
            },
        ))
    })?;
    let mut reviewed = Vec::new();
    for row in rows {
        reviewed.push(row?);
    }
    drop(stmt);
    let now = now_millis();
    for (id, email) in reviewed {
        let classification = classify_marketing_email(&email);
        let kol_id = if classification.category == "influencer" {
            conn.query_row(
                "SELECT id FROM kol_profiles WHERE lower(email) = lower(?1)",
                params![email.from_email],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        } else {
            None
        };
        conn.execute(
            "UPDATE marketing_email_leads SET category = ?1, hidden = 0, confidence = ?2, kol_id = ?3, agent_reviewed_at = ?4, agent_review_note = ?5, updated_at = ?4 WHERE id = ?6",
            params![
                classification.category,
                classification.confidence,
                kol_id,
                now,
                classification.review_note,
                id,
            ],
        )?;
    }
    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, AppError> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for row in rows {
        if row? == column {
            return Ok(true);
        }
    }
    Ok(false)
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
    // Append a per-process sequence so multiple ids minted within the same
    // millisecond (e.g. several audit rows from one command) stay unique.
    let seq = ID_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    format!(
        "{prefix}-{}-{}-{}",
        now_millis(),
        std::process::id(),
        seq
    )
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
  alpha-sidebar [--db PATH] marketing leads list [--query TEXT] [--category influencer|affiliate|other] [--hidden true|false] [--limit N]
  alpha-sidebar [--db PATH] marketing leads update --id ID --field hidden|category --value VALUE --reason REASON
  alpha-sidebar [--db PATH] marketing leads classify --id ID --category influencer|affiliate|other [--hide true|false] [--confirm true|false] [--reason REASON]
  alpha-sidebar [--db PATH] marketing leads confirm --id ID [--reason REASON]
  alpha-sidebar [--db PATH] marketing leads add --from "Name <email>" --subject TEXT --snippet TEXT [--account-id ID] [--received-at MS] [--uid UID]
  alpha-sidebar [--db PATH] marketing kols get --id ID
  alpha-sidebar [--db PATH] marketing kols list [--query TEXT] [--status STATUS] [--archived true|false] [--limit N]
  alpha-sidebar [--db PATH] marketing kols find QUERY [--limit N]
  alpha-sidebar [--db PATH] marketing kols update (--id ID | --query TEXT) --field FIELD --value VALUE [--all] --reason REASON
  alpha-sidebar [--db PATH] marketing kols evaluate --id ID --criteria JSON [--summary TEXT] [--recommendation proposal|reject|hold] [--confirm true|false] [--reason REASON]
  alpha-sidebar [--db PATH] marketing kols outreach --id ID [--kind proposal|reject|koc|paid] [--script-id ID] [--channel TEXT] [--note TEXT] [--skip] [--reason REASON]
  alpha-sidebar [--db PATH] marketing kols reply --id ID --body TEXT [--subject TEXT] [--to EMAIL] [--kind proposal|reject] [--script-id ID] [--channel TEXT] [--note TEXT] [--send true|false] [--reason REASON]
  alpha-sidebar [--db PATH] marketing kols intake --id ID [--username TEXT] [--owner TEXT] [--channel Email|SMS|DM] [--relationship inbound|outbound] [--phone TEXT] [--platforms TEXT] [--links TEXT] [--content-type TEXT] [--language TEXT] [--metrics TEXT] [--note TEXT] [--status done|draft] [--reason REASON]
  alpha-sidebar [--db PATH] marketing kols collaborate --id ID [--status sent|signed|declined] [--script-id ID] [--contract-url URL] [--video-count N] [--note TEXT] [--send true --body TEXT [--subject TEXT] [--to EMAIL]] [--reason REASON]
  alpha-sidebar [--db PATH] marketing kols ship --id ID [--status shipped|delivered|issue] [--carrier TEXT] [--tracking TEXT] [--tracking-url URL] [--address TEXT] [--units TEXT] [--expected-post-at MS] [--note TEXT] [--send true --body TEXT [--subject TEXT] [--to EMAIL]] [--reason REASON]
  alpha-sidebar [--db PATH] marketing kols delete (--id ID | --query TEXT [--all] | --all) [--reason REASON]
  alpha-sidebar [--db PATH] marketing settings get
  alpha-sidebar [--db PATH] marketing settings set [--agent-auto-confirm true|false] [--agent-auto-reply true|false]
  alpha-sidebar [--db PATH] marketing logs list [--target-table TABLE] [--target-id ID] [--limit N]

  marketing kols evaluate --criteria expects a JSON array, e.g.
    '[{"key":"vertical","status":"pass","detail":"露营/房车场景"},{"key":"language","status":"pass"},{"key":"followers","status":"pass","detail":"IG 45k"},{"key":"views","status":"unknown"},{"key":"engagement","status":"pass","detail":"avg 320 likes"},{"key":"recency","status":"pass"}]'
  Rubric: both hard requirements (vertical, language) must pass AND at least two soft requirements
  (followers, views, engagement, recency) must pass to qualify.
  When --confirm is omitted, kols evaluate follows the agent_auto_confirm setting
  (marketing settings set --agent-auto-confirm true|false): on -> finalize, off -> save draft.

  marketing kols outreach records the Step 3 评估后处理 action after a confirmed
  evaluation. For a qualified KOL it logs the proposal and advances pipeline_stage
  to onboarding (推进合作); for a rejected KOL it logs the rejection (stays rejected).
  Pass --skip to record that no message was sent (status=skipped, stage unchanged).

  marketing kols reply actually SENDS the reply email via SMTP (reusing the Gmail
  app password from Keychain, threaded with Re: + In-Reply-To), then records the
  outreach like kols outreach. --body is the final message text. --send defaults to
  the agent_auto_reply setting; pass --send false to record without sending, or
  --send true to force-send. Sending real mail is irreversible — only do it when
  the agent_auto_reply switch is on or the user explicitly approved.

  Step 4–6 advance the post-proposal funnel (onboarding → intake → signed →
  shipped → completed):
  - marketing kols intake records the 录入系统 profile data (username/owner/channel/
    relationship/platforms/metrics/...) into kol_profiles.intake and mirrors
    owner/relationship; a done intake moves onboarding → intake.
  - marketing kols collaborate records the 合作推进 contract push into
    kol_profiles.collaboration; --status signed advances → signed. Add --send true
    --body TEXT to email the contract first (SMTP, same gate guidance as reply).
  - marketing kols ship records the 发货流程 fulfillment into kol_profiles.shipment;
    --status shipped → shipped, delivered → completed. Add --send true --body TEXT
    to email the shipping notice first.

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
              agent_reviewed_at INTEGER,
              agent_review_note TEXT NOT NULL DEFAULT '',
              human_confirmed INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              UNIQUE(account_id, imap_uid)
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
              pipeline_stage TEXT NOT NULL DEFAULT 'evaluate',
              evaluation TEXT,
              outreach TEXT,
              intake TEXT,
              collaboration TEXT,
              shipment TEXT,
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
            CREATE TABLE marketing_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at INTEGER NOT NULL
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
            "INSERT INTO marketing_email_leads (id, account_id, imap_uid, message_id, thread_id, from_name, from_email, raw_from, subject, snippet, received_at, category, hidden, confidence, kol_id, agent_reviewed_at, agent_review_note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
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
                11_i64,
                "Agent 已阅读邮件内容",
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
        assert_eq!(rows[0].agent_reviewed_at, Some(11));
        assert!(rows[0].agent_review_note.contains("Agent"));
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

    fn criteria(pairs: &[(&str, &str)]) -> Vec<NormalizedCriterion> {
        let inputs: Vec<EvalCriterionInput> = pairs
            .iter()
            .map(|(key, status)| EvalCriterionInput {
                key: (*key).to_string(),
                label: None,
                kind: None,
                status: (*status).to_string(),
                detail: None,
            })
            .collect();
        normalize_eval_criteria(&inputs)
    }

    #[test]
    fn verdict_passes_when_hard_pass_and_two_soft_pass_despite_unknown() {
        let verdict = compute_eval_verdict(&criteria(&[
            ("vertical", "pass"),
            ("language", "pass"),
            ("followers", "pass"),
            ("views", "pass"),
            ("engagement", "unknown"),
            ("recency", "pass"),
        ]));
        assert_eq!(verdict, "pass");
    }

    #[test]
    fn outreach_advances_only_qualified_sent() {
        // Proposal sent to a qualified KOL -> onboarding (推进合作).
        assert_eq!(outreach_stage_after("qualified", "sent"), Some("onboarding"));
        // Rejections stay rejected; skips never advance.
        assert_eq!(outreach_stage_after("rejected", "sent"), None);
        assert_eq!(outreach_stage_after("qualified", "skipped"), None);
        assert_eq!(outreach_stage_after("evaluate", "sent"), None);
    }

    #[test]
    fn stage_rank_orders_the_funnel() {
        // The 6-step funnel must be strictly increasing so steps advance forward only.
        let order = [
            "classify",
            "evaluate",
            "qualified",
            "onboarding",
            "intake",
            "signed",
            "shipped",
            "completed",
        ];
        for pair in order.windows(2) {
            assert!(
                stage_rank(pair[0]) < stage_rank(pair[1]),
                "{} should rank below {}",
                pair[0],
                pair[1]
            );
        }
        // qualified and rejected share the Step 2 rank.
        assert_eq!(stage_rank("qualified"), stage_rank("rejected"));
    }

    #[test]
    fn smtp_host_derives_from_imap_host() {
        assert_eq!(smtp_host_for("imap.gmail.com"), "smtp.gmail.com");
        assert_eq!(smtp_host_for("imap.qq.com"), "smtp.qq.com");
        // Already an SMTP host or custom host -> unchanged.
        assert_eq!(smtp_host_for("smtp.gmail.com"), "smtp.gmail.com");
        assert_eq!(smtp_host_for("mail.example.com"), "mail.example.com");
    }

    #[test]
    fn reply_subject_adds_re_once() {
        assert_eq!(ensure_reply_subject("Partnership"), "Re: Partnership");
        assert_eq!(ensure_reply_subject("Re: Partnership"), "Re: Partnership");
        assert_eq!(ensure_reply_subject("RE: hi"), "RE: hi");
        assert_eq!(ensure_reply_subject("   "), "Re: Partnership with ZERO BREEZE");
    }

    #[test]
    fn agent_auto_reply_setting_roundtrips_and_defaults_false() {
        let conn = test_conn();
        assert!(!agent_auto_reply(&conn), "defaults to false when unset");

        set_setting(&conn, SETTING_AGENT_AUTO_REPLY, "true").expect("set true");
        assert!(agent_auto_reply(&conn), "reads true after enabling");

        set_setting(&conn, SETTING_AGENT_AUTO_REPLY, "false").expect("set false");
        assert!(!agent_auto_reply(&conn), "reads false after disabling");
    }

    #[test]
    fn verdict_pending_when_hard_unknown() {
        let verdict = compute_eval_verdict(&criteria(&[
            ("vertical", "unknown"),
            ("language", "pass"),
            ("followers", "pass"),
            ("views", "pass"),
        ]));
        assert_eq!(verdict, "pending");
    }

    #[test]
    fn verdict_fails_when_hard_fails() {
        let verdict = compute_eval_verdict(&criteria(&[
            ("vertical", "fail"),
            ("language", "pass"),
            ("followers", "pass"),
            ("views", "pass"),
            ("engagement", "pass"),
            ("recency", "pass"),
        ]));
        assert_eq!(verdict, "fail");
    }

    #[test]
    fn verdict_fails_when_soft_cannot_reach_threshold() {
        // Hard pass, only one possible soft pass (rest fail) -> cannot reach 2.
        let verdict = compute_eval_verdict(&criteria(&[
            ("vertical", "pass"),
            ("language", "pass"),
            ("followers", "pass"),
            ("views", "fail"),
            ("engagement", "fail"),
            ("recency", "fail"),
        ]));
        assert_eq!(verdict, "fail");
    }

    #[test]
    fn generate_id_is_unique_within_same_millisecond() {
        let ids: Vec<String> = (0..50).map(|_| generate_id("audit")).collect();
        let mut deduped = ids.clone();
        deduped.sort();
        deduped.dedup();
        assert_eq!(ids.len(), deduped.len(), "ids must be unique");
    }

    #[test]
    fn db_text_value_returns_none_for_null_column() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO marketing_email_leads (id, account_id, imap_uid, from_email, raw_from, subject, snippet, category, hidden, confidence, created_at, updated_at) VALUES ('lead_n', 'a', 'u', 'x@example.com', 'X', 'S', 'snip', 'influencer', 0, 0.5, 1, 2)",
            [],
        )
        .expect("insert lead with null kol_id");
        // kol_id is NULL; reading it must yield None, not an error.
        let value = db_text_value(&conn, "marketing_email_leads", "lead_n", "kol_id")
            .expect("null column read should succeed");
        assert_eq!(value, None);
    }

    #[test]
    fn classify_influencer_links_kol_and_advances_pipeline() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO marketing_email_leads (id, account_id, imap_uid, from_name, from_email, raw_from, subject, snippet, category, hidden, confidence, created_at, updated_at) VALUES ('lead_c', 'a', 'u', 'Mia', 'mia@example.com', 'Mia <mia@example.com>', 'Collab', 'snip', 'other', 0, 0.5, 1, 2)",
            [],
        )
        .expect("insert lead");

        let lead = get_lead_email(&conn, "lead_c").expect("read lead");
        let (kol_id, created) = upsert_kol_from_email(&conn, &lead).expect("upsert kol");
        assert!(created, "a new KOL should be created for the influencer lead");

        update_field(
            &conn,
            "marketing_email_leads",
            "lead_c",
            "kol_id",
            FieldValue::Text(Some(kol_id.clone())),
            "test",
        )
        .expect("link kol_id (was NULL)");

        let stage: String = conn
            .query_row(
                "SELECT pipeline_stage FROM kol_profiles WHERE id = ?1",
                params![kol_id],
                |row| row.get(0),
            )
            .expect("read pipeline stage");
        assert_eq!(stage, "evaluate");

        let linked: Option<String> = conn
            .query_row(
                "SELECT kol_id FROM marketing_email_leads WHERE id = 'lead_c'",
                [],
                |row| row.get(0),
            )
            .expect("read linked kol id");
        assert_eq!(linked.as_deref(), Some(kol_id.as_str()));
    }

    #[test]
    fn agent_auto_confirm_setting_roundtrips_and_defaults_false() {
        let conn = test_conn();
        assert!(!agent_auto_confirm(&conn), "defaults to false when unset");

        set_setting(&conn, SETTING_AGENT_AUTO_CONFIRM, "true").expect("set true");
        assert!(agent_auto_confirm(&conn), "reads true after enabling");

        set_setting(&conn, SETTING_AGENT_AUTO_CONFIRM, "false").expect("set false");
        assert!(!agent_auto_confirm(&conn), "reads false after disabling");
    }

    #[test]
    fn setting_is_true_accepts_common_truthy_values() {
        assert!(setting_is_true(Some("true".to_string())));
        assert!(setting_is_true(Some(" YES ".to_string())));
        assert!(setting_is_true(Some("1".to_string())));
        assert!(!setting_is_true(Some("false".to_string())));
        assert!(!setting_is_true(Some("off".to_string())));
        assert!(!setting_is_true(None));
    }

    #[test]
    fn parse_from_header_extracts_name_and_email() {
        let (name, email, raw) = parse_from_header("Mia Chen <mia.creator@example.com>");
        assert_eq!(name.as_deref(), Some("Mia Chen"));
        assert_eq!(email, "mia.creator@example.com");
        assert_eq!(raw, "Mia Chen <mia.creator@example.com>");
    }

    #[test]
    fn parse_from_header_strips_quotes_and_handles_bare_address() {
        let (name, email, _) = parse_from_header("\"Olivia Park\" <olivia@example.com>");
        assert_eq!(name.as_deref(), Some("Olivia Park"));
        assert_eq!(email, "olivia@example.com");

        let (name, email, raw) = parse_from_header("solo@example.com");
        assert_eq!(name, None);
        assert_eq!(email, "solo@example.com");
        assert_eq!(raw, "solo@example.com");
    }

    #[test]
    fn seeded_influencer_lead_creates_kol_and_is_deletable() {
        let conn = test_conn();
        let account = synthetic_seed_account("seed-demo");
        let email = RawMarketingEmail {
            imap_uid: "seed-uid-1".to_string(),
            message_id: None,
            thread_id: None,
            from_name: Some("Mia Chen".to_string()),
            from_email: "mia.creator@example.com".to_string(),
            raw_from: "Mia Chen <mia.creator@example.com>".to_string(),
            subject: "Collaboration with us - TikTok creator".to_string(),
            snippet: "I am a tiktok creator and would love to collab.".to_string(),
            received_at: Some(1_000),
        };
        let result =
            upsert_marketing_email_leads(&conn, &account, vec![email]).expect("seed lead");
        assert_eq!(result.inserted, 1);
        assert_eq!(result.kol_created, 1);

        let kol_id: String = conn
            .query_row(
                "SELECT id FROM kol_profiles WHERE lower(email) = 'mia.creator@example.com'",
                [],
                |row| row.get(0),
            )
            .expect("kol created");

        // Deleting the KOL must unlink the seeded lead but keep the lead row.
        conn.execute(
            "UPDATE marketing_email_leads SET kol_id = NULL WHERE kol_id = ?1",
            params![kol_id],
        )
        .expect("unlink lead");
        let removed = conn
            .execute("DELETE FROM kol_profiles WHERE id = ?1", params![kol_id])
            .expect("delete kol");
        assert_eq!(removed, 1);

        let lead_count: i64 = conn
            .query_row("SELECT count(*) FROM marketing_email_leads", [], |row| {
                row.get(0)
            })
            .expect("count leads");
        assert_eq!(lead_count, 1, "the lead history should survive KOL deletion");
        let dangling: Option<String> = conn
            .query_row(
                "SELECT kol_id FROM marketing_email_leads WHERE imap_uid = 'seed-uid-1'",
                [],
                |row| row.get(0),
            )
            .expect("read lead kol_id");
        assert_eq!(dangling, None);
    }
}
