#!/usr/bin/env bash
set -euo pipefail

base_url="${1:-${BASE_URL:-}}"
if [[ -z "$base_url" ]]; then
  echo "usage: BASE_URL=https://staging.example.com $0" >&2
  exit 2
fi
base_url="${base_url%/}"

health="$(curl --fail --silent --show-error --max-time 15 "$base_url/healthz")"
ready="$(curl --fail --silent --show-error --max-time 15 "$base_url/readyz")"
[[ "$health" == *'"status":"ok"'* ]] || { echo "healthz response is invalid" >&2; exit 1; }
[[ "$ready" == *'"status":"ready"'* ]] || { echo "readyz response is invalid" >&2; exit 1; }

admin_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 "$base_url/admin/")"
[[ "$admin_status" == "200" ]] || { echo "admin returned HTTP $admin_status" >&2; exit 1; }

metrics_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 "$base_url/metrics")"
[[ "$metrics_status" == "404" ]] || { echo "public metrics endpoint returned HTTP $metrics_status" >&2; exit 1; }

run_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 "$base_url/v1/run-status")"
[[ "$run_status" == "401" ]] || { echo "run-status auth check returned HTTP $run_status" >&2; exit 1; }

tunnel_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Version: 13' \
  "$base_url/api/client/agent-network/tunnel?tenantId=smoke&deviceId=smoke&host=example.com&port=443")"
[[ "$tunnel_status" == "401" ]] || { echo "agent tunnel auth check returned HTTP $tunnel_status" >&2; exit 1; }

request_headers="$(mktemp)"
trap 'rm -f "$request_headers"' EXIT
curl --fail --silent --show-error --output /dev/null --dump-header "$request_headers" --max-time 15 "$base_url/healthz"
grep -qi '^x-request-id:' "$request_headers" || { echo "x-request-id header is missing" >&2; exit 1; }

echo "smoke test passed: $base_url"
