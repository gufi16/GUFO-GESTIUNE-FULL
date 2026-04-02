# Gufo SPV Bridge Windows

Bridge local pentru Windows care foloseste certificatul digital din `Cert:\CurrentUser\My` sau `Cert:\LocalMachine\My` prin PowerShell, fara `.pfx` exportat.

## Ce face acum

- porneste un server local HTTP
- verifica daca exista certificatul dupa `serial`
- testeaza `SPVWS2/rest/listaMesaje`

## Configurare rapida

1. Copiezi `.env.example` in `.env`
2. Completezi:
   - `BRIDGE_TOKEN`
   - `SPV_CERT_SERIAL`
3. Pornesti:

```powershell
cd spv-bridge-windows
node bridge.js
```

## Endpointuri

- `GET /health`
- `GET /api/v1/certificates/resolve?serial=...`
- `POST /api/v1/spvws2/list-messages-test`

Toate endpointurile API, in afara de `/health`, cer:

```http
Authorization: Bearer <BRIDGE_TOKEN>
```

## Exemplu test

```powershell
$headers = @{ Authorization = "Bearer TOKENUL_TAU" }
Invoke-RestMethod -Method GET -Headers $headers -Uri "http://127.0.0.1:48521/api/v1/certificates/resolve?serial=201104209404011B9F6D1518659BE0CF"
```

```powershell
$headers = @{ Authorization = "Bearer TOKENUL_TAU"; "Content-Type" = "application/json" }
$body = @{ days = 30 } | ConvertTo-Json
Invoke-RestMethod -Method POST -Headers $headers -Body $body -Uri "http://127.0.0.1:48521/api/v1/spvws2/list-messages-test"
```
