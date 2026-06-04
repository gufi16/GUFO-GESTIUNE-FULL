#!/usr/bin/env bash
set -euo pipefail

FRONTEND_URL="${FRONTEND_URL:-https://app.gufo.ink}"
API_HEALTH_URL="${API_HEALTH_URL:-https://api.gufo.ink/health}"
DOMAIN_ALLOW_URL="${DOMAIN_ALLOW_URL:-https://api.gufo.ink/api/v1/public/domain-allow?domain=app.gufo.ink}"
LOGIN_PAGE_URL="${LOGIN_PAGE_URL:-https://app.gufo.ink/login}"

echo "[smoke] frontend root ${FRONTEND_URL}"
curl --fail --silent --show-error "${FRONTEND_URL}" >/dev/null

echo "[smoke] login page ${LOGIN_PAGE_URL}"
curl --fail --silent --show-error "${LOGIN_PAGE_URL}" >/dev/null

echo "[smoke] api health ${API_HEALTH_URL}"
curl --fail --silent --show-error "${API_HEALTH_URL}" >/dev/null

echo "[smoke] domain allow ${DOMAIN_ALLOW_URL}"
curl --fail --silent --show-error "${DOMAIN_ALLOW_URL}" >/dev/null

echo "[smoke] ok"
