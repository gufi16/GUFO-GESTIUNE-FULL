import test from "node:test"
import assert from "node:assert/strict"

import { listTenantCompaniesForAuth, resolveTenantCompanyForAuth } from "./companyResolver"

function makeClient(companies: any[], accessRows: any[] = []) {
  return {
    company: {
      async findMany(args: any) {
        const tenantId = args?.where?.tenantId
        const allowedIds = args?.where?.id?.in || null
        let items = companies.filter((company) => company.tenantId === tenantId)
        if (Array.isArray(allowedIds)) {
          items = items.filter((company) => allowedIds.includes(company.id))
        }
        return items
      },
    },
    userCompanyAccess: {
      async findMany(args: any) {
        const userId = args?.where?.userId
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
