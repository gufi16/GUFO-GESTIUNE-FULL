#!/usr/bin/env bash
set -euo pipefail

API_CONTAINER="${API_CONTAINER:-gufo-gestiune-full-api-1}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-gufo-gestiune-full-frontend-1}"
WORKER_CONTAINER="${WORKER_CONTAINER:-gufo-gestiune-full-worker-1}"

docker logs --tail 200 -f "${API_CONTAINER}" &
PID_API=$!
docker logs --tail 200 -f "${FRONTEND_CONTAINER}" &
PID_FRONTEND=$!

if docker ps --format '{{.Names}}' | grep -qx "${WORKER_CONTAINER}"; then
  docker logs --tail 200 -f "${WORKER_CONTAINER}" &
  PID_WORKER=$!
else
  PID_WORKER=""
fi

trap 'kill ${PID_API} ${PID_FRONTEND} ${PID_WORKER:-} 2>/dev/null || true' EXIT
wait
