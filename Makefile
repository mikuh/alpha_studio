SHELL := /usr/bin/env bash
DMG_SIGNING_IDENTITY ?= -

.DEFAULT_GOAL := help

.PHONY: help verify-release dmg deploy-production deploy-production-dry-run production-status production-logs production-backup sync-production-models

help:
	@printf '%s\n' \
	  'make verify-release              Run frontend, backend, and desktop tests/builds' \
	  'make dmg                         Build the production macOS DMG (ad-hoc signed by default)' \
	  'make deploy-production           Backup, migrate, deploy, and smoke-test production' \
	  'make deploy-production-dry-run   Resolve and validate a production release without changing it' \
	  'make production-status           Show production containers and deployed Git revision' \
	  'make production-logs             Tail the production API logs (LOG_LINES=200)' \
	  'make production-backup           Create and validate a production PostgreSQL backup' \
	  'make sync-production-models      Copy enabled local providers/models to production'

verify-release:
	npm ci
	npm run test:run
	npm run build
	npm run bundle:check
	cargo test --locked --manifest-path backend/Cargo.toml
	cargo test --locked --manifest-path src-tauri/Cargo.toml

dmg:
	npm ci
	npx tauri build --bundles dmg --config '{"bundle":{"macOS":{"signingIdentity":"$(DMG_SIGNING_IDENTITY)"}}}'

deploy-production:
	bash scripts/deploy-production.sh

deploy-production-dry-run:
	DEPLOY_DRY_RUN=1 bash scripts/deploy-production.sh

production-status:
	ssh "$${DEPLOY_HOST:-alpha}" 'cd "$${DEPLOY_PATH:-/root/workspace/alpha_studio}" && git status --short --branch && git log -1 --oneline && COMPOSE_PROJECT_NAME=alpha_studio docker compose -f docker-compose.yml -f deploy/production.compose.yml ps'

production-logs:
	ssh "$${DEPLOY_HOST:-alpha}" 'cd "$${DEPLOY_PATH:-/root/workspace/alpha_studio}" && COMPOSE_PROJECT_NAME=alpha_studio docker compose -f docker-compose.yml -f deploy/production.compose.yml logs --tail="$${LOG_LINES:-200}" api'

production-backup:
	ssh "$${DEPLOY_HOST:-alpha}" 'cd "$${DEPLOY_PATH:-/root/workspace/alpha_studio}" && COMPOSE_PROJECT_NAME=alpha_studio bash scripts/db-backup.sh /root/workspace/backups/postgres'

sync-production-models: production-backup
	node scripts/sync-production-models-to-production.mjs --apply
