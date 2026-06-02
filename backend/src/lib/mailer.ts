import nodemailer from "nodemailer"

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function parsePorts(value: string | undefined, fallback: number[]) {
  if (typeof value !== "string" || !value.trim()) return fallback
  const parsed = value
    .split(",")
    .map((entry) => Number(entry.trim()))
    .filter((entry) => Number.isFinite(entry) && entry > 0)
  return parsed.length ? parsed : fallback
}

function parseBoolean(value: string | undefined, fallback = false) {
  if (typeof value !== "string") return fallback
  const normalized = value.trim().toLowerCase()
  if (["true", "1", "yes", "on"].includes(normalized)) return true
  if (["false", "0", "no", "off"].includes(normalized)) return false
  return fallback
}

function getSmtpHosts() {
  const raw = String(process.env.SMTP_HOST || "")
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
}

function getBrevoApiKey() {
  return String(process.env.BREVO_API_KEY || "").trim()
}

function getSmtpAttempts() {
  const hosts = getSmtpHosts()
  const preferredPorts = parsePorts(process.env.SMTP_PORT, [587])
  const preferredSecure = parseBoolean(process.env.SMTP_SECURE, false)
  const attempts: Array<{ host: string; port: number; secure: boolean }> = []
  const seen = new Set<string>()

  function pushAttempt(host: string, port: number, secure: boolean) {
    const key = `${host}|${port}|${secure ? "1" : "0"}`
    if (seen.has(key)) return
    seen.add(key)
    attempts.push({ host, port, secure })
  }

  for (const host of hosts) {
    for (const port of preferredPorts) {
      pushAttempt(host, port, preferredSecure)
    }

    pushAttempt(host, 587, false)
    pushAttempt(host, 465, true)
    pushAttempt(host, 2525, false)
  }

  return attempts
}

export function hasSmtpConfig() {
  return Boolean(
    getBrevoApiKey() ||
    getSmtpHosts().length &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  )
}

async function sendViaBrevoApi(input: {
  to: string
  subject: string
  html: string
  text: string
  fromName?: string
}) {
  const apiKey = getBrevoApiKey()
  if (!apiKey) {
    throw new Error("BREVO_API_KEY is not configured")
  }

  const fromRaw = String(process.env.SMTP_FROM || "").trim()
  const match = fromRaw.match(/^(.*?)<([^>]+)>$/)
  const sender = match
    ? {
        name: input.fromName || match[1].trim().replace(/^"|"$/g, ""),
        email: match[2].trim(),
      }
    : {
        name: input.fromName || "Gufo ERP",
        email: fromRaw,
      }

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender,
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
      textContent: input.text,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Brevo API error ${response.status}: ${body}`)
  }
}

export async function sendMail(input: {
  to: string
  subject: string
  html: string
  text: string
  fromName?: string
}) {
  if (!hasSmtpConfig()) {
    throw new Error("SMTP is not configured")
  }

  if (getBrevoApiKey()) {
    await sendViaBrevoApi(input)
    return
  }

  const attempts = getSmtpAttempts()
  const connectionTimeout = parsePort(process.env.SMTP_CONNECTION_TIMEOUT_MS, 15000)
  const greetingTimeout = parsePort(process.env.SMTP_GREETING_TIMEOUT_MS, 10000)
  const socketTimeout = parsePort(process.env.SMTP_SOCKET_TIMEOUT_MS, 20000)
  const rejectUnauthorized = parseBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true)
  const requireTls = parseBoolean(process.env.SMTP_REQUIRE_TLS, false)

  let lastError: unknown = null

  for (const attempt of attempts) {
    try {
      const transporter = nodemailer.createTransport({
        host: attempt.host,
        port: attempt.port,
        secure: attempt.secure,
        requireTLS: requireTls,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout,
        greetingTimeout,
        socketTimeout,
        tls: {
          rejectUnauthorized,
          servername: process.env.SMTP_TLS_SERVERNAME || attempt.host,
        },
      })

      await transporter.sendMail({
        from: input.fromName
          ? (() => {
              const fromRaw = String(process.env.SMTP_FROM || "").trim()
              const match = fromRaw.match(/^(.*?)<([^>]+)>$/)
              if (match) {
                return `${input.fromName} <${match[2].trim()}>`
              }
              return `${input.fromName} <${fromRaw}>`
            })()
          : process.env.SMTP_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      })

      return
    } catch (error) {
      lastError = error
      console.error(
        `SMTP send failed for host ${attempt.host}:${attempt.port} secure=${attempt.secure}`,
        error
      )
    }
  }

  throw lastError || new Error("SMTP send failed")
}
