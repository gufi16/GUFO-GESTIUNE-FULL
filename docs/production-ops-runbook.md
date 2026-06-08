# Production Ops Runbook

## Mandatory Before Sale

The production stack is not considered sale-ready unless all of the following are real and active:

- separate `staging` environment
- separate `production` environment
- daily PostgreSQL backups
- weekly restore test
- API + frontend + worker health checks
- uptime monitoring
- centralized container logs
- documented rollback procedure

## Environment Split

### Staging

- domain example: `staging.gufo.ink`
- separate PostgreSQL database
- separate uploads path
- separate SMTP/API secrets
- safe place for release validation before production

### Production

- domain examples:
  - `app.gufo.ink`
  - `api.gufo.ink`
  - `tenant-name.gufo.ink`
- own PostgreSQL database
- persistent uploads mount
- only production secrets

Never point staging to the production database or production uploads path.

## Persistent Storage

Required:

```bash
UPLOADS_DIR=/app/uploads
```

Local development may use the fallback repo path automatically, but production must never rely on that fallback.

And Docker must mount a persistent host path:

```bash
/opt/poshard/gufo-gestiune-full/uploads:/app/uploads
```

Worker heartbeat file:

```bash
WORKER_HEARTBEAT_FILE=/app/uploads/ops/worker-heartbeat.json
```

If `WORKER_HEARTBEAT_FILE` is omitted, the worker falls back automatically to:

```bash
<UPLOADS_DIR>/ops/worker-heartbeat.json
```

## Database Backups

Use:

- [backup-db.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/backup-db.sh)
- [restore-db.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/restore-db.sh)
- [test-restore-db.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/test-restore-db.sh)

Recommended backup root:

```bash
/opt/poshard/backups/gufo/daily
```

Minimum rule:

- daily backup
- 14-day retention
- weekly restore test

## Health Checks

Use:

- [health-check.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/health-check.sh)
- [health-check-worker.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/health-check-worker.sh)

Checks:

- frontend URL responds
- API `/health` responds
- frontend container is running
- API container is running
- worker heartbeat is checked separately on the worker host

## Uptime Monitoring

Use the provided monitoring stack:

- [docker-compose.monitoring.yml](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/monitoring/docker-compose.monitoring.yml)

Required monitors in Uptime Kuma:

- `https://app.gufo.ink`
- `https://api.gufo.ink/health`
- `https://api.gufo.ink/api/v1/public/domain-allow?domain=app.gufo.ink`
- local worker heartbeat via cron + alert if stale

## Centralized Logs

Use:

- Loki
- Promtail
- Docker container log scraping

Files:

- [loki-config.yml](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/monitoring/loki-config.yml)
- [promtail-config.yml](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/monitoring/promtail-config.yml)
- [logs-tail.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/logs-tail.sh)

## Rollback Procedure

Use:

- [rollback-release.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/rollback-release.sh)
- [smoke-test.sh](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/smoke-test.sh)

Rollback sequence:

1. choose last known good commit
2. run rollback script
3. check API `/health`
4. check frontend root
5. run smoke test
6. validate login
7. validate one document save flow

## Cron Jobs

Use:

- [cron.backup.example](/C:/Users/POSHARD/Desktop/poshard-saas-starter/poshard-saas-starter/ops/hetzner/cron.backup.example)

## Release Gate

Before every production deploy:

1. deploy to staging
2. run smoke test on staging
3. create backup
4. deploy production
5. run health-check script
6. verify logs
7. verify restore test is still green
8. keep last known good commit ready for rollback
