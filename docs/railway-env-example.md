# Railway Environment Variables

## PostgreSQL

Serviciu:
- `gufo-db`

Railway expune automat variabile precum:
- `DATABASE_URL`
- `PGHOST`
- `PGPORT`
- `PGUSER`
- `PGPASSWORD`
- `PGDATABASE`

Pentru aplicatia asta folosim in principal:
- `DATABASE_URL`

## API

Serviciu:
- `gufo-api`

Variabile necesare:

- `DATABASE_URL`
  - din serviciul `gufo-db`
- `JWT_SECRET`
  - string lung random
- `CORS_ORIGIN`
  - URL-ul public al frontendului
- `NODE_ENV=production`
- `PORT=3001`

Variabile utile mai tarziu:

- `ANAF_CLIENT_ID`
- `ANAF_CLIENT_SECRET`
- `ANAF_REDIRECT_URI`

## Worker

Serviciu:
- `gufo-worker`

Variabile necesare:

- `DATABASE_URL`
  - din `gufo-db`
- `JWT_SECRET`
  - aceeasi valoare ca la API
- `CORS_ORIGIN`
  - aceeasi valoare ca la API
- `NODE_ENV=production`
- `PORT=3002`
- `WORKER_INTERVAL_MS=60000`

## Frontend

Serviciu:
- `gufo-frontend`

Variabila necesara:

- `VITE_API_URL`
  - URL-ul public al `gufo-api`

## Exemplu staging

### API

- `DATABASE_URL=<referinta Railway Postgres>`
- `JWT_SECRET=<valoare random>`
- `CORS_ORIGIN=https://gufo-frontend.up.railway.app`
- `NODE_ENV=production`
- `PORT=3001`

### Worker

- `DATABASE_URL=<aceeasi referinta Railway Postgres>`
- `JWT_SECRET=<aceeasi valoare ca API>`
- `CORS_ORIGIN=https://gufo-frontend.up.railway.app`
- `NODE_ENV=production`
- `PORT=3002`
- `WORKER_INTERVAL_MS=60000`

### Frontend

- `VITE_API_URL=https://gufo-api.up.railway.app`
