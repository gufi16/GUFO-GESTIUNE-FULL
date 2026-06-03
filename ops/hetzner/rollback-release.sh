#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <git-commit>" >&2
  exit 1
fi

TARGET_COMMIT="$1"
APP_ROOT="${APP_ROOT:-/opt/poshard/gufo-gestiune-full}"
API_CONTAINER="${API_CONTAINER:-gufo-gestiune-full-api-1}"
FRONTEND_CONTAINER="${FRONTEND_CONTAINER:-gufo-gestiune-full-frontend-1}"

cd "${APP_ROOT}"
git fetch origin
git checkout main
git reset --hard "${TARGET_COMMIT}"

export DATABASE_URL="${DATABASE_URL:-$(docker exec "${API_CONTAINER}" printenv DATABASE_URL)}"

docker run --rm \
  -e DATABASE_URL="${DATABASE_URL}" \
  -v "${APP_ROOT}/backend:/app" \
  -w /app \
  node:20-bullseye \
  sh -lc "npm ci && npm run build"

docker run --rm \
  -v "${APP_ROOT}/frontend:/app" \
  -w /app \
  node:20-bullseye \
  sh -lc "npm ci && npm run build"

docker cp "${APP_ROOT}/backend/src/." "${API_CONTAINER}:/app/src"
docker cp "${APP_ROOT}/backend/prisma/." "${API_CONTAINER}:/app/prisma"
docker cp "${APP_ROOT}/backend/package.json" "${API_CONTAINER}:/app/package.json"
docker cp "${APP_ROOT}/backend/package-lock.json" "${API_CONTAINER}:/app/package-lock.json"
docker cp "${APP_ROOT}/backend/tsconfig.json" "${API_CONTAINER}:/app/tsconfig.json"
docker cp "${APP_ROOT}/backend/.env" "${API_CONTAINER}:/app/.env"
docker cp "${APP_ROOT}/frontend/dist/." "${FRONTEND_CONTAINER}:/app/dist"

docker exec "${API_CONTAINER}" sh -lc "cd /app && npm ci && npx prisma generate"
docker restart "${FRONTEND_CONTAINER}"
docker restart "${API_CONTAINER}"

echo "Rolled back to ${TARGET_COMMIT}"
