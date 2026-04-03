# Gufo e-Factura

Agent local pentru Windows care foloseste certificatul digital din `Cert:\CurrentUser\My` sau `Cert:\LocalMachine\My` fara `.pfx` exportat.

## Scop

- ruleaza local pe PC-ul clientului
- porneste automat la logon
- expune bridge-ul local pentru Gufo
- foloseste certificatul din Windows Store pentru SPV/e-Factura
- ofera o pagina locala de configurare pentru:
  - `ERP URL`
  - `Serial certificat`
  - `Host local`
  - `Port local`

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

Scriptul creeaza un Scheduled Task numit `Gufo e-Factura` care porneste automat la logon pentru utilizatorul curent.

## Comenzi utile

Pornire manuala agent:

```powershell
powershell -ExecutionPolicy Bypass -File .\start-agent.ps1
```

Dezinstalare:

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall-agent.ps1
```

## Build installer `.exe`

1. Exporti logo-ul in:

```text
spv-bridge-windows\branding\gufo-efactura.ico
```

2. Instalezi `Inno Setup 6`

3. Rulezi:

```powershell
cd spv-bridge-windows
powershell -ExecutionPolicy Bypass -File .\build-installer.ps1
```

Sau:

```powershell
npm run build:installer
```

Daca `Inno Setup` este instalat, scriptul genereaza:

```text
spv-bridge-windows\release\installer\Gufo-eFactura-Setup-YYYYMMDD-HHMMSS.exe
```

Installerul actual:
- instaleaza agentul local
- creeaza shortcut `Gufo e-Factura`
- deschide aplicatia in fereastra dedicata tip app-window
- nu mai lasa utilizatorul in PowerShell sau browser clasic

## Build desktop dedicat

Pentru pasul urmator, exista si shell desktop dedicat:

```powershell
cd spv-bridge-windows
npm install
powershell -ExecutionPolicy Bypass -File .\build-desktop.ps1
```

Rezultatul merge in:

```text
spv-bridge-windows\release-desktop
```

Buildul desktop curent genereaza folderul aplicatiei Windows cu:
- `Gufo e-Factura.exe`
- tray
- fereastra proprie
- bridge local pornit din aplicatie

Acesta este fluxul stabil de test pentru aplicatia Windows reala `Gufo e-Factura`. Peste el putem pune apoi installerul final.

## Varianta portabila recomandata daca installerul `.exe` nu e stabil

Rulezi:

```powershell
cd spv-bridge-windows
powershell -ExecutionPolicy Bypass -File .\build-release.ps1
```

In folderul nou de release ai direct:

- `Instaleaza Gufo e-Factura.cmd`
- `Configureaza Gufo e-Factura.cmd`
- `Porneste Gufo e-Factura.cmd`

Pentru client:
1. copiezi folderul de release pe PC
2. rulezi `Instaleaza Gufo e-Factura.cmd`
3. se deschide `Gufo e-Factura` ca fereastra de aplicatie
4. configurezi local agentul si certificatul

## Health check

```powershell
Invoke-RestMethod -Method GET -Uri "http://127.0.0.1:48521/health"
```

## Configurare locala

Dupa pornirea agentului, deschizi:

```text
http://127.0.0.1:48521/
```

De acolo poti salva configuratia fara sa mai editezi manual `.env`.

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
