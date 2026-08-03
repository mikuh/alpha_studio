use alpha_studio_backend::tokens::{
    AdminTokenClaims, AdminTokenService, DeviceTokenClaims, DeviceTokenService, RunTokenClaims,
    RunTokenService,
};

#[test]
fn run_tokens_bind_tenant_device_model_and_budget() {
    let service = RunTokenService::new("dev-secret".to_string());
    let token = service
        .issue(RunTokenClaims::new(
            "tenant_1".to_string(),
            "user_1".to_string(),
            "device_1".to_string(),
            "run_1".to_string(),
            "gpt-5.5".to_string(),
            10.0,
            60,
        ))
        .expect("token should be issued");

    let claims = service.verify(&token).expect("token should verify");

    assert_eq!(claims.tenant_id, "tenant_1");
    assert_eq!(claims.device_id, "device_1");
    assert_eq!(claims.model_id, "gpt-5.5");
    assert_eq!(claims.budget_yuan, 10.0);
}

#[test]
fn admin_tokens_are_signed_typed_and_expiring() {
    let service = AdminTokenService::new("admin-secret-that-is-long-and-random".to_string());
    let token = service
        .issue(AdminTokenClaims::new("owner@example.test".to_string(), 60))
        .expect("admin token should be issued");

    let claims = service.verify(&token).expect("admin token should verify");
    assert_eq!(claims.email, "owner@example.test");

    let forged = format!("{token}x");
    assert!(service.verify(&forged).is_err());
}

#[test]
fn device_tokens_cannot_be_used_as_admin_tokens() {
    let secret = "shared-jwt-secret-that-is-long-and-random".to_string();
    let devices = DeviceTokenService::new(secret.clone());
    let admins = AdminTokenService::new(secret);
    let token = devices
        .issue(DeviceTokenClaims::new(
            "tenant_1".to_string(),
            "user_1".to_string(),
            "device_1".to_string(),
            "fingerprint-hash".to_string(),
            60,
        ))
        .expect("device token should be issued");

    assert!(admins.verify(&token).is_err());
}
