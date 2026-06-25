use sqlx::{postgres::PgPoolOptions, PgPool};

use crate::config::AppConfig;

pub async fn connect(config: &AppConfig) -> anyhow::Result<PgPool> {
    Ok(PgPoolOptions::new()
        .max_connections(10)
        .connect(&config.database_url)
        .await?)
}

pub async fn migrate(pool: &PgPool) -> anyhow::Result<()> {
    sqlx::migrate!("../migrations").run(pool).await?;
    Ok(())
}

pub fn redis_client(config: &AppConfig) -> Option<redis::Client> {
    redis::Client::open(config.redis_url.as_str()).ok()
}
