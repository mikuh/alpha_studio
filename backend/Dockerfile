FROM rust:1.90-bookworm AS builder

ENV CARGO_HTTP_TIMEOUT=600 \
    CARGO_HTTP_LOW_SPEED_LIMIT=1 \
    CARGO_NET_RETRY=10

WORKDIR /app
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY crates/agent-network /crates/agent-network
COPY migrations /migrations
COPY shared /shared
RUN --mount=type=cache,id=alpha-studio-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=alpha-studio-cargo-git,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,id=alpha-studio-backend-target,target=/app/target,sharing=locked \
    cargo build --release && cp target/release/alpha-studio-backend /tmp/alpha-studio-backend

FROM debian:bookworm-slim AS runtime

RUN useradd --system --uid 10001 --create-home alpha
WORKDIR /app
COPY --from=builder /tmp/alpha-studio-backend /usr/local/bin/alpha-studio-backend
USER alpha
EXPOSE 8080
CMD ["alpha-studio-backend"]
