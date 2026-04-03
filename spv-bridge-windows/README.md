# Gufo SPV Agent Windows

Agent local pentru Windows care foloseste certificatul digital din `Cert:\CurrentUser\My` sau `Cert:\LocalMachine\My` fara `.pfx` exportat.

## Scop

- ruleaza local pe PC-ul clientului
- porneste automat la logon
- expune bridge-ul local pentru Gufo
- foloseste certificatul din Windows Store pentru SPV/e-Factura

## Instalare o singura data

1. Copiezi `.env.example` in `.env`
2. Completezi:
   - `BRIDGE_TOKEN`
   - `SPV_CERT_SERIAL`
3. Rulezi:

```powershell
cd spv-bridge-windows
powershell -ExecutionPolicy Bypass -File .\install-agent.ps1
```

Sau:

```powershell
npm run agent:install
```

Scriptul creeaza un Scheduled Task numit `Gufo SPV Agent` care porneste automat la logon pentru utilizatorul curent.

## Comenzi utile

Pornire manuala agent:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-agent.ps1
```

Dezinstalare:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-agent.ps1
```

## Health check

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:48521/health"
```

## Endpointuri

- `GET /health`
- `GET /api/v1/certificates/resolve?serial=...`
- `POST /api/v1/spvws2/list-messages-test`
- `POST /api/v1/efactura/list-messages`
- `POST /api/v1/efactura/download-message`
- `POST /api/v1/efactura/download-many`

Toate endpointurile API, in afara de `/health`, cer:

```http
Authorization: Bearer <BRIDGE_TOKEN>
```
