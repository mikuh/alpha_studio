use std::net::SocketAddr;

use alpha_studio_backend::{build_router, config::AppConfig, state::AppState};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

#[tokio::test]
async fn admin_dynamic_delete_routes_match_before_auth() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    for path in [
        "/api/admin/tenants/tenant_alpha",
        "/api/admin/authorization-codes/auth_alpha",
        "/api/admin/provider-configs/openai",
        "/api/admin/model-routes/route_alpha",
        "/api/admin/codex-accounts/codex_alpha",
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
}

fn test_config() -> AppConfig {
    AppConfig {
        database_url: "postgres://postgres:postgres@localhost/alpha_studio_test".to_string(),
        redis_url: "redis://localhost:6379".to_string(),
        app_base_url: "http://localhost:8080".to_string(),
        jwt_secret: "test-jwt-secret".to_string(),
        run_token_secret: "test-run-secret".to_string(),
        admin_email: "admin@alpha-studio.local".to_string(),
        admin_password: "alpha-admin".to_string(),
        bind_addr: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
    }
}
