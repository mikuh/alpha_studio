use crate::{
    error::{ApiError, ApiResult},
    routes::require_device,
    state::AppState,
};
use alpha_agent_network::{ConnectError, Frame, Target};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::HeaderMap,
    response::Response,
};
use futures_util::{future, SinkExt, StreamExt};
use serde::Deserialize;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

type DeviceWindow = (Instant, u32, Arc<Semaphore>);
#[derive(Clone)]
pub struct RelayLimits {
    slots: Arc<Semaphore>,
    devices: Arc<Mutex<HashMap<String, DeviceWindow>>>,
}

impl Default for RelayLimits {
    fn default() -> Self {
        Self {
            slots: Arc::new(Semaphore::new(32)),
            devices: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

impl RelayLimits {
    fn acquire(
        &self,
        device: String,
        now: Instant,
    ) -> ApiResult<(OwnedSemaphorePermit, OwnedSemaphorePermit)> {
        let busy = || ApiError::TooManyRequests("Agent data relay is busy; retry later".into());
        let mut devices = self
            .devices
            .lock()
            .map_err(|_| ApiError::Internal("Data relay is unavailable".into()))?;
        devices.retain(|_, (start, _, slots)| {
            now.duration_since(*start) < Duration::from_secs(60) || slots.available_permits() < 4
        });
        if devices.len() >= 4096 && !devices.contains_key(&device) {
            return Err(busy());
        }
        let (start, count, slots) = devices
            .entry(device)
            .or_insert_with(|| (now, 0, Arc::new(Semaphore::new(4))));
        if now.duration_since(*start) >= Duration::from_secs(60) {
            *start = now;
            *count = 0;
        }
        if *count >= 60 {
            return Err(ApiError::TooManyRequests(
                "Data relay limit is 60 connections per device per minute".into(),
            ));
        }
        let global = self.slots.clone().try_acquire_owned().map_err(|_| busy())?;
        let device = slots.clone().try_acquire_owned().map_err(|_| busy())?;
        *count += 1;
        Ok((global, device))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TunnelQuery {
    tenant_id: String,
    device_id: String,
    host: String,
    port: u16,
}

pub async fn open_tunnel(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<TunnelQuery>,
    upgrade: WebSocketUpgrade,
) -> ApiResult<Response> {
    require_device(&state, &headers, &query.tenant_id, &query.device_id).await?;
    if !state.config.agent_data_relay_enabled {
        return Err(ApiError::Forbidden(
            "Agent data relay is disabled by the operator".into(),
        ));
    }
    let target = Target::new(&query.host, query.port).map_err(map_error)?;
    let permits = state.agent_data_relay.acquire(
        format!("{}:{}", query.tenant_id, query.device_id),
        Instant::now(),
    )?;
    // Do not acknowledge a tunnel until its destination is connected. A failed
    // dial therefore cannot partially send or replay a user's request.
    let tcp = alpha_agent_network::connect(&target, Duration::from_secs(8))
        .await
        .map_err(map_error)?;
    Ok(upgrade
        .max_message_size(64 * 1024)
        .max_frame_size(64 * 1024)
        .on_upgrade(move |socket| async move {
            let _permits = permits;
            let _ = tunnel(socket, tcp).await;
        }))
}

async fn tunnel(socket: WebSocket, tcp: tokio::net::TcpStream) -> std::io::Result<()> {
    let (sink, stream) = socket.split();
    let sink = sink.with(|frame| {
        future::ready(Ok::<_, axum::Error>(match frame {
            Frame::Data(data) => Message::Binary(data),
            Frame::Eof => Message::Text("eof".into()),
        }))
    });
    let stream = stream.filter_map(|message| {
        future::ready(match message {
            Ok(Message::Binary(data)) => Some(Ok(Frame::Data(data))),
            Ok(Message::Text(text)) if text == "eof" => Some(Ok(Frame::Eof)),
            Ok(Message::Close(_)) => Some(Ok(Frame::Eof)),
            Ok(Message::Ping(_) | Message::Pong(_)) => None,
            Ok(_) => Some(Err(axum::Error::new(std::io::Error::other(
                "Invalid tunnel frame",
            )))),
            Err(error) => Some(Err(error)),
        })
    });
    alpha_agent_network::bridge(tcp, sink, stream).await
}

fn map_error(error: ConnectError) -> ApiError {
    match error {
        ConnectError::Policy(message) => ApiError::BadRequest(message),
        ConnectError::Network(message) => ApiError::Upstream(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn per_device_limits_release_and_reset() {
        let limits = RelayLimits::default();
        let now = Instant::now();
        let permits = (0..4)
            .map(|_| limits.acquire("a".into(), now).unwrap())
            .collect::<Vec<_>>();
        assert!(limits.acquire("a".into(), now).is_err());
        drop(limits.acquire("b".into(), now).unwrap());
        drop(permits);
        for _ in 4..60 {
            drop(limits.acquire("a".into(), now).unwrap());
        }
        assert!(limits.acquire("a".into(), now).is_err());
        drop(
            limits
                .acquire("a".into(), now + Duration::from_secs(61))
                .unwrap(),
        );
    }

    #[tokio::test]
    async fn tunnel_preserves_binary_data_and_tcp_half_close() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio_tungstenite::tungstenite::Message as ClientMessage;
        let origin = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = origin.local_addr().unwrap();
        let upstream = tokio::spawn(async move {
            let (mut socket, _) = origin.accept().await.unwrap();
            let mut data = Vec::new();
            socket.read_to_end(&mut data).await.unwrap();
            assert_eq!(data, b"opaque-client-record\x00\xff");
            socket
                .write_all(b"opaque-server-record\x00\xfe")
                .await
                .unwrap();
            socket.shutdown().await.unwrap();
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let endpoint = format!("ws://{}/test", listener.local_addr().unwrap());
        let router = axum::Router::new().route(
            "/test",
            axum::routing::get(move |upgrade: WebSocketUpgrade| async move {
                let tcp = tokio::net::TcpStream::connect(address).await.unwrap();
                upgrade.on_upgrade(move |socket| async move {
                    tunnel(socket, tcp).await.unwrap();
                })
            }),
        );
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        let (mut websocket, _) = tokio_tungstenite::connect_async(endpoint).await.unwrap();
        websocket
            .send(ClientMessage::Binary(
                b"opaque-client-record\x00\xff".to_vec(),
            ))
            .await
            .unwrap();
        websocket
            .send(ClientMessage::Text("eof".into()))
            .await
            .unwrap();
        let received = tokio::time::timeout(Duration::from_secs(3), async {
            let mut received = Vec::new();
            while let Some(Ok(frame)) = websocket.next().await {
                match frame {
                    ClientMessage::Binary(bytes) => received.extend(bytes),
                    ClientMessage::Text(text) if text == "eof" => break,
                    _ => {}
                }
            }
            received
        })
        .await
        .unwrap();
        assert_eq!(received, b"opaque-server-record\x00\xfe");
        upstream.await.unwrap();
        server.abort();
    }
}
