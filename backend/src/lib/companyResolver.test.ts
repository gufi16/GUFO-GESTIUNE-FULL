import test from "node:test"
import assert from "node:assert/strict"
import type { Prisma } from "@prisma/client"

import { listTenantCompaniesForAuth, resolveTenantCompanyForAuth } from "./companyResolver"

type ResolverTestCompany = {
  id: string
  tenantId: string
  name: string
  isDefault: boolean
  createdAt: Date
}

type ResolverTestAccessRow = {
  userId: string
  companyId: string
}

function makeClient(companies: ResolverTestCompany[], accessRows: ResolverTestAccessRow[] = []) {
  return {
    company: {
      async findMany(args: Prisma.CompanyFindManyArgs) {
        const tenantId = String(args.where?.tenantId || "")
        const idFilter = args.where?.id
        const allowedIds =
          typeof idFilter === "object" && idFilter && "in" in idFilter ? idFilter.in : null
        let items = companies.filter((company) => company.tenantId === tenantId)
        if (Array.isArray(allowedIds)) {
          items = items.filter((company) => allowedIds.includes(company.id))
        }
        return items
      },
    },
    userCompanyAccess: {
      async findMany(args: Prisma.UserCompanyAccessFindManyArgs) {
        const userId = String(args.where?.userId || "")
        return accessRows.filter((row) => row.userId === userId)
      },
    },
  }
}

const companies = [
  { id: "c-default", tenantId: "tenant-a", name: "Default", isDefault: true, createdAt: new Date("2026-01-01") },
  { id: "c-other", tenantId: "tenant-a", name: "Other", isDefault: false, createdAt: new Date("2026-01-02") },
  { id: "c-foreign", tenantId: "tenant-b", name: "Foreign", isDefault: true, createdAt: new Date("2026-01-03") },
]

test("non-admin without company access receives no companies", async () => {
  const client = makeClient(companies, [])
  const items = await listTenantCompaniesForAuth(client, {
    tenantId: "tenant-a",
    userId: "user-a",
    role: "MANAGER",
  })

  assert.deepEqual(items, [])
})

test("non-admin only sees explicitly assigned companies", async () => {
  const client = makeClient(companies, [
    { userId: "user-a", companyId: "c-other" },
    { userId: "user-a", companyId: "c-foreign" },
  ])

  const items = await listTenantCompaniesForAuth(client, {
    tenantId: "tenant-a",
    userId: "user-a",
    role: "MANAGER",
  })

  assert.equal(items.length, 1)
  assert.equal(items[0].id, "c-other")
})

test("non-admin with invalid active company gets null instead of fallback", async () => {
  const client = makeClient(companies, [{ userId: "user-a", companyId: "c-other" }])
  const company = await resolveTenantCompanyForAuth(client, {
    tenantId: "tenant-a",
    userId: "user-a",
    role: "MANAGER",
    activeCompanyId: "c-default",
  })

  assert.equal(company, null)
})

test("non-admin with one allowed company resolves that company", async () => {
  const client = makeClient(companies, [{ userId: "user-a", companyId: "c-other" }])
  const company = await resolveTenantCompanyForAuth(client, {
    tenantId: "tenant-a",
    userId: "user-a",
    role: "MANAGER",
  })

  assert.ok(company)
  assert.equal(company.id, "c-other")
})

test("admin can still fall back to default company inside tenant", async () => {
  const client = makeClient(companies, [])
  const company = await resolveTenantCompanyForAuth(client, {
    tenantId: "tenant-a",
    userId: "admin-a",
    role: "ADMIN",
  })

  assert.ok(company)
  assert.equal(company.id, "c-default")
})
