use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct GatewayUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub cached_tokens: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Pricing {
    pub input_cents_per_million: u64,
    pub output_cents_per_million: u64,
    pub reasoning_cents_per_million: u64,
    pub cached_input_cents_per_million: u64,
    pub markup_bps: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageCharge {
    pub cost_cents: u64,
    pub billable_cents: u64,
}

pub fn settle_usage_cents(usage: &GatewayUsage, pricing: &Pricing) -> UsageCharge {
    let cost_cents = cents_for(usage.input_tokens, pricing.input_cents_per_million)
        + cents_for(usage.output_tokens, pricing.output_cents_per_million)
        + cents_for(usage.reasoning_tokens, pricing.reasoning_cents_per_million)
        + cents_for(usage.cached_tokens, pricing.cached_input_cents_per_million);
    let billable_cents = div_ceil(
        (cost_cents as u128) * ((10_000 + pricing.markup_bps) as u128),
        10_000,
    ) as u64;
    UsageCharge {
        cost_cents,
        billable_cents,
    }
}

fn cents_for(tokens: u64, cents_per_million: u64) -> u64 {
    div_ceil((tokens as u128) * (cents_per_million as u128), 1_000_000) as u64
}

fn div_ceil(numerator: u128, denominator: u128) -> u128 {
    if numerator == 0 {
        0
    } else {
        ((numerator - 1) / denominator) + 1
    }
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
