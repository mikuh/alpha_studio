use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering},
        Arc, Weak,
    },
    time::Duration,
};

use reqwest::Client;
use sqlx::{PgPool, Row};
use tokio::sync::{watch, Mutex, OwnedSemaphorePermit, Semaphore};

use crate::{
    config::AppConfig,
    market::{MarketCapitalFlowHub, MarketDataHub},
    observability::HttpMetrics,
    secrets::{AuthorizationCodeCipher, ManagedSecretCipher},
    tokens::{AdminTokenService, DeviceTokenService, RunTokenService},
};

#[derive(Clone, Default)]
pub struct GatewayRunQueue {
    gates: Arc<Mutex<HashMap<String, Weak<GatewayRunGate>>>>,
}

struct GatewayRunGate {
    semaphore: Arc<Semaphore>,
    progress: watch::Sender<u64>,
    waiting: AtomicUsize,
    active: AtomicBool,
    last_output_at: AtomicI64,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRunStatus {
    active: bool,
    waiting_requests: usize,
    last_output_at: i64,
}

struct GatewayWaiter(Arc<GatewayRunGate>);

impl Drop for GatewayWaiter {
    fn drop(&mut self) {
        self.0.waiting.fetch_sub(1, Ordering::Relaxed);
    }
}

pub struct GatewayRunPermit {
    permit: Option<OwnedSemaphorePermit>,
    gate: Arc<GatewayRunGate>,
}

impl GatewayRunPermit {
    pub fn record_output(&self) {
        self.gate
            .last_output_at
            .store(chrono::Utc::now().timestamp_millis(), Ordering::Relaxed);
    }
}

impl Drop for GatewayRunPermit {
    fn drop(&mut self) {
        // Release the slot before waking waiters. The acquisition future stays
        // enqueued while observing progress, preserving semaphore FIFO order.
        self.gate.active.store(false, Ordering::Relaxed);
        self.permit.take();
        self.gate
            .progress
            .send_modify(|generation| *generation += 1);
    }
}

impl GatewayRunQueue {
    pub async fn status(&self, run_id: &str) -> Option<GatewayRunStatus> {
        let gate = self
            .gates
            .lock()
            .await
            .get(run_id)
            .and_then(Weak::upgrade)?;
        Some(GatewayRunStatus {
            active: gate.active.load(Ordering::Relaxed),
            waiting_requests: gate.waiting.load(Ordering::Relaxed),
            last_output_at: gate.last_output_at.load(Ordering::Relaxed),
        })
    }

    pub async fn acquire(&self, run_id: &str, wait_timeout: Duration) -> Option<GatewayRunPermit> {
        let gate = {
            let mut gates = self.gates.lock().await;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(run_id).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(GatewayRunGate {
                    semaphore: Arc::new(Semaphore::new(1)),
                    progress: watch::channel(0).0,
                    waiting: AtomicUsize::new(0),
                    active: AtomicBool::new(false),
                    last_output_at: AtomicI64::new(0),
                });
                gates.insert(run_id.to_string(), Arc::downgrade(&gate));
                gate
            }
        };

        gate.waiting.fetch_add(1, Ordering::Relaxed);
        let _waiter = GatewayWaiter(gate.clone());
        let mut progress = gate.progress.subscribe();
        let acquisition = gate.semaphore.clone().acquire_owned();
        tokio::pin!(acquisition);
        loop {
            tokio::select! {
                biased;
                permit = &mut acquisition => {
                    gate.active.store(permit.is_ok(), Ordering::Relaxed);
                    gate.last_output_at.store(0, Ordering::Relaxed);
                    return permit.ok().map(|permit| GatewayRunPermit {
                        permit: Some(permit), gate,
                    });
                }
                changed = progress.changed() => {
                    if changed.is_err() { return None; }
                }
                _ = tokio::time::sleep(wait_timeout) => return None,
            }
        }
    }
}

#[derive(Clone)]
pub struct AppState {
    pub agent_data_relay: crate::agent_network::RelayLimits,
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
            agent_data_relay: crate::agent_network::RelayLimits::default(),
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

    #[tokio::test(start_paused = true)]
    async fn gateway_queue_deadline_restarts_when_a_predecessor_finishes() {
        let queue = GatewayRunQueue::default();
        let owner = queue
            .acquire("run_progress", Duration::from_secs(180))
            .await
            .unwrap();
        let first_queue = queue.clone();
        let first = tokio::spawn(async move {
            let permit = first_queue
                .acquire("run_progress", Duration::from_secs(180))
                .await
                .unwrap();
            permit.record_output();
            tokio::time::sleep(Duration::from_secs(178)).await;
            drop(permit);
        });
        tokio::task::yield_now().await;
        let last_queue = queue.clone();
        let last = tokio::spawn(async move {
            last_queue
                .acquire("run_progress", Duration::from_secs(180))
                .await
        });
        tokio::task::yield_now().await;
        assert_eq!(
            queue.status("run_progress").await.unwrap().waiting_requests,
            2
        );

        tokio::time::advance(Duration::from_secs(10)).await;
        drop(owner);
        tokio::task::yield_now().await;
        let status = queue.status("run_progress").await.unwrap();
        assert!(status.active);
        assert!(status.last_output_at > 0);
        assert_eq!(status.waiting_requests, 1);
        tokio::time::advance(Duration::from_secs(171)).await;
        tokio::task::yield_now().await;
        assert!(
            !last.is_finished(),
            "total queue time must not exhaust the head request's deadline"
        );
        tokio::time::advance(Duration::from_secs(7)).await;
        first.await.unwrap();
        let permit = last
            .await
            .unwrap()
            .expect("healthy predecessor should unblock the queued request");
        drop(permit);
        assert!(queue.status("run_progress").await.is_none());
    }

    #[tokio::test]
    async fn cancelled_queue_waiters_do_not_leave_phantom_progress() {
        let queue = GatewayRunQueue::default();
        let owner = queue
            .acquire("run_cancel", Duration::from_secs(1))
            .await
            .unwrap();
        let pending_queue = queue.clone();
        let waiter = tokio::spawn(async move {
            pending_queue
                .acquire("run_cancel", Duration::from_secs(1))
                .await
        });
        tokio::task::yield_now().await;
        assert_eq!(
            queue.status("run_cancel").await.unwrap().waiting_requests,
            1
        );
        waiter.abort();
        let _ = waiter.await;
        assert_eq!(
            queue.status("run_cancel").await.unwrap().waiting_requests,
            0
        );
        assert!(queue.status("another_run").await.is_none());
        drop(owner);
        assert!(queue.status("run_cancel").await.is_none());
    }
}
