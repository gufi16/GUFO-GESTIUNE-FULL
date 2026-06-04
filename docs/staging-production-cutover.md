# Staging And Production Cutover

## Goal

Keep `staging` and `production` as two separate environments with separate runtime state.

## Mandatory Separation

Staging must have:

- separate frontend domain
- separate API domain
- separate PostgreSQL database
- separate uploads folder
- separate containers
- separate secrets

Production must never reuse staging DB or uploads.

## Example Layout

### Production

- app: `https://app.gufo.ink`
- api: `https://api.gufo.ink`
- repo root: `/opt/poshard/gufo-gestiune-full`

### Staging

- app: `https://staging.gufo.ink`
- api: `https://api-staging.gufo.ink`
- repo root: `/opt/poshard/gufo-gestiune-staging`

## Env Templates

Use:

- [production.env.example](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/production.env.example)
- [staging.env.example](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/staging.env.example)

## Release Flow

1. deploy new commit to staging
2. run [smoke-test.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/smoke-test.sh) on staging
3. run health checks
4. if staging is good, create production backup
5. deploy production
6. run smoke test on production
7. if production fails, run [rollback-release.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/rollback-release.sh)

## Rollback Drill

Do a real rollback drill periodically:

1. pick a known good commit
2. run rollback script in staging first
3. run smoke test
4. redeploy latest good release
5. document the duration and result

This proves rollback is executable, not just documented.
