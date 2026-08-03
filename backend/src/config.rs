use std::{env, net::SocketAddr};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub redis_url: String,
    pub app_base_url: String,
    pub jwt_secret: String,
    pub run_token_secret: String,
    pub authorization_code_encryption_key: String,
    pub admin_email: String,
    pub admin_password: String,
    pub bind_addr: SocketAddr,
    pub market_data_enabled: bool,
    pub market_refresh_seconds: u64,
    pub market_snapshot_limit: usize,
    pub min_gateway_markup_bps: u64,
    pub cors_allowed_origins: Vec<String>,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        let jwt_secret = secure_secret_env("JWT_SECRET", 32)?;
        let run_token_secret = secure_secret_env("RUN_TOKEN_SECRET", 32)?;
        let authorization_code_encryption_key =
            secure_secret_env("AUTHORIZATION_CODE_ENCRYPTION_KEY", 32)?;
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
        let admin_password = secure_secret_env("ADMIN_PASSWORD", 12)?;
        Ok(Self {
            database_url: required_env("DATABASE_URL")?,
            redis_url: env_or("REDIS_URL", "redis://redis:6379"),
            app_base_url: env_or("APP_BASE_URL", "http://localhost:8080"),
            jwt_secret,
            run_token_secret,
            authorization_code_encryption_key,
            admin_email: env_or("ADMIN_EMAIL", "admin@alpha-studio.local"),
            admin_password,
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
            cors_allowed_origins: parse_origins(&env_or(
                "CORS_ALLOWED_ORIGINS",
                "http://localhost:1420,http://127.0.0.1:1420,http://localhost:1421,http://127.0.0.1:1421,http://localhost:5173,http://127.0.0.1:5173,tauri://localhost,http://tauri.localhost,https://tauri.localhost",
            ))?,
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
