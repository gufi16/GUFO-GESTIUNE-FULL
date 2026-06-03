#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /absolute/path/to/backup.dump" >&2
  exit 1
fi

BACKUP_FILE="$1"
API_CONTAINER="${API_CONTAINER:-gufo-gestiune-full-api-1}"
BACKUP_MOUNT_DIR="/restore"

if [[ ! -f "${BACKUP_FILE}" ]]; then
  echo "Backup file not found: ${BACKUP_FILE}" >&2
  exit 1
fi

DATABASE_URL="${DATABASE_URL:-$(docker exec "${API_CONTAINER}" printenv DATABASE_URL)}"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "DATABASE_URL is missing." >&2
  exit 1
fi

docker run --rm \
  -e DATABASE_URL="${DATABASE_URL}" \
  -v "$(dirname "${BACKUP_FILE}"):${BACKUP_MOUNT_DIR}" \
  postgres:16-alpine \
  sh -lc "pg_restore --clean --if-exists --no-owner --no-privileges -d \"${DATABASE_URL}\" \"${BACKUP_MOUNT_DIR}/$(basename "${BACKUP_FILE}")\""

echo "Restore completed from ${BACKUP_FILE}"
