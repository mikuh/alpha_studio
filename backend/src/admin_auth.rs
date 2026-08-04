use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use sha1::Sha1;
use sqlx::{PgPool, Row};

use crate::error::{ApiError, ApiResult};

const TOTP_STEP_SECONDS: u64 = 30;
const TOTP_DIGITS: u32 = 6;
const LOGIN_WINDOW_MINUTES: i64 = 15;
const MAX_LOGIN_FAILURES: i32 = 5;
const LOCKOUT_MINUTES: i64 = 15;

type HmacSha1 = Hmac<Sha1>;

pub fn decode_totp_secret(value: &str) -> Result<Vec<u8>, String> {
    let normalized = value
        .trim()
        .chars()
        .filter(|character| !matches!(character, ' ' | '-'))
        .map(|character| character.to_ascii_uppercase())
        .collect::<String>();
    if normalized.is_empty() {
        return Err("ADMIN_TOTP_SECRET is required".to_string());
    }

    let mut bits = 0_u32;
    let mut bit_count = 0_u8;
    let mut decoded = Vec::new();
    for character in normalized.chars().take_while(|character| *character != '=') {
        let value = match character {
            'A'..='Z' => character as u8 - b'A',
            '2'..='7' => character as u8 - b'2' + 26,
            _ => return Err("ADMIN_TOTP_SECRET must be RFC 4648 Base32".to_string()),
        };
        bits = (bits << 5) | u32::from(value);
        bit_count += 5;
        while bit_count >= 8 {
            bit_count -= 8;
            decoded.push((bits >> bit_count) as u8);
            bits &= (1_u32 << bit_count).saturating_sub(1);
        }
    }
    if decoded.len() < 20 {
        return Err("ADMIN_TOTP_SECRET must decode to at least 20 bytes".to_string());
    }
    Ok(decoded)
}

pub fn verify_totp(secret: &[u8], code: &str) -> bool {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    verify_totp_at(secret, code, timestamp)
}

fn verify_totp_at(secret: &[u8], code: &str, timestamp: u64) -> bool {
    let normalized = code.trim();
    if normalized.len() != TOTP_DIGITS as usize
        || !normalized.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    let counter = timestamp / TOTP_STEP_SECONDS;
    [-1_i64, 0, 1].into_iter().any(|offset| {
        let Some(candidate_counter) = counter.checked_add_signed(offset) else {
            return false;
        };
        let candidate = totp_code(secret, candidate_counter);
        constant_time_eq(candidate.as_bytes(), normalized.as_bytes())
    })
}

fn totp_code(secret: &[u8], counter: u64) -> String {
    let mut mac = HmacSha1::new_from_slice(secret).expect("HMAC accepts arbitrary key lengths");
    mac.update(&counter.to_be_bytes());
    let digest = mac.finalize().into_bytes();
    let offset = usize::from(digest[digest.len() - 1] & 0x0f);
    let binary = (u32::from(digest[offset] & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);
    format!("{:06}", binary % 10_u32.pow(TOTP_DIGITS))
}

pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let max_len = left.len().max(right.len());
    let mut difference = left.len() ^ right.len();
    for index in 0..max_len {
        difference |= usize::from(
            left.get(index).copied().unwrap_or_default()
                ^ right.get(index).copied().unwrap_or_default(),
        );
    }
    difference == 0
}

pub async fn ensure_login_allowed(pool: &PgPool, principal: &str) -> ApiResult<()> {
    let row = sqlx::query("select locked_until from admin_login_security where principal = $1")
        .bind(principal)
        .fetch_optional(pool)
        .await?;
    let locked = row
        .and_then(|row| {
            row.try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("locked_until")
                .ok()
                .flatten()
        })
        .is_some_and(|locked_until| locked_until > chrono::Utc::now());
    if locked {
        return Err(ApiError::TooManyRequests(
            "too many login attempts; try again later".to_string(),
        ));
    }
    Ok(())
}

pub async fn record_login_failure(pool: &PgPool, principal: &str) -> ApiResult<bool> {
    let row = sqlx::query(
        r#"
        insert into admin_login_security
          (principal, failed_attempts, window_started_at, locked_until, updated_at)
        values ($1, 1, now(), null, now())
        on conflict (principal) do update set
          failed_attempts = case
            when admin_login_security.window_started_at <= now() - make_interval(mins => $2)
              then 1
            else admin_login_security.failed_attempts + 1
          end,
          window_started_at = case
            when admin_login_security.window_started_at <= now() - make_interval(mins => $2)
              then now()
            else admin_login_security.window_started_at
          end,
          locked_until = case
            when (case
              when admin_login_security.window_started_at <= now() - make_interval(mins => $2)
                then 1
              else admin_login_security.failed_attempts + 1
            end) >= $3
              then now() + make_interval(mins => $4)
            else null
          end,
          updated_at = now()
        returning locked_until
        "#,
    )
    .bind(principal)
    .bind(LOGIN_WINDOW_MINUTES)
    .bind(MAX_LOGIN_FAILURES)
    .bind(LOCKOUT_MINUTES)
    .fetch_one(pool)
    .await?;
    Ok(row
        .try_get::<Option<chrono::DateTime<chrono::Utc>>, _>("locked_until")
        .unwrap_or(None)
        .is_some())
}

pub async fn clear_login_failures(pool: &PgPool, principal: &str) -> ApiResult<()> {
    sqlx::query("delete from admin_login_security where principal = $1")
        .bind(principal)
        .execute(pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_base32_and_matches_rfc_totp_vector() {
        let secret = decode_totp_secret("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ").unwrap();
        assert!(verify_totp_at(&secret, "287082", 59));
        assert!(!verify_totp_at(&secret, "287083", 59));
    }

    #[test]
    fn rejects_short_or_malformed_totp_secrets() {
        assert!(decode_totp_secret("ABC").is_err());
        assert!(decode_totp_secret("NOT-BASE32-0").is_err());
    }
}
