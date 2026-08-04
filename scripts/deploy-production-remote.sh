#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 4 ]]; then
  echo "usage: $0 BUNDLE OVERLAY BRANCH SHA" >&2
  exit 2
fi

bundle="$1"
overlay="$2"
branch="$3"
expected_sha="$4"
target="${DEPLOY_PATH:-/root/workspace/alpha_studio}"
base_url="${PRODUCTION_BASE_URL:-https://api.yuanliu.ai}"

if [[ ! "$target" =~ ^/root/workspace/[A-Za-z0-9._/-]+$ ||
      "$target" == *".."* ||
      ! "$branch" =~ ^[A-Za-z0-9._/-]+$ ||
      ! "$expected_sha" =~ ^[0-9a-f]{40}$ ||
      ! "$base_url" =~ ^https://[A-Za-z0-9._:-]+$ ||
      ! -f "$bundle" || ! -f "$overlay" || ! -d "$target/.git" ]]; then
  echo "Invalid production deployment input." >&2
  exit 2
fi

for command_name in curl docker git openssl tar; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required on the production host" >&2
    exit 1
  }
done
docker compose version >/dev/null

workspace_root="$(dirname "$target")"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
release_root="$workspace_root/releases"
backup_root="$workspace_root/deploy-backups"
backup_dir="$backup_root/alpha-studio-$timestamp-${expected_sha:0:12}"
release_dir="$release_root/alpha-studio-$timestamp-${expected_sha:0:12}"
mkdir -p "$release_root" "$backup_dir"
chmod 700 "$backup_dir"

old_sha="$(git -C "$target" rev-parse HEAD)"
origin_url="$(git -C "$target" remote get-url origin)"
old_api_image="$(docker inspect --format '{{.Image}}' alpha_studio-api-1 2>/dev/null || true)"
old_admin_image="$(docker inspect --format '{{.Image}}' alpha_studio-admin-web-1 2>/dev/null || true)"
old_api_rollback_tag=""
old_admin_rollback_tag=""
if [[ -n "$old_api_image" ]] && docker image inspect "$old_api_image" >/dev/null 2>&1; then
  old_api_rollback_tag="alpha_studio-api:rollback-$timestamp"
  docker image tag "$old_api_image" "$old_api_rollback_tag"
fi
if [[ -n "$old_admin_image" ]] && docker image inspect "$old_admin_image" >/dev/null 2>&1; then
  old_admin_rollback_tag="alpha_studio-admin-web:rollback-$timestamp"
  docker image tag "$old_admin_image" "$old_admin_rollback_tag"
fi
git -C "$target" status --short --branch > "$backup_dir/git-status.txt"
git -C "$target" diff --binary > "$backup_dir/worktree.patch"
git -C "$target" ls-files --others --exclude-standard -z > "$backup_dir/untracked-files.list"
if [[ -s "$backup_dir/untracked-files.list" ]]; then
  tar -C "$target" --null -czf "$backup_dir/untracked-files.tar.gz" -T "$backup_dir/untracked-files.list"
fi
if [[ -f "$target/.env" ]]; then cp -p "$target/.env" "$backup_dir/previous.env"; fi
if [[ -d "$target/secrets" ]]; then cp -Rp "$target/secrets" "$backup_dir/previous-secrets"; fi
printf 'previous_sha=%s\nrelease_sha=%s\nstarted_at=%s\n' "$old_sha" "$expected_sha" "$timestamp" > "$backup_dir/release.txt"

git clone --quiet --branch "$branch" "$bundle" "$release_dir"
actual_sha="$(git -C "$release_dir" rev-parse HEAD)"
if [[ "$actual_sha" != "$expected_sha" ]]; then
  echo "Bundle resolved to $actual_sha instead of $expected_sha" >&2
  exit 1
fi
git -C "$release_dir" remote set-url origin "$origin_url"
tar -xzf "$overlay" -C "$release_dir"
chmod +x "$release_dir"/scripts/deploy-production*.sh "$release_dir/scripts/prepare-production-env.sh"
if [[ -f "$target/.env" ]]; then cp -p "$target/.env" "$release_dir/.env"; fi
if [[ -d "$target/secrets" ]]; then cp -Rp "$target/secrets" "$release_dir/secrets"; fi

cd "$release_dir"
PRODUCTION_BASE_URL="$base_url" bash scripts/prepare-production-env.sh
migration_files=(migrations/*.sql)
expected_migrations="${#migration_files[@]}"
if [[ "$expected_migrations" -eq 0 ]]; then
  echo "Release contains no database migrations." >&2
  exit 1
fi

compose() {
  COMPOSE_PROJECT_NAME=alpha_studio docker compose -f docker-compose.yml -f deploy/production.compose.yml "$@"
}

compose config --quiet
compose build api admin-web

backup_output="$(COMPOSE_PROJECT_NAME=alpha_studio bash scripts/db-backup.sh "$workspace_root/backups/postgres")"
printf '%s\n' "$backup_output"
backup_path="$(printf '%s\n' "$backup_output" | awk -F= '$1 == "backup" { print $2 }')"
if [[ -z "$backup_path" || ! -f "$backup_path" ]]; then
  echo "Database backup path was not produced." >&2
  exit 1
fi
COMPOSE_PROJECT_NAME=alpha_studio bash scripts/db-restore-drill.sh "$backup_path"

drill_db="alpha_migration_drill_$(date -u +%Y%m%d%H%M%S)_$$"
drill_created=0
services_stopped=0
code_switched=0
deployment_succeeded=0

cleanup() {
  status=$?
  set +e
  if [[ "$drill_created" == "1" ]]; then
    compose exec -T postgres sh -c 'exec dropdb -U "$POSTGRES_USER" --if-exists -- "$1"' sh "$drill_db" >/dev/null
  fi
  if [[ "$deployment_succeeded" != "1" ]]; then
    echo "Deployment failed; restoring the previous application release." >&2
    if [[ "$code_switched" == "1" ]]; then
      failed_dir="$backup_dir/failed-release"
      mv -- "$target" "$failed_dir"
      mv -- "$backup_dir/code" "$target"
      cd "$target"
      if [[ -n "$old_api_rollback_tag" ]]; then docker image tag "$old_api_rollback_tag" alpha_studio-api:latest; fi
      if [[ -n "$old_admin_rollback_tag" ]]; then docker image tag "$old_admin_rollback_tag" alpha_studio-admin-web:latest; fi
      COMPOSE_PROJECT_NAME=alpha_studio docker compose up -d >/dev/null 2>&1
    elif [[ "$services_stopped" == "1" ]]; then
      cd "$target"
      if [[ -n "$old_api_rollback_tag" ]]; then docker image tag "$old_api_rollback_tag" alpha_studio-api:latest; fi
      if [[ -n "$old_admin_rollback_tag" ]]; then docker image tag "$old_admin_rollback_tag" alpha_studio-admin-web:latest; fi
      COMPOSE_PROJECT_NAME=alpha_studio docker compose up -d api admin-web >/dev/null 2>&1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

compose exec -T postgres sh -c 'exec createdb -U "$POSTGRES_USER" -- "$1"' sh "$drill_db"
drill_created=1
compose exec -T postgres sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-acl --exit-on-error' sh "$drill_db" < "$backup_path"
compose run --no-deps --rm -e MIGRATION_DRILL_DB="$drill_db" api sh -c \
  'DATABASE_URL="${DATABASE_URL%/*}/$MIGRATION_DRILL_DB"; export DATABASE_URL; exec alpha-studio-backend migrate'
drill_migrations="$(compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$1" -At -v ON_ERROR_STOP=1 -c "select count(*) from _sqlx_migrations where success"' sh "$drill_db")"
if [[ "$drill_migrations" != "$expected_migrations" ]]; then
  echo "Migration drill expected $expected_migrations migrations, found $drill_migrations." >&2
  exit 1
fi
compose exec -T postgres sh -c 'exec dropdb -U "$POSTGRES_USER" --if-exists -- "$1"' sh "$drill_db"
drill_created=0

compose stop api admin-web
services_stopped=1
compose run --no-deps --rm api alpha-studio-backend migrate
production_migrations="$(compose exec -T postgres sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "select count(*) from _sqlx_migrations where success"')"
if [[ "$production_migrations" != "$expected_migrations" ]]; then
  echo "Production expected $expected_migrations migrations, found $production_migrations." >&2
  exit 1
fi

mv -- "$target" "$backup_dir/code"
mv -- "$release_dir" "$target"
code_switched=1
cd "$target"
compose up -d --remove-orphans

healthy=0
for _ in $(seq 1 30); do
  if curl --fail --silent --show-error --max-time 5 "$base_url/readyz" | grep -q '"status":"ready"'; then
    healthy=1
    break
  fi
  sleep 2
done
if [[ "$healthy" != "1" ]]; then
  compose ps
  compose logs --tail=200 api
  echo "Production readiness check timed out." >&2
  exit 1
fi
bash scripts/smoke-test.sh "$base_url"
compose ps

completed_at="$(date -u +%Y%m%dT%H%M%SZ)"
printf 'completed_at=%s\nbackup=%s\nmigrations=%s\n' "$completed_at" "$backup_path" "$production_migrations" >> "$backup_dir/release.txt"
deployment_succeeded=1
services_stopped=0
echo "deployed_sha=$expected_sha"
echo "database_backup=$backup_path"
echo "rollback_snapshot=$backup_dir"
