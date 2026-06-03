# Deployment Architecture

## Recommended Stack

This ERP should run as a multi-tenant SaaS with four clear layers:

1. `frontend`
- Static site
- Hosts ERP and Control Panel UI
- Talks only to the API

2. `api`
- Stateless Node/Express service
- Handles auth, ERP CRUD, POS licensing, document flows, reports, e-Factura endpoints

3. `worker`
- Separate background service
- Reserved for slow or retryable tasks:
  - SPV sync
  - incoming e-Factura sync
  - outgoing e-Factura status polling
  - email jobs
  - heavy exports / PDF batches
- prepared in code via `backend/src/worker.ts`

4. `database`
- Managed PostgreSQL
- Single source of truth for tenants, locations, stock, documents, licensing

## Why This Split

- The UI stays fast because it is static.
- The API stays responsive because long-running work moves out of request/response flow.
- The database is managed and backed up separately.
- The system can scale per service, not as one large box.

## Self-Hosted Layout

Recommended services:

- `gufo-frontend` -> frontend ERP/control panel
- `gufo-api` -> API service
- `gufo-worker` -> background jobs
- `gufo-db` -> managed PostgreSQL

## Production Rules

- Do not store important files only on local app disk.
- Do not run ANAF/SPV synchronization only inside HTTP requests.
- Do not deploy production without backups and health checks.
- Do not share one process for UI, API, sync jobs, and heavy PDF work.

## Environment Variables

### API

- `DATABASE_URL`
- `JWT_SECRET`
- `PORT`
- `CORS_ORIGIN`
- `NODE_ENV=production`
- `UPLOADS_DIR` -> absolute path mounted persistently for product/category images and certificates

Optional but recommended:

- `LOG_LEVEL=info`
- `ANAF_BASE_URL`
- `ANAF_CLIENT_ID`
- `ANAF_CLIENT_SECRET`
- `ANAF_REDIRECT_URI`
- `ALLOW_TEST_ORIGIN=false`
- `ALLOW_API_ORIGIN=false`

Production CORS rule:
- trust `app.gufo.ink`
- trust tenant subdomains only if they exist in the `Tenant.subdomain` table
- do not trust `test.gufo.ink` unless intentionally enabled
- do not trust `api.gufo.ink` as browser origin unless intentionally enabled

### Frontend

- `VITE_API_URL`

## Storage Strategy

Short term:
- keep uploads on persistent disk, never only inside a disposable container layer
- set `UPLOADS_DIR` to the mounted path used by the API container
- mount the same host folder back into the container on every deploy
- keep all ERP file artifacts there:
  - product images
  - category images
  - e-Factura agent installers
  - certificates
  - exported XML/PDF/document bundles

Safer target:
- object storage or CDN-backed storage for:
  - product images
  - category images
  - saved XML/PDF artifacts

### Docker Rule

If API runs in Docker, uploaded files must be on a persistent volume. Example:

```yaml
services:
  api:
    volumes:
      - /opt/poshard/gufo-gestiune-storage/uploads:/app/uploads
    environment:
      UPLOADS_DIR: /app/uploads
```

Without this, image files can disappear after rebuilds even if `imageUrl` remains saved in the database.

### Hetzner Practical Rule

For the current Hetzner layout, keep a dedicated host folder such as:

```bash
/opt/poshard/gufo-gestiune-storage/uploads
```

and always mount it into the API container as:

```bash
/app/uploads
```

This mount must survive every API rebuild/recreate. If the container starts without it, production startup should fail rather than accept ephemeral uploads.

## Database Stability

Before onboarding larger tenants:

- add indexes on heavy filters:
  - `tenantId`
  - `locationId`
  - `docDate`
  - `status`
  - `productId`
- keep pagination server-side for big tables
- move expensive reports and sync jobs to worker flows

## Rollout Sequence

1. Make backend production build pass.
2. Deploy a staging environment.
3. Validate:
   - login
   - stock pages
   - NIR / invoices / transfers
   - e-Factura outgoing
   - incoming SPV -> reception
4. Add worker service for async jobs.
5. Move files to external storage.
6. Go live.

## Recommendation

Best production shape:

- frontend static behind reverse proxy
- API in its own container or service
- PostgreSQL managed or self-hosted with backups
- worker added immediately after staging is stable
