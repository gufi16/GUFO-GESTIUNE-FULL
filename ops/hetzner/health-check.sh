#!/usr/bin/env bash
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-https://app.gufo.ink}"
API_URL="${API_URL:-https://api.gufo.ink/health}"
WORKER_HEARTBEAT_FILE="${WORKER_HEARTBEAT_FILE:-}"
WORKER_MAX_AGE_SECONDS="${WORKER_MAX_AGE_SECONDS:-180}"
API_CONTAINER="${API_CONTAINER:-gufo-gestiune-full-api-1}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-gufo-gestiune-full-frontend-1}"
APP_ROOT="${APP_ROOT:-}"

if [[ -z "${WORKER_HEARTBEAT_FILE}" && -n "${APP_ROOT}" ]]; then
  WORKER_HEARTBEAT_FILE="${APP_ROOT}/uploads/ops/worker-heartbeat.json"
fi

echo "[health] frontend ${FRONTEND_URL}"
curl --fail --silent --show-error "${FRONTEND_URL}" >/dev/null

echo "[health] api ${API_URL}"
curl --fail --silent --show-error "${API_URL}" >/dev/null

echo "[health] docker containers"
docker inspect "${API_CONTAINER}" --format '{{.State.Running}}' | grep -q true
docker inspect "${FRONTEND_CONTAINER}" --format '{{.State.Running}}' | grep -q true

if [[ -n "${WORKER_HEARTBEAT_FILE}" ]]; then
  echo "[health] worker heartbeat ${WORKER_HEARTBEAT_FILE}"
  if [[ ! -f "${WORKER_HEARTBEAT_FILE}" ]]; then
    echo "Worker heartbeat file missing." >&2
    exit 1
  fi

  NOW="$(date +%s)"
  MODIFIED="$(stat -c %Y "${WORKER_HEARTBEAT_FILE}")"
  AGE="$((NOW - MODIFIED))"
  if (( AGE > WORKER_MAX_AGE_SECONDS )); then
    echo "Worker heartbeat is stale (${AGE}s)." >&2
    exit 1
  fi
fi

echo "[health] ok"
