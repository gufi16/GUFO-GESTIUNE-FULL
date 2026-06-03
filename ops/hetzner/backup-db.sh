#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${APP_ROOT:-/opt/poshard/gufo-gestiune-full}"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/poshard/backups/gufo}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
API_CONTAINER="${API_CONTAINER:-gufo-gestiune-full-api-1}"
STAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_DIR="${BACKUP_ROOT}/daily"
TARGET_FILE="${TARGET_DIR}/gufo-db-${STAMP}.dump"

mkdir -p "${TARGET_DIR}"

DATABASE_URL="${DATABASE_URL:-$(docker exec "${API_CONTAINER}" printenv DATABASE_URL)}"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL is missing." >&2
  exit 1
fi

docker run --rm \
  -e DATABASE_URL="${DATABASE_URL}" \
  -v "${TARGET_DIR}:/backup" \
  postgres:16-alpine \
  sh -lc "pg_dump \"${DATABASE_URL}\" -Fc -f /backup/$(basename "${TARGET_FILE}")"

find "${TARGET_DIR}" -type f -name 'gufo-db-*.dump' -mtime +"${RETENTION_DAYS}" -delete
echo "Backup saved to ${TARGET_FILE}"
