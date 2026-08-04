#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
env_file="${PRODUCTION_ENV_FILE:-$repo_dir/.env}"
secret_dir="${PRODUCTION_SECRET_DIR:-$repo_dir/secrets}"

if [[ -L "$env_file" || -L "$secret_dir" ]]; then
  echo "Refusing to manage production configuration through a symbolic link." >&2
  exit 1
fi

mkdir -p "$secret_dir"
chmod 700 "$secret_dir"
touch "$env_file"
chmod 600 "$env_file"

env_value() {
  local key="$1"
  awk -F= -v wanted="$key" '$1 == wanted { print substr($0, index($0, "=") + 1); exit }' "$env_file"
}

upsert_env() {
  local key="$1"
  local value="$2"
  local temp_file
  temp_file="$(mktemp "${env_file}.XXXXXX")"
  awk -v wanted="$key" -v replacement="$key=$value" '
    BEGIN { replaced = 0 }
    $0 ~ "^" wanted "=" {
      if (!replaced) print replacement
      replaced = 1
      next
    }
    { print }
    END { if (!replaced) print replacement }
  ' "$env_file" > "$temp_file"
  chmod 600 "$temp_file"
  mv -- "$temp_file" "$env_file"
}

remove_env() {
  local key="$1"
  local temp_file
  temp_file="$(mktemp "${env_file}.XXXXXX")"
  awk -v wanted="$key" '$0 !~ "^" wanted "=" { print }' "$env_file" > "$temp_file"
  chmod 600 "$temp_file"
  mv -- "$temp_file" "$env_file"
}

require_env() {
  local key="$1"
  if [[ -z "$(env_value "$key")" ]]; then
    echo "$key is required in $env_file" >&2
    exit 1
  fi
}

write_secret() {
  local key="$1"
  local path="$2"
  local generator="$3"
  local existing
  existing="$(env_value "$key")"
  if [[ ! -s "$path" ]]; then
    if [[ -n "$existing" ]]; then
      printf '%s\n' "$existing" > "$path"
    else
      case "$generator" in
        hex) openssl rand -hex 48 > "$path" ;;
        base32) openssl rand 32 | base32 | tr -d '=\n' > "$path"; printf '\n' >> "$path" ;;
        *) echo "Unknown secret generator: $generator" >&2; exit 1 ;;
      esac
    fi
  fi
  if [[ "$(id -u)" == "0" ]]; then
    chown 10001:10001 "$path"
    chmod 400 "$path"
  else
    chmod 600 "$path"
  fi
  if [[ "$(wc -c < "$path" | tr -d ' ')" -lt 33 ]]; then
    echo "Secret file is too short: $path" >&2
    exit 1
  fi
  remove_env "$key"
}

for command_name in awk base32 openssl; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required to prepare production configuration" >&2
    exit 1
  }
done

for required_key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL REDIS_URL JWT_SECRET RUN_TOKEN_SECRET ADMIN_EMAIL ADMIN_PASSWORD; do
  require_env "$required_key"
done

base_url="${PRODUCTION_BASE_URL:-$(env_value APP_BASE_URL)}"
base_url="${base_url%/}"
if [[ ! "$base_url" =~ ^https://[A-Za-z0-9._:-]+$ ]]; then
  echo "PRODUCTION_BASE_URL/APP_BASE_URL must be an HTTPS origin without a path." >&2
  exit 1
fi

authorization_key="$(env_value AUTHORIZATION_CODE_ENCRYPTION_KEY)"
if [[ -z "$authorization_key" ]]; then
  authorization_key="$(openssl rand -hex 48)"
  upsert_env AUTHORIZATION_CODE_ENCRYPTION_KEY "$authorization_key"
fi

provider_secret="$secret_dir/provider_kms_master_key"
totp_secret="$secret_dir/admin_totp_secret"
write_secret PROVIDER_KMS_MASTER_KEY "$provider_secret" hex
write_secret ADMIN_TOTP_SECRET "$totp_secret" base32

upsert_env APP_ENV production
upsert_env LOG_FORMAT json
upsert_env APP_BASE_URL "$base_url"
upsert_env VITE_ALPHA_API_BASE_URL "$base_url"
upsert_env PROVIDER_KMS_MASTER_KEY_FILE /run/secrets/provider_kms_master_key
upsert_env ADMIN_TOTP_SECRET_FILE /run/secrets/admin_totp_secret

if [[ -z "$(env_value CORS_ALLOWED_ORIGINS)" ]]; then
  upsert_env CORS_ALLOWED_ORIGINS "tauri://localhost,http://tauri.localhost,https://tauri.localhost,$base_url"
fi
if [[ -z "$(env_value MIN_GATEWAY_MARKUP_BPS)" ]]; then upsert_env MIN_GATEWAY_MARKUP_BPS 500; fi
if [[ -z "$(env_value MARKET_DATA_ENABLED)" ]]; then upsert_env MARKET_DATA_ENABLED true; fi
if [[ -z "$(env_value MARKET_REFRESH_SECONDS)" ]]; then upsert_env MARKET_REFRESH_SECONDS 45; fi
if [[ -z "$(env_value MARKET_SNAPSHOT_LIMIT)" ]]; then upsert_env MARKET_SNAPSHOT_LIMIT 8000; fi

admin_email="$(env_value ADMIN_EMAIL)"
totp_value="$(tr -d '\r\n' < "$totp_secret")"
enrollment_file="$secret_dir/admin-totp-enrollment.txt"
printf 'otpauth://totp/Alpha%%20Studio:%s?secret=%s&issuer=Alpha%%20Studio&algorithm=SHA1&digits=6&period=30\n' \
  "$admin_email" "$totp_value" > "$enrollment_file"
chmod 600 "$enrollment_file"

jwt_hash="$(printf '%s' "$(env_value JWT_SECRET)" | openssl dgst -sha256)"
run_hash="$(printf '%s' "$(env_value RUN_TOKEN_SECRET)" | openssl dgst -sha256)"
authorization_hash="$(printf '%s' "$authorization_key" | openssl dgst -sha256)"
provider_hash="$(openssl dgst -sha256 "$provider_secret")"
if [[ "$jwt_hash" == "$run_hash" || "$jwt_hash" == "$authorization_hash" || "$run_hash" == "$authorization_hash" || "$provider_hash" == *"${jwt_hash##* }" || "$provider_hash" == *"${run_hash##* }" || "$provider_hash" == *"${authorization_hash##* }" ]]; then
  echo "Production secrets must all be different." >&2
  exit 1
fi

echo "production environment prepared: $env_file"
echo "production secret files prepared: $secret_dir"
echo "TOTP enrollment URI stored with mode 0600: $enrollment_file"
