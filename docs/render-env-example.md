# Render Environment Variables

## 1. Database

Create first:

- `poshard-db`

Render will generate the database connection string used by:
- `DATABASE_URL`

## 2. API Service

Service:
- `poshard-api`

Set these variables:

### Required

- `DATABASE_URL`
  - use the managed Render PostgreSQL connection string

- `JWT_SECRET`
  - long random string
  - example:
  - `7f3e2d9a2c4f4e7bb6d3c8e2a9b5f1c7d2e4a6b8c1d3e5f7`

- `CORS_ORIGIN`
  - the public frontend URL
  - example:
  - `https://poshard-frontend.onrender.com`

### Default runtime

- `NODE_ENV=production`
- `PORT=3001`

### Later, when ANAF is live

- `ANAF_CLIENT_ID`
- `ANAF_CLIENT_SECRET`
- `ANAF_REDIRECT_URI`

Recommended example:
- `ANAF_REDIRECT_URI=https://poshard-api.onrender.com/api/v1/company/efactura/oauth/callback`

## 3. Worker Service

Service:
- `poshard-worker`

Set these variables:

### Required

- `DATABASE_URL`
  - same DB as API

- `JWT_SECRET`
  - same value as API

- `CORS_ORIGIN`
  - same as API

### Default runtime

- `NODE_ENV=production`
- `PORT=3002`
- `WORKER_INTERVAL_MS=60000`

## 4. Frontend Service

Service:
- `poshard-frontend`

Set:

- `VITE_API_URL`
  - public API URL
  - example:
  - `https://poshard-api.onrender.com`

## 5. First Staging Example

### API

- `DATABASE_URL=<Render Postgres connection string>`
- `JWT_SECRET=<generate random>`
- `CORS_ORIGIN=https://poshard-frontend.onrender.com`
- `NODE_ENV=production`
- `PORT=3001`

### Worker

- `DATABASE_URL=<same Render Postgres connection string>`
- `JWT_SECRET=<same as API>`
- `CORS_ORIGIN=https://poshard-frontend.onrender.com`
- `NODE_ENV=production`
- `PORT=3002`
- `WORKER_INTERVAL_MS=60000`

### Frontend

- `VITE_API_URL=https://poshard-api.onrender.com`

## 6. Deploy Order

1. Create `poshard-db`
2. Deploy `poshard-api`
3. Set API env vars
4. Check `/health`
5. Deploy `poshard-frontend`
6. Set `VITE_API_URL`
7. Deploy `poshard-worker`
8. Set worker env vars

## 7. Important Notes

- `JWT_SECRET` must be identical on API and worker.
- `CORS_ORIGIN` must point to the frontend public URL.
- `VITE_API_URL` must point to the API public URL, not localhost.
- If you use ANAF live later, keep ANAF secrets only on backend services, never on frontend.
