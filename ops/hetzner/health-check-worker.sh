#!/usr/bin/env bash
set -euo pipefail

WORKER_HEARTBEAT_FILE="${WORKER_HEARTBEAT_FILE:-/opt/poshard/gufo-gestiune-full/uploads/ops/worker-heartbeat.json}"
WORKER_MAX_AGE_SECONDS="${WORKER_MAX_AGE_SECONDS:-180}"
WORKER_CONTAINER="${WORKER_CONTAINER:-gufo-gestiune-full-worker-1}"

docker inspect "${WORKER_CONTAINER}" --format '{{.State.Running}}' | grep -q true

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

echo "[worker-health] ok"
