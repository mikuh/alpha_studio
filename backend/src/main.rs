use alpha_studio_backend::{
    build_router,
    config::AppConfig,
    db,
    license::{hash_authorization_code, normalize_authorization_code},
    secrets::AuthorizationCodeCipher,
    state::AppState,
};
use tokio::io::AsyncReadExt;
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
    if command.as_deref() == Some("protect-authorization-code") {
        db::migrate(&pool).await?;
        let id = std::env::args()
            .nth(2)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| anyhow::anyhow!("authorization code id is required"))?;
        let mut plaintext = String::new();
        tokio::io::stdin().read_to_string(&mut plaintext).await?;
        let normalized = normalize_authorization_code(&plaintext);
        if normalized.is_empty() {
            anyhow::bail!("authorization code plaintext is required on stdin");
        }
        let code_hash = hash_authorization_code(&normalized);
        let cipher = AuthorizationCodeCipher::new(&config.authorization_code_encryption_key);
        let code_ciphertext = cipher.encrypt(&normalized)?;
        let result = sqlx::query(
            r#"
            update authorization_codes
            set code_ciphertext = $3, code_plaintext = null
            where id = $1 and code_hash = $2
            "#,
        )
        .bind(&id)
        .bind(code_hash)
        .bind(code_ciphertext)
        .execute(&pool)
        .await?;
        if result.rows_affected() != 1 {
            anyhow::bail!("authorization code id and plaintext did not match");
        }
        tracing::info!(authorization_code_id = %id, "authorization code protected");
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
    state.start_market_feed();
    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "alpha studio backend listening");
    axum::serve(listener, app).await?;
    Ok(())
}
