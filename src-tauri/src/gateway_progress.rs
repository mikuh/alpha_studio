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
        let Ok(client) = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .read_timeout(Duration::from_secs(30))
            .build()
        else {
            return;
        };
        let url = format!("{}/run-events", base_url.trim_end_matches('/'));
        let mut retry_seconds = 1;
        loop {
            let response = client
                .get(&url)
                .bearer_auth(&api_key)
                .header("accept", "text/event-stream")
                .send()
                .await;
            if let Ok(mut response) = response {
                // An older backend cannot stream progress. Native Codex events
                // continue working; do not turn a missing endpoint into polling.
                if matches!(response.status().as_u16(), 401 | 403 | 404) {
                    break;
                }
                let is_sse = response
                    .headers()
                    .get("content-type")
                    .and_then(|h| h.to_str().ok())
                    .is_some_and(|h| h.starts_with("text/event-stream"));
                if response.status().is_success() && is_sse {
                    let mut decoder = ProgressFrames::default();
                    while let Ok(Some(chunk)) = response.chunk().await {
                        let Ok(frames) = decoder.push(&chunk) else {
                            break;
                        };
                        for payload in frames {
                            retry_seconds = 1;
                            let status = payload.get("status").cloned().unwrap_or(Value::Null);
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
                                    Some(payload),
                                ),
                            );
                        }
                    }
                }
            }
            // Reconnect only after EOF or a transport failure. Reconnection
            // gets an authoritative snapshot, never replays a model request.
            tokio::time::sleep(Duration::from_secs(retry_seconds)).await;
            retry_seconds = (retry_seconds * 2).min(15);
        }
    }))
}

#[derive(Default)]
struct ProgressFrames {
    buffer: Vec<u8>,
}

impl ProgressFrames {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, ()> {
        self.buffer.extend_from_slice(chunk);
        let mut values = Vec::new();
        loop {
            let lf = self
                .buffer
                .windows(2)
                .position(|w| w == b"\n\n")
                .map(|i| (i, 2));
            let crlf = self
                .buffer
                .windows(4)
                .position(|w| w == b"\r\n\r\n")
                .map(|i| (i, 4));
            let Some((end, separator)) = [lf, crlf].into_iter().flatten().min() else {
                break;
            };
            let frame = self.buffer.drain(..end + separator).collect::<Vec<_>>();
            let data = String::from_utf8_lossy(&frame)
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(|line| line.strip_prefix(' ').unwrap_or(line))
                .collect::<Vec<_>>()
                .join("\n");
            if let Ok(value) = serde_json::from_str::<Value>(&data) {
                if value.get("status").is_some() {
                    values.push(value);
                }
            }
        }
        if self.buffer.len() > 256 * 1024 {
            return Err(());
        }
        Ok(values)
    }
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
    fn receives_split_utf8_frames_and_idle_transitions_without_polling() {
        let mut decoder = super::ProgressFrames::default();
        let bytes = "event: progress\r\ndata: {\"status\":{\"preview\":\"生成中\"},\"progressOnly\":true}\r\n\r\n: ping\n\nevent: status\ndata: {\"status\":null}\n\n".as_bytes();
        let mut frames = Vec::new();
        for byte in bytes {
            frames.extend(decoder.push(&[*byte]).unwrap());
        }
        assert_eq!(frames.len(), 2);
        assert_eq!(frames[0]["status"]["preview"], "生成中");
        assert_eq!(frames[0]["progressOnly"], true);
        assert!(frames[1]["status"].is_null());
    }

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
