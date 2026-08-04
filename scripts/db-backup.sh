#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
backup_dir="${1:-$repo_dir/backups/postgres}"

if [[ -L "$backup_dir" ]]; then
  echo "Refusing to write backups through a symbolic link: $backup_dir" >&2
  exit 1
fi
mkdir -p "$backup_dir"
backup_dir="$(cd "$backup_dir" && pwd -P)"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_path="$backup_dir/alpha-studio-$timestamp.dump"
temp_path="$(mktemp "$backup_dir/.alpha-studio-$timestamp.XXXXXX.dump")"
cleanup() {
  [[ -f "$temp_path" ]] && rm -f -- "$temp_path"
}
trap cleanup EXIT

cd "$repo_dir"
docker compose exec -T postgres sh -c \
  'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=9 --no-owner --no-acl' \
  > "$temp_path"

if [[ ! -s "$temp_path" ]]; then
  echo "Backup is empty; refusing to publish it." >&2
  exit 1
fi
docker compose exec -T postgres pg_restore --list < "$temp_path" >/dev/null
chmod 600 "$temp_path"
mv -- "$temp_path" "$final_path"
trap - EXIT

checksum="$(shasum -a 256 "$final_path" | awk '{print $1}')"
printf 'backup=%s\nsha256=%s\n' "$final_path" "$checksum"
