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
    gateway_stream::{
        inspect_responses_stream_data, restore_namespace_tools_in_sse_frame, NativeStreamEvent,
        ResponsesStreamAdapter, SseDecoder,
    },
    license::{
        can_activate_device, codex_subscription_available, hash_authorization_code,
        normalize_authorization_code, normalize_company_name, CLIENT_DEVICE_LEASE_DAYS,
    },
    market::{CapitalFlowSnapshot, MarketSnapshot},
    money::{decimal_json, deserialize_decimal, has_supported_scale},
    state::AppState,
    tokens::{AdminTokenClaims, DeviceTokenClaims, RunTokenClaims},
};

const CURRENT_SERVICE_TERMS_VERSION: &str = "2026-08-04";
const CURRENT_PRIVACY_POLICY_VERSION: &str = "2026-08-04";
const CURRENT_THIRD_PARTY_MODEL_NOTICE_VERSION: &str = "2026-08-04";
const CURRENT_RESEARCH_RISK_DISCLOSURE_VERSION: &str = "2026-08-04";
const GATEWAY_RUN_TTL_SECONDS: i64 = 48 * 60 * 60;

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
}

pub async fn client_billing_summary(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ClientBillingSummaryRequest>,
) -> ApiResult<Json<Value>> {
    require_device(&state, &headers, &request.tenant_id, &request.device_id).await?;
    release_expired_run_reservations(&state.db, &request.tenant_id).await?;
    let now = Utc::now();
    let (current_month_start, next_month_start) = current_billing_period(now);
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
    let current_month =
        usage_totals_since(&state.db, &request.tenant_id, current_month_start).await?;
    let all_time = usage_totals_all(&state.db, &request.tenant_id).await?;
    let model_usage = model_usage_since(&state.db, &request.tenant_id, current_month_start).await?;
    let ledger =
        billing_ledger_page(&state.db, &request.tenant_id, ledger_page, ledger_page_size).await?;
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
            "currentMonthStart": current_month_start,
            "currentMonthEnd": next_month_start,
            "generatedAt": now
        },
        "usage": {
            "currentMonth": current_month,
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
}

pub async fn run_create(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<RunCreateRequest>,
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
        "gatewayUrl": format!("{}/v1/responses", state.config.app_base_url)
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
    let current_month = usage_totals_since(&state.db, tenant_id, current_month_start).await?;
    let all_time = usage_totals_all(&state.db, tenant_id).await?;
    let model_usage = model_usage_since(&state.db, tenant_id, current_month_start).await?;
    let ledger = billing_ledger_page(&state.db, tenant_id, page, page_size).await?;
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
          m.upstream_model, m.enabled, m.sort_order,
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
          id, model_id, label, provider, mode, base_url, endpoint_path, upstream_model, enabled,
          sort_order, input_yuan_per_million, output_yuan_per_million,
          reasoning_yuan_per_million, cached_input_yuan_per_million, markup_bps, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
        on conflict (model_id) do update set
          label = excluded.label,
          provider = excluded.provider,
          mode = excluded.mode,
          base_url = excluded.base_url,
          endpoint_path = excluded.endpoint_path,
          upstream_model = excluded.upstream_model,
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
    let provider = load_provider_config(&state, &route).await?;
    let gateway_request_id = format!("gwreq_{}", Uuid::new_v4().simple());
    let remaining_budget = start_gateway_request(&state.db, &claims, &gateway_request_id).await?;
    if let Err(error) = enforce_request_budget(&mut body, remaining_budget, &route.pricing) {
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
                    &route.pricing,
                    &GatewayUsage::default(),
                    0,
                    started,
                    MeteringStatus::UsageUnavailable("ambiguous upstream transport failure"),
                )
                .await?;
            } else {
                release_gateway_request(&state.db, &claims, &gateway_request_id, None).await?;
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
            route.pricing,
            started,
        ));
    }
    let text = match upstream.text().await {
        Ok(text) => text,
        Err(error) => {
            settle_and_record_usage(
                &state.db,
                &claims,
                &gateway_request_id,
                &route.pricing,
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
                    &route.pricing,
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
            &route.pricing,
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
                &route.pricing,
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

fn stream_upstream_response(
    upstream: reqwest::Response,
    request: UpstreamRequest,
    original_body: Value,
    pool: PgPool,
    claims: RunTokenClaims,
    gateway_request_id: String,
    pricing: Pricing,
    started: chrono::DateTime<Utc>,
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
                                Ok(output) => send_stream_bytes(&sender, output).await,
                                Err(error) => {
                                    failed = true;
                                    failure_message = Some(error.clone());
                                    send_stream_bytes(&sender, adapter.fail(&error)).await;
                                    break;
                                }
                            }
                        }
                    } else {
                        for frame in frames {
                            if let Some(data) = frame.data.as_deref() {
                                match inspect_responses_stream_data(data) {
                                    Some(NativeStreamEvent::Completed(value)) => usage = value,
                                    Some(NativeStreamEvent::Failed) => failed = true,
                                    None => {}
                                }
                            }
                            if namespace_tool_compat {
                                let output =
                                    restore_namespace_tools_in_sse_frame(frame, &original_body);
                                let _ = sender.send(Ok(Bytes::from(output))).await;
                            }
                        }
                        if !namespace_tool_compat {
                            // Native Responses SSE needs no protocol conversion. Forward each
                            // network chunk immediately instead of waiting for a complete event.
                            let _ = sender.send(Ok(chunk)).await;
                        }
                    }
                    if failed {
                        break;
                    }
                }
                Err(error) => {
                    failed = true;
                    failure_message = Some(error.to_string());
                    if let Some(adapter) = adapter.as_mut() {
                        send_stream_bytes(&sender, adapter.fail(&error.to_string())).await;
                    } else {
                        send_stream_bytes(&sender, native_stream_failure(&error.to_string())).await;
                    }
                    break;
                }
            }
        }

        if !failed {
            if let Some(frame) = decoder.finish() {
                if let Some(adapter) = adapter.as_mut() {
                    if let Some(data) = frame.data.as_deref() {
                        match adapter.ingest(data) {
                            Ok(output) => send_stream_bytes(&sender, output).await,
                            Err(error) => {
                                failed = true;
                                failure_message = Some(error.clone());
                                send_stream_bytes(&sender, adapter.fail(&error)).await;
                            }
                        }
                    }
                } else {
                    if let Some(data) = frame.data.as_deref() {
                        if let Some(event) = inspect_responses_stream_data(data) {
                            match event {
                                NativeStreamEvent::Completed(value) => usage = value,
                                NativeStreamEvent::Failed => failed = true,
                            }
                        }
                    }
                    if namespace_tool_compat {
                        let output = restore_namespace_tools_in_sse_frame(frame, &original_body);
                        let _ = sender.send(Ok(Bytes::from(output))).await;
                    }
                }
            }
        }

        if !failed {
            if let Some(adapter) = adapter.as_mut() {
                send_stream_bytes(&sender, adapter.finish()).await;
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
        // Settle and release the per-request lease before Codex sees EOF. Codex
        // immediately follows tool results with another Responses call using the
        // same task token, so releasing after EOF creates a false concurrency race.
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
}

async fn send_upstream_post(
    client: &reqwest::Client,
    request: &UpstreamRequest,
    body: &Value,
    idempotency_key: &str,
) -> Result<reqwest::Response, UpstreamPostError> {
    let mut last_error = None;
    let mut may_have_incurred_cost = false;
    for attempt in 0..=request.max_retries {
        let mut builder = client
            .post(&request.url)
            .header("content-type", "application/json")
            .header("idempotency-key", idempotency_key)
            .timeout(Duration::from_millis(request.request_timeout_ms))
            .query(&request.query_params)
            .json(body);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        match builder.send().await {
            Ok(response) => {
                // A POST retry can buy the same inference twice when a provider does not
                // honor idempotency keys. Only 429 is unambiguously safe to retry.
                if attempt < request.max_retries && response.status().as_u16() == 429 {
                    let delay = retry_delay(response.headers(), attempt);
                    tokio::time::sleep(delay).await;
                    continue;
                }
                return Ok(response);
            }
            Err(error) => {
                let retryable = error.is_connect();
                may_have_incurred_cost |= error.is_timeout();
                last_error = Some(error.to_string());
                if attempt >= request.max_retries || !retryable {
                    break;
                }
                tokio::time::sleep(retry_delay(&HeaderMap::new(), attempt)).await;
            }
        }
    }
    Err(UpstreamPostError {
        message: last_error.unwrap_or_else(|| "upstream request failed".to_string()),
        may_have_incurred_cost,
    })
}

async fn send_upstream_get(
    client: &reqwest::Client,
    request: &UpstreamRequest,
) -> Result<reqwest::Response, String> {
    let mut last_error = None;
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
                tokio::time::sleep(retry_delay(&HeaderMap::new(), attempt)).await;
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
        .and_then(|value| value.parse::<u64>().ok())
        .map(|seconds| Duration::from_secs(seconds.min(5)));
    retry_after.unwrap_or_else(|| Duration::from_millis(250 * 2_u64.pow(attempt.min(4))))
}

#[derive(Debug)]
struct ModelRoute {
    provider: String,
    base_url: String,
    endpoint_path: String,
    upstream_model: String,
    pricing: Pricing,
}

async fn load_models(pool: &PgPool) -> Result<Vec<Value>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        select model_id, label, provider, mode, enabled
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
        select provider, base_url, endpoint_path, upstream_model, input_yuan_per_million,
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
        pricing,
    })
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

async fn ensure_gateway_run_available(pool: &PgPool, claims: &RunTokenClaims) -> ApiResult<()> {
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

async fn start_gateway_request(
    pool: &PgPool,
    claims: &RunTokenClaims,
    gateway_request_id: &str,
) -> ApiResult<Decimal> {
    let row = sqlx::query(
        r#"
        update model_runs r
        set status = 'running',
            started_at = coalesce(r.started_at, now()),
            active_request_id = $7,
            request_count = r.request_count + 1,
            last_activity_at = now()
        from tenants t, devices d
        where r.id = $1 and r.tenant_id = $2 and r.user_id = $3
          and r.device_id = $4 and r.model_id = $5
          and r.budget_yuan = $6
          and r.status in ('created', 'running')
          and r.active_request_id is null
          and r.accumulated_billable_yuan < r.budget_yuan
          and t.id = r.tenant_id and t.status = 'active' and t.balance_yuan > 0
          and d.id = r.device_id and d.tenant_id = r.tenant_id
          and d.status = 'active' and d.lease_expires_at > now()
        returning r.budget_yuan - r.accumulated_billable_yuan as remaining_budget_yuan
        "#,
    )
    .bind(&claims.run_id)
    .bind(&claims.tenant_id)
    .bind(&claims.user_id)
    .bind(&claims.device_id)
    .bind(&claims.model_id)
    .bind(claims.budget_yuan)
    .bind(gateway_request_id)
    .fetch_optional(pool)
    .await?;
    row.map(|row| row.get::<Decimal, _>("remaining_budget_yuan"))
        .ok_or_else(|| {
            ApiError::TooManyRequests(
                "this task already has an in-flight model request or its budget is exhausted"
                    .to_string(),
            )
        })
}

async fn release_gateway_request(
    pool: &PgPool,
    claims: &RunTokenClaims,
    gateway_request_id: &str,
    upstream_status: Option<u16>,
) -> ApiResult<()> {
    let released = sqlx::query(
        r#"
        update model_runs
        set active_request_id = null,
            last_activity_at = now(),
            upstream_status = coalesce($8, upstream_status)
        where id = $1 and tenant_id = $2 and user_id = $3 and device_id = $4
          and model_id = $5 and budget_yuan = $6 and active_request_id = $7
          and status = 'running'
        "#,
    )
    .bind(&claims.run_id)
    .bind(&claims.tenant_id)
    .bind(&claims.user_id)
    .bind(&claims.device_id)
    .bind(&claims.model_id)
    .bind(claims.budget_yuan)
    .bind(gateway_request_id)
    .bind(upstream_status.map(i32::from))
    .execute(pool)
    .await?;
    if released.rows_affected() == 1 {
        Ok(())
    } else {
        Err(ApiError::Unauthorized(
            "run token does not own the active model request".to_string(),
        ))
    }
}

fn validate_run_claim_bindings(
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
        None => 1_000_000,
    };
    let request_bytes = serde_json::to_vec(body)
        .map_err(|_| ApiError::BadRequest("request body cannot be metered".to_string()))?
        .len()
        .saturating_add(1_024) as u64;
    let charge_for = |output_tokens| {
        settle_usage_yuan(
            &GatewayUsage {
                input_tokens: request_bytes,
                output_tokens,
                reasoning_tokens: output_tokens,
                cached_tokens: request_bytes,
            },
            pricing,
        )
        .billable_yuan
    };
    if charge_for(0) > budget_yuan {
        return Err(ApiError::Forbidden(
            "per-run safety limit is too small for the request input".to_string(),
        ));
    }
    let mut low = 0_u64;
    let mut high = 1_000_000_u64;
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
    if run
        .try_get::<Option<String>, _>("active_request_id")?
        .as_deref()
        != Some(gateway_request_id)
    {
        return Err(ApiError::Forbidden(
            "model request lease does not match this settlement".to_string(),
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
    sqlx::query(
        r#"
        update model_runs
        set accumulated_billable_yuan = $2,
            active_request_id = null,
            last_activity_at = now(),
            upstream_status = $3
        where id = $1 and active_request_id = $4
        "#,
    )
    .bind(&claims.run_id)
    .bind(accumulated_billable_yuan)
    .bind(upstream_status as i32)
    .bind(gateway_request_id)
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

async fn usage_totals_since(
    pool: &PgPool,
    tenant_id: &str,
    since: chrono::DateTime<Utc>,
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
        where tenant_id = $1 and created_at >= $2
        "#,
    )
    .bind(tenant_id)
    .bind(since)
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

async fn model_usage_since(
    pool: &PgPool,
    tenant_id: &str,
    since: chrono::DateTime<Utc>,
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
        where u.tenant_id = $1 and u.created_at >= $2
        group by u.model_id, coalesce(m.label, u.model_id), coalesce(m.provider, '')
        order by coalesce(sum(u.billable_yuan), 0) desc, max(u.created_at) desc
        limit 8
        "#,
    )
    .bind(tenant_id)
    .bind(since)
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
) -> ApiResult<BillingLedgerPage> {
    let total = sqlx::query_scalar::<_, i64>(
        "select count(*)::bigint from billing_ledger where tenant_id = $1",
    )
    .bind(tenant_id)
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
        select id, run_id, entry_type, amount_yuan, description, created_at
        from billing_ledger
        where tenant_id = $1
        order by created_at desc, id desc
        limit $2 offset $3
        "#,
    )
    .bind(tenant_id)
    .bind(page_size)
    .bind(offset)
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
                "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at")
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
mod tests {
    use std::{convert::Infallible, time::Duration};

    use axum::{
        body::{Body, Bytes},
        response::Response,
        routing::get,
        Router,
    };
    use chrono::Utc;
    use futures_util::StreamExt;
    use rust_decimal::Decimal;
    use serde_json::json;
    use sqlx::{postgres::PgPoolOptions, Row};

    use super::{
        bounded_pagination, enforce_request_budget, ensure_gateway_run_available,
        looks_like_secret_field, normalized_codex_tenant_ids, resolve_usage_charge,
        settle_and_record_usage, start_gateway_request, stream_upstream_response,
        validate_client_agreement_acceptance, validate_offline_payment_request,
        ClientAgreementAcceptance, MeteringStatus, OfflinePaymentRequest, GATEWAY_RUN_TTL_SECONDS,
    };
    use crate::{
        billing::{GatewayUsage, Pricing},
        gateway::{UpstreamRequest, UpstreamResponseFormat},
        tokens::RunTokenClaims,
    };

    #[test]
    fn bounds_billing_ledger_pagination() {
        assert_eq!(bounded_pagination(None, None, 8), (1, 8));
        assert_eq!(bounded_pagination(Some(0), Some(0), 8), (1, 1));
        assert_eq!(bounded_pagination(Some(4), Some(500), 8), (4, 100));
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
        let pricing = Pricing {
            input_yuan_per_million: Decimal::from(10_u64),
            output_yuan_per_million: Decimal::from(100_u64),
            reasoning_yuan_per_million: Decimal::from(100_u64),
            cached_input_yuan_per_million: Decimal::from(2_u64),
            markup_bps: 2_500,
        };

        enforce_request_budget(&mut body, Decimal::ONE, &pricing).unwrap();

        let capped = body["max_output_tokens"].as_u64().unwrap();
        assert!(capped > 0);
        assert!(capped < 1_000_000);
    }

    #[test]
    fn rejects_a_budget_that_cannot_cover_the_request_input() {
        let mut body = json!({ "input": "x".repeat(50_000) });
        let pricing = Pricing {
            input_yuan_per_million: Decimal::from(100_u64),
            output_yuan_per_million: Decimal::from(100_u64),
            reasoning_yuan_per_million: Decimal::from(100_u64),
            cached_input_yuan_per_million: Decimal::from(100_u64),
            markup_bps: 0,
        };

        assert!(enforce_request_budget(&mut body, Decimal::new(1, 2), &pricing).is_err());
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
            let remaining = start_gateway_request(&pool, &claims, request_id)
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
        assert_eq!(run.get::<i64, _>("request_count"), 2);
        assert!(run.get::<Decimal, _>("accumulated_billable_yuan") > Decimal::ZERO);
        let settlement_count = sqlx::query_scalar::<_, i64>(
            "select count(*)::bigint from usage_events where run_id = $1",
        )
        .bind(&run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(settlement_count, 2);

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

        server.abort();
    }
}
