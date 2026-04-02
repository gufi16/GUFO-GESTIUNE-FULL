const http = require("http")
const { execFile } = require("child_process")
const fs = require("fs")
const path = require("path")

const DEFAULT_PORT = 48521
const DEFAULT_HOST = "127.0.0.1"
const SPV_LIST_MESSAGES_URL = "https://webserviced.anaf.ro/SPVWS2/rest/listaMesaje"
const SPV_DOWNLOAD_MESSAGE_URL = "https://webserviced.anaf.ro/SPVWS2/rest/descarcare"
const POWERSHELL_TIMEOUT_MS = 90000

loadEnv(path.join(__dirname, ".env"))

const PORT = Number(process.env.BRIDGE_PORT || DEFAULT_PORT)
const HOST = process.env.BRIDGE_HOST || DEFAULT_HOST
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || "").trim()
const DEFAULT_CERT_SERIAL = normalizeSerial(process.env.SPV_CERT_SERIAL || "")
const SHOW_POWERSHELL_WINDOW = String(process.env.BRIDGE_SHOW_POWERSHELL_WINDOW || "true").trim().toLowerCase() !== "false"

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

function normalizeSerial(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`)

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    })
    res.end()
    return
  }

  if (req.method === "GET" && url.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      service: "gufo-spv-bridge-windows",
      host: HOST,
      port: PORT,
      hasBridgeToken: Boolean(BRIDGE_TOKEN),
      defaultCertSerial: DEFAULT_CERT_SERIAL || null,
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

  sendJson(res, 404, {
    ok: false,
    error: "Ruta necunoscuta.",
  })
})

server.listen(PORT, HOST, () => {
  console.log(`[gufo-spv-bridge] running on http://${HOST}:${PORT}`)
})
