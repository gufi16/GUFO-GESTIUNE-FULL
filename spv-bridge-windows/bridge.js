const http = require("http")
const { execFile } = require("child_process")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const AdmZip = require(path.join(__dirname, "vendor", "adm-zip"))

const DEFAULT_PORT = 48521
const DEFAULT_HOST = "127.0.0.1"
const SPV_LIST_MESSAGES_URL = "https://webserviced.anaf.ro/SPVWS2/rest/listaMesaje"
const SPV_DOWNLOAD_MESSAGE_URL = "https://webserviced.anaf.ro/SPVWS2/rest/descarcare"
const EFACTURA_LIST_MESSAGES_PROD_URL = "https://webserviceapl.anaf.ro/prod/FCTEL/rest/listaMesajeFactura"
const EFACTURA_LIST_MESSAGES_TEST_URL = "https://webserviceapl.anaf.ro/test/FCTEL/rest/listaMesajeFactura"
const EFACTURA_DOWNLOAD_PROD_URL = "https://webserviceapl.anaf.ro/prod/FCTEL/rest/descarcare"
const EFACTURA_DOWNLOAD_TEST_URL = "https://webserviceapl.anaf.ro/test/FCTEL/rest/descarcare"
const POWERSHELL_TIMEOUT_MS = 90000
const CONFIG_PATH = path.join(__dirname, "agent-config.json")

loadEnv(path.join(__dirname, ".env"))

const persistedConfig = loadAgentConfig(CONFIG_PATH)

let PORT = Number(persistedConfig.bridgePort || process.env.BRIDGE_PORT || DEFAULT_PORT)
let HOST = persistedConfig.bridgeHost || process.env.BRIDGE_HOST || DEFAULT_HOST
let BRIDGE_TOKEN = String(persistedConfig.bridgeToken || process.env.BRIDGE_TOKEN || "").trim()
let DEFAULT_CERT_SERIAL = normalizeSerial(persistedConfig.certSerial || process.env.SPV_CERT_SERIAL || "")
let SHOW_POWERSHELL_WINDOW =
  String(
    persistedConfig.showPowerShellWindow ?? process.env.BRIDGE_SHOW_POWERSHELL_WINDOW ?? "true"
  )
    .trim()
    .toLowerCase() !== "false"
let ERP_URL = String(persistedConfig.erpUrl || "").trim()
let LICENSE_KEY = String(persistedConfig.licenseKey || "").trim()
let GENERATED_TOKEN_ON_BOOT = false

if (!BRIDGE_TOKEN) {
  BRIDGE_TOKEN = crypto.randomBytes(24).toString("hex")
  GENERATED_TOKEN_ON_BOOT = true
}

async function extractAnafArtifacts(base64Content) {
  const base64 = String(base64Content || "").trim()
  if (!base64) {
    return {
      pdfBase64: null,
      pdfFileName: null,
      xmlBase64: null,
      xmlFileName: null,
    }
  }

  const bytes = Buffer.from(base64, "base64")
  const result = {
    pdfBase64: null,
    pdfFileName: null,
    xmlBase64: null,
    xmlFileName: null,
  }

  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    result.pdfBase64 = base64
    result.pdfFileName = "factura-spv.pdf"
    return result
  }

  const text = bytes.toString("utf8")
  if (text.trimStart().startsWith("<")) {
    result.xmlBase64 = base64
    result.xmlFileName = "factura-spv.xml"
    return result
  }

  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zip = new AdmZip(bytes)
    const entries = zip.getEntries().filter((entry) => !entry.isDirectory)
    const xmlCandidates = []

    for (const entry of entries) {
      const name = String(entry.entryName || "")
      const lowerName = name.toLowerCase()
      const entryBytes = entry.getData()

      if (!result.pdfBase64 && lowerName.endsWith(".pdf")) {
        result.pdfBase64 = entryBytes.toString("base64")
        result.pdfFileName = name
        continue
      }

      if (lowerName.endsWith(".xml")) {
        const entryText = entryBytes.toString("utf8")
        let score = 0
        if (entryText.includes("<Invoice") || entryText.includes(":Invoice")) score += 5
        if (entryText.includes("<CreditNote") || entryText.includes(":CreditNote")) score += 5
        if (entryText.includes("AccountingSupplierParty")) score += 3
        if (entryText.includes("InvoiceLine")) score += 3
        if (lowerName.includes("semn") || lowerName.includes("signature")) score -= 10
        xmlCandidates.push({
          name,
          score,
          length: entryBytes.length,
          base64: entryBytes.toString("base64"),
        })
      }
    }

    if (xmlCandidates.length) {
      xmlCandidates.sort((a, b) => b.score - a.score || b.length - a.length)
      result.xmlBase64 = xmlCandidates[0].base64
      result.xmlFileName = xmlCandidates[0].name
    }
  }

  return result
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return
  const raw = fs.readFileSync(filePath, "utf8")
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const idx = trimmed.indexOf("=")
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

function loadAgentConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return {}
  }
}

function saveAgentConfig() {
  const payload = {
    bridgePort: PORT,
    bridgeHost: HOST,
    bridgeToken: BRIDGE_TOKEN,
    certSerial: DEFAULT_CERT_SERIAL,
    showPowerShellWindow: SHOW_POWERSHELL_WINDOW,
    erpUrl: ERP_URL,
    licenseKey: LICENSE_KEY,
  }
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

if (GENERATED_TOKEN_ON_BOOT) {
  saveAgentConfig()
}

function getConfiguredErpOrigin() {
  if (!ERP_URL) return ""
  try {
    return new URL(ERP_URL).origin
  } catch {
    return ""
  }
}

function isLocalOrigin(origin) {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(String(origin || "").trim())
}

function isTrustedOrigin(origin) {
  const normalizedOrigin = String(origin || "").trim()
  if (!normalizedOrigin) return true
  if (isLocalOrigin(normalizedOrigin)) return true
  const configuredOrigin = getConfiguredErpOrigin()
  return Boolean(configuredOrigin && normalizedOrigin === configuredOrigin)
}

function getCorsOrigin(req) {
  const origin = String(req.headers.origin || "").trim()
  if (isTrustedOrigin(origin)) {
    return origin || "*"
  }
  return "null"
}

function renderSetupPage() {
  const escape = (value) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")

  return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gufo e-Factura</title>
  <style>
    body { font-family: Segoe UI, Arial, sans-serif; background:#f4f7fb; margin:0; color:#17324D; }
    .wrap { max-width: 820px; margin: 32px auto; padding: 0 20px; }
    .card { background:#fff; border:1px solid #d8e2ee; border-radius:20px; box-shadow:0 12px 32px rgba(23,50,77,.08); padding:24px; }
    h1 { margin:0 0 6px; font-size:28px; }
    p { margin:0 0 18px; color:#567; }
    .grid { display:grid; gap:14px; grid-template-columns: repeat(2, minmax(0,1fr)); }
    .full { grid-column: 1 / -1; }
    label { display:block; font-size:13px; font-weight:600; margin-bottom:6px; }
    input { width:100%; box-sizing:border-box; border:1px solid #c8d5e3; border-radius:12px; padding:12px 14px; font-size:14px; }
    .actions { margin-top:18px; display:flex; gap:12px; align-items:center; }
    button { background:#17324D; color:#fff; border:none; border-radius:12px; padding:12px 18px; font-weight:700; cursor:pointer; }
    .muted { font-size:12px; color:#66788a; }
    .pill { display:inline-block; border-radius:999px; padding:6px 10px; background:#eef6ee; color:#216e39; font-size:12px; font-weight:700; }
    .row { margin-top:16px; display:flex; flex-wrap:wrap; gap:12px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Gufo e-Factura</h1>
      <p>Configurezi agentul local o singura data, apoi ERP-ul foloseste certificatul local fara comenzi manuale.</p>
      <div class="row">
        <span class="pill">Health: http://${escape(HOST)}:${escape(PORT)}/health</span>
      </div>
      <form id="config-form" class="grid" style="margin-top:18px">
        <div class="full">
          <label for="erpUrl">ERP URL</label>
          <input id="erpUrl" name="erpUrl" value="${escape(ERP_URL)}" placeholder="https://app.gufo.ink" />
        </div>
        <div class="full">
          <label for="licenseKey">License key</label>
          <input id="licenseKey" name="licenseKey" value="${escape(LICENSE_KEY)}" placeholder="Licenta / cheia clientului" />
        </div>
        <div class="full">
          <label for="certSerial">Serial certificat</label>
          <input id="certSerial" name="certSerial" value="${escape(DEFAULT_CERT_SERIAL)}" placeholder="Serialul certificatului din Windows Store" />
        </div>
        <div>
          <label for="bridgeHost">Host local</label>
          <input id="bridgeHost" name="bridgeHost" value="${escape(HOST)}" />
        </div>
        <div>
          <label for="bridgePort">Port local</label>
          <input id="bridgePort" name="bridgePort" value="${escape(PORT)}" />
        </div>
        <div class="actions full">
          <button type="submit">Salveaza configuratia</button>
          <div id="result" class="muted">Config curent salvat in <code>agent-config.json</code>.</div>
        </div>
        <div class="full muted">Tokenul local este generat automat de agent si nu trebuie completat de client.</div>
      </form>
    </div>
  </div>
  <script>
    document.getElementById('config-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        erpUrl: form.erpUrl.value.trim(),
        licenseKey: form.licenseKey.value.trim(),
        certSerial: form.certSerial.value.trim(),
        bridgeHost: form.bridgeHost.value.trim(),
        bridgePort: form.bridgePort.value.trim(),
      };
      const result = document.getElementById('result');
      result.textContent = 'Se salveaza...';
      const response = await fetch('/agent/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      result.textContent = response.ok && data.ok
        ? 'Configuratia a fost salvata. Daca ai schimbat host sau port, reporneste agentul.'
        : (data.error || 'Nu am putut salva configuratia.');
    });
  </script>
</body>
</html>`
}

function normalizeSerial(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
}

function sendJson(res, status, payload) {
  const origin = getCorsOrigin(res.req || { headers: {} })
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  })
  res.end(body)
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on("end", () => {
      if (!chunks.length) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")))
      } catch (error) {
        reject(new Error("Body JSON invalid."))
      }
    })
    req.on("error", reject)
  })
}

function requireAuth(req, res) {
  if (!BRIDGE_TOKEN) {
    sendJson(res, 503, {
      ok: false,
      error: "BRIDGE_TOKEN nu este configurat in bridge-ul local.",
    })
    return false
  }

  const authHeader = String(req.headers.authorization || "")
  if (authHeader !== `Bearer ${BRIDGE_TOKEN}`) {
    sendJson(res, 401, {
      ok: false,
      error: "Token bridge invalid sau lipsa.",
    })
    return false
  }

  return true
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile(
      "C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        windowsHide: !SHOW_POWERSHELL_WINDOW,
        maxBuffer: 1024 * 1024 * 10,
        timeout: POWERSHELL_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          if (error.killed) {
            reject(
              new Error(
                `Comanda PowerShell a depasit timeout-ul de ${POWERSHELL_TIMEOUT_MS / 1000}s. Posibil sa asteptam tokenul/certificatul sau raspunsul SPV.`
              )
            )
            return
          }
          reject(new Error(stderr || stdout || error.message))
          return
        }
        resolve(String(stdout || "").trim())
      }
    )
  })
}

async function resolveCertificate(serial) {
  const normalized = normalizeSerial(serial)
  if (!normalized) {
    throw new Error("Serialul certificatului lipseste.")
  }

  console.log(`[gufo-spv-bridge] resolveCertificate start serial=${normalized}`)

  const script = `
$serial = '${normalized}'
$stores = @(
  @{ Name = 'CurrentUser'; Path = 'Cert:\\CurrentUser\\My' },
  @{ Name = 'LocalMachine'; Path = 'Cert:\\LocalMachine\\My' }
)
$found = $null
foreach ($store in $stores) {
  $candidate = Get-ChildItem -Path $store.Path -ErrorAction SilentlyContinue | Where-Object {
    ($_.SerialNumber -replace '[^A-Fa-f0-9]', '').ToUpper() -eq $serial
  } | Select-Object -First 1
  if ($candidate) {
    $found = [PSCustomObject]@{
      store = $store.Name
      path = $store.Path
      subject = $candidate.Subject
      issuer = $candidate.Issuer
      thumbprint = $candidate.Thumbprint
      serialNumber = $candidate.SerialNumber
      hasPrivateKey = $candidate.HasPrivateKey
      notBefore = $candidate.NotBefore
      notAfter = $candidate.NotAfter
    }
    break
  }
}
if (-not $found) {
  throw "Certificatul cu serialul $serial nu a fost gasit in Windows Certificate Store."
}
$found | ConvertTo-Json -Compress
`.trim()

  const raw = await runPowerShell(script)
  const parsed = JSON.parse(raw)
  console.log(
    `[gufo-spv-bridge] resolveCertificate ok serial=${normalized} store=${parsed.store} hasPrivateKey=${parsed.hasPrivateKey}`
  )
  return parsed
}

async function testListMessages(serial, days) {
  const normalizedSerial = normalizeSerial(serial)
  console.log(`[gufo-spv-bridge] testListMessages start serial=${normalizedSerial} days=${days}`)
  const cert = await resolveCertificate(serial)
  const safeDays = Math.max(1, Math.min(365, Number(days || 30)))

  const script = `
$serial = '${normalizedSerial}'
$days = ${safeDays}
$stores = @('Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My')
$cert = $null
foreach ($store in $stores) {
  $candidate = Get-ChildItem -Path $store -ErrorAction SilentlyContinue | Where-Object {
    ($_.SerialNumber -replace '[^A-Fa-f0-9]', '').ToUpper() -eq $serial
  } | Select-Object -First 1
  if ($candidate) {
    $cert = $candidate
    break
  }
}
if (-not $cert) {
  throw "Certificatul cu serialul $serial nu a fost gasit."
}
$url = "${SPV_LIST_MESSAGES_URL}?zile=$days"
$cookieContainer = New-Object System.Net.CookieContainer
$trace = New-Object System.Collections.ArrayList

function Add-TraceStep {
  param(
    [string]$RequestUrl,
    [int]$Status,
    [string]$Location,
    [string]$ContentType,
    [string]$Preview,
    [int]$CookieCount
  )
  [void]$trace.Add([PSCustomObject]@{
    url = $RequestUrl
    status = $Status
    location = $Location
    contentType = $ContentType
    preview = $Preview
    cookieCount = $CookieCount
  })
}

function Get-CookieCount {
  param([System.Net.CookieContainer]$Container, [string]$Uri)
  try {
    $cookieCollection = $Container.GetCookies([System.Uri]$Uri)
    if ($cookieCollection) { return $cookieCollection.Count }
  } catch {}
  return 0
}

function Invoke-SpvRequest {
  param(
    [string]$StartUrl,
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$ClientCertificate,
    [System.Net.CookieContainer]$Cookies
  )

  $currentUrl = $StartUrl
  for ($i = 0; $i -lt 10; $i++) {
    $request = [System.Net.HttpWebRequest]::Create($currentUrl)
    $request.Method = 'GET'
    $request.Timeout = 45000
    $request.ReadWriteTimeout = 45000
    $request.AllowAutoRedirect = $false
    $request.CookieContainer = $Cookies
    $request.KeepAlive = $true
    $request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GufoSPVBridge/1.0'
    [void]$request.ClientCertificates.Add($ClientCertificate)

    try {
      $response = [System.Net.HttpWebResponse]$request.GetResponse()
      $statusCode = [int]$response.StatusCode
      $location = $response.Headers['Location']
      $contentType = $response.ContentType
      $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
      $content = $reader.ReadToEnd()
      $reader.Close()
      $preview = if ($content.Length -gt 240) { $content.Substring(0, 240) } else { $content }
      $cookieCount = Get-CookieCount -Container $Cookies -Uri $currentUrl
      Add-TraceStep -RequestUrl $currentUrl -Status $statusCode -Location $location -ContentType $contentType -Preview $preview -CookieCount $cookieCount
      $response.Close()

      if ($statusCode -in 301,302,303,307,308 -and $location) {
        $nextUri = New-Object System.Uri([System.Uri]$currentUrl, $location)
        $currentUrl = $nextUri.AbsoluteUri
        continue
      }

      return [PSCustomObject]@{
        ok = ($statusCode -ge 200 -and $statusCode -lt 300)
        status = $statusCode
        content = [string]$content
        url = $currentUrl
        trace = $trace
      }
    }
    catch [System.Net.WebException] {
      $statusCode = $null
      $responseText = $null
      $location = $null
      $contentType = $null
      if ($_.Exception.Response) {
        try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
        try { $location = $_.Exception.Response.Headers['Location'] } catch {}
        try { $contentType = $_.Exception.Response.ContentType } catch {}
        try {
          $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
          $responseText = $reader.ReadToEnd()
          $reader.Close()
        } catch {}
      }
      $preview = if ($responseText) {
        if ($responseText.Length -gt 240) { $responseText.Substring(0, 240) } else { $responseText }
      } else {
        $_.Exception.Message
      }
      $cookieCount = Get-CookieCount -Container $Cookies -Uri $currentUrl
      $traceStatus = 0
      if ($null -ne $statusCode) { $traceStatus = [int]$statusCode }
      Add-TraceStep -RequestUrl $currentUrl -Status $traceStatus -Location $location -ContentType $contentType -Preview $preview -CookieCount $cookieCount

      if ($statusCode -in 301,302,303,307,308 -and $location) {
        $nextUri = New-Object System.Uri([System.Uri]$currentUrl, $location)
        $currentUrl = $nextUri.AbsoluteUri
        continue
      }

      return [PSCustomObject]@{
        ok = $false
        status = $statusCode
        error = $_.Exception.Message
        content = $responseText
        url = $currentUrl
        trace = $trace
      }
    }
  }

  return [PSCustomObject]@{
    ok = $false
    status = $null
    error = 'Prea multe redirect-uri in fluxul SPVWS2.'
    content = $null
    url = $currentUrl
    trace = $trace
  }
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-SpvRequest -StartUrl $url -ClientCertificate $cert -Cookies $cookieContainer | ConvertTo-Json -Compress -Depth 8
}
catch {
  $statusCode = $null
  $responseText = $null
  if ($_.Exception.Response) {
    try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $responseText = $reader.ReadToEnd()
      $reader.Close()
    } catch {}
  }
  if (-not $responseText -and $_.Exception.InnerException) {
    try { $responseText = $_.Exception.InnerException.Message } catch {}
  }
  [PSCustomObject]@{
    ok = $false
    status = $statusCode
    error = $_.Exception.Message
    content = $responseText
    url = $url
    trace = $trace
  } | ConvertTo-Json -Compress -Depth 5
}
`.trim()

  const raw = await runPowerShell(script)
  const result = JSON.parse(raw)
  console.log(
    `[gufo-spv-bridge] testListMessages finish ok=${Boolean(result.ok)} status=${result.status ?? "null"}`
  )
  return {
    certificate: cert,
    result,
  }
}

async function downloadMessage(serial, messageId) {
  const normalizedSerial = normalizeSerial(serial)
  const normalizedId = String(messageId || "").trim()
  if (!normalizedId) {
    throw new Error("Lipseste ID-ul mesajului SPV.")
  }

  console.log(
    `[gufo-spv-bridge] downloadMessage start serial=${normalizedSerial} id=${normalizedId}`
  )
  const cert = await resolveCertificate(serial)

  const script = `
$serial = '${normalizedSerial}'
$messageId = '${normalizedId}'
$stores = @('Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My')
$cert = $null
foreach ($store in $stores) {
  $candidate = Get-ChildItem -Path $store -ErrorAction SilentlyContinue | Where-Object {
    ($_.SerialNumber -replace '[^A-Fa-f0-9]', '').ToUpper() -eq $serial
  } | Select-Object -First 1
  if ($candidate) {
    $cert = $candidate
    break
  }
}
if (-not $cert) {
  throw "Certificatul cu serialul $serial nu a fost gasit."
}
$url = "${SPV_DOWNLOAD_MESSAGE_URL}?id=$messageId"
$cookieContainer = New-Object System.Net.CookieContainer
$trace = New-Object System.Collections.ArrayList

function Add-TraceStep {
  param(
    [string]$RequestUrl,
    [int]$Status,
    [string]$Location,
    [string]$ContentType,
    [string]$Preview,
    [int]$CookieCount
  )
  [void]$trace.Add([PSCustomObject]@{
    url = $RequestUrl
    status = $Status
    location = $Location
    contentType = $ContentType
    preview = $Preview
    cookieCount = $CookieCount
  })
}

function Get-CookieCount {
  param([System.Net.CookieContainer]$Container, [string]$Uri)
  try {
    $cookieCollection = $Container.GetCookies([System.Uri]$Uri)
    if ($cookieCollection) { return $cookieCollection.Count }
  } catch {}
  return 0
}

function Read-ResponseBytes {
  param([System.Net.WebResponse]$Response)
  $stream = $Response.GetResponseStream()
  $memory = New-Object System.IO.MemoryStream
  $stream.CopyTo($memory)
  $bytes = $memory.ToArray()
  $memory.Dispose()
  $stream.Dispose()
  return ,$bytes
}

function Get-PreviewFromBytes {
  param([byte[]]$Bytes)
  if (-not $Bytes -or $Bytes.Length -eq 0) { return '' }
  try {
    $text = [System.Text.Encoding]::UTF8.GetString($Bytes)
    if ($text.Length -gt 240) { return $text.Substring(0, 240) }
    return $text
  } catch {
    return ''
  }
}

function Invoke-SpvDownloadRequest {
  param(
    [string]$StartUrl,
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$ClientCertificate,
    [System.Net.CookieContainer]$Cookies
  )

  $currentUrl = $StartUrl
  for ($i = 0; $i -lt 10; $i++) {
    $request = [System.Net.HttpWebRequest]::Create($currentUrl)
    $request.Method = 'GET'
    $request.Timeout = 45000
    $request.ReadWriteTimeout = 45000
    $request.AllowAutoRedirect = $false
    $request.CookieContainer = $Cookies
    $request.KeepAlive = $true
    $request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GufoSPVBridge/1.0'
    [void]$request.ClientCertificates.Add($ClientCertificate)

    try {
      $response = [System.Net.HttpWebResponse]$request.GetResponse()
      $statusCode = [int]$response.StatusCode
      $location = $response.Headers['Location']
      $contentType = $response.ContentType
      $bytes = Read-ResponseBytes -Response $response
      $preview = Get-PreviewFromBytes -Bytes $bytes
      $cookieCount = Get-CookieCount -Container $Cookies -Uri $currentUrl
      Add-TraceStep -RequestUrl $currentUrl -Status $statusCode -Location $location -ContentType $contentType -Preview $preview -CookieCount $cookieCount
      $response.Close()

      if ($statusCode -in 301,302,303,307,308 -and $location) {
        $nextUri = New-Object System.Uri([System.Uri]$currentUrl, $location)
        $currentUrl = $nextUri.AbsoluteUri
        continue
      }

      return [PSCustomObject]@{
        ok = ($statusCode -ge 200 -and $statusCode -lt 300)
        status = $statusCode
        contentType = $contentType
        base64Content = [Convert]::ToBase64String($bytes)
        preview = $preview
        url = $currentUrl
        trace = $trace
      }
    }
    catch [System.Net.WebException] {
      $statusCode = $null
      $responseBytes = $null
      $responseText = $null
      $location = $null
      $contentType = $null
      if ($_.Exception.Response) {
        try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
        try { $location = $_.Exception.Response.Headers['Location'] } catch {}
        try { $contentType = $_.Exception.Response.ContentType } catch {}
        try {
          $responseBytes = Read-ResponseBytes -Response $_.Exception.Response
          $responseText = Get-PreviewFromBytes -Bytes $responseBytes
        } catch {}
      }
      $preview = if ($responseText) { $responseText } else { $_.Exception.Message }
      $cookieCount = Get-CookieCount -Container $Cookies -Uri $currentUrl
      $traceStatus = 0
      if ($null -ne $statusCode) { $traceStatus = [int]$statusCode }
      Add-TraceStep -RequestUrl $currentUrl -Status $traceStatus -Location $location -ContentType $contentType -Preview $preview -CookieCount $cookieCount

      if ($statusCode -in 301,302,303,307,308 -and $location) {
        $nextUri = New-Object System.Uri([System.Uri]$currentUrl, $location)
        $currentUrl = $nextUri.AbsoluteUri
        continue
      }

      return [PSCustomObject]@{
        ok = $false
        status = $statusCode
        error = $_.Exception.Message
        contentType = $contentType
        base64Content = if ($responseBytes) { [Convert]::ToBase64String($responseBytes) } else { $null }
        preview = $preview
        url = $currentUrl
        trace = $trace
      }
    }
  }

  return [PSCustomObject]@{
    ok = $false
    status = $null
    error = 'Prea multe redirect-uri in fluxul SPVWS2 pentru descarcare.'
    contentType = $null
    base64Content = $null
    preview = $null
    url = $currentUrl
    trace = $trace
  }
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-SpvDownloadRequest -StartUrl $url -ClientCertificate $cert -Cookies $cookieContainer | ConvertTo-Json -Compress -Depth 8
}
catch {
  $statusCode = $null
  $responseText = $null
  if ($_.Exception.Response) {
    try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $responseText = $reader.ReadToEnd()
      $reader.Close()
    } catch {}
  }
  if (-not $responseText -and $_.Exception.InnerException) {
    try { $responseText = $_.Exception.InnerException.Message } catch {}
  }
  [PSCustomObject]@{
    ok = $false
    status = $statusCode
    error = $_.Exception.Message
    preview = $responseText
    base64Content = $null
    url = $url
    trace = $trace
  } | ConvertTo-Json -Compress -Depth 5
}
`.trim()

  const raw = await runPowerShell(script)
  const result = JSON.parse(raw)
  console.log(
    `[gufo-spv-bridge] downloadMessage finish ok=${Boolean(result.ok)} status=${result.status ?? "null"}`
  )
  return {
    certificate: cert,
    result,
  }
}

function parseResponseContent(content) {
  const text = String(content || "").trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function resolveRedirectUrl(baseUrl, location) {
  try {
    if (!location) return null
    return new URL(location, baseUrl).toString()
  } catch {
    return location || null
  }
}

function getEfacturaListMessagesUrl(environment, days, cui) {
  const normalizedEnvironment = String(environment || "prod").trim().toLowerCase() === "test" ? "test" : "prod"
  const baseUrl = normalizedEnvironment === "test" ? EFACTURA_LIST_MESSAGES_TEST_URL : EFACTURA_LIST_MESSAGES_PROD_URL
  return `${baseUrl}?zile=${Math.max(1, Math.min(365, Number(days || 30)))}&cif=${encodeURIComponent(String(cui || "").trim())}`
}

function getEfacturaDownloadUrl(environment, id) {
  const normalizedEnvironment = String(environment || "prod").trim().toLowerCase() === "test" ? "test" : "prod"
  const baseUrl = normalizedEnvironment === "test" ? EFACTURA_DOWNLOAD_TEST_URL : EFACTURA_DOWNLOAD_PROD_URL
  return `${baseUrl}?id=${encodeURIComponent(String(id || "").trim())}`
}

async function invokeAuthenticatedEfacturaRequest({ serial, url, accessToken }) {
  const normalizedSerial = normalizeSerial(serial)
  const bearerToken = String(accessToken || "").trim()
  if (!bearerToken) {
    throw new Error("Lipseste tokenul ANAF pentru apelul e-Factura.")
  }

  const cert = await resolveCertificate(normalizedSerial)
  const escapedUrl = url.replace(/'/g, "''")
  const escapedToken = bearerToken.replace(/'/g, "''")

  const script = `
$serial = '${normalizedSerial}'
$url = '${escapedUrl}'
$accessToken = '${escapedToken}'
$stores = @('Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My')
$cert = $null
foreach ($store in $stores) {
  $candidate = Get-ChildItem -Path $store -ErrorAction SilentlyContinue | Where-Object {
    ($_.SerialNumber -replace '[^A-Fa-f0-9]', '').ToUpper() -eq $serial
  } | Select-Object -First 1
  if ($candidate) {
    $cert = $candidate
    break
  }
}
if (-not $cert) {
  throw "Certificatul cu serialul $serial nu a fost gasit."
}

$request = [System.Net.HttpWebRequest]::Create($url)
$request.Method = 'GET'
$request.Timeout = 45000
$request.ReadWriteTimeout = 45000
$request.AllowAutoRedirect = $false
$request.KeepAlive = $true
$request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GufoSPVBridge/1.0'
$request.Headers['Authorization'] = 'Bearer ' + $accessToken
[void]$request.ClientCertificates.Add($cert)

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $response = [System.Net.HttpWebResponse]$request.GetResponse()
  $statusCode = [int]$response.StatusCode
  $contentType = $response.ContentType
  $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
  $content = $reader.ReadToEnd()
  $reader.Close()
  $response.Close()
  [PSCustomObject]@{
    ok = ($statusCode -ge 200 -and $statusCode -lt 300)
    status = $statusCode
    contentType = $contentType
    content = $content
    url = $url
  } | ConvertTo-Json -Compress -Depth 6
}
catch [System.Net.WebException] {
  $statusCode = $null
  $contentType = $null
  $content = $null
  if ($_.Exception.Response) {
    try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    try { $contentType = $_.Exception.Response.ContentType } catch {}
    try {
      $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $content = $reader.ReadToEnd()
      $reader.Close()
    } catch {}
  }
  [PSCustomObject]@{
    ok = $false
    status = $statusCode
    contentType = $contentType
    error = $_.Exception.Message
    content = $content
    url = $url
  } | ConvertTo-Json -Compress -Depth 6
}
`.trim()

  const raw = await runPowerShell(script)
  return {
    certificate: cert,
    result: JSON.parse(raw),
  }
}

async function listIncomingEfacturaMessages(serial, accessToken, environment, cif, days) {
  const safeDays = Math.max(1, Math.min(365, Number(days || 30)))
  const url = getEfacturaListMessagesUrl(environment, safeDays, cif)
  console.log(`[gufo-spv-bridge] listIncomingEfacturaMessages serial=${normalizeSerial(serial)} env=${environment} cif=${cif} days=${safeDays}`)
  const response = await invokeAuthenticatedEfacturaRequest({
    serial,
    accessToken,
    url,
  })
  const parsed = parseResponseContent(response?.result?.content)
  const messages = Array.isArray(parsed?.mesaje)
    ? parsed.mesaje
    : Array.isArray(parsed?.facturi)
      ? parsed.facturi
      : Array.isArray(parsed)
        ? parsed
        : []
  console.log(
    `[gufo-spv-bridge] listIncomingEfacturaMessages finish ok=${Boolean(response?.result?.ok)} status=${response?.result?.status ?? "null"}`
  )
  console.log(
    `[gufo-spv-bridge] listIncomingEfacturaMessages payload messages=${messages.length} preview=${String(response?.result?.content || "").slice(0, 220)}`
  )
  return response
}

async function downloadIncomingEfacturaMessage(serial, accessToken, environment, id) {
  const normalizedId = String(id || "").trim()
  if (!normalizedId) {
    throw new Error("Lipseste ID-ul de descarcare ANAF.")
  }
  const cert = await resolveCertificate(serial)
  const url = getEfacturaDownloadUrl(environment, normalizedId)
  const escapedUrl = url.replace(/'/g, "''")
  const escapedToken = String(accessToken || "").trim().replace(/'/g, "''")
  const normalizedSerial = normalizeSerial(serial)
  const script = `
$serial = '${normalizedSerial}'
$url = '${escapedUrl}'
$accessToken = '${escapedToken}'
$stores = @('Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My')
$cert = $null
foreach ($store in $stores) {
  $candidate = Get-ChildItem -Path $store -ErrorAction SilentlyContinue | Where-Object {
    ($_.SerialNumber -replace '[^A-Fa-f0-9]', '').ToUpper() -eq $serial
  } | Select-Object -First 1
  if ($candidate) {
    $cert = $candidate
    break
  }
}
if (-not $cert) {
  throw "Certificatul cu serialul $serial nu a fost gasit."
}

$request = [System.Net.HttpWebRequest]::Create($url)
$request.Method = 'GET'
$request.Timeout = 45000
$request.ReadWriteTimeout = 45000
$request.AllowAutoRedirect = $false
$request.KeepAlive = $true
$request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GufoSPVBridge/1.0'
$request.Headers['Authorization'] = 'Bearer ' + $accessToken
[void]$request.ClientCertificates.Add($cert)

function Read-ResponseBytes {
  param([System.Net.WebResponse]$Response)
  $stream = $Response.GetResponseStream()
  $memory = New-Object System.IO.MemoryStream
  $stream.CopyTo($memory)
  $bytes = $memory.ToArray()
  $memory.Dispose()
  $stream.Dispose()
  return ,$bytes
}

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $response = [System.Net.HttpWebResponse]$request.GetResponse()
  $statusCode = [int]$response.StatusCode
  $contentType = $response.ContentType
  $bytes = Read-ResponseBytes -Response $response
  $response.Close()
  [PSCustomObject]@{
    ok = ($statusCode -ge 200 -and $statusCode -lt 300)
    status = $statusCode
    contentType = $contentType
    base64Content = [Convert]::ToBase64String($bytes)
    url = $url
  } | ConvertTo-Json -Compress -Depth 6
}
catch [System.Net.WebException] {
  $statusCode = $null
  $contentType = $null
  $responseBytes = $null
  $content = $null
  if ($_.Exception.Response) {
    try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
    try { $contentType = $_.Exception.Response.ContentType } catch {}
    try {
      $responseBytes = Read-ResponseBytes -Response $_.Exception.Response
      $content = [System.Text.Encoding]::UTF8.GetString($responseBytes)
    } catch {}
  }
  [PSCustomObject]@{
    ok = $false
    status = $statusCode
    contentType = $contentType
    error = $_.Exception.Message
    base64Content = if ($responseBytes) { [Convert]::ToBase64String($responseBytes) } else { $null }
    content = $content
    url = $url
  } | ConvertTo-Json -Compress -Depth 6
}
`.trim()
  const raw = await runPowerShell(script)
  const response = {
    certificate: cert,
    result: JSON.parse(raw),
  }
  console.log(
    `[gufo-spv-bridge] downloadIncomingEfacturaMessage finish ok=${Boolean(response?.result?.ok)} status=${response?.result?.status ?? "null"} id=${normalizedId}`
  )
  return response
}

async function downloadManyIncomingEfacturaMessages(serial, accessToken, environment, ids) {
  const normalizedSerial = normalizeSerial(serial)
  const bearerToken = String(accessToken || "").trim()
  const cleanIds = Array.isArray(ids)
    ? ids.map((entry) => String(entry || "").trim()).filter(Boolean)
    : []
  if (!cleanIds.length) {
    throw new Error("Nu exista ID-uri de descarcare pentru lotul e-Factura.")
  }

  console.log(
    `[gufo-spv-bridge] downloadManyIncomingEfacturaMessages start serial=${normalizedSerial} env=${environment} count=${cleanIds.length}`
  )

  const cert = await resolveCertificate(serial)
  const escapedToken = bearerToken.replace(/'/g, "''")
  const normalizedEnvironment = String(environment || "prod").trim().toLowerCase() === "test" ? "test" : "prod"
  const baseUrl = normalizedEnvironment === "test" ? EFACTURA_DOWNLOAD_TEST_URL : EFACTURA_DOWNLOAD_PROD_URL
  const idsJson = JSON.stringify(cleanIds).replace(/'/g, "''")

  const script = `
$serial = '${normalizedSerial}'
$accessToken = '${escapedToken}'
$baseUrl = '${baseUrl}'
$ids = ConvertFrom-Json @'
${idsJson}
'@
$stores = @('Cert:\\CurrentUser\\My', 'Cert:\\LocalMachine\\My')
$cert = $null
foreach ($store in $stores) {
  $candidate = Get-ChildItem -Path $store -ErrorAction SilentlyContinue | Where-Object {
    ($_.SerialNumber -replace '[^A-Fa-f0-9]', '').ToUpper() -eq $serial
  } | Select-Object -First 1
  if ($candidate) {
    $cert = $candidate
    break
  }
}
if (-not $cert) {
  throw "Certificatul cu serialul $serial nu a fost gasit."
}

function Read-ResponseBytes {
  param([System.Net.WebResponse]$Response)
  $stream = $Response.GetResponseStream()
  $memory = New-Object System.IO.MemoryStream
  $stream.CopyTo($memory)
  $bytes = $memory.ToArray()
  $memory.Dispose()
  $stream.Dispose()
  return ,$bytes
}

$results = New-Object System.Collections.ArrayList
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

foreach ($messageId in $ids) {
  $url = $baseUrl + '?id=' + [System.Uri]::EscapeDataString([string]$messageId)
  $request = [System.Net.HttpWebRequest]::Create($url)
  $request.Method = 'GET'
  $request.Timeout = 45000
  $request.ReadWriteTimeout = 45000
  $request.AllowAutoRedirect = $false
  $request.KeepAlive = $true
  $request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GufoSPVBridge/1.0'
  $request.Headers['Authorization'] = 'Bearer ' + $accessToken
  [void]$request.ClientCertificates.Add($cert)

  try {
    $response = [System.Net.HttpWebResponse]$request.GetResponse()
    $statusCode = [int]$response.StatusCode
    $contentType = $response.ContentType
    $bytes = Read-ResponseBytes -Response $response
    $response.Close()
    [void]$results.Add([PSCustomObject]@{
      id = [string]$messageId
      ok = ($statusCode -ge 200 -and $statusCode -lt 300)
      status = $statusCode
      contentType = $contentType
      base64Content = [Convert]::ToBase64String($bytes)
      error = $null
    })
  }
  catch [System.Net.WebException] {
    $statusCode = $null
    $contentType = $null
    $responseBytes = $null
    $content = $null
    if ($_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode.value__ } catch {}
      try { $contentType = $_.Exception.Response.ContentType } catch {}
      try {
        $responseBytes = Read-ResponseBytes -Response $_.Exception.Response
        $content = [System.Text.Encoding]::UTF8.GetString($responseBytes)
      } catch {}
    }
    [void]$results.Add([PSCustomObject]@{
      id = [string]$messageId
      ok = $false
      status = $statusCode
      contentType = $contentType
      base64Content = if ($responseBytes) { [Convert]::ToBase64String($responseBytes) } else { $null }
      error = if ($content) { $content } else { $_.Exception.Message }
    })
  }
}

[PSCustomObject]@{
  ok = $true
  items = $results
} | ConvertTo-Json -Compress -Depth 6
`.trim()

  const raw = await runPowerShell(script)
  const response = {
    certificate: cert,
    result: JSON.parse(raw),
  }
  console.log(
    `[gufo-spv-bridge] downloadManyIncomingEfacturaMessages finish ok=${Boolean(response?.result?.ok)} count=${Array.isArray(response?.result?.items) ? response.result.items.length : 0}`
  )
  return response
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`)

  if (req.method === "OPTIONS") {
    const corsOrigin = getCorsOrigin(req)
    res.writeHead(204, {
      "Access-Control-Allow-Origin": corsOrigin,
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    })
    res.end()
    return
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/setup")) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    })
    res.end(renderSetupPage())
    return
  }

  if (req.method === "GET" && url.pathname === "/agent/config") {
    sendJson(res, 200, {
      ok: true,
        config: {
          erpUrl: ERP_URL || "",
          licenseKey: LICENSE_KEY || "",
          certSerial: DEFAULT_CERT_SERIAL || "",
          bridgeHost: HOST,
          bridgePort: PORT,
        showPowerShellWindow: SHOW_POWERSHELL_WINDOW,
      },
    })
    return
  }

  if (req.method === "POST" && url.pathname === "/agent/config") {
    try {
      const body = await readJsonBody(req)
      ERP_URL = String(body.erpUrl || "").trim()
      LICENSE_KEY = String(body.licenseKey || "").trim()
      DEFAULT_CERT_SERIAL = normalizeSerial(body.certSerial || "")
      HOST = String(body.bridgeHost || DEFAULT_HOST).trim() || DEFAULT_HOST
      PORT = Math.max(1, Math.min(65535, Number(body.bridgePort || DEFAULT_PORT) || DEFAULT_PORT))
      saveAgentConfig()
      sendJson(res, 200, {
        ok: true,
        message: "Configuratia agentului a fost salvata.",
      })
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  if (req.method === "GET" && url.pathname === "/agent/pairing") {
    if (!isTrustedOrigin(req.headers.origin)) {
      sendJson(res, 403, {
        ok: false,
        error: "Originea ERP-ului nu este autorizata pentru pairing.",
      })
      return
    }
    sendJson(res, 200, {
      ok: true,
      agent: {
        service: "gufo-efactura",
        erpUrl: ERP_URL || null,
        erpOrigin: getConfiguredErpOrigin() || null,
        bridgeUrl: `http://${HOST}:${PORT}`,
        bridgeToken: BRIDGE_TOKEN,
        certSerial: DEFAULT_CERT_SERIAL || null,
        hasLicenseKey: Boolean(LICENSE_KEY),
      },
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "gufo-efactura",
      host: HOST,
      port: PORT,
      hasBridgeToken: Boolean(BRIDGE_TOKEN),
      defaultCertSerial: DEFAULT_CERT_SERIAL || null,
      erpUrl: ERP_URL || null,
      hasLicenseKey: Boolean(LICENSE_KEY),
      time: new Date().toISOString(),
    })
    return
  }

  if (!requireAuth(req, res)) return

  if (req.method === "GET" && url.pathname === "/api/v1/certificates/resolve") {
    try {
      const serial = normalizeSerial(url.searchParams.get("serial") || DEFAULT_CERT_SERIAL)
      console.log(`[gufo-spv-bridge] HTTP resolve route serial=${serial}`)
      const certificate = await resolveCertificate(serial)
      sendJson(res, 200, {
        ok: true,
        certificate,
      })
    } catch (error) {
      console.error(`[gufo-spv-bridge] HTTP resolve error`, error)
      sendJson(res, 400, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  if (req.method === "POST" && url.pathname === "/api/v1/spvws2/list-messages-test") {
    try {
      const body = await readJsonBody(req)
      const serial = normalizeSerial(body.serial || DEFAULT_CERT_SERIAL)
      const days = Number(body.days || 30)
      console.log(`[gufo-spv-bridge] HTTP list-messages-test serial=${serial} days=${days}`)
      const data = await testListMessages(serial, days)
      const parsedContent = parseResponseContent(data.result.content)
      sendJson(res, 200, {
        ok: Boolean(data.result.ok),
        request: {
          days,
          url: data.result.url,
        },
        certificate: data.certificate,
        response: {
          ok: Boolean(data.result.ok),
          status: data.result.status ?? null,
          error: data.result.error || null,
          finalUrl: data.result.url || null,
          trace: Array.isArray(data.result.trace)
            ? data.result.trace.map((step) => ({
                ...step,
                resolvedLocation: resolveRedirectUrl(step.url, step.location),
              }))
            : [],
          parsedContent,
          rawContent: typeof parsedContent === "string" ? parsedContent : null,
        },
      })
    } catch (error) {
      console.error(`[gufo-spv-bridge] HTTP list-messages-test error`, error)
      sendJson(res, 400, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  if (req.method === "POST" && url.pathname === "/api/v1/spvws2/download-message") {
    try {
      const body = await readJsonBody(req)
      const serial = normalizeSerial(body.serial || DEFAULT_CERT_SERIAL)
      const id = String(body.id || "").trim()
      console.log(`[gufo-spv-bridge] HTTP download-message serial=${serial} id=${id}`)
      const data = await downloadMessage(serial, id)
      sendJson(res, 200, {
        ok: Boolean(data.result.ok),
        request: {
          id,
          url: data.result.url,
        },
        certificate: data.certificate,
        response: {
          ok: Boolean(data.result.ok),
          status: data.result.status ?? null,
          error: data.result.error || null,
          contentType: data.result.contentType || null,
          preview: data.result.preview || null,
          base64Content: data.result.base64Content || null,
          trace: Array.isArray(data.result.trace)
            ? data.result.trace.map((step) => ({
                ...step,
                resolvedLocation: resolveRedirectUrl(step.url, step.location),
              }))
            : [],
        },
      })
    } catch (error) {
      console.error(`[gufo-spv-bridge] HTTP download-message error`, error)
      sendJson(res, 400, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  if (req.method === "POST" && url.pathname === "/api/v1/efactura/list-messages") {
    try {
      const body = await readJsonBody(req)
      const serial = normalizeSerial(body.serial || DEFAULT_CERT_SERIAL)
      const accessToken = String(body.accessToken || "").trim()
      const environment = String(body.environment || "prod").trim().toLowerCase()
      const cif = String(body.cif || "").trim()
      const days = Number(body.days || 30)
      console.log(`[gufo-spv-bridge] HTTP efactura list-messages serial=${serial} env=${environment} cif=${cif} days=${days}`)
      const data = await listIncomingEfacturaMessages(serial, accessToken, environment, cif, days)
      const parsedContent = parseResponseContent(data.result.content)
      sendJson(res, 200, {
        ok: Boolean(data.result.ok),
        request: { days, environment, cif, url: data.result.url },
        certificate: data.certificate,
        response: {
          ok: Boolean(data.result.ok),
          status: data.result.status ?? null,
          error: data.result.error || null,
          contentType: data.result.contentType || null,
          parsedContent,
          rawContent: typeof parsedContent === "string" ? parsedContent : null,
        },
      })
    } catch (error) {
      console.error(`[gufo-spv-bridge] HTTP efactura list-messages error`, error)
      sendJson(res, 400, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  if (req.method === "POST" && url.pathname === "/api/v1/efactura/download-message") {
    try {
      const body = await readJsonBody(req)
      const serial = normalizeSerial(body.serial || DEFAULT_CERT_SERIAL)
      const accessToken = String(body.accessToken || "").trim()
      const environment = String(body.environment || "prod").trim().toLowerCase()
      const id = String(body.id || "").trim()
      console.log(`[gufo-spv-bridge] HTTP efactura download-message serial=${serial} env=${environment} id=${id}`)
      const data = await downloadIncomingEfacturaMessage(serial, accessToken, environment, id)
      const artifacts = data?.result?.base64Content ? await extractAnafArtifacts(data.result.base64Content) : null
      sendJson(res, 200, {
        ok: Boolean(data.result.ok),
        request: { id, environment, url: data.result.url },
        certificate: data.certificate,
        response: {
          ok: Boolean(data.result.ok),
          status: data.result.status ?? null,
          error: data.result.error || null,
          contentType: data.result.contentType || null,
          base64Content: data.result.base64Content || null,
          rawContent: data.result.content || null,
          artifacts: artifacts || {
            pdfBase64: null,
            pdfFileName: null,
            xmlBase64: null,
            xmlFileName: null,
          },
        },
      })
    } catch (error) {
      console.error(`[gufo-spv-bridge] HTTP efactura download-message error`, error)
      sendJson(res, 400, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  if (req.method === "POST" && url.pathname === "/api/v1/efactura/download-many") {
    try {
      const body = await readJsonBody(req)
      const serial = normalizeSerial(body.serial || DEFAULT_CERT_SERIAL)
      const accessToken = String(body.accessToken || "").trim()
      const environment = String(body.environment || "prod").trim().toLowerCase()
      const ids = Array.isArray(body.ids) ? body.ids : []
      console.log(
        `[gufo-spv-bridge] HTTP efactura download-many serial=${serial} env=${environment} count=${ids.length}`
      )
      const data = await downloadManyIncomingEfacturaMessages(serial, accessToken, environment, ids)
      sendJson(res, 200, {
        ok: Boolean(data.result.ok),
        request: { environment, count: ids.length },
        certificate: data.certificate,
        response: {
          ok: Boolean(data.result.ok),
          items: Array.isArray(data.result.items) ? data.result.items : [],
        },
      })
    } catch (error) {
      console.error(`[gufo-spv-bridge] HTTP efactura download-many error`, error)
      sendJson(res, 400, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  sendJson(res, 404, {
    ok: false,
    error: "Ruta necunoscuta.",
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[gufo-spv-bridge] running on http://${HOST}:${PORT}`)
})
