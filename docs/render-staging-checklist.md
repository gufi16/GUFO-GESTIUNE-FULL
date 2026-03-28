# Render Staging Checklist

## Services

Create these first:

1. `poshard-db`
- Render PostgreSQL

2. `poshard-api`
- from `backend/render.yaml`

3. `poshard-frontend`
- from `frontend/render.yaml`

## Backend Environment Variables

Set on `poshard-api`:

- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGIN`
- `PORT=3001`
- `NODE_ENV=production`

Recommended:

- `PORT` stays internal to Render service config
- `CORS_ORIGIN` should be the frontend public URL

## Frontend Environment Variables

Set on `poshard-frontend`:

- `VITE_API_URL`

This should be the public HTTPS URL of `poshard-api`.

## First Deploy Order

1. Create database.
2. Deploy backend.
3. Set backend env vars.
4. Confirm `GET /health` works.
5. Deploy frontend.
6. Set `VITE_API_URL`.
7. Login and test:
   - auth
   - products
   - stock
   - invoices
   - NIR
   - e-Factura settings
   - incoming SPV invoices

## After First Successful Staging Deploy

Next service to add:

- `poshard-worker`

Use the same backend codebase with:

- `startCommand: npm run start:worker`
- `WORKER_INTERVAL_MS=60000`
