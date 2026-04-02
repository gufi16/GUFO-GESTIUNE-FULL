// @ts-nocheck
import { Router } from "express"
import { requireAuth, AuthedRequest } from "../middleware/requireAuth"
import { requireTenantModule } from "../lib/tenantModules"
import { getSpvClassicStatus } from "../lib/spvClassic"

const router = Router()

router.use(requireAuth)

router.get("/api/v1/spv-classic/status", async (req: AuthedRequest, res) => {
  const tenantId = req.auth!.tenantId
  const moduleCheck = await requireTenantModule(tenantId, "efactura")
  if (!moduleCheck.enabled) {
    return res.status(403).json({ ok: false, error: "Modulul e-Factura nu este activ pe licenta acestui client." })
  }

  return res.json({
    ok: true,
    status: getSpvClassicStatus(),
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
