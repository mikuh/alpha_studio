use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use chrono::{Datelike, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

use crate::{
    billing::{settle_usage_yuan, usage_from_openai_response, GatewayUsage, Pricing},
    error::{ApiError, ApiResult},
    gateway::{
        build_upstream_request, mask_secret, normalize_upstream_success_body, ProviderConfig,
    },
    license::{
        can_activate_device, codex_subscription_available, normalize_authorization_code,
        normalize_company_name, CLIENT_DEVICE_LEASE_DAYS,
    },
    state::AppState,
    tokens::RunTokenClaims,
};

pub async fn healthz() -> Json<Value> {
    Json(json!({ "status": "ok" }))
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
    if request.email != state.config.admin_email || request.password != state.config.admin_password
    {
        return Err(ApiError::Unauthorized(
            "invalid admin credentials".to_string(),
        ));
    }
    Ok(Json(LoginResponse {
        token: format!("admin-{}", Uuid::new_v4()),
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
pub struct DeviceActivateRequest {
    tenant_id: String,
    user_id: String,
    fingerprint: String,
    name: String,
}

pub async fn device_activate(
    State(state): State<AppState>,
    Json(request): Json<DeviceActivateRequest>,
) -> ApiResult<Json<Value>> {
    ensure_tenant_capacity(&state.db, &request.tenant_id, &request.fingerprint).await?;
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
    .bind(&request.tenant_id)
    .bind(&request.user_id)
    .bind(&request.fingerprint)
    .bind(&request.name)
    .bind(CLIENT_DEVICE_LEASE_DAYS)
    .fetch_one(&state.db)
    .await?;
    write_audit(
        &state.db,
        &request.tenant_id,
        "device.activate",
        json!({ "fingerprint": request.fingerprint, "name": request.name }),
    )
    .await?;
    Ok(Json(json!({
        "deviceId": row.get::<String, _>("id"),
        "leaseExpiresAt": row.get::<chrono::DateTime<Utc>, _>("lease_expires_at")
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
    Json(request): Json<DeviceLeaseRequest>,
) -> ApiResult<Json<Value>> {
    let row = sqlx::query(
        r#"
        update devices d
        set lease_expires_at = now() + make_interval(days => $3), last_seen_at = now()
        from tenants t
        where d.tenant_id = $1 and d.id = $2 and d.status = 'active'
          and t.id = d.tenant_id and t.status = 'active'
        returning d.lease_expires_at
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
    Ok(Json(json!({
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
    fingerprint: String,
}

pub async fn client_devices(
    State(state): State<AppState>,
    Json(request): Json<ClientDevicesRequest>,
) -> ApiResult<Json<Value>> {
    ensure_device_identity(
        &state.db,
        &request.tenant_id,
        &request.device_id,
        &request.fingerprint,
    )
    .await?;
    Ok(Json(
        client_device_summary(&state.db, &request.tenant_id, &request.device_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCodexAuthorizationRequest {
    tenant_id: String,
    device_id: String,
    fingerprint: String,
    email: String,
}

pub async fn client_codex_authorization(
    State(state): State<AppState>,
    Json(request): Json<ClientCodexAuthorizationRequest>,
) -> ApiResult<Json<Value>> {
    ensure_device_identity(
        &state.db,
        &request.tenant_id,
        &request.device_id,
        &request.fingerprint,
    )
    .await?;
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
    fingerprint: String,
    target_device_id: String,
}

pub async fn client_revoke_device(
    State(state): State<AppState>,
    Json(request): Json<ClientRevokeDeviceRequest>,
) -> ApiResult<Json<Value>> {
    ensure_device_identity(
        &state.db,
        &request.tenant_id,
        &request.device_id,
        &request.fingerprint,
    )
    .await?;
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
}

pub async fn client_billing_summary(
    State(state): State<AppState>,
    Json(request): Json<ClientBillingSummaryRequest>,
) -> ApiResult<Json<Value>> {
    ensure_device_lease(&state.db, &request.tenant_id, &request.device_id).await?;
    let now = Utc::now();
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
    let recent_ledger = recent_billing_ledger(&state.db, &request.tenant_id).await?;

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
            "recentLedger": recent_ledger
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
    Json(request): Json<RunCreateRequest>,
) -> ApiResult<Json<Value>> {
    ensure_device_lease(&state.db, &request.tenant_id, &request.device_id).await?;
    ensure_model_enabled(&state.db, &request.model_id).await?;
    ensure_balance(&state.db, &request.tenant_id, request.budget_yuan).await?;
    let run_id = format!("run_{}", Uuid::new_v4().simple());
    sqlx::query(
        r#"
        insert into model_runs (id, tenant_id, user_id, device_id, model_id, mode, status, budget_yuan)
        values ($1, $2, $3, $4, $5, 'gateway_api', 'created', $6)
        "#,
    )
    .bind(&run_id)
    .bind(&request.tenant_id)
    .bind(&request.user_id)
    .bind(&request.device_id)
    .bind(&request.model_id)
    .bind(request.budget_yuan)
    .execute(&state.db)
    .await?;
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
    require_admin(&headers)?;
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
        "select count(*) from provider_configs where enabled = true and api_key <> ''",
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
    require_admin(&headers)?;
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
    require_admin(&headers)?;
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
    require_admin(&headers)?;
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
    require_admin(&headers)?;
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
    require_admin(&headers)?;
    let rows = sqlx::query(
        r#"
        select a.id, a.tenant_id, t.name as tenant_name, a.code_hint, a.code_plaintext,
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
            "authorizationCode": row.try_get::<Option<String>, _>("code_plaintext").unwrap_or(None),
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
    require_admin(&headers)?;
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

pub async fn admin_delete_authorization_code(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&headers)?;
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
    require_admin(&headers)?;
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
    let id = format!("auth_{}", Uuid::new_v4().simple());
    sqlx::query(
        r#"
        insert into authorization_codes
          (id, tenant_id, code_hash, code_hint, code_plaintext, max_devices, expires_at, note)
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(&id)
    .bind(&request.tenant_id)
    .bind(code_hash)
    .bind(&code_hint)
    .bind(&normalized)
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
    require_admin(&headers)?;
    let rows = sqlx::query(
        r#"
        select provider, label, base_url, endpoint_path, api_key, enabled, updated_at
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
    enabled: bool,
}

pub async fn admin_save_provider_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<ProviderConfigSaveRequest>,
) -> ApiResult<Json<Value>> {
    require_admin(&headers)?;
    let provider = request.provider.trim().to_lowercase();
    if provider.is_empty() || request.base_url.trim().is_empty() {
        return Err(ApiError::BadRequest(
            "provider and baseUrl are required".to_string(),
        ));
    }
    let api_key = request.api_key.unwrap_or_default();
    sqlx::query(
        r#"
        insert into provider_configs (provider, label, base_url, endpoint_path, api_key, enabled, updated_at)
        values ($1, $2, $3, $4, $5, $6, now())
        on conflict (provider) do update set
          label = excluded.label,
          base_url = excluded.base_url,
          endpoint_path = excluded.endpoint_path,
          api_key = case when excluded.api_key = '' then provider_configs.api_key else excluded.api_key end,
          enabled = excluded.enabled,
          updated_at = now()
        "#,
    )
    .bind(&provider)
    .bind(&request.label)
    .bind(request.base_url.trim())
    .bind(request.endpoint_path.trim())
    .bind(api_key.trim())
    .bind(request.enabled)
    .execute(&state.db)
    .await?;
    write_audit(
        &state.db,
        "system",
        "provider_config.save",
        json!({ "provider": provider, "enabled": request.enabled }),
    )
    .await?;
    Ok(Json(json!({ "provider": provider })))
}

pub async fn admin_delete_provider_config(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(provider): Path<String>,
) -> ApiResult<Json<Value>> {
    require_admin(&headers)?;
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
    require_admin(&headers)?;
    let rows = sqlx::query(
        r#"
        select m.id, m.model_id, m.label, m.provider, m.mode, m.base_url, m.endpoint_path,
          m.upstream_model, m.enabled, m.sort_order,
          m.input_yuan_per_million, m.output_yuan_per_million,
          m.reasoning_yuan_per_million, m.cached_input_yuan_per_million, m.markup_bps,
          coalesce(p.api_key <> '' and p.enabled = true, false) as provider_ready,
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
    require_admin(&headers)?;
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
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());
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
    require_admin(&headers)?;
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
    require_admin(&headers)?;
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
    require_admin(&headers)?;
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
    require_admin(&headers)?;
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
            "leaseExpiresAt": lease_expires_at
        },
        "models": models,
        "codexAccounts": if subscription_enabled { codex_accounts } else { Vec::new() }
    })))
}

pub async fn gateway_responses(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(mut body): Json<Value>,
) -> ApiResult<Response> {
    let token = bearer_token(&headers)?;
    let claims = state.run_tokens.verify(token)?;
    let route = load_model_route(&state.db, &claims.model_id).await?;
    let provider = load_provider_config(&state.db, &route).await?;
    let upstream_request = build_upstream_request(&provider, &route.upstream_model, &mut body)
        .map_err(ApiError::BadRequest)?;

    let started = Utc::now();
    sqlx::query("update model_runs set status = 'running', started_at = coalesce(started_at, now()) where id = $1")
        .bind(&claims.run_id)
        .execute(&state.db)
        .await?;

    let upstream = state
        .http
        .post(upstream_request.url.clone())
        .header("authorization", upstream_request.authorization_header)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await?;
    let status = upstream.status();
    let text = upstream.text().await?;
    let upstream_body =
        serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({ "raw": text }));

    if status.is_success() {
        let response_body =
            normalize_upstream_success_body(upstream_request.response_format, upstream_body)
                .map_err(ApiError::Upstream)?;
        let usage = usage_from_openai_response(&response_body);
        settle_and_record_usage(
            &state.db,
            &claims,
            &route.pricing,
            &usage,
            status.as_u16(),
            started,
        )
        .await?;
        let response_status = StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::OK);
        if upstream_request.stream_response {
            let sse = crate::gateway::responses_body_to_sse(&response_body);
            Ok((
                response_status,
                [("content-type", "text/event-stream; charset=utf-8")],
                sse,
            )
                .into_response())
        } else {
            Ok((response_status, Json(response_body)).into_response())
        }
    } else {
        sqlx::query(
            "update model_runs set status = 'failed', completed_at = now(), upstream_status = $2 where id = $1",
        )
        .bind(&claims.run_id)
        .bind(status.as_u16() as i32)
        .execute(&state.db)
        .await?;
        Ok((
            StatusCode::from_u16(status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY),
            Json(upstream_body),
        )
            .into_response())
    }
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

async fn load_model_route(pool: &PgPool, model_id: &str) -> ApiResult<ModelRoute> {
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
    Ok(ModelRoute {
        provider: row.get("provider"),
        base_url: row.get("base_url"),
        endpoint_path: row.get("endpoint_path"),
        upstream_model: row.get("upstream_model"),
        pricing: Pricing {
            input_yuan_per_million: row.get("input_yuan_per_million"),
            output_yuan_per_million: row.get("output_yuan_per_million"),
            reasoning_yuan_per_million: row.get("reasoning_yuan_per_million"),
            cached_input_yuan_per_million: row.get("cached_input_yuan_per_million"),
            markup_bps: row.get::<i64, _>("markup_bps") as u64,
        },
    })
}

async fn load_provider_config(pool: &PgPool, route: &ModelRoute) -> ApiResult<ProviderConfig> {
    let row = sqlx::query(
        r#"
        select provider, base_url, endpoint_path, api_key
        from provider_configs
        where provider = $1 and enabled = true and api_key <> ''
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
    })
}

async fn ensure_tenant_capacity(
    pool: &PgPool,
    tenant_id: &str,
    fingerprint: &str,
) -> ApiResult<()> {
    let row = sqlx::query("select max_devices from tenants where id = $1 and status = 'active'")
        .bind(tenant_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::Forbidden("tenant is not active".to_string()))?;
    ensure_device_capacity_for_fingerprint(
        pool,
        tenant_id,
        fingerprint,
        row.get::<i32, _>("max_devices"),
    )
    .await
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

async fn ensure_device_identity(
    pool: &PgPool,
    tenant_id: &str,
    device_id: &str,
    fingerprint: &str,
) -> ApiResult<()> {
    let exists = sqlx::query(
        r#"
        select 1 from devices
        where tenant_id = $1 and id = $2 and fingerprint = $3
          and status = 'active' and lease_expires_at > now()
        "#,
    )
    .bind(tenant_id)
    .bind(device_id)
    .bind(fingerprint)
    .fetch_optional(pool)
    .await?
    .is_some();
    if exists {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "device identity is invalid or inactive".to_string(),
        ))
    }
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

async fn ensure_device_lease(pool: &PgPool, tenant_id: &str, device_id: &str) -> ApiResult<()> {
    let exists = sqlx::query(
        r#"
        select 1 from devices
        where tenant_id = $1 and id = $2 and status = 'active' and lease_expires_at > now()
        "#,
    )
    .bind(tenant_id)
    .bind(device_id)
    .fetch_optional(pool)
    .await?
    .is_some();
    if exists {
        Ok(())
    } else {
        Err(ApiError::Forbidden(
            "device lease is expired or inactive".to_string(),
        ))
    }
}

async fn ensure_model_enabled(pool: &PgPool, model_id: &str) -> ApiResult<()> {
    let exists = sqlx::query("select 1 from model_routes where model_id = $1 and enabled = true")
        .bind(model_id)
        .fetch_optional(pool)
        .await?
        .is_some();
    if exists {
        Ok(())
    } else {
        Err(ApiError::NotFound(format!(
            "model {model_id} is not enabled"
        )))
    }
}

async fn ensure_balance(pool: &PgPool, tenant_id: &str, budget_yuan: f64) -> ApiResult<()> {
    let row = sqlx::query("select balance_yuan from tenants where id = $1 and status = 'active'")
        .bind(tenant_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| ApiError::Forbidden("tenant is not active".to_string()))?;
    let balance = row.get::<f64, _>("balance_yuan");
    if balance < budget_yuan {
        return Err(ApiError::Forbidden(
            "prepaid balance is insufficient".to_string(),
        ));
    }
    Ok(())
}

async fn settle_and_record_usage(
    pool: &PgPool,
    claims: &RunTokenClaims,
    pricing: &Pricing,
    usage: &GatewayUsage,
    upstream_status: u16,
    started: chrono::DateTime<Utc>,
) -> ApiResult<()> {
    let charge = settle_usage_yuan(usage, pricing);
    let latency_ms = (Utc::now() - started).num_milliseconds().max(0);
    sqlx::query(
        r#"
        insert into usage_events (
            id, tenant_id, run_id, model_id, input_tokens, output_tokens,
            reasoning_tokens, cached_tokens, cost_yuan, billable_yuan,
            upstream_status, latency_ms
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        "#,
    )
    .bind(format!("usage_{}", Uuid::new_v4().simple()))
    .bind(&claims.tenant_id)
    .bind(&claims.run_id)
    .bind(&claims.model_id)
    .bind(usage.input_tokens as i64)
    .bind(usage.output_tokens as i64)
    .bind(usage.reasoning_tokens as i64)
    .bind(usage.cached_tokens as i64)
    .bind(charge.cost_yuan)
    .bind(charge.billable_yuan)
    .bind(upstream_status as i32)
    .bind(latency_ms)
    .execute(pool)
    .await?;
    sqlx::query("update tenants set balance_yuan = balance_yuan - $2 where id = $1")
        .bind(&claims.tenant_id)
        .bind(charge.billable_yuan)
        .execute(pool)
        .await?;
    sqlx::query(
        r#"
        insert into billing_ledger (id, tenant_id, run_id, entry_type, amount_yuan, description)
        values ($1, $2, $3, 'usage_charge', $4, $5)
        "#,
    )
    .bind(format!("ledger_{}", Uuid::new_v4().simple()))
    .bind(&claims.tenant_id)
    .bind(&claims.run_id)
    .bind(-charge.billable_yuan)
    .bind(format!("{} usage charge", claims.model_id))
    .execute(pool)
    .await?;
    sqlx::query(
        "update model_runs set status = 'completed', completed_at = now(), upstream_status = $2 where id = $1",
    )
    .bind(&claims.run_id)
    .bind(upstream_status as i32)
    .execute(pool)
    .await?;
    Ok(())
}

async fn write_audit(
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

async fn recent_billing_ledger(pool: &PgPool, tenant_id: &str) -> ApiResult<Vec<Value>> {
    let rows = sqlx::query(
        r#"
        select id, run_id, entry_type, amount_yuan, description, created_at
        from billing_ledger
        where tenant_id = $1
        order by created_at desc
        limit 8
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
                "runId": row.try_get::<Option<String>, _>("run_id").unwrap_or(None),
                "entryType": row.get::<String, _>("entry_type"),
                "amountYuan": row.get::<f64, _>("amount_yuan"),
                "description": row.get::<String, _>("description"),
                "createdAt": row.get::<chrono::DateTime<Utc>, _>("created_at")
            })
        })
        .collect())
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

fn require_admin(headers: &HeaderMap) -> ApiResult<()> {
    let token = bearer_token(headers)?;
    if token.starts_with("admin-") {
        Ok(())
    } else {
        Err(ApiError::Unauthorized("invalid admin token".to_string()))
    }
}

fn generate_authorization_code() -> String {
    let raw = Uuid::new_v4().simple().to_string().to_uppercase();
    format!("AS-{}-{}-{}", &raw[0..4], &raw[4..8], &raw[8..12])
}

fn hash_authorization_code(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(normalize_authorization_code(value).as_bytes());
    hex::encode(hasher.finalize())
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
    use super::normalized_codex_tenant_ids;

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
}
