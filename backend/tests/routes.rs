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
        "/api/admin/skill-releases/skillrel_alpha",
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

#[tokio::test]
async fn managed_skill_routes_require_the_correct_authorization_scope() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    for (method, path) in [
        ("GET", "/api/admin/skill-releases"),
        ("POST", "/api/admin/skill-releases/skillrel_alpha/publish"),
        (
            "GET",
            "/api/client/skills/catalog?tenantId=tenant&deviceId=device&channel=stable",
        ),
        (
            "GET",
            "/api/client/skills/releases/skillrel_alpha/download?tenantId=tenant&deviceId=device",
        ),
    ] {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED, "{path}");
    }
}

#[tokio::test]
async fn authorization_code_reveal_requires_admin_auth() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/admin/authorization-codes/auth_alpha/reveal")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn admin_tenant_billing_route_requires_admin_auth() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/tenants/tenant_alpha/billing?page=1&pageSize=20")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn forged_admin_prefix_is_rejected() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/admin/summary")
                .header("authorization", "Bearer admin-forged")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn market_snapshot_requires_activated_device_headers() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/market/snapshot")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn run_creation_requires_a_signed_device_token() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/runs/create")
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"tenantId":"tenant","userId":"user","deviceId":"device","modelId":"model","budgetYuan":5}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn cors_rejects_unlisted_browser_origins() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/runs/create")
                .header("origin", "https://evil.example")
                .header("access-control-request-method", "POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(response
        .headers()
        .get("access-control-allow-origin")
        .is_none());
}

#[tokio::test]
async fn cors_allows_the_configured_tauri_dev_origin() {
    let pool = PgPoolOptions::new()
        .connect_lazy("postgres://postgres:postgres@localhost/alpha_studio_test")
        .expect("lazy postgres pool");
    let state = AppState::new(test_config(), pool, None);
    let app = build_router(state);

    let response = app
        .oneshot(
            Request::builder()
                .method("OPTIONS")
                .uri("/api/client/activate")
                .header("origin", "http://localhost:1421")
                .header("access-control-request-method", "POST")
                .header("access-control-request-headers", "content-type")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("access-control-allow-origin")
            .and_then(|value| value.to_str().ok()),
        Some("http://localhost:1421")
    );
}

fn test_config() -> AppConfig {
    AppConfig {
        database_url: "postgres://postgres:postgres@localhost/alpha_studio_test".to_string(),
        redis_url: "redis://localhost:6379".to_string(),
        app_base_url: "http://localhost:8080".to_string(),
        jwt_secret: "test-jwt-secret".to_string(),
        run_token_secret: "test-run-secret".to_string(),
        authorization_code_encryption_key: "test-authorization-code-key".to_string(),
        admin_email: "admin@alpha-studio.local".to_string(),
        admin_password: "alpha-admin".to_string(),
        bind_addr: "127.0.0.1:0".parse::<SocketAddr>().unwrap(),
        market_data_enabled: false,
        market_refresh_seconds: 45,
        market_snapshot_limit: 6000,
        min_gateway_markup_bps: 500,
        cors_allowed_origins: vec![
            "http://localhost:1420".to_string(),
            "http://localhost:1421".to_string(),
        ],
    }
}
