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
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    billing::{settle_usage_yuan, usage_from_openai_response, GatewayUsage, Pricing},
    error::{ApiError, ApiResult},
    gateway::{
        build_model_discovery_request, build_upstream_request, discover_models_from_body,
        mask_secret, normalize_upstream_error_body, normalize_upstream_success_body_for_request,
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
    state::AppState,
    tokens::{AdminTokenClaims, DeviceTokenClaims, RunTokenClaims},
};

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
    if !constant_time_eq(
        request.email.as_bytes(),
        state.config.admin_email.as_bytes(),
    ) || !constant_time_eq(
        request.password.as_bytes(),
        state.config.admin_password.as_bytes(),
    ) {
        return Err(ApiError::Unauthorized(
            "invalid admin credentials".to_string(),
        ));
    }
    let token = state
        .admin_tokens
        .issue(AdminTokenClaims::new(request.email.clone(), 8 * 60 * 60))?;
    Ok(Json(LoginResponse {
        token,
        user: AdminUser {
            email: request.email,
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
            "balanceYuan": tenant_row.get::<f64, _>("balance_yuan"),
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
pub struct RunCreateRequest {
    tenant_id: String,
    user_id: String,
    device_id: String,
    model_id: String,
    #[serde(default = "default_budget_yuan")]
    budget_yuan: f64,
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
    validate_run_budget(request.budget_yuan)?;
    let route = load_model_route(
        &state.db,
        &request.model_id,
        state.config.min_gateway_markup_bps,
    )
    .await?;
    load_provider_config(&state.db, &route).await?;
    let run_id = format!("run_{}", Uuid::new_v4().simple());
    reserve_run_budget(&state.db, &run_id, &request).await?;
    let token = state.run_tokens.issue(RunTokenClaims::new(
        request.tenant_id,
        request.user_id,
        request.device_id,
        run_id.clone(),
        request.model_id,
        request.budget_yuan,
        20 * 60,
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
    let usage = scalar_f64(
        &state.db,
        "select coalesce(sum(billable_yuan), 0)::double precision from usage_events",
    )
    .await?;
    let configured_providers = scalar_count(
        &state.db,
        "select count(*) from provider_configs where enabled = true and (api_key <> '' or auth_type = 'none')",
    )
    .await?;
    Ok(Json(json!({
        "tenants": tenants,
        "activeDevices": devices,
        "runs": runs,
        "billableYuan": usage,
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
          (select coalesce(sum(u.billable_yuan), 0)::double precision from usage_events u where u.tenant_id = t.id) as billable_yuan
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

    Ok(Json(json!({
        "tenant": {
            "id": tenant.get::<String, _>("id"),
            "name": tenant.get::<String, _>("name"),
            "status": tenant.get::<String, _>("status"),
            "billingMode": tenant.get::<String, _>("billing_mode"),
            "balanceYuan": tenant.get::<f64, _>("balance_yuan"),
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
            "ledgerPagination": ledger_pagination
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
    #[serde(default)]
    balance_yuan: f64,
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
          balance_yuan = excluded.balance_yuan,
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
    .bind(request.balance_yuan)
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
        select provider, label, base_url, endpoint_path, api_key, api_format, auth_type,
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
            let api_key = row.get::<String, _>("api_key");
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
                "keyConfigured": !api_key.trim().is_empty(),
                "keyMask": if api_key.trim().is_empty() { Value::Null } else { Value::String(mask_secret(&api_key)) },
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
    sqlx::query(
        r#"
        insert into provider_configs (
          provider, label, base_url, endpoint_path, api_key, api_format, auth_type,
          auth_header, custom_headers, query_params, request_timeout_ms, max_retries,
          enabled, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
        on conflict (provider) do update set
          label = excluded.label,
          base_url = excluded.base_url,
          endpoint_path = excluded.endpoint_path,
          api_key = case when excluded.api_key = '' then provider_configs.api_key else excluded.api_key end,
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
    .bind(api_key.trim())
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
        sqlx::query_scalar::<_, String>("select api_key from provider_configs where provider = $1")
            .bind(&provider_id)
            .fetch_optional(&state.db)
            .await?
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
          coalesce((p.api_key <> '' or p.auth_type = 'none') and p.enabled = true, false) as provider_ready,
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
    #[serde(default)]
    input_yuan_per_million: f64,
    #[serde(default)]
    output_yuan_per_million: f64,
    #[serde(default)]
    reasoning_yuan_per_million: f64,
    #[serde(default)]
    cached_input_yuan_per_million: f64,
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
    let mut transaction = state.db.begin().await?;
    sqlx::query(
        r#"
        insert into codex_accounts (
          id, tenant_id, email, login_secret, login_hint, plan, status, seat_limit,
          expires_at, assigned_at, updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, case when $2::text is null then null else now() end, now())
        on conflict (id) do update set
          tenant_id = excluded.tenant_id,
          email = excluded.email,
          login_secret = case when excluded.login_secret = '' then codex_accounts.login_secret else excluded.login_secret end,
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
    .bind(login_secret.trim())
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
pub struct ClientActivateRequest {
    company_name: String,
    authorization_code: String,
    fingerprint: String,
    device_name: String,
    #[serde(default = "default_client_email")]
    user_email: String,
    #[serde(default = "default_client_name")]
    user_name: String,
}

pub async fn client_activate(
    State(state): State<AppState>,
    Json(request): Json<ClientActivateRequest>,
) -> ApiResult<Json<Value>> {
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
    sqlx::query("update authorization_codes set last_used_at = now() where id = $1")
        .bind(row.get::<String, _>("authorization_id"))
        .execute(&state.db)
        .await?;
    write_audit(
        &state.db,
        &tenant_id,
        "client.activate",
        json!({ "companyName": request.company_name, "deviceName": request.device_name }),
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
    let provider = load_provider_config(&state.db, &route).await?;
    enforce_request_budget(&mut body, claims.budget_yuan, &route.pricing)?;
    let original_body = body.clone();
    let upstream_request = build_upstream_request(&provider, &route.upstream_model, &mut body)
        .map_err(ApiError::BadRequest)?;

    let started = Utc::now();
    start_gateway_run(&state.db, &claims).await?;

    let upstream =
        match send_upstream_post(&state.http, &upstream_request, &body, &claims.run_id).await {
            Ok(response) => response,
            Err(error) => {
                if error.may_have_incurred_cost {
                    settle_and_record_usage(
                        &state.db,
                        &claims,
                        &route.pricing,
                        &GatewayUsage::default(),
                        0,
                        started,
                        MeteringStatus::BudgetFallback("ambiguous upstream transport failure"),
                    )
                    .await?;
                } else {
                    fail_run_and_release_reservation(&state.db, &claims, None).await?;
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
            route.pricing,
            started,
        ));
    }
    let text = upstream.text().await?;
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
                    &route.pricing,
                    &GatewayUsage::default(),
                    status.as_u16(),
                    started,
                    MeteringStatus::BudgetFallback(
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
                &route.pricing,
                &GatewayUsage::default(),
                status.as_u16(),
                started,
                MeteringStatus::BudgetFallback(
                    "upstream may have incurred inference cost before returning an error",
                ),
            )
            .await?;
        } else {
            fail_run_and_release_reservation(&state.db, &claims, Some(status.as_u16())).await?;
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
                                match inspect_responses_stream_data(&data) {
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
                        match adapter.ingest(&data) {
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
        // Close the client response before the database update below. Billing and
        // failure recording continue in this task without extending the SSE lifetime.
        drop(sender);

        if !failed {
            if let Err(error) = settle_and_record_usage(
                &pool,
                &claims,
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
                &pricing,
                &usage,
                upstream_status,
                started,
                MeteringStatus::BudgetFallback("upstream stream failed after dispatch"),
            )
            .await
            {
                tracing::error!(run_id = %claims.run_id, %error, "failed to settle failed streamed model usage");
            }
            if let Some(message) = failure_message {
                tracing::warn!(run_id = %claims.run_id, %message, "upstream model stream failed");
            }
        }
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

async fn load_provider_config(pool: &PgPool, route: &ModelRoute) -> ApiResult<ProviderConfig> {
    let row = sqlx::query(
        r#"
        select provider, base_url, endpoint_path, api_key, api_format, auth_type,
          auth_header, custom_headers, query_params, request_timeout_ms, max_retries
        from provider_configs
        where provider = $1 and enabled = true and (api_key <> '' or auth_type = 'none')
        "#,
    )
    .bind(&route.provider)
    .fetch_optional(pool)
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
        api_key: row.get("api_key"),
        api_format: ProviderApiFormat::parse(&row.get::<String, _>("api_format")),
        auth_type: ProviderAuthType::parse(&row.get::<String, _>("auth_type")),
        auth_header: row.get("auth_header"),
        custom_headers: json_value_to_string_map(row.get("custom_headers")),
        query_params: json_value_to_string_map(row.get("query_params")),
        request_timeout_ms: row.get::<i32, _>("request_timeout_ms").max(1_000) as u64,
        max_retries: row.get::<i32, _>("max_retries").max(0) as u32,
    })
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
        join tenants t on t.id = r.tenant_id and t.status = 'active'
        join devices d on d.id = r.device_id and d.tenant_id = r.tenant_id
          and d.status = 'active' and d.lease_expires_at > now()
        where r.id = $1
          and (r.status = 'running' or (r.status = 'created' and r.created_at > now() - interval '20 minutes'))
        "#,
    )
    .bind(&claims.run_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| ApiError::Unauthorized("run token is invalid, expired, or already used".to_string()))?;
    validate_run_claim_bindings(&row, claims)
}

async fn start_gateway_run(pool: &PgPool, claims: &RunTokenClaims) -> ApiResult<()> {
    let row = sqlx::query(
        r#"
        update model_runs r
        set status = 'running', started_at = now()
        from tenants t, devices d
        where r.id = $1 and r.tenant_id = $2 and r.user_id = $3
          and r.device_id = $4 and r.model_id = $5
          and abs(r.budget_yuan - $6) < 0.0000001
          and r.status = 'created' and r.created_at > now() - interval '20 minutes'
          and t.id = r.tenant_id and t.status = 'active'
          and d.id = r.device_id and d.tenant_id = r.tenant_id
          and d.status = 'active' and d.lease_expires_at > now()
        returning r.id
        "#,
    )
    .bind(&claims.run_id)
    .bind(&claims.tenant_id)
    .bind(&claims.user_id)
    .bind(&claims.device_id)
    .bind(&claims.model_id)
    .bind(claims.budget_yuan)
    .fetch_optional(pool)
    .await?;
    if row.is_some() {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "run token has expired or has already been consumed".to_string(),
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
        && (row.get::<f64, _>("budget_yuan") - claims.budget_yuan).abs() < 0.0000001;
    if matches {
        Ok(())
    } else {
        Err(ApiError::Unauthorized(
            "run token claims do not match the persisted run".to_string(),
        ))
    }
}

fn enforce_request_budget(body: &mut Value, budget_yuan: f64, pricing: &Pricing) -> ApiResult<()> {
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
            "run budget is too small for the request input".to_string(),
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
            "run budget cannot fund even one output token".to_string(),
        ));
    }
    let safe_max = requested_max.min(low);
    body.as_object_mut()
        .ok_or_else(|| ApiError::BadRequest("request body must be a JSON object".to_string()))?
        .insert("max_output_tokens".to_string(), json!(safe_max));
    Ok(())
}

async fn fail_run_and_release_reservation(
    pool: &PgPool,
    claims: &RunTokenClaims,
    upstream_status: Option<u16>,
) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    let run = sqlx::query(
        r#"
        select tenant_id, user_id, device_id, model_id, status, budget_yuan
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
    let status = run.get::<String, _>("status");
    if matches!(status.as_str(), "completed" | "failed" | "expired") {
        tx.rollback().await?;
        return Ok(());
    }
    let release = sqlx::query(
        r#"
        insert into billing_ledger
          (id, tenant_id, run_id, entry_type, amount_yuan, description, operation_key)
        select $1, $2, $3, 'reservation_release', $4, $5, $6
        where exists (select 1 from billing_ledger where operation_key = $7)
        on conflict (operation_key) where operation_key is not null do nothing
        "#,
    )
    .bind(format!("ledger_{}", Uuid::new_v4().simple()))
    .bind(&claims.tenant_id)
    .bind(&claims.run_id)
    .bind(claims.budget_yuan)
    .bind(format!(
        "{} run failed before billable completion",
        claims.model_id
    ))
    .bind(format!("release:{}", claims.run_id))
    .bind(format!("reservation:{}", claims.run_id))
    .execute(&mut *tx)
    .await?;
    if release.rows_affected() == 1 {
        sqlx::query(
            "update tenants set balance_yuan = round((balance_yuan + $2)::numeric, 6)::double precision, updated_at = now() where id = $1",
        )
        .bind(&claims.tenant_id)
        .bind(claims.budget_yuan)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "update model_runs set status = 'failed', completed_at = now(), upstream_status = $2 where id = $1",
    )
    .bind(&claims.run_id)
    .bind(upstream_status.map(i32::from))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn validate_run_budget(budget_yuan: f64) -> ApiResult<()> {
    if !budget_yuan.is_finite() || !(0.01..=10_000.0).contains(&budget_yuan) {
        return Err(ApiError::BadRequest(
            "budgetYuan must be a finite amount between 0.01 and 10000".to_string(),
        ));
    }
    Ok(())
}

async fn reserve_run_budget(
    pool: &PgPool,
    run_id: &str,
    request: &RunCreateRequest,
) -> ApiResult<()> {
    release_expired_run_reservations(pool, &request.tenant_id).await?;
    let mut tx = pool.begin().await?;
    let reserved = sqlx::query(
        r#"
        update tenants
        set balance_yuan = round((balance_yuan - $2)::numeric, 6)::double precision, updated_at = now()
        where id = $1 and status = 'active' and balance_yuan >= $2
        returning balance_yuan
        "#,
    )
    .bind(&request.tenant_id)
    .bind(request.budget_yuan)
    .fetch_optional(&mut *tx)
    .await?;
    if reserved.is_none() {
        return Err(ApiError::Forbidden(
            "prepaid balance is insufficient for this run budget".to_string(),
        ));
    }
    sqlx::query(
        r#"
        insert into model_runs (id, tenant_id, user_id, device_id, model_id, mode, status, budget_yuan)
        values ($1, $2, $3, $4, $5, 'gateway_api', 'created', $6)
        "#,
    )
    .bind(run_id)
    .bind(&request.tenant_id)
    .bind(&request.user_id)
    .bind(&request.device_id)
    .bind(&request.model_id)
    .bind(request.budget_yuan)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        r#"
        insert into billing_ledger
          (id, tenant_id, run_id, entry_type, amount_yuan, description, operation_key)
        values ($1, $2, $3, 'usage_reservation', $4, $5, $6)
        "#,
    )
    .bind(format!("ledger_{}", Uuid::new_v4().simple()))
    .bind(&request.tenant_id)
    .bind(run_id)
    .bind(-request.budget_yuan)
    .bind(format!("{} run budget reservation", request.model_id))
    .bind(format!("reservation:{run_id}"))
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
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
        where r.tenant_id = $1 and r.status = 'created'
          and r.created_at <= now() - interval '20 minutes'
        for update
        "#,
    )
    .bind(tenant_id)
    .fetch_all(&mut *tx)
    .await?;
    for row in expired {
        let run_id = row.get::<String, _>("id");
        let budget_yuan = row.get::<f64, _>("budget_yuan");
        let had_reservation = sqlx::query("select 1 from billing_ledger where operation_key = $1")
            .bind(format!("reservation:{run_id}"))
            .fetch_optional(&mut *tx)
            .await?
            .is_some();
        sqlx::query(
            "update model_runs set status = 'expired', completed_at = now() where id = $1 and status = 'created'",
        )
        .bind(&run_id)
        .execute(&mut *tx)
        .await?;
        if had_reservation {
            sqlx::query(
                "update tenants set balance_yuan = round((balance_yuan + $2)::numeric, 6)::double precision, updated_at = now() where id = $1",
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
    BudgetFallback(&'a str),
}

impl<'a> MeteringStatus<'a> {
    fn from_usage(usage: &GatewayUsage, fallback_reason: &'a str) -> Self {
        if usage.is_empty() {
            Self::BudgetFallback(fallback_reason)
        } else {
            Self::Reported
        }
    }
}

async fn settle_and_record_usage(
    pool: &PgPool,
    claims: &RunTokenClaims,
    pricing: &Pricing,
    usage: &GatewayUsage,
    upstream_status: u16,
    started: chrono::DateTime<Utc>,
    metering_status: MeteringStatus<'_>,
) -> ApiResult<()> {
    let measured_charge = settle_usage_yuan(usage, pricing);
    let (cost_yuan, billable_yuan, metering_label, billing_note) = match metering_status {
        MeteringStatus::Reported => (
            measured_charge.cost_yuan,
            measured_charge.billable_yuan,
            "reported",
            "",
        ),
        MeteringStatus::BudgetFallback(reason) => {
            let multiplier = (10_000_u64.saturating_add(pricing.markup_bps)) as f64 / 10_000.0;
            let estimated_cost = if multiplier.is_finite() && multiplier > 0.0 {
                claims.budget_yuan / multiplier
            } else {
                claims.budget_yuan
            };
            (
                measured_charge.cost_yuan.max(estimated_cost),
                claims.budget_yuan,
                "budget_fallback",
                reason,
            )
        }
    };
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
        select tenant_id, user_id, device_id, model_id, status, budget_yuan
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
    if run.get::<String, _>("status") == "completed" {
        tx.rollback().await?;
        return Ok(());
    }
    if run.get::<String, _>("status") != "running" {
        return Err(ApiError::Forbidden(
            "run is not in a billable state".to_string(),
        ));
    }
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
    .bind(format!("settlement:{}", claims.run_id))
    .bind(metering_label)
    .bind(billing_note)
    .execute(&mut *tx)
    .await?;
    let had_reservation = sqlx::query("select 1 from billing_ledger where operation_key = $1")
        .bind(format!("reservation:{}", claims.run_id))
        .fetch_optional(&mut *tx)
        .await?
        .is_some();
    if had_reservation {
        let balance_adjustment = claims.budget_yuan - billable_yuan;
        if balance_adjustment != 0.0 {
            sqlx::query(
                "update tenants set balance_yuan = round((balance_yuan + $2)::numeric, 6)::double precision, status = case when round((balance_yuan + $2)::numeric, 6) < 0 then 'suspended' else status end, updated_at = now() where id = $1",
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
            .bind(if balance_adjustment > 0.0 {
                "usage_refund"
            } else {
                "usage_overage"
            })
            .bind(balance_adjustment)
            .bind(format!(
                "{} run budget settlement adjustment",
                claims.model_id
            ))
            .bind(format!("adjustment:{}", claims.run_id))
            .execute(&mut *tx)
            .await?;
        }
    } else {
        sqlx::query(
            "update tenants set balance_yuan = round((balance_yuan - $2)::numeric, 6)::double precision, updated_at = now() where id = $1",
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
        .bind(format!("{} usage charge", claims.model_id))
        .bind(format!("charge:{}", claims.run_id))
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query(
        "update model_runs set status = 'completed', completed_at = now(), upstream_status = $2 where id = $1",
    )
    .bind(&claims.run_id)
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
        "balanceYuan": row.get::<f64, _>("balance_yuan"),
        "subscriptionPlan": row.try_get::<Option<String>, _>("subscription_plan").unwrap_or(None),
        "subscriptionExpiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("subscription_expires_at").unwrap_or(None),
        "codexSubscriptionEnabled": row.get::<bool, _>("codex_subscription_enabled"),
        "codexSubscriptionPlan": row.try_get::<Option<String>, _>("codex_subscription_plan").unwrap_or(None),
        "codexSubscriptionExpiresAt": row.try_get::<Option<chrono::DateTime<Utc>>, _>("codex_subscription_expires_at").unwrap_or(None),
        "activeDevices": row.get::<i64, _>("active_devices"),
        "billableYuan": row.get::<f64, _>("billable_yuan"),
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
        "inputYuanPerMillion": row.get::<f64, _>("input_yuan_per_million"),
        "outputYuanPerMillion": row.get::<f64, _>("output_yuan_per_million"),
        "reasoningYuanPerMillion": row.get::<f64, _>("reasoning_yuan_per_million"),
        "cachedInputYuanPerMillion": row.get::<f64, _>("cached_input_yuan_per_million"),
        "markupBps": row.get::<i64, _>("markup_bps"),
        "providerReady": row.get::<bool, _>("provider_ready"),
        "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at"),
        "updatedAt": row.get::<chrono::DateTime<Utc>, _>("updated_at")
    })
}

fn codex_account_json(row: sqlx::postgres::PgRow) -> Value {
    let login_secret = row.get::<String, _>("login_secret");
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
        "loginSecretConfigured": !login_secret.trim().is_empty(),
        "loginSecretMask": if login_secret.trim().is_empty() { Value::Null } else { Value::String(mask_secret(&login_secret)) },
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
          coalesce(sum(cost_yuan), 0)::double precision as cost_yuan,
          coalesce(sum(billable_yuan), 0)::double precision as billable_yuan,
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
          coalesce(sum(cost_yuan), 0)::double precision as cost_yuan,
          coalesce(sum(billable_yuan), 0)::double precision as billable_yuan,
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
          coalesce(sum(u.cost_yuan), 0)::double precision as cost_yuan,
          coalesce(sum(u.billable_yuan), 0)::double precision as billable_yuan,
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
                "amountYuan": row.get::<f64, _>("amount_yuan"),
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
        "costYuan": row.get::<f64, _>("cost_yuan"),
        "billableYuan": row.get::<f64, _>("billable_yuan"),
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

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let max_len = left.len().max(right.len());
    let mut difference = left.len() ^ right.len();
    for index in 0..max_len {
        difference |= usize::from(
            left.get(index).copied().unwrap_or_default()
                ^ right.get(index).copied().unwrap_or_default(),
        );
    }
    difference == 0
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

async fn scalar_f64(pool: &PgPool, sql: &str) -> Result<f64, sqlx::Error> {
    let row = sqlx::query(sql).fetch_one(pool).await?;
    row.try_get::<f64, _>(0)
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

fn default_budget_yuan() -> f64 {
    5.0
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
    if !request.balance_yuan.is_finite() || request.balance_yuan < 0.0 {
        return Err(ApiError::BadRequest(
            "balanceYuan must be a finite non-negative amount".to_string(),
        ));
    }
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
        .any(|price| !price.is_finite() || price < 0.0)
    {
        return Err(ApiError::BadRequest(
            "model prices must be finite non-negative amounts".to_string(),
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
        && (request.input_yuan_per_million <= 0.0 || request.output_yuan_per_million <= 0.0)
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
    }
    Ok(())
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
    use serde_json::json;
    use sqlx::postgres::PgPoolOptions;

    use super::{
        bounded_pagination, enforce_request_budget, normalized_codex_tenant_ids,
        stream_upstream_response,
    };
    use crate::{
        billing::Pricing,
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
    fn caps_output_tokens_to_the_preauthorized_budget() {
        let mut body = json!({
            "input": "hello",
            "max_output_tokens": 1_000_000
        });
        let pricing = Pricing {
            input_yuan_per_million: 10.0,
            output_yuan_per_million: 100.0,
            reasoning_yuan_per_million: 100.0,
            cached_input_yuan_per_million: 2.0,
            markup_bps: 2_500,
        };

        enforce_request_budget(&mut body, 1.0, &pricing).unwrap();

        let capped = body["max_output_tokens"].as_u64().unwrap();
        assert!(capped > 0);
        assert!(capped < 1_000_000);
    }

    #[test]
    fn rejects_a_budget_that_cannot_cover_the_request_input() {
        let mut body = json!({ "input": "x".repeat(50_000) });
        let pricing = Pricing {
            input_yuan_per_million: 100.0,
            output_yuan_per_million: 100.0,
            reasoning_yuan_per_million: 100.0,
            cached_input_yuan_per_million: 100.0,
            markup_bps: 0,
        };

        assert!(enforce_request_budget(&mut body, 0.01, &pricing).is_err());
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
                1.0,
                60,
            ),
            Pricing {
                input_yuan_per_million: 0.0,
                output_yuan_per_million: 0.0,
                reasoning_yuan_per_million: 0.0,
                cached_input_yuan_per_million: 0.0,
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
