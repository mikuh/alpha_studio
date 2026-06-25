FROM rust:1.90-bookworm AS builder

WORKDIR /app
COPY backend/Cargo.toml backend/Cargo.lock ./
COPY backend/src ./src
COPY migrations /migrations
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN useradd --system --uid 10001 --create-home alpha
WORKDIR /app
COPY --from=builder /app/target/release/alpha-studio-backend /usr/local/bin/alpha-studio-backend
USER alpha
EXPOSE 8080
CMD ["alpha-studio-backend"]
