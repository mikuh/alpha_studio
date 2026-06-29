use alpha_studio_backend::billing::{settle_usage_yuan, GatewayUsage, Pricing};

#[test]
fn settles_gateway_usage_from_real_token_counts() {
    let usage = GatewayUsage {
        input_tokens: 100_000,
        output_tokens: 25_000,
        reasoning_tokens: 5_000,
        cached_tokens: 20_000,
    };
    let pricing = Pricing {
        input_yuan_per_million: 1.2,
        output_yuan_per_million: 4.8,
        reasoning_yuan_per_million: 4.8,
        cached_input_yuan_per_million: 0.3,
        markup_bps: 2_500,
    };

    let charge = settle_usage_yuan(&usage, &pricing);

    assert_eq!(charge.cost_yuan, 0.27);
    assert_eq!(charge.billable_yuan, 0.3375);
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
        input_yuan_per_million: 1.5,
        output_yuan_per_million: 0.0,
        reasoning_yuan_per_million: 0.0,
        cached_input_yuan_per_million: 0.02,
        markup_bps: 0,
    };

    let charge = settle_usage_yuan(&usage, &pricing);

    assert_eq!(charge.cost_yuan, 1.54);
    assert_eq!(charge.billable_yuan, 1.54);
}
