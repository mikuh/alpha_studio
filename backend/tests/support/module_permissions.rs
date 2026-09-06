use alpha_studio_backend::{
    build_router, db,
    state::AppState,
    tokens::{AdminTokenClaims, DeviceTokenClaims},
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(path)
                .header("content-type", "application/json")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), 2_000_000)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
#[ignore = "requires ALPHA_MODULE_TEST_DATABASE_URL pointing to an isolated test database"]
async fn tenant_module_permissions_lifecycle() {
    let url =
        std::env::var("ALPHA_MODULE_TEST_DATABASE_URL").expect("isolated module test database URL");
    assert!(
        url.ends_with("/alpha_modules_test"),
        "use the disposable module test database"
    );
    let pool = PgPoolOptions::new().connect(&url).await.unwrap();
    db::migrate(&pool).await.unwrap();
    sqlx::query("delete from tenants where id in ('module-a','module-b')")
        .execute(&pool)
        .await
        .unwrap();
    let state = AppState::new(super::test_config(), pool.clone(), None);
    let admin = state
        .admin_tokens
        .issue(AdminTokenClaims::new(
            "module-test@example.test".into(),
            3600,
        ))
        .unwrap();
    let device = state
        .device_tokens
        .issue(DeviceTokenClaims::new(
            "module-a".into(),
            "module-user".into(),
            "module-device".into(),
            hex::encode(Sha256::digest(b"test-fingerprint")),
            3600,
        ))
        .unwrap();
    let app = build_router(state);
    let save = |ids: Value| json!({ "id": "module-a", "name": "Module A", "enabledModules": ids });
    // No admin token and device tokens cannot grant modules.
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/admin/tenants",
            "",
            save(json!(["files"]))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/admin/tenants",
            &device,
            save(json!(["files"]))
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/admin/tenants",
            &admin,
            json!({"id":"module-a", "name":"Module A"})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/admin/tenants",
            &admin,
            json!({"id":"module-b", "name":"Module B", "enabledModules":["browser"]})
        )
        .await
        .0,
        StatusCode::OK
    );
    sqlx::query("insert into devices (id, tenant_id, user_id, fingerprint, name, lease_expires_at) values ('module-device', 'module-a', 'module-user', 'test-fingerprint', 'Test device', now() + interval '1 day') on conflict (id) do update set status='active', lease_expires_at=excluded.lease_expires_at").execute(&pool).await.unwrap();
    let authorize =
        |ids: Value| json!({"tenantId":"module-a", "deviceId":"module-device", "moduleIds":ids});
    let path = "/api/client/modules/authorize";
    assert_eq!(
        request(&app, "POST", path, &device, authorize(json!(["browser"])))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &app,
            "POST",
            path,
            &device,
            json!({"tenantId":"module-b", "deviceId":"module-device", "moduleIds":["browser"]})
        )
        .await
        .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/admin/tenants",
            &admin,
            save(json!(["unknown"]))
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        request(
            &app,
            "POST",
            "/api/admin/tenants",
            &admin,
            save(json!(["files", "daily-report"]))
        )
        .await
        .0,
        StatusCode::OK
    );
    let (status, granted) = request(
        &app,
        "POST",
        path,
        &device,
        authorize(json!(["files", "daily-report"])),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{granted}");
    assert_eq!(granted["enabledModules"], json!(["files", "daily-report"]));
    assert_eq!(
        request(&app, "POST", path, &device, authorize(json!(["unknown"])))
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
    // Activation and billing use the same permission payload as renewal.
    let (_, code) = request(
        &app,
        "POST",
        "/api/admin/authorization-codes",
        &admin,
        json!({"tenantId":"module-a", "maxDevices":3}),
    )
    .await;
    let (status, activated) = request(
        &app,
        "POST",
        "/api/client/activate",
        "",
        json!({
            "companyName":"Module A", "authorizationCode":code["authorizationCode"],
            "fingerprint":"activation-fingerprint", "deviceName":"Activation test",
            "agreementAcceptance": {
                "serviceTermsVersion":"2026-08-04", "serviceTermsAccepted":true,
                "privacyPolicyVersion":"2026-08-04", "privacyPolicyAccepted":true,
                "thirdPartyModelNoticeVersion":"2026-08-04", "thirdPartyModelNoticeAccepted":true,
                "researchRiskDisclosureVersion":"2026-08-04", "researchRiskDisclosureAccepted":true
            }
        }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{activated}");
    assert_eq!(
        activated["tenant"]["enabledModules"],
        json!(["files", "daily-report"])
    );
    let (status, billing) = request(
        &app,
        "POST",
        "/api/client/billing-summary",
        &device,
        json!({"tenantId":"module-a", "deviceId":"module-device"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{billing}");
    assert_eq!(
        billing["tenant"]["enabledModules"],
        json!(["files", "daily-report"])
    );
    // An older admin edit without module fields must preserve the explicit grants.
    request(
        &app,
        "POST",
        "/api/admin/tenants",
        &admin,
        json!({"id":"module-a", "name":"Module A"}),
    )
    .await;
    let (_, lease) = request(
        &app,
        "POST",
        "/api/devices/lease",
        &device,
        json!({"tenantId":"module-a", "deviceId":"module-device"}),
    )
    .await;
    assert_eq!(
        lease["tenant"]["enabledModules"],
        json!(["files", "daily-report"])
    );
    let (_, tenants) = request(&app, "GET", "/api/admin/tenants", &admin, json!({})).await;
    let tenants = tenants["tenants"].as_array().unwrap();
    assert_eq!(
        tenants.iter().find(|row| row["id"] == "module-b").unwrap()["enabledModules"],
        json!(["browser"])
    );
    // Existing and newly-created tenants are opt-in; migration never grants modules.
    assert_eq!(
        tenants.iter().find(|row| row["id"] == "demo").unwrap()["enabledModules"],
        json!([])
    );
    assert_eq!(
        request(&app, "POST", "/api/admin/tenants", &admin, save(json!([])))
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "POST", path, &device, authorize(json!(["files"])))
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (_, lease) = request(
        &app,
        "POST",
        "/api/devices/lease",
        &device,
        json!({"tenantId":"module-a", "deviceId":"module-device"}),
    )
    .await;
    assert_eq!(lease["tenant"]["enabledModules"], json!([]));
    let audits: i64 = sqlx::query_scalar("select count(*) from audit_logs where tenant_id='module-a' and action='tenant.save' and payload->'enabledModules' = '[]'::jsonb").fetch_one(&pool).await.unwrap();
    assert!(audits > 0);
}
