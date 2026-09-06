use std::time::Instant;

use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Request, State},
    http::{header, HeaderName, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, patch, post},
    Json, Router,
};
use serde_json::json;
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};

use crate::{agent_network, observability, routes, skill_registry, state::AppState};

pub fn build_router(state: AppState) -> Router {
    let allowed_origins = state
        .config
        .cors_allowed_origins
        .iter()
        .map(|origin| {
            HeaderValue::from_str(origin).expect("CORS origins are validated during configuration")
        })
        .collect::<Vec<_>>();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(allowed_origins))
        .allow_methods([
            Method::GET,
            Method::POST,
            Method::PATCH,
            Method::DELETE,
            Method::OPTIONS,
        ])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            HeaderName::from_static("x-alpha-tenant-id"),
            HeaderName::from_static("x-alpha-device-id"),
            HeaderName::from_static("x-alpha-device-fingerprint"),
        ]);
    let origin_guard_state = state.clone();
    Router::new()
        .route("/healthz", get(routes::healthz))
        .route("/readyz", get(routes::readyz))
        .route("/metrics", get(observability::metrics))
        .route("/api/auth/login", post(routes::auth_login))
        .route("/api/client/bootstrap", get(routes::client_bootstrap))
        .route("/api/market/snapshot", get(routes::market_snapshot))
        .route(
            "/api/market/capital-flow/:code",
            get(routes::market_capital_flow),
        )
        .route("/api/market/stream", get(routes::market_stream))
        .route("/api/client/activate", post(routes::client_activate))
        .route(
            "/api/client/agent-network/tunnel",
            get(agent_network::open_tunnel),
        )
        .route(
            "/api/client/billing-summary",
            post(routes::client_billing_summary),
        )
        .route("/api/client/devices", post(routes::client_devices))
        .route(
            "/api/client/modules/authorize",
            post(routes::client_authorize_modules),
        )
        .route(
            "/api/client/codex-authorization",
            post(routes::client_codex_authorization),
        )
        .route(
            "/api/client/devices/revoke",
            post(routes::client_revoke_device),
        )
        .route("/api/devices/lease", post(routes::device_lease))
        .route("/api/runs/create", post(routes::run_create))
        .route("/api/admin/summary", get(routes::admin_summary))
        .route("/api/admin/audit-logs", get(routes::admin_audit_logs))
        .route(
            "/api/admin/tenants",
            get(routes::admin_list_tenants).post(routes::admin_save_tenant),
        )
        .route(
            "/api/admin/tenants/:id",
            delete(routes::admin_delete_tenant),
        )
        .route(
            "/api/admin/tenants/:id/billing",
            get(routes::admin_tenant_billing),
        )
        .route(
            "/api/admin/tenants/:id/offline-payments",
            post(routes::admin_record_offline_payment),
        )
        .route(
            "/api/admin/offline-payments/:id/correct",
            post(routes::admin_correct_offline_payment),
        )
        .route(
            "/api/admin/billing/reconciliation",
            get(routes::admin_billing_reconciliation),
        )
        .route(
            "/api/admin/authorization-codes",
            get(routes::admin_list_authorization_codes)
                .post(routes::admin_create_authorization_code),
        )
        .route(
            "/api/admin/authorization-codes/:id",
            patch(routes::admin_update_authorization_code)
                .delete(routes::admin_delete_authorization_code),
        )
        .route(
            "/api/admin/authorization-codes/:id/reveal",
            post(routes::admin_reveal_authorization_code),
        )
        .route(
            "/api/admin/provider-configs",
            get(routes::admin_list_provider_configs).post(routes::admin_save_provider_config),
        )
        .route(
            "/api/admin/provider-configs/discover-models",
            post(routes::admin_discover_provider_models),
        )
        .route(
            "/api/admin/provider-configs/:provider",
            delete(routes::admin_delete_provider_config),
        )
        .route(
            "/api/admin/model-routes",
            get(routes::admin_list_model_routes).post(routes::admin_save_model_route),
        )
        .route(
            "/api/admin/model-routes/:id",
            delete(routes::admin_delete_model_route),
        )
        .route(
            "/api/admin/codex-accounts",
            get(routes::admin_list_codex_accounts).post(routes::admin_save_codex_account),
        )
        .route(
            "/api/admin/codex-accounts/:id",
            delete(routes::admin_delete_codex_account),
        )
        .route(
            "/api/admin/skill-releases",
            get(skill_registry::admin_list_skill_releases)
                .post(skill_registry::admin_create_skill_release)
                .layer(skill_registry::upload_body_limit()),
        )
        .route(
            "/api/admin/skill-releases/:id/publish",
            post(skill_registry::admin_publish_skill_release),
        )
        .route(
            "/api/admin/skill-releases/:id",
            delete(skill_registry::admin_delete_skill_release),
        )
        .route(
            "/api/client/skills/catalog",
            get(skill_registry::client_skill_catalog),
        )
        .route(
            "/api/client/skills/releases/:id/download",
            get(skill_registry::client_download_skill_release),
        )
        .route(
            "/v1/responses",
            post(routes::gateway_responses)
                .layer(DefaultBodyLimit::max(routes::GATEWAY_REQUEST_BODY_LIMIT)),
        )
        .route("/v1/models", get(routes::gateway_models))
        .route("/v1/run-status", get(routes::gateway_run_status))
        .route("/v1/run-events", get(routes::gateway_run_events))
        .with_state(state.clone())
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn_with_state(
            origin_guard_state,
            reject_untrusted_browser_origin,
        ))
        .layer(middleware::from_fn_with_state(state, observe_request))
}

async fn observe_request(
    State(state): State<AppState>,
    mut request: Request<Body>,
    next: Next,
) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let path = request.uri().path().to_string();
    let request_id = request
        .headers()
        .get("x-request-id")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 128 && value.is_ascii())
        .map(str::to_string)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        request
            .headers_mut()
            .insert(HeaderName::from_static("x-request-id"), value);
    }

    state.http_metrics.start_request();
    let mut response = next.run(request).await;
    let status = response.status();
    let elapsed = started.elapsed();
    state.http_metrics.finish_request(status.as_u16(), elapsed);
    if let Ok(value) = HeaderValue::from_str(&request_id) {
        response
            .headers_mut()
            .insert(HeaderName::from_static("x-request-id"), value);
    }
    tracing::info!(
        request_id = %request_id,
        method = %method,
        path = %path,
        status = status.as_u16(),
        duration_ms = elapsed.as_secs_f64() * 1000.0,
        "http request completed"
    );
    response
}

async fn reject_untrusted_browser_origin(
    State(state): State<AppState>,
    request: Request<Body>,
    next: Next,
) -> Response {
    if let Some(origin) = request
        .headers()
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok())
    {
        let allowed = state
            .config
            .cors_allowed_origins
            .iter()
            .any(|candidate| candidate == origin);
        if !allowed {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({ "error": { "message": "origin is not allowed" } })),
            )
                .into_response();
        }
    }
    next.run(request).await
}
