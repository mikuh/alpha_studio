use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: String,
    pub base_url: String,
    pub endpoint_path: String,
    pub api_key: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpstreamRequest {
    pub url: String,
    pub authorization_header: String,
}

pub fn build_upstream_request(
    provider: &ProviderConfig,
    upstream_model: &str,
    body: &mut Value,
) -> Result<UpstreamRequest, String> {
    if body.get("stream").and_then(Value::as_bool).unwrap_or(false) {
        return Err(
            "streaming responses are not supported until usage ledger settlement is complete"
                .to_string(),
        );
    }

    body["model"] = Value::String(upstream_model.to_string());
    Ok(UpstreamRequest {
        url: join_url(&provider.base_url, &provider.endpoint_path),
        authorization_header: format!("Bearer {}", provider.api_key),
    })
}

pub fn mask_secret(value: &str) -> String {
    let value = value.trim();
    if value.len() < 12 {
        return "configured".to_string();
    }
    format!("{}********{}", &value[..4], &value[value.len() - 4..])
}

fn join_url(base_url: &str, path: &str) -> String {
    format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}
