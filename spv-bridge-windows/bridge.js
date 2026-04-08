const http = require("http")
const { execFile } = require("child_process")
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const packageJson = require("./package.json")
let AdmZip
try {
  AdmZip = require("adm-zip")
} catch {
  AdmZip = require(path.join(__dirname, "vendor", "adm-zip"))
}

const DEFAULT_PORT = 48521
const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_ERP_URL = String(process.env.GUFO_DEFAULT_ERP_URL || "https://app.gufo.ink").trim()
const SPV_LIST_MESSAGES_URL = "https://webserviced.anaf.ro/SPVWS2/rest/listaMesaje"
const SPV_DOWNLOAD_MESSAGE_URL = "https://webserviced.anaf.ro/SPVWS2/rest/descarcare"
const EFACTURA_LIST_MESSAGES_PROD_URL = "https://webserviceapl.anaf.ro/prod/FCTEL/rest/listaMesajeFactura"
const EFACTURA_LIST_MESSAGES_TEST_URL = "https://webserviceapl.anaf.ro/test/FCTEL/rest/listaMesajeFactura"
const EFACTURA_DOWNLOAD_PROD_URL = "https://webserviceapl.anaf.ro/prod/FCTEL/rest/descarcare"
const EFACTURA_DOWNLOAD_TEST_URL = "https://webserviceapl.anaf.ro/test/FCTEL/rest/descarcare"
const POWERSHELL_TIMEOUT_MS = 90000
const CONFIG_DIR = resolveConfigDir()
const CONFIG_PATH = path.join(CONFIG_DIR, "agent-config.json")
const AGENT_APP_VERSION = String(packageJson.version || "0.0.0")

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
let LAST_PAIRING_CODE = String(persistedConfig.lastPairingCode || "").trim()
let PAIRING_COMPANY_NAME = String(persistedConfig.pairingCompanyName || "").trim()
let PAIRING_TENANT_ID = String(persistedConfig.pairingTenantId || "").trim()
let PAIRING_EXPIRES_AT = String(persistedConfig.pairingExpiresAt || "").trim()
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

function resolveConfigDir() {
  const configuredDir = String(process.env.GUFO_EFACTURA_CONFIG_DIR || "").trim()
  if (configuredDir) {
    return configuredDir
  }
  const appDataDir = String(process.env.APPDATA || "").trim()
  if (appDataDir) {
    return path.join(appDataDir, "gufo-efactura-agent")
  }
  return __dirname
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function parsePossiblySerializedDate(value) {
  if (!value) return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  const text = String(value).trim()
  if (!text) return null
  const serializedMatch = text.match(/^\/Date\((\d+)\)\/$/)
  if (serializedMatch) {
    const timestamp = Number(serializedMatch[1])
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp)
    }
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDisplayDate(value) {
  const parsed = parsePossiblySerializedDate(value)
  if (!parsed) return String(value || "-")
  return parsed.toLocaleString("ro-RO")
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
    lastPairingCode: LAST_PAIRING_CODE,
    pairingCompanyName: PAIRING_COMPANY_NAME,
    pairingTenantId: PAIRING_TENANT_ID,
    pairingExpiresAt: PAIRING_EXPIRES_AT,
  }
  ensureDirectory(path.dirname(CONFIG_PATH))
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

if (GENERATED_TOKEN_ON_BOOT) {
  saveAgentConfig()
}

function getConfiguredErpOrigin() {
  const effectiveUrl = ERP_URL || DEFAULT_ERP_URL
  if (!effectiveUrl) return ""
  try {
    return new URL(effectiveUrl).origin
  } catch {
    return ""
  }
}

async function resolvePairingCode(pairingCode, fallbackErpUrl) {
  const normalizedCode = String(pairingCode || "").trim()
  if (!normalizedCode) {
    throw new Error("Codul de pairing lipseste.")
  }

  const baseUrl = String(fallbackErpUrl || ERP_URL || DEFAULT_ERP_URL).trim().replace(/\/+$/, "")
  if (!baseUrl) {
    throw new Error("Lipseste ERP URL-ul pentru rezolvarea codului de pairing.")
  }

  let response
  try {
    response = await fetch(`${baseUrl}/api/v1/public/efactura/agent-pairing/resolve?code=${encodeURIComponent(normalizedCode)}`, {
      headers: {
        Accept: "application/json",
      },
    })
  } catch (error) {
    throw new Error("Nu am putut contacta ERP-ul pentru codul de pairing.")
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok || !data?.pairing) {
    throw new Error(data?.error || "Codul de pairing nu a putut fi validat.")
  }

  return data.pairing
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

  const erpOrigin = getConfiguredErpOrigin()
  const healthUrl = `http://${HOST}:${PORT}/health`
  const statusTone = DEFAULT_CERT_SERIAL ? "configured" : "attention"
  const pairingStateLabel = PAIRING_COMPANY_NAME
    ? `Pairing activ: ${PAIRING_COMPANY_NAME}`
    : "Conecteaza agentul cu codul din ERP"
  return `<!doctype html>
<html lang="ro">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Gufo e-Factura</title>
  <style>
    :root {
      --bg:#eff4fa;
      --card:#ffffff;
      --line:#d8e2ee;
      --text:#17324D;
      --muted:#66788a;
      --blue:#17324D;
      --blue-soft:#e9f0f8;
      --green:#216e39;
      --green-soft:#ecf8ef;
      --amber:#9a6700;
      --amber-soft:#fff6e5;
      --shadow:0 18px 48px rgba(23,50,77,.10);
    }
    * { box-sizing:border-box; }
    body { font-family: Segoe UI, Arial, sans-serif; background:linear-gradient(180deg,#f5f8fc 0%, var(--bg) 100%); margin:0; color:var(--text); }
    .wrap { max-width: 980px; margin: 28px auto; padding: 0 20px 28px; }
    .hero { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:18px; }
    .hero h1 { margin:0 0 6px; font-size:34px; line-height:1.05; }
    .hero p { margin:0; color:#5e7388; max-width:640px; }
    .shell { display:grid; gap:16px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:24px; box-shadow:var(--shadow); padding:24px; }
    .grid { display:grid; gap:14px; grid-template-columns: repeat(2, minmax(0,1fr)); }
    .full { grid-column: 1 / -1; }
    .metrics { display:grid; gap:14px; grid-template-columns: repeat(4, minmax(0,1fr)); }
    .metric { border:1px solid var(--line); border-radius:18px; padding:16px; background:#f9fbfd; min-height:104px; }
    .metric .label { font-size:11px; text-transform:uppercase; letter-spacing:.16em; color:#6d8093; font-weight:700; }
    .metric .value { margin-top:10px; font-size:20px; font-weight:800; color:var(--text); word-break:break-word; }
    .metric .hint { margin-top:6px; font-size:12px; color:var(--muted); }
    .metric.blue { background:var(--blue-soft); }
    .metric.green { background:var(--green-soft); }
    .metric.amber { background:var(--amber-soft); }
    .metric.slate { background:#f9fbfd; }
    .section-title { margin:0 0 6px; font-size:18px; font-weight:800; }
    .section-copy { margin:0 0 16px; color:#5e7388; font-size:14px; }
    label { display:block; font-size:13px; font-weight:700; margin-bottom:6px; }
    input { width:100%; border:1px solid #c8d5e3; border-radius:14px; padding:13px 14px; font-size:14px; background:#fff; }
    input:focus { outline:none; border-color:#89a8c8; box-shadow:0 0 0 4px rgba(23,50,77,.08); }
    .actions { margin-top:18px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
    button { background:var(--blue); color:#fff; border:none; border-radius:14px; padding:12px 18px; font-weight:800; cursor:pointer; }
    button.secondary { background:#edf3f9; color:var(--blue); }
    button.link { background:transparent; color:var(--blue); border:1px solid var(--line); }
    .muted { font-size:12px; color:var(--muted); }
    .pill { display:inline-flex; align-items:center; gap:8px; border-radius:999px; padding:8px 12px; font-size:12px; font-weight:800; }
    .pill.green { background:var(--green-soft); color:var(--green); }
    .pill.amber { background:var(--amber-soft); color:var(--amber); }
    .row { margin-top:16px; display:flex; flex-wrap:wrap; gap:12px; }
    .status-list { display:grid; gap:10px; grid-template-columns: repeat(2, minmax(0,1fr)); }
    .status-item { border:1px solid var(--line); border-radius:16px; padding:14px; background:#f9fbfd; }
    .status-item .k { font-size:12px; color:#6d8093; margin-bottom:6px; }
    .status-item .v { font-size:14px; font-weight:700; color:var(--text); word-break:break-word; }
    .notice { border:1px solid var(--line); border-radius:16px; padding:12px 14px; background:#f9fbfd; color:var(--text); font-size:13px; }
    .notice.error { background:#fff1f2; border-color:#fecdd3; color:#9f1239; }
    .notice.success { background:#ecfdf3; border-color:#bbf7d0; color:#166534; }
    @media (max-width: 900px) {
      .metrics { grid-template-columns: repeat(2, minmax(0,1fr)); }
      .status-list { grid-template-columns: 1fr; }
      .hero { flex-direction:column; }
    }
    @media (max-width: 640px) {
      .wrap { padding: 0 14px 20px; }
      .grid, .metrics { grid-template-columns: 1fr; }
      .hero h1 { font-size:30px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div>
        <h1>Gufo e-Factura</h1>
        <p>Aplicatia locala foloseste certificatul digital de pe Windows si lucreaza cu ERP-ul fara pasi tehnici inutili.</p>
        <p class="muted" style="margin-top:8px;">Versiune agent: ${escape(AGENT_APP_VERSION)}</p>
      </div>
      <div class="row">
        <span class="pill ${statusTone === "configured" ? "green" : "amber"}" id="agent-state-pill">${DEFAULT_CERT_SERIAL ? "Agent configurat" : "Configurare necesara"}</span>
        <span class="pill ${PAIRING_COMPANY_NAME ? "green" : "amber"}" id="pairing-state-pill">${escape(pairingStateLabel)}</span>
      </div>
    </div>

    <div class="shell">
      <div class="metrics">
        <div class="metric blue">
          <div class="label">ERP</div>
          <div class="value" id="metric-erp">${escape(erpOrigin || ERP_URL || "-")}</div>
          <div class="hint">ERP conectat la agent</div>
        </div>
        <div class="metric">
          <div class="label">Certificat</div>
          <div class="value" id="metric-cert">${escape(DEFAULT_CERT_SERIAL || "-")}</div>
          <div class="hint">Serial configurat local</div>
        </div>
        <div class="metric green">
          <div class="label">Health</div>
          <div class="value" id="metric-health">Online</div>
          <div class="hint">${escape(healthUrl)}</div>
        </div>
        <div class="metric amber" id="metric-expiry-card">
          <div class="label">Expirare</div>
          <div class="value" id="metric-expiry">Se verifica...</div>
          <div class="hint" id="metric-expiry-hint">Statusul certificatului local</div>
        </div>
      </div>

      <div class="card">
        <div class="section-title">Configurare agent</div>
        <div class="section-copy">Clientul completeaza codul de pairing din ERP si serialul certificatului. Restul setarilor raman ascunse in mod normal.</div>
        <form id="config-form" class="grid">
          <div class="full">
            <label for="pairingCode">Cod pairing</label>
            <input id="pairingCode" name="pairingCode" value="${escape(LAST_PAIRING_CODE)}" placeholder="Lipit din ERP > Setari e-Factura" />
          </div>
          <div class="full">
            <label for="certSerial">Serial certificat</label>
            <input id="certSerial" name="certSerial" value="${escape(DEFAULT_CERT_SERIAL)}" placeholder="Serialul certificatului din Windows Store" />
          </div>
          <details class="full">
            <summary>Setari avansate</summary>
            <div class="grid" style="margin-top:12px;">
              <div class="full">
                <label for="erpUrl">ERP URL</label>
                <input id="erpUrl" name="erpUrl" value="${escape(ERP_URL || DEFAULT_ERP_URL)}" placeholder="https://app.gufo.ink" />
              </div>
              <div>
                <label for="bridgeHost">Host local</label>
                <input id="bridgeHost" name="bridgeHost" value="${escape(HOST)}" />
              </div>
              <div>
                <label for="bridgePort">Port local</label>
                <input id="bridgePort" name="bridgePort" value="${escape(PORT)}" />
              </div>
            </div>
          </details>
          <div class="actions full">
            <button type="submit">Salveaza configuratia</button>
            <button type="button" class="secondary" id="refresh-status">Actualizeaza statusul</button>
            <button type="button" class="link" id="open-erp">Deschide ERP</button>
            <div id="result" class="muted">Config curent salvat in <code>${escape(CONFIG_PATH)}</code>.</div>
          </div>
          <div class="full notice ${PAIRING_COMPANY_NAME ? "success" : ""}" id="pairing-note">
            ${escape(PAIRING_COMPANY_NAME ? `Agentul este legat de ${PAIRING_COMPANY_NAME}.${PAIRING_EXPIRES_AT ? ` Codul expira la ${formatDisplayDate(PAIRING_EXPIRES_AT)}.` : ""}` : "In ERP apesi Genereaza cod, apoi lipesti codul aici si salvezi configuratia.")}
          </div>
          <div class="full muted">Tokenul local este generat automat de agent. Hostul si portul local raman pe valorile default in aproape toate instalarile.</div>
        </form>
      </div>

      <div class="card">
        <div class="section-title">Stare curenta</div>
        <div class="section-copy">Verifici rapid daca certificatul este detectat, daca are cheie privata si cand expira.</div>
        <div class="status-list">
          <div class="status-item">
            <div class="k">Subiect certificat</div>
            <div class="v" id="status-subject">Se verifica...</div>
          </div>
          <div class="status-item">
            <div class="k">Store Windows</div>
            <div class="v" id="status-store">Se verifica...</div>
          </div>
          <div class="status-item">
            <div class="k">Cheie privata</div>
            <div class="v" id="status-key">Se verifica...</div>
          </div>
          <div class="status-item">
            <div class="k">Expira la</div>
            <div class="v" id="status-expiry">Se verifica...</div>
          </div>
        </div>
        <div class="row">
          <div class="notice" id="status-note">Starea agentului se actualizeaza local.</div>
        </div>
      </div>
    </div>
  </div>
  <script>
    const result = document.getElementById('result');
    const refreshButton = document.getElementById('refresh-status');
    const openErpButton = document.getElementById('open-erp');

    function parseDisplayDateValue(value) {
      if (!value) return null;
      const text = String(value).trim();
      const serializedMatch = text.match(/^\/Date\((\d+)\)\/$/);
      if (serializedMatch) {
        const timestamp = Number(serializedMatch[1]);
        if (Number.isFinite(timestamp)) {
          return new Date(timestamp);
        }
      }
      const date = new Date(text);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatExpiryLabel(certificate) {
      if (!certificate || !certificate.notAfter) return { title: '-', hint: 'Certificatul nu este detectat inca.' };
      const parsed = parseDisplayDateValue(certificate.notAfter);
      const label = parsed ? parsed.toLocaleString('ro-RO') : String(certificate.notAfter);
      if (certificate.expired) {
        return { title: 'Expirat', hint: label };
      }
      if (certificate.expiringSoon && typeof certificate.expiresInDays === 'number') {
        return { title: 'In ' + certificate.expiresInDays + ' zile', hint: label };
      }
      return { title: 'Valid', hint: label };
    }

    function updateStatusUi(data) {
      const agent = data && data.agent ? data.agent : {};
      const certificate = data && data.certificate ? data.certificate : {};
      const expiry = formatExpiryLabel(certificate);
      const expiryMetric = document.getElementById('metric-expiry-card');
      const statusNote = document.getElementById('status-note');
      document.getElementById('metric-erp').textContent = agent.erpOrigin || agent.erpUrl || '-';
      document.getElementById('metric-cert').textContent = certificate.configuredSerial || '-';
      document.getElementById('metric-health').textContent = data && data.ok ? 'Online' : 'Offline';
      document.getElementById('metric-expiry').textContent = expiry.title;
      document.getElementById('metric-expiry-hint').textContent = expiry.hint;
      document.getElementById('status-subject').textContent = certificate.subject || 'Certificat nedetectat';
      document.getElementById('status-store').textContent = certificate.store || '-';
      document.getElementById('status-key').textContent = certificate.hasPrivateKey ? 'Da' : 'Nu';
      document.getElementById('status-expiry').textContent = expiry.hint;
      statusNote.textContent =
        certificate.error
          ? certificate.error
          : (certificate.detected
            ? 'Certificatul local este detectat si pregatit pentru SPV.'
            : 'Completeaza serialul certificatului si salveaza configuratia.');
      statusNote.className =
        'notice ' + (
          certificate.error || certificate.expired
            ? 'error'
            : certificate.detected
              ? 'success'
              : ''
        );
      document.getElementById('agent-state-pill').textContent =
        certificate.detected ? 'Agent conectat' : 'Configurare necesara';
      document.getElementById('agent-state-pill').className =
        'pill ' + (
          certificate.error || certificate.expired
            ? 'amber'
            : certificate.detected
              ? 'green'
              : 'amber'
        );
      expiryMetric.className =
        'metric ' + (
          certificate.expired || certificate.error
            ? 'amber'
            : certificate.expiringSoon
              ? 'amber'
              : certificate.detected
                ? 'green'
                : 'slate'
        );
    }

    async function refreshStatus() {
      try {
        const response = await fetch('/agent/status', { headers: { Accept: 'application/json' } });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) {
          throw new Error(data.error || 'Nu am putut citi starea agentului.');
        }
        updateStatusUi(data);
      } catch (error) {
        document.getElementById('status-note').textContent = error.message || String(error);
      }
    }

    document.getElementById('config-form').addEventListener('submit', async function (event) {
      event.preventDefault();
      const form = event.currentTarget;
      const payload = {
        pairingCode: form.pairingCode.value.trim(),
        erpUrl: form.erpUrl.value.trim(),
        certSerial: form.certSerial.value.trim(),
        bridgeHost: form.bridgeHost.value.trim(),
        bridgePort: form.bridgePort.value.trim(),
      };
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
      if (response.ok && data.ok) {
        if (data.config && data.config.erpUrl) {
          document.getElementById('erpUrl').value = data.config.erpUrl;
        }
        if (data.config && data.config.certSerial) {
          document.getElementById('certSerial').value = data.config.certSerial;
        }
        if (payload.pairingCode) {
          document.getElementById('pairingCode').value = payload.pairingCode;
        }
        const pairingNote = document.getElementById('pairing-note');
        const pairingStatePill = document.getElementById('pairing-state-pill');
        if (data.pairing && data.pairing.companyName) {
          pairingNote.textContent = 'Agentul este legat de ' + data.pairing.companyName + '.';
          pairingNote.className = 'full notice success';
          pairingStatePill.textContent = 'Pairing activ: ' + data.pairing.companyName;
          pairingStatePill.className = 'pill green';
        }
        refreshStatus();
      }
    });

    refreshButton.addEventListener('click', refreshStatus);
    openErpButton.addEventListener('click', function () {
      const value = document.getElementById('erpUrl').value.trim();
      if (value) {
        window.open(value, '_blank');
      }
    });

    refreshStatus();
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

function getCertificateStatusPayload(certificate, error) {
  const configuredSerial = DEFAULT_CERT_SERIAL || null
  if (!configuredSerial && !certificate) {
    return {
      configuredSerial: null,
      detected: false,
      hasPrivateKey: false,
      subject: null,
      issuer: null,
      thumbprint: null,
      store: null,
      notBefore: null,
      notAfter: null,
      expiresInDays: null,
      expired: false,
      expiringSoon: false,
      error: error ? String(error.message || error) : null,
    }
  }

  const notAfterRaw = certificate?.notAfter || null
  const notAfterDate = parsePossiblySerializedDate(notAfterRaw)
  const now = Date.now()
  const expiresInDays =
    notAfterDate && !Number.isNaN(notAfterDate.getTime())
      ? Math.ceil((notAfterDate.getTime() - now) / 86_400_000)
      : null

  return {
    configuredSerial,
    detected: Boolean(certificate),
    hasPrivateKey: Boolean(certificate?.hasPrivateKey),
    subject: certificate?.subject || null,
    issuer: certificate?.issuer || null,
    thumbprint: certificate?.thumbprint || null,
    store: certificate?.store || null,
    notBefore: certificate?.notBefore || null,
    notAfter: notAfterRaw,
    expiresInDays,
    expired: typeof expiresInDays === "number" ? expiresInDays < 0 : false,
    expiringSoon: typeof expiresInDays === "number" ? expiresInDays <= 30 : false,
    error: error ? String(error.message || error) : null,
  }
}

async function getLocalAgentStatus() {
  let certificate = null
  let certError = null

  if (DEFAULT_CERT_SERIAL) {
    try {
      certificate = await resolveCertificate(DEFAULT_CERT_SERIAL)
    } catch (error) {
      certError = error
    }
  }

  return {
    ok: true,
    agent: {
      service: "gufo-efactura",
      bridgeUrl: `http://${HOST}:${PORT}`,
      host: HOST,
      port: PORT,
      erpUrl: ERP_URL || null,
      erpOrigin: getConfiguredErpOrigin() || null,
      hasLicenseKey: Boolean(LICENSE_KEY),
    },
    certificate: getCertificateStatusPayload(certificate, certError),
  }
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

function getEfacturaListUrl(environment, cui, days) {
  return getEfacturaListMessagesUrl(environment, days, cui)
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

async function syncIncomingEfacturaMessages(serial, accessToken, environment, cif, days, existingIds) {
  const normalizedSerial = normalizeSerial(serial)
  const bearerToken = String(accessToken || "").trim()
  const normalizedEnvironment = String(environment || "prod").trim().toLowerCase() === "test" ? "test" : "prod"
  const companyCif = String(cif || "").trim()
  const safeDays = Math.max(1, Math.min(365, Number(days || 30)))
  const listUrl = getEfacturaListUrl(normalizedEnvironment, companyCif, safeDays)
  const downloadBaseUrl = normalizedEnvironment === "test" ? EFACTURA_DOWNLOAD_TEST_URL : EFACTURA_DOWNLOAD_PROD_URL
  const cleanExistingIds = Array.isArray(existingIds)
    ? existingIds.map((entry) => String(entry || "").trim()).filter(Boolean)
    : []

  console.log(
    `[gufo-spv-bridge] syncIncomingEfacturaMessages start serial=${normalizedSerial} env=${normalizedEnvironment} cif=${companyCif} days=${safeDays} existing=${cleanExistingIds.length}`
  )

  const cert = await resolveCertificate(serial)
  const escapedToken = bearerToken.replace(/'/g, "''")
  const escapedListUrl = listUrl.replace(/'/g, "''")
  const escapedDownloadBaseUrl = downloadBaseUrl.replace(/'/g, "''")
  const existingIdsJson = JSON.stringify(cleanExistingIds).replace(/'/g, "''")

  const script = `
$serial = '${normalizedSerial}'
$accessToken = '${escapedToken}'
$listUrl = '${escapedListUrl}'
$downloadBaseUrl = '${escapedDownloadBaseUrl}'
$existingIds = ConvertFrom-Json @'
${existingIdsJson}
'@
$existingLookup = @{}
foreach ($existingId in $existingIds) {
  $normalizedId = [string]$existingId
  if (-not [string]::IsNullOrWhiteSpace($normalizedId)) {
    $existingLookup[$normalizedId] = $true
  }
}
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

function Invoke-EfacturaRequest {
  param(
    [string]$Url,
    [string]$AccessToken,
    [System.Security.Cryptography.X509Certificates.X509Certificate2]$ClientCertificate
  )

  $request = [System.Net.HttpWebRequest]::Create($Url)
  $request.Method = 'GET'
  $request.Timeout = 45000
  $request.ReadWriteTimeout = 45000
  $request.AllowAutoRedirect = $false
  $request.KeepAlive = $true
  $request.UserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) GufoSPVBridge/1.0'
  $request.Headers['Authorization'] = 'Bearer ' + $AccessToken
  [void]$request.ClientCertificates.Add($ClientCertificate)

  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $response = [System.Net.HttpWebResponse]$request.GetResponse()
    $statusCode = [int]$response.StatusCode
    $contentType = $response.ContentType
    $bytes = Read-ResponseBytes -Response $response
    $response.Close()
    return [PSCustomObject]@{
      ok = ($statusCode -ge 200 -and $statusCode -lt 300)
      status = $statusCode
      contentType = $contentType
      base64Content = [Convert]::ToBase64String($bytes)
      content = [System.Text.Encoding]::UTF8.GetString($bytes)
      error = $null
      url = $Url
    }
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
    return [PSCustomObject]@{
      ok = $false
      status = $statusCode
      contentType = $contentType
      base64Content = if ($responseBytes) { [Convert]::ToBase64String($responseBytes) } else { $null }
      content = $content
      error = if ($content) { $content } else { $_.Exception.Message }
      url = $Url
    }
  }
}

$listResult = Invoke-EfacturaRequest -Url $listUrl -AccessToken $accessToken -ClientCertificate $cert
$downloads = New-Object System.Collections.ArrayList

if ($listResult.ok -and $listResult.content) {
  $listPayload = $null
  try {
    $listPayload = $listResult.content | ConvertFrom-Json -Depth 20
  } catch {}

  $messages = @()
  if ($listPayload -and $listPayload.mesaje) {
    $messages = @($listPayload.mesaje)
  }

  foreach ($message in $messages) {
    $messageId = [string]$message.id
    if ([string]::IsNullOrWhiteSpace($messageId)) {
      continue
    }
    $tip = ([string]$message.tip).Trim().ToUpper()
    $detalii = ([string]$message.detalii).Trim().ToLower()
    $isIncomingInvoice =
      $tip.Contains('PRIMITA') -or
      (($tip -ne 'RECIPISA') -and $detalii.Contains('cif_beneficiar'))
    if (-not $isIncomingInvoice) {
      continue
    }
    if ($existingLookup.ContainsKey($messageId)) {
      continue
    }

    $downloadUrl = $downloadBaseUrl + '?id=' + [System.Uri]::EscapeDataString($messageId)
    $downloadResult = Invoke-EfacturaRequest -Url $downloadUrl -AccessToken $accessToken -ClientCertificate $cert
    [void]$downloads.Add([PSCustomObject]@{
      id = $messageId
      ok = $downloadResult.ok
      status = $downloadResult.status
      contentType = $downloadResult.contentType
      base64Content = $downloadResult.base64Content
      error = $downloadResult.error
    })
  }
}

[PSCustomObject]@{
  ok = $true
  list = $listResult
  items = $downloads
} | ConvertTo-Json -Compress -Depth 8
`.trim()

  const raw = await runPowerShell(script)
  const response = {
    certificate: cert,
    result: JSON.parse(raw),
  }
  console.log(
    `[gufo-spv-bridge] syncIncomingEfacturaMessages finish listOk=${Boolean(response?.result?.list?.ok)} downloaded=${Array.isArray(response?.result?.items) ? response.result.items.length : 0}`
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
          lastPairingCode: LAST_PAIRING_CODE,
          pairingCompanyName: PAIRING_COMPANY_NAME,
          pairingTenantId: PAIRING_TENANT_ID,
          pairingExpiresAt: PAIRING_EXPIRES_AT,
        },
      })
    return
  }

  if (req.method === "POST" && url.pathname === "/agent/config") {
    try {
      const body = await readJsonBody(req)
      const manualErpUrl = String(body.erpUrl || "").trim()
      const pairingCode = String(body.pairingCode || "").trim()
      let resolvedPairing = null

      if (pairingCode) {
        resolvedPairing = await resolvePairingCode(pairingCode, manualErpUrl || ERP_URL || DEFAULT_ERP_URL)
      }

      ERP_URL = String(resolvedPairing?.erpUrl || manualErpUrl || ERP_URL || DEFAULT_ERP_URL).trim()
      LICENSE_KEY = String(body.licenseKey || "").trim()
      LAST_PAIRING_CODE = pairingCode || LAST_PAIRING_CODE
      DEFAULT_CERT_SERIAL = normalizeSerial(body.certSerial || resolvedPairing?.certSerial || "")
      PAIRING_COMPANY_NAME = String(resolvedPairing?.companyName || PAIRING_COMPANY_NAME || "").trim()
      PAIRING_TENANT_ID = String(resolvedPairing?.tenantId || PAIRING_TENANT_ID || "").trim()
      PAIRING_EXPIRES_AT = String(resolvedPairing?.expiresAt || PAIRING_EXPIRES_AT || "").trim()
      HOST = String(body.bridgeHost || DEFAULT_HOST).trim() || DEFAULT_HOST
      PORT = Math.max(1, Math.min(65535, Number(body.bridgePort || DEFAULT_PORT) || DEFAULT_PORT))
      saveAgentConfig()
      sendJson(res, 200, {
        ok: true,
        message: "Configuratia agentului a fost salvata.",
        config: {
          erpUrl: ERP_URL,
          certSerial: DEFAULT_CERT_SERIAL || "",
          bridgeHost: HOST,
          bridgePort: PORT,
          lastPairingCode: LAST_PAIRING_CODE,
          pairingCompanyName: PAIRING_COMPANY_NAME,
          pairingTenantId: PAIRING_TENANT_ID,
          pairingExpiresAt: PAIRING_EXPIRES_AT,
        },
        pairing: resolvedPairing,
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
        pairingCompanyName: PAIRING_COMPANY_NAME || null,
        pairingTenantId: PAIRING_TENANT_ID || null,
        pairingExpiresAt: PAIRING_EXPIRES_AT || null,
        hasLicenseKey: Boolean(LICENSE_KEY),
      },
    })
    return
  }

  if (req.method === "GET" && url.pathname === "/agent/status") {
    if (!isTrustedOrigin(req.headers.origin)) {
      sendJson(res, 403, {
        ok: false,
        error: "Originea ERP-ului nu este autorizata pentru statusul agentului.",
      })
      return
    }
    try {
      sendJson(res, 200, await getLocalAgentStatus())
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: String(error.message || error),
      })
    }
    return
  }

  if (req.method === "GET" && url.pathname === "/health") {
    const statusPayload = await getLocalAgentStatus()
    sendJson(res, 200, {
      ok: true,
      service: "gufo-efactura",
      host: HOST,
      port: PORT,
      hasBridgeToken: Boolean(BRIDGE_TOKEN),
      defaultCertSerial: DEFAULT_CERT_SERIAL || null,
      erpUrl: ERP_URL || null,
      hasLicenseKey: Boolean(LICENSE_KEY),
      certificate: statusPayload.certificate,
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

  if (req.method === "POST" && url.pathname === "/api/v1/efactura/sync-batch") {
    try {
      const body = await readJsonBody(req)
      const serial = normalizeSerial(body.serial || DEFAULT_CERT_SERIAL)
      const accessToken = String(body.accessToken || "").trim()
      const environment = String(body.environment || "prod").trim().toLowerCase()
      const cif = String(body.cif || "").trim()
      const days = Number(body.days || 30)
      const existingIds = Array.isArray(body.existingIds) ? body.existingIds : []
      console.log(
        `[gufo-spv-bridge] HTTP efactura sync-batch serial=${serial} env=${environment} cif=${cif} days=${days} existing=${existingIds.length}`
      )
      const data = await syncIncomingEfacturaMessages(serial, accessToken, environment, cif, days, existingIds)
      sendJson(res, 200, {
        ok: Boolean(data.result.ok),
        request: { environment, cif, days, existingIds: existingIds.length },
        certificate: data.certificate,
        response: {
          ok: Boolean(data.result.ok),
          list: data.result.list || null,
          items: Array.isArray(data.result.items) ? data.result.items : [],
        },
      })
    } catch (error) {
      console.error(`[gufo-spv-bridge] HTTP efactura sync-batch error`, error)
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

server.on("error", (error) => {
  if (error && error.code === "EADDRINUSE") {
    console.warn(`[gufo-spv-bridge] port already in use on http://${HOST}:${PORT}; using existing local agent instance`)
    return
  }
  throw error
})

server.listen(PORT, HOST, () => {
  console.log(`[gufo-spv-bridge] running on http://${HOST}:${PORT}`)
})
