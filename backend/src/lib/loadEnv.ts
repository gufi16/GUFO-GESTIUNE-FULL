import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import { fileURLToPath } from "url"

let envLoaded = false

export function loadEnv() {
  if (envLoaded) return

  const currentDir = path.dirname(fileURLToPath(import.meta.url))
  const backendRoot = path.resolve(currentDir, "..", "..")
  const candidatePaths = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(backendRoot, ".env"),
  ]

  for (const envPath of candidatePaths) {
    if (!fs.existsSync(envPath)) continue
    dotenv.config({ path: envPath, override: false })
    envLoaded = true
    return
  }

  dotenv.config()
  envLoaded = true
}
