use std::{env, net::SocketAddr};

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub redis_url: String,
    pub app_base_url: String,
    pub jwt_secret: String,
    pub run_token_secret: String,
    pub admin_email: String,
    pub admin_password: String,
    pub bind_addr: SocketAddr,
    pub market_data_enabled: bool,
    pub market_refresh_seconds: u64,
    pub market_snapshot_limit: usize,
}

impl AppConfig {
    pub fn from_env() -> anyhow::Result<Self> {
        Ok(Self {
            database_url: required_env("DATABASE_URL")?,
            redis_url: env_or("REDIS_URL", "redis://redis:6379"),
            app_base_url: env_or("APP_BASE_URL", "http://localhost:8080"),
            jwt_secret: env_or("JWT_SECRET", "dev-jwt-secret-change-me"),
            run_token_secret: env_or("RUN_TOKEN_SECRET", "dev-run-secret-change-me"),
            admin_email: env_or("ADMIN_EMAIL", "admin@alpha-studio.local"),
            admin_password: env_or("ADMIN_PASSWORD", "alpha-admin"),
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

fn env_or(key: &str, fallback: &str) -> String {
    env::var(key)
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
