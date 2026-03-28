# Railway Deployment

## Stack recomandat

Servicii separate in acelasi proiect Railway:

1. `gufo-db`
- PostgreSQL managed

2. `gufo-api`
- serviciu Node pentru backend ERP
- root directory: `backend`

3. `gufo-worker`
- serviciu Node separat pentru joburi async
- root directory: `backend`

4. `gufo-frontend`
- serviciu pentru UI ERP/control panel
- root directory: `frontend`

## Ordinea corecta

1. Creezi `gufo-db`
2. Creezi `gufo-api`
3. Legi variabilele de mediu la API
4. Configurezi `Pre-Deploy Command` pentru API:
   - `npm run db:deploy`
5. Configurezi healthcheck:
   - `/health`
6. Creezi `gufo-frontend`
7. Pui `VITE_API_URL`
8. Creezi `gufo-worker`

## Setari recomandate

### API

- Source Repo: repo-ul principal
- Root Directory: `backend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Pre-Deploy Command: `npm run db:deploy`
- Healthcheck Path: `/health`

### Worker

- Source Repo: repo-ul principal
- Root Directory: `backend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm run start:worker`

### Frontend

- Source Repo: repo-ul principal
- Root Directory: `frontend`
- Build Command: `npm ci && npm run build`
- Start Command: `npm run preview -- --host 0.0.0.0 --port $PORT`

## Dupa primul deploy

Testezi cap-coada:

- login
- dashboard
- produse
- stoc
- NIR
- facturi
- e-Factura
- SPV -> receptie

## Recomandari

- pastrezi `api` si `worker` separate
- nu rulezi sync-urile grele in request direct
- nu tii fisiere importante doar pe storage local
- activezi healthcheck pe API
