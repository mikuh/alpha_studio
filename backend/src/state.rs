use std::sync::Arc;

use reqwest::Client;
use sqlx::{PgPool, Row};

use crate::{
    config::AppConfig,
    market::{MarketCapitalFlowHub, MarketDataHub},
    observability::HttpMetrics,
    secrets::{AuthorizationCodeCipher, ManagedSecretCipher},
    tokens::{AdminTokenService, DeviceTokenService, RunTokenService},
};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db: PgPool,
    pub redis: Option<redis::Client>,
    pub http: Client,
    pub run_tokens: RunTokenService,
    pub admin_tokens: AdminTokenService,
    pub device_tokens: DeviceTokenService,
    pub authorization_code_cipher: AuthorizationCodeCipher,
    pub managed_secret_cipher: ManagedSecretCipher,
    pub market: MarketDataHub,
    pub capital_flow: MarketCapitalFlowHub,
    pub http_metrics: HttpMetrics,
}

impl AppState {
    pub fn new(config: AppConfig, db: PgPool, redis: Option<redis::Client>) -> Self {
        let run_tokens = RunTokenService::new(config.run_token_secret.clone());
        let admin_tokens = AdminTokenService::new(config.jwt_secret.clone());
        let device_tokens = DeviceTokenService::new(config.jwt_secret.clone());
        let authorization_code_cipher =
            AuthorizationCodeCipher::new(&config.authorization_code_encryption_key);
        let managed_secret_cipher = ManagedSecretCipher::new(&config.provider_kms_master_key);
        let market =
            MarketDataHub::new(config.market_refresh_seconds, config.market_snapshot_limit);
        let capital_flow = MarketCapitalFlowHub::new(config.market_refresh_seconds);
        Self {
            config: Arc::new(config),
            db,
            redis,
            http: Client::new(),
            run_tokens,
            admin_tokens,
            device_tokens,
            authorization_code_cipher,
            managed_secret_cipher,
            market,
            capital_flow,
            http_metrics: HttpMetrics::default(),
        }
    }

    pub async fn migrate_legacy_managed_secrets(&self) -> anyhow::Result<()> {
        let provider_rows = sqlx::query(
            "select provider, api_key from provider_configs where api_key <> '' and api_key_ciphertext = ''",
        )
        .fetch_all(&self.db)
        .await?;
        let provider_count = provider_rows.len();
        for row in provider_rows {
            let provider = row.get::<String, _>("provider");
            let plaintext = row.get::<String, _>("api_key");
            let ciphertext = self
                .managed_secret_cipher
                .encrypt_provider_api_key(&plaintext)?;
            sqlx::query(
                "update provider_configs set api_key_ciphertext = $2, api_key = '', updated_at = now() where provider = $1 and api_key = $3 and api_key_ciphertext = ''",
            )
            .bind(&provider)
            .bind(ciphertext)
            .bind(&plaintext)
            .execute(&self.db)
            .await?;
        }

        let codex_rows = sqlx::query(
            "select id, login_secret from codex_accounts where login_secret <> '' and login_secret_ciphertext = ''",
        )
        .fetch_all(&self.db)
        .await?;
        let codex_count = codex_rows.len();
        for row in codex_rows {
            let id = row.get::<String, _>("id");
            let plaintext = row.get::<String, _>("login_secret");
            let ciphertext = self
                .managed_secret_cipher
                .encrypt_codex_login_secret(&plaintext)?;
            sqlx::query(
                "update codex_accounts set login_secret_ciphertext = $2, login_secret = '', updated_at = now() where id = $1 and login_secret = $3 and login_secret_ciphertext = ''",
            )
            .bind(&id)
            .bind(ciphertext)
            .bind(&plaintext)
            .execute(&self.db)
            .await?;
        }
        if provider_count > 0 || codex_count > 0 {
            tracing::info!(
                provider_keys = provider_count,
                account_secrets = codex_count,
                "migrated legacy plaintext credentials into KMS-protected ciphertext"
            );
        }
        Ok(())
    }

    pub fn start_market_feed(&self) {
        if !self.config.market_data_enabled {
            tracing::info!("cloud market feed is disabled");
            return;
        }
        let hub = self.market.clone();
        let http = self.http.clone();
        let redis = self.redis.clone();
        tokio::spawn(async move {
            loop {
                if let Err(error) = hub.refresh(&http, redis.as_ref()).await {
                    tracing::warn!(%error, "cloud market refresh failed");
                }
                tokio::time::sleep(std::time::Duration::from_secs(hub.refresh_seconds())).await;
            }
        });
    }
}
