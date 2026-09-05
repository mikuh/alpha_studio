//! Real PostgreSQL and local HTTP regressions; no paid provider requests.
use super::*;
use crate::gateway::UpstreamResponseFormat;
use crate::gateway_admission::{acquire_dispatch, reserve_request, test_run};
use std::sync::{Arc, Mutex};

#[test]
fn retry_after_is_a_minimum_and_local_waiting_is_not_http_429() {
    let mut headers = HeaderMap::new();
    headers.insert("retry-after", "30".parse().unwrap());
    let delay = retry_delay(&headers, 0);
    assert!(delay >= Duration::from_secs(30) && delay <= Duration::from_millis(30_250));
    headers.insert(
        "retry-after",
        (Utc::now() + chrono::Duration::seconds(60))
            .to_rfc2822()
            .parse()
            .unwrap(),
    );
    assert!(retry_delay(&headers, 0) >= Duration::from_secs(59));
    assert_eq!(
        ApiError::GatewayBusy("waiting".into())
            .into_response()
            .status(),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn real_http_retries_are_bounded_and_keep_the_same_request_identity() {
    // Short-lived rate limit, long Retry-After, billing error, server error and
    // ambiguous timeout. Only the first case can safely be retried here.
    for (kind, first_status, retry_after, expected_calls) in [
        ("transient", 429, "0", 2),
        ("long_wait", 429, "300", 1),
        ("insufficient_quota", 429, "0", 1),
        ("server_error", 503, "0", 1),
        ("timeout", 200, "0", 1),
    ] {
        let Some((pool, claims)) = test_run().await else {
            return;
        };
        let key = &claims.run_id;
        let request_id = format!("{key}-request");
        reserve_request(
            &pool,
            &claims,
            &request_id,
            &RequestLane::Main,
            Some(Decimal::ONE),
            Some(key),
            Duration::from_secs(1),
        )
        .await
        .unwrap();
        let observed = Arc::new(Mutex::new(Vec::<String>::new()));
        let calls = observed.clone();
        let app = axum::Router::new().route(
            "/responses",
            axum::routing::post(move |headers: HeaderMap| {
                let calls = calls.clone();
                async move {
                    let count = {
                        let mut calls = calls.lock().unwrap();
                        calls.push(headers["idempotency-key"].to_str().unwrap().to_owned());
                        calls.len()
                    };
                    if kind == "timeout" {
                        tokio::time::sleep(Duration::from_millis(300)).await;
                    }
                    let status = if count == 1 { first_status } else { 200 };
                    (
                        StatusCode::from_u16(status).unwrap(),
                        [
                            ("retry-after", retry_after),
                            ("x-request-id", "upstream-regression-id"),
                        ],
                        Json(json!({"error":{"code":kind,"message":"test upstream response"}})),
                    )
                }
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let request = UpstreamRequest {
            url: format!("http://{address}/responses"),
            headers: vec![],
            query_params: vec![],
            response_format: UpstreamResponseFormat::Responses,
            stream_response: false,
            namespace_tool_compat: false,
            request_timeout_ms: if kind == "timeout" { 100 } else { 1000 },
            max_retries: 2,
        };
        let result = send_upstream_post(
            &reqwest::Client::new(),
            &request,
            &json!({}),
            &request_id,
            &pool,
            key,
            Duration::from_secs(3),
        )
        .await;
        assert_eq!(
            *observed.lock().unwrap(),
            vec![request_id.clone(); expected_calls],
            "{kind}"
        );
        match kind {
            "transient" => assert_eq!(result.unwrap().status(), 200),
            "server_error" => assert_eq!(result.unwrap().status(), 503),
            "timeout" => assert!(result.unwrap_err().may_have_incurred_cost),
            _ => {
                let error = result.unwrap_err();
                assert!(!error.may_have_incurred_cost);
                assert_eq!(error.headers["x-request-id"], "upstream-regression-id");
                assert_eq!(error.headers["retry-after"], retry_after);
                assert_eq!(error.rate_limit_body.unwrap()["error"]["code"], kind);
            }
        }
        release_gateway_request(&pool, &claims, &request_id, None)
            .await
            .unwrap();
        server.abort();
    }
}

#[tokio::test]
async fn concurrent_settlements_charge_once_and_release_only_the_owned_lease() {
    let Some((pool, claims)) = test_run().await else {
        return;
    };
    let a = format!("{}-a", claims.run_id);
    let b = format!("{}-b", claims.run_id);
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
            None,
            Duration::from_secs(1),
        )
        .await
        .unwrap();
    }
    let pricing = Pricing {
        input_yuan_per_million: Decimal::ONE,
        output_yuan_per_million: Decimal::ONE,
        reasoning_yuan_per_million: Decimal::ONE,
        cached_input_yuan_per_million: Decimal::ONE,
        markup_bps: 0,
    };
    let usage = GatewayUsage {
        input_tokens: 1000,
        output_tokens: 1000,
        ..Default::default()
    };
    let (first, duplicate, second) = tokio::join!(
        settle_and_record_usage(
            &pool,
            &claims,
            &a,
            &pricing,
            &usage,
            200,
            Utc::now(),
            MeteringStatus::Reported
        ),
        settle_and_record_usage(
            &pool,
            &claims,
            &a,
            &pricing,
            &usage,
            200,
            Utc::now(),
            MeteringStatus::Reported
        ),
        settle_and_record_usage(
            &pool,
            &claims,
            &b,
            &pricing,
            &usage,
            200,
            Utc::now(),
            MeteringStatus::Reported
        ),
    );
    assert_ne!(first.is_ok(), duplicate.is_ok());
    second.unwrap();
    let charged: Decimal =
        sqlx::query_scalar("select sum(billable_yuan) from usage_events where run_id=$1")
            .bind(&claims.run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    let balance: Decimal = sqlx::query_scalar("select balance_yuan from tenants where id=$1")
        .bind(&claims.tenant_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(balance, Decimal::from(100) - charged);
    let count: i64 = sqlx::query_scalar("select count(*) from usage_events where run_id=$1")
        .bind(&claims.run_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    let leases: i64 =
        sqlx::query_scalar("select count(*) from gateway_request_leases where run_id=$1")
            .bind(&claims.run_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(leases, 0);
    let remaining = start_gateway_request(
        &pool,
        &claims,
        &format!("{}-next", claims.run_id),
        Duration::from_secs(1),
    )
    .await
    .unwrap();
    assert_eq!(remaining, claims.budget_yuan - charged);
}

#[tokio::test]
async fn provider_capacity_is_shared_across_runs_and_crash_slots_expire() {
    let key = uuid::Uuid::new_v4().to_string();
    let mut runs = vec![];
    for _ in 0..4 {
        let Some((pool, claims)) = test_run().await else {
            return;
        };
        let request_id = format!("{}-request", claims.run_id);
        reserve_request(
            &pool,
            &claims,
            &request_id,
            &RequestLane::Main,
            Some(Decimal::ONE),
            Some(&key),
            Duration::from_secs(1),
        )
        .await
        .unwrap();
        runs.push((pool, claims, request_id));
    }
    for (pool, _, id) in &runs[..3] {
        acquire_dispatch(
            pool,
            &key,
            id,
            tokio::time::Instant::now() + Duration::from_secs(1),
        )
        .await
        .unwrap();
    }
    let (pool, _, id) = &runs[3];
    assert!(matches!(
        acquire_dispatch(
            pool,
            &key,
            id,
            tokio::time::Instant::now() + Duration::from_millis(30)
        )
        .await
        .unwrap_err(),
        ApiError::GatewayBusy(_)
    ));
    sqlx::query("update gateway_request_leases set dispatch_expires_at=now()-interval '1 second' where id=$1").bind(&runs[0].2).execute(pool).await.unwrap();
    acquire_dispatch(
        pool,
        &key,
        id,
        tokio::time::Instant::now() + Duration::from_secs(1),
    )
    .await
    .unwrap();
    // Expiry releases provider capacity only. It must not pretend the crashed
    // request was unbilled or authorize replaying that task's request.
    let reserved: bool =
        sqlx::query_scalar("select exists(select 1 from gateway_request_leases where id=$1)")
            .bind(&runs[0].2)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(reserved);
}
