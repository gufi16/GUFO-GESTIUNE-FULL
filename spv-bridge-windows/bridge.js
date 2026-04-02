const http = require("http")
const { execFile } = require("child_process")
const fs = require("fs")
const path = require("path")

const DEFAULT_PORT = 48521
const DEFAULT_HOST = "127.0.0.1"
const SPV_LIST_MESSAGES_URL = "https://webserviced.anaf.ro/SPVWS2/rest/listaMesaje"

loadEnv(path.join(__dirname, ".env"))

const PORT = Number(process.env.BRIDGE_PORT || DEFAULT_PORT)
const HOST = process.env.BRIDGE_HOST || DEFAULT_HOST
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || "").trim()
const DEFAULT_CERT_SERIAL = normalizeSerial(process.env.SPV_CERT_SERIAL || "")

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
      { windowsHide: true, maxBuffer: 1024 * 1024 * 10 },
      (error, stdout, stderr) => {
        if (error) {
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
  return JSON.parse(raw)
}

async function testListMessages(serial, days) {
  const cert = await resolveCertificate(serial)
  const safeDays = Math.max(1, Math.min(365, Number(days || 30)))

  const script = `
$serial = '${normalizeSerial(serial)}'
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
try {
  $response = Invoke-WebRequest -Uri $url -Method GET -Certificate $cert -UseBasicParsing -ErrorAction Stop
  [PSCustomObject]@{
    ok = $true
    status = [int]$response.StatusCode
    content = [string]$response.Content
    url = $url
  } | ConvertTo-Json -Compress -Depth 5
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
  [PSCustomObject]@{
    ok = $false
    status = $statusCode
    error = $_.Exception.Message
    content = $responseText
    url = $url
  } | ConvertTo-Json -Compress -Depth 5
}
`.trim()

  const raw = await runPowerShell(script)
  const result = JSON.parse(raw)
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`)

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
      const certificate = await resolveCertificate(serial)
      sendJson(res, 200, {
        ok: true,
        certificate,
      })
    } catch (error) {
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
          parsedContent,
          rawContent: typeof parsedContent === "string" ? parsedContent : null,
        },
      })
    } catch (error) {
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
