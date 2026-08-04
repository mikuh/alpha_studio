use std::{env, fs, net::SocketAddr};

use crate::admin_auth::decode_totp_secret;

#[derive(Clone)]
pub struct AppConfig {
    pub app_environment: String,
    pub database_url: String,
    pub redis_url: String,
    pub app_base_url: String,
    pub jwt_secret: String,
    pub run_token_secret: String,
    pub authorization_code_encryption_key: String,
    pub provider_kms_master_key: String,
    pub admin_email: String,
    pub admin_password: String,
    pub admin_totp_secret: Vec<u8>,
    pub bind_addr: SocketAddr,
    pub market_data_enabled: bool,
    pub market_refresh_seconds: u64,
    pub market_snapshot_limit: usize,
    pub min_gateway_markup_bps: u64,
    pub cors_allowed_origins: Vec<String>,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let app_environment = env_or("APP_ENV", "development").to_ascii_lowercase();
        if !matches!(
            app_environment.as_str(),
            "development" | "test" | "staging" | "production"
        ) {
            anyhow::bail!("APP_ENV must be development, test, staging, or production");
        }
        let production = app_environment == "production";
        let jwt_secret = secure_secret_env("JWT_SECRET", 32)?;
        let run_token_secret = secure_secret_env("RUN_TOKEN_SECRET", 32)?;
        let authorization_code_encryption_key =
            secure_secret_env("AUTHORIZATION_CODE_ENCRYPTION_KEY", 32)?;
        let provider_kms_master_key =
            secure_secret_env_or_file("PROVIDER_KMS_MASTER_KEY", 32, production)?;
        if jwt_secret == run_token_secret {
            anyhow::bail!("JWT_SECRET and RUN_TOKEN_SECRET must be different");
        }
        if authorization_code_encryption_key == jwt_secret
            || authorization_code_encryption_key == run_token_secret
        {
            anyhow::bail!(
                "AUTHORIZATION_CODE_ENCRYPTION_KEY must be different from JWT_SECRET and RUN_TOKEN_SECRET"
            );
        }
        if provider_kms_master_key == jwt_secret
            || provider_kms_master_key == run_token_secret
            || provider_kms_master_key == authorization_code_encryption_key
        {
            anyhow::bail!(
                "PROVIDER_KMS_MASTER_KEY must be different from JWT_SECRET, RUN_TOKEN_SECRET, and AUTHORIZATION_CODE_ENCRYPTION_KEY"
            );
        }
        let admin_password = secure_secret_env("ADMIN_PASSWORD", 12)?;
        let admin_totp_secret_text = secure_secret_env_or_file("ADMIN_TOTP_SECRET", 32, false)?;
        let admin_totp_secret =
            decode_totp_secret(&admin_totp_secret_text).map_err(anyhow::Error::msg)?;
        let app_base_url = env_or("APP_BASE_URL", "http://localhost:8080");
        if production && !app_base_url.starts_with("https://") {
            anyhow::bail!("APP_BASE_URL must use https:// in production");
        }
        let cors_value = if production {
            required_env("CORS_ALLOWED_ORIGINS")?
        } else {
            env_or(
                "CORS_ALLOWED_ORIGINS",
                "http://localhost:1420,http://127.0.0.1:1420,http://localhost:1421,http://127.0.0.1:1421,http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
            )
        };
        let cors_allowed_origins = parse_origins(&cors_value)?;
        if production
            && cors_allowed_origins
                .iter()
                .any(|origin| is_unsafe_production_origin(origin))
        {
            anyhow::bail!(
                "production CORS origins may only use https:// or the explicit Tauri application origins"
            );
        }
        Ok(Self {
            app_environment,
            database_url: required_env("DATABASE_URL")?,
            redis_url: env_or("REDIS_URL", "redis://redis:6379"),
            app_base_url,
            jwt_secret,
            run_token_secret,
            authorization_code_encryption_key,
            provider_kms_master_key,
            admin_email: env_or("ADMIN_EMAIL", "admin@alpha-studio.local"),
            admin_password,
            admin_totp_secret,
            bind_addr: env_or("BIND_ADDR", "0.0.0.0:8080").parse()?,
            market_data_enabled: env_or("MARKET_DATA_ENABLED", "true")
                .parse::<bool>()
                .unwrap_or(true),
            market_refresh_seconds: env_or("MARKET_REFRESH_SECONDS", "45")
                .parse::<u64>()
                .unwrap_or(45)
                .clamp(15, 300),
            market_snapshot_limit: env_or("MARKET_SNAPSHOT_LIMIT", "8000")
                .parse::<usize>()
                .unwrap_or(8000)
                .clamp(100, 8000),
            min_gateway_markup_bps: env_or("MIN_GATEWAY_MARKUP_BPS", "500")
                .parse::<u64>()
                .unwrap_or(500)
                .min(100_000),
            cors_allowed_origins,
        })
    }
}

fn required_env(key: &str) -> anyhow::Result<String> {
    env::var(key)
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow::anyhow!("{key} is required"))
}

fn secure_secret_env(key: &str, minimum_length: usize) -> anyhow::Result<String> {
    let value = required_env(key)?;
    validate_secret(key, value, minimum_length)
}

fn secure_secret_env_or_file(
    key: &str,
    minimum_length: usize,
    require_file: bool,
) -> anyhow::Result<String> {
    let file_key = format!("{key}_FILE");
    let value = match env::var(&file_key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(path) => fs::read_to_string(&path)
            .map_err(|error| anyhow::anyhow!("failed to read {file_key} at {path}: {error}"))?
            .trim()
            .to_string(),
        None if require_file => {
            anyhow::bail!("{file_key} is required in production; mount it from the deployment KMS or secret manager")
        }
        None => required_env(key)?,
    };
    validate_secret(key, value, minimum_length)
}

fn validate_secret(key: &str, value: String, minimum_length: usize) -> anyhow::Result<String> {
    let lower = value.to_ascii_lowercase();
    if value.len() < minimum_length
        || lower.contains("change-me")
        || lower.contains("changeme")
        || lower == "alpha-admin"
    {
        anyhow::bail!(
            "{key} must be at least {minimum_length} characters and must not use a placeholder value"
        );
    }
    Ok(value)
}

fn env_or(key: &str, fallback: &str) -> String {
    env::var(key)
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn parse_origins(value: &str) -> anyhow::Result<Vec<String>> {
    let origins = value
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if origins.is_empty()
        || origins.iter().any(|origin| {
            !origin.contains("://")
                || !origin.is_ascii()
                || origin.chars().any(char::is_whitespace)
                || origin == "*"
        })
    {
        anyhow::bail!("CORS_ALLOWED_ORIGINS must be a comma-separated list of explicit origins");
    }
    Ok(origins)
}

fn is_unsafe_production_origin(origin: &str) -> bool {
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return false;
    }
    !origin.starts_with("https://")
        || origin.contains("localhost")
        || origin.contains("127.0.0.1")
        || origin.contains("[::1]")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_origins_reject_loopback_and_cleartext_web_origins() {
        assert!(is_unsafe_production_origin("http://admin.example.com"));
        assert!(is_unsafe_production_origin("https://localhost:5173"));
        assert!(!is_unsafe_production_origin("https://admin.example.com"));
        assert!(!is_unsafe_production_origin("tauri://localhost"));
    }

    #[test]
    fn wildcard_cors_origin_is_rejected() {
        assert!(parse_origins("*").is_err());
        assert!(parse_origins("https://admin.example.com").is_ok());
    }
}
