//! Public TCP destinations and bounded binary transport for the Agent's
//! process-scoped HTTP proxy. No TLS interception or request replay.
use futures_util::{Sink, SinkExt, Stream, StreamExt};
use serde::{Deserialize, Serialize};
use std::{
    fmt::Display,
    io,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
};

pub const MAX_TRANSFER_BYTES: u64 = 64 * 1024 * 1024;
pub const FRAME_BYTES: usize = 32 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum ConnectError {
    #[error("{0}")]
    Policy(String),
    #[error("{0}")]
    Network(String),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Target {
    pub host: String,
    pub port: u16,
}

impl Target {
    pub fn new(host: &str, port: u16) -> Result<Self, ConnectError> {
        if !matches!(port, 80 | 443) || host.len() > 253 {
            return Err(ConnectError::Policy(
                "Only public HTTP/HTTPS destinations on ports 80/443 are supported".into(),
            ));
        }
        let host = host.trim_matches(['[', ']']);
        let authority = if host.contains(':') {
            format!("[{host}]")
        } else {
            host.to_string()
        };
        let parsed = url::Url::parse(&format!("https://{authority}/"))
            .map_err(|_| ConnectError::Policy("Invalid destination host".into()))?;
        if parsed.path() != "/"
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || parsed.port().is_some()
        {
            return Err(ConnectError::Policy("Invalid destination host".into()));
        }
        let normalized = parsed
            .host_str()
            .ok_or_else(|| ConnectError::Policy("Missing host".into()))?
            .trim_matches(['[', ']'])
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if let Ok(ip) = normalized.parse::<IpAddr>() {
            if !is_public_ip(ip) {
                return Err(ConnectError::Policy(
                    "Private and special-use addresses cannot use the relay".into(),
                ));
            }
        } else if !normalized.contains('.')
            || [".localhost", ".local", ".internal", ".home.arpa"]
                .iter()
                .any(|suffix| normalized.ends_with(suffix))
        {
            return Err(ConnectError::Policy(
                "Local and internal hosts cannot use the relay".into(),
            ));
        }
        Ok(Self {
            host: normalized,
            port,
        })
    }

    pub fn authority(&self) -> String {
        if self.host.contains(':') {
            format!("[{}]:{}", self.host, self.port)
        } else {
            format!("{}:{}", self.host, self.port)
        }
    }
}

pub fn validate_addresses(addresses: Vec<SocketAddr>) -> Result<Vec<SocketAddr>, ConnectError> {
    if addresses.is_empty() {
        return Err(ConnectError::Network("DNS returned no addresses".into()));
    }
    if addresses.iter().any(|address| !is_public_ip(address.ip())) {
        return Err(ConnectError::Policy(
            "DNS resolved to a private or special-use address".into(),
        ));
    }
    Ok(addresses)
}

pub async fn connect(target: &Target, budget: Duration) -> Result<TcpStream, ConnectError> {
    let target = Target::new(&target.host, target.port)?;
    tokio::time::timeout(budget, async {
        let addresses = tokio::net::lookup_host((target.host.as_str(), target.port))
            .await
            .map_err(|_| ConnectError::Network("DNS lookup failed".into()))?
            .collect();
        let addresses = validate_addresses(addresses)?;
        // Connect to the validated addresses directly; no second DNS lookup.
        for address in addresses.into_iter().take(16) {
            if let Ok(Ok(stream)) =
                tokio::time::timeout(Duration::from_millis(1500), TcpStream::connect(address)).await
            {
                return Ok(stream);
            }
        }
        Err(ConnectError::Network(
            "Could not connect to the destination".into(),
        ))
    })
    .await
    .map_err(|_| ConnectError::Network("Destination connection timed out".into()))?
}

#[derive(Debug)]
pub enum Frame {
    Data(Vec<u8>),
    Eof,
}

/// Explicit EOF preserves TCP half-close, so a client can finish a request
/// while still receiving the response. Both sides enforce traffic/time caps.
pub async fn bridge<T, S, R, E>(tcp: T, mut sink: S, mut stream: R) -> io::Result<()>
where
    T: AsyncRead + AsyncWrite + Unpin,
    S: Sink<Frame, Error = E> + Unpin,
    R: Stream<Item = Result<Frame, E>> + Unpin,
    E: Display,
{
    let (mut read, mut write) = tokio::io::split(tcp);
    let transferred = Arc::new(AtomicU64::new(0));
    let last_activity = Arc::new(AtomicU64::new(0));
    let started = tokio::time::Instant::now();
    let record = |count: usize| -> io::Result<()> {
        if transferred.fetch_add(count as u64, Ordering::Relaxed) + count as u64
            > MAX_TRANSFER_BYTES
        {
            return Err(io::Error::other("Agent data tunnel exceeded 64 MiB"));
        }
        last_activity.store(started.elapsed().as_secs(), Ordering::Relaxed);
        Ok(())
    };
    let up = async {
        let mut buffer = vec![0; FRAME_BYTES];
        loop {
            let count = read.read(&mut buffer).await?;
            if count == 0 {
                sink.send(Frame::Eof)
                    .await
                    .map_err(|e| io::Error::other(e.to_string()))?;
                return Ok::<_, io::Error>(());
            }
            record(count)?;
            sink.send(Frame::Data(buffer[..count].to_vec()))
                .await
                .map_err(|e| io::Error::other(e.to_string()))?;
        }
    };
    let down = async {
        while let Some(frame) = stream.next().await {
            match frame.map_err(|e| io::Error::other(e.to_string()))? {
                Frame::Eof => {
                    write.shutdown().await?;
                    return Ok::<_, io::Error>(());
                }
                Frame::Data(data) => {
                    record(data.len())?;
                    write.write_all(&data).await?;
                }
            }
        }
        write.shutdown().await
    };
    let idle = async {
        loop {
            tokio::time::sleep(Duration::from_secs(10)).await;
            if started
                .elapsed()
                .as_secs()
                .saturating_sub(last_activity.load(Ordering::Relaxed))
                >= 60
            {
                break;
            }
        }
    };
    tokio::select! {
        result = async { tokio::try_join!(up, down).map(|_| ()) } => result,
        _ = idle => Err(io::Error::new(io::ErrorKind::TimedOut, "Agent data tunnel idle timeout")),
        _ = tokio::time::sleep(Duration::from_secs(300)) => Err(io::Error::new(io::ErrorKind::TimedOut, "Agent data tunnel lifetime exceeded")),
    }
}

fn v4_in(ip: Ipv4Addr, base: [u8; 4], prefix: u32) -> bool {
    let mask = u32::MAX << (32 - prefix);
    u32::from(ip) & mask == u32::from(Ipv4Addr::from(base)) & mask
}

fn v6_in(ip: Ipv6Addr, base: Ipv6Addr, prefix: u32) -> bool {
    let mask = u128::MAX << (128 - prefix);
    u128::from(ip) & mask == u128::from(base) & mask
}

pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ![
            ([0, 0, 0, 0], 8),
            ([10, 0, 0, 0], 8),
            ([100, 64, 0, 0], 10),
            ([127, 0, 0, 0], 8),
            ([169, 254, 0, 0], 16),
            ([172, 16, 0, 0], 12),
            ([192, 0, 0, 0], 24),
            ([192, 0, 2, 0], 24),
            ([192, 88, 99, 0], 24),
            ([192, 168, 0, 0], 16),
            ([198, 18, 0, 0], 15),
            ([198, 51, 100, 0], 24),
            ([203, 0, 113, 0], 24),
            ([224, 0, 0, 0], 4),
            ([240, 0, 0, 0], 4),
        ]
        .iter()
        .any(|(base, prefix)| v4_in(ip, *base, *prefix)),
        IpAddr::V6(ip) => {
            // Only ordinary global unicast; exclude mapped/translated IPv4,
            // transition tunnels, protocol assignments and documentation ranges.
            v6_in(ip, Ipv6Addr::new(0x2000, 0, 0, 0, 0, 0, 0, 0), 3)
                && ![
                    (0x2001, 0, 23),
                    (0x2001, 0xdb8, 32),
                    (0x2002, 0, 16),
                    (0x3fff, 0, 20),
                ]
                .iter()
                .any(|(a, b, p)| v6_in(ip, Ipv6Addr::new(*a, *b, 0, 0, 0, 0, 0, 0), *p))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn blocks_special_addresses_and_non_http_destinations() {
        for host in [
            "localhost",
            "service.internal",
            "127.0.0.1",
            "127.1",
            "2130706433",
            "0x7f000001",
            "169.254.169.254",
            "10.1.2.3",
            "100.64.0.1",
            "192.0.2.1",
            "198.18.0.1",
            "224.0.0.1",
            "::1",
            "::ffff:127.0.0.1",
            "fc00::1",
            "64:ff9b::a00:1",
            "2001:db8::1",
            "2002:7f00:1::1",
            "user@example.com",
            "example.com/path",
            "example.com?query",
            "example.com#fragment",
        ] {
            assert!(Target::new(host, 443).is_err(), "{host}");
        }
        assert!(Target::new("example.com", 22).is_err());
        assert!(Target::new("example.com", 8080).is_err());
        assert_eq!(
            Target::new("EXAMPLE.COM.", 443).unwrap().host,
            "example.com"
        );
        assert!(Target::new("2606:4700:4700::1111", 443).is_ok());
        assert!(validate_addresses(vec![
            "8.8.8.8:443".parse().unwrap(),
            "127.0.0.1:443".parse().unwrap()
        ])
        .is_err());
    }
}
