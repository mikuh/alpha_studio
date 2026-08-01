use std::sync::Arc;

use reqwest::Client;
use sqlx::PgPool;

use crate::{config::AppConfig, market::MarketDataHub, tokens::RunTokenService};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db: PgPool,
    pub redis: Option<redis::Client>,
    pub http: Client,
    pub run_tokens: RunTokenService,
    pub market: MarketDataHub,
}

impl AppState {
    pub fn new(config: AppConfig, db: PgPool, redis: Option<redis::Client>) -> Self {
        let run_tokens = RunTokenService::new(config.run_token_secret.clone());
        let market =
            MarketDataHub::new(config.market_refresh_seconds, config.market_snapshot_limit);
        Self {
            config: Arc::new(config),
            db,
            redis,
            http: Client::new(),
            run_tokens,
            market,
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
