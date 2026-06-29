use axum::{
    routing::{delete, get, patch, post},
    Router,
};
use tower_http::{compression::CompressionLayer, cors::CorsLayer, trace::TraceLayer};

use crate::{routes, state::AppState};

pub fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(routes::healthz))
        .route("/readyz", get(routes::readyz))
        .route("/api/auth/login", post(routes::auth_login))
        .route("/api/client/bootstrap", get(routes::client_bootstrap))
        .route("/api/client/activate", post(routes::client_activate))
        .route("/api/devices/activate", post(routes::device_activate))
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
            "/api/admin/provider-configs",
            get(routes::admin_list_provider_configs).post(routes::admin_save_provider_config),
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
        .route("/v1/responses", post(routes::gateway_responses))
        .with_state(state)
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
}
