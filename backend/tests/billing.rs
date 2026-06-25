use alpha_studio_backend::billing::{settle_usage_cents, GatewayUsage, Pricing};

#[test]
fn settles_gateway_usage_from_real_token_counts() {
    let usage = GatewayUsage {
        input_tokens: 100_000,
        output_tokens: 25_000,
        reasoning_tokens: 5_000,
        cached_tokens: 20_000,
    };
    let pricing = Pricing {
        input_cents_per_million: 120,
        output_cents_per_million: 480,
        reasoning_cents_per_million: 480,
        cached_input_cents_per_million: 30,
        markup_bps: 2_500,
    };

    let charge = settle_usage_cents(&usage, &pricing);

    assert_eq!(charge.cost_cents, 28);
    assert_eq!(charge.billable_cents, 35);
}
