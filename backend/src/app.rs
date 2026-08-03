use axum::{
    http::{header, HeaderName, HeaderValue, Method},
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::{
    compression::CompressionLayer,
    cors::{AllowOrigin, CorsLayer},
    trace::TraceLayer,
};

use crate::{routes, skill_registry, state::AppState};

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
    Router::new()
        .route("/healthz", get(routes::healthz))
        .route("/readyz", get(routes::readyz))
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
            "/api/client/billing-summary",
            post(routes::client_billing_summary),
        )
        .route("/api/client/devices", post(routes::client_devices))
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
        .route("/v1/responses", post(routes::gateway_responses))
        .route("/v1/models", get(routes::gateway_models))
        .with_state(state)
        .layer(CompressionLayer::new())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
}
