use alpha_studio_backend::billing::{
    settle_usage_yuan, usage_from_openai_response, GatewayUsage, Pricing,
};
use rust_decimal::Decimal;
use serde_json::json;

fn dec(mantissa: i64, scale: u32) -> Decimal {
    Decimal::new(mantissa, scale)
}

#[test]
fn settles_gateway_usage_from_real_token_counts() {
    let usage = GatewayUsage {
        input_tokens: 100_000,
        output_tokens: 25_000,
        reasoning_tokens: 5_000,
        cached_tokens: 20_000,
    };
    let pricing = Pricing {
        input_yuan_per_million: dec(12, 1),
        output_yuan_per_million: dec(48, 1),
        reasoning_yuan_per_million: dec(48, 1),
        cached_input_yuan_per_million: dec(3, 1),
        markup_bps: 2_500,
    };

    let charge = settle_usage_yuan(&usage, &pricing);

    assert_eq!(charge.cost_yuan, dec(27, 2));
    assert_eq!(charge.billable_yuan, dec(3375, 4));
}

#[test]
fn settles_fractional_gateway_prices() {
    let usage = GatewayUsage {
        input_tokens: 1_000_000,
        output_tokens: 0,
        reasoning_tokens: 0,
        cached_tokens: 2_000_000,
    };
    let pricing = Pricing {
        input_yuan_per_million: dec(15, 1),
        output_yuan_per_million: Decimal::ZERO,
        reasoning_yuan_per_million: Decimal::ZERO,
        cached_input_yuan_per_million: dec(2, 2),
        markup_bps: 0,
    };

    let charge = settle_usage_yuan(&usage, &pricing);

    assert_eq!(charge.cost_yuan, dec(154, 2));
    assert_eq!(charge.billable_yuan, dec(154, 2));
}

#[test]
fn rounds_tiny_charges_up_instead_of_leaking_fractional_cost() {
    let usage = GatewayUsage {
        input_tokens: 1,
        output_tokens: 0,
        reasoning_tokens: 0,
        cached_tokens: 0,
    };
    let pricing = Pricing {
        input_yuan_per_million: dec(1, 2),
        output_yuan_per_million: Decimal::ONE,
        reasoning_yuan_per_million: Decimal::ZERO,
        cached_input_yuan_per_million: Decimal::ZERO,
        markup_bps: 0,
    };

    let charge = settle_usage_yuan(&usage, &pricing);

    assert_eq!(charge.cost_yuan, dec(1, 6));
    assert_eq!(charge.billable_yuan, dec(1, 6));
}

#[test]
fn rejects_incomplete_or_loss_making_pricing() {
    let pricing = Pricing {
        input_yuan_per_million: Decimal::ONE,
        output_yuan_per_million: Decimal::ZERO,
        reasoning_yuan_per_million: Decimal::ZERO,
        cached_input_yuan_per_million: Decimal::ZERO,
        markup_bps: 0,
    };

    assert!(!pricing.is_valid());
}

#[test]
fn separates_openai_cached_and_reasoning_subtotals_for_billing() {
    let usage = usage_from_openai_response(&json!({
        "usage": {
            "input_tokens": 100,
            "output_tokens": 40,
            "input_tokens_details": { "cached_tokens": 25 },
            "output_tokens_details": { "reasoning_tokens": 10 }
        }
    }));

    assert_eq!(
        usage,
        GatewayUsage {
            input_tokens: 75,
            output_tokens: 30,
            reasoning_tokens: 10,
            cached_tokens: 25,
        }
    );
}
