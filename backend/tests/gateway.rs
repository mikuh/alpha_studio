use alpha_studio_backend::gateway::{build_upstream_request, mask_secret, ProviderConfig};

#[test]
fn builds_openai_responses_url_and_injects_upstream_model() {
    let provider = ProviderConfig {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1/".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "sk-test".to_string(),
    };
    let mut body = serde_json::json!({ "model": "alpha-alias", "input": "hello" });
    let request = build_upstream_request(&provider, "gpt-5.5", &mut body).unwrap();

    assert_eq!(request.url, "https://api.openai.com/v1/responses");
    assert_eq!(request.authorization_header, "Bearer sk-test");
    assert_eq!(body["model"], "gpt-5.5");
}

#[test]
fn rejects_streaming_until_usage_ledger_can_settle_streams() {
    let provider = ProviderConfig {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        endpoint_path: "/responses".to_string(),
        api_key: "sk-test".to_string(),
    };
    let mut body = serde_json::json!({ "model": "alpha-alias", "stream": true });

    let error = build_upstream_request(&provider, "gpt-5.5", &mut body).unwrap_err();
    assert!(error.contains("streaming"));
}

#[test]
fn masks_provider_key_without_returning_the_secret() {
    assert_eq!(mask_secret("sk-1234567890abcdef"), "sk-1********cdef");
    assert_eq!(mask_secret("short"), "configured");
}
