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

## Railway Layout

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

Optional but recommended:

- `LOG_LEVEL=info`
- `ANAF_BASE_URL`
- `ANAF_CLIENT_ID`
- `ANAF_CLIENT_SECRET`
- `ANAF_REDIRECT_URI`

### Frontend

- `VITE_API_URL`

## Storage Strategy

Short term:
- keep uploads working as they do now
- but plan migration away from ephemeral local filesystem

Safer target:
- object storage or CDN-backed storage for:
  - product images
  - category images
  - saved XML/PDF artifacts

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

Railway is a good fit for the first serious SaaS rollout if this service split is respected.

Best first production shape:

- frontend on Railway
- API on Railway
- PostgreSQL on Railway
- worker added immediately after staging is stable
