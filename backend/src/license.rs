use chrono::{DateTime, Utc};

pub fn normalize_company_name(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

pub fn normalize_authorization_code(value: &str) -> String {
    value.trim().replace(' ', "").to_uppercase()
}

pub fn can_activate_device(
    active_devices: i64,
    max_devices: i64,
    fingerprint_exists: bool,
) -> bool {
    fingerprint_exists || active_devices < max_devices
}

pub fn codex_subscription_available(
    enabled: bool,
    expires_at: Option<DateTime<Utc>>,
    now: DateTime<Utc>,
) -> bool {
    enabled
        && expires_at
            .map(|expires_at| expires_at > now)
            .unwrap_or(false)
}
