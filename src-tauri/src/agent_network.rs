//! Network routing below the unmodified Codex CLI shell tools. Proxy variables
//! are injected via shell_environment_policy.set, never into the model process.
use alpha_agent_network::{ConnectError, Frame, Target};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use futures_util::{future, SinkExt, StreamExt};
use serde::Deserialize;
use std::{
    collections::HashMap,
    fmt, io,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{watch, Semaphore},
    task::JoinHandle,
};
use tokio_tungstenite::{
    tungstenite::{self, client::IntoClientRequest, protocol::WebSocketConfig, Message},
    MaybeTlsStream, WebSocketStream,
};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelayConfig {
    api_base_url: String,
    tenant_id: String,
    device_id: String,
    access_token: String,
}

impl fmt::Debug for RelayConfig {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RelayConfig(<redacted>)")
    }
}

impl RelayConfig {
    fn endpoint(&self) -> Result<reqwest::Url, String> {
        let mut base =
            reqwest::Url::parse(self.api_base_url.trim()).map_err(|_| "Invalid relay address")?;
        let local = matches!(base.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
        if (base.scheme() != "https" && !(base.scheme() == "http" && local))
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
            || self.access_token.trim().is_empty()
            || self.tenant_id.is_empty()
            || self.device_id.is_empty()
        {
            return Err("Agent relay requires an activated device and HTTPS (HTTP is allowed for local development).".into());
        }
        base = base
            .join("/api/client/agent-network/tunnel")
            .map_err(|_| "Invalid relay address")?;
        let scheme = if base.scheme() == "https" {
            "wss"
        } else {
            "ws"
        };
        base.set_scheme(scheme)
            .map_err(|_| "Invalid relay address")?;
        Ok(base)
    }
}

pub struct AgentProxy {
    address: String,
    no_proxy: String,
    shutdown: watch::Sender<bool>,
    task: JoinHandle<()>,
    #[cfg(test)]
    preferred: Arc<Mutex<HashMap<String, Instant>>>,
}

impl AgentProxy {
    pub fn configure(&self, args: &mut Vec<String>) {
        for (name, value) in proxy_environment(&self.address, &self.no_proxy) {
            super::push_config_arg(
                args,
                &format!("shell_environment_policy.set.{name}"),
                &value,
            );
        }
    }
    pub fn stop(&self) {
        let _ = self.shutdown.send(true);
    }
}

impl Drop for AgentProxy {
    fn drop(&mut self) {
        self.stop();
        self.task.abort();
    }
}

fn proxy_environment(address: &str, no_proxy: &str) -> Vec<(&'static str, String)> {
    vec![
        ("HTTP_PROXY", address.into()),
        ("HTTPS_PROXY", address.into()),
        ("http_proxy", address.into()),
        ("https_proxy", address.into()),
        ("NO_PROXY", no_proxy.into()),
        ("no_proxy", no_proxy.into()),
        ("NODE_USE_ENV_PROXY", "1".into()),
    ]
}

#[derive(Clone)]
struct ProxyState {
    config: RelayConfig,
    authorization: String,
    preferred: Arc<Mutex<HashMap<String, Instant>>>,
    verified: Arc<Mutex<HashMap<String, Instant>>>,
    slots: Arc<Semaphore>,
    shutdown: watch::Receiver<bool>,
    on_relay: Arc<dyn Fn() + Send + Sync>,
}

/// An existing user proxy remains authoritative. Unactivated/offline-only
/// clients keep the CLI's original environment and do not start a listener.
pub async fn start(
    config: Option<RelayConfig>,
    runtime_home: &std::path::Path,
    cwd: &std::path::Path,
    on_relay: Arc<dyn Fn() + Send + Sync>,
) -> Result<Option<AgentProxy>, String> {
    let Some(config) = config else {
        return Ok(None);
    };
    if [
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ]
    .iter()
    .any(|name| std::env::var(name).is_ok_and(|value| !value.trim().is_empty()))
    {
        return Ok(None);
    }
    if has_configured_proxy(runtime_home, cwd) || config.endpoint().is_err() {
        return Ok(None);
    }
    start_proxy(config, on_relay).await.map(Some)
}

fn has_configured_proxy(runtime_home: &std::path::Path, cwd: &std::path::Path) -> bool {
    std::iter::once(runtime_home.join("config.toml"))
        .chain(cwd.ancestors().map(|path| path.join(".codex/config.toml")))
        .any(|path| {
            let Some(value) = std::fs::read_to_string(path)
                .ok()
                .and_then(|text| text.parse::<toml::Value>().ok())
            else {
                return false;
            };
            value
                .get("shell_environment_policy")
                .and_then(|value| value.get("set"))
                .and_then(toml::Value::as_table)
                .is_some_and(|table| {
                    table.iter().any(|(key, value)| {
                        ["http_proxy", "https_proxy", "all_proxy"]
                            .contains(&key.to_ascii_lowercase().as_str())
                            && value.as_str().is_some_and(|value| !value.trim().is_empty())
                    })
                })
        })
}

async fn start_proxy(
    config: RelayConfig,
    on_relay: Arc<dyn Fn() + Send + Sync>,
) -> Result<AgentProxy, String> {
    let endpoint = config.endpoint()?;
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Unable to start Agent network routing")?;
    let token = uuid::Uuid::new_v4().simple().to_string();
    let address = format!(
        "http://agent:{token}@{}",
        listener
            .local_addr()
            .map_err(|_| "Unable to read proxy address")?
    );
    let mut no_proxy = std::env::var("NO_PROXY")
        .or_else(|_| std::env::var("no_proxy"))
        .unwrap_or_default();
    no_proxy.push_str(",localhost,127.0.0.1,::1,[::1],.localhost,.local,.internal");
    if let Some(host) = endpoint.host_str() {
        no_proxy.push(',');
        no_proxy.push_str(host);
    }
    let (shutdown, mut shutdown_rx) = watch::channel(false);
    let preferred = Arc::default();
    let state = ProxyState {
        config,
        authorization: format!("Basic {}", STANDARD.encode(format!("agent:{token}"))),
        preferred: Arc::clone(&preferred),
        verified: Arc::default(),
        slots: Arc::new(Semaphore::new(32)),
        shutdown: shutdown_rx.clone(),
        on_relay,
    };
    let task = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = shutdown_rx.changed() => break,
                accepted = listener.accept() => {
                    let Ok((mut socket, _)) = accepted else { break; };
                    let Ok(permit) = state.slots.clone().try_acquire_owned() else {
                        let _ = socket.write_all(b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").await;
                        continue;
                    };
                    let mut state = state.clone();
                    tokio::spawn(async move {
                        let _permit = permit;
                        if *state.shutdown.borrow() { return; }
                        let mut cancelled = state.shutdown.clone();
                        tokio::select! {
                            _ = handle_connection(socket, &mut state) => {},
                            _ = cancelled.changed() => {},
                        }
                    });
                }
            }
        }
    });
    Ok(AgentProxy {
        address,
        no_proxy,
        shutdown,
        task,
        #[cfg(test)]
        preferred,
    })
}

#[derive(Debug)]
struct ProxyRequest {
    target: Target,
    connect: bool,
    initial: Vec<u8>,
}

fn parse_request(
    header: &[u8],
    remainder: &[u8],
    authorization: &str,
) -> Result<ProxyRequest, (u16, &'static str)> {
    let text = std::str::from_utf8(header).map_err(|_| (400, "Invalid proxy request"))?;
    let mut lines = text.split("\r\n");
    let first = lines.next().ok_or((400, "Missing request line"))?;
    let parts = first.split_whitespace().collect::<Vec<_>>();
    if parts.len() != 3
        || !matches!(parts[2], "HTTP/1.0" | "HTTP/1.1")
        || !parts[0]
            .bytes()
            .all(|byte| byte.is_ascii_uppercase() || byte == b'-')
    {
        return Err((400, "Invalid proxy request line"));
    }
    let headers = lines
        .filter(|line| !line.is_empty())
        .map(|line| line.split_once(':').ok_or((400, "Invalid proxy header")))
        .collect::<Result<Vec<_>, _>>()?;
    let auth = headers
        .iter()
        .filter(|(key, _)| key.eq_ignore_ascii_case("proxy-authorization"))
        .collect::<Vec<_>>();
    if auth.len() != 1 || auth[0].1.trim() != authorization {
        return Err((407, "Proxy authentication required"));
    }
    let connect = parts[0] == "CONNECT";
    let url = reqwest::Url::parse(&if connect {
        format!("https://{}/", parts[1])
    } else {
        parts[1].to_string()
    })
    .map_err(|_| (400, "Invalid proxy destination"))?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || (!connect && url.scheme() != "http")
        || (connect && (url.path() != "/" || url.query().is_some()))
    {
        return Err((400, "Invalid proxy destination"));
    }
    let host = url
        .host_str()
        .ok_or((400, "Missing destination host"))?
        .trim_matches(['[', ']'])
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or((400, "Missing destination port"))?;
    // Local destinations and custom ports remain usable by the original tools,
    // but only valid public port-80/443 Targets may go to the server.
    let target = Target { host, port };
    let initial = if connect {
        remainder.to_vec()
    } else {
        let path = match url.query() {
            Some(query) => format!("{}?{query}", url.path()),
            None => url.path().to_string(),
        };
        let mut rewritten = format!(
            "{} {} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n",
            parts[0],
            path,
            target.authority()
        );
        for (name, value) in headers {
            if [
                "proxy-authorization",
                "proxy-connection",
                "connection",
                "host",
                "keep-alive",
            ]
            .iter()
            .any(|key| name.eq_ignore_ascii_case(key))
            {
                continue;
            }
            rewritten.push_str(name);
            rewritten.push(':');
            rewritten.push_str(value);
            rewritten.push_str("\r\n");
        }
        rewritten.push_str("\r\n");
        let mut bytes = rewritten.into_bytes();
        bytes.extend_from_slice(remainder);
        bytes
    };
    Ok(ProxyRequest {
        target,
        connect,
        initial,
    })
}

async fn read_request(
    socket: &mut TcpStream,
    auth: &str,
) -> Result<ProxyRequest, (u16, &'static str)> {
    let mut bytes = Vec::new();
    loop {
        if let Some(end) = bytes.windows(4).position(|slice| slice == b"\r\n\r\n") {
            if end > 32768 {
                return Err((431, "Proxy headers too large"));
            }
            return parse_request(&bytes[..end], &bytes[end + 4..], auth);
        }
        if bytes.len() > 32768 {
            return Err((431, "Proxy headers too large"));
        }
        let mut buffer = [0u8; 4096];
        let count = socket
            .read(&mut buffer)
            .await
            .map_err(|_| (400, "Unable to read proxy request"))?;
        if count == 0 {
            return Err((400, "Incomplete proxy request"));
        }
        bytes.extend_from_slice(&buffer[..count]);
    }
}

type RemoteSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;
enum Connection {
    Direct(TcpStream),
    Relay(Box<RemoteSocket>),
}

async fn direct_connect(target: &Target, verify_tls: bool) -> Result<TcpStream, ConnectError> {
    let addresses = tokio::time::timeout(
        Duration::from_secs(2),
        tokio::net::lookup_host((target.host.as_str(), target.port)),
    )
    .await
    .map_err(|_| ConnectError::Network("DNS lookup timed out".into()))?
    .map_err(|_| ConnectError::Network("DNS lookup failed".into()))?
    .collect::<Vec<_>>();
    let private = addresses
        .iter()
        .any(|addr| !alpha_agent_network::is_public_ip(addr.ip()));
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        for address in addresses.into_iter().take(16) {
            if let Ok(Ok(stream)) =
                tokio::time::timeout(Duration::from_millis(1200), TcpStream::connect(address)).await
            {
                return Ok(stream);
            }
        }
        if private {
            Err(ConnectError::Policy(
                "Private destination is unreachable locally; it cannot use the relay".into(),
            ))
        } else {
            Err(ConnectError::Network("Direct connection failed".into()))
        }
    })
    .await;
    let stream = match result {
        Ok(result) => result,
        Err(_) if private => Err(ConnectError::Policy(
            "Private destination timed out locally; it cannot use the relay".into(),
        )),
        Err(_) => Err(ConnectError::Network("Direct connection timed out".into())),
    }?;
    // A TCP SYN can succeed even when a network blocks TLS/SNI. Probe only
    // the TLS handshake before acknowledging CONNECT, without sending HTTP
    // or any client bytes. Reconnect to the same IP after a successful probe.
    // Private/custom endpoints retain their original client TLS behavior.
    if verify_tls && target.port == 443 && !private {
        let peer = stream
            .peer_addr()
            .map_err(|_| ConnectError::Network("Unable to inspect direct connection".into()))?;
        let roots = tokio_rustls::rustls::RootCertStore::from_iter(
            webpki_roots::TLS_SERVER_ROOTS.iter().cloned(),
        );
        let tls = tokio_rustls::rustls::ClientConfig::builder_with_provider(Arc::new(
            tokio_rustls::rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .map_err(|_| ConnectError::Policy("Unable to configure HTTPS probe".into()))?
        .with_root_certificates(roots)
        .with_no_client_auth();
        let name = tokio_rustls::rustls::pki_types::ServerName::try_from(target.host.clone())
            .map_err(|_| ConnectError::Policy("Invalid HTTPS hostname".into()))?;
        let connector = tokio_rustls::TlsConnector::from(Arc::new(tls));
        let probe =
            tokio::time::timeout(Duration::from_secs(3), connector.connect(name, stream)).await;
        match probe {
            Ok(Ok(probe)) => drop(probe),
            _ => {
                return Err(ConnectError::Network(
                    "Direct HTTPS handshake failed or timed out".into(),
                ))
            }
        }
        tokio::time::timeout(Duration::from_secs(2), TcpStream::connect(peer))
            .await
            .map_err(|_| ConnectError::Network("Direct HTTPS reconnect timed out".into()))?
            .map_err(|_| ConnectError::Network("Direct HTTPS reconnect failed".into()))
    } else {
        Ok(stream)
    }
}

async fn relay_connect(
    config: &RelayConfig,
    target: &Target,
) -> Result<RemoteSocket, ConnectError> {
    let target = Target::new(&target.host, target.port)?;
    let mut endpoint = config.endpoint().map_err(ConnectError::Policy)?;
    endpoint
        .query_pairs_mut()
        .append_pair("tenantId", &config.tenant_id)
        .append_pair("deviceId", &config.device_id)
        .append_pair("host", &target.host)
        .append_pair("port", &target.port.to_string());
    let mut request = endpoint
        .as_str()
        .into_client_request()
        .map_err(|_| ConnectError::Policy("Invalid relay request".into()))?;
    request.headers_mut().insert(
        "authorization",
        format!("Bearer {}", config.access_token.trim())
            .parse()
            .map_err(|_| ConnectError::Policy("Invalid device authorization".into()))?,
    );
    let ws_config = WebSocketConfig {
        max_message_size: Some(64 * 1024),
        max_frame_size: Some(64 * 1024),
        ..Default::default()
    };
    let result = tokio::time::timeout(
        Duration::from_secs(15),
        tokio_tungstenite::connect_async_with_config(request, Some(ws_config), false),
    )
    .await;
    match result {
        Ok(Ok((socket, _))) => Ok(socket),
        Ok(Err(tungstenite::Error::Http(response))) => Err(ConnectError::Network(format!("Data relay returned HTTP {} (check deployment, device authorization or connection limits)", response.status().as_u16()))),
        _ => Err(ConnectError::Network("Could not establish a connection through the data relay".into())),
    }
}

async fn choose_connection<T, F, Fut>(preferred: bool, connect: F) -> Result<(T, bool), String>
where
    F: Fn(bool) -> Fut,
    Fut: std::future::Future<Output = Result<T, ConnectError>>,
{
    match connect(preferred).await {
        Ok(connection) => Ok((connection, preferred)),
        Err(ConnectError::Policy(message)) if !preferred => Err(message),
        Err(first_error) => connect(!preferred)
            .await
            .map(|connection| (connection, !preferred))
            .map_err(|second_error| format!("{first_error}; {second_error}")),
    }
}

async fn handle_connection(mut socket: TcpStream, state: &mut ProxyState) -> io::Result<()> {
    let request = match tokio::time::timeout(
        Duration::from_secs(10),
        read_request(&mut socket, &state.authorization),
    )
    .await
    {
        Ok(Ok(request)) => request,
        error => {
            let (code, message) = match error {
                Ok(Err(value)) => value,
                _ => (408, "Proxy request timed out"),
            };
            return write_error(&mut socket, code, message).await;
        }
    };
    let key = request.target.authority();
    let preferred = state.preferred.lock().ok().is_some_and(|mut routes| {
        routes.retain(|_, until| *until > Instant::now());
        routes.contains_key(&key)
    });
    let verified = state.verified.lock().ok().is_some_and(|mut routes| {
        routes.retain(|_, until| *until > Instant::now());
        routes.contains_key(&key)
    });
    let result = choose_connection(preferred, |remote| {
        let config = &state.config;
        let target = &request.target;
        async move {
            if remote {
                relay_connect(config, target)
                    .await
                    .map(|socket| Connection::Relay(Box::new(socket)))
            } else {
                direct_connect(target, !verified)
                    .await
                    .map(Connection::Direct)
            }
        }
    })
    .await;
    let (connection, remote) = match result {
        Ok(value) => value,
        Err(message) => return write_error(&mut socket, 502, &message).await,
    };
    if let Ok(mut routes) = state.preferred.lock() {
        if remote {
            if routes.len() >= 128 {
                routes.clear();
            }
            routes.insert(key, Instant::now() + Duration::from_secs(120));
        } else {
            routes.remove(&key);
        }
    }
    if remote {
        (state.on_relay)();
    } else if let Ok(mut verified) = state.verified.lock() {
        if verified.len() >= 128 {
            verified.clear();
        }
        verified.insert(
            request.target.authority(),
            Instant::now() + Duration::from_secs(120),
        );
    }
    if request.connect {
        socket
            .write_all(b"HTTP/1.1 200 Connection Established\r\n\r\n")
            .await?;
    }
    // From this point onward the route is fixed. Never reconnect or replay
    // TLS records, uploads, POSTs, or other application data after an error.
    match connection {
        Connection::Direct(mut tcp) => {
            tcp.write_all(&request.initial).await?;
            tokio::io::copy_bidirectional(&mut socket, &mut tcp)
                .await
                .map(|_| ())
        }
        Connection::Relay(mut websocket) => {
            if !request.initial.is_empty() {
                websocket
                    .send(Message::Binary(request.initial))
                    .await
                    .map_err(|e| io::Error::other(e.to_string()))?;
            }
            let (sink, stream) = (*websocket).split();
            let sink = sink.with(|frame| {
                future::ready(Ok::<_, tungstenite::Error>(match frame {
                    Frame::Data(bytes) => Message::Binary(bytes),
                    Frame::Eof => Message::Text("eof".into()),
                }))
            });
            let stream = stream.filter_map(|message| {
                future::ready(match message {
                    Ok(Message::Binary(bytes)) => Some(Ok(Frame::Data(bytes))),
                    Ok(Message::Text(text)) if text == "eof" => Some(Ok(Frame::Eof)),
                    Ok(Message::Close(_)) => Some(Ok(Frame::Eof)),
                    Ok(Message::Ping(_) | Message::Pong(_)) => None,
                    Ok(_) => Some(Err(tungstenite::Error::Io(io::Error::other(
                        "Invalid tunnel frame",
                    )))),
                    Err(error) => Some(Err(error)),
                })
            });
            alpha_agent_network::bridge(socket, sink, stream).await
        }
    }
}

async fn write_error(socket: &mut TcpStream, code: u16, message: &str) -> io::Result<()> {
    let auth = if code == 407 {
        "Proxy-Authenticate: Basic realm=\"Alpha Agent\"\r\n"
    } else {
        ""
    };
    socket.write_all(format!("HTTP/1.1 {code} Proxy Error\r\n{auth}Content-Type: text/plain\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{message}", message.len()).as_bytes()).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(base: String) -> RelayConfig {
        RelayConfig {
            api_base_url: base,
            tenant_id: "tenant".into(),
            device_id: "device".into(),
            access_token: "device-test-secret".into(),
        }
    }

    #[test]
    fn authenticates_proxy_and_preserves_original_http_request() {
        let header = b"POST http://example.com/data?q=1 HTTP/1.1\r\nHost: example.com\r\nProxy-Authorization: Basic local-token\r\nAuthorization: Bearer source-token\r\nContent-Length: 3";
        let request = parse_request(header, b"abc", "Basic local-token").unwrap();
        assert_eq!(
            request.target,
            Target {
                host: "example.com".into(),
                port: 80
            }
        );
        let forwarded = String::from_utf8(request.initial).unwrap();
        assert!(forwarded.starts_with("POST /data?q=1 HTTP/1.1\r\n"));
        assert!(forwarded.contains("Authorization: Bearer source-token"));
        assert!(forwarded.ends_with("\r\n\r\nabc"));
        assert!(!forwarded.contains("local-token"));
        assert_eq!(parse_request(header, b"", "wrong").unwrap_err().0, 407);
        let request = parse_request(
            b"CONNECT example.com:443 HTTP/1.1\r\nProxy-Authorization: Basic local-token",
            b"opaque-tls",
            "Basic local-token",
        )
        .unwrap();
        assert!(request.connect);
        assert_eq!(request.initial, b"opaque-tls");
    }

    #[tokio::test]
    async fn falls_back_before_sending_and_never_retries_policy_errors() {
        let calls = Mutex::new(Vec::new());
        let (_, remote) = choose_connection(false, |remote| {
            calls.lock().unwrap().push(remote);
            async move {
                if remote {
                    Ok(1)
                } else {
                    Err(ConnectError::Network("DNS".into()))
                }
            }
        })
        .await
        .unwrap();
        assert!(remote);
        assert_eq!(*calls.lock().unwrap(), [false, true]);
        let result: Result<((), bool), _> = choose_connection(false, |remote| async move {
            assert!(!remote);
            Err(ConnectError::Policy("private".into()))
        })
        .await;
        assert!(result.is_err());
        let (_, remote) = choose_connection(true, |remote| async move {
            if remote {
                Err(ConnectError::Network("old server".into()))
            } else {
                Ok(1)
            }
        })
        .await
        .unwrap();
        assert!(!remote);
    }

    #[tokio::test]
    async fn normal_local_http_stays_direct_and_proxy_stops_with_task() {
        let origin = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin_address = origin.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = origin.accept().await.unwrap();
            let mut bytes = vec![0; 4096];
            let count = socket.read(&mut bytes).await.unwrap();
            let request = String::from_utf8_lossy(&bytes[..count]);
            assert!(request.starts_with("GET /data HTTP/1.1"));
            assert!(!request.contains("Proxy-Authorization"));
            socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                .await
                .unwrap();
        });
        let proxy = start_proxy(
            config("http://127.0.0.1:1".into()),
            Arc::new(|| panic!("local source must not use relay")),
        )
        .await
        .unwrap();
        let url = reqwest::Url::parse(&proxy.address).unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(&proxy.address).unwrap())
            .build()
            .unwrap();
        let response = client
            .get(format!("http://{origin_address}/data"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.text().await.unwrap(), "ok");
        server.await.unwrap();
        proxy.stop();
        tokio::time::timeout(Duration::from_secs(2), async {
            while TcpStream::connect((url.host_str().unwrap(), url.port().unwrap()))
                .await
                .is_ok()
            {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn original_http_request_uses_cached_relay_without_leaking_proxy_auth() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let relay = tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            let mut websocket = tokio_tungstenite::accept_hdr_async(
                socket,
                |request: &tungstenite::handshake::server::Request, response| {
                    assert_eq!(
                        request.headers()["authorization"],
                        "Bearer device-test-secret"
                    );
                    assert!(request
                        .uri()
                        .to_string()
                        .contains("host=alpha-source.invalid"));
                    Ok(response)
                },
            )
            .await
            .unwrap();
            let request = websocket.next().await.unwrap().unwrap().into_data();
            let request = String::from_utf8(request).unwrap();
            assert!(request.starts_with("GET /report.csv HTTP/1.1"));
            assert!(!request.contains("Proxy-Authorization"));
            assert!(!request.contains("device-test-secret"));
            websocket
                .send(Message::Binary(
                    b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\na,b"
                        .to_vec(),
                ))
                .await
                .unwrap();
            websocket.send(Message::Text("eof".into())).await.unwrap();
            while let Some(Ok(message)) = websocket.next().await {
                if matches!(message, Message::Text(_) | Message::Close(_)) {
                    break;
                }
            }
        });
        let proxy = start_proxy(config(base), Arc::new(|| {})).await.unwrap();
        proxy.preferred.lock().unwrap().insert(
            "alpha-source.invalid:80".into(),
            Instant::now() + Duration::from_secs(120),
        );
        let client = reqwest::Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(&proxy.address).unwrap())
            .timeout(Duration::from_secs(12))
            .build()
            .unwrap();
        let response = client
            .get("http://alpha-source.invalid/report.csv")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.text().await.unwrap(), "a,b");
        drop(client);
        proxy.stop();
        tokio::time::timeout(Duration::from_secs(2), relay)
            .await
            .unwrap()
            .unwrap();
    }

    #[test]
    fn configuration_stays_in_shell_environment_and_redacts_device_token() {
        let entries = proxy_environment("http://local-proxy", "localhost");
        assert!(entries.iter().any(|(key, _)| *key == "https_proxy"));
        assert!(
            !format!("{:?}", config("https://example.com".into())).contains("device-test-secret")
        );
        assert!(config("http://example.com".into()).endpoint().is_err());
        assert!(config("https://user:pass@example.com".into())
            .endpoint()
            .is_err());
    }
}
