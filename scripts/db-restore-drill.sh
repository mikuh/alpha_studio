#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /absolute/or/relative/path/to/backup.dump" >&2
  exit 2
fi

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
backup_input="$1"
backup_dir="$(cd "$(dirname "$backup_input")" && pwd -P)"
backup_path="$backup_dir/$(basename "$backup_input")"
if [[ ! -f "$backup_path" || -L "$backup_path" ]]; then
  echo "Backup must be a regular, non-symlink file: $backup_path" >&2
  exit 1
fi

drill_db="alpha_restore_drill_$(date -u +%Y%m%d%H%M%S)_$$"
if [[ ! "$drill_db" =~ ^alpha_restore_drill_[0-9_]+$ ]]; then
  echo "Generated drill database name is invalid." >&2
  exit 1
fi

created=0
cleanup() {
  if [[ "$created" -eq 1 ]]; then
    docker compose exec -T postgres sh -c \
      'exec dropdb -U "$POSTGRES_USER" --if-exists -- "$1"' sh "$drill_db" >/dev/null
  fi
}
trap cleanup EXIT

cd "$repo_dir"
docker compose exec -T postgres pg_restore --list < "$backup_path" >/dev/null
docker compose exec -T postgres sh -c \
  'exec createdb -U "$POSTGRES_USER" -- "$1"' sh "$drill_db"
created=1
docker compose exec -T postgres sh -c \
  'exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-acl --exit-on-error' sh "$drill_db" \
  < "$backup_path"

verification="$(docker compose exec -T postgres sh -c \
  'exec psql -U "$POSTGRES_USER" -d "$1" -At -v ON_ERROR_STOP=1 -c "select (select count(*) from _sqlx_migrations), (select count(*) from tenants), (select count(*) from billing_ledger);"' sh "$drill_db")"
IFS='|' read -r migration_count tenant_count ledger_count <<< "$verification"
if [[ -z "$migration_count" || "$migration_count" -lt 1 ]]; then
  echo "Restore drill failed migration-table verification." >&2
  exit 1
fi

printf 'restore_drill=passed\ndatabase=%s\nmigrations=%s\ntenants=%s\nledger_entries=%s\n' \
  "$drill_db" "$migration_count" "$tenant_count" "$ledger_count"
