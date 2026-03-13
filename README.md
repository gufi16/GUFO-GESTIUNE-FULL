# POSHARD SaaS Multitenant Starter (Admin Web + API)

Acest proiect este un **starter** pentru o aplicație tip Sepi:
- **Admin Web (React/Vite + Tailwind)** cu meniurile mari: Dashboard, Înregistrare document, Gestiune, Documente, Nomenclator, Setări
- **API Server (Node/Express)** cu endpoint-uri stub pentru licențiere/sync POS

## Cerințe
- Node.js 18+ (recomandat 20+)
- npm (sau pnpm/yarn)

## Rulare locală

### 1) API (backend)
```bash
cd backend
npm install
npm run dev
```
API pornește pe: http://localhost:3001  
Health: http://localhost:3001/health

### 2) Admin Web (frontend)
În alt terminal:
```bash
cd frontend
npm install
npm run dev
```
Frontend pornește pe: http://localhost:5173

## Build (pentru deploy)
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

## Unde continuăm de aici (pasul următor)
- Multi-tenant: adăugăm `tenant_id` în DB și JWT claims
- Auth real: login + refresh
- DB: PostgreSQL (Prisma) + migrări
- Sync POS: /catalog/changes, /inventory/changes, /pos/receipts cu idempotency

