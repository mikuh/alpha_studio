use std::{
    collections::HashMap,
    sync::{Arc, Weak},
    time::Duration,
};

use reqwest::Client;
use sqlx::{PgPool, Row};
use tokio::sync::{Mutex, OwnedSemaphorePermit, Semaphore};

use crate::{
    config::AppConfig,
    market::{MarketCapitalFlowHub, MarketDataHub},
    observability::HttpMetrics,
    secrets::{AuthorizationCodeCipher, ManagedSecretCipher},
    tokens::{AdminTokenService, DeviceTokenService, RunTokenService},
};

#[derive(Clone, Default)]
pub struct GatewayRunQueue {
    gates: Arc<Mutex<HashMap<String, Weak<Semaphore>>>>,
}

impl GatewayRunQueue {
    pub async fn acquire(
        &self,
        run_id: &str,
        wait_timeout: Duration,
    ) -> Option<OwnedSemaphorePermit> {
        let gate = {
            let mut gates = self.gates.lock().await;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(run_id).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(Semaphore::new(1));
                gates.insert(run_id.to_string(), Arc::downgrade(&gate));
                gate
            }
        };

        tokio::time::timeout(wait_timeout, gate.acquire_owned())
            .await
            .ok()
            .and_then(Result::ok)
    }
}

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
    pub gateway_run_queue: GatewayRunQueue,
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
            gateway_run_queue: GatewayRunQueue::default(),
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

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use tokio::sync::mpsc;

    use super::GatewayRunQueue;

    #[tokio::test]
    async fn gateway_run_queue_serves_waiters_in_arrival_order() {
        let queue = GatewayRunQueue::default();
        let owner = queue
            .acquire("run_fifo", Duration::from_secs(1))
            .await
            .unwrap();
        let (ready_tx, mut ready_rx) = mpsc::channel(3);
        let (order_tx, mut order_rx) = mpsc::channel(3);
        let mut waiters = Vec::new();

        for position in 1..=3 {
            let queue = queue.clone();
            let ready_tx = ready_tx.clone();
            let order_tx = order_tx.clone();
            waiters.push(tokio::spawn(async move {
                ready_tx.send(position).await.unwrap();
                let permit = queue
                    .acquire("run_fifo", Duration::from_secs(1))
                    .await
                    .unwrap();
                order_tx.send(position).await.unwrap();
                tokio::task::yield_now().await;
                drop(permit);
            }));
            assert_eq!(ready_rx.recv().await, Some(position));
            tokio::task::yield_now().await;
        }

        drop(owner);
        for expected in 1..=3 {
            assert_eq!(order_rx.recv().await, Some(expected));
        }
        for waiter in waiters {
            waiter.await.unwrap();
        }
    }

    #[tokio::test]
    async fn gateway_run_queue_honors_the_wait_timeout() {
        let queue = GatewayRunQueue::default();
        let _owner = queue
            .acquire("run_timeout", Duration::from_secs(1))
            .await
            .unwrap();

        assert!(queue
            .acquire("run_timeout", Duration::from_millis(20))
            .await
            .is_none());
    }
}
