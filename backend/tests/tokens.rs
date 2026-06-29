use alpha_studio_backend::tokens::{RunTokenClaims, RunTokenService};

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
