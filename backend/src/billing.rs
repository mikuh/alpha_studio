use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::money::round_up_micro_yuan;

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
    pub input_yuan_per_million: Decimal,
    pub output_yuan_per_million: Decimal,
    pub reasoning_yuan_per_million: Decimal,
    pub cached_input_yuan_per_million: Decimal,
    pub markup_bps: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct UsageCharge {
    pub cost_yuan: Decimal,
    pub billable_yuan: Decimal,
}

impl GatewayUsage {
    pub fn is_empty(&self) -> bool {
        self.input_tokens == 0
            && self.output_tokens == 0
            && self.reasoning_tokens == 0
            && self.cached_tokens == 0
    }
}

impl Pricing {
    pub fn is_valid(&self) -> bool {
        [
            self.input_yuan_per_million,
            self.output_yuan_per_million,
            self.reasoning_yuan_per_million,
            self.cached_input_yuan_per_million,
        ]
        .into_iter()
        .all(|price| price >= Decimal::ZERO)
            && self.input_yuan_per_million > Decimal::ZERO
            && self.output_yuan_per_million > Decimal::ZERO
            && self.markup_bps <= 100_000
    }
}

pub fn settle_usage_yuan(usage: &GatewayUsage, pricing: &Pricing) -> UsageCharge {
    let cost_yuan = yuan_for_tokens(usage.input_tokens, pricing.input_yuan_per_million)
        + yuan_for_tokens(usage.output_tokens, pricing.output_yuan_per_million)
        + yuan_for_tokens(usage.reasoning_tokens, pricing.reasoning_yuan_per_million)
        + yuan_for_tokens(usage.cached_tokens, pricing.cached_input_yuan_per_million);
    // Always round charges upward to one micro-yuan. Rounding to nearest at this
    // boundary leaks a small amount on every low-token request.
    let cost_yuan = round_up_micro_yuan(cost_yuan);
    let multiplier_bps = 10_000_u64.saturating_add(pricing.markup_bps);
    let billable_yuan =
        round_up_micro_yuan(cost_yuan * Decimal::from(multiplier_bps) / Decimal::from(10_000_u64))
            .max(cost_yuan);
    UsageCharge {
        cost_yuan,
        billable_yuan,
    }
}

fn yuan_for_tokens(tokens: u64, yuan_per_million: Decimal) -> Decimal {
    if tokens == 0 || yuan_per_million <= Decimal::ZERO {
        return Decimal::ZERO;
    }
    Decimal::from(tokens) * yuan_per_million / Decimal::from(1_000_000_u64)
}

pub fn usage_from_openai_response(value: &serde_json::Value) -> GatewayUsage {
    let usage = value.get("usage").unwrap_or(&serde_json::Value::Null);
    let cached_tokens = usage
        .get("input_tokens_details")
        .map(|details| number(details, "cached_tokens"))
        .unwrap_or(0);
    let reasoning_tokens = usage
        .get("output_tokens_details")
        .map(|details| number(details, "reasoning_tokens"))
        .unwrap_or(0);
    GatewayUsage {
        // OpenAI reports cached input as a subset of input_tokens and reasoning
        // as a subset of output_tokens. Store mutually exclusive billing
        // buckets so the detailed categories are not charged twice.
        input_tokens: number(usage, "input_tokens").saturating_sub(cached_tokens),
        output_tokens: number(usage, "output_tokens").saturating_sub(reasoning_tokens),
        reasoning_tokens,
        cached_tokens,
    }
}

fn number(value: &serde_json::Value, key: &str) -> u64 {
    value
        .get(key)
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0)
}
