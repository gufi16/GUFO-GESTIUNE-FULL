import { execFile } from "child_process"
import crypto from "crypto"
import fs from "fs/promises"
import https from "https"
import os from "os"
import path from "path"

type AnafRequestOptions = {
  method?: string
  headers?: Record<string, string>
  body?: string | Buffer
  timeoutMs?: number
}

export type AnafHttpResponse = {
  status: number
  ok: boolean
  headers: Record<string, string | string[] | undefined>
  buffer: Buffer
  text: string
}

export function readAnafHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
) {
  const entry = headers[name.toLowerCase()]
  if (Array.isArray(entry)) return entry[0] || ""
  return entry || ""
}

function shouldRetryWithCurl(error: unknown) {
  const message = String((error as any)?.message || "")
  return /EPROTO|handshake failure|tls alert/i.test(message)
}

function parseCurlHeaders(rawText: string) {
  const blocks = rawText
    .split(/\r?\n\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean)

  const lastBlock = blocks[blocks.length - 1] || ""
  const lines = lastBlock.split(/\r?\n/).filter(Boolean)
  const statusLine = lines[0] || ""
  const statusMatch = statusLine.match(/HTTP\/\S+\s+(\d{3})/)
  const status = Number(statusMatch?.[1] || 0)
  const headers: Record<string, string> = {}

  for (const line of lines.slice(1)) {
    const separatorIndex = line.indexOf(":")
    if (separatorIndex === -1) continue
    const name = line.slice(0, separatorIndex).trim().toLowerCase()
    const value = line.slice(separatorIndex + 1).trim()
    headers[name] = value
  }

  return { status, headers }
}

async function execCurl(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    execFile("curl", args, { windowsHide: true }, (error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function anafCurlRequest(url: string, options: AnafRequestOptions = {}): Promise<AnafHttpResponse> {
  const timeoutMs = Number(options.timeoutMs || 20_000)
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gufo-anaf-"))
  const headersPath = path.join(tempDir, "headers.txt")
  const bodyPath = path.join(tempDir, "body.bin")
  const requestBodyPath = path.join(tempDir, "request.bin")

  try {
    const args = [
      "--silent",
      "--show-error",
      "--location",
      "--http1.1",
      "--tlsv1.2",
      "--tls-max",
      "1.2",
      "--ciphers",
      "DEFAULT@SECLEVEL=1",
      "--no-alpn",
      "--max-time",
      String(Math.max(1, Math.ceil(timeoutMs / 1000))),
      "--dump-header",
      headersPath,
      "--output",
      bodyPath,
      "-X",
      options.method || "GET",
    ]

    for (const [name, value] of Object.entries(options.headers || {})) {
      args.push("-H", `${name}: ${value}`)
    }

    if (options.body) {
      const bodyBuffer = Buffer.isBuffer(options.body) ? options.body : Buffer.from(options.body)
      await fs.writeFile(requestBodyPath, bodyBuffer)
      args.push("--data-binary", `@${requestBodyPath}`)
    }

    args.push(url)
    await execCurl(args)

    const [rawHeaders, bodyBuffer] = await Promise.all([
      fs.readFile(headersPath, "utf8"),
      fs.readFile(bodyPath),
    ])

    const { status, headers } = parseCurlHeaders(rawHeaders)
    return {
      status,
      ok: status >= 200 && status < 300,
      headers,
      buffer: bodyBuffer,
      text: bodyBuffer.toString("utf8"),
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {})
  }
}

function anafNodeRequest(url: string, options: AnafRequestOptions = {}) {
  const parsed = new URL(url)
  const method = options.method || "GET"
  const timeoutMs = Number(options.timeoutMs || 20_000)

  return new Promise<AnafHttpResponse>((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: options.headers,
        family: 4,
        servername: parsed.hostname,
        minVersion: "TLSv1.2",
        maxVersion: "TLSv1.2",
        ciphers: "DEFAULT@SECLEVEL=1",
        secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        res.on("end", () => {
          const buffer = Buffer.concat(chunks)
          resolve({
            status: Number(res.statusCode || 0),
            ok: Number(res.statusCode || 0) >= 200 && Number(res.statusCode || 0) < 300,
            headers: res.headers,
            buffer,
            text: buffer.toString("utf8"),
          })
        })
      }
    )

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`ANAF request timeout after ${timeoutMs}ms for ${parsed.hostname}`))
    })

    req.on("error", reject)

    if (options.body) {
      req.write(options.body)
    }

    req.end()
  })
}

export async function anafHttpRequest(url: string, options: AnafRequestOptions = {}) {
  try {
    return await anafNodeRequest(url, options)
  } catch (error) {
    if (!shouldRetryWithCurl(error)) {
      throw error
    }

    return anafCurlRequest(url, options)
  }
}
