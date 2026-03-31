import crypto from "crypto"
import https from "https"

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

export async function anafHttpRequest(url: string, options: AnafRequestOptions = {}) {
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
