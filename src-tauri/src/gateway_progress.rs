use serde_json::Value;
use std::time::Duration;
use tauri::AppHandle;
use tokio::task::JoinHandle;

pub struct ProgressMonitor(JoinHandle<()>);

impl Drop for ProgressMonitor {
    fn drop(&mut self) {
        self.0.abort();
    }
}

pub fn monitor(
    app: AppHandle,
    run_id: String,
    conversation_id: String,
    base_url: String,
    api_key: String,
) -> ProgressMonitor {
    ProgressMonitor(tokio::spawn(async move {
        let client = reqwest::Client::new();
        let url = format!("{}/run-status", base_url.trim_end_matches('/'));
        let mut interval = tokio::time::interval(Duration::from_secs(2));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let Ok(response) = client
                .get(&url)
                .bearer_auth(&api_key)
                .timeout(Duration::from_secs(4))
                .send()
                .await
            else {
                continue;
            };
            // Older backends do not expose this optional endpoint. Monitoring
            // must never interfere with the inference request or its retry policy.
            if matches!(response.status().as_u16(), 401 | 403 | 404) {
                break;
            }
            if !response.status().is_success() {
                continue;
            }
            let Ok(payload) = response.json::<Value>().await else {
                continue;
            };
            let status = payload.get("status").cloned().unwrap_or(Value::Null);
            // The timestamp of a successful observation is separate from the
            // last output timestamp; the UI can expire stale queue telemetry.
            // Emit the idle transition too; otherwise the last queue count
            // remains visible throughout subsequent local tool execution.
            super::emit_event(
                &app,
                super::event(
                    "activity",
                    &run_id,
                    &conversation_id,
                    None,
                    None,
                    Some("gateway".to_string()),
                    None,
                    activity_message(&status),
                    Some(serde_json::json!({ "status": status })),
                ),
            );
        }
    }))
}

fn activity_message(status: &Value) -> Option<String> {
    if status.get("active").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let output = status
        .get("lastOutputAt")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let message = if output > 0 {
        "模型服务已响应"
    } else {
        "等待模型响应"
    };
    Some(message.to_string())
}

#[cfg(test)]
mod tests {
    use super::activity_message;
    use serde_json::json;

    #[test]
    fn distinguishes_queued_output_from_waiting_for_a_response() {
        assert_eq!(
            activity_message(&json!({"active": true, "waitingRequests": 2, "lastOutputAt": 123}))
                .as_deref(),
            Some("模型服务已响应")
        );
        assert_eq!(
            activity_message(&json!({"active": true, "waitingRequests": 0, "lastOutputAt": 0}))
                .as_deref(),
            Some("等待模型响应")
        );
        assert_eq!(activity_message(&json!({"active": false})), None);
        assert_eq!(activity_message(&serde_json::Value::Null), None);
    }
}
