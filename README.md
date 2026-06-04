# Gufo ERP Multitenant Starter

ERP multi-tenant cu:
- frontend React/Vite
- backend Node/Express
- PostgreSQL prin Prisma
- worker separat pentru joburi async

## Rulare locala

### Backend API
```bash
cd backend
npm install
npm run dev
```

API:
- `http://localhost:3001`
- health: `http://localhost:3001/health`

### Backend Worker
```bash
cd backend
npm run dev:worker
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend:
- `http://localhost:5173`

## Build

### Backend
```bash
cd backend
npm run build
npm start
```

### Frontend
```bash
cd frontend
npm run build
npm run preview
```

## Deploy

Arhitectura recomandata:
- [docs/deployment-architecture.md](C:\Users\POSHARD\Desktop\poshard-saas-starter\poshard-saas-starter\docs\deployment-architecture.md)
- [docs/production-ops-runbook.md](C:\Users\POSHARD\Desktop\poshard-saas-starter\poshard-saas-starter\docs\production-ops-runbook.md)
- [docs/staging-production-cutover.md](C:\Users\POSHARD\Desktop\poshard-saas-starter\poshard-saas-starter\docs\staging-production-cutover.md)

## Note

- directia activa pentru deploy este self-hosted, cu frontend static, API separat si worker separat
- pachetul minim de operare pentru productie este in `ops/hetzner` si `ops/monitoring`
