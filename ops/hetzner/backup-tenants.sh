#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/poshard/gufo-gestiune-full}"
API_CONTAINER="${API_CONTAINER:-gufo-gestiune-full-api-1}"

docker exec "${API_CONTAINER}" sh -lc "cd /app && npm ci --include=dev && npx tsx src/scripts/runTenantBackupSnapshots.ts"
