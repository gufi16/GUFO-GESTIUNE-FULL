// @ts-nocheck
import { Router } from "express"
import { prisma } from "../lib/prisma"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireTenantModule } from "../lib/tenantModules"
import { getSpvClassicStatus } from "../lib/spvClassic"
import { getSpvClassicCompanyDiagnostics } from "../lib/spvClassicClient"

const router = Router()

router.use(requireAuth)

router.get("/api/v1/spv-classic/status", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  const company = await prisma.company.findUnique({
    where: { tenantId },
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

export default router
