use alpha_studio_backend::{build_router, config::AppConfig, db, state::AppState};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    let config = AppConfig::from_env()?;
    let command = std::env::args().nth(1);
    let pool = db::connect(&config).await?;

    if command.as_deref() == Some("migrate") {
        db::migrate(&pool).await?;
        tracing::info!("migrations completed");
        return Ok(());
    }
    if command.as_deref() == Some("healthcheck") {
        sqlx::query("select 1").execute(&pool).await?;
        if let Some(client) = db::redis_client(&config) {
            let mut connection = client.get_multiplexed_async_connection().await?;
            let _: String = redis::cmd("PING").query_async(&mut connection).await?;
        }
        return Ok(());
    }

    db::migrate(&pool).await?;
    let bind_addr = config.bind_addr;
    let redis = db::redis_client(&config);
    let state = AppState::new(config, pool, redis);
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "alpha studio backend listening");
    axum::serve(listener, app).await?;
    Ok(())
}
