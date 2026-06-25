use alpha_studio_backend::license::{
    can_activate_device, codex_subscription_available, normalize_authorization_code,
    normalize_company_name,
};
use chrono::{Duration, Utc};

#[test]
fn normalizes_company_name_and_authorization_code_for_activation() {
    assert_eq!(normalize_company_name("  Demo   Fund  "), "demo fund");
    assert_eq!(
        normalize_authorization_code(" as-2026-abcd-1234 "),
        "AS-2026-ABCD-1234"
    );
}

#[test]
fn allows_existing_device_to_renew_when_customer_is_at_capacity() {
    assert!(can_activate_device(3, 3, true));
    assert!(!can_activate_device(3, 3, false));
    assert!(can_activate_device(2, 3, false));
}

#[test]
fn codex_subscription_requires_enabled_status_and_future_expiry() {
    let now = Utc::now();
    assert!(codex_subscription_available(
        true,
        Some(now + Duration::days(1)),
        now
    ));
    assert!(!codex_subscription_available(
        true,
        Some(now - Duration::seconds(1)),
        now
    ));
    assert!(!codex_subscription_available(false, None, now));
}
