#!/usr/bin/env bash
set -euo pipefail

if ! command -v cargo-audit >/dev/null 2>&1; then
  echo "cargo-audit is required: cargo install cargo-audit --locked" >&2
  exit 2
fi

cargo audit --file backend/Cargo.lock
cargo audit --file src-tauri/Cargo.lock
npm audit --omit=dev
npm audit --omit=dev --prefix admin-web

echo "dependency security checks passed"
