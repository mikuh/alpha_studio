//! Task/agent admission and provider-wide backpressure. PostgreSQL is the
//! authority so limits and cooldowns also apply across backend replicas.
use std::time::Duration;

use axum::http::HeaderMap;
use rust_decimal::Decimal;
use serde_json::Value;
use sqlx::{PgPool, Row};
use tokio::time::Instant;

use crate::{
    error::{ApiError, ApiResult},
    tokens::RunTokenClaims,
};

pub const MAX_SUBAGENT_REQUESTS: usize = 2;
pub const MAX_PROVIDER_REQUESTS: i64 = 3;
pub const MAX_RETRY_WAIT: Duration = Duration::from_secs(180);
const POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RequestLane {
    Main,
    Subagent(String),
}

impl RequestLane {
    pub fn key(&self) -> String {
        match self {
            Self::Main => "main".into(),
            Self::Subagent(id) => format!("agent:{id}"),
        }
    }
    pub fn is_subagent(&self) -> bool {
        matches!(self, Self::Subagent(_))
    }

    pub fn from_codex(headers: &HeaderMap, body: &Value) -> Self {
        // Verified against the bundled Codex 0.146.1 responses_metadata.rs.
        // Review/compaction/memory helpers are deliberately not parallel lanes.
        let metadata = body.get("client_metadata");
        let get = |key: &str| {
            metadata
                .and_then(|m| m.get(key))
                .and_then(Value::as_str)
                .or_else(|| headers.get(key).and_then(|h| h.to_str().ok()))
        };
        if get("x-openai-subagent") != Some("collab_spawn") {
            return Self::Main;
        }
        let id = get("thread_id").and_then(|s| uuid::Uuid::parse_str(s).ok());
        let parent = get("x-codex-parent-thread-id").and_then(|s| uuid::Uuid::parse_str(s).ok());
        match (id, parent) {
            (Some(id), Some(parent)) if id != parent => Self::Subagent(id.to_string()),
            _ => Self::Main, // Missing identity never grants extra concurrency.
        }
    }
}

pub async fn reserve_request(
    pool: &PgPool,
    claims: &RunTokenClaims,
    request_id: &str,
    lane: &RequestLane,
    requested_reservation: Option<Decimal>,
    provider_key: Option<&str>,
    wait_timeout: Duration,
) -> ApiResult<Decimal> {
    let mut deadline = Instant::now() + wait_timeout;
    let mut last_generation = None;
    loop {
        crate::routes::ensure_gateway_run_available(pool, claims).await?;
        let mut tx = pool.begin().await?;
        let run = sqlx::query("select tenant_id, user_id, device_id, model_id, status, budget_yuan, accumulated_billable_yuan, active_request_id, request_count from model_runs where id = $1 for update")
            .bind(&claims.run_id).fetch_one(&mut *tx).await?;
        crate::routes::validate_run_claim_bindings(&run, claims)?;
        let remaining = claims.budget_yuan - run.get::<Decimal, _>("accumulated_billable_yuan");
        if !matches!(
            run.get::<String, _>("status").as_str(),
            "created" | "running"
        ) || remaining <= Decimal::ZERO
        {
            return Err(ApiError::Forbidden(
                "task budget is exhausted or task has ended".into(),
            ));
        }
        let leases = sqlx::query(
            "select id, lane, reserved_yuan from gateway_request_leases where run_id = $1",
        )
        .bind(&claims.run_id)
        .fetch_all(&mut *tx)
        .await?;
        let generation = (run.get::<i64, _>("request_count"), leases.len());
        if last_generation.is_some_and(|last| last != generation) {
            deadline = Instant::now() + wait_timeout;
        }
        last_generation = Some(generation);
        let legacy_busy =
            leases.is_empty() && run.get::<Option<String>, _>("active_request_id").is_some();
        let lane_key = lane.key();
        let lane_busy = leases
            .iter()
            .any(|l| l.get::<String, _>("lane") == lane_key);
        let subagents = leases
            .iter()
            .filter(|l| l.get::<String, _>("lane") != "main")
            .count();
        let reserved: Decimal = leases
            .iter()
            .map(|l| l.get::<Decimal, _>("reserved_yuan"))
            .sum();
        // Clamp only against confirmed remaining budget, never against another
        // agent's temporary reservation. A reservation shortage waits to settle.
        let reservation = requested_reservation
            .unwrap_or(remaining)
            .max(Decimal::new(1, 2))
            .min(remaining);
        let available = !legacy_busy
            && !lane_busy
            && leases.len() < MAX_SUBAGENT_REQUESTS + 1
            && (!lane.is_subagent() || subagents < MAX_SUBAGENT_REQUESTS)
            && reservation <= remaining - reserved;
        if available {
            sqlx::query("insert into gateway_request_leases (id, run_id, lane, reserved_yuan, provider_key) values ($1,$2,$3,$4,$5)")
                .bind(request_id).bind(&claims.run_id).bind(lane_key).bind(reservation).bind(provider_key)
                .execute(&mut *tx).await?;
            sqlx::query("update model_runs set status='running', started_at=coalesce(started_at,now()), active_request_id=coalesce(active_request_id,$2), request_count=request_count+1, last_activity_at=now() where id=$1")
                .bind(&claims.run_id).bind(request_id).execute(&mut *tx).await?;
            tx.commit().await?;
            return Ok(reservation);
        }
        tx.rollback().await?;
        if Instant::now() >= deadline {
            return Err(ApiError::GatewayBusy(
                "任务内请求仍在等待前序请求结算或释放预算，尚未发送给模型服务。".into(),
            ));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

pub async fn acquire_dispatch(
    pool: &PgPool,
    provider_key: &str,
    request_id: &str,
    deadline: Instant,
) -> ApiResult<()> {
    sqlx::query(
        "insert into gateway_provider_cooldowns (provider_key) values ($1) on conflict do nothing",
    )
    .bind(provider_key)
    .execute(pool)
    .await?;
    loop {
        let mut tx = pool.begin().await?;
        let state = sqlx::query("select cooldown_until > now() as cooling, recovery_until > now() as recovering from gateway_provider_cooldowns where provider_key=$1 for update")
            .bind(provider_key).fetch_one(&mut *tx).await?;
        let active: i64 = sqlx::query_scalar(
            "select count(*) from gateway_request_leases where provider_key=$1 and dispatching and dispatch_expires_at > now()",
        )
        .bind(provider_key)
        .fetch_one(&mut *tx)
        .await?;
        let limit = if state.get::<bool, _>("recovering") {
            1
        } else {
            MAX_PROVIDER_REQUESTS
        };
        if !state.get::<bool, _>("cooling") && active < limit {
            // The stream's hard deadline bounds the entire dispatch. Keep a
            // settlement margin, then reclaim provider capacity after a crash;
            // never reclaim/replay the uncertain task's budget lease here.
            let lifetime = deadline
                .saturating_duration_since(Instant::now())
                .max(crate::gateway::MAX_STREAM_DURATION)
                .as_secs_f64()
                + 30.0;
            let changed = sqlx::query("update gateway_request_leases set dispatching=true, dispatch_expires_at=now()+($3::double precision * interval '1 second') where id=$1 and provider_key=$2 and not dispatching")
                .bind(request_id).bind(provider_key).bind(lifetime).execute(&mut *tx).await?;
            if changed.rows_affected() != 1 {
                return Err(ApiError::Conflict(
                    "model request no longer owns its dispatch lease".into(),
                ));
            }
            tx.commit().await?;
            return Ok(());
        }
        tx.rollback().await?;
        if Instant::now() >= deadline {
            return Err(ApiError::GatewayBusy(
                "模型通道正在限流冷却或等待可用名额，请稍后继续。".into(),
            ));
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }
}

pub async fn record_rate_limit(
    pool: &PgPool,
    provider_key: &str,
    request_id: &str,
    delay: Duration,
) -> ApiResult<()> {
    let mut tx = pool.begin().await?;
    // Lock in the same order as acquire_dispatch. Existing dispatched requests
    // may finish, but no new request bypasses this shared cooldown.
    sqlx::query("update gateway_provider_cooldowns set cooldown_until=greatest(cooldown_until,now()+($2::double precision * interval '1 second')), recovery_until=greatest(recovery_until,now()+(($2::double precision+60) * interval '1 second')) where provider_key=$1")
        .bind(provider_key).bind(delay.as_secs_f64()).execute(&mut *tx).await?;
    sqlx::query(
        "update gateway_request_leases set dispatching=false where id=$1 and provider_key=$2",
    )
    .bind(request_id)
    .bind(provider_key)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

#[cfg(test)]
pub(crate) async fn test_run() -> Option<(PgPool, RunTokenClaims)> {
    let url = std::env::var("ALPHA_STUDIO_TEST_DATABASE_URL").ok()?;
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(8)
        .connect(&url)
        .await
        .unwrap();
    sqlx::migrate!("../migrations").run(&pool).await.unwrap();
    let suffix = uuid::Uuid::new_v4().simple().to_string();
    let tenant = format!("parallel_t_{suffix}");
    let user = format!("parallel_u_{suffix}");
    let device = format!("parallel_d_{suffix}");
    let run = format!("parallel_r_{suffix}");
    sqlx::query("insert into tenants (id,name,company_key,balance_yuan) values ($1,$1,$1,100)")
        .bind(&tenant)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("insert into users (id,tenant_id,email,name) values ($1,$2,$1,'Test')")
        .bind(&user)
        .bind(&tenant)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query("insert into devices (id,tenant_id,user_id,fingerprint,name,lease_expires_at) values ($1,$2,$3,$1,'Test',now()+interval '1 day')")
        .bind(&device).bind(&tenant).bind(&user).execute(&pool).await.unwrap();
    sqlx::query("insert into model_runs (id,tenant_id,user_id,device_id,model_id,mode,status,budget_yuan) values ($1,$2,$3,$4,'test-model','gateway_api','created',5)")
        .bind(&run).bind(&tenant).bind(&user).bind(&device).execute(&pool).await.unwrap();
    Some((
        pool,
        RunTokenClaims::new(
            tenant,
            user,
            device,
            run,
            "test-model".into(),
            Decimal::from(5),
            3600,
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn only_identified_spawned_threads_get_parallel_lanes() {
        let id = uuid::Uuid::new_v4().to_string();
        let parent = uuid::Uuid::new_v4().to_string();
        let metadata = json!({"thread_id":id,"x-codex-parent-thread-id":parent,"x-openai-subagent":"collab_spawn"});
        assert_eq!(
            RequestLane::from_codex(&HeaderMap::new(), &json!({"client_metadata":metadata})),
            RequestLane::Subagent(id)
        );
        for kind in ["compact", "review", "memory_consolidation", "unknown"] {
            let mut metadata = metadata.clone();
            metadata["x-openai-subagent"] = json!(kind);
            assert_eq!(
                RequestLane::from_codex(&HeaderMap::new(), &json!({"client_metadata":metadata})),
                RequestLane::Main
            );
        }
        assert_eq!(
            RequestLane::from_codex(
                &HeaderMap::new(),
                &json!({"client_metadata":{"x-openai-subagent":"collab_spawn"}})
            ),
            RequestLane::Main
        );
    }

    #[tokio::test]
    async fn database_limits_agents_and_reserves_shared_budget_without_charging() {
        let Some((pool, claims)) = test_run().await else {
            return;
        };
        let wait = Duration::from_millis(30);
        let provider = &claims.run_id;
        for (id, lane) in [
            ("main", RequestLane::Main),
            ("a", RequestLane::Subagent("a".into())),
            ("b", RequestLane::Subagent("b".into())),
        ] {
            reserve_request(
                &pool,
                &claims,
                &format!("{provider}-{id}"),
                &lane,
                Some(Decimal::ONE),
                Some(provider),
                wait,
            )
            .await
            .unwrap();
        }
        for lane in [
            RequestLane::Main,
            RequestLane::Subagent("a".into()),
            RequestLane::Subagent("c".into()),
        ] {
            let error = reserve_request(
                &pool,
                &claims,
                &format!("{provider}-blocked"),
                &lane,
                Some(Decimal::ONE),
                Some(provider),
                wait,
            )
            .await
            .unwrap_err();
            assert!(matches!(error, ApiError::GatewayBusy(_)));
        }
        let reserved: Decimal = sqlx::query_scalar(
            "select sum(reserved_yuan) from gateway_request_leases where run_id=$1",
        )
        .bind(provider)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(reserved, Decimal::from(3));
        let balance: Decimal = sqlx::query_scalar("select balance_yuan from tenants where id=$1")
            .bind(&claims.tenant_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(balance, Decimal::from(100));
    }

    #[tokio::test]
    async fn temporary_budget_reservations_do_not_overcommit() {
        let Some((pool, claims)) = test_run().await else {
            return;
        };
        let wait = Duration::from_millis(30);
        reserve_request(
            &pool,
            &claims,
            &format!("{}-a", claims.run_id),
            &RequestLane::Subagent("a".into()),
            Some(Decimal::from(4)),
            None,
            wait,
        )
        .await
        .unwrap();
        let error = reserve_request(
            &pool,
            &claims,
            &format!("{}-b", claims.run_id),
            &RequestLane::Subagent("b".into()),
            Some(Decimal::from(4)),
            None,
            wait,
        )
        .await
        .unwrap_err();
        assert!(matches!(error, ApiError::GatewayBusy(_)));
        let count: i64 =
            sqlx::query_scalar("select count(*) from gateway_request_leases where run_id=$1")
                .bind(&claims.run_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn provider_cooldown_is_shared_and_recovery_allows_only_one_probe() {
        let Some((pool, claims)) = test_run().await else {
            return;
        };
        let key = &claims.run_id;
        let a = format!("{key}-a");
        let b = format!("{key}-b");
        for (id, lane) in [
            (&a, RequestLane::Main),
            (&b, RequestLane::Subagent("b".into())),
        ] {
            reserve_request(
                &pool,
                &claims,
                id,
                &lane,
                Some(Decimal::ONE),
                Some(key),
                Duration::from_secs(1),
            )
            .await
            .unwrap();
        }
        acquire_dispatch(&pool, key, &a, Instant::now() + Duration::from_secs(1))
            .await
            .unwrap();
        record_rate_limit(&pool, key, &a, Duration::from_secs(10))
            .await
            .unwrap();
        assert!(matches!(
            acquire_dispatch(&pool, key, &b, Instant::now() + Duration::from_millis(30))
                .await
                .unwrap_err(),
            ApiError::GatewayBusy(_)
        ));
        // Simulate cooldown expiry in the isolated database, without sleeping.
        sqlx::query("update gateway_provider_cooldowns set cooldown_until=now()-interval '1 second' where provider_key=$1").bind(key).execute(&pool).await.unwrap();
        acquire_dispatch(&pool, key, &a, Instant::now() + Duration::from_secs(1))
            .await
            .unwrap();
        assert!(matches!(
            acquire_dispatch(&pool, key, &b, Instant::now() + Duration::from_millis(30))
                .await
                .unwrap_err(),
            ApiError::GatewayBusy(_)
        ));
    }
}
