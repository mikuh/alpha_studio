use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicI64, AtomicUsize, Ordering},
        Arc, Mutex as StdMutex, Weak,
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
    lanes: Mutex<HashMap<String, Weak<Semaphore>>>,
    subagents: Arc<Semaphore>,
    progress: watch::Sender<u64>,
    waiting: AtomicUsize,
    active: AtomicUsize,
    last_output_at: AtomicI64,
    output: StdMutex<HashMap<String, crate::gateway_output::RequestProgress>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GatewayRunStatus {
    active: bool,
    waiting_requests: usize,
    last_output_at: i64,
    request_progress: Vec<crate::gateway_output::RequestProgress>,
}

pub struct GatewayWaiter(Arc<GatewayRunGate>);

impl Drop for GatewayWaiter {
    fn drop(&mut self) {
        self.0.waiting.fetch_sub(1, Ordering::Relaxed);
    }
}

pub struct GatewayRunPermit {
    permit: Option<OwnedSemaphorePermit>,
    subagent_permit: Option<OwnedSemaphorePermit>,
    gate: Arc<GatewayRunGate>,
    lane_key: String,
}

impl GatewayRunPermit {
    pub fn record_model_data(&self, data: &str) {
        if let Ok(mut output) = self.gate.output.lock() {
            let progress = output.entry(self.lane_key.clone()).or_insert_with(|| {
                crate::gateway_output::RequestProgress::new(self.lane_key.clone())
            });
            if progress.observe(data) {
                self.record_output();
            }
        }
    }

    pub fn record_model_sse(&self, output: &str) {
        for frame in crate::gateway_stream::SseDecoder::default().push(output.as_bytes()) {
            if let Some(data) = frame.data {
                self.record_model_data(&data);
            }
        }
    }

    pub fn waiting_for_admission(&self) -> GatewayWaiter {
        self.gate.waiting.fetch_add(1, Ordering::Relaxed);
        GatewayWaiter(self.gate.clone())
    }

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
        self.gate.active.fetch_sub(1, Ordering::Relaxed);
        if let Ok(mut output) = self.gate.output.lock() {
            output.remove(&self.lane_key);
        }
        self.permit.take();
        self.subagent_permit.take();
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
        let mut request_progress: Vec<_> = gate
            .output
            .lock()
            .ok()?
            .values()
            .filter(|p| p.updated_at > 0)
            .cloned()
            .collect();
        request_progress.sort_by(|a, b| a.id.cmp(&b.id));
        Some(GatewayRunStatus {
            active: gate.active.load(Ordering::Relaxed) > 0,
            waiting_requests: gate.waiting.load(Ordering::Relaxed),
            last_output_at: gate.last_output_at.load(Ordering::Relaxed),
            request_progress,
        })
    }

    pub async fn acquire(&self, run_id: &str, wait_timeout: Duration) -> Option<GatewayRunPermit> {
        self.acquire_lane(
            run_id,
            &crate::gateway_admission::RequestLane::Main,
            wait_timeout,
        )
        .await
    }

    pub async fn acquire_lane(
        &self,
        run_id: &str,
        lane: &crate::gateway_admission::RequestLane,
        wait_timeout: Duration,
    ) -> Option<GatewayRunPermit> {
        let gate = {
            let mut gates = self.gates.lock().await;
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(run_id).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(GatewayRunGate {
                    lanes: Mutex::new(HashMap::new()),
                    subagents: Arc::new(Semaphore::new(
                        crate::gateway_admission::MAX_SUBAGENT_REQUESTS,
                    )),
                    progress: watch::channel(0).0,
                    waiting: AtomicUsize::new(0),
                    active: AtomicUsize::new(0),
                    last_output_at: AtomicI64::new(0),
                    output: StdMutex::new(HashMap::new()),
                });
                gates.insert(run_id.to_string(), Arc::downgrade(&gate));
                gate
            }
        };

        gate.waiting.fetch_add(1, Ordering::Relaxed);
        let _waiter = GatewayWaiter(gate.clone());
        let mut progress = gate.progress.subscribe();
        let lane_gate = {
            let mut lanes = gate.lanes.lock().await;
            lanes.retain(|_, lane| lane.strong_count() > 0);
            if let Some(existing) = lanes.get(&lane.key()).and_then(Weak::upgrade) {
                existing
            } else {
                let semaphore = Arc::new(Semaphore::new(1));
                lanes.insert(lane.key(), Arc::downgrade(&semaphore));
                semaphore
            }
        };
        let acquisition = async {
            let permit = lane_gate.acquire_owned().await.ok()?;
            let subagent_permit = if lane.is_subagent() {
                Some(gate.subagents.clone().acquire_owned().await.ok()?)
            } else {
                None
            };
            Some((permit, subagent_permit))
        };
        tokio::pin!(acquisition);
        loop {
            tokio::select! {
                biased;
                permit = &mut acquisition => {
                    return permit.map(|(permit, subagent_permit)| {
                        if gate.active.fetch_add(1, Ordering::Relaxed) == 0 { gate.last_output_at.store(0, Ordering::Relaxed); }
                        GatewayRunPermit { permit: Some(permit), subagent_permit, gate: gate.clone(), lane_key: lane.key() }
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
    async fn live_previews_are_scoped_to_their_active_agent_and_ignore_keepalives() {
        use crate::gateway_admission::RequestLane;
        let queue = GatewayRunQueue::default();
        let main = queue
            .acquire("preview", Duration::from_secs(1))
            .await
            .unwrap();
        let child = queue
            .acquire_lane(
                "preview",
                &RequestLane::Subagent("child".into()),
                Duration::from_secs(1),
            )
            .await
            .unwrap();
        main.record_model_data(r#"{"type":"response.created"}"#);
        assert_eq!(queue.status("preview").await.unwrap().last_output_at, 0);
        child.record_model_sse(
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Child progress\"}\n\n",
        );
        let status = queue.status("preview").await.unwrap();
        assert_eq!(status.request_progress.len(), 1);
        assert_eq!(status.request_progress[0].preview, "Child progress");
        assert!(status.request_progress[0].subagent);
        drop(child);
        assert!(queue
            .status("preview")
            .await
            .unwrap()
            .request_progress
            .is_empty());
        drop(main);
        assert!(queue.status("preview").await.is_none());
    }

    #[tokio::test]
    async fn spawned_agents_can_overlap_but_each_lane_and_fanout_are_bounded() {
        use crate::gateway_admission::RequestLane;
        let queue = GatewayRunQueue::default();
        let wait = Duration::from_millis(20);
        let main = queue.acquire("parallel", wait).await.unwrap();
        let admission = main.waiting_for_admission();
        assert_eq!(queue.status("parallel").await.unwrap().waiting_requests, 1);
        drop(admission);
        assert_eq!(queue.status("parallel").await.unwrap().waiting_requests, 0);
        let a = queue
            .acquire_lane("parallel", &RequestLane::Subagent("a".into()), wait)
            .await
            .unwrap();
        let b = queue
            .acquire_lane("parallel", &RequestLane::Subagent("b".into()), wait)
            .await
            .unwrap();
        assert!(queue.acquire("parallel", wait).await.is_none());
        assert!(queue
            .acquire_lane("parallel", &RequestLane::Subagent("a".into()), wait)
            .await
            .is_none());
        assert!(queue
            .acquire_lane("parallel", &RequestLane::Subagent("c".into()), wait)
            .await
            .is_none());
        drop(a);
        let c = queue
            .acquire_lane("parallel", &RequestLane::Subagent("c".into()), wait)
            .await
            .unwrap();
        drop(main);
        assert!(queue.status("parallel").await.unwrap().active);
        drop((b, c));
        assert!(queue.status("parallel").await.is_none());
    }

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
