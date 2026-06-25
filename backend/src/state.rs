use std::sync::Arc;

use reqwest::Client;
use sqlx::PgPool;

use crate::{config::AppConfig, tokens::RunTokenService};

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<AppConfig>,
    pub db: PgPool,
    pub redis: Option<redis::Client>,
    pub http: Client,
    pub run_tokens: RunTokenService,
}

impl AppState {
    pub fn new(config: AppConfig, db: PgPool, redis: Option<redis::Client>) -> Self {
        let run_tokens = RunTokenService::new(config.run_token_secret.clone());
        Self {
            config: Arc::new(config),
            db,
            redis,
            http: Client::new(),
            run_tokens,
        }
    }
}
