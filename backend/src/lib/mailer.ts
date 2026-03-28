import nodemailer from "nodemailer"

function parsePort(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function hasSmtpConfig() {
  return Boolean(
    process.env.SMTP_HOST &&
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

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parsePort(process.env.SMTP_PORT, 587),
    secure: String(process.env.SMTP_SECURE || "").toLowerCase() === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  })

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  })
}
