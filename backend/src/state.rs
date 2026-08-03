use std::sync::Arc;

use reqwest::Client;
use sqlx::PgPool;

use crate::{
    config::AppConfig,
    market::{MarketCapitalFlowHub, MarketDataHub},
    secrets::AuthorizationCodeCipher,
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
    pub market: MarketDataHub,
    pub capital_flow: MarketCapitalFlowHub,
}

impl AppState {
    pub fn new(config: AppConfig, db: PgPool, redis: Option<redis::Client>) -> Self {
        let run_tokens = RunTokenService::new(config.run_token_secret.clone());
        let admin_tokens = AdminTokenService::new(config.jwt_secret.clone());
        let device_tokens = DeviceTokenService::new(config.jwt_secret.clone());
        let authorization_code_cipher =
            AuthorizationCodeCipher::new(&config.authorization_code_encryption_key);
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
            market,
            capital_flow,
        }
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
