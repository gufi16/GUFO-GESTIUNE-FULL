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

## Deploy pe Railway

Stack recomandat:
- `gufo-db` -> PostgreSQL
- `gufo-api` -> API ERP
- `gufo-worker` -> joburi async
- `gufo-frontend` -> ERP + Control Panel

Documentatie Railway:
- [docs/railway-deployment.md](C:\Users\POSHARD\Desktop\poshard-saas-starter\poshard-saas-starter\docs\railway-deployment.md)
- [docs/railway-env-example.md](C:\Users\POSHARD\Desktop\poshard-saas-starter\poshard-saas-starter\docs\railway-env-example.md)

Arhitectura recomandata:
- [docs/deployment-architecture.md](C:\Users\POSHARD\Desktop\poshard-saas-starter\poshard-saas-starter\docs\deployment-architecture.md)

## Note

- fisierele `render.yaml` si documentatia Render au ramas doar ca referinta veche
- directia activa pentru deploy este acum Railway
