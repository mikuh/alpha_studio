use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GatewayUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub cached_tokens: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pricing {
    pub input_yuan_per_million: f64,
    pub output_yuan_per_million: f64,
    pub reasoning_yuan_per_million: f64,
    pub cached_input_yuan_per_million: f64,
    pub markup_bps: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageCharge {
    pub cost_yuan: f64,
    pub billable_yuan: f64,
}

pub fn settle_usage_yuan(usage: &GatewayUsage, pricing: &Pricing) -> UsageCharge {
    let cost_yuan = yuan_for_tokens(usage.input_tokens, pricing.input_yuan_per_million)
        + yuan_for_tokens(usage.output_tokens, pricing.output_yuan_per_million)
        + yuan_for_tokens(usage.reasoning_tokens, pricing.reasoning_yuan_per_million)
        + yuan_for_tokens(usage.cached_tokens, pricing.cached_input_yuan_per_million);
    let billable_yuan = cost_yuan * ((10_000 + pricing.markup_bps) as f64) / 10_000.0;
    UsageCharge {
        cost_yuan,
        billable_yuan,
    }
}

fn yuan_for_tokens(tokens: u64, yuan_per_million: f64) -> f64 {
    if tokens == 0 || !yuan_per_million.is_finite() || yuan_per_million <= 0.0 {
        return 0.0;
    }
    (tokens as f64) * yuan_per_million / 1_000_000.0
}

pub fn usage_from_openai_response(value: &serde_json::Value) -> GatewayUsage {
    let usage = value.get("usage").unwrap_or(&serde_json::Value::Null);
    GatewayUsage {
        input_tokens: number(usage, "input_tokens"),
        output_tokens: number(usage, "output_tokens"),
        reasoning_tokens: usage
            .get("output_tokens_details")
            .map(|details| number(details, "reasoning_tokens"))
            .unwrap_or(0),
        cached_tokens: usage
            .get("input_tokens_details")
            .map(|details| number(details, "cached_tokens"))
            .unwrap_or(0),
    }
}

fn number(value: &serde_json::Value, key: &str) -> u64 {
    value
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
}
