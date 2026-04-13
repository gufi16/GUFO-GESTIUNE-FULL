// @ts-nocheck
import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireTenantModule } from "../lib/tenantModules"
import { getSpvClassicStatus } from "../lib/spvClassic"
import { getSpvClassicCompanyDiagnostics, spvClassicListMessages } from "../lib/spvClassicClient"
import { resolveTenantCompany } from "../lib/companyResolver"

const router = Router()

router.use(requireAuth)

router.get("/api/v1/spv-classic/status", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId, {
    select: {
      tenantId: true,
      cui: true,
      efacturaCertFilename: true,
      efacturaCertPasswordEnc: true,
      efacturaCertSerial: true,
    },
  })

  return res.json({
    ok: true,
    status: {
      ...getSpvClassicStatus(),
      diagnostics: getSpvClassicCompanyDiagnostics(company || {}),
    },
  })
})

router.post("/api/v1/spv-classic/sync", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  return res.status(501).json({
    ok: false,
    ...getSpvClassicStatus(),
  })
})

router.post("/api/v1/spv-classic/test-list-messages", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const company = await resolveTenantCompany(prisma, tenantId, req.auth?.activeCompanyId, {
    select: {
      tenantId: true,
      cui: true,
      efacturaCertFilename: true,
      efacturaCertPasswordEnc: true,
      efacturaCertSerial: true,
    },
  })

  try {
    const result = await spvClassicListMessages(company || {}, {
      days: Number(req.body?.days || 30),
    })

    return res.json({
      ok: true,
      diagnostics: getSpvClassicCompanyDiagnostics(company || {}),
      request: {
        url: result.url,
        days: result.days,
      },
      response: {
        ok: result.response.ok,
        status: result.response.status,
      },
      summary: {
        title: result.payload?.titlu || null,
        messageCount: result.messages.length,
        firstMessageType: result.messages[0]?.tip || null,
        firstMessageId: result.messages[0]?.id || null,
        error: result.payload?.eroare || null,
      },
    })
  } catch (error: any) {
    return res.status(400).json({
      ok: false,
      diagnostics: getSpvClassicCompanyDiagnostics(company || {}),
      error: error?.message || "Nu am putut testa listaMesaje din SPV clasic.",
    })
  }
})

export default router
