use std::{collections::BTreeMap, convert::Infallible, time::Duration};

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    Json,
};
use bytes::Bytes;
use chrono::{Datelike, TimeZone, Utc};
use futures_util::StreamExt;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    admin_auth::{
        clear_login_failures, constant_time_eq, ensure_login_allowed, record_login_failure,
        verify_totp,
    },
    billing::{settle_usage_yuan, usage_from_openai_response, GatewayUsage, Pricing},
    error::{ApiError, ApiResult},
    gateway::{
        build_model_discovery_request, build_upstream_request, discover_models_from_body,
        normalize_upstream_error_body, normalize_upstream_success_body_for_request,
        ProviderApiFormat, ProviderAuthType, ProviderConfig, UpstreamRequest,
    },
    gateway_admission::{self, RequestLane},
    gateway_stream::{
        inspect_responses_stream_data, is_terminal_responses_stream_data,
        restore_namespace_tools_in_sse_frame, NativeStreamEvent, ResponsesStreamAdapter,
        SseDecoder,
    },
    license::{
        can_activate_device, codex_subscription_available, hash_authorization_code,
        normalize_authorization_code, normalize_company_name, CLIENT_DEVICE_LEASE_DAYS,
    },
    market::{CapitalFlowSnapshot, MarketSnapshot},
    money::{decimal_json, deserialize_decimal, has_supported_scale},
    state::{AppState, GatewayRunPermit},
    tokens::{AdminTokenClaims, DeviceTokenClaims, RunTokenClaims},
};

const CURRENT_SERVICE_TERMS_VERSION: &str = "2026-08-04";
const CURRENT_PRIVACY_POLICY_VERSION: &str = "2026-08-04";
const CURRENT_THIRD_PARTY_MODEL_NOTICE_VERSION: &str = "2026-08-04";
const CURRENT_RESEARCH_RISK_DISCLOSURE_VERSION: &str = "2026-08-04";
const GATEWAY_RUN_TTL_SECONDS: i64 = 48 * 60 * 60;
// A Codex turn can issue a new model request after every tool result. Size the
// task guard for a bounded agent loop, while tenant balance remains the actual
// real-time spending gate before each request.
const GATEWAY_TASK_FULL_WINDOW_REQUEST_CAP: u64 = 64;
const MAX_GATEWAY_TASK_BUDGET_YUAN: u64 = 10_000;
const FAST_MODE_COST_MULTIPLIER: u64 = 2;
// Each agent is serial; independent spawned agents use bounded parallel lanes.
const GATEWAY_REQUEST_LEASE_WAIT_TIMEOUT: Duration = Duration::from_secs(180);
const GATEWAY_REQUEST_LEASE_RETRY_INTERVAL: Duration = Duration::from_millis(100);

fn gateway_request_wait_timeout(provider: &ProviderConfig) -> Duration {
    // Queue time is not inference time. Allow one complete upstream request
    // (including its bounded retries and settlement) between queue advances.
    let retries = u64::from(provider.max_retries.min(5));
    Duration::from_millis(provider.request_timeout_ms.clamp(1_000, 900_000))
        .saturating_mul((retries + 1) as u32)
        .saturating_add(gateway_admission::MAX_RETRY_WAIT)
        .saturating_add(Duration::from_secs(30))
        .max(GATEWAY_REQUEST_LEASE_WAIT_TIMEOUT)
}

pub async fn healthz() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MarketSnapshotQuery {
    codes: Option<String>,
    limit: Option<usize>,
    force_refresh: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarketStreamQuery {
    tenant_id: String,
    device_id: String,
}

pub async fn market_snapshot(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MarketSnapshotQuery>,
) -> ApiResult<Json<MarketSnapshot>> {
    ensure_market_header_identity(&state, &headers).await?;
    if !state.config.market_data_enabled {
        return Err(ApiError::Upstream(
            "cloud market feed is disabled".to_string(),
        ));
    }
    let snapshot = if query.force_refresh.unwrap_or(false) {
        state
            .market
            .force_refresh(&state.http, state.redis.as_ref())
            .await
    } else {
        state
            .market
            .ensure_snapshot(&state.http, state.redis.as_ref())
            .await
    }
    .map_err(ApiError::Upstream)?;
    Ok(Json(filter_market_snapshot(snapshot.as_ref(), &query)))
}

pub async fn market_capital_flow(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(code): Path<String>,
) -> ApiResult<Json<CapitalFlowSnapshot>> {
    ensure_market_header_identity(&state, &headers).await?;
    if !state.config.market_data_enabled {
        return Err(ApiError::Upstream(
            "cloud market feed is disabled".to_string(),
        ));
    }
    let snapshot = state
        .capital_flow
        .ensure_snapshot(&code, &state.http, state.redis.as_ref())
        .await
        .map_err(ApiError::Upstream)?;
    Ok(Json(snapshot.as_ref().clone()))
}

pub async fn market_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<MarketStreamQuery>,
) -> ApiResult<Sse<impl tokio_stream::Stream<Item = Result<Event, Infallible>>>> {
    require_device(&state, &headers, &query.tenant_id, &query.device_id).await?;
    if !state.config.market_data_enabled {
        return Err(ApiError::Upstream(
            "cloud market feed is disabled".to_string(),
        ));
    }
    let first = state
        .market
        .ensure_snapshot(&state.http, state.redis.as_ref())
        .await
        .map_err(ApiError::Upstream)?;
    let mut receiver = state.market.subscribe();
    let stream = async_stream::stream! {
        if let Ok(event) = Event::default().event("snapshot").id(first.sequence.to_string()).json_data(first.as_ref()) {
            yield Ok::<Event, Infallible>(event);
        }
        loop {
            match receiver.recv().await {
                Ok(snapshot) => {
                    if let Ok(event) = Event::default().event("snapshot").id(snapshot.sequence.to_string()).json_data(snapshot.as_ref()) {
                        yield Ok::<Event, Infallible>(event);
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    };
    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    ))
}

async fn ensure_market_header_identity(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let value = |name: &'static str| -> ApiResult<&str> {
        headers
            .get(name)
            .and_then(|header| header.to_str().ok())
            .filter(|text| !text.trim().is_empty())
            .ok_or_else(|| ApiError::Unauthorized(format!("missing {name}")))
    };
    require_device(
        state,
        headers,
        value("x-alpha-tenant-id")?,
        value("x-alpha-device-id")?,
    )
    .await
    .map(|_| ())
}

fn filter_market_snapshot(
    snapshot: &MarketSnapshot,
    query: &MarketSnapshotQuery,
) -> MarketSnapshot {
    let requested = query.codes.as_deref().map(|codes| {
        codes
            .split(',')
            .map(|code| code.trim().to_uppercase())
            .filter(|code| !code.is_empty())
            .collect::<std::collections::HashSet<_>>()
    });
    let limit = query.limit.unwrap_or(snapshot.quotes.len()).clamp(1, 8000);
    let quotes = snapshot
        .quotes
        .iter()
        .filter(|quote| {
            requested
                .as_ref()
                .map(|codes| codes.contains(&quote.code) || codes.contains(&quote.raw_code))
                .unwrap_or(true)
        })
        .take(limit)
        .cloned()
        .collect();
    MarketSnapshot {
        quotes,
        ..snapshot.clone()
    }
}

pub async fn readyz(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    sqlx::query("select 1").execute(&state.db).await?;
    if let Some(client) = &state.redis {
        let mut connection = client
            .get_multiplexed_async_connection()
            .await
            .map_err(|e| ApiError::Upstream(format!("redis is not ready: {e}")))?;
        let _: String = redis::cmd("PING")
            .query_async(&mut connection)
            .await
            .map_err(|e| ApiError::Upstream(format!("redis ping failed: {e}")))?;
    }
    Ok(Json(json!({ "status": "ready" })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    email: String,
    password: String,
    totp_code: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginResponse {
    token: String,
    user: AdminUser,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    email: String,
    role: String,
}

pub async fn auth_login(
    State(state): State<AppState>,
    Json(request): Json<LoginRequest>,
) -> ApiResult<Json<LoginResponse>> {
    let principal = state.config.admin_email.trim().to_ascii_lowercase();
    ensure_login_allowed(&state.db, &principal).await?;
    let supplied_email = request.email.trim().to_ascii_lowercase();
    let credentials_match = constant_time_eq(supplied_email.as_bytes(), principal.as_bytes())
        & constant_time_eq(
            request.password.as_bytes(),
            state.config.admin_password.as_bytes(),
        );
    let totp_matches = verify_totp(&state.config.admin_totp_secret, &request.totp_code);
    if !(credentials_match & totp_matches) {
        let locked = record_login_failure(&state.db, &principal).await?;
        tokio::time::sleep(Duration::from_millis(250)).await;
        if locked {
            return Err(ApiError::TooManyRequests(
                "too many login attempts; try again later".to_string(),
            ));
        }
        return Err(ApiError::Unauthorized(
            "invalid admin credentials".to_string(),
        ));
    }
    clear_login_failures(&state.db, &principal).await?;
    let token = state
        .admin_tokens
        .issue(AdminTokenClaims::new(principal.clone(), 2 * 60 * 60))?;
    Ok(Json(LoginResponse {
        token,
        user: AdminUser {
            email: principal,
            role: "owner".to_string(),
        },
    }))
}

pub async fn client_bootstrap(State(state): State<AppState>) -> ApiResult<Json<Value>> {
    let models = load_models(&state.db).await?;
    Ok(Json(json!({
        "appBaseUrl": state.config.app_base_url,
        "modes": ["subscription", "gateway_api", "direct_api_key"],
        "models": models
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLeaseRequest {
    tenant_id: String,
    device_id: String,
}

pub async fn device_lease(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<DeviceLeaseRequest>,
) -> ApiResult<Json<Value>> {
    require_device(&state, &headers, &request.tenant_id, &request.device_id).await?;
    let row = sqlx::query(
        r#"
        update devices d
        set lease_expires_at = now() + make_interval(days => $3), last_seen_at = now()
        from tenants t
        where d.tenant_id = $1 and d.id = $2 and d.status = 'active'
          and t.id = d.tenant_id and t.status = 'active'
        returning d.user_id, d.fingerprint, d.lease_expires_at
        "#,
    )
    .bind(&request.tenant_id)
    .bind(&request.device_id)
    .bind(CLIENT_DEVICE_LEASE_DAYS)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::Forbidden("device is not active for this tenant".to_string()))?;
    let tenant_row = sqlx::query(
        r#"
        select id, name, max_devices, codex_subscription_enabled,
          codex_subscription_plan, codex_subscription_expires_at
        from tenants
        where id = $1
        "#,
    )
    .bind(&request.tenant_id)
    .fetch_one(&state.db)
    .await?;
    let codex_subscription_expires_at = tenant_row
        .try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at")
        .unwrap_or(None);
    let subscription_enabled = codex_subscription_available(
        tenant_row.get::<bool, _>("codex_subscription_enabled"),
        codex_subscription_expires_at,
        Utc::now(),
    );
    let models = load_models(&state.db).await?;
    let codex_accounts = if subscription_enabled {
        load_codex_accounts_for_client(&state.db, &request.tenant_id).await?
    } else {
        Vec::new()
    };
    let access_token = issue_device_access_token(
        &state,
        &request.tenant_id,
        &row.get::<String, _>("user_id"),
        &request.device_id,
        &row.get::<String, _>("fingerprint"),
    )?;
    Ok(Json(json!({
        "accessToken": access_token,
        "leaseExpiresAt": row.get::<chrono::DateTime<Utc>, _>("lease_expires_at"),
        "tenant": {
            "id": tenant_row.get::<String, _>("id"),
            "name": tenant_row.get::<String, _>("name"),
            "maxDevices": tenant_row.get::<i32, _>("max_devices"),
            "codexSubscriptionEnabled": subscription_enabled,
            "codexSubscriptionPlan": tenant_row.try_get::<Option<String>, _>("codex_subscription_plan").unwrap_or(None),
            "codexSubscriptionExpiresAt": codex_subscription_expires_at
        },
        "models": models,
        "codexAccounts": codex_accounts
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientDevicesRequest {
    tenant_id: String,
    device_id: String,
}

pub async fn client_devices(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ClientDevicesRequest>,
) -> ApiResult<Json<Value>> {
    require_device(&state, &headers, &request.tenant_id, &request.device_id).await?;
    Ok(Json(
        client_device_summary(&state.db, &request.tenant_id, &request.device_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCodexAuthorizationRequest {
    tenant_id: String,
    device_id: String,
    email: String,
}

pub async fn client_codex_authorization(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ClientCodexAuthorizationRequest>,
) -> ApiResult<Json<Value>> {
    require_device(&state, &headers, &request.tenant_id, &request.device_id).await?;
    let row = sqlx::query(
        r#"
        select a.id, a.email, t.codex_subscription_enabled,
          t.codex_subscription_expires_at
        from tenants t
        join codex_account_tenants cat on cat.tenant_id = t.id
        join codex_accounts a on a.id = cat.account_id
        where t.id = $1 and t.status = 'active'
          and a.status = 'active'
          and lower(a.email) = lower($2)
          and (a.expires_at is null or a.expires_at > now())
        order by a.created_at
        limit 1
        "#,
    )
    .bind(&request.tenant_id)
    .bind(request.email.trim())
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        ApiError::Forbidden(
            "the signed-in GPT account is not assigned by the administrator".to_string(),
        )
    })?;
    let subscription_expires_at = row
        .try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at")
        .unwrap_or(None);
    if !codex_subscription_available(
        row.get::<bool, _>("codex_subscription_enabled"),
        subscription_expires_at,
        Utc::now(),
    ) {
        return Err(ApiError::Forbidden(
            "GPT enterprise authorization is disabled or expired".to_string(),
        ));
    }
    write_audit(
        &state.db,
        &request.tenant_id,
        "client.codex_authorize",
        json!({
            "deviceId": request.device_id,
            "codexAccountId": row.get::<String, _>("id"),
            "email": row.get::<String, _>("email")
        }),
    )
    .await?;
    Ok(Json(json!({
        "authorized": true,
        "accountId": row.get::<String, _>("id"),
        "email": row.get::<String, _>("email")
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientRevokeDeviceRequest {
    tenant_id: String,
    device_id: String,
    target_device_id: String,
}

pub async fn client_revoke_device(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ClientRevokeDeviceRequest>,
) -> ApiResult<Json<Value>> {
    require_device(&state, &headers, &request.tenant_id, &request.device_id).await?;
    let administrator_id = first_tenant_device_id(&state.db, &request.tenant_id).await?;
    if administrator_id != request.device_id {
        return Err(ApiError::Forbidden(
            "only the first installed device can revoke device authorization".to_string(),
        ));
    }
    if request.target_device_id == request.device_id {
        return Err(ApiError::BadRequest(
            "the administrator device cannot revoke itself".to_string(),
        ));
    }
    let revoked = sqlx::query(
        r#"
        update devices
        set status = 'revoked', lease_expires_at = now()
        where tenant_id = $1 and id = $2 and status = 'active'
        returning name
        "#,
    )
    .bind(&request.tenant_id)
    .bind(&request.target_device_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("active target device was not found".to_string()))?;
    write_audit(
        &state.db,
        &request.tenant_id,
        "client.device.revoke",
        json!({
            "administratorDeviceId": request.device_id,
            "targetDeviceId": request.target_device_id,
            "targetDeviceName": revoked.get::<String, _>("name")
        }),
    )
    .await?;
    Ok(Json(
        client_device_summary(&state.db, &request.tenant_id, &request.device_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientBillingSummaryRequest {
    tenant_id: String,
    device_id: String,
    ledger_page: Option<i64>,
    ledger_page_size: Option<i64>,
    period_kind: Option<String>,
    period_value: Option<String>,
}

pub async fn client_billing_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ClientBillingSummaryRequest>,
) -> ApiResult<Json<Value>> {
    require_device(&state, &headers, &request.tenant_id, &request.device_id).await?;
    release_expired_run_reservations(&state.db, &request.tenant_id).await?;
    let now = Utc::now();
    let selected_period = resolve_billing_period(
        now,
        request.period_kind.as_deref(),
        request.period_value.as_deref(),
    )?;
    let (ledger_page, ledger_page_size) =
        bounded_pagination(request.ledger_page, request.ledger_page_size, 8);

    let tenant_row = sqlx::query(
        r#"
        select
          t.id, t.name, t.max_devices, t.billing_mode, t.balance_yuan,
          t.subscription_plan, t.subscription_expires_at,
          t.codex_subscription_enabled, t.codex_subscription_plan, t.codex_subscription_expires_at,
          (select count(*) from devices d where d.tenant_id = t.id and d.status = 'active')::bigint as active_devices
        from tenants t
        where t.id = $1 and t.status = 'active'
        "#,
    )
    .bind(&request.tenant_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::Forbidden("tenant is not active".to_string()))?;
    let codex_subscription_expires_at = tenant_row
        .try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at")
        .unwrap_or(None);
    let subscription_enabled = codex_subscription_available(
        tenant_row.get::<bool, _>("codex_subscription_enabled"),
        codex_subscription_expires_at,
        now,
    );
    let selected_usage = usage_totals_between(
        &state.db,
        &request.tenant_id,
        selected_period.start,
        selected_period.end,
    )
    .await?;
    let all_time = usage_totals_all(&state.db, &request.tenant_id).await?;
    let mut model_usage = model_usage_between(
        &state.db,
        &request.tenant_id,
        selected_period.start,
        selected_period.end,
    )
    .await?;
    // Provider routing is an internal implementation detail. The client only
    // receives the configured display name for each model.
    remove_model_provider_fields(&mut model_usage);
    let ledger = billing_ledger_page(
        &state.db,
        &request.tenant_id,
        ledger_page,
        ledger_page_size,
        Some(selected_period.start),
        Some(selected_period.end),
    )
    .await?;
    let ledger_pagination = ledger.pagination_json();
    let recent_ledger = ledger.entries;

    Ok(Json(json!({
        "tenant": {
            "id": tenant_row.get::<String, _>("id"),
            "name": tenant_row.get::<String, _>("name"),
            "maxDevices": tenant_row.get::<i32, _>("max_devices"),
            "billingMode": tenant_row.get::<String, _>("billing_mode"),
            "balanceYuan": decimal_json(tenant_row.get::<Decimal, _>("balance_yuan")),
            "subscriptionPlan": tenant_row.try_get::<Option<String>, _>("subscription_plan").unwrap_or(None),
            "subscriptionExpiresAt": tenant_row.try_get::<Option<chrono::DateTime<Utc>>, _>("subscription_expires_at").unwrap_or(None),
            "codexSubscriptionEnabled": subscription_enabled,
            "codexSubscriptionPlan": tenant_row.try_get::<Option<String>, _>("codex_subscription_plan").unwrap_or(None),
            "codexSubscriptionExpiresAt": codex_subscription_expires_at
        },
        "activeDevices": tenant_row.get::<i64, _>("active_devices"),
        "period": {
            "kind": selected_period.kind,
            "value": selected_period.value,
            "start": selected_period.start,
            "end": selected_period.end,
            // Retained for older desktop clients. These fields represent the
            // selected period, which defaults to the current month.
            "currentMonthStart": selected_period.start,
            "currentMonthEnd": selected_period.end,
            "generatedAt": now
        },
        "usage": {
            "selectedPeriod": selected_usage,
            "currentMonth": selected_usage,
            "allTime": all_time,
            "models": model_usage,
            "recentLedger": recent_ledger,
            "ledgerPagination": ledger_pagination
        }
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflinePaymentRequest {
    #[serde(deserialize_with = "deserialize_decimal")]
    amount_yuan: Decimal,
    reference: String,
    #[serde(default)]
    note: String,
    received_at: Option<chrono::DateTime<Utc>>,
    operation_key: String,
}

pub async fn admin_record_offline_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<OfflinePaymentRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let tenant_id = id.trim();
    validate_offline_payment_request(tenant_id, &request)?;
    let received_at = request.received_at.unwrap_or_else(Utc::now);
    let operation_key = format!(
        "offline-receipt:{}:{}",
        tenant_id,
        request.operation_key.trim()
    );
    let mut tx = state.db.begin().await?;
    let tenant_exists = sqlx::query("select 1 from tenants where id = $1 for update")
        .bind(tenant_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some();
    if !tenant_exists {
        return Err(ApiError::NotFound("tenant was not found".to_string()));
    }
    let payment_id = format!("offline_{}", Uuid::new_v4().simple());
    let inserted = sqlx::query(
        r#"
        insert into offline_payment_records (
          id, tenant_id, record_type, amount_yuan, reference, note,
          received_at, operation_key, recorded_by
        )
        values ($1, $2, 'offline_receipt', $3, $4, $5, $6, $7, $8)
        on conflict (operation_key) do nothing
        returning id
        "#,
    )
    .bind(&payment_id)
    .bind(tenant_id)
    .bind(request.amount_yuan)
    .bind(request.reference.trim())
    .bind(request.note.trim())
    .bind(received_at)
    .bind(&operation_key)
    .bind(&state.config.admin_email)
    .fetch_optional(&mut *tx)
    .await?;
    let (actual_payment_id, idempotent) = if let Some(row) = inserted {
        sqlx::query(
            "update tenants set balance_yuan = balance_yuan + $2, updated_at = now() where id = $1",
        )
        .bind(tenant_id)
        .bind(request.amount_yuan)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            insert into billing_ledger (
              id, tenant_id, entry_type, amount_yuan, description, operation_key
            )
            values ($1, $2, 'offline_receipt', $3, $4, $5)
            "#,
        )
        .bind(format!("ledger_{}", Uuid::new_v4().simple()))
        .bind(tenant_id)
        .bind(request.amount_yuan)
        .bind(format!(
            "Offline receipt recorded: {}",
            request.reference.trim()
        ))
        .bind(format!("ledger:{operation_key}"))
        .execute(&mut *tx)
        .await?;
        (row.get::<String, _>("id"), false)
    } else {
        let existing = sqlx::query(
            "select id, amount_yuan, reference from offline_payment_records where operation_key = $1",
        )
            .bind(&operation_key)
            .fetch_one(&mut *tx)
            .await?;
        if existing.get::<Decimal, _>("amount_yuan") != request.amount_yuan
            || existing.get::<String, _>("reference") != request.reference.trim()
        {
            return Err(ApiError::Conflict(
                "operationKey was already used with different receipt details".to_string(),
            ));
        }
        (existing.get::<String, _>("id"), true)
    };
    let balance = sqlx::query("select balance_yuan from tenants where id = $1")
        .bind(tenant_id)
        .fetch_one(&mut *tx)
        .await?
        .get::<Decimal, _>("balance_yuan");
    tx.commit().await?;
    if !idempotent {
        write_audit(
            &state.db,
            tenant_id,
            "billing.offline_receipt.record",
            json!({
                "paymentId": actual_payment_id,
                "amountYuan": decimal_json(request.amount_yuan),
                "reference": request.reference.trim()
            }),
        )
        .await?;
    }
    Ok(Json(json!({
        "paymentId": actual_payment_id,
        "balanceYuan": decimal_json(balance),
        "paymentInitiated": false,
        "idempotent": idempotent
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfflinePaymentCorrectionRequest {
    operation_key: String,
    note: String,
}

pub async fn admin_correct_offline_payment(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<OfflinePaymentCorrectionRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    if id.trim().is_empty()
        || request.operation_key.trim().is_empty()
        || request.note.trim().len() < 3
        || request.note.trim().len() > 500
    {
        return Err(ApiError::BadRequest(
            "payment id, operationKey, and a correction note are required".to_string(),
        ));
    }
    let operation_key = format!(
        "offline-correction:{}:{}",
        id.trim(),
        request.operation_key.trim()
    );
    let mut tx = state.db.begin().await?;
    let original = sqlx::query(
        r#"
        select id, tenant_id, amount_yuan, reference
        from offline_payment_records
        where id = $1 and record_type = 'offline_receipt'
        for update
        "#,
    )
    .bind(id.trim())
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| ApiError::NotFound("offline receipt record was not found".to_string()))?;
    if let Some(existing) = sqlx::query(
        "select id, tenant_id from offline_payment_records where operation_key = $1 and record_type = 'correction'",
    )
    .bind(&operation_key)
    .fetch_optional(&mut *tx)
    .await?
    {
        let tenant_id = existing.get::<String, _>("tenant_id");
        let correction_id = existing.get::<String, _>("id");
        let balance = sqlx::query("select balance_yuan from tenants where id = $1")
            .bind(&tenant_id)
            .fetch_one(&mut *tx)
            .await?
            .get::<Decimal, _>("balance_yuan");
        tx.commit().await?;
        return Ok(Json(json!({
            "correctionId": correction_id,
            "balanceYuan": decimal_json(balance),
            "refundInitiated": false,
            "idempotent": true
        })));
    }
    let already_corrected = sqlx::query(
        "select 1 from offline_payment_records where reverses_record_id = $1 and record_type = 'correction'",
    )
    .bind(id.trim())
    .fetch_optional(&mut *tx)
    .await?
    .is_some();
    if already_corrected {
        return Err(ApiError::Conflict(
            "offline receipt record was already corrected".to_string(),
        ));
    }
    let tenant_id = original.get::<String, _>("tenant_id");
    let amount = -original.get::<Decimal, _>("amount_yuan");
    let correction_id = format!("offline_{}", Uuid::new_v4().simple());
    sqlx::query(
        r#"
        insert into offline_payment_records (
          id, tenant_id, record_type, amount_yuan, reference, note, received_at,
          reverses_record_id, operation_key, recorded_by
        )
        values ($1, $2, 'correction', $3, $4, $5, now(), $6, $7, $8)
        "#,
    )
    .bind(&correction_id)
    .bind(&tenant_id)
    .bind(amount)
    .bind(original.get::<String, _>("reference"))
    .bind(request.note.trim())
    .bind(id.trim())
    .bind(&operation_key)
    .bind(&state.config.admin_email)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "update tenants set balance_yuan = balance_yuan + $2, updated_at = now() where id = $1",
    )
    .bind(&tenant_id)
    .bind(amount)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        insert into billing_ledger (
          id, tenant_id, entry_type, amount_yuan, description, operation_key
        ) values ($1, $2, 'offline_receipt_correction', $3, $4, $5)
        "#,
    )
    .bind(format!("ledger_{}", Uuid::new_v4().simple()))
    .bind(&tenant_id)
    .bind(amount)
    .bind(format!(
        "Offline receipt record corrected: {}",
        request.note.trim()
    ))
    .bind(format!("ledger:{operation_key}"))
    .execute(&mut *tx)
    .await?;
    let balance = sqlx::query("select balance_yuan from tenants where id = $1")
        .bind(&tenant_id)
        .fetch_one(&mut *tx)
        .await?
        .get::<Decimal, _>("balance_yuan");
    tx.commit().await?;
    write_audit(
        &state.db,
        &tenant_id,
        "billing.offline_receipt.correct",
        json!({ "paymentId": id.trim(), "correctionId": correction_id, "note": request.note.trim() }),
    )
    .await?;
    Ok(Json(json!({
        "correctionId": correction_id,
        "balanceYuan": decimal_json(balance),
        "refundInitiated": false,
        "idempotent": false
    })))
}

pub async fn admin_billing_reconciliation(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select
          t.id, t.name, t.balance_yuan,
          coalesce(l.ledger_balance_yuan, 0::numeric) as ledger_balance_yuan,
          coalesce(r.open_runs, 0)::bigint as open_runs,
          coalesce(r.stale_open_runs, 0)::bigint as stale_open_runs,
          coalesce(r.failed_runs_24h, 0)::bigint as failed_runs_24h,
          coalesce(u.usage_events_24h, 0)::bigint as usage_events_24h,
          coalesce(u.total_tokens_24h, 0)::bigint as total_tokens_24h,
          coalesce(u.unverified_usage_events_24h, 0)::bigint as unverified_usage_events_24h,
          coalesce(u.billable_yuan_24h, 0::numeric) as billable_yuan_24h
        from tenants t
        left join (
          select tenant_id, sum(amount_yuan) as ledger_balance_yuan
          from billing_ledger group by tenant_id
        ) l on l.tenant_id = t.id
        left join (
          select tenant_id,
            count(*) filter (where status in ('created', 'running'))::bigint as open_runs,
            count(*) filter (
              where status in ('created', 'running') and created_at < now() - interval '49 hours'
            )::bigint as stale_open_runs,
            count(*) filter (
              where status = 'failed' and completed_at >= now() - interval '24 hours'
            )::bigint as failed_runs_24h
          from model_runs group by tenant_id
        ) r on r.tenant_id = t.id
        left join (
          select tenant_id,
            count(*)::bigint as usage_events_24h,
            coalesce(sum(input_tokens + output_tokens + reasoning_tokens + cached_tokens), 0)::bigint as total_tokens_24h,
            count(*) filter (
              where metering_status in ('budget_fallback', 'usage_unavailable')
            )::bigint as unverified_usage_events_24h,
            coalesce(sum(billable_yuan), 0::numeric) as billable_yuan_24h
          from usage_events
          where created_at >= now() - interval '24 hours'
          group by tenant_id
        ) u on u.tenant_id = t.id
        order by t.name
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    let tenants = rows
        .into_iter()
        .map(|row| {
            let stored = row.get::<Decimal, _>("balance_yuan");
            let ledger = row.get::<Decimal, _>("ledger_balance_yuan");
            let stale_open_runs = row.get::<i64, _>("stale_open_runs");
            let unverified_usage_events = row.get::<i64, _>("unverified_usage_events_24h");
            json!({
                "tenantId": row.get::<String, _>("id"),
                "tenantName": row.get::<String, _>("name"),
                "storedBalanceYuan": decimal_json(stored),
                "ledgerBalanceYuan": decimal_json(ledger),
                "differenceYuan": decimal_json(stored - ledger),
                "openRuns": row.get::<i64, _>("open_runs"),
                "staleOpenRuns": stale_open_runs,
                "failedRuns24h": row.get::<i64, _>("failed_runs_24h"),
                "usageEvents24h": row.get::<i64, _>("usage_events_24h"),
                "totalTokens24h": row.get::<i64, _>("total_tokens_24h"),
                "unverifiedUsageEvents24h": unverified_usage_events,
                "billableYuan24h": decimal_json(row.get::<Decimal, _>("billable_yuan_24h")),
                "balanced": stored == ledger,
                "requiresReview": stored != ledger || stale_open_runs > 0 || unverified_usage_events > 0
            })
        })
        .collect::<Vec<_>>();
    let balanced = tenants
        .iter()
        .all(|tenant| tenant.get("balanced").and_then(Value::as_bool) == Some(true));
    let requires_review = tenants
        .iter()
        .any(|tenant| tenant.get("requiresReview").and_then(Value::as_bool) == Some(true));
    Ok(Json(json!({
        "balanced": balanced,
        "requiresReview": requires_review,
        "generatedAt": Utc::now(),
        "paymentCapability": "offline-records-only",
        "tenants": tenants
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunCreateRequest {
    tenant_id: String,
    user_id: String,
    device_id: String,
    model_id: String,
    #[serde(
        default = "default_budget_yuan",
        deserialize_with = "deserialize_decimal"
    )]
    budget_yuan: Decimal,
    #[serde(default)]
    fast_mode: bool,
}

pub async fn run_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut request): Json<RunCreateRequest>,
) -> ApiResult<Json<Value>> {
    let device_claims =
        require_device(&state, &headers, &request.tenant_id, &request.device_id).await?;
    if device_claims.user_id != request.user_id {
        return Err(ApiError::Forbidden(
            "device token does not belong to the requested user".to_string(),
        ));
    }
    release_expired_run_reservations(&state.db, &request.tenant_id).await?;
    validate_run_budget(request.budget_yuan)?;
    let route = load_model_route(
        &state.db,
        &request.model_id,
        state.config.min_gateway_markup_bps,
    )
    .await?;
    load_provider_config(&state, &route).await?;
    let budget_pricing = if request.fast_mode {
        route
            .pricing
            .with_cost_multiplier(FAST_MODE_COST_MULTIPLIER)
    } else {
        route.pricing.clone()
    };
    request.budget_yuan = request
        .budget_yuan
        .max(recommended_run_budget_yuan(&route, &budget_pricing));
    validate_run_budget(request.budget_yuan)?;
    let run_id = format!("run_{}", Uuid::new_v4().simple());
    create_unreserved_run(&state.db, &run_id, &request).await?;
    let token = state.run_tokens.issue(RunTokenClaims::new(
        request.tenant_id,
        request.user_id,
        request.device_id,
        run_id.clone(),
        request.model_id,
        request.budget_yuan,
        GATEWAY_RUN_TTL_SECONDS,
    ))?;
    Ok(Json(json!({
        "runId": run_id,
        "runToken": token,
        "gatewayUrl": format!("{}/v1/responses", state.config.app_base_url),
        "budgetYuan": decimal_json(request.budget_yuan)
    })))
}

pub async fn admin_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let tenants = scalar_count(&state.db, "select count(*) from tenants").await?;
    let devices = scalar_count(
        &state.db,
        "select count(*) from devices where status = 'active'",
    )
    .await?;
    let runs = scalar_count(&state.db, "select count(*) from model_runs").await?;
    let usage = scalar_decimal(
        &state.db,
        "select coalesce(sum(billable_yuan), 0::numeric) from usage_events",
    )
    .await?;
    let configured_providers = scalar_count(
        &state.db,
        "select count(*) from provider_configs where enabled = true and (api_key_ciphertext <> '' or api_key <> '' or auth_type = 'none')",
    )
    .await?;
    Ok(Json(json!({
        "tenants": tenants,
        "activeDevices": devices,
        "runs": runs,
        "billableYuan": decimal_json(usage),
        "configuredProviders": configured_providers
    })))
}

pub async fn admin_audit_logs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select tenant_id, action, payload, created_at
        from audit_logs
        order by created_at desc
        limit 100
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    let logs = rows
        .into_iter()
        .map(|row| {
            json!({
                "tenantId": row.get::<String, _>("tenant_id"),
                "action": row.get::<String, _>("action"),
                "payload": row.get::<Value, _>("payload"),
                "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at")
            })
        })
        .collect::<Vec<_>>();
    Ok(Json(json!({ "logs": logs })))
}

pub async fn admin_list_tenants(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select
          t.id, t.name, t.status, t.max_devices, t.billing_mode, t.balance_yuan,
          t.subscription_plan, t.subscription_expires_at,
          t.codex_subscription_enabled, t.codex_subscription_plan, t.codex_subscription_expires_at,
          t.created_at,
          (select count(*) from devices d where d.tenant_id = t.id and d.status = 'active')::bigint as active_devices,
          (select coalesce(sum(u.billable_yuan), 0::numeric) from usage_events u where u.tenant_id = t.id) as billable_yuan
        from tenants t
        order by t.created_at desc
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "tenants": rows.into_iter().map(tenant_json).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AdminTenantBillingQuery {
    page: Option<i64>,
    page_size: Option<i64>,
}

pub async fn admin_tenant_billing(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(query): Query<AdminTenantBillingQuery>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let tenant_id = id.trim();
    if tenant_id.is_empty() {
        return Err(ApiError::BadRequest("tenant id is required".to_string()));
    }

    let tenant = sqlx::query(
        r#"
        select id, name, status, billing_mode, balance_yuan,
          subscription_plan, subscription_expires_at,
          codex_subscription_enabled, codex_subscription_plan, codex_subscription_expires_at
        from tenants
        where id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("tenant was not found".to_string()))?;

    let now = Utc::now();
    let (current_month_start, next_month_start) = current_billing_period(now);
    let (page, page_size) = bounded_pagination(query.page, query.page_size, 20);
    let current_month =
        usage_totals_between(&state.db, tenant_id, current_month_start, next_month_start).await?;
    let all_time = usage_totals_all(&state.db, tenant_id).await?;
    let model_usage =
        model_usage_between(&state.db, tenant_id, current_month_start, next_month_start).await?;
    let ledger = billing_ledger_page(&state.db, tenant_id, page, page_size, None, None).await?;
    let ledger_pagination = ledger.pagination_json();
    let recent_ledger = ledger.entries;
    let offline_payments = offline_payment_records(&state.db, tenant_id).await?;

    Ok(Json(json!({
        "tenant": {
            "id": tenant.get::<String, _>("id"),
            "name": tenant.get::<String, _>("name"),
            "status": tenant.get::<String, _>("status"),
            "billingMode": tenant.get::<String, _>("billing_mode"),
            "balanceYuan": decimal_json(tenant.get::<Decimal, _>("balance_yuan")),
            "subscriptionPlan": tenant.try_get::<Option<String>, _>("subscription_plan").unwrap_or(None),
            "subscriptionExpiresAt": tenant.try_get::<Option<chrono::DateTime<Utc>>, _>("subscription_expires_at").unwrap_or(None),
            "codexSubscriptionEnabled": tenant.get::<bool, _>("codex_subscription_enabled"),
            "codexSubscriptionPlan": tenant.try_get::<Option<String>, _>("codex_subscription_plan").unwrap_or(None),
            "codexSubscriptionExpiresAt": tenant.try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at").unwrap_or(None)
        },
        "period": {
            "currentMonthStart": current_month_start,
            "currentMonthEnd": next_month_start,
            "generatedAt": now
        },
        "usage": {
            "currentMonth": current_month,
            "allTime": all_time,
            "models": model_usage,
            "recentLedger": recent_ledger,
            "ledgerPagination": ledger_pagination,
            "offlinePayments": offline_payments
        }
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TenantSaveRequest {
    id: Option<String>,
    name: String,
    #[serde(default = "default_status")]
    status: String,
    #[serde(default = "default_max_devices_i32")]
    max_devices: i32,
    #[serde(default = "default_billing_mode")]
    billing_mode: String,
    subscription_plan: Option<String>,
    subscription_expires_at: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    codex_subscription_enabled: bool,
    codex_subscription_plan: Option<String>,
    codex_subscription_expires_at: Option<chrono::DateTime<Utc>>,
}

pub async fn admin_save_tenant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<TenantSaveRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    validate_tenant_fields(&request)?;
    let tenant_id = request
        .id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("tenant_{}", Uuid::new_v4().simple()));
    let company_key = normalize_company_name(&request.name);
    if company_key.is_empty() {
        return Err(ApiError::BadRequest("tenant name is required".to_string()));
    }
    sqlx::query(
        r#"
        insert into tenants (
          id, name, company_key, status, max_devices, billing_mode, balance_yuan,
          subscription_plan, subscription_expires_at,
          codex_subscription_enabled, codex_subscription_plan, codex_subscription_expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        on conflict (id) do update set
          name = excluded.name,
          company_key = excluded.company_key,
          status = excluded.status,
          max_devices = excluded.max_devices,
          billing_mode = excluded.billing_mode,
          subscription_plan = excluded.subscription_plan,
          subscription_expires_at = excluded.subscription_expires_at,
          codex_subscription_enabled = excluded.codex_subscription_enabled,
          codex_subscription_plan = excluded.codex_subscription_plan,
          codex_subscription_expires_at = excluded.codex_subscription_expires_at,
          updated_at = now()
        "#,
    )
    .bind(&tenant_id)
    .bind(&request.name)
    .bind(company_key)
    .bind(&request.status)
    .bind(request.max_devices)
    .bind(&request.billing_mode)
    .bind(Decimal::ZERO)
    .bind(&request.subscription_plan)
    .bind(request.subscription_expires_at)
    .bind(request.codex_subscription_enabled)
    .bind(&request.codex_subscription_plan)
    .bind(request.codex_subscription_expires_at)
    .execute(&state.db)
    .await?;
    write_audit(
        &state.db,
        &tenant_id,
        "tenant.save",
        json!({ "name": request.name, "maxDevices": request.max_devices }),
    )
    .await?;
    Ok(Json(json!({ "tenantId": tenant_id })))
}

pub async fn admin_delete_tenant(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let id = id.trim();
    if id.is_empty() {
        return Err(ApiError::BadRequest("tenant id is required".to_string()));
    }
    let row = sqlx::query("delete from tenants where id = $1 returning name")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("tenant not found".to_string()))?;
    let name = row.get::<String, _>("name");
    write_audit(
        &state.db,
        "system",
        "tenant.delete",
        json!({ "tenantId": id, "name": name }),
    )
    .await?;
    Ok(Json(json!({ "tenantId": id })))
}

pub async fn admin_list_authorization_codes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select a.id, a.tenant_id, t.name as tenant_name, a.code_hint,
          (a.code_ciphertext is not null) as revealable,
          a.max_devices, a.status, a.expires_at, a.last_used_at, a.note, a.created_at
        from authorization_codes a
        join tenants t on t.id = a.tenant_id
        order by a.created_at desc
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "authorizationCodes": rows.into_iter().map(|row| json!({
            "id": row.get::<String, _>("id"),
            "tenantId": row.get::<String, _>("tenant_id"),
            "tenantName": row.get::<String, _>("tenant_name"),
            "codeHint": row.get::<String, _>("code_hint"),
            "revealable": row.get::<bool, _>("revealable"),
            "maxDevices": row.get::<i32, _>("max_devices"),
            "status": row.get::<String, _>("status"),
            "expiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("expires_at").unwrap_or(None),
            "lastUsedAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("last_used_at").unwrap_or(None),
            "note": row.get::<String, _>("note"),
            "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at")
        })).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationCodeUpdateRequest {
    status: String,
}

pub async fn admin_update_authorization_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Json(request): Json<AuthorizationCodeUpdateRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let id = id.trim();
    let status = request.status.trim();
    if id.is_empty() || !matches!(status, "active" | "revoked" | "expired") {
        return Err(ApiError::BadRequest(
            "authorization code id and a valid status are required".to_string(),
        ));
    }
    let row = sqlx::query(
        "update authorization_codes set status = $2 where id = $1 returning tenant_id, code_hint",
    )
    .bind(id)
    .bind(status)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("authorization code not found".to_string()))?;
    let tenant_id = row.get::<String, _>("tenant_id");
    let code_hint = row.get::<String, _>("code_hint");
    write_audit(
        &state.db,
        &tenant_id,
        "authorization_code.update",
        json!({ "id": id, "codeHint": code_hint, "status": status }),
    )
    .await?;
    Ok(Json(json!({ "id": id, "status": status })))
}

pub async fn admin_reveal_authorization_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let id = id.trim();
    if id.is_empty() {
        return Err(ApiError::BadRequest(
            "authorization code id is required".to_string(),
        ));
    }
    let row = sqlx::query(
        "select tenant_id, code_hint, code_ciphertext from authorization_codes where id = $1",
    )
    .bind(id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound("authorization code not found".to_string()))?;
    let tenant_id = row.get::<String, _>("tenant_id");
    let code_hint = row.get::<String, _>("code_hint");
    let ciphertext = row
        .try_get::<Option<String>, _>("code_ciphertext")?
        .ok_or_else(|| {
            ApiError::Conflict(
                "this legacy authorization code cannot be revealed; generate a replacement code"
                    .to_string(),
            )
        })?;
    let authorization_code = state
        .authorization_code_cipher
        .decrypt(&ciphertext)
        .map_err(|error| {
            tracing::error!(authorization_code_id = %id, %error, "authorization code decryption failed");
            ApiError::Internal("authorization code could not be decrypted".to_string())
        })?;
    write_audit(
        &state.db,
        &tenant_id,
        "authorization_code.reveal",
        json!({ "id": id, "codeHint": code_hint }),
    )
    .await?;
    Ok(Json(json!({ "authorizationCode": authorization_code })))
}

pub async fn admin_delete_authorization_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let id = id.trim();
    if id.is_empty() {
        return Err(ApiError::BadRequest(
            "authorization code id is required".to_string(),
        ));
    }
    let row =
        sqlx::query("delete from authorization_codes where id = $1 returning tenant_id, code_hint")
            .bind(id)
            .fetch_optional(&state.db)
            .await?
            .ok_or_else(|| ApiError::NotFound("authorization code not found".to_string()))?;
    let tenant_id = row.get::<String, _>("tenant_id");
    let code_hint = row.get::<String, _>("code_hint");
    write_audit(
        &state.db,
        &tenant_id,
        "authorization_code.delete",
        json!({ "id": id, "codeHint": code_hint }),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizationCodeCreateRequest {
    tenant_id: String,
    #[serde(default = "default_max_devices_i32")]
    max_devices: i32,
    expires_at: Option<chrono::DateTime<Utc>>,
    #[serde(default)]
    note: String,
}

pub async fn admin_create_authorization_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<AuthorizationCodeCreateRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    if !(1..=10_000).contains(&request.max_devices)
        || request
            .expires_at
            .is_some_and(|expires_at| expires_at <= Utc::now())
    {
        return Err(ApiError::BadRequest(
            "maxDevices must be between 1 and 10000 and expiresAt must be in the future"
                .to_string(),
        ));
    }
    let tenant_exists = sqlx::query("select 1 from tenants where id = $1")
        .bind(&request.tenant_id)
        .fetch_optional(&state.db)
        .await?
        .is_some();
    if !tenant_exists {
        return Err(ApiError::NotFound("tenant not found".to_string()));
    }
    let code = generate_authorization_code();
    let normalized = normalize_authorization_code(&code);
    let code_hash = hash_authorization_code(&normalized);
    let code_hint = code_hint(&normalized);
    let code_ciphertext = state
        .authorization_code_cipher
        .encrypt(&normalized)
        .map_err(|error| {
            tracing::error!(%error, "authorization code encryption failed");
            ApiError::Internal("authorization code could not be protected".to_string())
        })?;
    let id = format!("auth_{}", Uuid::new_v4().simple());
    sqlx::query(
        r#"
        insert into authorization_codes
          (id, tenant_id, code_hash, code_hint, code_plaintext, code_ciphertext, max_devices, expires_at, note)
        values ($1, $2, $3, $4, null, $5, $6, $7, $8)
        "#,
    )
    .bind(&id)
    .bind(&request.tenant_id)
    .bind(code_hash)
    .bind(&code_hint)
    .bind(code_ciphertext)
    .bind(request.max_devices)
    .bind(request.expires_at)
    .bind(&request.note)
    .execute(&state.db)
    .await?;
    sqlx::query("update tenants set max_devices = $2, updated_at = now() where id = $1")
        .bind(&request.tenant_id)
        .bind(request.max_devices)
        .execute(&state.db)
        .await?;
    write_audit(
        &state.db,
        &request.tenant_id,
        "authorization_code.create",
        json!({ "codeHint": code_hint, "maxDevices": request.max_devices }),
    )
    .await?;
    Ok(Json(json!({
        "id": id,
        "authorizationCode": normalized,
        "codeHint": code_hint
    })))
}

pub async fn admin_list_provider_configs(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select provider, label, base_url, endpoint_path, api_key, api_key_ciphertext, api_format, auth_type,
          auth_header, custom_headers, query_params, request_timeout_ms, max_retries,
          enabled, updated_at
        from provider_configs
        order by
          case provider
            when 'openai' then 10
            when 'anthropic' then 20
            when 'google' then 30
            when 'deepseek' then 40
            when 'openrouter' then 50
            when 'xai' then 60
            when 'mistral' then 70
            when 'cohere' then 80
            when 'groq' then 90
            when 'together' then 100
            when 'fireworks' then 110
            when 'dashscope' then 120
            when 'moonshot' then 130
            when 'baidu-qianfan' then 140
            when 'zhipu' then 150
            when 'siliconflow' then 160
            when 'minimax' then 170
            when 'volcengine-ark' then 180
            when 'azure-openai' then 190
            else 999
          end,
          label
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "providers": rows.into_iter().map(|row| {
            let key_configured = !row.get::<String, _>("api_key_ciphertext").trim().is_empty()
                || !row.get::<String, _>("api_key").trim().is_empty();
            json!({
                "provider": row.get::<String, _>("provider"),
                "label": row.get::<String, _>("label"),
                "baseUrl": row.get::<String, _>("base_url"),
                "endpointPath": row.get::<String, _>("endpoint_path"),
                "apiFormat": row.get::<String, _>("api_format"),
                "authType": row.get::<String, _>("auth_type"),
                "authHeader": row.get::<String, _>("auth_header"),
                "customHeaders": row.get::<Value, _>("custom_headers"),
                "queryParams": row.get::<Value, _>("query_params"),
                "requestTimeoutMs": row.get::<i32, _>("request_timeout_ms"),
                "maxRetries": row.get::<i32, _>("max_retries"),
                "enabled": row.get::<bool, _>("enabled"),
                "keyConfigured": key_configured,
                "keyMask": if key_configured { Value::String("••••••••".to_string()) } else { Value::Null },
                "updatedAt": row.get::<chrono::DateTime<Utc>, _>("updated_at")
            })
        }).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigSaveRequest {
    provider: String,
    label: String,
    base_url: String,
    #[serde(default = "default_endpoint_path")]
    endpoint_path: String,
    api_key: Option<String>,
    #[serde(default)]
    api_format: ProviderApiFormat,
    #[serde(default)]
    auth_type: ProviderAuthType,
    #[serde(default = "default_provider_auth_header")]
    auth_header: String,
    #[serde(default)]
    custom_headers: BTreeMap<String, String>,
    #[serde(default)]
    query_params: BTreeMap<String, String>,
    #[serde(default = "default_provider_request_timeout_ms")]
    request_timeout_ms: u64,
    #[serde(default = "default_provider_max_retries")]
    max_retries: u32,
    #[serde(default)]
    enabled: bool,
}

pub async fn admin_save_provider_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ProviderConfigSaveRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let provider = request.provider.trim().to_lowercase();
    if provider.is_empty() || request.base_url.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "provider and baseUrl are required".to_string(),
        ));
    }
    validate_provider_fields(&request)?;
    let api_key = request.api_key.unwrap_or_default();
    let api_key_ciphertext = if api_key.trim().is_empty() {
        String::new()
    } else {
        state
            .managed_secret_cipher
            .encrypt_provider_api_key(api_key.trim())
            .map_err(|_| ApiError::Internal("failed to protect provider credential".to_string()))?
    };
    sqlx::query(
        r#"
        insert into provider_configs (
          provider, label, base_url, endpoint_path, api_key, api_key_ciphertext, api_format, auth_type,
          auth_header, custom_headers, query_params, request_timeout_ms, max_retries,
          enabled, updated_at
        )
        values ($1, $2, $3, $4, '', $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
        on conflict (provider) do update set
          label = excluded.label,
          base_url = excluded.base_url,
          endpoint_path = excluded.endpoint_path,
          api_key = '',
          api_key_ciphertext = case when excluded.api_key_ciphertext = '' then provider_configs.api_key_ciphertext else excluded.api_key_ciphertext end,
          api_format = excluded.api_format,
          auth_type = excluded.auth_type,
          auth_header = excluded.auth_header,
          custom_headers = excluded.custom_headers,
          query_params = excluded.query_params,
          request_timeout_ms = excluded.request_timeout_ms,
          max_retries = excluded.max_retries,
          enabled = excluded.enabled,
          updated_at = now()
        "#,
    )
    .bind(&provider)
    .bind(&request.label)
    .bind(request.base_url.trim())
    .bind(request.endpoint_path.trim())
    .bind(api_key_ciphertext)
    .bind(request.api_format.as_str())
    .bind(request.auth_type.as_str())
    .bind(request.auth_header.trim())
    .bind(json!(request.custom_headers))
    .bind(json!(request.query_params))
    .bind(request.request_timeout_ms.clamp(1_000, 900_000) as i32)
    .bind(request.max_retries.min(5) as i32)
    .bind(request.enabled)
    .execute(&state.db)
    .await?;
    write_audit(
        &state.db,
        "system",
        "provider_config.save",
        json!({
            "provider": provider,
            "enabled": request.enabled,
            "apiFormat": request.api_format.as_str(),
            "authType": request.auth_type.as_str()
        }),
    )
    .await?;
    Ok(Json(json!({ "provider": provider })))
}

pub async fn admin_discover_provider_models(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ProviderConfigSaveRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let provider_id = request.provider.trim().to_lowercase();
    if provider_id.is_empty() || request.base_url.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "provider and baseUrl are required".to_string(),
        ));
    }
    validate_provider_fields(&request)?;
    let supplied_key = request.api_key.unwrap_or_default();
    let api_key = if supplied_key.trim().is_empty() {
        let row = sqlx::query(
            "select api_key, api_key_ciphertext from provider_configs where provider = $1",
        )
        .bind(&provider_id)
        .fetch_optional(&state.db)
        .await?;
        row.as_ref()
            .map(|row| provider_api_key_from_row(&state, row))
            .transpose()?
            .unwrap_or_default()
    } else {
        supplied_key
    };
    if request.auth_type != ProviderAuthType::None && api_key.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "API key is required to discover models for this auth type".to_string(),
        ));
    }
    let provider = ProviderConfig {
        provider: provider_id.clone(),
        base_url: request.base_url.trim().to_string(),
        endpoint_path: request.endpoint_path.trim().to_string(),
        api_key,
        api_format: request.api_format,
        auth_type: request.auth_type,
        auth_header: request.auth_header,
        custom_headers: request.custom_headers,
        query_params: request.query_params,
        request_timeout_ms: request.request_timeout_ms,
        max_retries: request.max_retries,
    };
    let probe = build_model_discovery_request(&provider).map_err(ApiError::BadRequest)?;
    let upstream = send_upstream_get(&state.http, &probe)
        .await
        .map_err(ApiError::Upstream)?;
    let status = upstream.status();
    let text = upstream.text().await?;
    let body = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "raw": text }));
    if !status.is_success() {
        return Err(ApiError::Upstream(
            normalize_upstream_error_body(&provider_id, status.as_u16(), body)
                .get("error")
                .and_then(|value| value.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("model discovery failed")
                .to_string(),
        ));
    }
    let models = discover_models_from_body(&body);
    if models.is_empty() {
        return Err(ApiError::Upstream(
            "the provider returned no recognizable models; enter the model ID manually".to_string(),
        ));
    }
    Ok(Json(json!({
        "provider": provider_id,
        "models": models
    })))
}

pub async fn admin_delete_provider_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(provider): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let provider = provider.trim().to_lowercase();
    if provider.is_empty() {
        return Err(ApiError::BadRequest("provider is required".to_string()));
    }

    let mut tx = state.db.begin().await?;
    let deleted_provider = sqlx::query("delete from provider_configs where provider = $1")
        .bind(&provider)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if deleted_provider == 0 {
        return Err(ApiError::NotFound("provider not found".to_string()));
    }
    let deleted_models = sqlx::query("delete from model_routes where provider = $1")
        .bind(&provider)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;

    write_audit(
        &state.db,
        "system",
        "provider_config.delete",
        json!({ "provider": provider, "deletedModels": deleted_models }),
    )
    .await?;
    Ok(Json(
        json!({ "provider": provider, "deletedModels": deleted_models }),
    ))
}

pub async fn admin_list_model_routes(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select m.id, m.model_id, m.label, m.provider, m.mode, m.base_url, m.endpoint_path,
          m.upstream_model, m.context_window_tokens, m.max_output_tokens,
          m.supported_reasoning_efforts,
          m.default_reasoning_effort, m.fast_mode_supported, m.enabled, m.sort_order,
          m.input_yuan_per_million, m.output_yuan_per_million,
          m.reasoning_yuan_per_million, m.cached_input_yuan_per_million, m.markup_bps,
          coalesce((p.api_key_ciphertext <> '' or p.api_key <> '' or p.auth_type = 'none') and p.enabled = true, false) as provider_ready,
          m.created_at, m.updated_at
        from model_routes m
        left join provider_configs p on p.provider = m.provider
        order by m.sort_order, m.label
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "models": rows.into_iter().map(model_route_json).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRouteSaveRequest {
    id: Option<String>,
    model_id: String,
    label: String,
    provider: String,
    #[serde(default = "default_gateway_mode")]
    mode: String,
    base_url: Option<String>,
    #[serde(default = "default_endpoint_path")]
    endpoint_path: String,
    upstream_model: String,
    #[serde(default = "default_model_context_window_tokens")]
    context_window_tokens: i32,
    #[serde(default = "default_model_max_output_tokens")]
    max_output_tokens: i32,
    #[serde(default = "default_supported_reasoning_efforts")]
    supported_reasoning_efforts: Vec<String>,
    #[serde(default = "default_reasoning_effort")]
    default_reasoning_effort: String,
    #[serde(default)]
    fast_mode_supported: bool,
    #[serde(default)]
    enabled: bool,
    #[serde(default = "default_sort_order")]
    sort_order: i32,
    #[serde(default, deserialize_with = "deserialize_decimal")]
    input_yuan_per_million: Decimal,
    #[serde(default, deserialize_with = "deserialize_decimal")]
    output_yuan_per_million: Decimal,
    #[serde(default, deserialize_with = "deserialize_decimal")]
    reasoning_yuan_per_million: Decimal,
    #[serde(default, deserialize_with = "deserialize_decimal")]
    cached_input_yuan_per_million: Decimal,
    #[serde(default)]
    markup_bps: i64,
}

pub async fn admin_save_model_route(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ModelRouteSaveRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    validate_model_route_fields(&request, state.config.min_gateway_markup_bps)?;
    if request.model_id.trim().is_empty() || request.upstream_model.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "modelId and upstreamModel are required".to_string(),
        ));
    }
    let provider_row = sqlx::query("select base_url from provider_configs where provider = $1")
        .bind(request.provider.trim().to_lowercase())
        .fetch_optional(&state.db)
        .await?;
    let provider_base_url = provider_row
        .as_ref()
        .map(|row| row.get::<String, _>("base_url"))
        .ok_or_else(|| ApiError::BadRequest("provider must be configured first".to_string()))?;
    let id = request
        .id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("route_{}", Uuid::new_v4().simple()));
    let base_url = request
        .base_url
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(provider_base_url);
    sqlx::query(
        r#"
        insert into model_routes (
          id, model_id, label, provider, mode, base_url, endpoint_path, upstream_model,
          context_window_tokens, max_output_tokens, supported_reasoning_efforts,
          default_reasoning_effort,
          fast_mode_supported, enabled,
          sort_order, input_yuan_per_million, output_yuan_per_million,
          reasoning_yuan_per_million, cached_input_yuan_per_million, markup_bps, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, now())
        on conflict (model_id) do update set
          label = excluded.label,
          provider = excluded.provider,
          mode = excluded.mode,
          base_url = excluded.base_url,
          endpoint_path = excluded.endpoint_path,
          upstream_model = excluded.upstream_model,
          context_window_tokens = excluded.context_window_tokens,
          max_output_tokens = excluded.max_output_tokens,
          supported_reasoning_efforts = excluded.supported_reasoning_efforts,
          default_reasoning_effort = excluded.default_reasoning_effort,
          fast_mode_supported = excluded.fast_mode_supported,
          enabled = excluded.enabled,
          sort_order = excluded.sort_order,
          input_yuan_per_million = excluded.input_yuan_per_million,
          output_yuan_per_million = excluded.output_yuan_per_million,
          reasoning_yuan_per_million = excluded.reasoning_yuan_per_million,
          cached_input_yuan_per_million = excluded.cached_input_yuan_per_million,
          markup_bps = excluded.markup_bps,
          updated_at = now()
        "#,
    )
    .bind(&id)
    .bind(request.model_id.trim())
    .bind(request.label.trim())
    .bind(request.provider.trim().to_lowercase())
    .bind(request.mode.trim())
    .bind(base_url.trim())
    .bind(request.endpoint_path.trim())
    .bind(request.upstream_model.trim())
    .bind(request.context_window_tokens)
    .bind(request.max_output_tokens)
    .bind(&request.supported_reasoning_efforts)
    .bind(request.default_reasoning_effort.trim())
    .bind(request.fast_mode_supported)
    .bind(request.enabled)
    .bind(request.sort_order)
    .bind(request.input_yuan_per_million)
    .bind(request.output_yuan_per_million)
    .bind(request.reasoning_yuan_per_million)
    .bind(request.cached_input_yuan_per_million)
    .bind(request.markup_bps)
    .execute(&state.db)
    .await?;
    write_audit(
        &state.db,
        "system",
        "model_route.save",
        json!({ "modelId": request.model_id, "provider": request.provider }),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

pub async fn admin_delete_model_route(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let id = id.trim();
    if id.is_empty() {
        return Err(ApiError::BadRequest(
            "model route id is required".to_string(),
        ));
    }
    let row = sqlx::query("delete from model_routes where id = $1 returning model_id, provider")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("model route not found".to_string()))?;
    let model_id = row.get::<String, _>("model_id");
    let provider = row.get::<String, _>("provider");
    write_audit(
        &state.db,
        "system",
        "model_route.delete",
        json!({ "id": id, "modelId": model_id, "provider": provider }),
    )
    .await?;
    Ok(Json(json!({ "id": id, "modelId": model_id })))
}

pub async fn admin_list_codex_accounts(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let rows = sqlx::query(
        r#"
        select c.id, c.tenant_id, t.name as tenant_name, c.email, c.login_secret,
          c.login_secret_ciphertext,
          c.login_hint, c.plan, c.status, c.seat_limit, c.expires_at,
          c.assigned_at, c.created_at, c.updated_at,
          coalesce(assignments.tenant_ids, array[]::text[]) as tenant_ids,
          coalesce(assignments.tenant_names, array[]::text[]) as tenant_names
        from codex_accounts c
        left join tenants t on t.id = c.tenant_id
        left join lateral (
          select
            array_agg(cat.tenant_id order by assigned_tenant.name, cat.tenant_id) as tenant_ids,
            array_agg(assigned_tenant.name order by assigned_tenant.name, cat.tenant_id) as tenant_names
          from codex_account_tenants cat
          join tenants assigned_tenant on assigned_tenant.id = cat.tenant_id
          where cat.account_id = c.id
        ) assignments on true
        order by c.created_at desc
        "#,
    )
    .fetch_all(&state.db)
    .await?;
    Ok(Json(json!({
        "accounts": rows.into_iter().map(codex_account_json).collect::<Vec<_>>()
    })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexAccountSaveRequest {
    id: Option<String>,
    #[serde(default)]
    tenant_ids: Option<Vec<String>>,
    tenant_id: Option<String>,
    email: String,
    login_secret: Option<String>,
    #[serde(default)]
    login_hint: String,
    #[serde(default = "default_monthly_plan")]
    plan: String,
    #[serde(default = "default_status")]
    status: String,
    #[serde(default = "default_one")]
    seat_limit: i32,
    expires_at: Option<chrono::DateTime<Utc>>,
}

pub async fn admin_save_codex_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CodexAccountSaveRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    if request.email.trim().is_empty() {
        return Err(ApiError::BadRequest("email is required".to_string()));
    }
    let id = request
        .id
        .filter(|id| !id.trim().is_empty())
        .unwrap_or_else(|| format!("codex_{}", Uuid::new_v4().simple()));
    let tenant_ids = normalized_codex_tenant_ids(request.tenant_ids, request.tenant_id);
    let primary_tenant_id = tenant_ids.first().cloned();
    let login_secret = request.login_secret.unwrap_or_default();
    let login_secret_ciphertext = if login_secret.trim().is_empty() {
        String::new()
    } else {
        state
            .managed_secret_cipher
            .encrypt_codex_login_secret(login_secret.trim())
            .map_err(|_| ApiError::Internal("failed to protect account credential".to_string()))?
    };
    let mut transaction = state.db.begin().await?;
    sqlx::query(
        r#"
        insert into codex_accounts (
          id, tenant_id, email, login_secret, login_secret_ciphertext, login_hint, plan, status, seat_limit,
          expires_at, assigned_at, updated_at
        )
        values ($1, $2, $3, '', $4, $5, $6, $7, $8, $9, case when $2::text is null then null else now() end, now())
        on conflict (id) do update set
          tenant_id = excluded.tenant_id,
          email = excluded.email,
          login_secret = '',
          login_secret_ciphertext = case when excluded.login_secret_ciphertext = '' then codex_accounts.login_secret_ciphertext else excluded.login_secret_ciphertext end,
          login_hint = excluded.login_hint,
          plan = excluded.plan,
          status = excluded.status,
          seat_limit = excluded.seat_limit,
          expires_at = excluded.expires_at,
          assigned_at = case when excluded.tenant_id is distinct from codex_accounts.tenant_id then now() else codex_accounts.assigned_at end,
          updated_at = now()
        "#,
    )
    .bind(&id)
    .bind(&primary_tenant_id)
    .bind(request.email.trim())
    .bind(login_secret_ciphertext)
    .bind(request.login_hint.trim())
    .bind(request.plan.trim())
    .bind(request.status.trim())
    .bind(request.seat_limit)
    .bind(request.expires_at)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("delete from codex_account_tenants where account_id = $1")
        .bind(&id)
        .execute(&mut *transaction)
        .await?;
    for tenant_id in &tenant_ids {
        sqlx::query("insert into codex_account_tenants (account_id, tenant_id) values ($1, $2)")
            .bind(&id)
            .bind(tenant_id)
            .execute(&mut *transaction)
            .await?;
    }
    transaction.commit().await?;
    write_audit(
        &state.db,
        primary_tenant_id.as_deref().unwrap_or("system"),
        "codex_account.save",
        json!({ "email": request.email, "tenantIds": tenant_ids }),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

pub async fn admin_delete_codex_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &headers)?;
    let id = id.trim();
    if id.is_empty() {
        return Err(ApiError::BadRequest(
            "codex account id is required".to_string(),
        ));
    }
    let row = sqlx::query("delete from codex_accounts where id = $1 returning tenant_id, email")
        .bind(id)
        .fetch_optional(&state.db)
        .await?
        .ok_or_else(|| ApiError::NotFound("codex account not found".to_string()))?;
    let tenant_id = row
        .try_get::<Option<String>, _>("tenant_id")
        .unwrap_or(None)
        .unwrap_or_else(|| "system".to_string());
    let email = row.get::<String, _>("email");
    write_audit(
        &state.db,
        &tenant_id,
        "codex_account.delete",
        json!({ "id": id, "email": email }),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientAgreementAcceptance {
    service_terms_version: String,
    service_terms_accepted: bool,
    privacy_policy_version: String,
    privacy_policy_accepted: bool,
    third_party_model_notice_version: String,
    third_party_model_notice_accepted: bool,
    research_risk_disclosure_version: String,
    research_risk_disclosure_accepted: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientActivateRequest {
    company_name: String,
    authorization_code: String,
    fingerprint: String,
    device_name: String,
    #[serde(default = "default_client_email")]
    user_email: String,
    #[serde(default = "default_client_name")]
    user_name: String,
    agreement_acceptance: ClientAgreementAcceptance,
}

pub async fn client_activate(
    State(state): State<AppState>,
    Json(request): Json<ClientActivateRequest>,
) -> ApiResult<Json<Value>> {
    validate_client_agreement_acceptance(&request.agreement_acceptance)?;
    let company_key = normalize_company_name(&request.company_name);
    let authorization_code = normalize_authorization_code(&request.authorization_code);
    if company_key.is_empty() || authorization_code.is_empty() {
        return Err(ApiError::BadRequest(
            "companyName and authorizationCode are required".to_string(),
        ));
    }
    let code_hash = hash_authorization_code(&authorization_code);
    let row = sqlx::query(
        r#"
        select t.id as tenant_id, t.name, t.max_devices, t.codex_subscription_enabled,
          t.codex_subscription_plan, t.codex_subscription_expires_at,
          a.id as authorization_id, a.max_devices as code_max_devices
        from authorization_codes a
        join tenants t on t.id = a.tenant_id
        where t.company_key = $1
          and t.status = 'active'
          and a.code_hash = $2
          and a.status = 'active'
          and (a.expires_at is null or a.expires_at > now())
        "#,
    )
    .bind(&company_key)
    .bind(&code_hash)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::Forbidden("company or authorization code is invalid".to_string()))?;

    let tenant_id = row.get::<String, _>("tenant_id");
    let tenant_name = row.get::<String, _>("name");
    let max_devices = row
        .try_get::<i32, _>("code_max_devices")
        .unwrap_or_else(|_| row.get::<i32, _>("max_devices"));
    ensure_device_capacity_for_fingerprint(
        &state.db,
        &tenant_id,
        &request.fingerprint,
        max_devices,
    )
    .await?;

    let user_id = upsert_client_user(
        &state.db,
        &tenant_id,
        &request.user_email,
        &request.user_name,
    )
    .await?;
    let (device_id, lease_expires_at) = upsert_device(
        &state.db,
        &tenant_id,
        &user_id,
        &request.fingerprint,
        &request.device_name,
    )
    .await?;
    record_client_agreement_acceptance(
        &state.db,
        &tenant_id,
        &user_id,
        &device_id,
        &request.agreement_acceptance,
    )
    .await?;
    sqlx::query("update authorization_codes set last_used_at = now() where id = $1")
        .bind(row.get::<String, _>("authorization_id"))
        .execute(&state.db)
        .await?;
    write_audit(
        &state.db,
        &tenant_id,
        "client.activate",
        json!({
            "companyName": request.company_name,
            "deviceName": request.device_name,
            "agreementVersions": {
                "serviceTerms": request.agreement_acceptance.service_terms_version,
                "privacyPolicy": request.agreement_acceptance.privacy_policy_version,
                "thirdPartyModelNotice": request.agreement_acceptance.third_party_model_notice_version,
                "researchRiskDisclosure": request.agreement_acceptance.research_risk_disclosure_version
            }
        }),
    )
    .await?;
    let models = load_models(&state.db).await?;
    let codex_accounts = load_codex_accounts_for_client(&state.db, &tenant_id).await?;
    let subscription_enabled = codex_subscription_available(
        row.get::<bool, _>("codex_subscription_enabled"),
        row.try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at")
            .unwrap_or(None),
        Utc::now(),
    );
    let access_token = issue_device_access_token(
        &state,
        &tenant_id,
        &user_id,
        &device_id,
        &request.fingerprint,
    )?;
    Ok(Json(json!({
        "tenant": {
            "id": tenant_id,
            "name": tenant_name,
            "maxDevices": max_devices,
            "codexSubscriptionEnabled": subscription_enabled,
            "codexSubscriptionPlan": row.try_get::<Option<String>, _>("codex_subscription_plan").unwrap_or(None),
            "codexSubscriptionExpiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at").unwrap_or(None)
        },
        "user": {
            "id": user_id,
            "email": request.user_email,
            "name": request.user_name
        },
        "device": {
            "id": device_id,
            "accessToken": access_token,
            "leaseExpiresAt": lease_expires_at
        },
        "models": models,
        "codexAccounts": if subscription_enabled { codex_accounts } else { Vec::new() }
    })))
}

pub async fn gateway_models(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let token = bearer_token(&headers)?;
    let claims = state.run_tokens.verify(token)?;
    ensure_gateway_run_available(&state.db, &claims).await?;
    let row = sqlx::query(
        "select model_id, label from model_routes where model_id = $1 and enabled = true",
    )
    .bind(&claims.model_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::NotFound(format!("model {} is not available", claims.model_id)))?;
    Ok(Json(json!({
        "object": "list",
        "data": [{
            "id": row.get::<String, _>("model_id"),
            "object": "model",
            "owned_by": "alpha-studio",
            "name": row.get::<String, _>("label")
        }]
    })))
}

pub async fn gateway_run_status(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    let claims = state.run_tokens.verify(bearer_token(&headers)?)?;
    ensure_gateway_run_available(&state.db, &claims).await?;
    let mut status = serde_json::to_value(state.gateway_run_queue.status(&claims.run_id).await)
        .map_err(|error| ApiError::Internal(error.to_string()))?;
    let dispatched = sqlx::query(
        r#"
        select count(*) as total,
          count(*) filter (where dispatching and dispatch_expires_at > now()) as active,
          count(*) filter (where dispatching and dispatch_expires_at > now() and lane <> 'main') as subagents,
          count(*) filter (where not dispatching) as waiting,
          coalesce(extract(epoch from max(c.cooldown_until) filter (where c.cooldown_until > now())) * 1000, 0)::bigint as cooldown_until
        from gateway_request_leases l
        left join gateway_provider_cooldowns c on c.provider_key=l.provider_key
        where l.run_id=$1
        "#,
    )
    .bind(&claims.run_id)
    .fetch_one(&state.db)
    .await?;
    if dispatched.get::<i64, _>("total") > 0 || status.is_object() {
        if !status.is_object() {
            status = json!({"active":true,"waitingRequests":0,"lastOutputAt":0});
        }
        status["waitingRequests"] = json!(
            status["waitingRequests"].as_u64().unwrap_or(0)
                + dispatched.get::<i64, _>("waiting") as u64
        );
        status["activeRequests"] = json!(dispatched.get::<i64, _>("active"));
        status["activeSubagents"] = json!(dispatched.get::<i64, _>("subagents"));
        status["cooldownUntil"] = json!(dispatched.get::<i64, _>("cooldown_until"));
        status["maxParallelSubagents"] = json!(gateway_admission::MAX_SUBAGENT_REQUESTS);
    }
    Ok(Json(json!({ "status": status })))
}

pub async fn gateway_responses(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<Value>,
) -> ApiResult<Response> {
    let token = bearer_token(&headers)?;
    let claims = state.run_tokens.verify(token)?;
    ensure_gateway_run_available(&state.db, &claims).await?;
    let route = load_model_route(
        &state.db,
        &claims.model_id,
        state.config.min_gateway_markup_bps,
    )
    .await?;
    let request_pricing = pricing_for_gateway_request(&route.pricing, &body);
    let provider = load_provider_config(&state, &route).await?;
    let gateway_request_id = format!("gwreq_{}", Uuid::new_v4().simple());
    let lane = RequestLane::from_codex(&headers, &body);
    // Hash credentials; never persist or log raw provider secrets as keys.
    let provider_key = hex::encode(Sha256::digest(format!(
        "{}\0{}\0{}",
        provider.provider,
        provider.base_url.trim_end_matches('/'),
        provider.api_key
    )));
    let wait_timeout = gateway_request_wait_timeout(&provider);
    let queue_started = std::time::Instant::now();
    let run_permit = state
        .gateway_run_queue
        .acquire_lane(&claims.run_id, &lane, wait_timeout)
        .await
        .ok_or_else(|| {
            tracing::warn!(
                run_id = %claims.run_id,
                request_id = ?headers.get("x-request-id"),
                wait_ms = queue_started.elapsed().as_millis(),
                "gateway queue made no progress before its request deadline"
            );
            ApiError::GatewayBusy("任务内请求仍在等待前序操作，尚未发送给模型服务。".to_string())
        })?;
    if queue_started.elapsed() >= GATEWAY_REQUEST_LEASE_RETRY_INTERVAL {
        tracing::info!(
            run_id = %claims.run_id,
            wait_ms = queue_started.elapsed().as_millis(),
            "waited in per-run gateway request queue"
        );
    }
    enforce_request_budget(&mut body, claims.budget_yuan, &route, &request_pricing)?;
    let reservation = request_safety_charge_yuan(
        estimate_request_input_tokens(&body, route.context_window_tokens)?,
        body["max_output_tokens"]
            .as_u64()
            .unwrap_or(route.max_output_tokens),
        &request_pricing,
    );
    let remaining_budget = {
        let _waiting = run_permit.waiting_for_admission();
        gateway_admission::reserve_request(
            &state.db,
            &claims,
            &gateway_request_id,
            &lane,
            Some(reservation),
            Some(&provider_key),
            wait_timeout,
        )
        .await?
    };
    if let Err(error) =
        enforce_request_budget(&mut body, remaining_budget, &route, &request_pricing)
    {
        release_gateway_request(&state.db, &claims, &gateway_request_id, None).await?;
        return Err(error);
    }
    let original_body = body.clone();
    let upstream_request = match build_upstream_request(&provider, &route.upstream_model, &mut body)
    {
        Ok(request) => request,
        Err(error) => {
            release_gateway_request(&state.db, &claims, &gateway_request_id, None).await?;
            return Err(ApiError::BadRequest(error));
        }
    };

    let started = Utc::now();

    let upstream = match send_upstream_post(
        &state.http,
        &upstream_request,
        &body,
        &gateway_request_id,
        &state.db,
        &provider_key,
        wait_timeout,
    )
    .await
    {
        Ok(response) => response,
        Err(error) => {
            if error.may_have_incurred_cost {
                settle_and_record_usage(
                    &state.db,
                    &claims,
                    &gateway_request_id,
                    &request_pricing,
                    &GatewayUsage::default(),
                    0,
                    started,
                    MeteringStatus::UsageUnavailable("ambiguous upstream transport failure"),
                )
                .await?;
            } else {
                release_gateway_request(&state.db, &claims, &gateway_request_id, None).await?;
            }
            if let Some(body) = error.rate_limit_body {
                let mut normalized = normalize_upstream_error_body(&provider.provider, 429, body);
                normalized["error"]["source"] = json!("upstream");
                if let Some(id) = error
                    .headers
                    .get("x-request-id")
                    .and_then(|value| value.to_str().ok())
                {
                    normalized["error"]["upstream_request_id"] = json!(id);
                }
                let mut response =
                    (StatusCode::TOO_MANY_REQUESTS, Json(normalized)).into_response();
                for name in ["retry-after", "x-request-id"] {
                    if let Some(value) = error.headers.get(name) {
                        response.headers_mut().insert(name, value.clone());
                    }
                }
                return Ok(response);
            }
            if error.waiting {
                return Err(ApiError::GatewayBusy(error.message));
            }
            return Err(ApiError::Upstream(error.message));
        }
    };
    let status = upstream.status();
    if status.is_success() && upstream_request.stream_response {
        return Ok(stream_upstream_response(
            upstream,
            upstream_request,
            original_body,
            state.db.clone(),
            claims,
            gateway_request_id,
            request_pricing,
            started,
            run_permit,
        ));
    }
    let text = match upstream.text().await {
        Ok(text) => text,
        Err(error) => {
            settle_and_record_usage(
                &state.db,
                &claims,
                &gateway_request_id,
                &request_pricing,
                &GatewayUsage::default(),
                status.as_u16(),
                started,
                MeteringStatus::UsageUnavailable("upstream response body failed after dispatch"),
            )
            .await?;
            return Err(ApiError::Upstream(format!(
                "failed to read upstream response: {error}"
            )));
        }
    };
    let upstream_body =
        serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "raw": text }));

    if status.is_success() {
        let response_body = match normalize_upstream_success_body_for_request(
            upstream_request.response_format,
            upstream_body,
            &original_body,
        ) {
            Ok(body) => body,
            Err(error) => {
                settle_and_record_usage(
                    &state.db,
                    &claims,
                    &gateway_request_id,
                    &request_pricing,
                    &GatewayUsage::default(),
                    status.as_u16(),
                    started,
                    MeteringStatus::UsageUnavailable(
                        "successful upstream response could not be normalized",
                    ),
                )
                .await?;
                return Err(ApiError::Upstream(error));
            }
        };
        let usage = usage_from_openai_response(&response_body);
        settle_and_record_usage(
            &state.db,
            &claims,
            &gateway_request_id,
            &request_pricing,
            &usage,
            status.as_u16(),
            started,
            MeteringStatus::from_usage(&usage, "upstream response omitted usage"),
        )
        .await?;
        let response_status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK);
        Ok((response_status, Json(response_body)).into_response())
    } else {
        if status.is_server_error() || status.as_u16() == 408 {
            settle_and_record_usage(
                &state.db,
                &claims,
                &gateway_request_id,
                &request_pricing,
                &GatewayUsage::default(),
                status.as_u16(),
                started,
                MeteringStatus::UsageUnavailable(
                    "upstream may have incurred inference cost before returning an error",
                ),
            )
            .await?;
        } else {
            release_gateway_request(
                &state.db,
                &claims,
                &gateway_request_id,
                Some(status.as_u16()),
            )
            .await?;
        }
        Ok((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(normalize_upstream_error_body(
                &provider.provider,
                status.as_u16(),
                upstream_body,
            )),
        )
            .into_response())
    }
}

// Keep the stream's request, accounting context, and queue permit together.

#[allow(clippy::too_many_arguments)]
fn stream_upstream_response(
    upstream: reqwest::Response,
    request: UpstreamRequest,
    original_body: Value,
    pool: PgPool,
    claims: RunTokenClaims,
    gateway_request_id: String,
    pricing: Pricing,
    started: chrono::DateTime<Utc>,
    run_permit: GatewayRunPermit,
) -> Response {
    let upstream_status = upstream.status().as_u16();
    let format = request.response_format;
    let namespace_tool_compat = request.namespace_tool_compat;
    let (sender, receiver) = tokio::sync::mpsc::channel::<Result<Bytes, Infallible>>(32);

    tokio::spawn(async move {
        let mut source = upstream.bytes_stream();
        let mut decoder = SseDecoder::default();
        let mut adapter = (format != crate::gateway::UpstreamResponseFormat::Responses)
            .then(|| ResponsesStreamAdapter::new(format, &original_body));
        let mut usage = GatewayUsage::default();
        let mut failed = false;
        let mut failure_message = None;
        let mut saw_done = false;
        let mut terminal_output = Vec::new();

        while let Some(chunk) = source.next().await {
            match chunk {
                Ok(chunk) => {
                    let frames = decoder.push(&chunk);
                    if let Some(adapter) = adapter.as_mut() {
                        for frame in frames {
                            let Some(data) = frame.data else {
                                continue;
                            };
                            match adapter.ingest(&data) {
                                Ok(output) if adapter.is_finished() => {
                                    run_permit.record_model_sse(&output);
                                    terminal_output.extend_from_slice(output.as_bytes());
                                    saw_done = true;
                                }
                                Ok(output) => {
                                    run_permit.record_model_sse(&output);
                                    send_stream_bytes(&sender, output).await;
                                }
                                Err(error) => {
                                    failed = true;
                                    failure_message = Some(error.clone());
                                    terminal_output
                                        .extend_from_slice(adapter.fail(&error).as_bytes());
                                    break;
                                }
                            }
                        }
                    } else {
                        for frame in frames {
                            let terminal = frame
                                .data
                                .as_deref()
                                .map(is_terminal_responses_stream_data)
                                .unwrap_or(false);
                            if let Some(data) = frame.data.as_deref() {
                                run_permit.record_model_data(data);
                                match inspect_responses_stream_data(data) {
                                    Some(NativeStreamEvent::Completed(value)) => usage = value,
                                    Some(NativeStreamEvent::Failed) => failed = true,
                                    None => {}
                                }
                                if data.trim() == "[DONE]" {
                                    saw_done = true;
                                }
                            }
                            let output = if namespace_tool_compat {
                                restore_namespace_tools_in_sse_frame(frame, &original_body)
                            } else {
                                frame.raw
                            };
                            if terminal {
                                terminal_output.extend_from_slice(&output);
                                // Responses has a semantic terminal event; it
                                // need not send [DONE] or close the HTTP body.
                                saw_done = true;
                            } else {
                                let _ = sender.send(Ok(Bytes::from(output))).await;
                            }
                        }
                    }
                    if failed || saw_done {
                        break;
                    }
                }
                Err(error) => {
                    failed = true;
                    failure_message = Some(error.to_string());
                    let output = if let Some(adapter) = adapter.as_mut() {
                        adapter.fail(&error.to_string())
                    } else {
                        native_stream_failure(&error.to_string())
                    };
                    terminal_output.extend_from_slice(output.as_bytes());
                    break;
                }
            }
        }

        if !failed && !saw_done {
            if let Some(frame) = decoder.finish() {
                if let Some(adapter) = adapter.as_mut() {
                    if let Some(data) = frame.data.as_deref() {
                        match adapter.ingest(data) {
                            Ok(output) if adapter.is_finished() => {
                                run_permit.record_model_sse(&output);
                                terminal_output.extend_from_slice(output.as_bytes());
                            }
                            Ok(output) => {
                                run_permit.record_model_sse(&output);
                                send_stream_bytes(&sender, output).await;
                            }
                            Err(error) => {
                                failed = true;
                                failure_message = Some(error.clone());
                                terminal_output.extend_from_slice(adapter.fail(&error).as_bytes());
                            }
                        }
                    }
                } else {
                    let terminal = frame
                        .data
                        .as_deref()
                        .map(is_terminal_responses_stream_data)
                        .unwrap_or(false);
                    if let Some(data) = frame.data.as_deref() {
                        run_permit.record_model_data(data);
                        if let Some(event) = inspect_responses_stream_data(data) {
                            match event {
                                NativeStreamEvent::Completed(value) => usage = value,
                                NativeStreamEvent::Failed => failed = true,
                            }
                        }
                    }
                    let output = if namespace_tool_compat {
                        restore_namespace_tools_in_sse_frame(frame, &original_body)
                    } else {
                        frame.raw
                    };
                    if terminal {
                        terminal_output.extend_from_slice(&output);
                    } else {
                        let _ = sender.send(Ok(Bytes::from(output))).await;
                    }
                }
            }
        }

        if !failed {
            if let Some(adapter) = adapter.as_mut() {
                terminal_output.extend_from_slice(adapter.finish().as_bytes());
                usage = adapter.usage();
            }
        }
        if !failed {
            if let Err(error) = settle_and_record_usage(
                &pool,
                &claims,
                &gateway_request_id,
                &pricing,
                &usage,
                upstream_status,
                started,
                MeteringStatus::from_usage(&usage, "upstream stream omitted final usage"),
            )
            .await
            {
                tracing::error!(run_id = %claims.run_id, %error, "failed to settle streamed model usage");
            }
        } else {
            if let Err(error) = settle_and_record_usage(
                &pool,
                &claims,
                &gateway_request_id,
                &pricing,
                &usage,
                upstream_status,
                started,
                MeteringStatus::UsageUnavailable("upstream stream failed after dispatch"),
            )
            .await
            {
                tracing::error!(run_id = %claims.run_id, %error, "failed to settle failed streamed model usage");
            }
            if let Some(message) = failure_message {
                tracing::warn!(run_id = %claims.run_id, %message, "upstream model stream failed");
            }
        }
        // Codex starts the next model call when it sees response.completed or
        // [DONE], without waiting for HTTP EOF. Publish those terminal frames only
        // after settlement has released this run's per-request lease.
        if !terminal_output.is_empty() {
            let _ = sender.send(Ok(Bytes::from(terminal_output))).await;
        }
        drop(run_permit);
        drop(sender);
    });

    Response::builder()
        .status(StatusCode::from_u16(upstream_status).unwrap_or(StatusCode::OK))
        .header(header::CONTENT_TYPE, "text/event-stream; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-cache, no-transform")
        .header("x-accel-buffering", "no")
        .body(Body::from_stream(
            tokio_stream::wrappers::ReceiverStream::new(receiver),
        ))
        .expect("streaming response headers are valid")
}

async fn send_stream_bytes(
    sender: &tokio::sync::mpsc::Sender<Result<Bytes, Infallible>>,
    output: String,
) {
    if !output.is_empty() {
        let _ = sender.send(Ok(Bytes::from(output))).await;
    }
}

fn native_stream_failure(message: &str) -> String {
    let escaped = json!({
        "type": "response.failed",
        "response": {
            "id": "resp_alpha_studio_gateway",
            "status": "failed",
            "error": { "code": "upstream_stream_error", "message": message }
        }
    });
    format!("event: response.failed\ndata: {escaped}\n\ndata: [DONE]\n\n")
}

#[derive(Debug)]
struct UpstreamPostError {
    message: String,
    may_have_incurred_cost: bool,
    waiting: bool,
    rate_limit_body: Option<Value>,
    headers: HeaderMap,
}

impl UpstreamPostError {
    fn local(message: String, cost: bool, waiting: bool) -> Self {
        Self {
            message,
            may_have_incurred_cost: cost,
            waiting,
            rate_limit_body: None,
            headers: HeaderMap::new(),
        }
    }
}

async fn send_upstream_post(
    client: &reqwest::Client,
    request: &UpstreamRequest,
    body: &Value,
    idempotency_key: &str,
    pool: &PgPool,
    provider_key: &str,
    wait_timeout: Duration,
) -> Result<reqwest::Response, UpstreamPostError> {
    let deadline = tokio::time::Instant::now() + wait_timeout;
    let mut retry_wait_left = gateway_admission::MAX_RETRY_WAIT;
    for attempt in 0..=request.max_retries {
        gateway_admission::acquire_dispatch(pool, provider_key, idempotency_key, deadline)
            .await
            .map_err(|error| {
                UpstreamPostError::local(
                    error.to_string(),
                    false,
                    matches!(error, ApiError::GatewayBusy(_)),
                )
            })?;
        let mut builder = client
            .post(&request.url)
            .header("content-type", "application/json")
            .header("idempotency-key", idempotency_key)
            .timeout(
                Duration::from_millis(request.request_timeout_ms)
                    .min(deadline.saturating_duration_since(tokio::time::Instant::now())),
            )
            .query(&request.query_params)
            .json(body);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        match builder.send().await {
            Ok(response) if response.status().as_u16() == 429 => {
                let headers = response.headers().clone();
                let text = response.text().await.unwrap_or_default();
                let mut error_body = serde_json::from_str::<Value>(&text)
                    .unwrap_or_else(|_| json!({"error":{"message":text}}));
                let permanent = is_quota_error(&error_body);
                let delay = retry_delay(&headers, attempt);
                gateway_admission::record_rate_limit(pool, provider_key, idempotency_key, delay)
                    .await
                    .map_err(|error| UpstreamPostError::local(error.to_string(), false, false))?;
                tracing::warn!(request_id=idempotency_key, upstream_request_id=?headers.get("x-request-id"), attempt, permanent, wait_ms=delay.as_millis(), "upstream model rate limited; shared cooldown applied");
                if permanent
                    || attempt == request.max_retries
                    || delay > retry_wait_left
                    || tokio::time::Instant::now() + delay >= deadline
                {
                    if let Some(error) = error_body.get_mut("error").and_then(Value::as_object_mut)
                    {
                        error.insert("source".into(), json!("upstream"));
                        if let Some(id) = headers.get("x-request-id").and_then(|v| v.to_str().ok())
                        {
                            error.insert("upstream_request_id".into(), json!(id));
                        }
                    }
                    return Err(UpstreamPostError {
                        message: "upstream model rate limit".into(),
                        may_have_incurred_cost: false,
                        waiting: false,
                        rate_limit_body: Some(error_body),
                        headers,
                    });
                }
                retry_wait_left = retry_wait_left.saturating_sub(delay);
                // acquire_dispatch observes the shared cooldown on the next
                // attempt. Recovery dispatch is serialized for 60 seconds.
            }
            Ok(response) => return Ok(response),
            Err(error) => {
                // Never replay a possibly billable timeout, partial stream or
                // server error. Only a connection failure is safe to retry.
                if !error.is_connect() || attempt == request.max_retries {
                    return Err(UpstreamPostError::local(
                        error.to_string(),
                        !error.is_connect(),
                        false,
                    ));
                }
                let delay = retry_delay(&HeaderMap::new(), attempt);
                gateway_admission::record_rate_limit(pool, provider_key, idempotency_key, delay)
                    .await
                    .map_err(|error| UpstreamPostError::local(error.to_string(), false, false))?;
                if delay > retry_wait_left || tokio::time::Instant::now() + delay >= deadline {
                    return Err(UpstreamPostError::local(error.to_string(), false, false));
                }
                retry_wait_left = retry_wait_left.saturating_sub(delay);
            }
        }
    }
    Err(UpstreamPostError::local(
        "upstream request attempts exhausted".into(),
        false,
        false,
    ))
}

fn is_quota_error(body: &Value) -> bool {
    [body.pointer("/error/code"), body.pointer("/error/type")]
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .any(|code| {
            matches!(
                code,
                "insufficient_quota"
                    | "billing_hard_limit_reached"
                    | "billing_not_active"
                    | "credit_balance_too_low"
            )
        })
}

async fn send_upstream_get(
    client: &reqwest::Client,
    request: &UpstreamRequest,
) -> Result<reqwest::Response, String> {
    let mut last_error = None;
    let mut retry_wait_left = gateway_admission::MAX_RETRY_WAIT;
    for attempt in 0..=request.max_retries {
        let mut builder = client
            .get(&request.url)
            .timeout(Duration::from_millis(request.request_timeout_ms))
            .query(&request.query_params);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        match builder.send().await {
            Ok(response) => {
                if attempt < request.max_retries && is_retryable_status(response.status()) {
                    let delay = retry_delay(response.headers(), attempt);
                    if delay > retry_wait_left {
                        return Ok(response);
                    }
                    retry_wait_left = retry_wait_left.saturating_sub(delay);
                    tokio::time::sleep(delay).await;
                    continue;
                }
                return Ok(response);
            }
            Err(error) => {
                let retryable = error.is_timeout() || error.is_connect() || error.is_request();
                last_error = Some(error.to_string());
                if attempt >= request.max_retries || !retryable {
                    break;
                }
                let delay = retry_delay(&HeaderMap::new(), attempt);
                if delay > retry_wait_left {
                    break;
                }
                retry_wait_left = retry_wait_left.saturating_sub(delay);
                tokio::time::sleep(delay).await;
            }
        }
    }
    Err(last_error.unwrap_or_else(|| "upstream request failed".to_string()))
}

fn is_retryable_status(status: reqwest::StatusCode) -> bool {
    matches!(status.as_u16(), 408 | 429 | 500 | 502 | 503 | 504)
}

fn retry_delay(headers: &HeaderMap, attempt: u32) -> Duration {
    let retry_after = headers
        .get("retry-after")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| {
            value
                .trim()
                .parse::<u32>()
                .ok()
                .map(|seconds| Duration::from_secs(u64::from(seconds)))
                .or_else(|| {
                    chrono::DateTime::parse_from_rfc2822(value)
                        .ok()
                        .and_then(|date| (date.with_timezone(&Utc) - Utc::now()).to_std().ok())
                })
        });
    let jitter = Duration::from_millis((Uuid::new_v4().as_u128() % 251) as u64);
    retry_after
        .unwrap_or_else(|| Duration::from_secs(2_u64.pow(attempt.min(5))))
        .saturating_add(jitter)
}

#[derive(Debug)]
struct ModelRoute {
    provider: String,
    base_url: String,
    endpoint_path: String,
    upstream_model: String,
    context_window_tokens: u64,
    max_output_tokens: u64,
    pricing: Pricing,
}

async fn load_models(pool: &PgPool) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        select model_id, label, provider, mode, context_window_tokens, max_output_tokens,
          supported_reasoning_efforts, default_reasoning_effort, fast_mode_supported, enabled
        from model_routes
        where enabled = true
        order by sort_order, label
        "#,
    )
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("model_id"),
                "label": row.get::<String, _>("label"),
                "provider": row.get::<String, _>("provider"),
                "mode": row.get::<String, _>("mode"),
                "contextWindowTokens": row.get::<i32, _>("context_window_tokens"),
                "maxOutputTokens": row.get::<i32, _>("max_output_tokens"),
                "supportedReasoningEfforts": row.get::<Vec<String>, _>("supported_reasoning_efforts"),
                "defaultReasoningEffort": row.get::<String, _>("default_reasoning_effort"),
                "fastModeSupported": row.get::<bool, _>("fast_mode_supported"),
                "enabled": row.get::<bool, _>("enabled")
            })
        })
        .collect())
}

async fn load_model_route(
    pool: &PgPool,
    model_id: &str,
    minimum_markup_bps: u64,
) -> ApiResult<ModelRoute> {
    let row = sqlx::query(
        r#"
        select provider, base_url, endpoint_path, upstream_model, context_window_tokens,
            max_output_tokens, input_yuan_per_million,
            output_yuan_per_million, reasoning_yuan_per_million,
            cached_input_yuan_per_million, markup_bps
        from model_routes
        where model_id = $1 and enabled = true and mode = 'gateway_api'
        "#,
    )
    .bind(model_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        ApiError::NotFound(format!("model {model_id} is not available for gateway API"))
    })?;
    let markup_bps = u64::try_from(row.get::<i64, _>("markup_bps")).map_err(|_| {
        ApiError::BadRequest(format!("model {model_id} has invalid negative markup"))
    })?;
    let pricing = Pricing {
        input_yuan_per_million: row.get("input_yuan_per_million"),
        output_yuan_per_million: row.get("output_yuan_per_million"),
        reasoning_yuan_per_million: row.get("reasoning_yuan_per_million"),
        cached_input_yuan_per_million: row.get("cached_input_yuan_per_million"),
        markup_bps,
    };
    if !pricing.is_valid() || pricing.markup_bps < minimum_markup_bps {
        return Err(ApiError::BadRequest(format!(
            "model {model_id} has unsafe or incomplete pricing and has been blocked"
        )));
    }
    Ok(ModelRoute {
        provider: row.get("provider"),
        base_url: row.get("base_url"),
        endpoint_path: row.get("endpoint_path"),
        upstream_model: row.get("upstream_model"),
        context_window_tokens: row.get::<i32, _>("context_window_tokens") as u64,
        max_output_tokens: row.get::<i32, _>("max_output_tokens") as u64,
        pricing,
    })
}

fn pricing_for_gateway_request(pricing: &Pricing, body: &Value) -> Pricing {
    // Codex exposes this as `service_tier = "fast"` in its configuration and
    // translates it to the OpenAI Responses API's `priority` service tier.
    // Priority inference costs twice the configured standard token prices.
    if body.get("service_tier").and_then(Value::as_str) == Some("priority") {
        pricing.with_cost_multiplier(FAST_MODE_COST_MULTIPLIER)
    } else {
        pricing.clone()
    }
}

async fn load_provider_config(state: &AppState, route: &ModelRoute) -> ApiResult<ProviderConfig> {
    let row = sqlx::query(
        r#"
        select provider, base_url, endpoint_path, api_key, api_key_ciphertext, api_format, auth_type,
          auth_header, custom_headers, query_params, request_timeout_ms, max_retries
        from provider_configs
        where provider = $1 and enabled = true
          and (api_key_ciphertext <> '' or api_key <> '' or auth_type = 'none')
        "#,
    )
    .bind(&route.provider)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| {
        ApiError::BadRequest(format!(
            "provider {} is not configured in admin",
            route.provider
        ))
    })?;
    Ok(ProviderConfig {
        provider: row.get("provider"),
        base_url: if route.base_url.trim().is_empty() {
            row.get("base_url")
        } else {
            route.base_url.clone()
        },
        endpoint_path: if route.endpoint_path.trim().is_empty() {
            row.get("endpoint_path")
        } else {
            route.endpoint_path.clone()
        },
        api_key: provider_api_key_from_row(state, &row)?,
        api_format: ProviderApiFormat::parse(&row.get::<String, _>("api_format")),
        auth_type: ProviderAuthType::parse(&row.get::<String, _>("auth_type")),
        auth_header: row.get("auth_header"),
        custom_headers: json_value_to_string_map(row.get("custom_headers")),
        query_params: json_value_to_string_map(row.get("query_params")),
        request_timeout_ms: row.get::<i32, _>("request_timeout_ms").max(1_000) as u64,
        max_retries: row.get::<i32, _>("max_retries").max(0) as u32,
    })
}

fn provider_api_key_from_row(state: &AppState, row: &sqlx::postgres::PgRow) -> ApiResult<String> {
    let ciphertext = row.get::<String, _>("api_key_ciphertext");
    if !ciphertext.trim().is_empty() {
        return state
            .managed_secret_cipher
            .decrypt_provider_api_key(&ciphertext)
            .map_err(|_| {
                ApiError::Internal("provider credential is unavailable or corrupted".to_string())
            });
    }
    Ok(row.get::<String, _>("api_key"))
}

fn json_value_to_string_map(value: Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .into_iter()
        .flat_map(|object| object.iter())
        .filter_map(|(key, value)| value.as_str().map(|value| (key.clone(), value.to_string())))
        .collect()
}

async fn ensure_device_capacity_for_fingerprint(
    pool: &PgPool,
    tenant_id: &str,
    fingerprint: &str,
    max_devices: i32,
) -> ApiResult<()> {
    let max_devices = max_devices as i64;
    let existing_status =
        sqlx::query("select status from devices where tenant_id = $1 and fingerprint = $2")
            .bind(tenant_id)
            .bind(fingerprint)
            .fetch_optional(pool)
            .await?
            .map(|row| row.get::<String, _>("status"));
    if existing_status.as_deref() == Some("revoked") {
        return Err(ApiError::Forbidden(
            "device authorization was revoked by the administrator".to_string(),
        ));
    }
    let active_devices =
        sqlx::query("select count(*) from devices where tenant_id = $1 and status = 'active'")
            .bind(tenant_id)
            .fetch_one(pool)
            .await?
            .get::<i64, _>(0);
    let fingerprint_exists = existing_status.as_deref() == Some("active");
    if !can_activate_device(active_devices, max_devices, fingerprint_exists) {
        return Err(ApiError::Forbidden(
            "tenant device limit reached".to_string(),
        ));
    }
    Ok(())
}

pub(crate) async fn require_device(
    state: &AppState,
    headers: &HeaderMap,
    tenant_id: &str,
    device_id: &str,
) -> ApiResult<DeviceTokenClaims> {
    let token = bearer_token(headers)?;
    let claims = state
        .device_tokens
        .verify(token)
        .map_err(|_| ApiError::Unauthorized("invalid or expired device token".to_string()))?;
    if claims.tenant_id != tenant_id || claims.device_id != device_id {
        return Err(ApiError::Forbidden(
            "device token does not match the requested tenant/device".to_string(),
        ));
    }
    let row = sqlx::query(
        r#"
        select user_id, fingerprint from devices
        where tenant_id = $1 and id = $2
          and status = 'active' and lease_expires_at > now()
        "#,
    )
    .bind(tenant_id)
    .bind(device_id)
    .fetch_optional(&state.db)
    .await?
    .ok_or_else(|| ApiError::Forbidden("device identity is invalid or inactive".to_string()))?;
    let user_id = row.get::<String, _>("user_id");
    let fingerprint = row.get::<String, _>("fingerprint");
    if claims.user_id != user_id || claims.fingerprint_hash != hash_device_fingerprint(&fingerprint)
    {
        return Err(ApiError::Forbidden(
            "device token no longer matches the activated device".to_string(),
        ));
    }
    Ok(claims)
}

fn issue_device_access_token(
    state: &AppState,
    tenant_id: &str,
    user_id: &str,
    device_id: &str,
    fingerprint: &str,
) -> ApiResult<String> {
    Ok(state.device_tokens.issue(DeviceTokenClaims::new(
        tenant_id.to_string(),
        user_id.to_string(),
        device_id.to_string(),
        hash_device_fingerprint(fingerprint),
        i64::from(CLIENT_DEVICE_LEASE_DAYS) * 24 * 60 * 60,
    ))?)
}

fn hash_device_fingerprint(fingerprint: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(fingerprint.as_bytes());
    hex::encode(hasher.finalize())
}

async fn first_tenant_device_id(pool: &PgPool, tenant_id: &str) -> ApiResult<String> {
    sqlx::query("select id from devices where tenant_id = $1 order by created_at, id limit 1")
        .bind(tenant_id)
        .fetch_optional(pool)
        .await?
        .map(|row| row.get::<String, _>("id"))
        .ok_or_else(|| ApiError::NotFound("tenant has no installed devices".to_string()))
}

async fn client_device_summary(
    pool: &PgPool,
    tenant_id: &str,
    current_device_id: &str,
) -> ApiResult<Value> {
    let administrator_id = first_tenant_device_id(pool, tenant_id).await?;
    let tenant = sqlx::query("select max_devices from tenants where id = $1")
        .bind(tenant_id)
        .fetch_one(pool)
        .await?;
    let rows = sqlx::query(
        r#"
        select id, name, status, lease_expires_at, last_seen_at, created_at
        from devices
        where tenant_id = $1
        order by created_at, id
        "#,
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    let active_devices = rows
        .iter()
        .filter(|row| row.get::<String, _>("status") == "active")
        .count();
    let devices = rows
        .into_iter()
        .map(|row| {
            let id = row.get::<String, _>("id");
            json!({
                "id": id,
                "name": row.get::<String, _>("name"),
                "status": row.get::<String, _>("status"),
                "isCurrent": id == current_device_id,
                "isAdministrator": id == administrator_id,
                "leaseExpiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("lease_expires_at").unwrap_or(None),
                "lastSeenAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("last_seen_at").unwrap_or(None),
                "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at")
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "activeDevices": active_devices,
        "maxDevices": tenant.get::<i32, _>("max_devices"),
        "isAdministrator": current_device_id == administrator_id,
        "devices": devices
    }))
}

pub(crate) async fn ensure_gateway_run_available(
    pool: &PgPool,
    claims: &RunTokenClaims,
) -> ApiResult<()> {
    let row = sqlx::query(
        r#"
        select r.tenant_id, r.user_id, r.device_id, r.model_id, r.status, r.budget_yuan
        from model_runs r
        join tenants t on t.id = r.tenant_id and t.status = 'active' and t.balance_yuan > 0
        join devices d on d.id = r.device_id and d.tenant_id = r.tenant_id
          and d.status = 'active' and d.lease_expires_at > now()
        where r.id = $1
          and r.status in ('created', 'running')
          and r.accumulated_billable_yuan < r.budget_yuan
        "#,
    )
    .bind(&claims.run_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| {
        ApiError::Unauthorized(
            "run token is invalid, expired, revoked, or has exhausted its task budget".to_string(),
        )
    })?;
    validate_run_claim_bindings(&row, claims)
}

#[cfg(test)]
async fn start_gateway_request(
    pool: &PgPool,
    claims: &RunTokenClaims,
    gateway_request_id: &str,
    wait_timeout: Duration,
) -> ApiResult<Decimal> {
    gateway_admission::reserve_request(
        pool,
        claims,
        gateway_request_id,
        &RequestLane::Main,
        None,
        None,
        wait_timeout,
    )
    .await
}

async fn release_gateway_request(
    pool: &PgPool,
    claims: &RunTokenClaims,
    gateway_request_id: &str,
    upstream_status: Option<u16>,
) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    let row = sqlx::query("select tenant_id, user_id, device_id, model_id, budget_yuan, active_request_id from model_runs where id=$1 for update")
        .bind(&claims.run_id).fetch_one(&mut *tx).await?;
    validate_run_claim_bindings(&row, claims)?;
    let removed = sqlx::query("delete from gateway_request_leases where id=$1 and run_id=$2")
        .bind(gateway_request_id)
        .bind(&claims.run_id)
        .execute(&mut *tx)
        .await?;
    if removed.rows_affected() == 0
        && row.get::<Option<String>, _>("active_request_id").as_deref() != Some(gateway_request_id)
    {
        return Err(ApiError::Unauthorized(
            "run token does not own the active model request".into(),
        ));
    }
    sqlx::query("update model_runs set active_request_id=(select id from gateway_request_leases where run_id=$1 order by created_at,id limit 1), last_activity_at=now(), upstream_status=coalesce($2,upstream_status) where id=$1")
        .bind(&claims.run_id).bind(upstream_status.map(i32::from)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) fn validate_run_claim_bindings(
    row: &sqlx::postgres::PgRow,
    claims: &RunTokenClaims,
) -> ApiResult<()> {
    let matches = row.get::<String, _>("tenant_id") == claims.tenant_id
        && row.get::<String, _>("user_id") == claims.user_id
        && row.get::<String, _>("device_id") == claims.device_id
        && row.get::<String, _>("model_id") == claims.model_id
        && row.get::<Decimal, _>("budget_yuan") == claims.budget_yuan;
    if matches {
        Ok(())
    } else {
        Err(ApiError::Unauthorized(
            "run token claims do not match the persisted run".to_string(),
        ))
    }
}

fn enforce_request_budget(
    body: &mut Value,
    budget_yuan: Decimal,
    route: &ModelRoute,
    pricing: &Pricing,
) -> ApiResult<()> {
    validate_run_budget(budget_yuan)?;
    if !pricing.is_valid() {
        return Err(ApiError::BadRequest(
            "model pricing is unsafe or incomplete".to_string(),
        ));
    }
    let requested_max = match body.get("max_output_tokens") {
        Some(value) => value.as_u64().filter(|value| *value > 0).ok_or_else(|| {
            ApiError::BadRequest("max_output_tokens must be a positive integer".to_string())
        })?,
        None => route
            .max_output_tokens
            .min(default_model_max_output_tokens() as u64),
    };
    let estimated_input_tokens = estimate_request_input_tokens(body, route.context_window_tokens)?;
    let charge_for =
        |output_tokens| request_safety_charge_yuan(estimated_input_tokens, output_tokens, pricing);
    if charge_for(0) > budget_yuan {
        return Err(ApiError::Forbidden(
            "per-run safety limit is too small for the request input".to_string(),
        ));
    }
    let mut low = 0_u64;
    let mut high = route.max_output_tokens;
    while low < high {
        let middle = low + (high - low).div_ceil(2);
        if charge_for(middle) <= budget_yuan {
            low = middle;
        } else {
            high = middle - 1;
        }
    }
    if low == 0 {
        return Err(ApiError::Forbidden(
            "per-run safety limit cannot fund even one output token".to_string(),
        ));
    }
    let safe_max = requested_max.min(low);
    body.as_object_mut()
        .ok_or_else(|| ApiError::BadRequest("request body must be a JSON object".to_string()))?
        .insert("max_output_tokens".to_string(), json!(safe_max));
    Ok(())
}

fn estimate_request_input_tokens(body: &Value, context_window_tokens: u64) -> ApiResult<u64> {
    let serialized = serde_json::to_string(body)
        .map_err(|_| ApiError::BadRequest("request body cannot be metered".to_string()))?;
    let mut ascii = 0_u64;
    let mut non_ascii = 0_u64;
    let mut whitespace = 0_u64;
    for character in serialized.chars() {
        if character.is_whitespace() {
            whitespace = whitespace.saturating_add(1);
        } else if character.is_ascii() {
            ascii = ascii.saturating_add(1);
        } else {
            non_ascii = non_ascii.saturating_add(1);
        }
    }
    // This is deliberately conservative across tokenizer families, without
    // confusing UTF-8 byte length with token count. Clamp to the route's
    // verified input capacity so a valid full-window request can always be
    // funded by the server-calculated safety budget.
    let estimate = ascii
        .div_ceil(3)
        .saturating_add(non_ascii.saturating_mul(3).div_ceil(2))
        .saturating_add(whitespace.div_ceil(8))
        .saturating_add(1_024);
    Ok(estimate.min(context_window_tokens))
}

fn request_safety_charge_yuan(input_tokens: u64, output_tokens: u64, pricing: &Pricing) -> Decimal {
    let output_price = pricing
        .output_yuan_per_million
        .max(pricing.reasoning_yuan_per_million);
    let safety_pricing = Pricing {
        input_yuan_per_million: pricing.input_yuan_per_million,
        output_yuan_per_million: output_price,
        reasoning_yuan_per_million: Decimal::ZERO,
        // Cached input is a subset of total input, never a second copy of it.
        cached_input_yuan_per_million: Decimal::ZERO,
        markup_bps: pricing.markup_bps,
    };
    settle_usage_yuan(
        &GatewayUsage {
            input_tokens,
            output_tokens,
            reasoning_tokens: 0,
            cached_tokens: 0,
        },
        &safety_pricing,
    )
    .billable_yuan
}

fn recommended_run_budget_yuan(route: &ModelRoute, pricing: &Pricing) -> Decimal {
    let full_window_request = request_safety_charge_yuan(
        route.context_window_tokens,
        route.max_output_tokens,
        pricing,
    );
    (full_window_request * Decimal::from(GATEWAY_TASK_FULL_WINDOW_REQUEST_CAP))
        .min(Decimal::from(MAX_GATEWAY_TASK_BUDGET_YUAN))
        .max(default_budget_yuan())
}

fn validate_run_budget(budget_yuan: Decimal) -> ApiResult<()> {
    if !has_supported_scale(budget_yuan)
        || budget_yuan < Decimal::new(1, 2)
        || budget_yuan > Decimal::from(10_000_u64)
    {
        return Err(ApiError::BadRequest(
            "budgetYuan must be between 0.01 and 10000 with at most 6 decimals".to_string(),
        ));
    }
    Ok(())
}

async fn create_unreserved_run(
    pool: &PgPool,
    run_id: &str,
    request: &RunCreateRequest,
) -> ApiResult<()> {
    let created = sqlx::query(
        r#"
        insert into model_runs (id, tenant_id, user_id, device_id, model_id, mode, status, budget_yuan)
        select $1, $2, $3, $4, $5, 'gateway_api', 'created', $6
        from tenants
        where id = $2 and status = 'active' and balance_yuan > 0
        returning id
        "#,
    )
    .bind(run_id)
    .bind(&request.tenant_id)
    .bind(&request.user_id)
    .bind(&request.device_id)
    .bind(&request.model_id)
    .bind(request.budget_yuan)
    .fetch_optional(pool)
    .await?;
    created.map(|_| ()).ok_or_else(|| {
        ApiError::Forbidden(
            "account balance must be greater than zero to start a model run".to_string(),
        )
    })
}

async fn release_expired_run_reservations(pool: &PgPool, tenant_id: &str) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    let tenant_exists = sqlx::query("select 1 from tenants where id = $1 for update")
        .bind(tenant_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some();
    if !tenant_exists {
        return Err(ApiError::Forbidden("tenant is not active".to_string()));
    }
    let expired = sqlx::query(
        r#"
        select r.id, r.model_id, r.budget_yuan
        from model_runs r
        where r.tenant_id = $1 and r.status in ('created', 'running')
          and r.active_request_id is null
          and r.created_at <= now() - ($2::double precision * interval '1 second')
        for update
        "#,
    )
    .bind(tenant_id)
    .bind(GATEWAY_RUN_TTL_SECONDS)
    .fetch_all(&mut *tx)
    .await?;
    for row in expired {
        let run_id = row.get::<String, _>("id");
        let budget_yuan = row.get::<Decimal, _>("budget_yuan");
        let had_reservation = sqlx::query("select 1 from billing_ledger where operation_key = $1")
            .bind(format!("reservation:{run_id}"))
            .fetch_optional(&mut *tx)
            .await?
            .is_some();
        sqlx::query(
            "update model_runs set status = 'expired', completed_at = now() where id = $1 and status in ('created', 'running') and active_request_id is null",
        )
        .bind(&run_id)
        .execute(&mut *tx)
        .await?;
        if had_reservation {
            sqlx::query(
                "update tenants set balance_yuan = balance_yuan + $2, updated_at = now() where id = $1",
            )
            .bind(tenant_id)
            .bind(budget_yuan)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                r#"
                insert into billing_ledger
                  (id, tenant_id, run_id, entry_type, amount_yuan, description, operation_key)
                values ($1, $2, $3, 'reservation_release', $4, $5, $6)
                on conflict (operation_key) where operation_key is not null do nothing
                "#,
            )
            .bind(format!("ledger_{}", Uuid::new_v4().simple()))
            .bind(tenant_id)
            .bind(&run_id)
            .bind(budget_yuan)
            .bind(format!(
                "{} unused run budget released after token expiry",
                row.get::<String, _>("model_id")
            ))
            .bind(format!("release:{run_id}"))
            .execute(&mut *tx)
            .await?;
        }
    }
    tx.commit().await?;
    Ok(())
}

#[derive(Clone, Copy)]
enum MeteringStatus<'a> {
    Reported,
    UsageUnavailable(&'a str),
}

impl<'a> MeteringStatus<'a> {
    fn from_usage(usage: &GatewayUsage, fallback_reason: &'a str) -> Self {
        if usage.is_empty() {
            Self::UsageUnavailable(fallback_reason)
        } else {
            Self::Reported
        }
    }
}

fn resolve_usage_charge<'a>(
    pricing: &Pricing,
    usage: &GatewayUsage,
    metering_status: MeteringStatus<'a>,
) -> (Decimal, Decimal, &'static str, &'a str) {
    let measured_charge = settle_usage_yuan(usage, pricing);
    match metering_status {
        MeteringStatus::Reported => (
            measured_charge.cost_yuan,
            measured_charge.billable_yuan,
            "reported",
            "",
        ),
        MeteringStatus::UsageUnavailable(reason) => (
            measured_charge.cost_yuan,
            measured_charge.billable_yuan,
            "usage_unavailable",
            reason,
        ),
    }
}

// Settlement receives the complete measured usage and its request context.
#[allow(clippy::too_many_arguments)]
async fn settle_and_record_usage(
    pool: &PgPool,
    claims: &RunTokenClaims,
    gateway_request_id: &str,
    pricing: &Pricing,
    usage: &GatewayUsage,
    upstream_status: u16,
    started: chrono::DateTime<Utc>,
    metering_status: MeteringStatus<'_>,
) -> ApiResult<()> {
    let (cost_yuan, billable_yuan, metering_label, billing_note) =
        resolve_usage_charge(pricing, usage, metering_status);
    let latency_ms = (Utc::now() - started).num_milliseconds().max(0);
    let input_tokens = i64::try_from(usage.input_tokens)
        .map_err(|_| ApiError::BadRequest("input token count is too large".to_string()))?;
    let output_tokens = i64::try_from(usage.output_tokens)
        .map_err(|_| ApiError::BadRequest("output token count is too large".to_string()))?;
    let reasoning_tokens = i64::try_from(usage.reasoning_tokens)
        .map_err(|_| ApiError::BadRequest("reasoning token count is too large".to_string()))?;
    let cached_tokens = i64::try_from(usage.cached_tokens)
        .map_err(|_| ApiError::BadRequest("cached token count is too large".to_string()))?;
    let mut tx = pool.begin().await?;
    let run = sqlx::query(
        r#"
        select tenant_id, user_id, device_id, model_id, status, budget_yuan,
          active_request_id, accumulated_billable_yuan
        from model_runs where id = $1 for update
        "#,
    )
    .bind(&claims.run_id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or_else(|| {
        ApiError::Unauthorized("run token does not reference a valid run".to_string())
    })?;
    validate_run_claim_bindings(&run, claims)?;
    if run.get::<String, _>("status") != "running" {
        return Err(ApiError::Forbidden(
            "run is not in a billable state".to_string(),
        ));
    }
    let owns_lease: bool = sqlx::query_scalar(
        "select exists(select 1 from gateway_request_leases where id=$1 and run_id=$2)",
    )
    .bind(gateway_request_id)
    .bind(&claims.run_id)
    .fetch_one(&mut *tx)
    .await?;
    if !owns_lease
        && run.get::<Option<String>, _>("active_request_id").as_deref() != Some(gateway_request_id)
    {
        return Err(ApiError::Forbidden(
            "model request lease does not match this settlement".into(),
        ));
    }
    let settlement_key = format!("settlement:{}:{}", claims.run_id, gateway_request_id);
    sqlx::query(
        r#"
        insert into usage_events (
            id, tenant_id, run_id, model_id, input_tokens, output_tokens,
            reasoning_tokens, cached_tokens, cost_yuan, billable_yuan,
            upstream_status, latency_ms, settlement_key, metering_status, billing_note
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        "#,
    )
    .bind(format!("usage_{}", Uuid::new_v4().simple()))
    .bind(&claims.tenant_id)
    .bind(&claims.run_id)
    .bind(&claims.model_id)
    .bind(input_tokens)
    .bind(output_tokens)
    .bind(reasoning_tokens)
    .bind(cached_tokens)
    .bind(cost_yuan)
    .bind(billable_yuan)
    .bind(upstream_status as i32)
    .bind(latency_ms)
    .bind(&settlement_key)
    .bind(metering_label)
    .bind(billing_note)
    .execute(&mut *tx)
    .await?;
    let had_reservation = sqlx::query(
        r#"
        select 1 from billing_ledger
        where operation_key = $1
          and not exists (
            select 1 from billing_ledger
            where operation_key in ($2, $3)
          )
        "#,
    )
    .bind(format!("reservation:{}", claims.run_id))
    .bind(format!("adjustment:{}", claims.run_id))
    .bind(format!("release:{}", claims.run_id))
    .fetch_optional(&mut *tx)
    .await?
    .is_some();
    if had_reservation {
        let balance_adjustment = claims.budget_yuan - billable_yuan;
        if balance_adjustment != Decimal::ZERO {
            sqlx::query(
                "update tenants set balance_yuan = balance_yuan + $2, updated_at = now() where id = $1",
            )
            .bind(&claims.tenant_id)
            .bind(balance_adjustment)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                r#"
                insert into billing_ledger
                  (id, tenant_id, run_id, entry_type, amount_yuan, description, operation_key)
                values ($1, $2, $3, $4, $5, $6, $7)
                "#,
            )
            .bind(format!("ledger_{}", Uuid::new_v4().simple()))
            .bind(&claims.tenant_id)
            .bind(&claims.run_id)
            .bind(if balance_adjustment > Decimal::ZERO {
                "usage_settlement_credit"
            } else {
                "usage_overage"
            })
            .bind(balance_adjustment)
            .bind(format!(
                "{} legacy run budget settlement adjustment",
                claims.model_id
            ))
            .bind(format!("adjustment:{}", claims.run_id))
            .execute(&mut *tx)
            .await?;
        }
    } else {
        sqlx::query(
            "update tenants set balance_yuan = balance_yuan - $2, updated_at = now() where id = $1",
        )
        .bind(&claims.tenant_id)
        .bind(billable_yuan)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            r#"
            insert into billing_ledger
              (id, tenant_id, run_id, entry_type, amount_yuan, description, operation_key)
            values ($1, $2, $3, 'usage_charge', $4, $5, $6)
            "#,
        )
        .bind(format!("ledger_{}", Uuid::new_v4().simple()))
        .bind(&claims.tenant_id)
        .bind(&claims.run_id)
        .bind(-billable_yuan)
        .bind(format!("{} 请求实际用量扣费", claims.model_id))
        .bind(format!("charge:{}:{}", claims.run_id, gateway_request_id))
        .execute(&mut *tx)
        .await?;
    }
    let accumulated_billable_yuan =
        run.get::<Decimal, _>("accumulated_billable_yuan") + billable_yuan;
    sqlx::query("delete from gateway_request_leases where id=$1 and run_id=$2")
        .bind(gateway_request_id)
        .bind(&claims.run_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query(
        r#"
        update model_runs
        set accumulated_billable_yuan = $2,
            active_request_id = (select id from gateway_request_leases where run_id=$1 order by created_at,id limit 1),
            last_activity_at = now(),
            upstream_status = $3
        where id = $1
        "#,
    )
    .bind(&claims.run_id)
    .bind(accumulated_billable_yuan)
    .bind(upstream_status as i32)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

pub(crate) async fn write_audit(
    pool: &PgPool,
    tenant_id: &str,
    action: &str,
    payload: Value,
) -> ApiResult<()> {
    sqlx::query(
        "insert into audit_logs (id, tenant_id, actor, action, payload) values ($1, $2, 'system', $3, $4)",
    )
    .bind(format!("audit_{}", Uuid::new_v4().simple()))
    .bind(tenant_id)
    .bind(action)
    .bind(payload)
    .execute(pool)
    .await?;
    Ok(())
}

fn tenant_json(row: sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "name": row.get::<String, _>("name"),
        "status": row.get::<String, _>("status"),
        "maxDevices": row.get::<i32, _>("max_devices"),
        "billingMode": row.get::<String, _>("billing_mode"),
        "balanceYuan": decimal_json(row.get::<Decimal, _>("balance_yuan")),
        "subscriptionPlan": row.try_get::<Option<String>, _>("subscription_plan").unwrap_or(None),
        "subscriptionExpiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("subscription_expires_at").unwrap_or(None),
        "codexSubscriptionEnabled": row.get::<bool, _>("codex_subscription_enabled"),
        "codexSubscriptionPlan": row.try_get::<Option<String>, _>("codex_subscription_plan").unwrap_or(None),
        "codexSubscriptionExpiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at").unwrap_or(None),
        "activeDevices": row.get::<i64, _>("active_devices"),
        "billableYuan": decimal_json(row.get::<Decimal, _>("billable_yuan")),
        "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at")
    })
}

fn model_route_json(row: sqlx::postgres::PgRow) -> Value {
    json!({
        "id": row.get::<String, _>("id"),
        "modelId": row.get::<String, _>("model_id"),
        "label": row.get::<String, _>("label"),
        "provider": row.get::<String, _>("provider"),
        "mode": row.get::<String, _>("mode"),
        "baseUrl": row.get::<String, _>("base_url"),
        "endpointPath": row.get::<String, _>("endpoint_path"),
        "upstreamModel": row.get::<String, _>("upstream_model"),
        "contextWindowTokens": row.get::<i32, _>("context_window_tokens"),
        "maxOutputTokens": row.get::<i32, _>("max_output_tokens"),
        "supportedReasoningEfforts": row.get::<Vec<String>, _>("supported_reasoning_efforts"),
        "defaultReasoningEffort": row.get::<String, _>("default_reasoning_effort"),
        "fastModeSupported": row.get::<bool, _>("fast_mode_supported"),
        "enabled": row.get::<bool, _>("enabled"),
        "sortOrder": row.get::<i32, _>("sort_order"),
        "inputYuanPerMillion": decimal_json(row.get::<Decimal, _>("input_yuan_per_million")),
        "outputYuanPerMillion": decimal_json(row.get::<Decimal, _>("output_yuan_per_million")),
        "reasoningYuanPerMillion": decimal_json(row.get::<Decimal, _>("reasoning_yuan_per_million")),
        "cachedInputYuanPerMillion": decimal_json(row.get::<Decimal, _>("cached_input_yuan_per_million")),
        "markupBps": row.get::<i64, _>("markup_bps"),
        "providerReady": row.get::<bool, _>("provider_ready"),
        "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at"),
        "updatedAt": row.get::<chrono::DateTime<Utc>, _>("updated_at")
    })
}

fn codex_account_json(row: sqlx::postgres::PgRow) -> Value {
    let login_secret_configured = !row
        .get::<String, _>("login_secret_ciphertext")
        .trim()
        .is_empty()
        || !row.get::<String, _>("login_secret").trim().is_empty();
    let tenant_ids = row
        .try_get::<Vec<String>, _>("tenant_ids")
        .unwrap_or_default();
    let tenant_names = row
        .try_get::<Vec<String>, _>("tenant_names")
        .unwrap_or_default();
    json!({
        "id": row.get::<String, _>("id"),
        "tenantId": row.try_get::<Option<String>, _>("tenant_id").unwrap_or(None),
        "tenantName": row.try_get::<Option<String>, _>("tenant_name").unwrap_or(None),
        "tenantIds": tenant_ids,
        "tenantNames": tenant_names,
        "email": row.get::<String, _>("email"),
        "loginSecretConfigured": login_secret_configured,
        "loginSecretMask": if login_secret_configured { Value::String("••••••••".to_string()) } else { Value::Null },
        "loginHint": row.get::<String, _>("login_hint"),
        "plan": row.get::<String, _>("plan"),
        "status": row.get::<String, _>("status"),
        "seatLimit": row.get::<i32, _>("seat_limit"),
        "expiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("expires_at").unwrap_or(None),
        "assignedAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("assigned_at").unwrap_or(None),
        "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at"),
        "updatedAt": row.get::<chrono::DateTime<Utc>, _>("updated_at")
    })
}

async fn upsert_client_user(
    pool: &PgPool,
    tenant_id: &str,
    email: &str,
    name: &str,
) -> ApiResult<String> {
    let user_id = format!("user_{}", Uuid::new_v4().simple());
    let row = sqlx::query(
        r#"
        insert into users (id, tenant_id, email, name, role, status)
        values ($1, $2, $3, $4, 'member', 'active')
        on conflict (tenant_id, email) do update set
          name = excluded.name,
          status = 'active'
        returning id
        "#,
    )
    .bind(user_id)
    .bind(tenant_id)
    .bind(email.trim())
    .bind(name.trim())
    .fetch_one(pool)
    .await?;
    Ok(row.get("id"))
}

async fn upsert_device(
    pool: &PgPool,
    tenant_id: &str,
    user_id: &str,
    fingerprint: &str,
    name: &str,
) -> ApiResult<(String, chrono::DateTime<Utc>)> {
    let id = format!("dev_{}", Uuid::new_v4().simple());
    let row = sqlx::query(
        r#"
        insert into devices (id, tenant_id, user_id, fingerprint, name, status, lease_expires_at, last_seen_at)
        values ($1, $2, $3, $4, $5, 'active', now() + make_interval(days => $6), now())
        on conflict (tenant_id, fingerprint)
        do update set name = excluded.name, user_id = excluded.user_id, status = 'active',
            lease_expires_at = now() + make_interval(days => $6), last_seen_at = now()
        returning id, lease_expires_at
        "#,
    )
    .bind(id)
    .bind(tenant_id)
    .bind(user_id)
    .bind(fingerprint)
    .bind(name)
    .bind(CLIENT_DEVICE_LEASE_DAYS)
    .fetch_one(pool)
    .await?;
    Ok((
        row.get::<String, _>("id"),
        row.get::<chrono::DateTime<Utc>, _>("lease_expires_at"),
    ))
}

async fn record_client_agreement_acceptance(
    pool: &PgPool,
    tenant_id: &str,
    user_id: &str,
    device_id: &str,
    acceptance: &ClientAgreementAcceptance,
) -> ApiResult<()> {
    sqlx::query(
        r#"
        insert into client_agreement_acceptances (
          id, tenant_id, user_id, device_id, service_terms_version,
          privacy_policy_version, third_party_model_notice_version,
          research_risk_disclosure_version
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(format!("consent_{}", Uuid::new_v4().simple()))
    .bind(tenant_id)
    .bind(user_id)
    .bind(device_id)
    .bind(acceptance.service_terms_version.trim())
    .bind(acceptance.privacy_policy_version.trim())
    .bind(acceptance.third_party_model_notice_version.trim())
    .bind(acceptance.research_risk_disclosure_version.trim())
    .execute(pool)
    .await?;
    Ok(())
}

async fn load_codex_accounts_for_client(pool: &PgPool, tenant_id: &str) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"
        select id, email, login_hint, plan, seat_limit, expires_at
        from codex_accounts a
        join codex_account_tenants cat on cat.account_id = a.id
        where cat.tenant_id = $1
          and a.status = 'active'
          and (a.expires_at is null or a.expires_at > now())
        order by a.created_at
        "#,
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "email": row.get::<String, _>("email"),
                "loginHint": row.get::<String, _>("login_hint"),
                "plan": row.get::<String, _>("plan"),
                "seatLimit": row.get::<i32, _>("seat_limit"),
                "expiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("expires_at").unwrap_or(None)
            })
        })
        .collect())
}

async fn usage_totals_between(
    pool: &PgPool,
    tenant_id: &str,
    start: chrono::DateTime<Utc>,
    end: chrono::DateTime<Utc>,
) -> ApiResult<Value> {
    let row = sqlx::query(
        r#"
        select
          count(*)::bigint as run_count,
          coalesce(sum(input_tokens), 0)::bigint as input_tokens,
          coalesce(sum(output_tokens), 0)::bigint as output_tokens,
          coalesce(sum(reasoning_tokens), 0)::bigint as reasoning_tokens,
          coalesce(sum(cached_tokens), 0)::bigint as cached_tokens,
          coalesce(sum(input_tokens + output_tokens + reasoning_tokens + cached_tokens), 0)::bigint as total_tokens,
          coalesce(sum(cost_yuan), 0::numeric) as cost_yuan,
          coalesce(sum(billable_yuan), 0::numeric) as billable_yuan,
          max(created_at) as last_used_at
        from usage_events
        where tenant_id = $1 and created_at >= $2 and created_at < $3
        "#,
    )
    .bind(tenant_id)
    .bind(start)
    .bind(end)
    .fetch_one(pool)
    .await?;
    Ok(usage_totals_json(&row))
}

async fn usage_totals_all(pool: &PgPool, tenant_id: &str) -> ApiResult<Value> {
    let row = sqlx::query(
        r#"
        select
          count(*)::bigint as run_count,
          coalesce(sum(input_tokens), 0)::bigint as input_tokens,
          coalesce(sum(output_tokens), 0)::bigint as output_tokens,
          coalesce(sum(reasoning_tokens), 0)::bigint as reasoning_tokens,
          coalesce(sum(cached_tokens), 0)::bigint as cached_tokens,
          coalesce(sum(input_tokens + output_tokens + reasoning_tokens + cached_tokens), 0)::bigint as total_tokens,
          coalesce(sum(cost_yuan), 0::numeric) as cost_yuan,
          coalesce(sum(billable_yuan), 0::numeric) as billable_yuan,
          max(created_at) as last_used_at
        from usage_events
        where tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_one(pool)
    .await?;
    Ok(usage_totals_json(&row))
}

async fn model_usage_between(
    pool: &PgPool,
    tenant_id: &str,
    start: chrono::DateTime<Utc>,
    end: chrono::DateTime<Utc>,
) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"
        select
          u.model_id,
          coalesce(m.label, u.model_id) as label,
          coalesce(m.provider, '') as provider,
          count(*)::bigint as run_count,
          coalesce(sum(u.input_tokens), 0)::bigint as input_tokens,
          coalesce(sum(u.output_tokens), 0)::bigint as output_tokens,
          coalesce(sum(u.reasoning_tokens), 0)::bigint as reasoning_tokens,
          coalesce(sum(u.cached_tokens), 0)::bigint as cached_tokens,
          coalesce(sum(u.input_tokens + u.output_tokens + u.reasoning_tokens + u.cached_tokens), 0)::bigint as total_tokens,
          coalesce(sum(u.cost_yuan), 0::numeric) as cost_yuan,
          coalesce(sum(u.billable_yuan), 0::numeric) as billable_yuan,
          max(u.created_at) as last_used_at
        from usage_events u
        left join model_routes m on m.model_id = u.model_id
        where u.tenant_id = $1 and u.created_at >= $2 and u.created_at < $3
        group by u.model_id, coalesce(m.label, u.model_id), coalesce(m.provider, '')
        order by coalesce(sum(u.billable_yuan), 0) desc, max(u.created_at) desc
        limit 8
        "#,
    )
    .bind(tenant_id)
    .bind(start)
    .bind(end)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let mut value = usage_totals_json(&row);
            if let Value::Object(ref mut object) = value {
                object.insert(
                    "modelId".to_string(),
                    json!(row.get::<String, _>("model_id")),
                );
                object.insert("label".to_string(), json!(row.get::<String, _>("label")));
                object.insert(
                    "provider".to_string(),
                    json!(row.get::<String, _>("provider")),
                );
            }
            value
        })
        .collect())
}

fn remove_model_provider_fields(models: &mut [Value]) {
    for model in models {
        if let Value::Object(object) = model {
            object.remove("provider");
        }
    }
}

struct BillingLedgerPage {
    entries: Vec<Value>,
    page: i64,
    page_size: i64,
    total: i64,
    total_pages: i64,
}

impl BillingLedgerPage {
    fn pagination_json(&self) -> Value {
        json!({
            "page": self.page,
            "pageSize": self.page_size,
            "total": self.total,
            "totalPages": self.total_pages,
            "hasPrevious": self.page > 1,
            "hasNext": self.total_pages > 0 && self.page < self.total_pages
        })
    }
}

async fn billing_ledger_page(
    pool: &PgPool,
    tenant_id: &str,
    requested_page: i64,
    page_size: i64,
    period_start: Option<chrono::DateTime<Utc>>,
    period_end: Option<chrono::DateTime<Utc>>,
) -> ApiResult<BillingLedgerPage> {
    let total = sqlx::query_scalar::<_, i64>(
        r#"
        select count(*)::bigint
        from (
          select 1
          from billing_ledger
          where tenant_id = $1
            and ($2::timestamptz is null or created_at >= $2)
            and ($3::timestamptz is null or created_at < $3)
          group by run_id, case when run_id is null then id else null end
        ) grouped_ledger
        "#,
    )
    .bind(tenant_id)
    .bind(period_start)
    .bind(period_end)
    .fetch_one(pool)
    .await?;
    let total_pages = if total == 0 {
        0
    } else {
        (total + page_size - 1) / page_size
    };
    let page = requested_page.min(total_pages.max(1));
    let offset = (page - 1) * page_size;
    let rows = sqlx::query(
        r#"
        select
          case
            when run_id is not null then 'run:' || run_id
            else (array_agg(id order by created_at desc, id desc))[1]
          end as id,
          run_id,
          case
            when count(distinct entry_type) = 1 then min(entry_type)
            else 'run_summary'
          end as entry_type,
          sum(amount_yuan) as amount_yuan,
          (array_agg(description order by created_at desc, id desc))[1] as description,
          max(created_at) as created_at,
          count(*)::bigint as entry_count
        from billing_ledger
        where tenant_id = $1
          and ($4::timestamptz is null or created_at >= $4)
          and ($5::timestamptz is null or created_at < $5)
        group by run_id, case when run_id is null then id else null end
        order by created_at desc, id desc
        limit $2 offset $3
        "#,
    )
    .bind(tenant_id)
    .bind(page_size)
    .bind(offset)
    .bind(period_start)
    .bind(period_end)
    .fetch_all(pool)
    .await?;
    let entries = rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "runId": row.try_get::<Option<String>, _>("run_id").unwrap_or(None),
                "entryType": row.get::<String, _>("entry_type"),
                "amountYuan": decimal_json(row.get::<Decimal, _>("amount_yuan")),
                "description": row.get::<String, _>("description"),
                "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at"),
                "entryCount": row.get::<i64, _>("entry_count")
            })
        })
        .collect();
    Ok(BillingLedgerPage {
        entries,
        page,
        page_size,
        total,
        total_pages,
    })
}

async fn offline_payment_records(pool: &PgPool, tenant_id: &str) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"
        select id, record_type, amount_yuan, reference, note, received_at,
          reverses_record_id, recorded_by, created_at
        from offline_payment_records
        where tenant_id = $1
        order by received_at desc, created_at desc
        limit 100
        "#,
    )
    .bind(tenant_id)
    .fetch_all(pool)
    .await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            json!({
                "id": row.get::<String, _>("id"),
                "recordType": row.get::<String, _>("record_type"),
                "amountYuan": decimal_json(row.get::<Decimal, _>("amount_yuan")),
                "reference": row.get::<String, _>("reference"),
                "note": row.get::<String, _>("note"),
                "receivedAt": row.get::<chrono::DateTime<Utc>, _>("received_at"),
                "reversesRecordId": row.try_get::<Option<String>, _>("reverses_record_id").unwrap_or(None),
                "recordedBy": row.get::<String, _>("recorded_by"),
                "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at")
            })
        })
        .collect())
}

fn validate_offline_payment_request(
    tenant_id: &str,
    request: &OfflinePaymentRequest,
) -> ApiResult<()> {
    if tenant_id.is_empty() {
        return Err(ApiError::BadRequest("tenant id is required".to_string()));
    }
    if request.amount_yuan <= Decimal::ZERO
        || !has_supported_scale(request.amount_yuan)
        || request.amount_yuan > Decimal::from(100_000_000_u64)
    {
        return Err(ApiError::BadRequest(
            "amountYuan must be positive, no more than 100000000, and use at most 6 decimals"
                .to_string(),
        ));
    }
    if request.reference.trim().is_empty() || request.reference.trim().len() > 160 {
        return Err(ApiError::BadRequest(
            "reference is required and must not exceed 160 characters".to_string(),
        ));
    }
    if request.note.trim().len() > 500 {
        return Err(ApiError::BadRequest(
            "note must not exceed 500 characters".to_string(),
        ));
    }
    if request.operation_key.trim().is_empty() || request.operation_key.trim().len() > 100 {
        return Err(ApiError::BadRequest(
            "operationKey is required and must not exceed 100 characters".to_string(),
        ));
    }
    Ok(())
}

fn bounded_pagination(
    page: Option<i64>,
    page_size: Option<i64>,
    default_page_size: i64,
) -> (i64, i64) {
    (
        page.unwrap_or(1).clamp(1, i64::MAX),
        page_size.unwrap_or(default_page_size).clamp(1, 100),
    )
}

fn current_billing_period(
    now: chrono::DateTime<Utc>,
) -> (chrono::DateTime<Utc>, chrono::DateTime<Utc>) {
    let current_month_start = Utc
        .with_ymd_and_hms(now.year(), now.month(), 1, 0, 0, 0)
        .single()
        .unwrap_or(now);
    let next_month_start = if now.month() == 12 {
        Utc.with_ymd_and_hms(now.year() + 1, 1, 1, 0, 0, 0)
            .single()
            .unwrap_or(now)
    } else {
        Utc.with_ymd_and_hms(now.year(), now.month() + 1, 1, 0, 0, 0)
            .single()
            .unwrap_or(now)
    };
    (current_month_start, next_month_start)
}

struct BillingPeriod {
    kind: &'static str,
    value: String,
    start: chrono::DateTime<Utc>,
    end: chrono::DateTime<Utc>,
}

fn resolve_billing_period(
    now: chrono::DateTime<Utc>,
    requested_kind: Option<&str>,
    requested_value: Option<&str>,
) -> ApiResult<BillingPeriod> {
    let kind = requested_kind.unwrap_or("month").trim();
    match kind {
        "month" => {
            let fallback = format!("{:04}-{:02}", now.year(), now.month());
            let value = requested_value.unwrap_or(&fallback).trim();
            let mut parts = value.split('-');
            let year = parts.next().and_then(|part| part.parse::<i32>().ok());
            let month = parts.next().and_then(|part| part.parse::<u32>().ok());
            if parts.next().is_some()
                || year.is_none()
                || month.is_none()
                || value.len() != 7
                || value.as_bytes().get(4) != Some(&b'-')
            {
                return Err(ApiError::BadRequest(
                    "periodValue must use YYYY-MM for a monthly period".to_string(),
                ));
            }
            let year = year.unwrap_or_default();
            let month = month.unwrap_or_default();
            if !(1..=9998).contains(&year) || !(1..=12).contains(&month) {
                return Err(ApiError::BadRequest(
                    "monthly billing period is out of range".to_string(),
                ));
            }
            let start = Utc
                .with_ymd_and_hms(year, month, 1, 0, 0, 0)
                .single()
                .ok_or_else(|| {
                    ApiError::BadRequest("invalid monthly billing period".to_string())
                })?;
            let (next_year, next_month) = if month == 12 {
                (year + 1, 1)
            } else {
                (year, month + 1)
            };
            let end = Utc
                .with_ymd_and_hms(next_year, next_month, 1, 0, 0, 0)
                .single()
                .ok_or_else(|| {
                    ApiError::BadRequest("invalid monthly billing period".to_string())
                })?;
            Ok(BillingPeriod {
                kind: "month",
                value: value.to_string(),
                start,
                end,
            })
        }
        "year" => {
            let fallback = format!("{:04}", now.year());
            let value = requested_value.unwrap_or(&fallback).trim();
            let year = value.parse::<i32>().ok();
            if value.len() != 4 || year.is_none() {
                return Err(ApiError::BadRequest(
                    "periodValue must use YYYY for a yearly period".to_string(),
                ));
            }
            let year = year.unwrap_or_default();
            if !(1..=9998).contains(&year) {
                return Err(ApiError::BadRequest(
                    "yearly billing period is out of range".to_string(),
                ));
            }
            let start = Utc
                .with_ymd_and_hms(year, 1, 1, 0, 0, 0)
                .single()
                .ok_or_else(|| ApiError::BadRequest("invalid yearly billing period".to_string()))?;
            let end = Utc
                .with_ymd_and_hms(year + 1, 1, 1, 0, 0, 0)
                .single()
                .ok_or_else(|| ApiError::BadRequest("invalid yearly billing period".to_string()))?;
            Ok(BillingPeriod {
                kind: "year",
                value: value.to_string(),
                start,
                end,
            })
        }
        _ => Err(ApiError::BadRequest(
            "periodKind must be month or year".to_string(),
        )),
    }
}

fn usage_totals_json(row: &sqlx::postgres::PgRow) -> Value {
    json!({
        "runCount": row.get::<i64, _>("run_count"),
        "inputTokens": row.get::<i64, _>("input_tokens"),
        "outputTokens": row.get::<i64, _>("output_tokens"),
        "reasoningTokens": row.get::<i64, _>("reasoning_tokens"),
        "cachedTokens": row.get::<i64, _>("cached_tokens"),
        "totalTokens": row.get::<i64, _>("total_tokens"),
        "costYuan": decimal_json(row.get::<Decimal, _>("cost_yuan")),
        "billableYuan": decimal_json(row.get::<Decimal, _>("billable_yuan")),
        "lastUsedAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("last_used_at").unwrap_or(None)
    })
}

pub(crate) fn require_admin(state: &AppState, headers: &HeaderMap) -> ApiResult<()> {
    let token = bearer_token(headers)?;
    state
        .admin_tokens
        .verify(token)
        .map(|_| ())
        .map_err(|_| ApiError::Unauthorized("invalid or expired admin token".to_string()))
}

fn generate_authorization_code() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!(
        "AS-{}-{}-{}-{}",
        &raw[0..8],
        &raw[8..16],
        &raw[16..24],
        &raw[24..32]
    )
}

fn code_hint(value: &str) -> String {
    let normalized = normalize_authorization_code(value);
    let suffix = normalized
        .chars()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<String>();
    format!("****-{suffix}")
}

async fn scalar_count(pool: &PgPool, sql: &str) -> Result<i64, sqlx::Error> {
    let row = sqlx::query(sql).fetch_one(pool).await?;
    row.try_get::<i64, _>(0)
}

async fn scalar_decimal(pool: &PgPool, sql: &str) -> Result<Decimal, sqlx::Error> {
    let row = sqlx::query(sql).fetch_one(pool).await?;
    row.try_get::<Decimal, _>(0)
}

fn bearer_token(headers: &HeaderMap) -> ApiResult<&str> {
    let value = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ApiError::Unauthorized("missing bearer token".to_string()))?;
    value
        .strip_prefix("Bearer ")
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| ApiError::Unauthorized("invalid bearer token".to_string()))
}

fn default_budget_yuan() -> Decimal {
    Decimal::from(5_u64)
}

fn default_status() -> String {
    "active".to_string()
}

fn default_billing_mode() -> String {
    "hybrid".to_string()
}

fn default_gateway_mode() -> String {
    "gateway_api".to_string()
}

fn default_endpoint_path() -> String {
    "/responses".to_string()
}

fn default_model_context_window_tokens() -> i32 {
    64_000
}

fn default_model_max_output_tokens() -> i32 {
    32_000
}

fn default_supported_reasoning_efforts() -> Vec<String> {
    vec!["none".to_string()]
}

fn default_reasoning_effort() -> String {
    "none".to_string()
}

fn default_provider_auth_header() -> String {
    "authorization".to_string()
}

fn default_provider_request_timeout_ms() -> u64 {
    300_000
}

fn default_provider_max_retries() -> u32 {
    2
}

fn validate_tenant_fields(request: &TenantSaveRequest) -> ApiResult<()> {
    if !(1..=10_000).contains(&request.max_devices) {
        return Err(ApiError::BadRequest(
            "maxDevices must be between 1 and 10000".to_string(),
        ));
    }
    if !matches!(request.status.trim(), "active" | "suspended" | "disabled") {
        return Err(ApiError::BadRequest("invalid tenant status".to_string()));
    }
    if !matches!(
        request.billing_mode.trim(),
        "hybrid" | "gateway_api" | "subscription"
    ) {
        return Err(ApiError::BadRequest("invalid billing mode".to_string()));
    }
    Ok(())
}

fn validate_model_route_fields(
    request: &ModelRouteSaveRequest,
    minimum_markup_bps: u64,
) -> ApiResult<()> {
    if request.label.trim().is_empty() || request.provider.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "label and provider are required".to_string(),
        ));
    }
    if !(16_000..=2_000_000).contains(&request.context_window_tokens) {
        return Err(ApiError::BadRequest(
            "contextWindowTokens must be between 16000 and 2000000".to_string(),
        ));
    }
    if !(1_000..=1_000_000).contains(&request.max_output_tokens) {
        return Err(ApiError::BadRequest(
            "maxOutputTokens must be between 1000 and 1000000".to_string(),
        ));
    }
    const ALLOWED_REASONING_EFFORTS: &[&str] =
        &["none", "minimal", "low", "medium", "high", "xhigh", "max"];
    if request.supported_reasoning_efforts.is_empty()
        || request
            .supported_reasoning_efforts
            .iter()
            .any(|effort| !ALLOWED_REASONING_EFFORTS.contains(&effort.trim()))
        || !request
            .supported_reasoning_efforts
            .iter()
            .any(|effort| effort.trim() == request.default_reasoning_effort.trim())
    {
        return Err(ApiError::BadRequest(
            "supportedReasoningEfforts must contain valid values and include defaultReasoningEffort"
                .to_string(),
        ));
    }
    let prices = [
        request.input_yuan_per_million,
        request.output_yuan_per_million,
        request.reasoning_yuan_per_million,
        request.cached_input_yuan_per_million,
    ];
    if prices
        .into_iter()
        .any(|price| !has_supported_scale(price) || price < Decimal::ZERO)
    {
        return Err(ApiError::BadRequest(
            "model prices must be non-negative amounts with at most 6 decimals".to_string(),
        ));
    }
    if !(0..=100_000).contains(&request.markup_bps) {
        return Err(ApiError::BadRequest(
            "markupBps must be between 0 and 100000".to_string(),
        ));
    }
    if request.enabled
        && request.mode.trim() == "gateway_api"
        && request.markup_bps < minimum_markup_bps as i64
    {
        return Err(ApiError::BadRequest(format!(
            "enabled pay-as-you-go models require at least {minimum_markup_bps} markup basis points"
        )));
    }
    if request.enabled
        && request.mode.trim() == "gateway_api"
        && (request.input_yuan_per_million <= Decimal::ZERO
            || request.output_yuan_per_million <= Decimal::ZERO)
    {
        return Err(ApiError::BadRequest(
            "enabled pay-as-you-go models require positive input and output cost prices"
                .to_string(),
        ));
    }
    Ok(())
}

fn validate_provider_fields(request: &ProviderConfigSaveRequest) -> ApiResult<()> {
    let base_url = request.base_url.trim();
    if !(base_url.starts_with("https://") || base_url.starts_with("http://")) {
        return Err(ApiError::BadRequest(
            "baseUrl must use http:// or https://".to_string(),
        ));
    }
    if contains_header_control_chars(&request.endpoint_path)
        || contains_header_control_chars(&request.auth_header)
    {
        return Err(ApiError::BadRequest(
            "endpointPath and authHeader cannot contain control characters".to_string(),
        ));
    }
    if request.auth_type != ProviderAuthType::None && request.auth_header.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "authHeader is required for the selected auth type".to_string(),
        ));
    }
    for (name, value) in request
        .custom_headers
        .iter()
        .chain(request.query_params.iter())
    {
        if name.trim().is_empty()
            || contains_header_control_chars(name)
            || contains_header_control_chars(value)
        {
            return Err(ApiError::BadRequest(
                "custom header and query parameter names/values must be non-empty single-line strings"
                    .to_string(),
            ));
        }
        if looks_like_secret_field(name) {
            return Err(ApiError::BadRequest(
                "credentials must use the protected API Key field, not customHeaders or queryParams"
                    .to_string(),
            ));
        }
    }
    Ok(())
}

fn looks_like_secret_field(name: &str) -> bool {
    let normalized = name.trim().to_ascii_lowercase().replace('-', "_");
    matches!(
        normalized.as_str(),
        "authorization"
            | "proxy_authorization"
            | "api_key"
            | "apikey"
            | "x_api_key"
            | "access_token"
            | "token"
            | "secret"
            | "password"
            | "key"
    )
}

fn contains_header_control_chars(value: &str) -> bool {
    value.chars().any(char::is_control)
}

fn default_monthly_plan() -> String {
    "monthly".to_string()
}

fn default_client_email() -> String {
    "local@alpha-studio.local".to_string()
}

fn default_client_name() -> String {
    "本机用户".to_string()
}

fn validate_client_agreement_acceptance(acceptance: &ClientAgreementAcceptance) -> ApiResult<()> {
    let current_versions = acceptance.service_terms_version.trim() == CURRENT_SERVICE_TERMS_VERSION
        && acceptance.privacy_policy_version.trim() == CURRENT_PRIVACY_POLICY_VERSION
        && acceptance.third_party_model_notice_version.trim()
            == CURRENT_THIRD_PARTY_MODEL_NOTICE_VERSION
        && acceptance.research_risk_disclosure_version.trim()
            == CURRENT_RESEARCH_RISK_DISCLOSURE_VERSION;
    let all_accepted = acceptance.service_terms_accepted
        && acceptance.privacy_policy_accepted
        && acceptance.third_party_model_notice_accepted
        && acceptance.research_risk_disclosure_accepted;
    if !current_versions || !all_accepted {
        return Err(ApiError::BadRequest(
            "the current service terms, privacy policy, third-party model notice, and research risk disclosure must be accepted before activation"
                .to_string(),
        ));
    }
    Ok(())
}

fn default_max_devices_i32() -> i32 {
    3
}

fn default_sort_order() -> i32 {
    100
}

fn default_one() -> i32 {
    1
}

fn normalized_codex_tenant_ids(
    tenant_ids: Option<Vec<String>>,
    legacy_tenant_id: Option<String>,
) -> Vec<String> {
    let values = tenant_ids.unwrap_or_else(|| legacy_tenant_id.into_iter().collect());
    values.into_iter().fold(Vec::new(), |mut normalized, id| {
        let id = id.trim().to_string();
        if !id.is_empty() && !normalized.contains(&id) {
            normalized.push(id);
        }
        normalized
    })
}

#[cfg(test)]
#[path = "gateway_request_tests.rs"]
mod gateway_request_tests;

#[cfg(test)]
mod tests {
    use std::{convert::Infallible, time::Duration};

    use axum::{
        body::{Body, Bytes},
        response::Response,
        routing::get,
        Router,
    };
    use chrono::{TimeZone, Utc};
    use futures_util::StreamExt;
    use rust_decimal::Decimal;
    use serde_json::json;
    use sqlx::{postgres::PgPoolOptions, Row};

    use super::{
        billing_ledger_page, bounded_pagination, enforce_request_budget,
        ensure_gateway_run_available, estimate_request_input_tokens, looks_like_secret_field,
        normalized_codex_tenant_ids, pricing_for_gateway_request, recommended_run_budget_yuan,
        remove_model_provider_fields, request_safety_charge_yuan, resolve_billing_period,
        resolve_usage_charge, settle_and_record_usage, start_gateway_request,
        stream_upstream_response, validate_client_agreement_acceptance,
        validate_offline_payment_request, ClientAgreementAcceptance, MeteringStatus, ModelRoute,
        OfflinePaymentRequest, FAST_MODE_COST_MULTIPLIER, GATEWAY_REQUEST_LEASE_WAIT_TIMEOUT,
        GATEWAY_RUN_TTL_SECONDS, GATEWAY_TASK_FULL_WINDOW_REQUEST_CAP,
    };
    use crate::{
        billing::{GatewayUsage, Pricing},
        gateway::{UpstreamRequest, UpstreamResponseFormat},
        state::GatewayRunQueue,
        tokens::RunTokenClaims,
    };

    #[test]
    fn queue_deadline_covers_provider_inference_retries_and_settlement() {
        let mut provider = crate::gateway::ProviderConfig {
            request_timeout_ms: 300_000,
            max_retries: 0,
            ..Default::default()
        };
        assert_eq!(
            super::gateway_request_wait_timeout(&provider),
            Duration::from_secs(510)
        );
        provider.max_retries = 2;
        assert_eq!(
            super::gateway_request_wait_timeout(&provider),
            Duration::from_secs(1110)
        );
    }

    #[test]
    fn bounds_billing_ledger_pagination() {
        assert_eq!(bounded_pagination(None, None, 8), (1, 8));
        assert_eq!(bounded_pagination(Some(0), Some(0), 8), (1, 1));
        assert_eq!(bounded_pagination(Some(4), Some(500), 8), (4, 100));
    }

    #[test]
    fn resolves_monthly_and_yearly_billing_periods() {
        let now = Utc
            .with_ymd_and_hms(2026, 9, 3, 11, 17, 0)
            .single()
            .unwrap();
        let month = resolve_billing_period(now, Some("month"), Some("2026-02")).unwrap();
        assert_eq!(month.kind, "month");
        assert_eq!(month.value, "2026-02");
        assert_eq!(
            month.start,
            Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).single().unwrap()
        );
        assert_eq!(
            month.end,
            Utc.with_ymd_and_hms(2026, 3, 1, 0, 0, 0).single().unwrap()
        );

        let year = resolve_billing_period(now, Some("year"), Some("2025")).unwrap();
        assert_eq!(year.kind, "year");
        assert_eq!(year.value, "2025");
        assert_eq!(
            year.start,
            Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).single().unwrap()
        );
        assert_eq!(
            year.end,
            Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).single().unwrap()
        );
    }

    #[test]
    fn rejects_malformed_billing_periods() {
        let now = Utc::now();
        assert!(resolve_billing_period(now, Some("month"), Some("2026-13")).is_err());
        assert!(resolve_billing_period(now, Some("year"), Some("26")).is_err());
        assert!(resolve_billing_period(now, Some("quarter"), Some("2026-Q1")).is_err());
    }

    #[test]
    fn removes_provider_details_from_client_model_usage() {
        let mut models = vec![json!({
            "modelId": "gpt-5.6-sol",
            "label": "GPT-5.6 Sol",
            "provider": "cli-proxy"
        })];
        remove_model_provider_fields(&mut models);
        assert_eq!(models[0]["label"], "GPT-5.6 Sol");
        assert!(models[0].get("provider").is_none());
    }

    #[test]
    fn validates_exact_offline_receipt_records() {
        let valid = OfflinePaymentRequest {
            amount_yuan: Decimal::new(123_456_789, 6),
            reference: "bank-transfer-001".to_string(),
            note: "received outside Alpha Studio".to_string(),
            received_at: None,
            operation_key: "op-001".to_string(),
        };
        assert!(validate_offline_payment_request("tenant_alpha", &valid).is_ok());

        let too_precise = OfflinePaymentRequest {
            amount_yuan: Decimal::new(1, 7),
            reference: valid.reference.clone(),
            note: valid.note.clone(),
            received_at: None,
            operation_key: valid.operation_key.clone(),
        };
        assert!(validate_offline_payment_request("tenant_alpha", &too_precise).is_err());

        let negative = OfflinePaymentRequest {
            amount_yuan: Decimal::NEGATIVE_ONE,
            ..valid
        };
        assert!(validate_offline_payment_request("tenant_alpha", &negative).is_err());
    }

    #[test]
    fn normalizes_multiple_account_tenant_assignments() {
        assert_eq!(
            normalized_codex_tenant_ids(
                Some(vec![
                    " tenant_alpha ".to_string(),
                    "tenant_beta".to_string(),
                    "tenant_alpha".to_string(),
                    "".to_string(),
                ]),
                Some("legacy_tenant".to_string()),
            ),
            vec!["tenant_alpha", "tenant_beta"]
        );
    }

    #[test]
    fn accepts_the_legacy_single_tenant_field() {
        assert_eq!(
            normalized_codex_tenant_ids(None, Some("tenant_alpha".to_string())),
            vec!["tenant_alpha"]
        );
    }

    #[test]
    fn keeps_credentials_out_of_plain_custom_provider_fields() {
        for field in ["Authorization", "x-api-key", "access_token", "key"] {
            assert!(looks_like_secret_field(field), "{field}");
        }
        assert!(!looks_like_secret_field("api-version"));
        assert!(!looks_like_secret_field("anthropic-version"));
    }

    fn test_model_route(
        pricing: Pricing,
        context_window_tokens: u64,
        max_output_tokens: u64,
    ) -> ModelRoute {
        ModelRoute {
            provider: "volcengine-ark".to_string(),
            base_url: "https://ark.cn-beijing.volces.com/api/v3".to_string(),
            endpoint_path: "/responses".to_string(),
            upstream_model: "test-model".to_string(),
            context_window_tokens,
            max_output_tokens,
            pricing,
        }
    }

    fn current_agreement_acceptance() -> ClientAgreementAcceptance {
        ClientAgreementAcceptance {
            service_terms_version: "2026-08-04".to_string(),
            service_terms_accepted: true,
            privacy_policy_version: "2026-08-04".to_string(),
            privacy_policy_accepted: true,
            third_party_model_notice_version: "2026-08-04".to_string(),
            third_party_model_notice_accepted: true,
            research_risk_disclosure_version: "2026-08-04".to_string(),
            research_risk_disclosure_accepted: true,
        }
    }

    #[test]
    fn requires_every_current_activation_agreement() {
        let acceptance = current_agreement_acceptance();
        assert!(validate_client_agreement_acceptance(&acceptance).is_ok());

        let mut missing = current_agreement_acceptance();
        missing.third_party_model_notice_accepted = false;
        assert!(validate_client_agreement_acceptance(&missing).is_err());

        let mut outdated = current_agreement_acceptance();
        outdated.privacy_policy_version = "2026-01-01".to_string();
        assert!(validate_client_agreement_acceptance(&outdated).is_err());
    }

    #[test]
    fn caps_output_tokens_to_the_per_run_safety_limit() {
        let mut body = json!({
            "input": "hello",
            "max_output_tokens": 1_000_000
        });
        let route = test_model_route(
            Pricing {
                input_yuan_per_million: Decimal::from(10_u64),
                output_yuan_per_million: Decimal::from(100_u64),
                reasoning_yuan_per_million: Decimal::from(100_u64),
                cached_input_yuan_per_million: Decimal::from(2_u64),
                markup_bps: 2_500,
            },
            1_048_576,
            393_216,
        );

        enforce_request_budget(&mut body, Decimal::ONE, &route, &route.pricing).unwrap();

        let capped = body["max_output_tokens"].as_u64().unwrap();
        assert!(capped > 0);
        assert!(capped < 1_000_000);
    }

    #[test]
    fn rejects_a_budget_that_cannot_cover_the_request_input() {
        let mut body = json!({ "input": "x".repeat(50_000) });
        let route = test_model_route(
            Pricing {
                input_yuan_per_million: Decimal::from(100_u64),
                output_yuan_per_million: Decimal::from(100_u64),
                reasoning_yuan_per_million: Decimal::from(100_u64),
                cached_input_yuan_per_million: Decimal::from(100_u64),
                markup_bps: 0,
            },
            1_048_576,
            131_072,
        );

        assert!(
            enforce_request_budget(&mut body, Decimal::new(1, 2), &route, &route.pricing).is_err()
        );
    }

    #[test]
    fn ark_glm_budget_funds_the_verified_full_model_window() {
        let route = test_model_route(
            Pricing {
                input_yuan_per_million: Decimal::from(8_u64),
                output_yuan_per_million: Decimal::from(28_u64),
                reasoning_yuan_per_million: Decimal::from(28_u64),
                cached_input_yuan_per_million: Decimal::from(2_u64),
                markup_bps: 2_500,
            },
            1_048_576,
            131_072,
        );
        let budget = recommended_run_budget_yuan(&route, &route.pricing);

        assert!(budget > Decimal::from(5_u64));
        assert_eq!(budget, Decimal::new(964_689_920, 6));
        assert_eq!(
            budget,
            request_safety_charge_yuan(1_048_576, 131_072, &route.pricing)
                * Decimal::from(GATEWAY_TASK_FULL_WINDOW_REQUEST_CAP)
        );
        assert_eq!(
            recommended_run_budget_yuan(
                &route,
                &route
                    .pricing
                    .with_cost_multiplier(FAST_MODE_COST_MULTIPLIER),
            ),
            budget * Decimal::from(FAST_MODE_COST_MULTIPLIER),
        );
    }

    #[test]
    fn request_estimate_counts_tokens_instead_of_utf8_bytes() {
        let body = json!({ "input": "研究".repeat(10_000) });
        let estimated = estimate_request_input_tokens(&body, 1_048_576).unwrap();
        let serialized_bytes = serde_json::to_vec(&body).unwrap().len() as u64;

        assert!(estimated < serialized_bytes);
        assert!(estimated > 20_000);
    }

    #[test]
    fn priority_service_tier_doubles_cost_before_applying_user_markup() {
        let pricing = Pricing {
            input_yuan_per_million: Decimal::from(10_u64),
            output_yuan_per_million: Decimal::from(40_u64),
            reasoning_yuan_per_million: Decimal::from(40_u64),
            cached_input_yuan_per_million: Decimal::from(2_u64),
            markup_bps: 2_500,
        };
        let standard = pricing_for_gateway_request(&pricing, &json!({ "service_tier": "default" }));
        let fast = pricing_for_gateway_request(&pricing, &json!({ "service_tier": "priority" }));
        let usage = GatewayUsage {
            input_tokens: 1_000_000,
            output_tokens: 0,
            reasoning_tokens: 0,
            cached_tokens: 0,
        };

        assert_eq!(standard, pricing);
        assert_eq!(fast.input_yuan_per_million, Decimal::from(20_u64));
        assert_eq!(fast.output_yuan_per_million, Decimal::from(80_u64));
        assert_eq!(fast.reasoning_yuan_per_million, Decimal::from(80_u64));
        assert_eq!(fast.cached_input_yuan_per_million, Decimal::from(4_u64));
        assert_eq!(fast.markup_bps, 2_500);

        let charge = crate::billing::settle_usage_yuan(&usage, &fast);
        assert_eq!(charge.cost_yuan, Decimal::from(20_u64));
        assert_eq!(charge.billable_yuan, Decimal::from(25_u64));
    }

    #[test]
    fn does_not_guess_a_charge_when_upstream_usage_is_unavailable() {
        let pricing = Pricing {
            input_yuan_per_million: Decimal::ONE,
            output_yuan_per_million: Decimal::ONE,
            reasoning_yuan_per_million: Decimal::ONE,
            cached_input_yuan_per_million: Decimal::ONE,
            markup_bps: 500,
        };

        let (cost, billable, label, note) = resolve_usage_charge(
            &pricing,
            &GatewayUsage::default(),
            MeteringStatus::UsageUnavailable("missing usage"),
        );

        assert_eq!(cost, Decimal::ZERO);
        assert_eq!(billable, Decimal::ZERO);
        assert_eq!(label, "usage_unavailable");
        assert_eq!(note, "missing usage");
    }

    #[test]
    fn task_run_tokens_cover_a_full_day_with_safety_margin() {
        assert_eq!(GATEWAY_RUN_TTL_SECONDS, 48 * 60 * 60);
    }

    #[tokio::test]
    async fn one_task_run_settles_multiple_sequential_model_requests() {
        let Ok(database_url) = std::env::var("ALPHA_STUDIO_TEST_DATABASE_URL") else {
            return;
        };
        let pool = PgPoolOptions::new()
            .max_connections(2)
            .connect(&database_url)
            .await
            .expect("connect gateway regression database");
        sqlx::migrate!("../migrations")
            .run(&pool)
            .await
            .expect("migrate gateway regression database");

        let suffix = uuid::Uuid::new_v4().simple().to_string();
        let tenant_id = format!("tenant_multistep_{suffix}");
        let user_id = format!("user_multistep_{suffix}");
        let device_id = format!("device_multistep_{suffix}");
        let run_id = format!("run_multistep_{suffix}");
        let model_id = format!("model_multistep_{suffix}");
        sqlx::query(
            "insert into tenants (id, name, company_key, balance_yuan) values ($1, $2, $3, 100)",
        )
        .bind(&tenant_id)
        .bind(format!("Multistep {suffix}"))
        .bind(format!("multistep-{suffix}"))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("insert into users (id, tenant_id, email, name) values ($1, $2, $3, 'Test')")
            .bind(&user_id)
            .bind(&tenant_id)
            .bind(format!("{suffix}@example.test"))
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            r#"
            insert into devices
              (id, tenant_id, user_id, fingerprint, name, lease_expires_at)
            values ($1, $2, $3, $4, 'Test', now() + interval '1 day')
            "#,
        )
        .bind(&device_id)
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(format!("fingerprint-{suffix}"))
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            insert into model_runs
              (id, tenant_id, user_id, device_id, model_id, mode, status, budget_yuan)
            values ($1, $2, $3, $4, $5, 'gateway_api', 'created', 5)
            "#,
        )
        .bind(&run_id)
        .bind(&tenant_id)
        .bind(&user_id)
        .bind(&device_id)
        .bind(&model_id)
        .execute(&pool)
        .await
        .unwrap();

        let claims = RunTokenClaims::new(
            tenant_id.clone(),
            user_id,
            device_id,
            run_id.clone(),
            model_id,
            Decimal::from(5_u64),
            GATEWAY_RUN_TTL_SECONDS,
        );
        let pricing = Pricing {
            input_yuan_per_million: Decimal::ONE,
            output_yuan_per_million: Decimal::ONE,
            reasoning_yuan_per_million: Decimal::ONE,
            cached_input_yuan_per_million: Decimal::ONE,
            markup_bps: 0,
        };
        let usage = GatewayUsage {
            input_tokens: 1_000,
            output_tokens: 1_000,
            reasoning_tokens: 0,
            cached_tokens: 0,
        };

        for request_id in ["gwreq_tool_choice", "gwreq_after_tool"] {
            let remaining = start_gateway_request(
                &pool,
                &claims,
                request_id,
                GATEWAY_REQUEST_LEASE_WAIT_TIMEOUT,
            )
            .await
            .unwrap();
            assert!(remaining > Decimal::ZERO);
            settle_and_record_usage(
                &pool,
                &claims,
                request_id,
                &pricing,
                &usage,
                200,
                Utc::now(),
                MeteringStatus::Reported,
            )
            .await
            .unwrap();
            ensure_gateway_run_available(&pool, &claims).await.unwrap();
        }

        // Codex may send the post-tool request before the previous stream has
        // delivered its final usage frame. The second acquisition must wait for
        // settlement rather than fail with a transient 429.
        let overlapping_owner = "gwreq_overlap_owner";
        start_gateway_request(
            &pool,
            &claims,
            overlapping_owner,
            GATEWAY_REQUEST_LEASE_WAIT_TIMEOUT,
        )
        .await
        .unwrap();
        let waiting_pool = pool.clone();
        let waiting_claims = claims.clone();
        let waiting_started = std::time::Instant::now();
        let waiting_request = tokio::spawn(async move {
            start_gateway_request(
                &waiting_pool,
                &waiting_claims,
                "gwreq_overlap_waiter",
                GATEWAY_REQUEST_LEASE_WAIT_TIMEOUT,
            )
            .await
        });
        tokio::time::sleep(Duration::from_millis(250)).await;
        settle_and_record_usage(
            &pool,
            &claims,
            overlapping_owner,
            &pricing,
            &usage,
            200,
            Utc::now(),
            MeteringStatus::Reported,
        )
        .await
        .unwrap();
        let remaining = waiting_request.await.unwrap().unwrap();
        assert!(remaining > Decimal::ZERO);
        assert!(waiting_started.elapsed() >= Duration::from_millis(200));
        settle_and_record_usage(
            &pool,
            &claims,
            "gwreq_overlap_waiter",
            &pricing,
            &usage,
            200,
            Utc::now(),
            MeteringStatus::Reported,
        )
        .await
        .unwrap();

        let run = sqlx::query(
            r#"
            select status, active_request_id, request_count, accumulated_billable_yuan
            from model_runs where id = $1
            "#,
        )
        .bind(&run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(run.get::<String, _>("status"), "running");
        assert_eq!(run.get::<Option<String>, _>("active_request_id"), None);
        assert_eq!(run.get::<i64, _>("request_count"), 4);
        assert!(run.get::<Decimal, _>("accumulated_billable_yuan") > Decimal::ZERO);
        let settlement_count = sqlx::query_scalar::<_, i64>(
            "select count(*)::bigint from usage_events where run_id = $1",
        )
        .bind(&run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(settlement_count, 4);

        let ledger = billing_ledger_page(&pool, &tenant_id, 1, 20, None, None)
            .await
            .unwrap();
        assert_eq!(ledger.total, 1);
        assert_eq!(ledger.entries.len(), 1);
        assert_eq!(ledger.entries[0]["runId"], run_id);
        assert_eq!(ledger.entries[0]["entryCount"], 4);
        assert_eq!(ledger.entries[0]["amountYuan"], json!(-0.008));

        sqlx::query("delete from tenants where id = $1")
            .bind(&tenant_id)
            .execute(&pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn forwards_the_first_upstream_delta_before_the_stream_finishes() {
        let app = Router::new().route(
            "/",
            get(|| async {
                let stream = async_stream::stream! {
                    yield Ok::<Bytes, Infallible>(Bytes::from_static(
                        b"data: {\"id\":\"chat_test\",\"model\":\"test\",\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\n",
                    ));
                    tokio::time::sleep(Duration::from_millis(250)).await;
                    yield Ok::<Bytes, Infallible>(Bytes::from_static(
                        b"data: {\"id\":\"chat_test\",\"choices\":[{\"delta\":{\"content\":\"second\"}}]}\n\ndata: [DONE]\n\n",
                    ));
                };
                Response::builder()
                    .header("content-type", "text/event-stream")
                    .body(Body::from_stream(stream))
                    .unwrap()
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let upstream = reqwest::Client::new()
            .get(format!("http://{address}/"))
            .send()
            .await
            .unwrap();
        let request = UpstreamRequest {
            url: format!("http://{address}/"),
            headers: Vec::new(),
            query_params: Vec::new(),
            response_format: UpstreamResponseFormat::ChatCompletions,
            stream_response: true,
            namespace_tool_compat: false,
            request_timeout_ms: 1_000,
            max_retries: 0,
        };
        let pool = PgPoolOptions::new()
            .acquire_timeout(Duration::from_millis(25))
            .connect_lazy("postgresql://postgres:postgres@127.0.0.1:1/unused")
            .unwrap();
        let run_queue = GatewayRunQueue::default();
        let run_permit = run_queue
            .acquire("run_test", Duration::from_secs(1))
            .await
            .unwrap();
        let response = stream_upstream_response(
            upstream,
            request,
            json!({ "stream": true }),
            pool,
            RunTokenClaims::new(
                "tenant_test".to_string(),
                "user_test".to_string(),
                "device_test".to_string(),
                "run_test".to_string(),
                "model_test".to_string(),
                Decimal::ONE,
                60,
            ),
            "gwreq_test".to_string(),
            Pricing {
                input_yuan_per_million: Decimal::ZERO,
                output_yuan_per_million: Decimal::ZERO,
                reasoning_yuan_per_million: Decimal::ZERO,
                cached_input_yuan_per_million: Decimal::ZERO,
                markup_bps: 0,
            },
            Utc::now(),
            run_permit,
        );
        let started = tokio::time::Instant::now();
        let mut body = response.into_body().into_data_stream();
        let first = tokio::time::timeout(Duration::from_millis(150), body.next())
            .await
            .expect("first gateway chunk was buffered until completion")
            .expect("gateway stream ended before the first chunk")
            .unwrap();
        let first = String::from_utf8(first.to_vec()).unwrap();
        assert!(first.contains("response.output_text.delta"));
        assert!(first.contains("first"));
        assert!(!first.contains("response.completed"));
        assert!(run_queue
            .acquire("run_test", Duration::from_millis(20))
            .await
            .is_none());

        let mut rest = String::new();
        tokio::time::timeout(Duration::from_secs(1), async {
            while let Some(chunk) = body.next().await {
                let chunk = chunk.unwrap();
                rest.push_str(std::str::from_utf8(&chunk).unwrap());
            }
        })
        .await
        .expect("gateway stream did not close after the upstream completion");
        assert!(started.elapsed() >= Duration::from_millis(200));
        assert!(rest.contains("second"));
        assert!(rest.contains("response.completed"));
        assert!(rest.contains("data: [DONE]"));
        assert!(run_queue
            .acquire("run_test", Duration::from_millis(20))
            .await
            .is_some());

        server.abort();
    }

    #[tokio::test]
    async fn withholds_native_terminal_frames_from_a_shared_network_chunk() {
        for include_done in [true, false] {
            let app = Router::new().route(
                "/",
                get(move || async move {
                    let stream = futures_util::stream::once(async move {
                        let bytes = br#"event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"ready"}

event: response.completed
data: {"type":"response.completed","response":{"usage":{"input_tokens":8,"output_tokens":3}}}

data: [DONE]

"#;
                        let text = std::str::from_utf8(bytes).unwrap();
                        Ok::<Bytes, Infallible>(Bytes::from(if include_done {
                            text.to_string()
                        } else {
                            text.replace("data: [DONE]\n\n", "")
                        }))
                    })
                    .chain(futures_util::stream::pending());
                    Response::builder()
                        .header("content-type", "text/event-stream")
                        .body(Body::from_stream(stream))
                        .unwrap()
                }),
            );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
            let upstream = reqwest::Client::new()
                .get(format!("http://{address}/"))
                .send()
                .await
                .unwrap();
            let request = UpstreamRequest {
                url: format!("http://{address}/"),
                headers: Vec::new(),
                query_params: Vec::new(),
                response_format: UpstreamResponseFormat::Responses,
                stream_response: true,
                namespace_tool_compat: false,
                request_timeout_ms: 1_000,
                max_retries: 0,
            };
            let pool = PgPoolOptions::new()
                .acquire_timeout(Duration::from_millis(25))
                .connect_lazy("postgresql://postgres:postgres@127.0.0.1:1/unused")
                .unwrap();
            let run_queue = GatewayRunQueue::default();
            let run_permit = run_queue
                .acquire("run_test", Duration::from_secs(1))
                .await
                .unwrap();
            let response = stream_upstream_response(
                upstream,
                request,
                json!({ "stream": true }),
                pool,
                RunTokenClaims::new(
                    "tenant_test".to_string(),
                    "user_test".to_string(),
                    "device_test".to_string(),
                    "run_test".to_string(),
                    "model_test".to_string(),
                    Decimal::ONE,
                    60,
                ),
                "gwreq_test".to_string(),
                Pricing {
                    input_yuan_per_million: Decimal::ZERO,
                    output_yuan_per_million: Decimal::ZERO,
                    reasoning_yuan_per_million: Decimal::ZERO,
                    cached_input_yuan_per_million: Decimal::ZERO,
                    markup_bps: 0,
                },
                Utc::now(),
                run_permit,
            );
            let mut body = response.into_body().into_data_stream();
            let first = tokio::time::timeout(Duration::from_millis(150), body.next())
                .await
                .expect("native delta was buffered with settlement")
                .expect("gateway stream ended before the native delta")
                .unwrap();
            let first = String::from_utf8(first.to_vec()).unwrap();
            assert!(first.contains("response.output_text.delta"));
            assert!(first.contains("ready"));
            assert!(!first.contains("response.completed"));
            assert!(!first.contains("[DONE]"));
            assert!(run_queue
                .acquire("run_test", Duration::from_millis(20))
                .await
                .is_none());

            let mut rest = String::new();
            tokio::time::timeout(Duration::from_secs(1), async {
                while let Some(chunk) = body.next().await {
                    rest.push_str(std::str::from_utf8(&chunk.unwrap()).unwrap());
                }
            })
            .await
            .expect("gateway stream did not publish native completion after settlement");
            assert!(rest.contains("response.completed"));
            assert_eq!(rest.contains("data: [DONE]"), include_done);
            assert!(run_queue
                .acquire("run_test", Duration::from_millis(20))
                .await
                .is_some());

            server.abort();
        }
    }
}
