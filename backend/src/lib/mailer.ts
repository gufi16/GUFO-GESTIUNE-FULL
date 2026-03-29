import nodemailer from "nodemailer"

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
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

export function hasSmtpConfig() {
  return Boolean(
    getSmtpHosts().length &&
      process.env.SMTP_USER &&
      process.env.SMTP_PASS &&
      process.env.SMTP_FROM
  )
}

export async function sendMail(input: {
  to: string
  subject: string
  html: string
  text: string
}) {
  if (!hasSmtpConfig()) {
    throw new Error("SMTP is not configured")
  }

  const hosts = getSmtpHosts()
  const port = parsePort(process.env.SMTP_PORT, 587)
  const secure = parseBoolean(process.env.SMTP_SECURE, false)
  const connectionTimeout = parsePort(process.env.SMTP_CONNECTION_TIMEOUT_MS, 15000)
  const greetingTimeout = parsePort(process.env.SMTP_GREETING_TIMEOUT_MS, 10000)
  const socketTimeout = parsePort(process.env.SMTP_SOCKET_TIMEOUT_MS, 20000)
  const rejectUnauthorized = parseBoolean(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true)

  let lastError: unknown = null

  for (const host of hosts) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
        connectionTimeout,
        greetingTimeout,
        socketTimeout,
        tls: {
          rejectUnauthorized,
          servername: process.env.SMTP_TLS_SERVERNAME || host,
        },
      })

      await transporter.sendMail({
        from: process.env.SMTP_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      })

      return
    } catch (error) {
      lastError = error
      console.error(`SMTP send failed for host ${host}`, error)
    }
  }

  throw lastError || new Error("SMTP send failed")
}
