use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};

use axum::{
    extract::State,
    http::{header, HeaderValue},
    response::IntoResponse,
};

use crate::state::AppState;

#[derive(Clone, Default)]
pub struct HttpMetrics {
    inner: Arc<HttpMetricsInner>,
}

#[derive(Default)]
struct HttpMetricsInner {
    requests_total: AtomicU64,
    request_errors_total: AtomicU64,
    requests_in_flight: AtomicU64,
    request_duration_count: AtomicU64,
    request_duration_micros_total: AtomicU64,
}

impl HttpMetrics {
    pub fn start_request(&self) {
        self.inner.requests_total.fetch_add(1, Ordering::Relaxed);
        self.inner
            .requests_in_flight
            .fetch_add(1, Ordering::Relaxed);
    }

    pub fn finish_request(&self, status: u16, duration: Duration) {
        if status >= 500 {
            self.inner
                .request_errors_total
                .fetch_add(1, Ordering::Relaxed);
        }
        self.inner.request_duration_micros_total.fetch_add(
            duration.as_micros().min(u128::from(u64::MAX)) as u64,
            Ordering::Relaxed,
        );
        self.inner
            .request_duration_count
            .fetch_add(1, Ordering::Relaxed);
        self.inner
            .requests_in_flight
            .fetch_sub(1, Ordering::Relaxed);
    }

    pub fn render(&self) -> String {
        let requests = self.inner.requests_total.load(Ordering::Relaxed);
        let errors = self.inner.request_errors_total.load(Ordering::Relaxed);
        let in_flight = self.inner.requests_in_flight.load(Ordering::Relaxed);
        let duration_count = self.inner.request_duration_count.load(Ordering::Relaxed);
        let duration_seconds = self
            .inner
            .request_duration_micros_total
            .load(Ordering::Relaxed) as f64
            / 1_000_000.0;
        format!(
            concat!(
                "# HELP alpha_http_requests_total Total HTTP requests handled.\n",
                "# TYPE alpha_http_requests_total counter\n",
                "alpha_http_requests_total {requests}\n",
                "# HELP alpha_http_request_errors_total HTTP responses with a 5xx status.\n",
                "# TYPE alpha_http_request_errors_total counter\n",
                "alpha_http_request_errors_total {errors}\n",
                "# HELP alpha_http_requests_in_flight HTTP requests currently being handled.\n",
                "# TYPE alpha_http_requests_in_flight gauge\n",
                "alpha_http_requests_in_flight {in_flight}\n",
                "# HELP alpha_http_request_duration_seconds Cumulative HTTP request duration.\n",
                "# TYPE alpha_http_request_duration_seconds summary\n",
                "alpha_http_request_duration_seconds_count {duration_count}\n",
                "alpha_http_request_duration_seconds_sum {duration_seconds:.6}\n"
            ),
            requests = requests,
            errors = errors,
            in_flight = in_flight,
            duration_count = duration_count,
            duration_seconds = duration_seconds
        )
    }
}

pub async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    (
        [(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
        )],
        state.http_metrics.render(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_prometheus_counters() {
        let metrics = HttpMetrics::default();
        metrics.start_request();
        metrics.finish_request(503, Duration::from_millis(125));
        let output = metrics.render();

        assert!(output.contains("alpha_http_requests_total 1"));
        assert!(output.contains("alpha_http_request_errors_total 1"));
        assert!(output.contains("alpha_http_requests_in_flight 0"));
        assert!(output.contains("alpha_http_request_duration_seconds_sum 0.125000"));
    }
}
