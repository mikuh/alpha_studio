#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
deploy_host="${DEPLOY_HOST:-alpha}"
deploy_path="${DEPLOY_PATH:-/root/workspace/alpha_studio}"
deploy_branch="${DEPLOY_BRANCH:-alpha_studio}"
base_url="${PRODUCTION_BASE_URL:-https://api.yuanliu.ai}"
dry_run="${DEPLOY_DRY_RUN:-0}"
skip_verify="${DEPLOY_SKIP_VERIFY:-0}"

if [[ ! "$deploy_host" =~ ^[A-Za-z0-9._@-]+$ ||
      ! "$deploy_branch" =~ ^[A-Za-z0-9._/-]+$ ||
      ! "$deploy_path" =~ ^/root/workspace/[A-Za-z0-9._/-]+$ ||
      "$deploy_path" == *".."* ||
      ! "$base_url" =~ ^https://[A-Za-z0-9._:-]+$ ]]; then
  echo "Unsafe deployment parameter." >&2
  exit 2
fi

for command_name in git ssh scp tar shasum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "$command_name is required for deployment" >&2
    exit 1
  }
done

cd "$repo_dir"
git diff --quiet --ignore-submodules -- || {
  echo "Tracked working-tree changes must be committed before production deployment." >&2
  exit 1
}
git diff --cached --quiet --ignore-submodules -- || {
  echo "Staged changes must be committed before production deployment." >&2
  exit 1
}

git fetch --prune origin "$deploy_branch"
release_sha="$(git rev-parse "refs/remotes/origin/$deploy_branch")"
head_sha="$(git rev-parse HEAD)"
current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$deploy_branch" || "$head_sha" != "$release_sha" ]]; then
  echo "Checkout $deploy_branch at origin/$deploy_branch before deploying." >&2
  echo "HEAD=$head_sha release=$release_sha" >&2
  exit 1
fi

overlay_paths=(
  Makefile
  deploy/production.compose.yml
  scripts/deploy-production.sh
  scripts/deploy-production-remote.sh
  scripts/prepare-production-env.sh
)
for overlay_path in "${overlay_paths[@]}"; do
  [[ -f "$overlay_path" ]] || { echo "Missing deployment asset: $overlay_path" >&2; exit 1; }
done

echo "release=$release_sha"
echo "target=$deploy_host:$deploy_path"
echo "base_url=$base_url"
if [[ "$dry_run" == "1" ]]; then
  echo "dry run passed; no production changes made"
  exit 0
fi

if [[ "$skip_verify" != "1" ]]; then
  make verify-release
fi

temp_dir="$(mktemp -d)"
remote_stage="/tmp/alpha-studio-release-${release_sha:0:12}-$$"
cleanup() {
  rm -rf -- "$temp_dir"
  ssh "$deploy_host" "rm -rf -- '$remote_stage'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

bundle="$temp_dir/alpha-studio.bundle"
overlay="$temp_dir/deployment-overlay.tar.gz"
git bundle create "$bundle" "refs/heads/$deploy_branch"
COPYFILE_DISABLE=1 tar -czf "$overlay" "${overlay_paths[@]}"
shasum -a 256 "$bundle" "$overlay"

ssh "$deploy_host" "mkdir -p '$remote_stage'"
scp "$bundle" "$overlay" scripts/deploy-production-remote.sh "$deploy_host:$remote_stage/"
ssh "$deploy_host" \
  "DEPLOY_PATH='$deploy_path' PRODUCTION_BASE_URL='$base_url' bash '$remote_stage/deploy-production-remote.sh' '$remote_stage/alpha-studio.bundle' '$remote_stage/deployment-overlay.tar.gz' '$deploy_branch' '$release_sha'"

echo "production deployment completed: $release_sha"
