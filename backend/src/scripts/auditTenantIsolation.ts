import fs from "node:fs"
import path from "node:path"

const repoRoot = process.cwd()
const routesDir = path.join(repoRoot, "src", "routes")

const forbiddenPatterns = [
  {
    label: "Direct active-company fallback in route",
    regex: /resolveTenantCompany\(prisma,\s*tenantId,\s*req\.auth\?\.activeCompanyId/g,
  },
  {
    label: "Direct active-company fallback via getActiveCompanyId(req)",
    regex: /resolveTenantCompany\(prisma,\s*tenantId,\s*getActiveCompanyId\(req\)/g,
  },
  {
    label: "ANAF context loaded without auth-scoped company resolution",
    regex: /loadAnafCompanyContext\(tenantId,\s*req\.auth\?\.activeCompanyId\)/g,
  },
]

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...walk(fullPath))
    } else if (entry.isFile() && fullPath.endsWith(".ts")) {
      files.push(fullPath)
    }
  }
  return files
}

const files = walk(routesDir)
const findings: string[] = []

for (const file of files) {
  const content = fs.readFileSync(file, "utf8")
  const relativePath = path.relative(repoRoot, file).replace(/\\/g, "/")

  for (const pattern of forbiddenPatterns) {
    pattern.regex.lastIndex = 0
    const matches = content.match(pattern.regex)
    if (!matches?.length) continue

    findings.push(`${relativePath}: ${pattern.label} (${matches.length})`)
  }
}

if (findings.length) {
  console.error("Tenant isolation audit failed:")
  for (const finding of findings) {
    console.error(`- ${finding}`)
  }
  process.exit(1)
}

console.log("Tenant isolation audit passed.")
